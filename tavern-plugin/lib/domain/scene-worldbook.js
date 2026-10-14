import { createHash } from 'node:crypto'
import { projectAgentContent } from './runtime-content-projection.js'
import { isMvuUpdateEntry } from './worldbook-recall.js'

const hash = value => createHash('sha256').update(value).digest('hex')
const digest = value => hash(JSON.stringify(value))
const validRef = value => value?.version === 1 && /^[a-f0-9]{64}$/.test(value.digest)
const snapshotPath = value => 'scene-images/worldbooks/' + value + '.json'
// Entries are stored once each: a turn's snapshot only lists them. Most entries
// repeat verbatim every turn; a large worldbook otherwise costs ~1 MB per turn.
const entryPath = value => 'scene-images/worldbook-entries/' + value + '.json'
const maxCharacters = 500000
const maxEntries = 2000

/** Freeze auxiliary setting data before a body is generated. This does not
 * activate entries or add them to the foreground prompt. Equal books share one file. */
export function createSceneWorldbooks({ store }) {
  async function capture({ worldBook, chat, card }) {
    if (!worldBook?.view || !Array.isArray(worldBook.view.entries)) return null
    const entries = [], omitted = []
    let remaining = maxCharacters, omittedCount = 0
    function omit(entry) { omittedCount++; if (omitted.length < 20) omitted.push(String(entry.ref || '').slice(0, 200)) }
    for (const entry of worldBook.view.entries) {
      if (!entry || entry.enabled === false || isMvuUpdateEntry(entry) || typeof entry.content !== 'string' || !entry.content.trim()) continue
      if (entries.length >= maxEntries || entry.content.length > remaining) { omit(entry); continue }
      const text = projectAgentContent(entry.content, { macroState: chat?.macroState, charName: card?.name }).agentText
      if (!text.trim()) continue
      const title = String(entry.title || entry.comment || '').slice(0, 200)
      const keys = (Array.isArray(entry.primaryKeys) ? entry.primaryKeys : []).filter(key => typeof key === 'string' && key.length <= 100 && !key.startsWith('/')).slice(0, 20)
      const ref = String(entry.ref || entries.length).slice(0, 200)
      const secondary = Array.isArray(entry.secondaryKeys) ? entry.secondaryKeys : []
      const conditions = entry.selective === true && secondary.length ? {
        unsupported: secondary.length > 20 || secondary.some(key => typeof key !== 'string' || key.length > 100 || key.startsWith('/')) || ![0, 1, 2, 3].includes(Number(entry.selectiveLogic) || 0),
        keys: secondary.length <= 20 ? secondary.filter(key => typeof key === 'string' && key.length <= 100 && !key.startsWith('/')) : [],
        logic: Number(entry.selectiveLogic) || 0, caseSensitive: entry.caseSensitive === true, wholeWords: entry.matchWholeWords === true
      } : null
      const size = text.length + title.length + ref.length + JSON.stringify(conditions).length + keys.reduce((sum, key) => sum + key.length, 0)
      if (size > remaining) { omit(entry); continue }
      entries.push({ ref, title, keys, text, constant: entry.constant === true, conditions })
      remaining -= size
    }
    // The digest always covers the complete (version 1) snapshot, whichever
    // layout stores it, so exported archives and old references stay valid.
    const value = { version: 1, entries, omitted, omittedCount }
    const id = digest(value)
    if (!await store.version(snapshotPath(id))) {
      const entryRefs = []
      for (const entry of entries) {
        const ref = digest(entry)
        if (!await store.version(entryPath(ref))) await store.writeJson(entryPath(ref), entry)
        entryRefs.push(ref)
      }
      await store.writeJson(snapshotPath(id), { version: 2, entryRefs, omitted, omittedCount })
    }
    return { version: 1, digest: id }
  }
  // The complete snapshot, materialized from either layout and verified.
  async function load(id) {
    const stored = await store.readJson(snapshotPath(id))
    if (!stored) return null
    if (stored.version !== 2) return stored
    if (!Array.isArray(stored.entryRefs)) return { invalid: true }
    const entries = []
    for (const ref of stored.entryRefs) {
      const entry = /^[a-f0-9]{64}$/.test(ref) ? await store.readJson(entryPath(ref)) : null
      if (!entry || digest(entry) !== ref) return { invalid: true }
      entries.push(entry)
    }
    return { version: 1, entries, omitted: stored.omitted, omittedCount: stored.omittedCount }
  }
  async function read(ref) {
    if (!validRef(ref)) return null
    const value = await load(ref.digest)
    if (!value) return { unavailable: '历史世界书快照缺失，未读取当前世界书。' }
    if (value.version !== 1 || !Array.isArray(value.entries) || digest(value) !== ref.digest) {
      return { unavailable: '历史世界书快照校验失败，未读取当前世界书。' }
    }
    return { ...value, digest: ref.digest }
  }
  // Self-contained bytes for a save package (always the version 1 layout).
  async function exportSnapshot(id) {
    if (!/^[a-f0-9]{64}$/.test(String(id || ''))) return null
    const value = await load(id)
    return value && value.version === 1 && digest(value) === id ? Buffer.from(JSON.stringify(value)) : null
  }
  return { capture, read, exportSnapshot }
}

/** Bind only the original bodies. An edited/new swipe must not inherit an
 * unrelated body's setting snapshot merely because it occupies the same slot. */
export function bindSceneWorldbook(message, ref) {
  if (!validRef(ref)) return message
  const bodies = Array.isArray(message.swipes) && message.swipes.length ? message.swipes
    : [message.sourceText ?? message.text ?? '']
  message.sceneWorldbook = { ...ref, bodyDigests: [...new Set(bodies.map(body => hash(String(body))))] }
  return message
}

export function sceneWorldbookBinding(chat, target) {
  const message = (chat.messages || []).find(item => item.role === 'assistant' && Number(item.turn || (item.greeting ? 1 : 0)) === target.turn)
  const ref = message?.sceneWorldbook
  return validRef(ref) && Array.isArray(ref.bodyDigests) && ref.bodyDigests.includes(target.sourceDigest)
    ? { version: ref.version, digest: ref.digest } : null
}
