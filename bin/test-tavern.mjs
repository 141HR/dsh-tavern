import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { findDshCommand, SOURCE_ROOT } from './launcher-environment.mjs'
import { resolveDshBootModule } from './plugin-dependencies.mjs'

function bootModule() {
  if (process.env.DSH_BOOT_MODULE) return path.resolve(process.env.DSH_BOOT_MODULE)
  const dsh = findDshCommand()
  return resolveDshBootModule({ dsh })
}

let boot
try {
  boot = bootModule()
} catch (error) {
  console.error('无法运行真实 DSH 集成测试：' + error.message)
  console.error('请先安装 DSH，或通过 DSH_BOOT_MODULE 指向 dsh-app-boot/lib/index.js。')
  process.exit(1)
}

// --fast：单进程跑完无浏览器、无子进程依赖的用例（--test-isolation=none），
// 排除清单见 tests/fast-exclude.txt。省掉每个文件一次的进程启动，日常验证从分钟级降到秒级。
function loadFastExcluded() {
  const excluded = new Set()
  try {
    const raw = readFileSync(path.join(SOURCE_ROOT, 'tests', 'fast-exclude.txt'), 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const name = line.replace(/#.*$/, '').trim()
      if (!name) continue
      excluded.add(name)
    }
  } catch { /* 清单缺失时按空清单处理 */ }
  return excluded
}

const args = process.argv.slice(2)
const fast = args.includes('--fast')
const selected = args.filter(arg => arg !== '--fast').map(file => path.resolve(file))
const tests = selected.length ? selected : ['tests', 'testsets/tests'].flatMap(directory =>
  readdirSync(path.join(SOURCE_ROOT, directory))
    .filter(name => name.endsWith('.test.mjs'))
    .sort()
    .map(name => path.join(SOURCE_ROOT, directory, name)))
let runTests = tests
if (fast) {
  const fastExcluded = loadFastExcluded()
  runTests = tests.filter(file => {
    const relative = path.relative(SOURCE_ROOT, file).replaceAll(path.sep, '/')
    return !fastExcluded.has(relative) && !fastExcluded.has(path.basename(file))
  })
}
const nodeArgs = ['--import', path.join(SOURCE_ROOT, 'tests/fixtures/host-session-patch-preload.mjs'), '--test']
if (fast) nodeArgs.push('--test-isolation=none')
const result = spawnSync(process.execPath, [...nodeArgs, ...runTests], {
  cwd: SOURCE_ROOT,
  env: { ...process.env, DSH_BOOT_MODULE: boot },
  stdio: 'inherit',
})
if (result.error) throw result.error
process.exit(result.status ?? 1)
