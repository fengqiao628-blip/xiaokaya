const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { stripTypeScriptTypes } = require('node:module')
const { pathToFileURL } = require('node:url')
const root = path.resolve('.runtime/serena-generation')
fs.mkdirSync(root, { recursive: true })
const modules = path.join(root, 'source-modules')
fs.mkdirSync(modules, { recursive: true })
function compile(filename) {
  const out = path.join(modules, crypto.createHash('sha256').update(filename).digest('hex') + '.mjs')
  const stripped = stripTypeScriptTypes(fs.readFileSync(filename, 'utf8'))
  const code = stripped.replace(/from\s*(['"])([^'"]+)\1/g, (_match, _quote, specifier) => {
    if (!specifier.startsWith('.')) throw new Error('Unexpected inventory dependency: ' + specifier)
    const dependency = path.resolve(path.dirname(filename), specifier + (path.extname(specifier) ? '' : '.ts'))
    return 'from ' + JSON.stringify(pathToFileURL(compile(dependency)).href)
  })
  fs.writeFileSync(out, code)
  return out
}
async function main() {
const { encouragementLibrary } = await import(pathToFileURL(compile(path.resolve('src/companions/encouragement.ts'))).href)
const { quoteLibrary } = await import(pathToFileURL(compile(path.resolve('src/data/quote-library.ts'))).href)
const base = '年轻清亮的女声，温暖亲切，带着微笑鼓励对方，保持轻快和活力。像学习伙伴自然聊天，普通话清晰，有自然的停顿和抑扬顿挫，正常交谈音量。'
const entries = new Map()
function add(text, group, id) {
  text = text.trim().normalize('NFC')
  const key = crypto.createHash('sha256').update(text, 'utf8').digest('hex')
  const existing = entries.get(key)
  if (existing) { existing.references.push(id); return }
  entries.set(key, { key, text, group, references: [id], instruction: base })
}
for (const [mood, texts] of Object.entries(encouragementLibrary)) texts.forEach((text, i) => add(text, `state:${mood}`, `${mood}:${i}`))
for (const quote of quoteLibrary) add(quote.text, 'daily', quote.id)
add('辛苦了，今天的你也很棒。我会陪你按自己的节奏慢慢学习。', 'preview', 'settings-preview')
add('准备好了吗？我们一起开始吧！慢慢来，坚持一下，你一定可以的。', 'preview', 'approved-audition')
const inventory = { voiceId: 'serena-v1', model: 'Qwen3-TTS-12Hz-1.7B-CustomVoice', speaker: 'Serena', source: 'https://huggingface.co/spaces/Qwen/Qwen3-TTS', stateCount: Object.values(encouragementLibrary).flat().length, dailyCount: quoteLibrary.length, entries: [...entries.values()] }
fs.writeFileSync(path.join(root, 'inventory.json'), JSON.stringify(inventory, null, 2))
console.log(JSON.stringify({ stateCount: inventory.stateCount, dailyCount: inventory.dailyCount, unique: entries.size }))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
