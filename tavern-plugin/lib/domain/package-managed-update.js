import { readFile } from 'node:fs/promises'
import path from 'node:path'

// Updates a Tavern that DSH's plugin manager installed (Desktop「添加插件」or
// `dsh plugin add`). pnpm owns that copy, so the installer-based updater must not
// touch it; instead this re-adds the package through the host's own pluginManager,
// which runs Desktop's pnpm under the Profile lock, and asks for a DSH restart.
// runPnpm/change/registries are the manager's internals, not a published API:
// when they are missing, `available()` is false and the caller falls back to the
// terminal instructions.
const PACKAGE = 'dsh-profile-tavern'
// pnpm 11 skips versions younger than minimumReleaseAge (one day by default): an update
// to a release published today would fail, and a bare install falls back to an older
// release. The player asked for this exact Tavern version, so exempt only this package;
// its dependencies keep the supply-chain delay.
const RELEASE_AGE_EXCLUDE = '--config.minimumReleaseAgeExclude=' + PACKAGE
const GIT_SPEC = /^(github:|gitlab:|bitbucket:|git\+|git:|git@|https?:\/\/.+\.git(#.*)?$)/i

export function packageUpdateSpec(recorded) {
  const value = String(recorded || '').trim()
  if (!value) return null
  if (GIT_SPEC.test(value)) return { kind: 'git', spec: value }
  // Local checkouts and tarballs are a developer's; there is nothing newer to fetch.
  if (/^(file:|link:|workspace:|portal:|\.|\/|~)/.test(value) || /^[a-z]:[\\/]/i.test(value) || /^https?:/i.test(value)) return null
  return { kind: 'registry', spec: PACKAGE }
}

export function compareVersions(left, right) {
  const parts = value => String(value || '').split('-')[0].split('.').map(part => Number.parseInt(part, 10) || 0)
  const a = parts(left), b = parts(right)
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) < (b[index] || 0) ? -1 : 1
  }
  return 0
}

// Mirror first: most players are in mainland China, where it is the registry that
// answers; pnpm's own configured registry (null) follows as the fallback.
function registryPlan(configured) {
  const plan = []
  for (const registry of [...(configured?.fallbackRegistries || []), configured?.registry]) {
    const value = registry === null || registry === undefined ? null : String(registry)
    if (!plan.includes(value)) plan.push(value)
  }
  return plan.length ? plan : [null]
}

const registryUrl = (registry, resolved) => {
  const base = registry ?? resolved ?? 'https://registry.npmjs.org/'
  return base.endsWith('/') ? base : base + '/'
}

function failureText(run) {
  const output = String(run?.output || '').trim().split('\n').filter(Boolean).slice(-6).join('\n')
  if (run?.incompatible) return '新版本声明不兼容当前 DSH，已保留现有版本。'
  if (run?.timedOut) return 'pnpm 长时间没有输出，已停止。请检查网络后重试。'
  return output || 'pnpm 安装失败'
}

export function createPackageManagedUpdater(options) {
  const pluginManager = typeof options.pluginManager === 'function' ? options.pluginManager : () => options.pluginManager
  const currentVersion = options.currentVersion
  const fetchImpl = options.fetch || fetch
  const now = options.now || Date.now
  let state = null
  let running = null

  function manager() {
    const service = pluginManager()
    return service && typeof service.runPnpm === 'function' && typeof service.change === 'function' && service.profile?.dir ? service : null
  }

  async function installation() {
    const service = manager()
    if (!service) return null
    try {
      const manifest = JSON.parse(await readFile(path.join(service.profile.dir, 'package.json'), 'utf8'))
      if (!manifest.dsh?.profile?.bundles?.includes(PACKAGE)) return null
      const update = packageUpdateSpec(manifest.dependencies?.[PACKAGE])
      return update ? { service, ...update } : null
    } catch (error) {
      if (error?.code === 'ENOENT') return null
      throw error
    }
  }

  async function base(target) {
    return { packageManaged: true, host: options.host, currentVersion: await currentVersion(), installKind: target.kind }
  }

  async function status() {
    const target = await installation()
    if (!target) return null
    return { ...await base(target), phase: 'idle', ...state }
  }

  async function check() {
    const target = await installation()
    if (!target) return null
    if (running) return await status()
    const current = await base(target)
    if (target.kind === 'git') {
      // A git install has no published version to compare; re-adding fetches the newest commit.
      state = { phase: 'update-available', checkedAt: now(), checkWarning: '从 GitHub 安装，更新会拉取最新提交' }
      return { ...current, ...state }
    }
    const configured = await target.service.registries()
    // Ask every registry and keep the highest answer: a lagging mirror must not hide a release.
    const answers = await Promise.all(registryPlan(configured).map(async registry => {
      const url = registryUrl(registry, configured?.resolved) + PACKAGE + '/latest'
      try {
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } })
        if (!response.ok) throw new Error('HTTP ' + response.status)
        const version = String((await response.json())?.version || '')
        if (!version) throw new Error('没有版本号')
        return { version }
      } catch (error) {
        return { error: new URL(url).host + '：' + (error?.message || error) }
      }
    }))
    const versions = answers.filter(answer => answer.version).map(answer => answer.version).sort(compareVersions)
    if (versions.length) {
      const latestVersion = versions[versions.length - 1]
      const newer = compareVersions(current.currentVersion, latestVersion) < 0
      state = { phase: newer ? 'update-available' : 'up-to-date', checkedAt: now(), latestVersion }
      return { ...current, ...state }
    }
    const errors = answers.map(answer => answer.error)
    state = { phase: 'check-failed', checkedAt: now(), error: '无法检查更新：' + errors.join('；') }
    return { ...current, ...state }
  }

  async function start() {
    const target = await installation()
    if (!target) return null
    if (running) throw new Error('更新正在进行，请勿重复启动')
    const { service } = target
    let spec = target.spec
    if (target.kind === 'registry') {
      // Install the exact version the check found: `@latest` on a lagging mirror would
      // quietly downgrade. A mirror without that version fails and the next registry runs.
      const checked = await check()
      if (checked.phase !== 'update-available') return checked
      spec = PACKAGE + '@' + checked.latestVersion
    }
    state = { phase: 'running', startedAt: now(), stage: '正在用 DSH 的 pnpm 安装 ' + spec }
    running = (async () => {
      const result = await service.change(async () => {
        const configured = target.kind === 'registry' ? await service.registries() : null
        let run
        for (const registry of target.kind === 'registry' ? registryPlan(configured) : [null]) {
          run = await service.runPnpm(['add', spec, RELEASE_AGE_EXCLUDE, ...(registry === null ? [] : ['--registry=' + registry])])
          if (run.incompatible || (run.exitCode === 0 && run.timedOut !== true)) break
        }
        if (run.incompatible || run.exitCode !== 0 || run.timedOut === true) throw new Error(failureText(run))
        // Never hot-reload Tavern from under its own request: the new code loads on restart.
        return 'restart-required'
      }, { stage: 'install', target: spec }, 'install')
      if (result?.application === 'restart-required') state = { phase: 'restart-required', completedAt: now() }
      else state = { phase: 'failed', failedAt: now(), error: '更新失败：' + (result?.error?.message || result?.error || result?.application || '未知原因') }
    })().catch(error => {
      state = { phase: 'failed', failedAt: now(), error: '更新失败：' + (error?.message || error) }
    }).finally(() => { running = null })
    return { ...await base(target), ...state }
  }

  return { status, check, start, available: async () => (await installation()) !== null }
}
