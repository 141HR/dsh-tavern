import test from 'node:test'
import assert from 'node:assert/strict'

import { classifyHostVersion } from '../tavern-plugin/lib/domain/host-compatibility.js'

const policy = { adaptedDshVersion: '0.2.1-rc.2', verifiedDshVersions: ['0.2.1-rc.2'], minDshVersion: '0.2.0', blockedDshVersions: {} }

test('运行时按闸门分级：已验证不提示，未验证与读取失败提示但不拦，过低版本标为不可用', () => {
  assert.equal(classifyHostVersion('0.2.1-rc.2', policy).status, 'verified')
  assert.equal(classifyHostVersion('0.2.1-rc.2', policy).message, '')
  for (const version of ['0.2.0', '0.3.0', '']) {
    const result = classifyHostVersion(version, policy)
    assert.equal(result.status, 'untested', version)
    assert.match(result.message, /可能无法使用/)
  }
  assert.equal(classifyHostVersion('0.1.5-rc.2', policy).status, 'blocked')
  assert.deepEqual(classifyHostVersion('0.2.0', policy).verifiedVersions, ['0.2.1-rc.2'])
})
