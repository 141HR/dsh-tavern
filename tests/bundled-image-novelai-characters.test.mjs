import test from 'node:test'
import assert from 'node:assert/strict'
import { parseImagePlan, parsePromptsBlock, formatPromptsBlock, preserveCharacterMetadata } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/planner.js'
import { compileChannelJob, compileJob, expandRosterCalls } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/index.js'
import { generateImage } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/image-providers.js'
import { createMediaActions } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/media-actions.js'

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c40000000049454e44ae426082', 'hex')
const channel = (provider = 'novelai', extra = {}) => ({ id: 'test', provider, baseUrl: 'https://image.test', model: 'nai-diffusion-5-full', apiKey: 'test', options: {}, ...extra })
const config = { imageBackend: 'novelai', promptMode: 'tags', traitMode: 'default', weightMode: 'auto', sizes: {} }

test('规划解析兼容角色块位于 prompts 外，并保留合法旧 scene；混合内外角色不漏项', () => {
  const [outside] = parseImagePlan('<image><regex>x</regex><prompts>1girl, old scene</prompts><character_1><prompt>one</prompt><center>C3</center><negative>bad one</negative></character_1></image>')
  assert.equal(outside.prompts, '1girl, old scene')
  assert.deepEqual(outside.characters, [{ prompt: 'one', centers: 'C3', uc: 'bad one' }])

  const [mixed] = parseImagePlan('<image><regex>x</regex><prompts><scene_composition>café</scene_composition><character_1><prompt>one</prompt><uc>bad</uc></character_1></prompts><character_2><prompt>two</prompt><centers>D4</centers><uc>worse</uc></character_2></image>')
  assert.equal(mixed.prompts, 'café')
  assert.deepEqual(mixed.characters, [
    { prompt: 'one', centers: '', uc: 'bad' },
    { prompt: 'two', centers: 'D4', uc: 'worse' },
  ])
})

test('编辑文本角色块可往返，显式删除全部角色时只留下 scene', () => {
  const text = formatPromptsBlock('night street', [{ prompt: 'A', centers: 'C3', uc: 'bad A' }])
  assert.deepEqual(parsePromptsBlock(text), { scene: 'night street', characters: [{ prompt: 'A', centers: 'C3', uc: 'bad A' }] })
  assert.deepEqual(parsePromptsBlock('<scene_composition>night street</scene_composition>'), { scene: 'night street', characters: [] })
})

test('改写模型漏掉 centers、uc 或整个角色块时按角色位置恢复原 metadata', () => {
  const original = formatPromptsBlock('old scene', [
    { prompt: 'old A', centers: 'C3', uc: 'bad A' },
    { prompt: 'old B', centers: 'D4', uc: 'bad B' },
  ])
  const partial = '<scene_composition>new scene</scene_composition><character_1><prompt>new A</prompt></character_1>'
  const merged = parsePromptsBlock(preserveCharacterMetadata(original, partial))
  assert.equal(merged.scene, 'new scene')
  assert.deepEqual(merged.characters, [
    { prompt: 'new A', centers: 'C3', uc: 'bad A' },
    { prompt: 'old B', centers: 'D4', uc: 'bad B' },
  ])
  const sceneOnly = parsePromptsBlock(preserveCharacterMetadata(original, 'rewritten scene'))
  assert.equal(sceneOnly.scene, 'rewritten scene')
  assert.equal(sceneOnly.characters.length, 2)
})

test('未知角色宏在 char caption 保留服装和角度；非 NovelAI 平铺角色负面', () => {
  const macro = '${"name":"Lu Qi","outfit":"light green ruqun","angle":"from front"}$'
  const expanded = expandRosterCalls(macro, { characters: [] }, 'default')
  assert.match(expanded, /light green ruqun/)
  assert.match(expanded, /from front/)
  const params = { tag: 'café', rawTag: 'café', size: '832x1216', characters: [{ prompt: macro, centers: 'C3', uc: 'bad anatomy' }] }
  const nai = compileChannelJob({ params, config, definitions: { characters: [] }, channel: channel() })
  assert.match(nai.characters[0].prompt, /light green ruqun/)
  assert.match(nai.characters[0].prompt, /from front/)
  assert.equal(nai.characters[0].uc, 'bad anatomy')
  const flat = compileChannelJob({ params, config: { ...config, imageBackend: 'openai' }, definitions: { characters: [] }, channel: channel('openai') })
  assert.deepEqual(flat.characters, [])
  assert.match(flat.positive, /light green ruqun/)
  assert.match(flat.negative, /bad anatomy/)
})

