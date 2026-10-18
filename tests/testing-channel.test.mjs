import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const encoded = encodeURIComponent('0.2.1版本')
test('test installers and update checks use the same branch for every download transport', () => {
  for (const file of ['install.sh', 'install.ps1', 'tavern-plugin/lib/application-updater.js', 'bin/launcher-environment.mjs']) {
    const source = readFileSync(new URL(file, root), 'utf8')
    assert.ok(source.includes('/commits/' + encoded), file)
    assert.doesNotMatch(source, /\/commits\/main|@main\/dsh-tavern-runtime\.json|refs\/heads\/main|dsh-tavern\/main\/package\.json/, file)
    if (file.startsWith('install.')) {
      assert.ok(source.includes('refs/heads/' + encoded), file)
      assert.ok(source.includes('@' + encoded + '/dsh-tavern-runtime.json'), file)
      assert.match(source, /--branch[\s\S]{0,5}["']0\.2\.1版本["']/)
      assert.match(source, /origin["']?[, ]+["']0\.2\.1版本["']/)
    }
  }
})
test('public test installer rejects unsupported hosts before touching an installation', { skip: process.platform === 'win32' }, () => {
  for (const host of ['cli', 'android']) {
    const result = spawnSync('sh', [new URL('install.sh', root).pathname], { encoding: 'utf8', env: { ...process.env, DSH_TAVERN_HOST: host } })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /测试版仅支持官方 DeepSeek Harness Desktop/)
  }
})
test('Windows 双击安装文件与 README 的桌面版命令一致：CRLF、% 已转义', () => {
  const cmd = readFileSync(new URL('dsh-tavern-testing-install.cmd', root), 'utf8')
  assert.ok(cmd.split('\n').slice(0, -1).every(line => line.endsWith('\r')), '每行须以 CRLF 结尾')
  const line = cmd.split('\r\n').find(text => text.startsWith('powershell '))
  assert.doesNotMatch(line.replaceAll('%%', ''), /%/, '单个 % 会被 cmd 当作变量展开')
  const command = /-Command "(.*)"$/.exec(line)[1].replaceAll('%%', '%')
  const readme = readFileSync(new URL('README-0.2.1-rc.2.md', root), 'utf8')
  assert.ok(readme.includes(command), 'README 中找不到同一条桌面版命令')
  assert.ok(readme.includes('dsh-tavern-testing-install.cmd'), 'README 须给出下载链接')
})
