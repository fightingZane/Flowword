import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { launchTestBrowser } from './test-browser.mjs';
const run = await launchTestBrowser({ browserOptions: { viewport: { width: 1280, height: 900 } } });
const report = { environment: 'production extension; real pointer drag/resize; isolated authored page and mocked model', cases: [] };
// log 记录通过的几何交互name，所有拖动均由浏览器原生鼠标事件驱动
const log = (name) => { report.cases.push(name); console.log('PASS ' + name); };
// pick 选取自编英文句并通过真实翻译按钮打开卡片，不直接设置React内部状态
async function pick(page) { await page.locator('flowword-selection-ui').waitFor({ state: 'attached' }); await page.evaluate(() => { const range = document.createRange(); range.selectNodeContents(document.querySelector('#sentence')); getSelection().removeAllRanges(); getSelection().addRange(range); document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); }); await page.getByRole('button', { name: '翻译', exact: true }).click(); await page.locator('.fw-selection-translation').waitFor(); }
// drag 使用鼠标从locator中心按下并移动dx/dy，验证pointer capture与真实拖放
async function drag(page, locator, dx, dy) { const box = await locator.boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 12 }); await page.mouse.up(); }
try {
  await run.context.route('https://www.youtube.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Owned layout lesson</title><body style="margin:30px;font:20px/2 system-ui"><p id="sentence">The vapor chamber improves cooling.</p><p id="second">A telephoto lens captures distant details.</p><p>Another reading paragraph.</p></body>' }));
  await run.worker.evaluate(async () => {
    globalThis.fetch = async (_url, init) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(JSON.parse(init.body).messages[0].content.includes('Translate ONLY') ? { translation: JSON.parse(JSON.parse(init.body).messages[1].content).current.includes('telephoto') ? '长焦镜头捕捉远处细节' : '均热板改善散热' } : { expressions: [] }) } }] }));
    const request = indexedDB.open('flowword-provider', 1); await new Promise((done, reject) => { request.onupgradeneeded = () => { request.result.createObjectStore('config'); request.result.createObjectStore('cache'); }; request.onsuccess = done; request.onerror = reject; }); const db = request.result;
    await new Promise((done) => { const tx = db.transaction('config','readwrite'); tx.objectStore('config').put({ mode:'cloud', endpoint:'https://api.mymemory.translated.net/layout',model:'fixture',apiKey:'mock-only',prefetch:false },'provider'); tx.oncomplete=done; }); db.close(); await chrome.storage.local.set({ 'flowword.enabled.v1':true,'flowword.onlineTranslation.v1':true });
  });
  const page = await run.context.newPage(); await page.goto('https://www.youtube.com/layout-fixture'); await pick(page);
  const panel = page.locator('.fw-selection'); const initial = await panel.boundingBox();
  await drag(page, page.locator('.fw-selection-brand'), 130, 70);
  let moved = await panel.boundingBox(); assert.ok(moved.x >= initial.x + 100 && moved.y >= initial.y + 45); await page.getByRole('button', { name:'取消固定划词框',exact:true }).waitFor();
  log('未先点固定也能直接拖标题，自由移动并自动固定位置');
  await drag(page, page.getByRole('button', { name:'调整划词框大小',exact:true }), 120, 110);
  const resized = await panel.boundingBox(); assert.ok(resized.width >= moved.width + 90); assert.ok(resized.height >= moved.height + 70); assert.equal(await page.locator('.fw-selection-translation').textContent(),'均热板改善散热');
  log('拖右下角同时调整宽高，原有译文与操作保持可用');
  await page.keyboard.press('Escape'); await page.reload(); await pick(page);
  const restored = await panel.boundingBox(); assert.ok(Math.abs(restored.width-resized.width)<3 && Math.abs(restored.height-resized.height)<3); assert.ok(Math.abs(restored.x-resized.x)<3 && Math.abs(restored.y-resized.y)<3);
  log('关闭、重载和新选区后恢复本机保存的固定位置与尺寸');
  await page.locator('#second').click({clickCount:3});
  await page.locator('.fw-selection-translation').filter({hasText:'长焦镜头捕捉远处细节'}).waitFor({timeout:5000});
  const changed=await panel.boundingBox(); assert.ok(Math.abs(changed.x-restored.x)<3 && Math.abs(changed.y-restored.y)<3); assert.ok(Math.abs(changed.width-restored.width)<3 && Math.abs(changed.height-restored.height)<3);
  log('固定仅锁定几何位置，真实重新框选自动更新原文与译文并保持尺寸位置');

  await page.setViewportSize({width:375,height:500}); await page.waitForFunction(() => { const box=document.querySelector('flowword-selection-ui')?.shadowRoot?.querySelector('.fw-selection')?.getBoundingClientRect(); return box && box.left>=0 && box.top>=0 && box.right<=375 && box.bottom<=500; });
  log('窄视窗自动限制已保存几何位置，不把卡片留在屏幕外');
  await page.setViewportSize({width:1280,height:900}); await page.getByRole('button',{name:'划词更多操作',exact:true}).click(); await page.getByRole('menuitem',{name:'恢复默认位置与大小',exact:true}).click();
  await page.waitForFunction(() => document.querySelector('flowword-selection-ui')?.shadowRoot?.querySelector('.fw-selection')?.getBoundingClientRect().width===430);
  assert.equal(await page.locator('.fw-selection-translation').textContent(),'长焦镜头捕捉远处细节'); const stored=await run.worker.evaluate(()=>chrome.storage.local.get('flowword.selectionLayout.v1')); assert.deepEqual(stored['flowword.selectionLayout.v1'],{width:430,fixed:false});
  log('恢复默认同时取消固定并重置大小，保留当前译文和收藏入口');
  await mkdir('test-results',{recursive:true}); await page.screenshot({path:'test-results/selection-layout-v091.png'});
} finally { await mkdir('test-results',{recursive:true}); await writeFile('test-results/selection-layout-v091-report.json',JSON.stringify(report,null,2)); await run.context.close(); }
