"""Prepare the chosen Serena voice pack. All learning/user databases stay closed."""
import hashlib, json, os, time
from pathlib import Path
import numpy as np
import soundfile as sf
import torch
from qwen_tts import Qwen3TTSModel
from transformers.utils import logging

logging.set_verbosity_error()
project = Path(__file__).resolve().parent.parent
runtime = project / '.runtime/serena-generation'
output = project / 'public/voices/serena'
output.mkdir(parents=True, exist_ok=True)
inventory = json.loads((runtime / 'inventory.json').read_text(encoding='utf-8-sig'))
download = json.loads((project / '.runtime/serena-model/download-manifest.json').read_text(encoding='utf-8-sig'))
for item in download['files']:
    file = project / '.runtime/serena-model' / item['path']
    if not file.exists() or file.stat().st_size != item['size']: raise RuntimeError('Model download incomplete: '+item['path'])

torch.set_num_threads(4)
torch.backends.cuda.matmul.allow_tf32 = True
print(json.dumps({'stage':'load-model','gpu':torch.cuda.get_device_name(0),'freeBytes':torch.cuda.mem_get_info()[0]}), flush=True)
model = Qwen3TTSModel.from_pretrained(str(project / '.runtime/serena-model'), device_map='cuda:0', dtype=torch.bfloat16, attn_implementation='sdpa', local_files_only=True)
print('Serena model ready', flush=True)

for entry in inventory['entries']:
    if 'approved-audition' in entry['references']:
        (output/(entry['key']+'.wav')).write_bytes((project/'docs/voice-previews/2026-11-17/Serena-温暖清亮女声.wav').read_bytes())

batch_size = 4
while True:
    pending=[entry for entry in inventory['entries'] if not (output/(entry['key']+'.wav')).exists()]
    if not pending: break
    batch=pending[:batch_size]
    began=time.monotonic()
    seed=int(batch[0]['key'][:8],16)
    torch.manual_seed(seed)
    try:
        with torch.inference_mode():
            wavs,rate=model.generate_custom_voice(text=[e['text'] for e in batch],language=['Chinese']*len(batch),speaker=['Serena']*len(batch),instruct=[e['instruction'] for e in batch],max_new_tokens=384)
    except torch.cuda.OutOfMemoryError:
        torch.cuda.empty_cache()
        if batch_size==1: raise
        batch_size=max(1,batch_size//2)
        print(f'Reducing generation batch to {batch_size}',flush=True)
        continue
    for entry, generated in zip(batch,wavs,strict=True):
            target=output/(entry['key']+'.wav')
            wave = np.asarray(generated,dtype=np.float32)
            if wave.ndim != 1 or not np.isfinite(wave).all(): raise RuntimeError('Invalid synthesis: '+entry['key'])
            window = max(1,int(rate*.01))
            energy = np.array([np.max(np.abs(wave[i:i+window])) for i in range(0,len(wave),window)])
            active = np.flatnonzero(energy>.002)
            if not len(active): raise RuntimeError('Silent synthesis: '+entry['key'])
            start = max(0,int(active[0])*window-int(rate*.08))
            end = min(len(wave),(int(active[-1])+1)*window+int(rate*.18))
            wave = wave[start:end]
            duration=len(wave)/rate
            if not .8<=duration<=30: raise RuntimeError('Unexpected synthesis length: '+entry['key']+':'+str(duration))
            peak=float(np.max(np.abs(wave)))
            if peak>.95: wave *= .95/peak
            if float(np.sqrt(np.mean(wave*wave)))<.008: raise RuntimeError('Synthesis too quiet: '+entry['key'])
            partial=target.with_suffix('.wav.partial')
            sf.write(str(partial),wave,rate,format='WAV',subtype='PCM_16')
            os.replace(partial,target)
            receipt={'origin':'local GPU synthesis','model':inventory['model'],'revision':download['revision'],'speaker':'Serena','key':entry['key'],'text':entry['text'],'instruction':entry['instruction'],'batchSeed':seed,'batchKeys':[e['key'] for e in batch],'sampleRate':rate,'duration':duration,'elapsed':time.monotonic()-began,'sha256':hashlib.sha256(target.read_bytes()).hexdigest()}
            (runtime/(entry['key']+'.json')).write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
    complete=len(inventory['entries'])-len(pending)+len(batch)
    progress={'complete':complete,'total':len(inventory['entries']),'last':batch[-1]['key'],'updatedUtc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
    (runtime/'progress.json').write_text(json.dumps(progress),encoding='utf-8')
    print(f"Serena audio: {complete}/{len(inventory['entries'])} ({time.monotonic()-began:.1f}s per batch)",flush=True)
print('Complete Serena voice inventory generated',flush=True)
