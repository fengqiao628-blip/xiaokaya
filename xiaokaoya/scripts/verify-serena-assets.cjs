const fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto')
const inventory=JSON.parse(fs.readFileSync('.runtime/serena-generation/inventory.json','utf8'))
const directory=path.resolve('public/voices/serena')
let total=0
const files=inventory.entries.map(entry=>{
  const name=entry.key+'.wav', file=path.join(directory,name), bytes=fs.readFileSync(file)
  if(bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw Error('Invalid WAV '+name)
  let format, data
  for(let offset=12;offset+8<=bytes.length;){const kind=bytes.toString('ascii',offset,offset+4),size=bytes.readUInt32LE(offset+4);if(offset+8+size>bytes.length)throw Error('Truncated WAV '+name);if(kind==='fmt ')format=bytes.subarray(offset+8,offset+8+size);if(kind==='data')data=bytes.subarray(offset+8,offset+8+size);offset+=8+size+(size%2)}
  if(!format||!data||format.readUInt16LE(0)!==1||format.readUInt16LE(2)!==1||format.readUInt32LE(4)!==24000||format.readUInt16LE(14)!==16)throw Error('Unexpected PCM format '+name)
  const duration=data.length/48000
  let sum=0,peak=0,clipped=0
  for(let i=0;i<data.length;i+=2){const value=data.readInt16LE(i);sum+=value*value;peak=Math.max(peak,Math.abs(value));if(Math.abs(value)>=32767)clipped++}
  const rms=Math.sqrt(sum/(data.length/2))
  if(duration<.8||duration>30||rms<200||peak<1000||clipped/(data.length/2)>.001)throw Error('Invalid voice levels '+name)
  const key=crypto.createHash('sha256').update(entry.text.trim().normalize('NFC'),'utf8').digest('hex')
  if(key!==entry.key)throw Error('Text-key mismatch')
  total+=bytes.length
  return {text:entry.text,file:name,group:entry.group,references:entry.references,duration:Number(duration.toFixed(3)),bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}
})
if(files.length!==322||new Set(files.map(x=>x.file)).size!==322)throw Error('Incomplete voice coverage')
if(total>160*1024*1024)throw Error('Voice package unexpectedly large')
const manifest={voiceId:'serena-v1',speaker:'Serena',model:inventory.model,source:inventory.source,format:'24kHz mono PCM16 WAV',stateCount:inventory.stateCount,dailyCount:inventory.dailyCount,totalFiles:files.length,totalBytes:total,files}
fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2))
fs.writeFileSync('src/companions/serena-catalog.json',JSON.stringify({voiceId:manifest.voiceId,files:files.map(({text,file})=>({text,file}))},null,2))
fs.writeFileSync('.runtime/serena-generation/build-validation.json',JSON.stringify({files:files.length,bytes:total,stateCount:inventory.stateCount,dailyCount:inventory.dailyCount,validatedAtUtc:new Date().toISOString()},null,2))
console.log(JSON.stringify({files:files.length,bytes:total,stateCount:inventory.stateCount,dailyCount:inventory.dailyCount}))
