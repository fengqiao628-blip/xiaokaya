import { z } from 'zod'
import { db, type StudyDatabase } from '../data/database'
import { exclusive } from '../data/operation-gate'
import type { ExperienceSettings, QuoteDetail } from '../domain/experience'
const inputSchema = z.object({
  text: z.string().trim().min(1, '请写下一句想留下的话').max(1000, '语句最多1000字'),
  category: z.string().trim().min(1, '请填写分类').max(40),
  author: z.string().trim().max(200),
  work: z.string().trim().max(300),
  sourceTitle: z.string().trim().max(500),
  sourceUrl: z
    .string()
    .trim()
    .max(2000)
    .refine((s) => !s || /^https?:\/\/[^\s]+$/u.test(s), '出处链接须以https://或http://开头'),
})
export type CustomQuoteInput = z.input<typeof inputSchema>
const settingsSchema = z
  .object({
    soundEnabled: z.boolean(),
    volume: z.number().finite().min(0).max(1),
    partnerSounds: z.boolean(),
    dueSound: z.boolean(),
    motion: z.enum(['system', 'on', 'off']),
    quoteCategory: z.string().max(200).nullable(),
  })
  .strict()
export class ExperienceService {
  constructor(readonly database: StudyDatabase = db) {}
  saveSettings(current: ExperienceSettings, input: z.input<typeof settingsSchema>) {
    return exclusive(async () => {
      const result = settingsSchema.safeParse(input)
      if (!result.success) throw new Error('声音或动画设置无效，请检查后重试')
      await this.database.transaction('rw', this.database.experienceSettings, async () => {
        const actual = await this.database.experienceSettings.get('experience')
        if (!actual || actual.revision !== current.revision)
          throw new Error('设置已更新，请重新打开后重试')
        await this.database.experienceSettings.put({
          ...actual,
          ...result.data,
          updatedAt: new Date().toISOString(),
          revision: actual.revision + 1,
        })
      })
    })
  }
  favorite(id: string, active: boolean) {
    return exclusive(async () => {
      const d = this.database
      await d.transaction('rw', [d.quotes, d.quoteFavorites], async () => {
        if (!(await d.quotes.get(id))) throw new Error('语句不存在')
        const old = await d.quoteFavorites.get(id)
        if (old?.active === active) return
        const now = new Date().toISOString()
        await d.quoteFavorites.put({
          id,
          active,
          createdAt: old?.createdAt ?? now,
          updatedAt: now,
          revision: (old?.revision ?? 0) + 1,
        })
      })
    })
  }
  saveCustom(input: CustomQuoteInput, id: string, revision?: number) {
    return exclusive(async () => {
      const result = inputSchema.safeParse(input)
      if (!result.success) throw new Error(result.error.issues[0].message)
      const d = this.database
      await d.transaction('rw', [d.quotes, d.quoteDetails], async () => {
        const old = await d.quoteDetails.get(id)
        if (
          revision === undefined
            ? !!old
            : !old || old.origin !== 'user' || old.revision !== revision
        )
          throw new Error('语句已更新或不是自定义语句，请重新打开后重试')
        if (!old && !id.startsWith('user-')) throw new Error('自定义语句标识无效')
        const { text, category, ...source } = result.data,
          now = new Date().toISOString()
        await d.quotes.put({ id, text, category })
        await d.quoteDetails.put({
          id,
          ...source,
          kind: 'encouragement',
          origin: 'user',
          archivedAt: old?.archivedAt ?? null,
          createdAt: old?.createdAt ?? now,
          updatedAt: now,
          revision: (old?.revision ?? 0) + 1,
        })
      })
    })
  }
  archive(current: QuoteDetail, archived: boolean) {
    return exclusive(async () => {
      const d = this.database
      await d.transaction('rw', d.quoteDetails, async () => {
        const actual = await d.quoteDetails.get(current.id)
        if (!actual || actual.revision !== current.revision)
          throw new Error('语句已更新，请刷新后重试')
        if (
          archived &&
          (await d.quoteDetails.toArray()).filter((row) => row.archivedAt === null).length <= 1
        )
          throw new Error('请至少保留一条可用语句')
        const now = new Date().toISOString()
        await d.quoteDetails.put({
          ...actual,
          archivedAt: archived ? now : null,
          updatedAt: now,
          revision: actual.revision + 1,
        })
      })
    })
  }
}
export const experience = new ExperienceService()
