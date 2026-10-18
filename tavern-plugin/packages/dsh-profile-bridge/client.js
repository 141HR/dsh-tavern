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
      title: '配置档案桥接',
      subtitle: '让桌面版直接使用你已经装好插件的 profile，而不是它自带的空 profile。',
      current: '当前使用',
      linkedTo: '链接到',
      independent: '独立目录（未链接）',
      loading: '读取中…',
      refresh: '刷新',
      profiles: '可选的 profile',
      name: '名称',
      deps: '依赖',
      bundles: 'bundle',
      modules: 'node_modules',
      active: '使用中',
      linked: '已链接',
      standalone: '独立',
      use: '使用它',
      revert: '还原为独立 profile',
      working: '执行中…',
      closing: '切换已排队：请在两分钟内正常退出桌面版。退出后完成切换，再手动打开应用。超时会取消，原配置保持不变。',
      cliHint: '当前 Harness 不是桌面版（probe 到的是普通 profile）。命令行用户直接用 dsh --profile <名称> 即可，不需要本页的链接。',
      noTargets: '没有别的 profile 可切换。',
      warnings: '提示',
      failure: '失败',
      log: '上次操作日志',
      logEmpty: '（还没有日志）',
      why: '桌面版把 profile 目录写死为 <DSH_HOME>/profiles/desktop，所以它看不到你其他 profile 里的插件。本页通过目录链接（Windows 用 junction，macOS/Linux 用符号链接）把两者接起来，原目录会先备份，随时可还原。',
      mustClose: '注意：切换必须先关闭桌面版才能改目录。请正常退出应用，助手等待退出后才会切换；不会强制结束进程。完成后请重新打开桌面版。',
      how: '工作原理',
    }
    const en = {
      section: 'Profiles',
      title: 'Profile bridge',
      subtitle: 'Make the Desktop app use the profile that already has your plugins instead of its own empty one.',
      current: 'Currently using',
      linkedTo: 'linked to',
      independent: 'standalone directory (not linked)',
      loading: 'Loading…',
      refresh: 'Refresh',
      profiles: 'Available profiles',
      name: 'Name',
      deps: 'deps',
      bundles: 'bundles',
      modules: 'node_modules',
      active: 'in use',
      linked: 'Linked',
      standalone: 'Standalone',
      use: 'Use this one',
      revert: 'Revert to a standalone profile',
      working: 'Working…',
      closing: 'Switch queued. Quit Desktop normally within two minutes; the helper switches after it exits. Then reopen Desktop. A timeout cancels without changing the profile.',
      cliHint: 'This Harness is not the Desktop app, so it already runs the profile you asked for. Command-line users can just pass dsh --profile <name>; the link below is unnecessary.',
      noTargets: 'There is no other profile to switch to.',
      warnings: 'Warnings',
      failure: 'Failed',
      log: 'Last operation log',
      logEmpty: '(no log yet)',
      why: 'The Desktop app hardcodes its profile directory to <DSH_HOME>/profiles/desktop, so plugins installed in your other profiles are invisible to it. This page links the two (a junction on Windows, a symlink elsewhere); the previous directory is backed up first and can be restored at any time.',
      mustClose: 'Note: the app has to be closed to move its profile directory. Quit the app normally within two minutes. The helper waits for it to exit without forcing it to close; reopen it yourself after the switch.',
      how: 'How it works',
    }

    /** Scoped stylesheet; class names are prefixed so they never leak into the host. */
    const CSS = `
.pb { display: grid; gap: 18px; font-size: 13px; line-height: 1.6; color: inherit; max-width: 720px;
  --pb-accent: #4d6bfe; --pb-accent-soft: rgba(77,107,254,0.08); --pb-line: rgba(127,127,127,0.22);
  --pb-fill: rgba(127,127,127,0.06); --pb-ok: #30a46c; --pb-ok-soft: rgba(48,164,108,0.12); }
.pb * { box-sizing: border-box; }
.pb-head { display: grid; gap: 4px; }
.pb-title { margin: 0; font-size: 16px; font-weight: 600; }
.pb-sub { margin: 0; opacity: 0.65; }
.pb-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.pb-muted { opacity: 0.6; }
.pb-label { font-size: 12px; font-weight: 500; opacity: 0.6; letter-spacing: 0.02em; }
.pb-current { display: grid; gap: 6px; padding: 14px 16px; border-radius: 12px; background: var(--pb-fill); border: 1px solid var(--pb-line); }
.pb-current-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.pb-current-name { display: flex; align-items: baseline; gap: 10px; font-size: 18px; font-weight: 600; flex-wrap: wrap; }
.pb-arrow { font-weight: 400; opacity: 0.4; }
.pb-path { font-size: 12px; opacity: 0.55; word-break: break-all; }
.pb-badge { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 500; padding: 1px 9px; border-radius: 999px; background: var(--pb-fill); white-space: nowrap; }
.pb-badge-ok { background: var(--pb-ok-soft); color: var(--pb-ok); }
.pb-badge-ok::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.pb-badge-accent { background: var(--pb-accent-soft); color: var(--pb-accent); }
.pb-list { display: grid; gap: 8px; }
.pb-option { position: relative; display: grid; grid-template-columns: auto 1fr; gap: 12px; align-items: start; padding: 12px 14px; border-radius: 12px; border: 1px solid var(--pb-line); cursor: pointer; transition: border-color .15s, background .15s; }
.pb-option:hover { border-color: rgba(127,127,127,0.45); }
.pb-option.is-selected { border-color: var(--pb-accent); background: var(--pb-accent-soft); }
.pb-option input { position: absolute; opacity: 0; pointer-events: none; }
.pb-dot { width: 16px; height: 16px; margin-top: 3px; border-radius: 50%; border: 1.5px solid rgba(127,127,127,0.55); display: grid; place-items: center; transition: border-color .15s; }
.pb-option.is-selected .pb-dot { border-color: var(--pb-accent); }
.pb-option.is-selected .pb-dot::after { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--pb-accent); }
.pb-option:focus-within { outline: 2px solid var(--pb-accent-soft); outline-offset: 2px; }
.pb-option-body { display: grid; gap: 4px; min-width: 0; }
.pb-option-name { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; flex-wrap: wrap; }
.pb-stats { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 2px; }
.pb-stat { font-size: 12px; padding: 0 8px; border-radius: 6px; background: var(--pb-fill); opacity: 0.85; }
.pb-stat-bad { color: #e5484d; }
.pb-empty { padding: 14px; border-radius: 12px; border: 1px dashed var(--pb-line); text-align: center; opacity: 0.6; }
.pb-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.pb-spacer { flex: 1; }
.pb-btn { appearance: none; font: inherit; font-size: 13px; color: inherit; background: transparent; border: 1px solid rgba(127,127,127,0.35); border-radius: 8px; padding: 6px 14px; cursor: pointer; transition: background .15s, opacity .15s; }
.pb-btn:hover:not(:disabled) { background: var(--pb-fill); }
.pb-btn:disabled { opacity: 0.4; cursor: default; }
.pb-btn-primary { background: var(--pb-accent); border-color: transparent; color: #fff; }
.pb-btn-primary:hover:not(:disabled) { background: #3d5bf0; }
.pb-btn-quiet { border-color: transparent; opacity: 0.65; padding: 6px 8px; }
.pb-btn-quiet:hover:not(:disabled) { opacity: 1; }
.pb-note { margin: 0; padding: 10px 12px; border-radius: 10px; background: var(--pb-accent-soft); }
.pb-note-warn { background: rgba(245,166,35,0.12); display: grid; gap: 2px; }
.pb-error { margin: 0; padding: 10px 12px; border-radius: 10px; color: #e5484d; background: rgba(229,72,77,0.08); }
.pb-folds { display: grid; gap: 2px; border-top: 1px solid var(--pb-line); padding-top: 8px; }
.pb-fold summary { list-style: none; cursor: pointer; padding: 6px 0; opacity: 0.65; display: flex; align-items: center; gap: 6px; user-select: none; }
.pb-fold summary::-webkit-details-marker { display: none; }
.pb-fold summary::before { content: '›'; display: inline-block; width: 10px; transition: transform .15s; }
.pb-fold[open] summary::before { transform: rotate(90deg); }
.pb-fold summary:hover { opacity: 1; }
.pb-fold p { margin: 4px 0 8px 16px; opacity: 0.65; }
.pb-pre { margin: 4px 0 8px; padding: 10px 12px; border-radius: 8px; background: var(--pb-fill); max-height: 220px; overflow: auto; font-size: 12px; white-space: pre-wrap; }
`

    /** Describe one RPC failure for display. */
    function describeFailure(error) {
      if (error === undefined || error === null) return 'unknown error'
      const code = typeof error.code === 'string' ? error.code : 'error'
      const message = typeof error.message === 'string' ? error.message : String(error)
      return `${code}: ${message}`
    }

    /** The first profile a user could switch to. */
    function firstCandidate(status) {
      const others = (status?.profiles ?? []).filter((entry) => entry.name !== status.activeName)
      const profile = others.find((entry) => entry.name !== status.linkTargetName) ?? others[0]
      return profile === undefined ? '' : profile.name
    }

    /**
     * One settings page: current profile, the profiles tree, and the two actions.
     * @param {{ t: Function, rpcCall: Function }} props - injected faces from the registration.
     */
    function ProfileBridgeSettings(props) {
      const t = props.t
      const call = props.rpcCall
      const [status, setStatus] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [failure, setFailure] = React.useState(null)
      const [receipt, setReceipt] = React.useState(null)
      const [busy, setBusy] = React.useState('')
      const [selected, setSelected] = React.useState('')

      const load = React.useCallback(async () => {
        setLoading(true)
        setFailure(null)
        try {
          const result = await call('status', {})
          if (result?.ok === true) {
            setStatus(result.value)
            setSelected((current) => (current !== '' ? current : firstCandidate(result.value)))
          } else {
            setFailure(describeFailure(result?.error))
          }
        } catch (error) {
          setFailure(describeFailure({ code: 'transport', message: error?.message ?? String(error) }))
        } finally {
          setLoading(false)
        }
      }, [call])

      React.useEffect(() => {
        void load()
      }, [load])

      const run = React.useCallback(async (endpoint, payload) => {
        setBusy(endpoint)
        setFailure(null)
        try {
          const result = await call(endpoint, payload)
          if (result?.ok === true) setReceipt({ endpoint, value: result.value })
          else setFailure(describeFailure(result?.error))
        } catch (error) {
          setFailure(describeFailure({ code: 'transport', message: error?.message ?? String(error) }))
        } finally {
          setBusy('')
        }
      }, [call])

      const isDesktop = status?.appKind === 'desktop'
      const candidates = (status?.profiles ?? []).filter((profile) => profile.name !== status?.activeName)

      const linked = status?.activeIsLink === true
      const inUse = (name) => linked && name === status?.linkTargetName
      const canUse = busy === '' && selected !== '' && isDesktop && !inUse(selected)

      return h('section', { className: 'pb' },
        h('style', null, CSS),
        h('header', { className: 'pb-head' },
          h('h2', { className: 'pb-title' }, t('title')),
          h('p', { className: 'pb-sub' }, t('subtitle')),
        ),

        h('div', { className: 'pb-current' },
          h('div', { className: 'pb-current-top' },
            h('span', { className: 'pb-label' }, t('current')),
            status === null
              ? null
              : h('span', { className: linked ? 'pb-badge pb-badge-ok' : 'pb-badge' }, linked ? t('linked') : t('standalone')),
          ),
          h('div', { className: 'pb-current-name' },
            h('span', { className: 'pb-mono' }, status?.activeName ?? '—'),
            linked ? h('span', { className: 'pb-arrow' }, '→') : null,
            linked ? h('span', { className: 'pb-mono' }, status?.linkTargetName ?? '?') : null,
          ),
          h('div', { className: 'pb-path pb-mono' }, status?.activeDir ?? (loading ? t('loading') : '')),
          isDesktop || status === null ? null : h('p', { className: 'pb-note', style: { marginTop: '4px' } }, t('cliHint')),
        ),

        h('div', { className: 'pb-list' },
          h('span', { className: 'pb-label' }, t('profiles')),
          candidates.length === 0
            ? h('div', { className: 'pb-empty' }, t('noTargets'))
            : candidates.map((profile) => h('label', {
                key: profile.name,
                className: selected === profile.name ? 'pb-option is-selected' : 'pb-option',
              },
                h('input', {
                  type: 'radio',
                  name: 'profile-bridge-target',
                  checked: selected === profile.name,
                  onChange: () => setSelected(profile.name),
                  'aria-label': profile.name,
                }),
                h('span', { className: 'pb-dot' }),
                h('span', { className: 'pb-option-body' },
                  h('span', { className: 'pb-option-name' },
                    h('span', { className: 'pb-mono' }, profile.name),
                    profile.isLink ? h('span', { className: 'pb-muted pb-mono' }, `→ ${profile.linkTargetName}`) : null,
                    inUse(profile.name) ? h('span', { className: 'pb-badge pb-badge-accent' }, t('active')) : null,
                  ),
                  h('span', { className: 'pb-path pb-mono' }, profile.dir),
                  h('span', { className: 'pb-stats' },
                    h('span', { className: 'pb-stat' }, `${t('deps')} ${profile.dependencyCount}`),
                    h('span', { className: 'pb-stat' }, `${t('bundles')} ${profile.bundleCount}`),
                    h('span', { className: profile.hasNodeModules ? 'pb-stat' : 'pb-stat pb-stat-bad' },
                      `${t('modules')} ${profile.hasNodeModules ? '✓' : '✗'}`),
                  ),
                ),
              )),
        ),

        h('div', { className: 'pb-actions' },
          h('button', {
            type: 'button',
            className: 'pb-btn pb-btn-primary',
            disabled: !canUse,
            onClick: () => void run('link', { target: selected }),
          }, busy === 'link' ? t('working') : t('use')),
          h('button', {
            type: 'button',
            className: 'pb-btn',
            disabled: busy !== '' || !linked,
            onClick: () => void run('unlink', {}),
          }, busy === 'unlink' ? t('working') : t('revert')),
          h('span', { className: 'pb-spacer' }),
          h('button', { type: 'button', className: 'pb-btn pb-btn-quiet', disabled: busy !== '' || loading, onClick: () => void load() },
            loading ? t('loading') : `↻ ${t('refresh')}`),
        ),

        receipt?.value?.warnings?.length > 0
          ? h('div', { className: 'pb-note pb-note-warn' },
              h('strong', null, t('warnings')),
              receipt.value.warnings.map((warning) => h('div', { key: warning }, `• ${warning}`)),
            )
          : null,

        receipt !== null ? h('p', { className: 'pb-note' }, t('closing')) : null,

        failure !== null ? h('p', { className: 'pb-error' }, `${t('failure')}: ${failure}`) : null,

        h('div', { className: 'pb-folds' },
          h('details', { className: 'pb-fold' },
            h('summary', null, t('log')),
            // The structured log is empty when the helper never reached its first
            // line (for example a PowerShell startup failure); the launcher
            // transcript is where that shows up.
            h('pre', { className: 'pb-pre pb-mono' },
              status?.logTail?.trim()
                ? status.logTail
                : status?.transcriptTail?.trim() ? status.transcriptTail : t('logEmpty')),
          ),
          h('details', { className: 'pb-fold' },
            h('summary', null, t('how')),
            h('p', null, t('why')),
            h('p', null, t('mustClose')),
          ),
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
