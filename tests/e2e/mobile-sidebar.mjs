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
  // The right column used to close the left drawer as a side effect; with it staying shut,
  // starting a game from the drawer must close the drawer itself.
  await step('手机宽度下从左侧栏开局后，左侧栏自动收起', async () => {
    const picker = page.getByRole('button', { name: /选择人物卡.*新开游玩/ }).filter({ visible: true })
    await page.locator('[data-dockkit-tab-close]').filter({ visible: true }).first().click()
    await page.waitForTimeout(500)
    await page.locator('[data-mobile-nav="toggle"]').filter({ visible: true }).first().click()
    await picker.first().waitFor()
    await page.screenshot({ path: join(output, 'mobile-drawer.png') })
    await picker.first().click()
    await page.getByText('E2E 奖励验收', { exact: true }).filter({ visible: true }).first().click()
    await page.getByRole('button', { name: '开始新游戏', exact: true }).click()
    await page.getByRole('textbox', { name: /发消息|Message/ }).filter({ visible: true }).first().waitFor()
    await page.waitForTimeout(1000)
    await page.screenshot({ path: join(output, 'mobile-started.png') })
    assert.equal(await picker.count(), 0, '开局后左侧栏应收起')
  })
}
