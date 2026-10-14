import { retainedRevisions } from './conversation-retention.js'

const STATE_PATH = 'save-maintenance.json'

/**
 * Keeps saves small without touching anything play or story export reads:
 * old revisions nothing can reach any more, pre-migration journal files once
 * no kept revision predates the migration, and debugging logs (model request
 * bodies, worldbook recall audits) outside their recent windows. Runs only
 * while a game is idle: shortly after its settlement and once after startup.
 */
export function createSaveMaintenance({
  chats, listChatIds, requestLog, recallLog, isIdle, store, removeOrphans = async () => 0,
  keepRecent = 8, graceMs, delayMs = 2 * 60 * 1000, logger = console,
  schedule = setTimeout, cancel = clearTimeout
}) {
  let state = null
  let disposed = false
  const timers = new Map()
  let tail = Promise.resolve()

  async function load() {
    if (state) return state
    const value = await store.readJson(STATE_PATH).catch(() => undefined)
    state = value?.version === 1 ? value : { version: 1, scanned: false, forks: {}, compacted: {} }
    return state
  }
  async function save() { await store.writeJson(STATE_PATH, state) }
  // One maintenance pass at a time: they share the state file and the disk.
  function serial(task) {
    const next = tail.then(task, task)
    tail = next.catch(() => {})
    return next
  }

  function forkEntry(chat) {
    const from = chat?.forkedFrom
    if (!from) return null
    return { chatId: from.chatId || '', storageRevision: Number(from.storageRevision), stateChatId: from.stateChatId || '', stateRevision: Number(from.stateRevision) }
  }
  function forkRevisionsOf(chatId) {
    const revisions = []
    for (const from of Object.values(state.forks)) {
      if (from.chatId === chatId && Number.isSafeInteger(from.storageRevision)) revisions.push(from.storageRevision)
      if (from.stateChatId === chatId && Number.isSafeInteger(from.stateRevision)) revisions.push(from.stateRevision)
    }
    return revisions
  }
  async function scanForks() {
    // Saves created before this index existed: read each game's fork source once.
    for (const chatId of await listChatIds()) {
      if (disposed) return
      try {
        const head = await chats.readRetentionHeader(chatId) ?? await chats.read(chatId)
        const entry = forkEntry(head)
        if (entry) state.forks[chatId] = entry
      } catch (error) { logger.warn('dsh-tavern: 存档整理读取分叉来源失败', chatId, String(error?.message || error)) }
    }
    state.scanned = true
    await save()
  }

  async function maintainChat(chatId) {
    if (disposed) return { status: 'disposed' }
    await load()
    if (!(await isIdle(chatId))) return { status: 'busy' }
    const result = { status: 'done', requests: await requestLog.prune(chatId).catch(() => null), recalls: await recallLog.prune(chatId).catch(() => null) }
    const head = await chats.readRetentionHeader(chatId)
    if (!head) return { ...result, status: 'legacy-format' }
    if (head.regenInProgress) return { ...result, status: 'busy' }
    if (state.compacted[chatId] === head._storageRevision) return { ...result, status: 'unchanged' }
    const retain = await retainedRevisions(head, (id, revision) => chats.readRetentionHeader(id, revision), forkRevisionsOf(chatId))
    if (!(await isIdle(chatId))) return { ...result, status: 'busy' }
    result.compaction = await chats.compact(chatId, { retain: revision => retain.has(revision), keepRecent, graceMs })
    const legacyFrom = Number(head.legacyInitialRevision)
    const oldestKept = Math.min(head._storageRevision - keepRecent + 1, ...retain)
    if (Number.isSafeInteger(legacyFrom) && legacyFrom > 0 && oldestKept >= legacyFrom) {
      result.legacy = await chats.removeLegacyFiles(chatId)
    }
    state.compacted[chatId] = head._storageRevision
    await save()
    return result
  }

  async function sweep() {
    await load()
    if (!state.scanned) await scanForks()
    // Debugging logs of games that no longer exist.
    let freed = await removeOrphans(new Set(await listChatIds())).catch(error => { logger.warn('dsh-tavern: 清理已删除游戏的日志失败', String(error?.message || error)); return 0 })
    let chatsDone = 0
    for (const chatId of await listChatIds()) {
      if (disposed) break
      try {
        const result = await maintainChat(chatId)
        freed += (result.compaction?.bytes || 0) + (result.legacy?.bytes || 0)
        if (result.status === 'done') chatsDone++
      } catch (error) { logger.warn('dsh-tavern: 存档整理失败', chatId, String(error?.message || error)) }
    }
    if (freed > 0) logger.log('dsh-tavern: 存档整理完成', chatsDone, '局，释放约', Math.round(freed / 1048576), 'MB')
    return { freed, chats: chatsDone }
  }

  return Object.freeze({
    maintainChat: chatId => serial(() => maintainChat(chatId)),
    sweep: () => serial(sweep),
    // Debounced: a settlement often follows a rollback or another settlement.
    schedule(chatId) {
      if (disposed || !chatId) return
      cancel(timers.get(chatId))
      const timer = schedule(() => {
        timers.delete(chatId)
        void serial(() => maintainChat(chatId)).catch(error => logger.warn('dsh-tavern: 存档整理失败', chatId, String(error?.message || error)))
      }, delayMs)
      timer?.unref?.()
      timers.set(chatId, timer)
    },
    async recordFork(chat) {
      const entry = forkEntry(chat)
      if (!entry || !chat?.id) return
      await serial(async () => { await load(); state.forks[chat.id] = entry; await save() })
    },
    start() {
      const timer = schedule(() => { void serial(sweep).catch(error => logger.warn('dsh-tavern: 存档整理失败', String(error?.message || error))) }, delayMs)
      timer?.unref?.()
      timers.set('', timer)
    },
    dispose() { disposed = true; for (const timer of timers.values()) cancel(timer); timers.clear() }
  })
}
