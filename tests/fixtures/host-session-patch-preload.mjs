// Native Session tests need the same host surface relaxation Tavern installs
// at runtime: assistant/message replacements may cite shadowed nodes. Without it,
// real Session.append rejects Tavern rollback/edit tombstones.
// The dedicated installer test verifies unpatched rejection itself, so skip there.
// Follows the runtime gate (pinned file bytes, not the version label), so a host
// release with identical session files is patched here exactly as in production.
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { prepareExpandedPatch, unpinnedSessionFile } from '../../tavern-plugin/lib/domain/host-session-patch.js'

const APPLIED = Symbol.for('dsh-tavern.host-session-patch-preload.v1')

if (!globalThis[APPLIED] && !process.argv.some(arg => arg.endsWith('/host-session-patch.test.mjs'))) {
  let runtimeRoot
  let hostRequire
  if (process.env.DSH_BOOT_MODULE) {
    const anchor = new URL('../../dsh-session/package.json', pathToFileURL(process.env.DSH_BOOT_MODULE))
    hostRequire = createRequire(anchor)
    runtimeRoot = new URL('../../../', anchor).pathname
  } else {
    const pluginRequire = createRequire(new URL('../../tavern-plugin/package.json', import.meta.url))
    hostRequire = createRequire(pluginRequire.resolve('@deepseek-ai/dsh-tools'))
    const sessionPath = hostRequire.resolve('@deepseek-ai/dsh-session')
    runtimeRoot = sessionPath.split(/[/\\]node_modules[/\\]/)[0]
  }
  if (!unpinnedSessionFile(hostRequire)) {
    await prepareExpandedPatch(runtimeRoot)
    globalThis[APPLIED] = true
  }
}
