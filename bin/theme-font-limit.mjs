import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { adaptedDshVersion } from './dsh-compatibility.mjs'

// Fixed DSH 0.2.0-rc.2 only. Keep its existing setting, persistence and rendering.
//
// 0.2.0-rc.2 适配：0.1.5 的字号域是 12..17，0.2.0 改成 10..22（下限 12→10，上限 17→22，
// 并给「减小」按钮补了 `disabled: fontSize <= 10`）。Tavern 的目标上限仍是 32px，
// 所以这里只把上限（和承载它的 schema / 校验 / 按钮 disabled 分支）抬到 32，下限保持 10。
// 每条 from 必须在目标文件里恰好出现一次（见下方守卫）：index.js 有两处同形 schema，
// 用 `[FONT_SIZE_FIELD]:` / `fontSize: …volatile()` 两段完整上下文分别定位。
const replacements = {
  'index.js': [
    ['const FONT_SIZE_MAX = 22;', 'const FONT_SIZE_MAX = 32;'],
    ['[FONT_SIZE_FIELD]: z.number().step(1).min(10).max(22).default(14)', '[FONT_SIZE_FIELD]: z.number().step(1).min(10).max(32).default(14)'],
    ['fontSize: z.number().step(1).min(10).max(22).default(14).volatile()', 'fontSize: z.number().step(1).min(10).max(32).default(14).volatile()'],
  ],
  'client.js': [
    ['[FONT_SIZE_FIELD]: Schema.number().step(1).min(10).max(22).default(14)', '[FONT_SIZE_FIELD]: Schema.number().step(1).min(10).max(32).default(14)'],
    ['disabled: fontSize >= 22,', 'disabled: fontSize >= 32,'],
    ['px > 22) throw new Error(`font size ${px} is outside 10..22`)', 'px > 32) throw new Error(`font size ${px} is outside 10..32`)'],
    ['parsed >= 10 && parsed <= 22 ? parsed : 14', 'parsed >= 10 && parsed <= 32 ? parsed : 14'],
  ],
}

export function patchThemeFontLimit(directory) {
  const manifest = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'))
  // 0.2.0-rc.2 适配：版本闸跟随 config/dsh-compatibility.json 的 adaptedDshVersion，
  // 不再写死 0.1.5-rc.2——写死会让 0.2.0 宿主抛错，被 profile-installation.mjs:305-308
  // 捕获后 rollback 整个安装。
  if (manifest.name !== '@deepseek-ai/dsh-client-ui-theme' || manifest.version !== adaptedDshVersion) {
    throw new Error(`字号补丁仅适用于 dsh-client-ui-theme ${adaptedDshVersion}`)
  }
  // Validate every anchor before writing; repeated installation is a no-op.
  const changes = Object.entries(replacements).map(([name, pairs]) => {
    const file = path.join(directory, 'lib', name)
    const before = readFileSync(file, 'utf8')
    let after = before
    for (const [from, to] of pairs) {
      if (after.split(from).length === 2 && !after.includes(to)) after = after.replace(from, to)
      else if (after.includes(from) || after.split(to).length !== 2) throw new Error(`字号补丁不匹配：${name}；未修改文件`)
    }
    return { file, before, after }
  }).filter(change => change.before !== change.after)
  const written = []
  try {
    for (const change of changes) {
      written.push(change)
      writeFileSync(change.file, change.after)
    }
  } catch (error) {
    for (const change of written.reverse()) writeFileSync(change.file, change.before)
    throw error
  }
  return changes.length > 0
}
