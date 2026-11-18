import { it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { encouragementLibrary } from '../../src/companions/encouragement'
import { quoteLibrary } from '../../src/data/quote-library'
import { serenaAssets, SERENA_PREVIEW } from '../../src/companions/serena-audio'

const directory = 'public/voices/serena'
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
it('covers every unchanged built-in state and daily text, including the approved audition, with an exact text-to-file mapping', () => {
  const expected = [
    ...Object.values(encouragementLibrary).flat(),
    ...quoteLibrary.map((q) => q.text),
    SERENA_PREVIEW,
    '辛苦了，今天的你也很棒。我会陪你按自己的节奏慢慢学习。',
  ].map((text) => text.trim().normalize('NFC'))
  expect(serenaAssets).toHaveLength(322)
  expect(new Set(serenaAssets.map((a) => a.text))).toEqual(new Set(expected))
  for (const asset of serenaAssets) expect(asset.file).toBe(hash(asset.text) + '.wav')
})
it('ships complete finite PCM audio whose hashes and sizes match the voice manifest, with no model or generation cache in the pack', () => {
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'))
  expect(manifest).toMatchObject({
    voiceId: 'serena-v1',
    speaker: 'Serena',
    stateCount: 120,
    dailyCount: 200,
    totalFiles: 322,
  })
  let bytes = 0
  for (const entry of manifest.files) {
    const file = readFileSync(join(directory, entry.file))
    expect(file.toString('ascii', 0, 4)).toBe('RIFF')
    expect(file.toString('ascii', 8, 12)).toBe('WAVE')
    expect(hash(file)).toBe(entry.sha256)
    expect(file.length).toBe(entry.bytes)
    expect(entry.duration).toBeGreaterThan(0.8)
    expect(entry.duration).toBeLessThanOrEqual(30)
    bytes += file.length
  }
  expect(bytes).toBe(manifest.totalBytes)
  expect(bytes).toBeLessThan(160 * 1024 * 1024)
  expect(new Set(readdirSync(directory))).toEqual(
    new Set([
      ...manifest.files.map((x: any) => x.file),
      'manifest.json',
      'LICENSE-Qwen3-TTS.txt',
      'NOTICE.txt',
    ]),
  )
})
it('keeps the user-selected Serena audition byte-for-byte as the settings preview', () => {
  const selected = serenaAssets.find((a) => a.text === SERENA_PREVIEW)!
  expect(readFileSync(join(directory, selected.file))).toEqual(
    readFileSync('docs/voice-previews/2026-11-17/Serena-温暖清亮女声.wav'),
  )
})
