/**
 * Collect each carrier bundle's `dsh.desktop.asarUnpack` globs as patterns over the prepared dsh directory.
 * @param dshDir Prepared dsh directory whose `package.json` lists `dsh.carrier.bundles`.
 * @returns electron-builder `asarUnpack` patterns; rejects a malformed declaration.
 */
export function carrierAsarUnpackPatterns(dshDir: string): Promise<string[]>
