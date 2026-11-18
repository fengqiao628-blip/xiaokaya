import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { z } from 'zod'
import type { LocalVoice, SpeechRequest } from '../shared/speech'

// Static code only. User text travels as UTF-8 JSON on stdin, never as shell code or SSML.
// SAPI flags 19 = async(1) + purge old utterances(2) + plain text / not XML(16).
export const SPEECH_HELPER = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$speaker = New-Object -ComObject SAPI.SpVoice
$tokens = $speaker.GetVoices()
$voices = @()
$byId = @{}
for ($i = 0; $i -lt $tokens.Count; $i++) {
  $token = $tokens.Item($i)
  $language = $token.GetAttribute('Language')
  if ($token.Id -match 'TTS_MS_ZH' -and $language -match '(^|;)(804|404|c04)($|;)') {
    $byId[$token.Id] = $token
    $voices += @{id=$token.Id;name=$token.GetDescription();language=$language}
  }
}
try {
  while ($null -ne ($line = [Console]::ReadLine())) {
    $request = $null
    try {
      $request = ConvertFrom-Json $line
      switch ($request.action) {
        'voices' { $response = @{id=$request.id;ok=$true;voices=@($voices)} }
        'speak' {
          if (!$voices.Count) { throw '本机暂无可用的Windows离线中文声音' }
          $voiceId = [string]$request.voiceId
          if (!$voiceId) { $voiceId = $voices[0].id }
          if (!$byId.ContainsKey($voiceId)) { throw '选择的离线中文声音已不可用' }
          if ($request.text -isnot [string] -or $request.text.Length -gt 1000 -or !$request.text.Trim()) { throw '朗读文字无效或超过1000字' }
          $speaker.Speak('', 19) | Out-Null
          $speaker.Voice = $byId[$voiceId]
          $speaker.Volume = [Math]::Max(0, [Math]::Min(100, [int]$request.volume))
          $speaker.Rate = [Math]::Max(-3, [Math]::Min(3, [int]$request.rate))
          $speaker.Speak([string]$request.text, 19) | Out-Null
          $response = @{id=$request.id;ok=$true}
        }
        'stop' { $speaker.Speak('', 19) | Out-Null; $response = @{id=$request.id;ok=$true} }
        default { throw '不支持的语音操作' }
      }
      [Console]::WriteLine((ConvertTo-Json -InputObject $response -Depth 5 -Compress))
    } catch {
      [Console]::WriteLine((ConvertTo-Json -InputObject @{id=$request.id;ok=$false;message=$_.Exception.Message} -Compress))
    }
  }
} finally {
  try { $speaker.Speak('', 19) | Out-Null } catch {}
  [Runtime.InteropServices.Marshal]::FinalReleaseComObject($speaker) | Out-Null
}
`
export const speechRequestSchema = z
  .object({
    text: z.string().trim().min(1).max(1000),
    voiceId: z.string().max(1000),
    rate: z.number().int().min(-3).max(3),
    key: z.string().min(1).max(200),
  })
  .strict()
const policySchema = z
  .object({ enabled: z.boolean(), volume: z.number().finite().min(0).max(1) })
  .strict()
interface Reply {
  id: number
  ok: boolean
  message?: string
  voices?: LocalVoice[]
}
export class WindowsSpeech {
  private child?: ChildProcessWithoutNullStreams
  private serial = 0
  private enabled = false
  private volume = 0.35
  private generation = 0
  private disposed = false
  private seen = new Set<string>()
  private pending = new Map<
    number,
    { resolve: (reply: Reply) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout }
  >()
  constructor(
    private launch = spawn,
    private platform: string = process.platform,
  ) {}
  private ensure() {
    if (this.disposed) throw new Error('语音已关闭')
    if (this.platform !== 'win32') throw new Error('本机语音仅支持Windows桌面版')
    if (this.child && !this.child.killed) return this.child
    const executable = join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    )
    const child = this.launch(
      executable,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-STA',
        '-EncodedCommand',
        Buffer.from(SPEECH_HELPER, 'utf16le').toString('base64'),
      ],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    ) as ChildProcessWithoutNullStreams
    this.child = child
    const lines = createInterface({ input: child.stdout })
    lines.on('line', (line) => {
      try {
        const reply = JSON.parse(line.replace(/^\uFEFF/, '')) as Reply,
          pending = this.pending.get(reply.id)
        if (!pending) return
        clearTimeout(pending.timeout)
        this.pending.delete(reply.id)
        if (reply.ok) pending.resolve(reply)
        else pending.reject(new Error(reply.message || '本机语音暂不可用'))
      } catch {
        this.fail(new Error('本机语音响应无效'))
      }
    })
    child.stderr.on('data', () => {}) // no text/voice input is written to disk or logs
    child.stdin.on('error', () => this.fail(new Error('本机语音连接已中断')))
    child.on('error', () => this.fail(new Error('无法启动Windows本机语音，请检查系统语音组件')))
    child.on('exit', () => {
      if (this.child === child) {
        this.child = undefined
        this.fail(new Error('本机语音已退出'))
      }
      lines.close()
    })
    return child
  }
  private fail(error: Error) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timeout)
      p.reject(error)
    }
    this.pending.clear()
  }
  private request(action: string, input: Record<string, unknown> = {}): Promise<Reply> {
    try {
      const child = this.ensure(),
        id = ++this.serial
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.pending.delete(id)
          reject(new Error('Windows语音响应超时，请稍后重试'))
          child.kill()
        }, 12000)
        this.pending.set(id, { resolve, reject, timeout })
        child.stdin.write(JSON.stringify({ ...input, id, action }) + '\n', 'utf8')
      })
    } catch (error) {
      return Promise.reject(error)
    }
  }
  async voices(): Promise<LocalVoice[]> {
    return (await this.request('voices')).voices ?? []
  }
  async configure(input: { enabled: boolean; volume: number }) {
    const policy = policySchema.parse(input)
    this.generation++
    this.enabled = policy.enabled
    this.volume = policy.volume
    if (!policy.enabled || policy.volume === 0) await this.stop()
  }
  async speak(input: SpeechRequest) {
    const value = speechRequestSchema.parse(input),
      generation = this.generation
    if (!this.enabled || this.volume <= 0)
      return { started: false, message: '请先开启声音总开关并调高音量' }
    if (this.seen.has(value.key)) return { started: false }
    await this.voices()
    if (
      !this.enabled ||
      this.volume <= 0 ||
      generation !== this.generation ||
      this.seen.has(value.key)
    )
      return { started: false }
    this.seen.add(value.key)
    if (this.seen.size > 500) this.seen.delete(this.seen.values().next().value!)
    await this.request('speak', {
      text: value.text,
      voiceId: value.voiceId,
      rate: value.rate,
      volume: Math.round(this.volume * 100),
    })
    return { started: true }
  }
  async stop() {
    this.generation++
    if (this.child && !this.child.killed) await this.request('stop').catch(() => {})
  }
  dispose() {
    this.disposed = true
    this.enabled = false
    this.generation++
    const child = this.child
    this.child = undefined
    child?.stdin.end()
    const timer = setTimeout(() => child?.kill(), 800)
    timer.unref()
    this.fail(new Error('语音已关闭'))
  }
}
