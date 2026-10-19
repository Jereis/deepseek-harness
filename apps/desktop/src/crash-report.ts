/**
 * Crash report files: the complete diagnostic of one fatal Desktop failure,
 * written before the recovery dialog so the dialog can name the file. The
 * dialog itself shows only the last lines of the error; the file holds the
 * whole error, its enumerable properties and cause chain, the process facts,
 * abnormal child process exits, and the renderer's recent error-level console output.
 */

import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { inspect } from 'node:util'

/** Where a fatal failure surfaced. */
export type CrashReportSource = 'host' | 'web-boot' | 'renderer' | 'main'

/** Whether the backend had reached ready when the failure surfaced. */
export type CrashReportPhase = 'startup' | 'running'

/** Facts about the running application recorded in every report header. */
export interface CrashReportApp {
  readonly name: string
  readonly version: string
  readonly platform: string
  readonly arch: string
  readonly electron: string
  readonly node: string
  readonly locale: string
}

/** Inputs of {@link renderCrashReport} and {@link writeCrashReport}. */
export interface CrashReportInput {
  readonly source: CrashReportSource
  readonly phase: CrashReportPhase
  readonly error: unknown
  /** The Host's own inspected error when it reported the failure over IPC before exiting. */
  readonly hostDiagnostic?: string
  /** Stderr tail of a Host still running when the shell failed; a Host exit error already carries it in its message. */
  readonly hostStderr?: string
  /** Recent renderer console lines at error level, oldest first. */
  readonly rendererConsole: readonly string[]
  /** Recent abnormal child process exits (GPU, utility, renderer), oldest first; a GPU process failure surfaces as a renderer crash. */
  readonly childProcessExits?: readonly string[]
  /** Directory of the local crash dumps written by Electron's crash reporter. */
  readonly crashDumps?: string
  readonly app: CrashReportApp
  readonly time: Date
}

/** File name prefix every report shares. */
export const CRASH_REPORT_PREFIX = 'crash-'

/** The exact generated file name syntax; pruning touches only files that match it. */
const CRASH_REPORT_NAME = /^crash-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-(?:host|web-boot|renderer|main)\.log$/u

/** Reports kept after pruning, newest first by file name. */
export const CRASH_REPORTS_RETAINED = 10

/** Retained bytes of renderer error-level console output. */
export const RENDERER_CONSOLE_MAX_BYTES = 64 * 1024

/** Retained bytes of abnormal child process exit lines. */
export const CHILD_PROCESS_EXITS_MAX_BYTES = 16 * 1024

/** Upper bound of the rendered error section; a Host exit error already carries a 64 KiB stderr tail in its message. */
export const ERROR_SECTION_MAX_CHARS = 256 * 1024

/**
 * Bounded tail of report lines, such as renderer error-level console output.
 * Lines are dropped from the head once the retained byte total exceeds the
 * cap; one oversized line is kept whole so a long stack is never cut mid-line.
 */
export class LineTail {
  private readonly lines: string[] = []
  private bytes = 0

  /** @param maxBytes - retained byte cap across all lines. */
  constructor(private readonly maxBytes = RENDERER_CONSOLE_MAX_BYTES) {}

  /**
   * Append one line.
   * @param line - the formatted line.
   */
  push(line: string): void {
    this.lines.push(line)
    this.bytes += Buffer.byteLength(line)
    while (this.lines.length > 1 && this.bytes > this.maxBytes) {
      this.bytes -= Buffer.byteLength(this.lines.shift() as string)
    }
  }

  /** @returns the retained lines, oldest first. */
  snapshot(): readonly string[] {
    return [...this.lines]
  }
}

/**
 * A process exit code as Electron reports it, with the Windows NTSTATUS or
 * exception code in hexadecimal alongside, such as `-2147483645 (0x80000003)`.
 * @param exitCode - the reported exit code.
 * @param platform - the platform that produced it.
 * @returns the decimal code, followed on Windows by its unsigned hexadecimal form when it is not a small exit status.
 */
export function describeExitCode(exitCode: number, platform: NodeJS.Platform = process.platform): string {
  if (platform !== 'win32' || (exitCode >= 0 && exitCode <= 0xffff)) return String(exitCode)
  return `${String(exitCode)} (0x${(exitCode >>> 0).toString(16).toUpperCase().padStart(8, '0')})`
}

