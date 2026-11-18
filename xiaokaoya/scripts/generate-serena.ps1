$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtime = Join-Path $project '.runtime\serena-generation'
$output = Join-Path $project 'public\voices\serena'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$inventory = Get-Content -LiteralPath (Join-Path $runtime 'inventory.json') -Raw | ConvertFrom-Json -AsHashtable -Depth 20
$done = 0
foreach ($entry in $inventory.entries) {
  $file = Join-Path $output ($entry.key + '.wav')
  $receipt = Join-Path $runtime ($entry.key + '.json')
  if (!(Test-Path -LiteralPath $file)) {
    if ($entry.references -contains 'approved-audition') {
      Copy-Item -LiteralPath (Join-Path $project 'docs\voice-previews\2026-11-17\Serena-温暖清亮女声.wav') -Destination $file
      @{origin='user-approved audition';key=$entry.key;text=$entry.text} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $receipt -Encoding utf8
    } else {
      $body = @{data=@($entry.text,'Chinese','Serena',$entry.instruction,'1.7B')} | ConvertTo-Json -Depth 5 -Compress
      $reply = Invoke-WebRequest -Uri 'https://qwen-qwen3-tts.hf.space/gradio_api/call/generate_custom_voice' -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 20
      $job = $reply.Content | ConvertFrom-Json -AsHashtable
      @{key=$entry.key;text=$entry.text;model=$inventory.model;speaker='Serena';event_id=$job.event_id} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $receipt -Encoding utf8
      if (!$job.event_id) { throw 'Missing generation event ID' }
      $eventUrl = 'https://qwen-qwen3-tts.hf.space/gradio_api/call/generate_custom_voice/' + $job.event_id
      $events = Invoke-WebRequest -Uri $eventUrl -TimeoutSec 45
      [IO.File]::WriteAllText((Join-Path $runtime ($entry.key + '.events.txt')), $events.Content, [Text.UTF8Encoding]::new($false))
      if ($events.Content -notmatch 'event: complete') { throw "Generation did not complete; stopped without retrying quota limits: $($events.Content)" }
      $dataLine = ($events.Content -split "`n" | Where-Object { $_.StartsWith('data: ') } | Select-Object -Last 1).Substring(6)
      $result = $dataLine | ConvertFrom-Json -AsHashtable -Depth 20
      if (!$result[0].url) { throw "No generated audio: $($events.Content)" }
      $audioUrl = [Uri]$result[0].url
      if ($audioUrl.Scheme -ne 'https' -or $audioUrl.Host -ne 'qwen-qwen3-tts.hf.space') { throw 'Unexpected output host' }
      $partial = $file + '.partial'
      Invoke-WebRequest -Uri $audioUrl.AbsoluteUri -OutFile $partial -TimeoutSec 25
      $bytes = [IO.File]::ReadAllBytes($partial)
      if ($bytes.Length -lt 18000 -or [Text.Encoding]::ASCII.GetString($bytes,0,4) -ne 'RIFF') { throw "Invalid generated WAV: $($entry.key)" }
      Move-Item -LiteralPath $partial -Destination $file
      Start-Sleep -Milliseconds 500
    }
  }
  $done++
  @{complete=$done;total=$inventory.entries.Count;last=$entry.key;updatedUtc=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtime 'progress.json') -Encoding utf8
  if ($done % 10 -eq 0 -or $done -eq $inventory.entries.Count) { Write-Output "Serena audio: $done/$($inventory.entries.Count)" }
}
