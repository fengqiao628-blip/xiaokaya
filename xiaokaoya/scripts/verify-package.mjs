import { createRequire } from 'node:module'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import assert from 'node:assert/strict'

const require = createRequire(import.meta.url)
const builderRequire = createRequire(require.resolve('electron-builder'))
const appBuilderRequire = createRequire(builderRequire.resolve('app-builder-lib'))
const asar = appBuilderRequire('@electron/asar')
const archive = resolve('release/win-unpacked/resources/app.asar')
const files = asar.listPackage(archive).map((file) => file.replaceAll('\\', '/'))
const forbidden = files.filter((file) =>
  /^\/(?:\.runtime|\.cache|\.pnpm-store|\.git|tests|test-results|playwright-report|src|docs)(?:\/|$)/.test(
    file,
  ),
)
assert.deepEqual(forbidden, [], 'Development data leaked into installer')
const modelFiles = files.filter(file => /\.(safetensors|gguf|onnx|pth|pt)$/i.test(file))
assert.deepEqual(modelFiles, [], 'Development voice model leaked into installer')
const voiceManifest = JSON.parse(readFileSync('public/voices/serena/manifest.json', 'utf8'))
const bundledVoiceClips = files.filter(file => /^\/out\/renderer\/voices\/serena\/[a-f0-9]{64}\.wav$/.test(file)).length
assert.equal(bundledVoiceClips, voiceManifest.totalFiles, 'Bundled voice audio is incomplete')
const metadata = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'))
assert.equal(metadata.version, JSON.parse(readFileSync('package.json', 'utf8')).version)
let compared = 0
function check(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) check(path)
    else {
      const key = relative(resolve('.'), path)
      assert.deepEqual(
        asar.extractFile(archive, key),
        readFileSync(path),
        `Source mismatch: ${key}`,
      )
      compared++
    }
  }
}
check(resolve('out'))
console.log(
  JSON.stringify(
    {
      version: metadata.version,
      comparedBundledFiles: compared,
      excludesDevelopmentData: true,
      compiledSourceMatchesArchive: true,
      bundledVoiceClips,
      excludesVoiceModels: true,
    },
    null,
    2,
  ),
)
