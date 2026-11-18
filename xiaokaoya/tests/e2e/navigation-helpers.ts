import { expect, type Page } from '@playwright/test'

// Historical compiled fixtures used dialogs; the current app uses page regions.
export function workspacePanel(page: Page, title: string) {
  return page
    .getByRole('region', { name: title, exact: true })
    .or(page.getByRole('dialog', { name: title, exact: true }))
}

export async function returnToOverview(page: Page) {
  const close = page.getByRole('button', { name: '关闭窗口', exact: true })
  if (await close.isVisible()) await close.click()
  await page.getByRole('button', { name: '学习总览', exact: true }).click()
  await expect(page.getByRole('heading', { name: '今天，也向前一小步。' })).toBeVisible()
}