test('Comfy 工作流把角色库特征与角色负面注入对应的工作流绑定', () => {
  const workflow = {
    prompt: { positive: { inputs: { text: '' } }, negative: { inputs: { text: '' } } },
    bindings: { positive: [{ node: 'positive', input: 'text' }], negative: [{ node: 'negative', input: 'text' }] },
    sizes: {},
  }
  const definitions = { characters: [{ id: 'a', name: '阿梅', match: 'A Mei', enabled: true, traits: { face: 'MEI FACE', negative: 'wrong eye color' }, outfits: [] }] }
  const params = { tag: 'café', rawTag: 'café', size: '832x1216', characters: [{ prompt: 'A Mei, smiling', centers: 'C3', uc: 'bad anatomy' }] }
  const compiled = compileJob({ workflow, params, config: { ...config, imageBackend: 'comfyui', weightMode: 'keep', negativeMode: 'merge' }, definitions })
  assert.match(compiled.prompt.positive.inputs.text, /café/)
  assert.match(compiled.prompt.positive.inputs.text, /MEI FACE/)
  assert.match(compiled.prompt.positive.inputs.text, /smiling/)
  assert.match(compiled.prompt.negative.inputs.text, /bad anatomy/)
  assert.match(compiled.prompt.negative.inputs.text, /wrong eye color/)
})

test('NovelAI V5 payload发送角色正负面和坐标；缺任一坐标则关闭 use_coords', async () => {
  let body
  const fetchImpl = async (_url, init) => { body = JSON.parse(init.body); return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } }) }
  await generateImage(channel(), { positive: 'café', negative: 'lowres', width: 832, height: 1216,
    characters: [{ prompt: 'one', centers: 'C3', uc: 'bad one' }, { prompt: 'two', centers: 'D4', uc: 'bad two' }] }, { fetchImpl })
  assert.equal(body.parameters.params_version, 4)
  assert.equal(body.parameters.v4_prompt.use_coords, true)
  assert.deepEqual(body.parameters.v4_prompt.caption.char_captions.map(item => item.centers), [[{ x: 0.5, y: 0.5 }], [{ x: 0.7, y: 0.7 }]])
  assert.deepEqual(body.parameters.v4_negative_prompt.caption.char_captions.map(item => item.char_caption), ['bad one', 'bad two'])
  await generateImage(channel(), { positive: 'café', width: 832, height: 1216, characters: [{ prompt: 'one', centers: 'C3', uc: 'bad' }, { prompt: 'two', centers: '', uc: 'worse' }] }, { fetchImpl })
  assert.equal(body.parameters.v4_prompt.use_coords, false)
  assert.equal(body.parameters.v4_negative_prompt.caption.char_captions[1].char_caption, 'worse')
})

test('Tavern media revise把分角色结构交给改写器并把角色数据交给替换作业', async t => {
  const promptText = '<scene_composition>old scene</scene_composition>\n<character_1>\n<prompt>old outfit</prompt>\n<centers>C3</centers>\n<uc>bad detail</uc>\n</character_1>'
  const item = { id: 'm', kind: 'dsh-tavern-image/image', turn: 2, textVersion: 'v', status: 'ready', attachment: {}, data: { jobId: 'j' } }
  const sourceJob = { id: 'j', state: 'done', params: { rawTag: 'old scene', characters: [{ prompt: 'old outfit', centers: 'C3', uc: 'bad detail' }] } }
  const revised = [], started = []
  const actions = createMediaActions({
    tavern: { getTurn: async () => ({ textVersion: 'v' }), list: async () => [item], update: async (_id, changes) => Object.assign(item, changes) },
    attachments: { saveImage: async () => ({}) }, readFileAsBytes: async () => new Uint8Array(),
    getJob: async id => id === 'j' ? sourceJob : { id, state: 'running' },
    startReplacement: async input => { started.push(input); return { jobId: 'j2' } },
    revisePrompt: async input => { revised.push(input); return promptText }, cancelJob: async () => {}, pollMs: 1,
  })
  t.after(() => actions.dispose())
  await actions.handle({ gameId: 'g', turn: 2, textVersion: 'v', mediaId: 'm', operation: 'revise', instruction: '改动作' })
  assert.equal(revised[0].prompt, 'old scene')
  assert.deepEqual(revised[0].characters, sourceJob.params.characters)
  assert.equal(started[0].prompt, promptText)
  assert.deepEqual(started[0].characters, sourceJob.params.characters)
})
