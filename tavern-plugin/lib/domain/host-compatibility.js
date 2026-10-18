import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Gate, not pin: verified versions pass silently, known-broken or too-old versions
// are blocked, everything else is "untested" — allowed with a warning, so users can
// follow upstream DSH before we have verified each release.
const CORE = /^(\d+)\.(\d+)\.(\d+)/

function coreBelow(version, floor) {
  const a = CORE.exec(version), b = CORE.exec(floor)
  if (!a || !b) return false
  for (let i = 1; i <= 3; i++) if (Number(a[i]) !== Number(b[i])) return Number(a[i]) < Number(b[i])
  return false
}

export function classifyDshVersion(version, policy) {
  const verified = policy.verifiedDshVersions || [policy.adaptedDshVersion]
  const blocked = policy.blockedDshVersions || {}
  const base = { version: version || '', verifiedVersions: verified, minVersion: policy.minDshVersion || '' }
  if (version && verified.includes(version)) return { ...base, status: 'verified', reason: '' }
  if (version && Object.hasOwn(blocked, version)) return { ...base, status: 'blocked', reason: String(blocked[version]) }
  if (version && policy.minDshVersion && coreBelow(version, policy.minDshVersion)) {
    return { ...base, status: 'blocked', reason: `低于最低支持版本 ${policy.minDshVersion}` }
  }
  return { ...base, status: 'untested', reason: version ? '' : '无法识别当前 DSH 版本' }
}

export function classifyHostVersion(version, policy) {
  const result = classifyDshVersion(version, policy)
  const verified = result.verifiedVersions.join('、')
  const message = result.status === 'verified' ? ''
    : result.status === 'blocked' ? `当前 DSH 版本不可用（${result.reason}）。请改用已验证版本 ${verified}。`
    : `${result.reason || '当前 DSH 版本尚未验证'}；重新生成、回退等功能可能无法使用，遇到问题请反馈。已验证版本：${verified}。`
  return Object.freeze({ ...result, packageName: '@deepseek-ai/dsh-session', message })
}

// Resolve from the actual host dependency, not PATH or another installed CLI.
// Called once during plugin startup; the returned immutable value is reused.
export function readHostCompatibility({ resolveHost, read = readFileSync } = {}) {
  const policy = JSON.parse(read(new URL('../../../config/dsh-compatibility.json', import.meta.url), 'utf8'))
  let version = ''
  try {
    const resolve = resolveHost || (() => {
      const plugin = createRequire(new URL('../../package.json', import.meta.url))
      return createRequire(plugin.resolve('@deepseek-ai/dsh-tools')).resolve('@deepseek-ai/dsh-session')
    })
    let dir = dirname(resolve())
    for (let i = 0; i < 6; i++) {
      try {
        const pkg = JSON.parse(read(join(dir, 'package.json'), 'utf8'))
        if (pkg.name === '@deepseek-ai/dsh-session') { version = String(pkg.version || ''); break }
      } catch { /* Entry points may be nested below the package root. */ }
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  } catch { /* Unknown must not prevent starting the user's game. */ }
  return classifyHostVersion(version, policy)
}
