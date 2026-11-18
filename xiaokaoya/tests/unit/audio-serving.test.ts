import { it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { serveWave } from '../../src/main/audio'
import { serenaAssets, SERENA_PREVIEW } from '../../src/companions/serena-audio'
const file = 'public/voices/serena/' + serenaAssets.find((a) => a.text === SERENA_PREVIEW)!.file
const bytes = readFileSync(file)
const request = (range?: string, method = 'GET') =>
  new Request('app://xiaokaoya/voices/serena/clip.wav', {
    method,
    headers: range ? { range } : undefined,
  })
it('serves finite full audio and HEAD metadata without sending a body for HEAD', async () => {
  const full = await serveWave(file, request())
  expect(full.status).toBe(200)
  expect(full.headers.get('content-length')).toBe(String(bytes.length))
  expect(full.headers.get('accept-ranges')).toBe('bytes')
  expect(Buffer.from(await full.arrayBuffer())).toEqual(bytes)
  const head = await serveWave(file, request(undefined, 'HEAD'))
  expect(head.headers.get('content-type')).toBe('audio/wav')
  expect(head.headers.get('content-length')).toBe(String(bytes.length))
  expect((await head.arrayBuffer()).byteLength).toBe(0)
})
it('supports bounded, open-ended and suffix byte ranges for finite browser audio decoding', async () => {
  for (const [range, start, end] of [
    ['bytes=0-43', 0, 43],
    ['bytes=44-', 44, bytes.length - 1],
    ['bytes=-8', bytes.length - 8, bytes.length - 1],
    ['bytes=0-999999999', 0, bytes.length - 1],
  ] as const) {
    const response = await serveWave(file, request(range))
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe(`bytes ${start}-${end}/${bytes.length}`)
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes.subarray(start, end + 1))
  }
})
it('rejects invalid, multiple and unsatisfiable ranges without returning file data', async () => {
  for (const range of [
    'bytes=999999999-',
    'bytes=50-2',
    'bytes=-0',
    'bytes=',
    'bytes=0-1,4-5',
    'bytes=9007199254740992-',
    'other=0-4',
  ]) {
    const response = await serveWave(file, request(range))
    expect(response.status).toBe(416)
    expect(response.headers.get('content-range')).toBe(`bytes */${bytes.length}`)
    expect((await response.arrayBuffer()).byteLength).toBe(0)
  }
})
