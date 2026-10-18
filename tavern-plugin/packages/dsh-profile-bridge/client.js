/**
 * dsh-profile-bridge — browser half.
 *
 * Adds one settings page that shows which profile this Harness is running, which
 * other profiles exist, and switches the app's profile directory to the one you
 * pick (or reverts that switch). All file work happens in the Host half.
 */
window.__ModuleLoader__.load({
  id: 'dsh-profile-bridge',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Shared RPC channel owned by this plugin's Host half. */
    const CHANNEL = '/profile-bridge'
    /** Locale namespace of this page. */
    const NS = 'profileBridge'

    const zh = {
      section: '配置档案',
      title: '配置档案',
      subtitle: '选择桌面版要使用的 profile。',
      original: '原版桌面配置',
      originalHint: '桌面版自带的 profile',
      current: '使用中',
      switch: '切换',
      working: '切换中…',
      loading: '读取中…',
      noModules: '缺少 node_modules',
      closing: '已准备切换到「{0}」。请在两分钟内正常退出桌面版，退出后自动切换，再重新打开即可。超时会自动取消。',
      cliHint: '当前不是桌面版。命令行用户直接用 dsh --profile <名称> 切换即可。',
      noTargets: '没有可切换的 profile。',
      failure: '切换失败',
      more: '说明与日志',
      logEmpty: '（还没有日志）',
      why: '桌面版固定使用 profiles/desktop。切换时会把它链接到你选的 profile（Windows 用 junction，macOS/Linux 用符号链接），原版配置先备份，随时可以切回。切换必须先正常退出桌面版，不会强制结束进程。',
    }
    const en = {
      section: 'Profiles',
      title: 'Profiles',
      subtitle: 'Choose the profile the Desktop app uses.',
      original: 'Original Desktop profile',
      originalHint: 'The profile Desktop ships with',
      current: 'In use',
      switch: 'Switch',
      working: 'Switching…',
      loading: 'Loading…',
      noModules: 'node_modules missing',
      closing: 'Ready to switch to "{0}". Quit Desktop normally within two minutes; it switches after exit, then reopen it. A timeout cancels the switch.',
      cliHint: 'This is not the Desktop app. Command-line users can switch with dsh --profile <name>.',
      noTargets: 'There is no profile to switch to.',
      failure: 'Switch failed',
      more: 'Details and log',
      logEmpty: '(no log yet)',
      why: 'Desktop always runs profiles/desktop. Switching links it to the profile you pick (a junction on Windows, a symlink elsewhere); the original profile is backed up first and you can switch back any time. Desktop must be quit normally first; it is never force-closed.',
    }

    /** Scoped stylesheet; class names are prefixed so they never leak into the host. */
    const CSS = `
.pb { display: grid; gap: 16px; font-size: 13px; line-height: 1.6; color: inherit; max-width: 640px;
  --pb-accent: #4d6bfe; --pb-accent-soft: rgba(77,107,254,0.08); --pb-line: rgba(127,127,127,0.22); --pb-fill: rgba(127,127,127,0.06); }
.pb-head { display: grid; gap: 2px; }
.pb-title { margin: 0; font-size: 16px; font-weight: 600; }
.pb-sub { margin: 0; opacity: 0.6; }
.pb-list { border: 1px solid var(--pb-line); border-radius: 12px; overflow: hidden; }
.pb-row { display: flex; align-items: center; gap: 12px; padding: 12px 16px; }
.pb-row + .pb-row { border-top: 1px solid var(--pb-line); }
.pb-row.is-current { background: var(--pb-accent-soft); }
.pb-info { flex: 1; min-width: 0; display: grid; }
.pb-name { font-size: 14px; font-weight: 500; }
.pb-hint { font-size: 12px; opacity: 0.5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pb-bad { color: #e5484d; opacity: 1; }
.pb-tag { font-size: 12px; font-weight: 500; color: var(--pb-accent); white-space: nowrap; }
.pb-tag::before { content: '✓ '; }
.pb-btn { appearance: none; font: inherit; font-size: 13px; color: inherit; background: transparent; border: 1px solid rgba(127,127,127,0.35); border-radius: 8px; padding: 4px 14px; cursor: pointer; white-space: nowrap; }
.pb-btn:hover:not(:disabled) { border-color: var(--pb-accent); color: var(--pb-accent); }
.pb-btn:disabled { opacity: 0.4; cursor: default; }
.pb-empty { padding: 16px; text-align: center; opacity: 0.6; }
.pb-note { margin: 0; padding: 10px 12px; border-radius: 10px; background: var(--pb-accent-soft); }
.pb-error { margin: 0; padding: 10px 12px; border-radius: 10px; color: #e5484d; background: rgba(229,72,77,0.08); }
.pb-fold summary { list-style: none; cursor: pointer; opacity: 0.55; font-size: 12px; user-select: none; }
.pb-fold summary::-webkit-details-marker { display: none; }
.pb-fold summary::before { content: '›'; display: inline-block; width: 12px; transition: transform .15s; }
.pb-fold[open] summary::before { transform: rotate(90deg); }
.pb-fold summary:hover { opacity: 1; }
.pb-fold p { margin: 6px 0; opacity: 0.6; font-size: 12px; }
.pb-pre { margin: 0; padding: 10px 12px; border-radius: 8px; background: var(--pb-fill); max-height: 200px; overflow: auto; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; }
`

    /** Describe one RPC failure for display. */
    function describeFailure(error) {
      if (error === undefined || error === null) return 'unknown error'
      const code = typeof error.code === 'string' ? error.code : 'error'
      const message = typeof error.message === 'string' ? error.message : String(error)
      return `${code}: ${message}`
    }

    /** Key of the row for Desktop's own (unlinked) profile. */
    const ORIGINAL = ''

    /**
     * One settings page: a single list of profiles, the one in use marked, every
     * other one switchable. Desktop's own profile is a row like any other; picking
     * it reverts the link.
     * @param {{ t: Function, rpcCall: Function }} props - injected faces from the registration.
     */
    function ProfileBridgeSettings(props) {
      const t = props.t
      const call = props.rpcCall
      const [status, setStatus] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [failure, setFailure] = React.useState(null)
      const [queued, setQueued] = React.useState(null)
      const [busy, setBusy] = React.useState(null)

      const load = React.useCallback(async () => {
        setLoading(true)
        try {
          const result = await call('status', {})
          if (result?.ok === true) setStatus(result.value)
          else setFailure(describeFailure(result?.error))
        } catch (error) {
          setFailure(describeFailure({ code: 'transport', message: error?.message ?? String(error) }))
        } finally {
          setLoading(false)
        }
      }, [call])

      React.useEffect(() => {
        void load()
      }, [load])

      const switchTo = React.useCallback(async (row) => {
        setBusy(row.key)
        setFailure(null)
        try {
          const result = row.key === ORIGINAL
            ? await call('unlink', {})
            : await call('link', { target: row.key })
          if (result?.ok === true) setQueued({ label: row.label, warnings: result.value?.warnings ?? [] })
          else setFailure(describeFailure(result?.error))
        } catch (error) {
          setFailure(describeFailure({ code: 'transport', message: error?.message ?? String(error) }))
        } finally {
          setBusy(null)
        }
      }, [call])

      const isDesktop = status?.appKind === 'desktop'
      const linked = status?.activeIsLink === true
      const currentKey = linked ? status?.linkTargetName : ORIGINAL
      // Desktop's own profile can only be returned to when its backup still exists.
      const canRevert = !linked || (status?.backups ?? []).length > 0
      const rows = status === null ? [] : [
        ...(canRevert ? [{ key: ORIGINAL, label: t('original'), hint: t('originalHint') }] : []),
        ...(status.profiles ?? [])
          // Only profiles that also carry this page: from any other the app has no way back.
          .filter((profile) => profile.name !== status.activeName && profile.hasBridge)
          .map((profile) => ({
            key: profile.name,
            label: profile.name,
            hint: profile.dir,
            bad: profile.hasNodeModules ? null : t('noModules'),
          })),
      ]

      return h('section', { className: 'pb' },
        h('style', null, CSS),
        h('header', { className: 'pb-head' },
          h('h2', { className: 'pb-title' }, t('title')),
          h('p', { className: 'pb-sub' }, isDesktop || status === null ? t('subtitle') : t('cliHint')),
        ),

        status !== null && !isDesktop ? null : h('div', { className: 'pb-list' },
          status === null
            ? h('div', { className: 'pb-empty' }, loading ? t('loading') : t('noTargets'))
            : rows.length <= 1 && rows.every((row) => row.key === currentKey)
              ? h('div', { className: 'pb-empty' }, t('noTargets'))
              : rows.map((row) => {
                  const isCurrent = row.key === currentKey
                  return h('div', { key: row.key || '(original)', className: isCurrent ? 'pb-row is-current' : 'pb-row' },
                    h('div', { className: 'pb-info' },
                      h('span', { className: 'pb-name' }, row.label),
                      h('span', { className: row.bad ? 'pb-hint pb-bad' : 'pb-hint', title: row.hint }, row.bad ?? row.hint),
                    ),
                    isCurrent
                      ? h('span', { className: 'pb-tag' }, t('current'))
                      : h('button', {
                          type: 'button',
                          className: 'pb-btn',
                          disabled: !isDesktop || busy !== null || queued !== null,
                          onClick: () => void switchTo(row),
                        }, busy === row.key ? t('working') : t('switch')),
                  )
                }),
        ),

        queued !== null
          ? h('p', { className: 'pb-note' },
              t('closing').replace('{0}', queued.label),
              ...queued.warnings.map((warning) => h('span', { key: warning, style: { display: 'block', opacity: 0.75 } }, `• ${warning}`)),
            )
          : null,

        failure !== null ? h('p', { className: 'pb-error' }, `${t('failure')}: ${failure}`) : null,

        h('details', { className: 'pb-fold' },
          h('summary', null, t('more')),
          h('p', null, t('why')),
          // The structured log is empty when the helper never reached its first
          // line (for example a PowerShell startup failure); the launcher
          // transcript is where that shows up.
          h('pre', { className: 'pb-pre' },
            status?.logTail?.trim()
              ? status.logTail
              : status?.transcriptTail?.trim() ? status.transcriptTail : t('logEmpty')),
        ),
      )
    }

    return {
      inject: ['slots', 'locale', 'connection'],
      apply(ctx) {
        const t = ctx.locale.bind(NS)
        const rpcCall = (endpoint, payload) => ctx.connection.rpc.call(CHANNEL, endpoint, payload)
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'profile-bridge: locale dictionaries')
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'profile-bridge',
          order: 60,
          label: () => t('section'),
          inject: () => ({ rpcCall, t }),
        }, ProfileBridgeSettings))
      },
    }
  },
})
