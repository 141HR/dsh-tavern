// The background task pipeline (docs/design/background-task-pipeline.md).
//
// Settlement items: work that rides on the main settlement's single model call. Tavern's own
// items (dialogue annotation) come first, then the plugins' tools and notes. Tool definitions
// sit in the background session's cached prefix and never change; which may be called this
// turn is stated in the per-turn task text.

const PLUGIN_HEADER = '【插件附加的结算任务】'

function pluginText(names, notes) {
  if (!notes.length && !names.available.length && !names.unavailable.length) return ''
  return [PLUGIN_HEADER,
    ...(names.available.length ? ['本轮可用插件工具：' + names.available.join('、') + '。以本轮列出的为准：之前回合里这些工具被关闭或报错的情况已不再适用。需要时在提交本轮结算之前调用；插件工具失败不影响本轮结算。'] : []),
    ...(names.unavailable.length ? ['本轮不可用的插件工具（玩家在本局关闭了对应插件）：' + names.unavailable.join('、') + '。本轮不要调用。'] : []),
    ...notes.map(note => note.text)].join('\n\n')
}

/**
 * @param {object} input
 * @param {() => Array} input.items Tavern's own items: { tools(), has(name), section(context), call(name, args, context), wanted?() }
 * @param {() => object|null} input.plugins the plugin layer's settlement seam (plugin-api.js `settlement`)
 */
export function createSettlementItems({ items = () => [], plugins = () => null } = {}) {
  const own = () => (items() || []).filter(Boolean)

  return Object.freeze({
    /** Every item's tools, in the fixed order of the cached prefix. */
    tools() { return [...own().flatMap(item => item.tools()), ...(plugins()?.tools() || [])] },
    has(name) { return own().some(item => item.has(name)) || Boolean(plugins()?.has(name)) },
    /** Whether an item needs the settlement to run although posture and variables are off. */
    async wanted() {
      for (const item of own()) if (typeof item.wanted === 'function' && await item.wanted()) return true
      return false
    },
    /** One settlement run's dispatcher; plugin tools are refused once the run has submitted. */
    calls(context, { stopped = () => false } = {}) {
      const group = plugins()
      const pluginCall = group ? group.calls(context) : null
      return async function call(name, args) {
        const item = own().find(entry => entry.has(name))
        if (item) return item.call(name, args, context)
        if (!pluginCall || !group.has(name)) return undefined
        if (stopped()) return JSON.stringify({ ok: false, retryable: false, message: '当前任务已经提交完成，请结束本轮。插件工具请在提交结算之前调用。' })
        return pluginCall(name, args)
      }
    },
    /** This turn's notes: each Tavern item, then the plugins' tools and notes. */
    async text(context) {
      const group = plugins()
      const notes = group ? await group.sections(context) : []
      const parts = []
      for (const item of own()) parts.push(await item.section(context).catch(() => ''))
      const names = group ? await group.toolNames(context) : { available: [], unavailable: [] }
      parts.push(pluginText(names, notes))
      return parts.filter(Boolean).join('\n\n')
    }
  })
}
