import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { parse } from 'yaml'
import { storagePaths } from '../../src/main/storage'
import { resolveAppFile } from '../../src/main/protocol'
import { APP_ID, INSTALL_GUID } from '../../src/shared/identity'
import { todayKey, validDate, shiftDate, weekStart } from '../../src/domain/dates'
import { actualSeconds } from '../../src/domain/statistics'
import type { StudySession } from '../../src/domain/models'

describe('time boundaries', () => {
  it('can render boundary weeks without truncating extended ISO years', () => {
    expect(shiftDate('9999-12-31', 1)).toBe('+010000-01-01')
    expect(validDate(shiftDate('9999-12-31', 1))).toBe(false)
    expect(shiftDate('1900-01-01', -1)).toBe('1899-12-31')
  })
  it('handles leap years, centuries and expansion past 2029', () => {
    expect(validDate('2028-02-29')).toBe(true)
    expect(validDate('2027-02-29')).toBe(false)
    expect(validDate('2100-02-29')).toBe(false)
    expect(validDate('2000-02-29')).toBe(true)
    expect(shiftDate('2029-12-31', 1)).toBe('2030-01-01')
    expect(validDate('2027-04-31')).toBe(false)
  })
  it('starts weeks on Monday across years and uses Beijing dates', () => {
    expect(weekStart('2028-01-02')).toBe('2027-12-27')
    expect(weekStart('2027-01-01')).toBe('2026-12-28')
    expect(todayKey(new Date('2027-12-31T16:00:00Z'))).toBe('2028-01-01')
  })
  it('counts each confirmed session ID once and ignores drafts or voided records', () => {
    const record = {
      id: 'one',
      status: 'confirmed',
      timeMode: 'duration_only',
      durationOnlySeconds: 3600,
    } as StudySession
    expect(
      actualSeconds(
        [
          record,
          record,
          { ...record, id: 'draft', status: 'draft' },
          { ...record, id: 'void', status: 'voided' },
        ],
        [],
      ),
    ).toBe(3600)
  })
})
describe('desktop storage and installation contracts', () => {
  it('separates userData and sessionData, with no production override', () => {
    const paths = storagePaths(
      'C:\\Users\\example\\AppData\\Roaming',
      resolve('.'),
      true,
      'attempted-override',
    )
    expect(paths.userData).toBe(join('C:\\Users\\example\\AppData\\Roaming', 'Xiaokaoya'))
    expect(paths.sessionData).toBe(join(paths.userData, 'profile'))
    expect(paths.environment).toBe('production')
    const test = storagePaths('ignored', resolve('.'), false, 'unit-profile')
    expect(test.userData).toBe(resolve('.runtime/e2e/unit-profile'))
    expect(test.userData).not.toBe(paths.userData)
    expect(() => storagePaths('ignored', resolve('.'), false, '../../escape')).toThrow()
  })
  it('fixes NSIS identity and keeps data on uninstall', () => {
    const config = parse(readFileSync('electron-builder.yml', 'utf8'))
    expect(config.appId).toBe(APP_ID)
    expect(config.nsis.guid).toBe(INSTALL_GUID)
    expect(config.nsis.deleteAppDataOnUninstall).toBe(false)
    expect(config.nsis.perMachine).toBe(false)
    expect(config.win.target[0].target).toBe('nsis')
    expect(config.files).toEqual(['out/**', 'package.json'])
  })
  it('only serves local files from the bundled root', () => {
    const root = resolve('out/renderer')
    expect(resolveAppFile(root, 'app://xiaokaoya/')).toBe(join(root, 'index.html'))
    expect(resolveAppFile(root, 'app://xiaokaoya/assets/app.js')).toBe(join(root, 'assets/app.js'))
    for (const url of [
      'https://example.com/',
      'app://other/',
      'app://xiaokaoya/%2e%2e%2fsecret.txt',
      'app://xiaokaoya/a%5c..%5csecret.txt',
      'app://xiaokaoya/%00',
    ])
      expect(resolveAppFile(root, url)).toBeNull()
  })
})
