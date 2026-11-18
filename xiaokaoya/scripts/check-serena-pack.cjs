const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict')
const root=path.resolve('public/voices/serena'),manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8')),index=JSON.parse(fs.readFileSync('src/companions/serena-catalog.json','utf8'))
assert.equal(manifest.voiceId,'serena-v1');assert.equal(manifest.totalFiles,322);assert.equal(manifest.files.length,322)
assert.equal(new Set(manifest.files.map(a=>a.file)).size,322)
assert.deepEqual(index.files,manifest.files.map(({text,file})=>({text,file})))
let bytes=0
for(const asset of manifest.files){
 assert.match(asset.file,/^[a-f0-9]{64}\.wav$/)
 assert.equal(asset.file,crypto.createHash('sha256').update(asset.text.trim().normalize('NFC'),'utf8').digest('hex')+'.wav')
 const data=fs.readFileSync(path.join(root,asset.file));assert.equal(data.length,asset.bytes);assert.equal(crypto.createHash('sha256').update(data).digest('hex'),asset.sha256);bytes+=data.length
}
assert.deepEqual(new Set(fs.readdirSync(root)),new Set([...manifest.files.map(a=>a.file),'manifest.json','LICENSE-Qwen3-TTS.txt','NOTICE.txt']))
assert.equal(bytes,manifest.totalBytes)
console.log(`Verified Serena: ${manifest.totalFiles} offline clips, ${bytes} bytes`)
