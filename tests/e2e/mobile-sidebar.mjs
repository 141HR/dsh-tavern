import assert from 'node:assert/strict'
import { join } from 'node:path'

// On phone-width layouts, opening a game must not pop the right column over the story (#213).
export async function mobileSidebarChecks({ page, step, output, report }) {
  await step('手机宽度下进入游戏不自动打开右侧栏，可手动打开', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByText('你获得了十枚金币。', { exact: false }).filter({ visible: true }).first().waitFor()
    await page.waitForTimeout(1500)
    const status = page.getByText('后台结算已完成', { exact: true }).filter({ visible: true })
    await page.screenshot({ path: join(output, 'mobile-open.png') })
    assert.equal(await status.count(), 0, '右侧栏不应自动展开')
    await page.getByRole('button', { name: '酒馆状态', exact: true }).filter({ visible: true }).first().click()
    await status.first().waitFor()
    await page.screenshot({ path: join(output, 'mobile-status.png') })
    // Touch targets grow without growing the visuals (#215): the tab's × stays level with its title.
    const layout = await page.evaluate(() => {
      const close = document.querySelector('[data-dockkit-tab-close]')
      const tab = close?.closest('[data-dockkit-tab]')
      const box = el => el.getBoundingClientRect()
      const title = tab?.querySelector('[data-dockkit-tab-title]')
      return close && title ? { close: box(close), title: box(title) } : null
    })
    assert.ok(layout, '侧栏标签应有关闭按钮')
    const middle = rect => rect.top + rect.height / 2
    assert.ok(Math.abs(middle(layout.close) - middle(layout.title)) <= 2, '关闭按钮应与标签标题对齐')
    report.mobileSidebar = true
  })
}
