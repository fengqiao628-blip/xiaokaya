import { expect, it, vi } from 'vitest'
import { SerenaPlayer } from '../../src/companions/serena-audio'
const text = '准备好了吗？我们一起开始吧！'
const file = 'a'.repeat(64) + '.wav'
function harness(permit: () => Promise<boolean> = async () => true) {
  const audios: any[] = [],
    error = vi.fn()
  const create = vi.fn(() => {
    const audio = {
      src: '',
      volume: 0,
      playbackRate: 1,
      preservesPitch: false,
      onended: null,
      onerror: null,
      play: vi.fn(async () => {}),
      pause: vi.fn(),
      load: vi.fn(),
      removeAttribute: vi.fn(),
    }
    audios.push(audio)
    return audio as unknown as HTMLAudioElement
  })
  const player = new SerenaPlayer([{ text, file }], create, permit, error)
  return { player, create, audios, error }
}
it('starts muted, stops at zero volume, and never invents audio or silently switches voice for unrecorded text', async () => {
  const h = harness()
  expect((await h.player.speak(text, 'muted')).started).toBe(false)
  expect(h.create).not.toHaveBeenCalled()
  h.player.configure(true, 0.4)
  expect(await h.player.speak('我的自定义语句', 'custom')).toMatchObject({
    started: false,
    message: expect.stringContaining('系统声音'),
  })
  expect(h.create).not.toHaveBeenCalled()
  h.player.configure(true, 0)
  expect((await h.player.speak(text, 'zero')).started).toBe(false)
})
it('uses only bundled hex filenames, preserves voice pitch, updates volume immediately and replaces rather than queues sentences', async () => {
  const h = harness()
  h.player.configure(true, 0.35)
  expect((await h.player.speak('  ' + text + '  ', 'one', -1)).started).toBe(true)
  const first = h.audios[0]
  expect(first).toMatchObject({
    src: `./voices/serena/${file}`,
    volume: 0.35,
    playbackRate: 0.9,
    preservesPitch: true,
  })
  expect((await h.player.speak(text, 'one')).started).toBe(false)
  expect(first.pause).not.toHaveBeenCalled()
  h.player.configure(true, 0.6)
  expect(first.volume).toBe(0.6)
  await h.player.speak(text, 'two', 1)
  expect(first.pause).toHaveBeenCalledOnce()
  expect(first.removeAttribute).toHaveBeenCalledWith('src')
  expect(h.audios[1].playbackRate).toBe(1.1)
  h.player.stop()
  expect(h.audios[1].pause).toHaveBeenCalledOnce()
})
it('cannot begin late after mute or cancellation during the native foreground check', async () => {
  let release!: (allowed: boolean) => void
  const h = harness(
    () =>
      new Promise<boolean>((r) => {
        release = r
      }),
  )
  h.player.configure(true, 0.5)
  const pending = h.player.speak(text, 'later')
  h.player.configure(false, 0.5)
  release(true)
  expect((await pending).started).toBe(false)
  expect(h.create).not.toHaveBeenCalled()
  h.player.configure(true, 0.5)
  const second = h.player.speak(text, 'later2')
  h.player.stop()
  release(true)
  expect((await second).started).toBe(false)
  expect(h.create).not.toHaveBeenCalled()
})
it('honors locked or background native state even if the renderer still appears visible', async () => {
  const h = harness(async () => false)
  h.player.configure(true, 0.5)
  expect((await h.player.speak(text, 'locked')).started).toBe(false)
  expect(h.create).not.toHaveBeenCalled()
})
it('cancels a delayed media play promise without reporting success or a stale error', async () => {
  const h = harness()
  const create = h.create.getMockImplementation()!
  let finish!: () => void
  h.create.mockImplementationOnce(() => {
    const audio = create()
    audio.play = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    return audio
  })
  h.player.configure(true, 0.4)
  const pending = h.player.speak(text, 'loading')
  await vi.waitFor(() => expect(h.create).toHaveBeenCalledOnce())
  h.player.stop()
  finish()
  expect((await pending).started).toBe(false)
  expect(h.audios[0].pause).toHaveBeenCalled()
  expect(h.error).not.toHaveBeenCalled()
})
it('only the latest concurrent request can start, and completed or superseded clips do not cancel a newer one', async () => {
  const resolves: ((allowed: boolean) => void)[] = []
  const h = harness(() => new Promise<boolean>((r) => resolves.push(r)))
  h.player.configure(true, 0.5)
  const a = h.player.speak(text, 'same'),
    b = h.player.speak(text, 'same')
  resolves.forEach((r) => r(true))
  expect((await Promise.all([a, b])).filter((r) => r.started)).toHaveLength(1)
  const staleError = h.audios[0].onerror
  const c = h.player.speak(text, 'new')
  resolves.at(-1)!(true)
  await c
  staleError()
  expect(h.error).not.toHaveBeenCalled()
  expect(h.audios[1].pause).not.toHaveBeenCalled()
})
it('degrades media failures to a readable error and remains reusable', async () => {
  const h = harness()
  h.player.configure(true, 0.5)
  h.create.mockImplementationOnce(() => {
    throw new Error('device failed')
  })
  expect(await h.player.speak(text, 'bad')).toMatchObject({
    started: false,
    message: expect.stringContaining('学习与计时不受影响'),
  })
  expect((await h.player.speak(text, 'good')).started).toBe(true)
  h.audios[0].onerror()
  expect(h.error).toHaveBeenCalledWith(expect.stringContaining('Serena'))
  expect((await h.player.speak(text, 'again')).started).toBe(true)
})
it('rejects arbitrary paths in voice assets and normalizes canonical text without changing punctuation', () => {
  const player = new SerenaPlayer([
    { text: 'café', file },
    { text: 'evil', file: 'https://example.com/audio.wav' },
  ])
  expect(player.supports(' cafe\u0301 ')).toBe(true)
  expect(player.supports('evil')).toBe(false)
  expect(player.supports('café。')).toBe(false)
})
