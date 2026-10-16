import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { launchTestBrowser } from './test-browser.mjs';

const run = await launchTestBrowser(); const page = await run.context.newPage(); page.setDefaultTimeout(15000);
const report = { environment: 'production MV3 extension, isolated synthetic local wordbook, no model calls', cases: [], errors: [] };
page.on('pageerror', (error) => report.errors.push(error.message));
// log 表示记录验收项目，name 是断言通过后的中文说明
const log = (name) => { report.cases.push(name); console.log(`PASS ${name}`); };
// rpc 表示从可信词本页调用后台，type 和 payload 与真实界面一致，不直接修改数据库
async function rpc(type, payload = {}) { const result = await page.evaluate((message) => chrome.runtime.sendMessage(message), { type, ...payload }); assert.equal(result.ok, true, result.error); return result; }
// exported 表示点击备份按钮并读取下载，name 是按钮可访问名称，返回完整 JSON
async function exported(name) { const waiting = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click(); const download = await waiting; return JSON.parse(await readFile(await download.path(), 'utf8')); }
try {
  const thumbnailRequests = []; await run.context.route('https://i.ytimg.com/**', (route) => { thumbnailRequests.push(route.request().url()); return route.fulfill({ status: 404, body: '' }); });
  await page.goto(`chrome-extension://${run.extensionId}/wordbook.html`);
  for (const [index, text] of ['charge', 'telephoto lens', 'A whole sentence worth recalling.'].entries()) {
    await rpc('FLOWWORD_BOOK_SAVE', { entry: { text, kind: index === 2 ? 'sentence' : index === 1 ? 'phrase' : 'word', translation: ['收费', '长焦镜头', '值得回想的完整句子'][index], partOfSpeech: '名词', examTags: [], tags: ['科技'], contexts: [{ sentence: `This example mentions ${text}`, url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Camera principles', time: 5 + index * 10, end: 9 + index * 10, translation: '这是原句中文' }] } });
  }
  await rpc('FLOWWORD_BOOK_SAVE', { entry: { text: 'charge', kind: 'word', translation: '充电', partOfSpeech: '动词', examTags: [], tags: [], contexts: [{ sentence: 'Charge your phone before leaving.', url: 'https://example.com/lesson/2', title: 'Everyday electronics', time: 42, end: 46, translation: '出门之前给手机充电' }] } });
  await page.reload(); await page.getByRole('heading', { name: 'charge', exact: true }).waitFor();
  assert.equal(await page.locator('.book').getAttribute('data-layout'), 'list');
  await page.getByLabel('词本显示方式').selectOption('cards'); await page.reload();
  await page.waitForFunction(() => document.querySelector('.book')?.dataset.layout === 'cards');
  await page.getByLabel('词本显示方式').selectOption('list');
  assert.match(await page.locator('.book-direct-source').first().innerText(), /· \d+:\d\d/);
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.book-video-links')).some((item) => item.textContent.includes('封面暂不可用')) || document.querySelectorAll('.book-video img').length > 0);
  assert.ok(thumbnailRequests.length >= 1); await page.getByLabel('自动加载视频封面').uncheck(); await page.reload();
  await page.getByRole('heading', { name: 'charge', exact: true }).waitFor(); assert.equal(await page.getByLabel('自动加载视频封面').isChecked(), false); assert.equal(await page.locator('.book-video img').count(), 0);
  log('少量优先列表、卡片选择持久化、来源时间直接展示、自动封面可关闭');
  assert.equal(await page.locator('.book-sidebar .book-thumbnail-option, .book-privacy-note, .book-sidebar-caption, .book-eyebrow').count(), 0);
  await page.getByLabel('搜索单词本', { exact: true }).fill('ELECTRONICS everyday');
  await page.waitForFunction(() => document.querySelectorAll('.book-card').length === 1);
  assert.equal(await page.locator('.book-card h2').innerText(), 'charge');
  await page.getByLabel('搜索单词本', { exact: true }).fill('principles CAMERA');
  await page.waitForFunction(() => document.querySelectorAll('.book-card').length === 3);
  await page.getByLabel('搜索单词本', { exact: true }).fill('');
  log('侧栏去除说明小字，完整词本搜索视频标题关键词并忽略词序大小写');

  const charge = page.locator('.book-card').filter({ has: page.getByRole('heading', { name: 'charge', exact: true }) });
  await charge.getByText('查看来源语境', { exact: true }).click(); await charge.locator('.book-source').nth(1).waitFor();
  const first = charge.locator('.book-source').first(); const secondText = await charge.locator('.book-source').nth(1).innerText();
  await first.getByRole('button', { name: '编辑这条语境释义' }).click(); await first.getByLabel('当前语境释义').fill('只修改这条语境的中文'); await first.getByRole('button', { name: '保存这条语境' }).click();
  await first.getByText('该语境释义：只修改这条语境的中文', { exact: true }).waitFor(); assert.equal(await charge.locator('.book-source').nth(1).innerText(), secondText);
  log('当前语境释义独立修改，同词其他来源释义保持不变');
  await page.getByLabel('学习状态 charge', { exact: true }).selectOption('mastered'); await page.getByLabel('学习状态筛选').selectOption('mastered');
  await page.waitForFunction(() => document.querySelectorAll('.book-card').length === 1); assert.equal(await page.locator('.book-card h2').innerText(), 'charge');
  await page.getByLabel('学习状态筛选').selectOption(''); await page.waitForFunction(() => document.querySelectorAll('.book-card').length === 3);
  await page.getByLabel('选择当前页全部条目').check(); await page.getByRole('button', { name: '批量分类', exact: true }).click();
  await page.getByLabel('批量自定义标签').fill('统一标签'); await page.getByLabel('批量学习状态').selectOption('learning'); await page.getByRole('button', { name: '应用到所选条目' }).click();
  await page.getByText('已更新 3 条收藏', { exact: true }).waitFor(); await page.getByLabel('标签筛选').selectOption('统一标签'); assert.equal(await page.locator('.book-card').count(), 3);
  await page.getByLabel('选择当前页全部条目').check(); await page.getByRole('button', { name: '删除所选', exact: true }).click(); await page.getByText('已删除 3 条收藏，可撤销', { exact: false }).waitFor();
  await page.getByRole('button', { name: '撤销删除', exact: true }).click(); await page.getByText('已恢复 3 条收藏', { exact: true }).waitFor(); await page.waitForFunction(() => document.querySelectorAll('.book-card').length === 3);
  log('学习状态筛选、批量分类及删除撤销完整恢复');
  await page.getByLabel('视频分组').selectOption({ label: 'Camera principles' }); const videoBackup = await exported('导出当前视频');
  assert.equal(videoBackup.archive.videos.length, 1); assert.equal(videoBackup.entries.length, 3); assert.ok(videoBackup.archive.captures.every((capture) => capture.url.includes('youtube.com')));
  log('按当前视频导出，只包含该视频语境');
  await page.getByLabel('视频分组').selectOption('');
  const fetchesBefore = await run.worker.evaluate(() => globalThis.reviewFetchCount = 0);
  await run.worker.evaluate(() => { const original = globalThis.fetch; globalThis.fetch = (...args) => { globalThis.reviewFetchCount++; return original(...args); }; });
  await page.getByRole('button', { name: '开始复习', exact: true }).click(); await page.getByRole('button', { name: '查看中文答案', exact: true }).waitFor();
  assert.equal(await page.locator('.fw-review-answer').count(), 0); const forgotten = await page.locator('.fw-review-card h3').innerText();
  await page.getByRole('button', { name: '查看中文答案', exact: true }).click(); assert.equal(await page.locator('.fw-review-answer').count(), 1); await page.getByRole('button', { name: '忘了', exact: true }).click();
  for (let index = 0; index < 2; index++) { await page.getByRole('button', { name: '查看中文答案', exact: true }).click(); await page.getByRole('button', { name: '记住了', exact: true }).click(); }
  await page.locator('.fw-review-card h3').filter({ hasText: forgotten }).waitFor(); assert.equal(await page.locator('.fw-review-card h3').innerText(), forgotten);
  await page.getByRole('button', { name: '查看中文答案', exact: true }).click(); await page.getByRole('button', { name: '忘了', exact: true }).click();
  await page.getByRole('heading', { name: '本次完成 3 条', exact: true }).waitFor();
  assert.equal(await run.worker.evaluate(() => globalThis.reviewFetchCount), fetchesBefore);
  const review = await rpc('FLOWWORD_BOOK_QUERY', { query: { status: 'learning', limit: 100 } }); assert.ok(review.entries.some((entry) => entry.review?.nextReviewAt || entry.review?.dueAt || entry.review?.due));
  log('回忆先隐藏中文、忘了每词补一次、按不重复词数完成、保存下次计划且不调用模型');
  await mkdir('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/wordbook-review-v06.png', fullPage: true });
  await page.getByRole('button', { name: '返回词本', exact: true }).first().click(); await page.screenshot({ path: 'test-results/wordbook-list-v06.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); await page.screenshot({ path: 'test-results/wordbook-narrow-v06.png', fullPage: true });
  await rpc('FLOWWORD_BOOK_IMPORT', { backup: { version: 1, entries: Array.from({ length: 65 }, (_, index) => ({ kind: 'word', text: `quick word ${index}`, translation: `分页测试释义 ${index}`, partOfSpeech: '名词', contexts: [], tags: [], examTags: [] })) } });
  await page.getByLabel('标签筛选').selectOption(''); await page.waitForFunction(() => document.querySelectorAll('.book-card').length === 40);
  await page.getByRole('navigation', { name: '词本分页' }).getByRole('button', { name: '下一页' }).click(); await page.waitForFunction(() => document.querySelectorAll('.book-card').length === 28);
  log('完整词本分页固定四十条，大词本下一页无全量渲染');
  const fixture = await readFile('tests/fixtures/player.html', 'utf8'); const media = await readFile('tests/fixtures/test-video.webm');
  await run.context.route('https://www.youtube.com/**', (route) => {
    if (new URL(route.request().url()).pathname !== '/flowword-test-video.webm') return route.fulfill({ contentType: 'text/html', body: fixture });
    const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/); const start = Number(range?.[1] || 0); const end = Math.min(media.length - 1, range?.[2] ? Number(range[2]) : media.length - 1);
    return route.fulfill({ status: range ? 206 : 200, contentType: 'video/webm', headers: { 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${media.length}` } : {}) }, body: media.subarray(start, end + 1) });
  });
  await run.worker.evaluate(() => chrome.storage.local.set({ 'flowword.enabled.v1': true }));
  const videoPage = await run.context.newPage(); videoPage.setDefaultTimeout(15000); await videoPage.goto('https://www.youtube.com/watch?v=quick-v06-fixture');
  await videoPage.getByRole('button', { name: '暂停视频并捕获字幕', exact: true }).click({ button: 'right' });
  await run.worker.evaluate(() => { globalThis.quickQueryRequests = []; chrome.runtime.onMessage.addListener((message) => { if (message.type === 'FLOWWORD_BOOK_QUERY') globalThis.quickQueryRequests.push(message.query); }); });
  await videoPage.getByRole('button', { name: '打开单词本', exact: true }).click(); await videoPage.locator('.fw-quick-book-list li').nth(19).waitFor();
  assert.equal(await videoPage.locator('.fw-quick-book-list li').count(), 20);
  assert.ok((await run.worker.evaluate(() => globalThis.quickQueryRequests)).every((query) => query.limit === 20));
  await videoPage.getByLabel('搜索悬浮单词本').fill('quick word 64'); await videoPage.waitForFunction(() => document.querySelector('flowword-ui')?.shadowRoot?.querySelectorAll('.fw-quick-book-list li').length === 1);
  assert.equal(await videoPage.locator('.fw-quick-book-list strong').innerText(), 'quick word 64');
  await videoPage.getByRole('button', { name: '开始词句复习 · 不调用模型', exact: true }).click(); await videoPage.getByRole('button', { name: '查看中文答案', exact: true }).waitFor();
  assert.match(await videoPage.locator('.fw-review-progress').innerText(), /1 \/ 10/);
  const quickReviewWord = await videoPage.locator('.fw-review-card h3').innerText();
  await videoPage.getByRole('button', { name: '查看中文答案', exact: true }).click(); await videoPage.getByRole('button', { name: '有点模糊', exact: true }).click();
  await videoPage.waitForFunction(() => document.querySelector('flowword-ui')?.shadowRoot?.querySelector('.fw-review-progress')?.textContent.includes('2 / 10'));
  const quickGraded = await rpc('FLOWWORD_BOOK_QUERY', { query: { search: quickReviewWord, limit: 20 } }); assert.ok(quickGraded.entries.some((entry) => entry.text === quickReviewWord && entry.review?.lastGrade === 'uncertain'));
  await videoPage.screenshot({ path: 'test-results/quick-review-v06.png', fullPage: true }); await videoPage.close();
  log('悬浮词本请求最多二十条且全库可搜，内容脚本内十条复习与评分贯通');
  await writeFile('test-results/wordbook-v06-report.json', JSON.stringify(report, null, 2));
} catch (error) { await mkdir('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/wordbook-v06-failure.png', fullPage: true }).catch(() => {}); await writeFile('test-results/wordbook-v06-report.json', JSON.stringify({ ...report, failure: error.stack }, null, 2)); throw error; }
finally { await run.context.close(); }
