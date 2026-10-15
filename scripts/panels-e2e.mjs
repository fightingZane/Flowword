import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { launchTestBrowser } from './test-browser.mjs';

const fixture = await readFile('tests/fixtures/player.html', 'utf8');
const media = await readFile('tests/fixtures/test-video.webm');
const run = await launchTestBrowser();
const page = await run.context.newPage(); page.setDefaultTimeout(15000);
const initialPages = run.context.pages().length;
const report = { environment: 'production MV3 extension; synthetic native video subtitles; mocked provider only', cases: [], errors: [] };
page.on('pageerror', (error) => report.errors.push(error.message));
// log 表示记录通过的面板验收项，name 为可读检查名称，只在断言成功后调用
const log = (name) => { report.cases.push(name); console.log(`PASS ${name}`); };
// writeProvider 表示写入隔离测试配置，config 不含真实密钥，仅供旧密钥 DOM 回归
// 操作测试配置文件的扩展数据库，不接触用户浏览器资料
async function writeProvider(config) {
  await run.worker.evaluate((config) => new Promise((resolve, reject) => {
    const request = indexedDB.open('flowword-provider', 1);
    request.onsuccess = () => { const db = request.result; const transaction = db.transaction('config', 'readwrite'); transaction.objectStore('config').put(config, 'provider'); transaction.oncomplete = () => { db.close(); resolve(); }; transaction.onerror = () => reject(new Error('测试配置写入失败')); };
    request.onerror = () => reject(new Error('测试配置打开失败'));
  }), config);
}
try {
  await run.context.route('https://www.youtube.com/**', (route) => {
    if (new URL(route.request().url()).pathname !== '/flowword-test-video.webm') return route.fulfill({ contentType: 'text/html', body: fixture });
    const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/); const start = Number(range?.[1] || 0); const end = Math.min(media.length - 1, range?.[2] ? Number(range[2]) : media.length - 1);
    return route.fulfill({ status: range ? 206 : 200, contentType: 'video/webm', headers: { 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${media.length}` } : {}) }, body: media.subarray(start, end + 1) });
  });
  await page.goto('https://www.youtube.com/watch?v=panels-fixture');
  await page.waitForFunction(() => document.querySelector('video.html5-main-video')?.readyState >= 2);
  await run.worker.evaluate(async () => {
    globalThis.panelRequests = [];
    globalThis.fetch = async (url) => { const parsed = new URL(url); const text = parsed.searchParams.get('q'); globalThis.panelRequests.push(text); return new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: `测试中文译文：${text}` } }), { status: 200 }); };
    await chrome.storage.local.set({ 'flowword.enabled.v1': true });
  });
  const ball = page.getByRole('button', { name: '暂停视频并捕获字幕' }); await ball.waitFor();
  const panelOpened = await run.worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return chrome.tabs.sendMessage(tab.id, { type: 'FLOWWORD_PANEL_OPEN', view: 'book' });
  });
  assert.equal(panelOpened.ok, true);
  await page.getByRole('dialog', { name: 'FlowWord 快捷单词本' }).waitFor();
  await page.getByRole('button', { name: '关闭面板，保持视频暂停' }).click();
  await ball.click({ button: 'right' });
  await page.getByRole('button', { name: '云端模型与快捷键设置 ↗' }).click();
  const frame = page.frameLocator('iframe[title="模型与快捷键设置"]');
  await frame.getByLabel('服务', { exact: true }).waitFor();
  assert.equal(await frame.getByLabel('服务', { exact: true }).inputValue(), 'cloud');
  assert.equal(await frame.getByLabel('HTTPS 接口完整地址').inputValue(), 'https://api.deepseek.com/chat/completions');
  assert.equal(await frame.getByLabel('模型名称').inputValue(), 'deepseek-flash');
  assert.equal(run.context.pages().length, initialPages);
  assert.equal((await run.worker.evaluate(() => globalThis.panelRequests)).length, 0);
  const frameBackground = await frame.locator('html').evaluate((element) => getComputedStyle(element).backgroundColor);
  assert.equal(frameBackground, 'rgb(28, 48, 36)');
  await mkdir('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/panels-model-settings.png', fullPage: true });
  log('配置在当前悬浮框内嵌入，DeepSeek 预填且未配置不联网，不增加标签页');
  const fakeKey = 'fixture-old-key-do-not-expose';
  await writeProvider({ mode: 'cloud', endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash', apiKey: fakeKey, prefetch: false, prefetchExpressions: false });
  await frame.locator('body').evaluate(() => location.reload());
  await frame.getByLabel('API Key').waitFor();
  await frame.getByLabel('API Key').getAttribute('placeholder').then((value) => assert.match(value, /已配置/));
  assert.equal(await frame.getByLabel('API Key').inputValue(), '');
  assert.equal((await frame.locator('html').innerHTML()).includes(fakeKey), false);
  log('旧密钥不回填到模型设置 DOM');
  for (const text of ['oldest expression', 'middle expression', 'latest expression']) {
    const result = await frame.locator('body').evaluate((_element, text) => chrome.runtime.sendMessage({ type: 'FLOWWORD_BOOK_SAVE', entry: { kind: 'phrase', text, translation: text === 'latest expression' ? '最新表达' : '测试收藏', contexts: [], tags: [], examTags: [], partOfSpeech: '短语' } }), text); assert.equal(result.ok, true, result.error);
  }
  await page.getByRole('button', { name: '返回配置', exact: true }).click();
  await page.getByRole('button', { name: '打开单词本', exact: true }).click();
  await page.getByRole('region', { name: '悬浮单词本' }).waitFor();
  await page.locator('.fw-quick-book-list strong').first().waitFor();
  assert.equal(await page.locator('.fw-quick-book-list strong').first().innerText(), 'latest expression');
  await page.getByLabel('搜索悬浮单词本').fill('最新'); assert.equal(await page.locator('.fw-quick-book-list li').count(), 1);
  assert.equal(run.context.pages().length, initialPages);
  const opened = run.context.waitForEvent('page'); await page.getByRole('button', { name: '打开完整词本 ↗' }).click(); const full = await opened;
  await full.waitForLoadState(); assert.match(full.url(), /wordbook\.html/); await full.close();
  log('快捷词本按最近时间排序，可搜索，仅完整词本按钮打开新标签页');
  await writeProvider({ mode: 'mymemory', endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash', apiKey: '', prefetch: false, prefetchExpressions: false });
  await run.worker.evaluate(() => chrome.storage.local.set({ 'flowword.onlineTranslation.v1': true }));
  await page.getByRole('button', { name: '返回字幕', exact: true }).click();
  await page.locator('video.html5-main-video').evaluate((video) => {
    const track = video.addTextTrack('subtitles', 'English', 'en'); track.mode = 'showing'; track.addCue(new VTTCue(0, 3, 'Earlier observations were surprising.')); track.addCue(new VTTCue(3, 6, 'This is the current sentence.')); track.addCue(new VTTCue(6, 9, 'The next explanation follows.')); video.currentTime = 4;
  });
  await ball.click();
  await page.locator('.fw-sentence').filter({ hasText: 'This is the current sentence.' }).waitFor();
  const before = page.getByRole('button', { name: '上文：Earlier observations were surprising.' }); const after = page.getByRole('button', { name: '下文：The next explanation follows.' });
  await before.waitFor(); await after.waitFor();
  const positions = await Promise.all([before.boundingBox(), page.locator('.fw-sentence').boundingBox(), after.boundingBox()]); assert.ok(positions[0].y < positions[1].y && positions[1].y < positions[2].y);
  assert.ok(positions[1].y - positions[0].y - positions[0].height <= 14, '上文与当前句应保持紧凑间距');
  assert.equal(await page.locator('.fw-neighbor-translation').count(), 0); assert.equal((await page.locator('.fw-neighbor').allTextContents()).join('').includes('暂无'), false);
  assert.equal((await run.worker.evaluate(() => globalThis.panelRequests)).includes('Earlier observations were surprising.'), false);
  await before.click(); await page.locator('.fw-neighbor-translation').filter({ hasText: '测试中文译文' }).waitFor();
  assert.equal((await run.worker.evaluate(() => globalThis.panelRequests)).filter((text) => text === 'Earlier observations were surprising.').length, 1);
  log('上文和下文位于当前句两侧，默认仅英文，点击后才查询该邻句译文');
  await mkdir('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/panels-neighbors.png', fullPage: true });
  await page.getByRole('button', { name: '单词本', exact: true }).click(); await page.screenshot({ path: 'test-results/panels-quick-wordbook.png', fullPage: true });
  await writeFile('test-results/panels-report.json', JSON.stringify(report, null, 2));
} catch (error) { await mkdir('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/panels-failure.png', fullPage: true }).catch(() => {}); await writeFile('test-results/panels-report.json', JSON.stringify({ ...report, failure: error.stack }, null, 2)); throw error; }
finally { await run.context.close(); }
