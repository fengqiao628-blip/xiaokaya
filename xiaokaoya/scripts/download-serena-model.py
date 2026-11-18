"""Developer-only pinned public weights. Never included in the desktop installer."""
import concurrent.futures, hashlib, json, os, time, urllib.request
from pathlib import Path

root = Path('.runtime/serena-model').resolve()
manifest = json.loads((root / 'download-manifest.json').read_text(encoding='utf-8-sig'))

def download(entry):
    target = (root / entry['path']).resolve()
    if not target.is_relative_to(root): raise ValueError('Invalid model path')
    target.parent.mkdir(parents=True, exist_ok=True)
    expected = entry.get('sha256')
    def valid(file):
        if not file.exists() or file.stat().st_size != entry['size']: return False
        if expected:
            digest = hashlib.file_digest(file.open('rb'), 'sha256').hexdigest()
            return digest == expected
        return True
    if valid(target): return entry['path']
    partial = target.with_name(target.name + '.partial')
    url = f"https://huggingface.co/{manifest['repo']}/resolve/{manifest['revision']}/{entry['path']}?download=true"
    for attempt in range(3):
        try:
            offset = partial.stat().st_size if partial.exists() else 0
            request = urllib.request.Request(url, headers={'User-Agent': 'Xiaokaoya-build/0.7.2', **({'Range': f'bytes={offset}-'} if offset else {})})
            with urllib.request.urlopen(request, timeout=30) as response:
                mode = 'ab' if offset and response.status == 206 else 'wb'
                size = offset if mode == 'ab' else 0
                last = -1
                with partial.open(mode) as output:
                    while block := response.read(8*1024*1024):
                        output.write(block); size += len(block)
                        percent = int(size * 100 / entry['size']) // 10 * 10
                        if entry['size'] > 100_000_000 and percent != last:
                            print(f"Model {entry['path']}: {percent}%", flush=True); last = percent
            if not valid(partial): raise ValueError('Model size or SHA256 mismatch: ' + entry['path'])
            os.replace(partial, target)
            return entry['path']
        except Exception:
            if attempt == 2: raise
            time.sleep(attempt + 1)

entries = sorted(manifest['files'], key=lambda x: x['size'], reverse=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    for file in pool.map(download, entries): print('Verified model file: ' + file, flush=True)
print('Pinned Serena model download complete', flush=True)
