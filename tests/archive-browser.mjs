import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { launchTestBrowser } from '../scripts/test-browser.mjs';

const run = await launchTestBrowser();
const page = await run.context.newPage();
const cases = [];
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', (error) => { errors.push(error.message); console.error('PAGE ERROR', error.message); });
run.worker.on('console', (message) => console.log('WORKER', message.text()));
const log = (name) => { cases.push(name); console.log(`PASS ${name}`); };
async function bounded(promise, name) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${name} 超过 15 秒`)), 15000); })]); }
  finally { clearTimeout(timer); }
}
try {
  console.log('START archive page');
  await page.goto(`chrome-extension://${run.extensionId}/wordbook.html`);
  await page.getByLabel('视频分组').waitFor();
  console.log('READY archive page');
  const entry = (time, url = 'https://example.com/course?id=7') => ({ kind: 'word', text: 'telephoto', translation: '长焦的', partOfSpeech: '形容词', tags: ['科技'], examTags: [], contexts: [{ sentence: 'The camera uses a telephoto lens.', url, title: 'Camera lesson', time, translation: '相机使用长焦镜头' }] });
  for (let time = 0; time < 10; time++) {
    const result = await bounded(page.evaluate((entry) => chrome.runtime.sendMessage({ type: 'FLOWWORD_BOOK_SAVE', entry }), entry(time)), `收藏 ${time}`);
    assert.equal(result.ok, true);
    console.log(`SAVED context ${time}`);
  }
  const other = await page.evaluate((entry) => chrome.runtime.sendMessage({ type: 'FLOWWORD_BOOK_SAVE', entry }), entry(20, 'https://example.org/video/2'));
  assert.equal(other.ok, true);
  await page.reload();
  await page.getByText('Camera lesson · 0:00', { exact: true }).waitFor({ state: 'attached' });
  const sourceCount = await page.locator('.book-source').count(); assert.equal(sourceCount, 11);
  log('同词 11 个语境跨两个视频保存，超过旧库八个语境限制仍完整归档');
  await page.getByLabel('视频分组').selectOption({ index: 1 });
  assert.equal(await page.getByLabel('排序方式').inputValue(), 'time');
  assert.equal(await page.locator('.book-source').count(), 10);
  log('按视频筛选关联词条并切换视频时间排序');
  await page.getByLabel('单词本主题').selectOption('lavender'); await page.reload();
  await page.waitForFunction(() => document.querySelector('.book')?.dataset.theme === 'lavender');
  log('单词本紫藤主题重载后持久化');
  const downloadEvent = page.waitForEvent('download'); await page.getByRole('button', { name: '导出单词本' }).click();
  const download = await downloadEvent; const path = await download.path(); const { readFile } = await import('node:fs/promises'); const backup = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(backup.version, 2); assert.equal(backup.archive.occurrences.length, 11);
  await page.getByRole('button', { name: '删除条目' }).click();
  await page.getByText('还没有条目。', { exact: false }).waitFor();
  await page.locator('input[type=file]').setInputFiles({ name: 'FlowWord-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await page.getByText('Camera lesson · 0:00', { exact: true }).waitFor({ state: 'attached' });
  assert.equal(await page.locator('.book-source').count(), 11);
  log('JSON v2 导出、删除、导入恢复全部跨视频语境');
  const legacy = { version: 1, entries: [{ ...entry(3), kind: 'sentence', text: 'A sentence worth keeping.', translation: '值得留下的一句话', partOfSpeech: '句子', contexts: [{ sentence: 'A sentence worth keeping.', url: 'https://example.com/course?id=7', title: 'Camera lesson', time: 3, translation: '值得留下的一句话' }] }] };
  await page.locator('input[type=file]').setInputFiles({ name: 'legacy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacy)) });
  await page.getByRole('heading', { name: 'A sentence worth keeping.' }).waitFor();
  log('旧版 JSON v1 可导入整句并关联视频');
  const saveContext = async (translation, videoKey, end) => {
    const item = { ...entry(31, 'https://example.net/watch'), text: 'charge', translation, contexts: [{ sentence: 'A different charge.', url: 'https://example.net/watch', time: 31, end, videoKey, title: videoKey }] };
    const result = await bounded(page.evaluate((entry) => chrome.runtime.sendMessage({ type: 'FLOWWORD_BOOK_SAVE', entry }), item), '多义语境收藏'); assert.equal(result.ok, true); return result.entry;
  };
  await saveContext('收费', 'media-a', 34); const charge = await saveContext('充电', 'media-b', 36);
  const renamed = await page.evaluate((entry) => chrome.runtime.sendMessage({ type: 'FLOWWORD_BOOK_SAVE', entry: { ...entry, text: 'charged', lemma: 'charged' }, replaceId: entry.id }), charge); assert.equal(renamed.ok, true);
  await page.reload();
  const newDownloadEvent = page.waitForEvent('download'); await page.getByRole('button', { name: '导出单词本' }).click();
  const newDownload = await newDownloadEvent; const newBackup = JSON.parse(await readFile(await newDownload.path(), 'utf8'));
  const meanings = newBackup.archive.occurrences.filter((item) => item.entryId === 'word:charged').map((item) => item.translation).sort();
  assert.deepEqual(meanings, ['充电', '收费']);
  assert.deepEqual(newBackup.archive.captures.filter((item) => ['media-a', 'media-b'].includes(item.videoId)).map((item) => item.end).sort(), [34, 36]);
  log('同词两种语境释义在再次收藏与改名后各自保留');
  const renamedDelete = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'FLOWWORD_BOOK_DELETE', id: 'word:charged' })); assert.equal(renamedDelete.ok, true);
  await page.locator('input[type=file]').setInputFiles({ name: 'multimedia-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(newBackup)) });
  await page.getByRole('heading', { name: 'charged', exact: true }).waitFor();
  const restoredDownloadEvent = page.waitForEvent('download'); await page.getByRole('button', { name: '导出单词本' }).click();
  const restoredDownload = await restoredDownloadEvent; const restoredBackup = JSON.parse(await readFile(await restoredDownload.path(), 'utf8'));
  const mediaCaptures = restoredBackup.archive.captures.filter((item) => ['media-a', 'media-b'].includes(item.videoId));
  assert.equal(mediaCaptures.length, 2); assert.deepEqual(mediaCaptures.map((item) => item.end).sort(), [34, 36]);
  assert.deepEqual(restoredBackup.archive.occurrences.filter((item) => item.entryId === 'word:charged').map((item) => item.translation).sort(), ['充电', '收费']);
  log('v2 导入保留同页面不同媒体身份、结束时间与语境词义');
  await mkdir('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/wordbook-v03.png', fullPage: true });
  await writeFile('test-results/archive-report.json', JSON.stringify({ environment: 'isolated production extension IndexedDB; synthetic videos only', cases }, null, 2));
  console.log(`PASS ${cases.length} archive browser cases`);
} catch (error) {
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/archive-failure.png', fullPage: true }).catch(() => {});
  await writeFile('test-results/archive-report.json', JSON.stringify({ cases, errors, failure: error.stack, page: await page.locator('body').innerText().catch(() => '') }, null, 2));
  throw error;
} finally { await run.context.close(); }
