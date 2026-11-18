import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const assets = JSON.parse(readFileSync('src/companions/artwork.generated.json', 'utf8'))
const catalog = JSON.parse(readFileSync('src/companions/catalog.json', 'utf8'))
const expected = catalog.flatMap((animal) => [
  ...Object.values(animal.assets),
  `companions/${animal.id}/blink.svg`,
  `companions/${animal.id}/idle-blink.svg`,
])
assert.deepEqual(Object.keys(assets).sort(), expected.sort(), 'Incomplete companion drawings')
for (const [path, svg] of Object.entries(assets)) {
  assert.match(path, /^companions\/[a-z]+\/(?:idle|study|rest|celebrate|blink|idle-blink)\.svg$/)
  assert.equal(
    svg,
    readFileSync(`public/${path}`, 'utf8'),
    `Inline/exported drawing mismatch: ${path}`,
  )
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  assert.doesNotMatch(
    svg,
    /<script|<foreignObject|<!DOCTYPE|\bon[a-z]+\s*=|\b(?:href|src)\s*=/i,
    `Unsafe bundled vector: ${path}`,
  )
}
console.log(`Verified companions: ${expected.length} local layered SVGs, no external content`)
