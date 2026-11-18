import { expect } from '@playwright/test'
import { TABLES, V6_TABLES } from '../../src/data/schema'
export function expectV6Preserved(before: Record<string, any[]>, after: Record<string, any[]>) {
  for (const name of V6_TABLES) {
    if (name === 'migrationHistory') {
      for (const row of before[name]) expect(after[name]).toContainEqual(row)
      expect(after[name]).toHaveLength(before[name].length + 1)
      expect(
        after[name].find((row) => !before[name].some((old) => old.id === row.id)),
      ).toMatchObject({ fromVersion: 6, toVersion: 7 })
    } else expect(after[name]).toEqual(before[name])
  }
  for (const name of TABLES.filter((name) => !V6_TABLES.includes(name as never)))
    expect(after[name]).toEqual([])
}
