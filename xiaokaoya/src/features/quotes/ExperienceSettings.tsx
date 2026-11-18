import { useState, type FormEvent } from 'react'
import type { Runner, Snapshot } from '../dashboard/readDashboard'
import { experience } from '../../services/experience'
import {
  configurePartnerAudio,
  mutePartnerAudioUntilSaved,
  clearPartnerMuteGuard,
  playPartnerSound,
  unlockPartnerAudio,
} from '../../companions/audio'
import type { ExperienceSettings as Settings } from '../../domain/experience'
import './quotes.css'
import { SpeechControls, useSpeech } from '../../companions/SpeechProvider'
import { holdSpeechMute, clearSpeechMute } from '../../companions/speech-policy'
const values = (s: Settings) => ({
  soundEnabled: s.soundEnabled,
  volume: s.volume,
  partnerSounds: s.partnerSounds,
  dueSound: s.dueSound,
  motion: s.motion,
  quoteCategory: s.quoteCategory,
})
export function ExperienceSettings({
  data,
  run,
  busy,
}: {
  data: Snapshot
  run: Runner
  busy: boolean
}) {
  const settings = data.experienceSettings
  if (!settings) return <p>正在读取体验设置…</p>
  return (
    <SettingsEditor key={settings.revision} settings={settings} data={data} run={run} busy={busy} />
  )
}
function SettingsEditor({
  settings,
  data,
  run,
  busy,
}: {
  settings: Settings
  data: Snapshot
  run: Runner
  busy: boolean
}) {
  const [draft, setDraft] = useState(values(settings)),
    [previewError, setPreviewError] = useState('')
  const [masterEnabled, setMasterEnabled] = useState(settings.soundEnabled)
  const speech = useSpeech()
  async function save(event: FormEvent) {
    event.preventDefault()
    await run(() => experience.saveSettings(settings, draft), '体验设置已保存')
  }
  async function mute(enabled: boolean) {
    setMasterEnabled(enabled)
    if (!enabled) {
      speech.stop()
      mutePartnerAudioUntilSaved(settings.revision)
      holdSpeechMute(settings.revision)
    }
    const ok = await run(
      () => experience.saveSettings(settings, { ...values(settings), soundEnabled: enabled }),
      enabled ? '声音已开启，可试听或继续学习' : '声音已关闭',
    )
    if (!ok) {
      clearPartnerMuteGuard()
      clearSpeechMute()
      void window.desktop.speech
        ?.configure({ enabled: settings.soundEnabled, volume: settings.volume })
        .catch(() => {})
      setMasterEnabled(settings.soundEnabled)
      configurePartnerAudio(settings)
    }
  }
  async function preview(due = false) {
    if (
      !(await unlockPartnerAudio()) ||
      !playPartnerSound(
        data.preferences?.companionId ?? 'duck',
        due ? 'due' : 'click',
        settings,
        `preview:${crypto.randomUUID()}`,
      )
    )
      setPreviewError('当前无法播放，请检查声音开关、音量及系统输出设备；学习数据不受影响。')
    else setPreviewError('')
  }
  return (
    <section className="experience-settings" aria-label="声音与动画设置">
      <h3>声音与动画</h3>
      <p className="modal-description">
        默认静音。开启总开关后按下方朗读方式播报；短提示音与语音朗读都可随时关闭。
      </p>
      <label className="setting-toggle">
        <input
          type="checkbox"
          aria-label="声音总开关"
          disabled={busy}
          checked={masterEnabled}
          onChange={(e) => void mute(e.target.checked)}
        />{' '}
        开启声音（关闭后立即静音）
      </label>
      <form onSubmit={save} aria-label="保存体验偏好">
        <fieldset disabled={busy}>
          <label className="field">
            音量（0—100）
            <input
              aria-label="伙伴音量"
              type="number"
              min="0"
              max="100"
              step="1"
              value={Math.round(draft.volume * 100)}
              onChange={(e) => setDraft({ ...draft, volume: Number(e.target.value) / 100 })}
            />
          </label>
          <label className="setting-toggle">
            <input
              type="checkbox"
              aria-label="伙伴状态短音效"
              checked={draft.partnerSounds}
              onChange={(e) => setDraft({ ...draft, partnerSounds: e.target.checked })}
            />{' '}
            伙伴状态短音效
          </label>
          <label className="setting-toggle">
            <input
              type="checkbox"
              aria-label="倒计时到时提示音"
              checked={draft.dueSound}
              onChange={(e) => setDraft({ ...draft, dueSound: e.target.checked })}
            />{' '}
            倒计时到时提示音
          </label>
          <div className="form-columns">
            <label className="field">
              动画
              <select
                aria-label="伙伴动画偏好"
                value={draft.motion}
                onChange={(e) =>
                  setDraft({ ...draft, motion: e.target.value as Settings['motion'] })
                }
              >
                <option value="system">跟随系统减少动态设置</option>
                <option value="on">开启动画</option>
                <option value="off">关闭动画</option>
              </select>
            </label>
            <label className="field">
              每日一句偏好分类
              <select
                aria-label="每日一句偏好分类"
                value={draft.quoteCategory ?? ''}
                onChange={(e) => setDraft({ ...draft, quoteCategory: e.target.value || null })}
              >
                <option value="">全部分类</option>
                {[...new Set(data.quotes.map((q) => q.category))].sort().map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>
          <p className="modal-description">
            保存后生效。分类影响下一次选择，不改写今天已保存的语句。
          </p>
          <div className="quote-actions">
            <button className="button primary" type="submit">
              保存体验设置
            </button>
            <button
              className="button outline"
              type="button"
              disabled={!settings.soundEnabled || !settings.partnerSounds || settings.volume <= 0}
              onClick={() => void preview()}
            >
              试听伙伴音效
            </button>
            <button
              className="button outline"
              type="button"
              disabled={!settings.soundEnabled || !settings.dueSound || settings.volume <= 0}
              onClick={() => void preview(true)}
            >
              试听到时提示
            </button>
          </div>
        </fieldset>
      </form>
      {previewError && <p role="status">{previewError}</p>}
      <SpeechControls />
    </section>
  )
}
