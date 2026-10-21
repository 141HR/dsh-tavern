import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('trusted inline prose installs quote highlights and releases them on replacement/unmount', { skip: !process.env.TAVERN_BROWSER_TESTS }, async t => {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.setContent('<style>body{color:rgb(30,30,30);--dsw-alias-brand-primary:blue}</style><div id="root"></div>')
  const sources = await Promise.all(['text-colors.js', 'inline-fragment.js'].map(file => readFile(new URL('../tavern-plugin/src/client/' + file, import.meta.url), 'utf8')))
  await page.addScriptTag({ content: `
    const React = {useRef:()=>({current:document.querySelector('#root')}), useLayoutEffect:fn=>{window.cleanup=fn()}, createElement(){}};
    function bindTavernFontZoom(){return ()=>{}}
    ${sources.join('\n')}
    window.mount = content => TavernInlineFragment({content});
    window.ranges = () => [...CSS.highlights.values()].flatMap(h=>[...h].map(r=>r.toString()));
  ` })
  await page.evaluate(() => mount('<p>她说：“你好。”</p><pre>“代码”</pre><p style="color:red">“卡片颜色”</p>'))
  // Wait for the highlighter's batched refresh, then inspect actual browser ranges.
  await page.waitForTimeout(100)
  assert.deepEqual(await page.evaluate(() => ranges()), ['“你好。”'])
  await page.evaluate(() => { cleanup(); mount('<p>“新的段落。”</p>') })
  await page.waitForTimeout(100)
  assert.deepEqual(await page.evaluate(() => ranges()), ['“新的段落。”'])
  await page.evaluate(() => cleanup())
  assert.equal(await page.evaluate(() => CSS.highlights.size), 0)
  assert.equal(await page.locator('[data-dsh-tavern-text-colors]').count(), 0)
  assert.equal(await page.locator('#root').textContent(), '')
})
