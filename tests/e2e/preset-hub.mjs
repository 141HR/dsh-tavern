import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// The 预设 tab: pick the preset, system prompt set and preference in one place,
// export the checked ones as one file and import it back as new entries.
export async function presetHubChecks({ page, step, output, report }) {
  const call = (method, args = {}) => page.evaluate(async ([method, args]) => {
    const value = await (await fetch('/api/dsh-tavern/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) })).json()
    if (value.ok === false) throw new Error(value.error)
    return value
  }, [method, args])
  const hub = page.locator('.dsh-tavern-preset-hub').filter({ visible: true })
  async function openHub() {
    if (!await hub.count()) {
      await page.getByRole('button', { name: /^(新建标签页|New tab)$/ }).filter({ visible: true }).first().click()
      await page.locator('.dsh-tavern-start-card').filter({ hasText: /^预设$/ }).filter({ visible: true }).first().click()
    }
    await hub.waitFor()
  }
  async function confirmDialog() {
    const dialog = page.getByRole('dialog', { name: '确认操作' })
    await dialog.waitFor()
    await dialog.getByRole('button', { name: '确认', exact: true }).click()
  }
  await step('预设标签页取代系统提示词和长期偏好两个标签页', async () => {
    await page.getByRole('button', { name: /^(新建标签页|New tab)$/ }).filter({ visible: true }).first().click()
    const start = page.locator('.dsh-tavern-start').filter({ visible: true })
    await start.waitFor()
    const labels = await start.locator('.dsh-tavern-start-card').allInnerTexts()
    assert.ok(labels.includes('预设'), '开始页应有“预设”')
    assert.ok(!labels.includes('系统提示词') && !labels.includes('长期偏好') && !labels.includes('预设库'), '旧标签页不再单独出现：' + labels.join('、'))
    await start.locator('.dsh-tavern-start-card').filter({ hasText: /^预设$/ }).first().click()
    await hub.waitFor()
    for (const name of ['预设', '系统提示词', '长期偏好']) await hub.getByRole('region', { name, exact: true }).waitFor()
    await page.screenshot({ path: join(output, 'preset-hub.png'), fullPage: true })
  })
  await step('在预设页选择三项，导出成一个文件', async () => {
    await call('manageSystemPromptSet', { action: 'create', name: '快节奏' })
    await call('updateSystemPrompt', { name: 'story', text: 'E2E_FAST_STORY' })
    await call('manageUserPreferenceProfile', { action: 'create', name: '验收偏好', content: 'E2E 偏好正文' })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await openHub()
    await hub.getByRole('combobox', { name: '新游戏默认预设' }).selectOption('presets/E2E-A.json')
    await hub.getByRole('status').filter({ hasText: '新游戏默认预设已更新' }).waitFor()
    const profiles = hub.getByRole('combobox', { name: '新游戏默认长期偏好' })
    await profiles.selectOption({ label: '验收偏好' })
    await hub.getByRole('status').filter({ hasText: '新游戏默认长期偏好已更新' }).waitFor()
    assert.equal(await hub.getByRole('combobox', { name: '系统提示词方案' }).locator('option:checked').innerText(), '快节奏')
    const [download] = await Promise.all([page.waitForEvent('download'), hub.getByRole('button', { name: '导出勾选项' }).click()])
    const file = join(output, download.suggestedFilename())
    await download.saveAs(file)
    const bundle = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(bundle.spec, 'dsh-tavern.bundle')
    assert.match(bundle.preset.text, /E2E_PRESET_A_ACTIVE/)
    assert.equal(bundle.systemPrompts.name, '快节奏')
    assert.equal(bundle.systemPrompts.prompts.story, 'E2E_FAST_STORY')
    assert.equal(bundle.userProfile.injectionText, 'E2E 偏好正文')
    report.presetHubExport = { file: download.suggestedFilename(), parts: Object.keys(bundle).filter(key => ['preset', 'systemPrompts', 'userProfile'].includes(key)) }
  })
  await step('导入同一个文件：三项都作为新方案加入并设为使用中，不覆盖原有内容', async () => {
    const file = join(output, report.presetHubExport.file)
    await hub.locator('input[type=file]').setInputFiles(file)
    await confirmDialog()
    await hub.getByRole('status').filter({ hasText: '已导入' }).waitFor()
    const presets = await call('listPresets')
    assert.equal(presets.activePresetPath, 'presets/E2E-A (2).json')
    assert.ok(presets.presets.some(item => item.path === 'presets/E2E-A.json'), '原预设保留')
    const prompts = (await call('getSystemPrompts')).systemPrompts
    assert.deepEqual(prompts.promptSets.sets.map(set => set.name), ['默认方案', '快节奏', '快节奏 (2)'])
    assert.equal(prompts.promptSets.sets.find(set => set.active).name, '快节奏 (2)')
    const profile = (await call('getUserPreferenceProfile')).userProfile
    const imported = profile.profiles.find(item => item.name === '验收偏好 (2)')
    assert.ok(imported, '长期偏好作为新条目加入')
    assert.equal(profile.defaultProfileId, imported.id)
    assert.equal(await hub.getByRole('combobox', { name: '系统提示词方案' }).locator('option:checked').innerText(), '快节奏 (2)')
    await page.screenshot({ path: join(output, 'preset-hub-imported.png'), fullPage: true })
  })
  await step('详情可进入原有编辑页并返回', async () => {
    await hub.getByRole('region', { name: '系统提示词', exact: true }).getByRole('button', { name: '详情 ›' }).click()
    const detail = page.locator('.dsh-tavern-preset-hub-detail').filter({ visible: true })
    await detail.getByRole('combobox', { name: '系统提示词方案' }).waitFor()
    await detail.getByRole('button', { name: '← 返回预设' }).click()
    await hub.waitFor()
  })
}
