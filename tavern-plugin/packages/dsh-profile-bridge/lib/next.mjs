// DSH NEXT (from 2.0.19) selects its Profile in <DSH_HOME>/desktop-next.json and refuses to start
// when the selected profiles/<name> is a link ("Next profile path must be a real directory"). So on
// NEXT a switch writes that selection instead of replacing profiles/desktop with a link. The official
// app keeps the link: both apps may share one DSH_HOME, and each then follows its own mechanism.
import { closeSync, existsSync, openSync, readFileSync, readSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

const NEXT_PACKAGE = 'dsh-desktop-next'
const DEFAULT_PROFILE = 'desktop'

/**
 * Whether an app executable (or macOS .app bundle) is DSH NEXT with native Profile selection.
 * @param {string | undefined} exe - the desktop app binary, or its .app bundle on macOS.
 * @returns {boolean} true for DSH NEXT 2.0.19+.
 */
export function isDesktopNext(exe) {
  if (typeof exe !== 'string' || exe === '') return false
  const bundle = /^(.*?\.app)(?:\/|$)/u.exec(exe)?.[1]
  const resources = bundle !== undefined ? join(bundle, 'Contents', 'Resources') : join(dirname(exe), 'resources')
  // The macOS build keeps a bare package.json beside app.asar; the Windows build has only the archive.
  try { return JSON.parse(readFileSync(join(resources, 'app', 'package.json'), 'utf8')).name === NEXT_PACKAGE } catch {}
  try { return JSON.parse(asarFile(join(resources, 'app.asar'), 'package.json')).name === NEXT_PACKAGE } catch { return false }
}

// One file out of an asar archive with plain fs (only Electron's fs opens archives): an 8-byte size
// pickle, then a header pickle whose JSON lists each file's offset from the end of the header.
function asarFile(archive, name) {
  const fd = openSync(archive, 'r')
  try {
    const sizes = Buffer.alloc(16)
    readSync(fd, sizes, 0, 16, 0)
    const json = Buffer.alloc(sizes.readUInt32LE(12))
    readSync(fd, json, 0, json.length, 16)
    const entry = JSON.parse(json.toString('utf8')).files[name]
    const data = Buffer.alloc(entry.size)
    readSync(fd, data, 0, entry.size, 8 + sizes.readUInt32LE(4) + Number(entry.offset))
    return data.toString('utf8')
  } finally { closeSync(fd) }
}

function selectionFile(home) { return join(resolve(home), 'desktop-next.json') }

/**
 * Whether this DSH home is run by DSH NEXT. Finding the app binary is best effort (the host may
 * not see it), so NEXT's own selection file also counts: once it exists, a linked
 * profiles/desktop would send NEXT into recovery mode, so the home is never switched by link.
 * @param {string} home - DSH_HOME.
 * @param {string | undefined} exe - the desktop app binary, when known.
 * @returns {boolean} true when profiles are selected by NEXT itself.
 */
export function usesDesktopNext(home, exe) {
  return isDesktopNext(exe) || (typeof home === 'string' && home !== '' && existsSync(selectionFile(home)))
}

/**
 * The Profile DSH NEXT starts with.
 * @param {string} home - DSH_HOME.
 * @returns {string} the selected profile name ("desktop" when nothing was chosen yet).
 */
export function readNextProfile(home) {
  try {
    const active = JSON.parse(readFileSync(selectionFile(home), 'utf8')).active
    return typeof active === 'string' && active !== '' ? active : DEFAULT_PROFILE
  } catch { return DEFAULT_PROFILE }
}

/**
 * Select the Profile DSH NEXT starts with, in the format NEXT itself writes.
 * @param {string} home - DSH_HOME.
 * @param {string} name - a plain directory name under profiles/.
 */
export function selectNextProfile(home, name) {
  if (typeof name !== 'string' || name === '' || basename(name) !== name) throw new Error('Profile 名称无效：' + name)
  const file = selectionFile(home)
  const staged = file + '.' + process.pid + '.tmp'
  writeFileSync(staged, JSON.stringify({ version: 1, active: name }, null, 2) + '\n', { mode: 0o600 })
  renameSync(staged, file)
}
