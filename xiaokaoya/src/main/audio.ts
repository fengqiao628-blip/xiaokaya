import { readFile } from 'node:fs/promises'

/** Finite, byte-addressable local audio; file paths must already pass resolveAppFile. */
export async function serveWave(file: string, request: Request): Promise<Response> {
  const bytes = await readFile(file),
    total = bytes.length
  const headers = new Headers({
    'Content-Type': 'audio/wav',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  let start = 0,
    end = total - 1,
    status = 200
  const range = request.headers.get('range')
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    let valid = Boolean(match && (match[1] || match[2]))
    if (match && valid) {
      if (!match[1]) {
        const suffix = Number(match[2])
        valid = Number.isSafeInteger(suffix) && suffix > 0
        start = Math.max(0, total - suffix)
      } else {
        start = Number(match[1])
        end = match[2] ? Number(match[2]) : end
        valid = Number.isSafeInteger(start) && Number.isSafeInteger(end) && start <= end
        end = Math.min(end, total - 1)
      }
    }
    if (!valid || start >= total) {
      headers.set('Content-Range', `bytes */${total}`)
      headers.set('Content-Length', '0')
      return new Response(null, { status: 416, headers })
    }
    status = 206
    headers.set('Content-Range', `bytes ${start}-${end}/${total}`)
  }
  headers.set('Content-Length', String(Math.max(0, end - start + 1)))
  return new Response(
    request.method === 'HEAD' ? null : Uint8Array.from(bytes.subarray(start, end + 1)),
    { status, headers },
  )
}
