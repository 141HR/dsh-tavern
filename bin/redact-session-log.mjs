#!/usr/bin/env node
// Export a session log's structure for an upgrade bug report, without the story:
//   node bin/redact-session-log.mjs <session.v3.jsonl.zstd> > session-structure.jsonl
// Story text, reasoning, tool arguments, prompts and paths are replaced by their length; event
// types, seqs, times, turn/step, surface operations, references, ids, roles and sources are kept,
// because those are what a migration validates. The output runs through the upgrader as is.
import { readFile } from 'node:fs/promises'
import { parseSessionLog } from '../tavern-plugin/lib/domain/session-log-codec.js'

// Fields that carry the story, prompts or personal paths. Everything else (enums, ids, seqs,
// turn/step, surface operations) stays, so the redacted log still runs through the upgrader.
const TEXT = new Set(['text', 'rendered', 'fixedSystemText', 'newText', 'oldText', 'description', 'system', 'persona',
  'title', 'texts', 'error', 'message', 'path', 'args', 'label', 'disabledWritingSkills'])

export function redact(value, key = '') {
  if (typeof value === 'string') {
    if (key === 'arguments') return JSON.stringify({ redacted: value.length })
    if (key === 'cwd') return '/redacted'
    return TEXT.has(key) ? `«${value.length} chars»` : value
  }
  if (Array.isArray(value)) return value.map(item => redact(item, key))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redact(item, name)]))
  return value
}

const file = process.argv[2]
if (!file) {
  console.error('用法：node bin/redact-session-log.mjs <session.v3.jsonl.zstd 或 session.jsonl> > session-structure.jsonl')
  process.exit(1)
}
const parsed = parseSessionLog(await readFile(file))
process.stdout.write(JSON.stringify(redact(parsed.header)) + '\n')
for (const event of parsed.events) process.stdout.write(JSON.stringify(redact(event)) + '\n')
