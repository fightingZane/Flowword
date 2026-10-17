import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { launchTestBrowser } from './test-browser.mjs';

const run = await launchTestBrowser(); const book = await run.context.newPage(); book.setDefaultTimeout(15000);
const report = { environment: 'production MV3 extension; synthetic authored video and webpage sources; no live model request', cases: [], errors: [] };
book.on('pageerror', (error) => report.errors.push(error.message));
// log 表示记录检查结果，name 是已通过的真实扩展验收说明
const log = (name) => { report.cases.push(name); console.log(`PASS ${name}`); };
// rpc 表示从扩展页调用正式后台，type 与 payload 均走真实资料校验和事务
async function rpc(type, payload = {}) { const result = await book.evaluate((message) => chrome.runtime.sendMessage(message), { type, ...payload }); assert.equal(result.ok, true, result.error); return result; }
// downloadBackup 表示下载并读取备份，name 为真实按钮名称，不绕过正式导出逻辑
async function downloadBackup(name) { const pending = book.waitForEvent('download'); await book.getByRole('button', { name, exact: true }).click(); const download = await pending; return JSON.parse(await readFile(await download.path(), 'utf8')); }
try {
  await mkdir('test-results', { recursive: true });
  await run.context.route('https://i.ytimg.com/**', (route) => route.fulfill({ status: 404, body: '' }));
  await run.context.route('https://example.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<html><title>Design notes</title><body><p>A rule of thumb makes this easier.</p><p>A clear reference helps.</p></body></html>' }));
  await book.goto(`chrome-extension://${run.extensionId}/wordbook.html`);
  const webContext = { sentence: 'A rule of thumb makes this easier.', url: 'https://example.com/article#notes', title: 'Design notes and thoughtful decisions', source: { kind: 'web', quote: { exact: 'A rule of thumb makes this easier.' } } };
  await rpc('FLOWWORD_BOOK_SAVE', { entry: { kind: 'phrase', text: 'rule of thumb', translation: '经验法则', tags: ['工作表达'], examTags: ['固定搭配'], partOfSpeech: '短语', contexts: [webContext] } });
  await rpc('FLOWWORD_BOOK_SAVE', { entry: { kind: 'word', text: 'reference', translation: '参考资料', tags: ['工作表达'], examTags: [], partOfSpeech: '名词', contexts: [{ ...webContext, sentence: 'A clear reference helps.', source: { kind: 'web', quote: { exact: 'A clear reference helps.' } } }] } });
  await rpc('FLOWWORD_BOOK_SAVE', { entry: { kind: 'phrase', text: 'telephoto lens', translation: '长焦镜头', tags: ['科技'], examTags: ['听力理解'], partOfSpeech: '名词短语', contexts: [{ sentence: 'The telephoto lens captures fine details.', url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Camera design explained', time: 65, end: 70 }] } });
  await book.reload(); await book.getByRole('heading', { name: 'rule of thumb', exact: true }).waitFor();
  assert.equal(await book.locator('html').evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(16, 29, 25)');
  assert.equal(await book.getByLabel('单词本主题').locator('option').count(), 8); assert.equal(await book.locator('.book').getAttribute('data-layout'), 'list');
  await book.getByRole('navigation', { name: '学习导航' }).getByRole('button', { name: '词本', exact: true }).waitFor();
  await book.getByRole('navigation', { name: '学习导航' }).getByRole('button', { name: '复习', exact: true }).waitFor();
  await book.getByRole('navigation', { name: '学习导航' }).getByRole('button', { name: '查词', exact: true }).waitFor();
  const summary = await rpc('FLOWWORD_BOOK_SUMMARY'); assert.equal(summary.sources.length, 2); assert.equal(summary.videos.length, 1);
  await book.getByRole('button', { name: /^网页来源/ }).click(); await book.waitForFunction(() => document.querySelectorAll('.book-card').length === 2);
  assert.ok((await book.locator('.book-direct-source').allTextContents()).every((text) => text.includes('回到原文') && !/\d+:\d\d/.test(text)));
  await book.getByRole('button', { name: '查看网页：Design notes and thoughtful decisions', exact: true }).click();
  await book.getByRole('button', { name: '导出当前网页', exact: true }).waitFor();
  const webBackup = await downloadBackup('导出当前网页'); assert.equal(webBackup.version, 4); assert.equal(webBackup.archive.sources.length, 1); assert.ok(webBackup.archive.captures.every((capture) => capture.source.kind === 'web' && !('time' in capture) && !('end' in capture)));
  log('新版暗绿真实词本、视频与网页分组、网页来源无虚构时间，v4按网页导出');
  const expression = book.locator('.book-card').filter({ has: book.getByRole('heading', { name: 'rule of thumb', exact: true }) });
  await expression.getByText('查看来源语境', { exact: true }).click(); await expression.getByRole('button', { name: '回到原文 ↗', exact: true }).waitFor();
  assert.equal(await expression.getByRole('button', { name: '听原句 ↗', exact: true }).count(), 0);
  const opened = run.context.waitForEvent('page'); await expression.getByRole('button', { name: '回到原文 ↗', exact: true }).click(); const original = await opened; await original.waitForLoadState(); assert.match(original.url(), /^https:\/\/example\.com\/article/); assert.ok(new URL(original.url()).hash.startsWith('#notes')); await original.close();
  await expression.getByRole('button', { name: '编辑这条语境释义', exact: true }).click(); await expression.getByLabel('当前语境释义').fill('根据经验形成的实用判断方法'); await expression.getByRole('button', { name: '保存这条语境', exact: true }).click(); await expression.getByText('该语境释义：根据经验形成的实用判断方法', { exact: true }).waitFor();
  log('网页语境真实回到原文、没有听原句入口，独立释义仍可编辑');
  await book.getByRole('button', { name: '开始复习', exact: true }).click(); await book.getByRole('button', { name: '查看中文答案', exact: true }).waitFor();
  assert.equal(await book.locator('.fw-review-answer').count(), 0); assert.equal(await book.getByRole('button', { name: '听原句 ↗', exact: true }).count(), 0); assert.equal(await book.getByRole('button', { name: '回到原文 ↗', exact: true }).count(), 1);
  await book.screenshot({ path: 'test-results/ui-v07-web-review.png', fullPage: true }); await book.getByRole('button', { name: '查看中文答案', exact: true }).click(); await book.getByRole('button', { name: '记住了', exact: true }).click();
  await book.getByRole('button', { name: '返回词本', exact: true }).first().click();
  await book.getByRole('button', { name: /^全部收藏/ }).click(); await book.getByLabel('搜索单词本').fill('Camera design'); await book.waitForFunction(() => document.querySelectorAll('.book-card').length === 1); assert.equal(await book.locator('.book-card h2').innerText(), 'telephoto lens'); assert.match(await book.locator('.book-direct-source').innerText(), /1:05/);
  await book.getByLabel('搜索单词本').fill(''); await book.getByRole('button', { name: /^视频来源/ }).click(); await book.waitForFunction(() => document.querySelectorAll('.book-card').length === 1); assert.match(await book.locator('.book-card').innerText(), /telephoto lens/);
  log('网页本地复习默认隐藏中文，来源标题搜索与旧视频真实时间保留');
  await book.getByRole('button', { name: /^全部收藏/ }).click(); await book.waitForFunction(() => document.querySelectorAll('.book-card').length === 3);
  await book.getByLabel('选择当前页全部条目').check(); await book.getByRole('button', { name: '批量分类', exact: true }).click(); await book.getByLabel('批量学习状态').selectOption('learning'); await book.getByRole('button', { name: '应用到所选条目', exact: true }).click(); await book.getByText('已更新 3 条收藏', { exact: true }).waitFor();
  await book.getByLabel('选择当前页全部条目').check(); await book.getByRole('button', { name: '删除所选', exact: true }).click(); await book.getByRole('button', { name: '撤销删除', exact: true }).click(); await book.getByText('已恢复 3 条收藏', { exact: true }).waitFor();
  const backup = await downloadBackup('导出单词本'); assert.equal(backup.version, 4); await book.locator('input[type=file]').setInputFiles({ name: 'v4-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) }); await book.getByText('已导入 3 条收藏', { exact: true }).waitFor();
  const restored = await rpc('FLOWWORD_BOOK_EXPORT', { query: {} }); assert.equal(restored.backup.archive.sources.length, 2); assert.ok(restored.backup.archive.captures.filter((capture) => capture.source.kind === 'web').every((capture) => !('time' in capture) && !('videoId' in capture)));
  await book.getByLabel('词本显示方式').selectOption('cards'); await book.getByLabel('单词本主题').selectOption('rose'); await book.reload(); await book.waitForFunction(() => document.querySelector('.book')?.dataset.theme === 'rose' && document.querySelector('.book')?.dataset.layout === 'cards');
  await book.getByLabel('单词本主题').selectOption('dark'); await book.getByLabel('词本显示方式').selectOption('list'); await book.setViewportSize({ width: 1600, height: 1000 }); await book.waitForFunction(() => document.querySelector('html')?.dataset.bookTheme === 'dark' && document.querySelector('.book')?.dataset.layout === 'list'); await book.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await book.waitForFunction(() => { const element = document.querySelector('.book-entry-status'); return element && getComputedStyle(element).color === 'rgb(237, 243, 237)' && getComputedStyle(element).backgroundColor === 'rgb(16, 29, 25)'; });
  const statusStyle = await book.locator('.book-entry-status').first().evaluate((element) => ({ color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor, appearance: getComputedStyle(element).appearance })); assert.deepEqual(statusStyle, { color: 'rgb(237, 243, 237)', background: 'rgb(16, 29, 25)', appearance: 'none' });
  await book.screenshot({ path: 'test-results/ui-v07-book-wide.png', fullPage: true });
  await book.setViewportSize({ width: 390, height: 844 }); assert.equal(await book.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); await book.screenshot({ path: 'test-results/ui-v07-book-narrow.png', fullPage: true });
  log('批量分类删除撤销、v4导入、主题和布局持久化、宽窄屏无溢出');
  const fixture = await readFile('tests/fixtures/player.html', 'utf8'); const media = await readFile('tests/fixtures/test-video.webm');
  await run.context.route('https://www.youtube.com/**', (route) => {
    if (new URL(route.request().url()).pathname !== '/flowword-test-video.webm') return route.fulfill({ contentType: 'text/html', body: fixture });
    const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/); const start = Number(range?.[1] || 0); const end = Math.min(media.length - 1, range?.[2] ? Number(range[2]) : media.length - 1);
    return route.fulfill({ status: range ? 206 : 200, contentType: 'video/webm', headers: { 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${media.length}` } : {}) }, body: media.subarray(start, end + 1) });
  });
  await run.worker.evaluate(() => chrome.storage.local.set({ 'flowword.enabled.v1': true })); const video = await run.context.newPage(); video.setDefaultTimeout(15000); await video.goto('https://www.youtube.com/watch?v=ui-v07-fixture');
  await video.getByRole('button', { name: '暂停视频并捕获字幕', exact: true }).click({ button: 'right' }); await video.getByRole('button', { name: '打开单词本', exact: true }).click(); await video.getByLabel('搜索悬浮单词本').fill('Design notes'); await video.waitForFunction(() => document.querySelector('flowword-ui')?.shadowRoot?.querySelectorAll('.fw-quick-book-list li').length === 2);
  assert.ok((await video.locator('.fw-quick-book-source').allTextContents()).every((text) => text.includes('回到原文') && !/\d+:\d\d/.test(text))); await video.screenshot({ path: 'test-results/ui-v07-quick.png', fullPage: true });
  await video.getByRole('button', { name: '查单词与词组', exact: true }).click(); await video.getByRole('region', { name: '查单词与词组' }).waitFor();
  await video.getByLabel('单词或词组', { exact: true }).fill('rule of thumb'); await video.getByRole('button', { name: '返回词本', exact: true }).click();
  assert.equal(await video.getByLabel('搜索悬浮单词本').inputValue(), 'Design notes');
  await video.getByRole('button', { name: '开始词句复习 · 不调用模型', exact: true }).click(); await video.getByRole('button', { name: '查看中文答案', exact: true }).waitFor(); assert.equal(await video.locator('.fw-review-answer').count(), 0); await video.screenshot({ path: 'test-results/ui-v07-quick-review.png', fullPage: true }); await video.close();
  log('悬浮词本按来源标题分页搜索，网页返回原文与轻量复习使用真实后台');
  await writeFile('test-results/ui-v07-report.json', JSON.stringify(report, null, 2));
} catch (error) { await book.screenshot({ path: 'test-results/ui-v07-failure.png', fullPage: true }).catch(() => {}); await writeFile('test-results/ui-v07-report.json', JSON.stringify({ ...report, failure: error.stack }, null, 2)); throw error; }
finally { await run.context.close(); }
