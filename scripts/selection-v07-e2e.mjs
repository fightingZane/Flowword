import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchTestBrowser } from './test-browser.mjs';
const report = { environment: 'Production MV3 extension; real DOM Selection/Range; owned ordinary HTML fixture without video', realPaidApiCalled: false, provider: 'MOCK only in isolated test worker', notCovered: ['真实任意网站兼容性', '原生按站授权弹窗由sites测试或用户浏览器验收'], cases: [], errors: [] };
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Owned reading lesson</title><style>body{margin:50px;font:20px/1.8 system-ui;max-width:850px;background:#eee}p{margin:25px 0}#edge{position:fixed;right:3px;bottom:3px;width:145px}input,textarea{font:inherit}</style><body>
<p id="sentence">The vapor chamber improves cooling and reduces thermal throttling.</p><p id="second">An ambiguous reference needs careful context.</p><p id="slow">An obsolete request should not replace a new choice.</p><p id="fast">A resilient mechanism supports reliable learning.</p><p id="keyboard" tabindex="0">Resilient systems remain reliable.</p>
<p id="hidden">Visible lesson<span hidden>privateHiddenWord</span><span style="display:none">privateDisplayWord</span> closes here.</p><p id="cross">Ordinary text <span contenteditable="true">privateEditableWord</span> finishes here.</p><input id="password" type="password" value="privatePasswordWord"><textarea id="textarea">privateTextareaWord</textarea><p id="editable" contenteditable="true">privateEditableLesson</p><p id="edge">An edge expression.</p></body></html>`;
const run = await launchTestBrowser(); let extra; let page; let rpcPage;
// log 仅记录通过的场景name，报告不包含任何真实网页或真实密钥
function log(name, detail) { report.cases.push({ name, passed: true, ...(detail ? { detail } : {}) }); console.log('PASS ' + name); }
// select 以真实Range选择selector或其substring，触发松开事件模拟用户完成选择，不直接调用组件内部方法
async function select(target, selector, substring) {
  await target.evaluate(({ selector, substring }) => {
    document.activeElement?.blur?.(); document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    const element = document.querySelector(selector); const range = document.createRange();
    if (substring) { const text = element.firstChild; const start = text.textContent.indexOf(substring); range.setStart(text, start); range.setEnd(text, start + substring.length); }
    else range.selectNodeContents(element);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, { selector, substring });
  await target.getByRole('toolbar', { name: 'FlowWord 网页划词' }).waitFor();
}
// command 发送正式Popup面板协议，view只选择本地模型配置或词本，不调用模型
async function command(view) { await page.bringToFront(); return run.worker.evaluate(async (view) => { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); return chrome.tabs.sendMessage(tab.id, { type: 'FLOWWORD_PANEL_OPEN', view }); }, view); }
// requests 读取模拟请求记录，无用户profile或真实API密钥
async function requests() { return run.worker.evaluate(() => globalThis.selectionRequests); }
// book 获取隔离词本的少量测试收藏，消息与正式内容脚本一致
async function book() { return rpcPage.evaluate(async () => chrome.runtime.sendMessage({ type: 'FLOWWORD_BOOK_LIST' })); }
try {
  await mkdir('test-results', { recursive: true });
  rpcPage = await run.context.newPage(); await rpcPage.goto(`chrome-extension://${run.extensionId}/wordbook.html`);
  await run.context.route('https://**/*', (route) => new URL(route.request().url()).hostname === 'www.youtube.com' || new URL(route.request().url()).hostname === 'flowword-selection-denied.test' ? route.fulfill({ contentType: 'text/html', body: html }) : route.abort());
  await run.worker.evaluate(async () => {
    globalThis.selectionRequests = []; globalThis.selectionAborts = 0; globalThis.selectionFailContext = false;
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init.body); const input = JSON.parse(body.messages[1].content); const task = body.messages[0].content.includes('Translate ONLY') ? 'translate' : 'context';
      globalThis.selectionRequests.push({ task, sentence: input.current, nearby: input.nearby, bodyKeys: Object.keys(body) });
      await new Promise((resolve, reject) => { const timer = setTimeout(resolve, input.current.includes('obsolete request') ? 650 : 35); init.signal?.addEventListener('abort', () => { clearTimeout(timer); globalThis.selectionAborts++; reject(new DOMException('cancelled', 'AbortError')); }, { once: true }); });
      if (task === 'context' && globalThis.selectionFailContext) { globalThis.selectionFailContext = false; return new Response('{}', { status: 503 }); }
      const text = input.current.includes('vapor chamber') ? 'vapor chamber' : input.current.split(/\s+/).slice(0, 2).join(' ').replace(/[.!?]+$/, '');
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(task === 'translate' ? { translation: '模拟选区译文：' + input.current } : { expressions: [{ text, meaning: '模拟语境释义，用于验证选区交互和收藏', partOfSpeech: '名词短语', kind: 'phrase', reason: '模拟用法解释' }] }) } }] }), { status: 200 });
    };
    const opened = indexedDB.open('flowword-provider', 1);
    await new Promise((resolve, reject) => { opened.onupgradeneeded = () => { opened.result.createObjectStore('config'); opened.result.createObjectStore('cache'); }; opened.onsuccess = resolve; opened.onerror = reject; });
    const db = opened.result; await new Promise((resolve, reject) => { const tx = db.transaction('config', 'readwrite'); tx.objectStore('config').put({ mode: 'cloud', endpoint: 'https://api.mymemory.translated.net/selection-mock', model: 'fixture-model', apiKey: 'synthetic-fixture-only', prefetch: false, prefetchExpressions: false }, 'provider'); tx.oncomplete = resolve; tx.onerror = reject; }); db.close();
    await chrome.storage.local.set({ 'flowword.enabled.v1': true, 'flowword.onlineTranslation.v1': true });
  });
  const denied = await run.context.newPage(); await denied.goto('https://flowword-selection-denied.test/'); await denied.waitForTimeout(250); assert.equal(await denied.locator('flowword-selection-ui').count(), 0); await denied.close();
  log('未授权普通网页即使总开关打开也不注入选区组件');
  page = await run.context.newPage(); page.setDefaultTimeout(12000); page.on('pageerror', (error) => report.errors.push(error.message)); await page.goto('https://www.youtube.com/reading-fixture');
  await page.locator('flowword-selection-ui').waitFor({ state: 'attached' }); assert.equal(await page.locator('video').count(), 0); assert.equal(await page.locator('flowword-ui').count(), 0);
  await select(page, '#sentence'); const toolbar = page.getByRole('toolbar', { name: 'FlowWord 网页划词' });
  assert.equal(await toolbar.locator('header button').count(), 3); assert.equal((await requests()).length, 0);
  const initialBox = await toolbar.boundingBox(); assert.ok(initialBox.width <= 250); log('已内置授权的普通HTML页面无视频也可划词，默认三按钮工具条且未点击零联网');
  await page.locator('.fw-selection-primary').evaluate((button) => { button.click(); button.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); await page.waitForTimeout(100); assert.equal((await requests()).length, 0); log('网页脚本合成click或dispatchEvent不能触发模型上传，真实用户点击仍可用');
  await toolbar.getByRole('button', { name: '翻译', exact: true }).click(); await page.locator('.fw-selection-translation').waitFor(); await page.locator('.fw-selection article').waitFor();
  assert.equal((await requests()).length, 2); assert.ok((await requests()).every((request) => !JSON.stringify(request).includes('reading-fixture')));
  const dark = await page.locator('.fw-selection').evaluate((node) => getComputedStyle(node).backgroundColor); assert.equal(dark, 'rgb(25, 41, 35)');
  await page.screenshot({ path: 'test-results/selection-v07-translation.png' }); log('显式点击才并行请求整句与语境，默认暗绿且不发送URL或整页');
  await page.getByRole('button', { name: '收藏选区', exact: true }).click(); await page.getByLabel('条目类型').selectOption('phrase'); await page.getByLabel('固定搭配', { exact: true }).check(); await page.getByLabel('自定义标签').fill('网页学习，散热'); await page.getByRole('button', { name: '保存到单词本', exact: true }).click(); await page.getByRole('status').filter({ hasText: '已加入单词本' }).waitFor();
  let entries = (await book()).entries; const saved = entries.find((entry) => entry.text.startsWith('The vapor chamber'));
  assert.ok(saved); assert.equal(saved.kind, 'phrase'); assert.ok(saved.examTags.includes('固定搭配')); assert.ok(saved.tags.includes('网页学习')); assert.equal(saved.contexts[0].source.kind, 'web'); assert.equal(saved.contexts[0].url, page.url()); assert.equal(saved.contexts[0].title, 'Owned reading lesson'); assert.equal(saved.contexts[0].time, undefined); assert.equal(saved.contexts[0].videoKey, undefined); assert.equal(saved.contexts[0].source.quote.exact, saved.text);
  log('选区按用户分类收藏，网页来源与quote准确，不伪造视频时间或videoKey');
  await page.keyboard.press('Escape'); await select(page, '#sentence', 'vapor chamber'); await page.getByRole('button', { name: '翻译', exact: true }).click(); await page.locator('.fw-selection-translation').waitFor(); await page.getByRole('button', { name: '收藏选区', exact: true }).click(); await page.getByRole('button', { name: '保存到单词本', exact: true }).click(); await page.getByRole('status').filter({ hasText: '已加入单词本' }).waitFor();
  entries = (await book()).entries; const phrase = entries.find((entry) => entry.text === 'vapor chamber'); assert.ok(phrase.translation); assert.equal(phrase.contexts[0].sentence, 'The vapor chamber improves cooling and reduces thermal throttling.'); assert.equal(phrase.contexts[0].translation, undefined);
  log('选词译文只属于词条，不冒充完整上下文句子的译文');
  await page.keyboard.press('Escape'); await select(page, '#hidden'); await page.getByRole('button', { name: '翻译', exact: true }).click(); await page.locator('.fw-selection-translation').waitFor(); const sent = await requests(); assert.ok(sent.some((item) => item.sentence === 'Visible lesson closes here.')); assert.ok(sent.every((item) => !/privateHiddenWord|privateDisplayWord/.test(JSON.stringify(item))));
  log('真实Chromium Selection排除hidden/display:none文字，隐藏DOM未进入上传文本或语境');
  await page.keyboard.press('Escape'); const beforeInput = (await requests()).length;
  for (const selector of ['#password','#textarea']) { await page.locator(selector).evaluate((element) => { element.focus(); element.select(); }); await page.waitForTimeout(180); assert.equal(await page.locator('.fw-selection').count(), 0); }
  for (const selector of ['#editable','#cross']) { await page.evaluate((selector) => { document.activeElement?.blur?.(); const range = document.createRange(); range.selectNodeContents(document.querySelector(selector)); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new MouseEvent('mouseup')); }, selector); await page.waitForTimeout(200); assert.equal(await page.locator('.fw-selection').count(), 0); }
  assert.equal((await requests()).length, beforeInput); log('密码输入、textarea、contenteditable及跨中间编辑区选区均不弹出不联网');
  await page.evaluate(() => { document.querySelector('#keyboard').focus(); const range = document.createRange(); range.setStart(document.querySelector('#keyboard').firstChild, 0); range.setEnd(document.querySelector('#keyboard').firstChild, 9); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); }); await page.keyboard.press('Control+Shift+ArrowRight'); await page.getByRole('toolbar', { name: 'FlowWord 网页划词' }).waitFor(); assert.equal((await requests()).length, beforeInput); await page.keyboard.press('Escape'); await page.locator('.fw-selection').waitFor({ state: 'detached' }); log('键盘选词可显示工具条，Esc关闭且不产生自动翻译');
  await run.worker.evaluate(() => { globalThis.selectionFailContext = true; }); await select(page, '#second'); await page.getByRole('button', { name: '翻译', exact: true }).click(); await page.getByRole('button', { name: '重试表达', exact: true }).waitFor(); await page.locator('.fw-selection-translation').waitFor(); const sentenceCount = (await requests()).filter((item) => item.sentence.startsWith('An ambiguous') && item.task === 'translate').length; await page.getByRole('button', { name: '重试表达', exact: true }).click(); await page.locator('.fw-selection article').waitFor(); assert.equal((await requests()).filter((item) => item.sentence.startsWith('An ambiguous') && item.task === 'translate').length, sentenceCount); log('表达失败可单独重试，保留整句译文且不重复整句调用');
  await page.keyboard.press('Escape'); await select(page, '#slow'); await page.getByRole('button', { name: '翻译', exact: true }).click(); await page.waitForTimeout(70); await select(page, '#fast'); await page.getByRole('button', { name: '翻译', exact: true }).click(); await page.locator('.fw-selection-translation').filter({ hasText: 'resilient mechanism' }).waitFor(); await page.waitForTimeout(700); assert.equal((await page.locator('.fw-selection-original').textContent()).includes('obsolete request'), false); assert.ok(await run.worker.evaluate(() => globalThis.selectionAborts >= 1)); log('切换选区取消旧订阅，慢结果不覆盖新选择');
  await page.getByRole('button', { name: '固定划词框', exact: true }).click(); await page.locator('body').click({ position: { x: 3, y: 3 } }); assert.equal(await page.locator('.fw-selection').count(), 1);
  const header = await page.locator('.fw-selection header').boundingBox(); await page.mouse.move(header.x + 37, header.y + 17); await page.mouse.down(); await page.mouse.move(-150, -150); await page.mouse.up(); const dragged = await page.locator('.fw-selection').boundingBox(); assert.ok(dragged.x >= 11 && dragged.y >= 11); assert.ok(dragged.x + dragged.width <= 1269 && dragged.y + dragged.height <= 789); await page.keyboard.press('Escape'); log('固定浮层保留于外部点击，可拖动并限制在屏幕内，Esc仍可关闭');
  await select(page, '#edge'); await page.getByRole('button', { name: '翻译', exact: true }).click(); await page.locator('.fw-selection-translation').waitFor(); const edgeBox = await page.locator('.fw-selection').boundingBox(); assert.ok(edgeBox.x >= 11 && edgeBox.x + edgeBox.width <= 1269 && edgeBox.y >= 11 && edgeBox.y + edgeBox.height <= 789); await page.keyboard.press('Escape'); log('底部右侧选区展开后实测卡片完整留在视窗');
  assert.equal((await command('book')).ok, true); await page.getByRole('dialog', { name: 'FlowWord 快捷单词本' }).waitFor(); await page.getByRole('button', { name: '关闭划词框', exact: true }).click(); assert.equal((await command('provider')).ok, true); await page.frameLocator('iframe[title="模型与快捷键设置"]').getByLabel('服务', { exact: true }).waitFor(); await page.getByRole('button', { name: '关闭划词框', exact: true }).click(); log('无视频普通网页也能从正式面板消息打开快捷词本与受保护模型设置');
  await select(page, '#sentence'); await page.getByRole('button', { name: '翻译', exact: true }).click(); await page.locator('.fw-selection-translation').waitFor(); if (await page.getByRole('button', { name: '固定划词框', exact: true }).count()) await page.getByRole('button', { name: '固定划词框', exact: true }).click(); await page.getByRole('button', { name: '取消固定划词框', exact: true }).waitFor(); await page.evaluate(() => { history.pushState({}, '', '/reading-fixture-next'); document.title = 'Changed title'; }); await page.locator('.fw-selection').waitFor({ state: 'detached' }); log('SPA地址变化即使节点仍存在且卡片固定也关闭并取消旧来源操作');
  await run.worker.evaluate(() => chrome.storage.local.set({ 'flowword.enabled.v1': false })); await page.locator('flowword-selection-ui').waitFor({ state: 'detached' }); log('关闭总开关清理普通页面选区宿主与监听');
  const dynamicOrigin = 'https://flowword-selection-owned.test';
  const controlled = await mkdtemp(resolve('.cache/selection-permission-'));
  await cp(resolve('.output/chrome-mv3'), controlled, { recursive: true });
  const manifestPath = resolve(controlled, 'manifest.json'); const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.host_permissions = [...manifest.host_permissions, dynamicOrigin + '/*']; await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  extra = await launchTestBrowser({ browserOptions: { args: [`--disable-extensions-except=${controlled}`, `--load-extension=${controlled}`, '--autoplay-policy=no-user-gesture-required'] } });
  await extra.context.route(dynamicOrigin + '/**', (route) => route.fulfill({ contentType: 'text/html', body: html }));
  const extension = await extra.context.newPage(); await extension.goto(`chrome-extension://${extra.extensionId}/settings.html`);
  const granted = await extension.evaluate((origin) => chrome.runtime.sendMessage({ type: 'FLOWWORD_ENABLE_SITE', origin }), dynamicOrigin); assert.equal(granted.ok, true);
  await extra.worker.evaluate(() => chrome.storage.local.set({ 'flowword.enabled.v1': true }));
  const dynamic = await extra.context.newPage(); dynamic.setDefaultTimeout(12000); await dynamic.goto(dynamicOrigin + '/reading'); await dynamic.locator('flowword-selection-ui').waitFor({ state: 'attached' }); await select(dynamic, '#sentence');
  await extra.worker.evaluate(async (origin) => { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); await chrome.tabs.sendMessage(tab.id, { type: 'FLOWWORD_SITE_REVOKED', origins: [origin + '/*'] }); }, dynamicOrigin);
  await dynamic.locator('flowword-selection-ui').waitFor({ state: 'detached' });
  report.controlledPermissionMode = 'Only this owned test origin is pregranted in an isolated build copy; production manifest not modified; production revoke notification exercised, not native permission popup';
  log('动态站点撤权通知清理选区组件与监听', '受控单域授权副本，不宣称原生授权或真实撤权弹窗已验收');
  assert.deepEqual(report.errors, []);
} catch (error) { report.errors.push(error.stack || String(error)); console.error(error); process.exitCode = 1; if (page) await page.screenshot({ path: 'test-results/selection-v07-failure.png' }).catch(() => {}); }
finally { report.passed = !report.errors.length; await mkdir('test-results', { recursive: true }); await writeFile('test-results/selection-v07-report.json', JSON.stringify(report, null, 2)); await extra?.context.close(); await run.context.close(); }
