import { relative, resolve, isAbsolute, extname } from 'node:path'

export function resolveAppFile(root: string, requestUrl: string): string | null {
  try {
    const url = new URL(requestUrl)
    if (
      url.protocol !== 'app:' ||
      url.hostname !== 'xiaokaoya' ||
      url.port ||
      url.username ||
      url.password
    )
      return null
    const pathname = decodeURIComponent(url.pathname)
    if (pathname.includes('\\') || pathname.includes('\0')) return null
    const result = resolve(root, '.' + pathname)
    const rel = relative(root, result)
    if (rel.startsWith('..') || isAbsolute(rel)) return null
    return pathname === '/' || !extname(pathname) ? resolve(root, 'index.html') : result
  } catch {
    return null
  }
}