/**
 * The report file name: sortable by time, then the source.
 * @param time - failure time.
 * @param source - where the failure surfaced.
 * @returns `crash-<ISO time with ':' and '.' as '-'>-<source>.log`.
 */
export function crashReportFileName(time: Date, source: CrashReportSource): string {
  return `${CRASH_REPORT_PREFIX}${time.toISOString().replaceAll(/[:.]/gu, '-')}-${source}.log`
}

/**
 * Render one report as plain text: a header of facts, the inspected error,
 * the abnormal child process exits when any were recorded, the Host's own diagnostic when it reported one, the running Host's stderr tail
 * when the shell recorded one, and the renderer console tail.
 * @param input - the failure and its context.
 * @returns the complete file content.
 */
export function renderCrashReport(input: CrashReportInput): string {
  const header = [
    `time: ${input.time.toISOString()}`,
    `source: ${input.source}`,
    `phase: ${input.phase}`,
    `app: ${input.app.name} ${input.app.version}`,
    `platform: ${input.app.platform} ${input.app.arch}`,
    `electron: ${input.app.electron}`,
    `node: ${input.app.node}`,
    `locale: ${input.app.locale}`,
    `shell pid: ${String(process.pid)}`,
    ...(input.crashDumps === undefined ? [] : [`crash dumps: ${input.crashDumps}`]),
  ]
  const consoleSection = input.rendererConsole.length === 0
    ? '(no error-level renderer console output was captured)'
    : input.rendererConsole.join('\n')
  return [
    header.join('\n'),
    '',
    '--- error ---',
    boundedErrorSection(input.error),
    '',
    ...(input.childProcessExits === undefined || input.childProcessExits.length === 0
      ? []
      : ['--- child process exits (abnormal, oldest first) ---', input.childProcessExits.join('\n'), '']),
    ...(input.hostDiagnostic === undefined ? [] : ['--- host diagnostic (as reported by the Host process) ---', input.hostDiagnostic, '']),
    ...(input.hostStderr === undefined ? [] : ['--- host stderr (recent output of the running Host) ---', input.hostStderr, '']),
    '--- renderer console (error level, oldest first) ---',
    consoleSection,
    '',
  ].join('\n')
}

function boundedErrorSection(error: unknown): string {
  const rendered = inspect(error, { depth: 6, maxStringLength: 64 * 1024, maxArrayLength: 100, breakLength: 120 })
  return rendered.length <= ERROR_SECTION_MAX_CHARS
    ? rendered
    : `${rendered.slice(0, ERROR_SECTION_MAX_CHARS)}\n… (error section cut at ${String(ERROR_SECTION_MAX_CHARS)} characters)`
}

/**
 * Write one report into `directory`, creating it when absent. Failure is
 * reported to `console.error` and yields `undefined`: the recovery dialog
 * proceeds without a file rather than failing over a diagnostic aid.
 * @param directory - the application logs directory.
 * @param input - the failure and its context.
 * @returns the written file path, or `undefined` when writing failed.
 */
export async function writeCrashReport(directory: string, input: CrashReportInput): Promise<string | undefined> {
  const path = join(directory, crashReportFileName(input.time, input.source))
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await writeFile(path, renderCrashReport(input), { mode: 0o600, flag: 'wx' })
    return path
  } catch (error) {
    console.error('dsh desktop: crash report could not be written', path, error)
    return undefined
  }
}

/**
 * Delete the oldest reports beyond `retained`, judged by file name order, and
 * leave every other file in the directory alone. Failure is reported to
 * `console.error`; a missing directory is not a failure.
 * @param directory - the application logs directory.
 * @param retained - reports to keep.
 */
export async function pruneCrashReports(directory: string, retained = CRASH_REPORTS_RETAINED): Promise<void> {
  let names: string[]
  try {
    names = await readdir(directory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    console.error('dsh desktop: crash report directory could not be listed', directory, error)
    return
  }
  const reports = names.filter(name => CRASH_REPORT_NAME.test(name)).sort()
  const excess = reports.slice(0, Math.max(0, reports.length - retained))
  for (const name of excess) {
    try {
      await unlink(join(directory, name))
    } catch (error) {
      console.error('dsh desktop: stale crash report could not be removed', join(directory, name), error)
    }
  }
}
