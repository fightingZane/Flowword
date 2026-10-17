import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchTestBrowser } from './test-browser.mjs';
await mkdir('.cache', { recursive: true });
const extension = await mkdtemp(resolve('.cache/scope-v09-'));
await cp('.output/chrome-mv3', extension, { recursive: true });
const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
manifest.host_permissions = [...manifest.host_permissions, 'https://*/*', 'http://*/*']; manifest.permissions.push('tabs');
await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
const run = await launchTestBrowser({ browserOptions: { args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] } });
const report = { environment: 'isolated production copy with pregranted all-site and tabs permissions; no native permission dialog or real model calls', cases: [] };
// log 记录真实浏览器检查通过的name，不把预授予权限冒充用户实际授权弹窗
const log = (name) => { report.cases.push(name); console.log('PASS ' + name); };
// select 采样自编普通网页的Range，synthetic只触发本地显示，真实键鼠另行测试自动翻译
async function select(page) { await page.evaluate(() => { const range = document.createRange(); range.selectNodeContents(document.querySelector('#sentence')); getSelection().removeAllRanges(); getSelection().addRange(range); document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); }); }
try {
  await run.context.route('https://**/*', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Owned reading page</title><body style="font:22px/2 system-ui;margin:40px"><p id="sentence">The vapor chamber improves cooling.</p><p>Another reading paragraph.</p></body>' }));
  const first = await run.context.newPage(); const second = await run.context.newPage();
  await first.goto('https://reading-one.test/article'); await second.goto('https://reading-two.test/article');
  assert.equal(await first.locator('flowword-selection-ui').count(), 0);
  const settings = await run.context.newPage(); await settings.goto(`chrome-extension://${run.extensionId}/settings.html?view=scope`);
  await settings.getByLabel('在所有网站启用', { exact: true }).check();
  await first.locator('flowword-selection-ui').waitFor({ state: 'attached' }); await second.locator('flowword-selection-ui').waitFor({ state: 'attached' });
  const registered = await run.worker.evaluate(() => chrome.scripting.getRegisteredContentScripts()); assert.ok(registered.some((item) => item.id === 'flowword-site-all' && item.matches.includes('https://*/*')));
  log('一次全站开启即注入两个不同普通网站，无需逐站刷新，生产必选权限仍保持原范围');
  await settings.getByRole('button', { name: '划词翻译', exact: true }).click();
  await settings.getByLabel('划词字号', { exact: true }).fill('20'); await settings.getByLabel('划词主题', { exact: true }).selectOption('blue');
  await select(first); await first.getByRole('toolbar', { name: 'FlowWord 网页划词' }).waitFor();
  const size = await first.locator('.fw-selection').evaluate((node) => getComputedStyle(node).fontSize); assert.equal(size, '20px');
  const appearance = await run.worker.evaluate(() => chrome.storage.local.get('flowword.appearance.v1')); assert.equal(appearance['flowword.appearance.v1'], undefined);
  log('划词字号与主题独立保存，不改原视频外观');
  await run.worker.evaluate(async () => {
    globalThis.scopeCalls = 0; globalThis.fetch = async (_url, init) => { globalThis.scopeCalls++; const task = JSON.parse(init.body).messages[0].content.includes('Translate ONLY') ? 'translate' : 'context'; return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(task === 'translate' ? { translation: '均热板改善散热' } : { expressions: [] }) } }] })); };
    const open = indexedDB.open('flowword-provider', 1); await new Promise((done, reject) => { open.onupgradeneeded = () => { open.result.createObjectStore('config'); open.result.createObjectStore('cache'); }; open.onsuccess = done; open.onerror = reject; }); const db = open.result;
    await new Promise((done) => { const tx = db.transaction('config','readwrite'); tx.objectStore('config').put({ mode:'cloud', endpoint:'https://api.example.test/chat', model:'fixture', apiKey:'mock-only', prefetch:false },'provider'); tx.oncomplete=done; }); db.close(); await chrome.storage.local.set({ 'flowword.onlineTranslation.v1':true });
  });
  await settings.getByLabel('选中后自动翻译', { exact: true }).evaluate((node) => node.click());
  assert.equal(await settings.getByLabel('选中后自动翻译', { exact: true }).isChecked(), false);
  await settings.getByLabel('选中后自动翻译', { exact: true }).check();
  await first.keyboard.press('Escape'); await select(first); await first.waitForTimeout(250);
  assert.equal(await run.worker.evaluate(() => globalThis.scopeCalls), 0);
  await first.locator('#sentence').click({ clickCount: 3 }); await first.locator('.fw-selection-translation').waitFor();
  assert.equal(await first.locator('.fw-selection-translation').textContent(), '均热板改善散热'); assert.equal(await run.worker.evaluate(() => globalThis.scopeCalls), 2);
  log('自动翻译只响应真实键鼠选区，脚本合成选区和mouseup不会调用模型');
  await settings.getByRole('button', { name: '总设置', exact: true }).click();
  await settings.getByLabel('启用网站 https://reading-one.test', { exact: true }).uncheck();
  await first.locator('flowword-selection-ui').waitFor({ state: 'detached' }); await first.reload(); assert.equal(await first.locator('flowword-selection-ui').count(), 0);
  await second.locator('flowword-selection-ui').waitFor({ state: 'attached' });
  await settings.reload(); assert.equal(await settings.getByLabel('启用网站 https://reading-one.test', { exact: true }).isChecked(), false);
  log('单站停用即时清理，重新访问和设置页重载仍记住，其他网站继续可用');
  await settings.getByLabel('启用网站 https://reading-one.test', { exact: true }).check(); await first.locator('flowword-selection-ui').waitFor({ state: 'attached' });
  await settings.getByLabel('在所有网站启用', { exact: true }).uncheck(); await second.locator('flowword-selection-ui').waitFor({ state: 'detached' });
  await first.reload(); await first.locator('flowword-selection-ui').waitFor({ state: 'attached' });
  const stored = await run.worker.evaluate(() => chrome.storage.local.get('flowword.scope.v1')); assert.ok(!JSON.stringify(stored).includes('/article'));
  log('关闭全站模式保留明确启用的网站，未来重载仍注入，规则只记录来源不保存标题/完整地址');
  await mkdir('test-results', { recursive: true }); await settings.screenshot({ path:'test-results/scope-v09-settings.png', fullPage:true });
} finally { await mkdir('test-results',{recursive:true}); await writeFile('test-results/scope-v09-report.json',JSON.stringify(report,null,2)); await run.context.close(); }
