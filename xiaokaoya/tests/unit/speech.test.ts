import { it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { spawn } from 'node:child_process'
import { WindowsSpeech, SPEECH_HELPER } from '../../src/main/speech'
import { companionVisualState } from '../../src/companions/state'

function harness() {
  const requests: Record<string, unknown>[] = [],
    waiting: Record<string, unknown>[] = []
  let holdVoices = false,
    failSpeak = false
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: null as unknown as Writable,
    killed: false,
    kill: vi.fn(() => {
      child.killed = true
      child.emit('exit', 0)
      return true
    }),
  })
  function respond(input: Record<string, unknown>) {
    const response =
      input.action === 'voices'
        ? { voices: [{ id: 'local-zh', name: '本机中文', language: '804' }] }
        : {}
    child.stdout.write(
      JSON.stringify({
        id: input.id,
        ok: !(failSpeak && input.action === 'speak'),
        message: 'simulated voice failure',
        ...response,
      }) + '\n',
    )
  }
  child.stdin = new Writable({
    write(chunk, _encoding, done) {
      const input = JSON.parse(chunk.toString())
      requests.push(input)
      if (input.action === 'voices' && holdVoices) waiting.push(input)
      else queueMicrotask(() => respond(input))
      done()
    },
  })
  const launch = vi.fn(() => child),
    engine = new WindowsSpeech(launch as unknown as typeof spawn, 'win32')
  return {
    engine,
    child,
    launch,
    requests,
    hold() {
      holdVoices = true
    },
    release() {
      holdVoices = false
      waiting.splice(0).forEach(respond)
    },
    fail() {
      failSpeak = true
    },
  }
}
const input = { text: '坚持就是胜利。', voiceId: '', rate: 0, key: 'event:1' }
it('keeps idle eyes open, studies while running, rests only on an explicit pause and stays awake during review', () => {
  expect(companionVisualState()).toBe('idle')
  expect(companionVisualState({ status: 'running' })).toBe('study')
  expect(companionVisualState({ status: 'paused' })).toBe('rest')
  expect(companionVisualState({ status: 'review' }, 'celebrate')).toBe('idle')
  expect(companionVisualState({ status: 'saved' }, 'celebrate')).toBe('celebrate')
})
it('passes text as JSON only, launches a hidden static helper, and forces local Chinese voices and plain-text synthesis', async () => {
  const h = harness()
  await h.engine.configure({ enabled: true, volume: 0.35 })
  const text = '<speak>你好</speak> `$(Get-ChildItem) "你好"\n新行'
  expect(await h.engine.speak({ ...input, text })).toEqual({ started: true })
  const [exe, args, options] = h.launch.mock.calls[0] as unknown as [
    string,
    string[],
    { windowsHide: boolean },
  ]
  expect(exe).toMatch(/powershell.exe$/)
  expect(options.windowsHide).toBe(true)
  expect(Buffer.from(args.at(-1)!, 'base64').toString('utf16le')).toBe(SPEECH_HELPER)
  expect(args.join(' ')).not.toContain(text)
  expect(h.requests.at(-1)).toMatchObject({ action: 'speak', text, volume: 35 })
  expect(SPEECH_HELPER).toContain("'TTS_MS_ZH'")
  expect(SPEECH_HELPER).toContain('Speak([string]$request.text, 19)')
  h.engine.dispose()
})
it('stays silent before opt-in and rejects invalid input without starting a helper', async () => {
  const h = harness()
  expect((await h.engine.speak(input)).started).toBe(false)
  expect(h.launch).not.toHaveBeenCalled()
  await expect(h.engine.speak({ ...input, text: 'x'.repeat(1001) })).rejects.toThrow()
  await expect(h.engine.configure({ enabled: true, volume: 2 })).rejects.toThrow()
  expect(h.launch).not.toHaveBeenCalled()
  h.engine.dispose()
})
it('deduplicates concurrent displays of the same event and cancels a pending warm-up when muted', async () => {
  const h = harness()
  await h.engine.configure({ enabled: true, volume: 0.4 })
  h.hold()
  const first = h.engine.speak(input),
    second = h.engine.speak(input)
  h.release()
  expect((await Promise.all([first, second])).filter((r) => r.started)).toHaveLength(1)
  expect(h.requests.filter((r) => r.action === 'speak')).toHaveLength(1)
  h.hold()
  const pending = h.engine.speak({ ...input, key: 'later' })
  await h.engine.configure({ enabled: false, volume: 0.4 })
  h.release()
  expect((await pending).started).toBe(false)
  expect(h.requests.filter((r) => r.action === 'speak')).toHaveLength(1)
  expect(h.requests.at(-1)?.action).toBe('stop')
  h.engine.dispose()
})
it('stop invalidates pending speech without disabling future explicit reads; failures stay local to speech', async () => {
  const h = harness()
  await h.engine.configure({ enabled: true, volume: 0.4 })
  h.hold()
  const pending = h.engine.speak(input)
  await h.engine.stop()
  h.release()
  expect((await pending).started).toBe(false)
  expect((await h.engine.speak({ ...input, key: 'new-read' })).started).toBe(true)
  h.fail()
  await expect(h.engine.speak({ ...input, key: 'fail' })).rejects.toThrow('voice failure')
  h.engine.dispose()
})
it('fails cleanly on an unavailable platform and cannot restart after disposal', async () => {
  const engine = new WindowsSpeech(spawn, 'linux')
  await expect(engine.voices()).rejects.toThrow('Windows')
  engine.dispose()
  await expect(engine.voices()).rejects.toThrow('关闭')
})
