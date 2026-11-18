import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { generateCompanions } from './companion-artwork.mjs'

// Original layered companion assets; preserve the existing brand and installation icon.
generateCompanions()
const brand =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="20" fill="#faf0bd"/><path d="M31 18q-5-8 0-12 0 6 5 9 3-7 8-5-7 5-6 10" fill="#f6d56f"/><ellipse cx="32" cy="33" rx="22" ry="19" fill="#ffe59a" stroke="#b79851" stroke-width="1.5"/><circle cx="24" cy="30" r="2" fill="#6a634b"/><circle cx="40" cy="30" r="2" fill="#6a634b"/><ellipse cx="19" cy="37" rx="4" ry="2.5" fill="#f2b6a0"/><ellipse cx="45" cy="37" rx="4" ry="2.5" fill="#f2b6a0"/><path d="M25 37q7-4 14 0-1 7-7 7t-7-7" fill="#eeb362"/><path d="M13 49q10-3 19 3 9-6 19-3l-2 11q-9-2-17 2-8-4-17-2Z" fill="#aabe94" stroke="#7c9b6f" stroke-width="1.3"/><path d="M32 52v10" stroke="#7c9b6f"/></svg>'
writeFileSync(resolve('public/brand.svg'), brand)

// A Windows ICO with an original 256px DIB. No external media or runtime font needed.
const size = 256,
  pixels = Buffer.alloc(size * size * 4)
function ellipse(cx, cy, rx, ry, color) {
  for (let y = Math.max(0, Math.floor(cy - ry)); y < Math.min(size, cy + ry); y++)
    for (let x = Math.max(0, Math.floor(cx - rx)); x < Math.min(size, cx + rx); x++) {
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) {
        const i = ((size - 1 - y) * size + x) * 4
        pixels[i] = color[2]
        pixels[i + 1] = color[1]
        pixels[i + 2] = color[0]
        pixels[i + 3] = 255
      }
    }
}
ellipse(128, 128, 124, 124, [235, 241, 224])
ellipse(128, 130, 94, 80, [255, 226, 146])
ellipse(128, 49, 10, 24, [242, 204, 108])
ellipse(92, 120, 6, 8, [103, 89, 66])
ellipse(164, 120, 6, 8, [103, 89, 66])
ellipse(70, 147, 14, 8, [239, 179, 151])
ellipse(186, 147, 14, 8, [239, 179, 151])
ellipse(128, 149, 24, 13, [232, 172, 86])
for (let y = 194; y < 234; y++)
  for (let x = 54; x < 202; x++) {
    const i = ((size - 1 - y) * size + x) * 4
    pixels[i] = 148
    pixels[i + 1] = 190
    pixels[i + 2] = 170
    pixels[i + 3] = 255
  }
const dib = Buffer.alloc(40)
dib.writeUInt32LE(40, 0)
dib.writeInt32LE(size, 4)
dib.writeInt32LE(size * 2, 8)
dib.writeUInt16LE(1, 12)
dib.writeUInt16LE(32, 14)
dib.writeUInt32LE(pixels.length, 20)
const mask = Buffer.alloc((size * size) / 8)
const content = Buffer.concat([dib, pixels, mask])
const header = Buffer.alloc(22)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(1, 4)
header.writeUInt16LE(1, 10)
header.writeUInt16LE(32, 12)
header.writeUInt32LE(content.length, 14)
header.writeUInt32LE(22, 18)
mkdirSync(resolve('build'), { recursive: true })
writeFileSync(resolve('build/icon.ico'), Buffer.concat([header, content]))
console.log('Created 30 companion SVGs, brand SVG and Windows icon.')
