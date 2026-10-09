import { expect, it } from 'vitest'
import { desktopPort } from '../src/index.ts'

it('listens on the port the environment names', () => {
  expect(desktopPort({ DSH_DESKTOP_PORT: ' 19388 ' })).toBe('19388')
  expect(desktopPort({ DSH_DESKTOP_PORT: '0' })).toBe('0')
})

it('keeps Desktop\'s own port otherwise', () => {
  expect(desktopPort({})).toBe('19387')
  expect(desktopPort({ DSH_DESKTOP_PORT: ' ' })).toBe('19387')
})
