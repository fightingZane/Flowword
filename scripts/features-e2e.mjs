import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchTestBrowser } from './test-browser.mjs';

const fixture = await readFile('tests/fixtures/player.html', 'utf8');
const media = await readFile('tests/fixtures/test-video.webm');
const report = { environment: 'Production MV3 extension with native WebM and IndexedDB', subtitles: 'synthetic fixture', translationProvider: 'mocked responses, not live service evidence', cases: [], errors: [] };
await mkdir('test-results', { recursive: true });
let run = await launchTestBrowser();
let page;
const log = (name) => { report.cases.push({ name, passed: true }); console.log(`PASS ${name}`); };
const ball = () => page.getByRole('button', { name: '暂停视频并捕获字幕' });
const pause = () => page.locator('video.html5-main-video').evaluate((video) => video.paused);
const ready = () => page.waitForFunction(() => document.querySelector('flowword-ui')?.shadowRoot?.querySelector('[data-phase="READY"]'));
const idle = () => page.waitForFunction(() => document.querySelector('flowword-ui')?.shadowRoot?.querySelector('[data-phase="IDLE"]'));

async function setup() {
  await run.context.route('https://www.youtube.com/**', (route) => {
    if (new URL(route.request().url()).pathname !== '/flowword-test-video.webm') return route.fulfill({ contentType: 'text/html', body: fixture });
    const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
    if (!range) return route.fulfill({ contentType: 'video/webm', headers: { 'Accept-Ranges': 'bytes' }, body: media });
    const start = Number(range[1]); const end = Math.min(media.length - 1, range[2] ? Number(range[2]) : media.length - 1);
    return route.fulfill({ status: 206, contentType: 'video/webm', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${media.length}` }, body: media.subarray(start, end + 1) });
  });
  page = await run.context.newPage();
  page.on('pageerror', (error) => report.errors.push(error.message));
  await page.goto('https://www.youtube.com/watch?v=features-fixture');
  await page.waitForFunction(() => document.querySelector('video.html5-main-video').readyState >= 2);
  await run.worker.evaluate(() => chrome.storage.local.set({ 'flowword.enabled.v1': true }));
  await ball().waitFor();
}

async function inputValue(locator, value) {
  await locator.evaluate((input, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

try {
  await setup();
  await run.worker.evaluate(() => {
    globalThis.translationRequests = [];
    globalThis.translationFailure = false;
    globalThis.translationDelay = 0;
    globalThis.fetch = async (url, options) => {
      const parsed = new URL(url);
      globalThis.translationRequests.push({ origin: parsed.origin, query: [...parsed.searchParams.keys()], text: parsed.searchParams.get('q'), credentials: options.credentials, referrer: options.referrerPolicy });
      if (globalThis.translationDelay) await new Promise((resolve) => setTimeout(resolve, globalThis.translationDelay));
      if (globalThis.translationFailure) throw new Error('测试模拟服务离线');
      const translations = { 'I came across a rather obscure reference.': '我偶然发现了一条相当冷门的参考资料。', obscure: '晦涩的；冷门的', reference: '参考资料' };
      const translatedText = translations[parsed.searchParams.get('q')] ?? `测试参考义：${parsed.searchParams.get('q')}`;
      return new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText } }), { status: 200 });
    };
  });
  await page.locator('#play').click();
  await ball().click(); await ready();
  assert.ok(await page.locator('flowword-ui .fw-candidate').count() >= 2);
  assert.match(await page.getByRole('dialog').innerText(), /联网翻译尚未开启/);
  assert.equal((await run.worker.evaluate(() => globalThis.translationRequests)).length, 0);
  const font = await page.locator('flowword-ui .fw-context-note').first().evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
  assert.ok(font >= 14);
  await page.getByRole('button', { name: '继续播放并关闭翻译框' }).click(); await idle();
  assert.equal(await pause(), false);
  log('放大默认字体，离线本地排序不上传，再次左键继续并关闭');

  await ball().click({ button: 'right' });
  await page.getByRole('dialog', { name: 'FlowWord 配置框' }).waitFor();
  assert.equal(await pause(), false);
  await inputValue(page.getByLabel(/字体大小/), '20');
  assert.equal(await page.getByLabel('悬浮球定位').inputValue(), 'free');
  await page.getByLabel('悬浮球定位').selectOption('edge');
  await page.waitForFunction(() => document.querySelector('flowword-ui')?.shadowRoot?.querySelector('select')?.closest('.fw-settings') !== null);
  await page.waitForTimeout(150);
  const ballBox = await ball().boundingBox();
  await page.mouse.move(ballBox.x + 27, ballBox.y + 27);
  await page.mouse.down(); await page.mouse.move(250, 320, { steps: 12 }); await page.mouse.up();
  assert.equal(Math.round((await ball().boundingBox()).x), 14);
  assert.equal(await pause(), false);
  await page.getByLabel('悬浮球定位').selectOption('free');
  await page.waitForFunction(() => document.querySelector('flowword-ui')?.shadowRoot?.querySelector('.fw-app')?.style.getPropertyValue('--fw-font') === '20px');
  await page.getByLabel('翻译框主题').selectOption('blue');
  await inputValue(page.getByLabel('悬浮球颜色'), '#cc3344');
  await page.getByLabel('悬浮球风格').selectOption('outline');
  await page.waitForFunction(() => document.querySelector('flowword-ui')?.shadowRoot?.querySelector('[data-ball-style="outline"]'));
  assert.equal(await pause(), false);
  await page.screenshot({ path: resolve('test-results/configuration.png') });
  const scroll = await page.locator('.fw-body').evaluate((element) => {
    const style = getComputedStyle(element);
    return { width: style.scrollbarWidth, color: style.scrollbarColor, paper: style.backgroundColor };
  });
  assert.equal(scroll.width, 'thin');
  assert.notEqual(scroll.color, 'auto');
  log('右键只配置不暂停，字体主题颜色和风格实时生效');

  const network = page.getByLabel('联网翻译总开关');
  assert.equal(await network.isChecked(), false);
  assert.match(await page.getByRole('dialog').innerText(), /可能长期保存/);
  await network.check();
  await page.waitForFunction(() => document.querySelector('flowword-ui')?.shadowRoot?.querySelector('.fw-network-setting input')?.checked === true);
  await page.getByRole('button', { name: '配置完成' }).click();
  await ball().click(); await ready();
  await page.waitForFunction(() => document.querySelector('flowword-ui')?.shadowRoot?.querySelector('.fw-translation')?.textContent.includes('参考资料'));
  const requests = await run.worker.evaluate(() => globalThis.translationRequests);
  assert.ok(requests.length >= 1);
  assert.match(await page.getByRole('dialog').innerText(), /形容词：鲜为人知的/);
  assert.match(await page.getByRole('dialog').innerText(), /未按当前语境消歧/);
  for (const request of requests) { assert.equal(request.origin, 'https://api.mymemory.translated.net'); assert.deepEqual(request.query.sort(), ['langpair', 'q']); assert.equal(request.credentials, 'omit'); assert.equal(request.referrer, 'no-referrer'); }
  await page.screenshot({ path: resolve('test-results/translation-v02.png') });
  log('主动开启后整句和候选译文贯通，固定服务请求不含URL或历史');

  const book = await run.context.newPage();
  book.on('pageerror', (error) => report.errors.push(error.message));
  await book.goto(`chrome-extension://${run.extensionId}/wordbook.html`);
  await book.locator('.book-empty').waitFor();
  await page.bringToFront();   // 先打开空词本，再从视频中加入，验证返回时刷新

  await page.getByRole('button', { name: '加入单词本 obscure', exact: true }).click();
  await page.getByLabel('词汇类型', { exact: true }).selectOption('形容词');
  await page.getByLabel('词义辨析', { exact: true }).check();
  await page.getByLabel('六级', { exact: true }).check();
  await page.getByLabel('自定义标签', { exact: true }).fill('技术英语，工作表达');
  await page.getByRole('button', { name: '保存到单词本' }).click();
  await page.waitForFunction(() => !document.querySelector('flowword-ui')?.shadowRoot?.querySelector('form'));
  assert.equal(await page.getByRole('button', { name: '加入单词本 obscure', exact: true }).innerText(), '已加入');
  await page.getByRole('button', { name: '收藏整句', exact: true }).click();
  await page.getByLabel('听力理解', { exact: true }).check();
  await page.getByRole('button', { name: '保存到单词本' }).click();
  await page.waitForFunction(() => !document.querySelector('flowword-ui')?.shadowRoot?.querySelector('form'));
  log('从翻译框保存单词与语句，并设置词性、多个考点和自定义标签');
  await page.reload(); await ball().waitFor(); await page.locator('#play').click(); await ball().click(); await ready();
  await page.waitForFunction(() => document.querySelector('flowword-ui')?.shadowRoot?.querySelector('.fw-candidate button')?.textContent === '已加入' || Array.from(document.querySelector('flowword-ui')?.shadowRoot?.querySelectorAll('.fw-candidate button') ?? []).some((button) => button.textContent === '已加入'));
  assert.equal(await page.getByRole('button', { name: '加入单词本 obscure', exact: true }).innerText(), '已加入');

  await book.bringToFront();
  await book.waitForFunction(() => document.querySelectorAll('.book-card').length === 2);
  await book.getByLabel('条目类型筛选').selectOption('word');
  await book.getByLabel('词汇类型筛选').selectOption('形容词');
  await book.getByLabel('考点筛选').selectOption('六级');
  await book.getByLabel('标签筛选').selectOption('技术英语');
  assert.equal(await book.locator('.book-card').count(), 1);
  assert.match(await book.locator('.book-card').innerText(), /obscure/);
  await book.getByRole('button', { name: '编辑分类' }).click();
  await book.getByLabel('六级', { exact: true }).uncheck();
  await book.getByLabel('写作表达', { exact: true }).check();
  await book.getByRole('button', { name: '保存到单词本' }).click();
  await book.waitForFunction(() => !document.querySelector('.book-editor'));
  assert.equal(await book.locator('.book-card').count(), 0);
  await book.getByLabel('考点筛选').selectOption('写作表达');
  assert.equal(await book.locator('.book-card').count(), 1);
  await book.evaluate(() => chrome.runtime.sendMessage({ type: 'FLOWWORD_BOOK_SAVE', entry: {
    kind: 'word', text: 'standpoint', translation: '观点；立场', partOfSpeech: '名词', examTags: ['写作表达'], tags: ['新加入'], contexts: [] } }));
  // 不先刷新页面，导出本身必须读取最新数据库，才能包含第三条
  const downloadReady = book.waitForEvent('download');
  await book.getByRole('button', { name: '导出单词本' }).click();
  const download = await downloadReady;
  await download.saveAs(resolve('test-results/wordbook-export.json'));
  const exported = JSON.parse(await readFile('test-results/wordbook-export.json', 'utf8'));
  assert.equal(exported.entries.length, 3);
  assert.deepEqual(exported.entries.find((entry) => entry.text === 'obscure').examTags.sort(), ['词义辨析', '写作表达'].sort());
  await book.screenshot({ path: resolve('test-results/wordbook.png') });
  log('已打开词本返回刷新、多维筛选、编辑移除标签、导出新加入数据通过');

  await page.bringToFront();
  await page.getByRole('button', { name: '继续播放并关闭翻译框' }).click(); await idle();
  await run.worker.evaluate(() => { globalThis.translationDelay = 250; });
  await page.evaluate(() => window.testCaption('An ambiguous interpretation is unprecedented.'));
  await ball().click(); await ready();
  assert.equal(await page.getByRole('button', { name: '查参考义', exact: true }).count(), 0);
  await page.getByRole('button', { name: '继续播放并关闭翻译框' }).click(); await idle();
  assert.equal(await pause(), false);
  await page.evaluate(() => window.testCaption('A resilient strategy sounds counterintuitive.'));
  await ball().click(); await ready();
  assert.doesNotMatch(await page.getByRole('dialog').innerText(), /暂无参考释义/);
  await page.waitForFunction(() => document.querySelector('flowword-ui')?.shadowRoot?.querySelector('.fw-translation')?.textContent.includes('resilient'));
  assert.doesNotMatch(await page.locator('flowword-ui .fw-translation').innerText(), /ambiguous/);
  log('翻译途中左键可继续，换句不显示空义卡片，旧译文不覆盖新句');
  await page.getByRole('button', { name: '继续播放并关闭翻译框' }).click(); await idle();
  await ball().click({ button: 'right' });
  await page.getByLabel('联网翻译总开关').uncheck();
  await page.getByRole('button', { name: '配置完成' }).click();
  const beforeDisabled = (await run.worker.evaluate(() => globalThis.translationRequests)).length;
  await ball().click(); await ready();
  assert.equal((await run.worker.evaluate(() => globalThis.translationRequests)).length, beforeDisabled);
  await page.getByRole('button', { name: '继续播放并关闭翻译框' }).click(); await idle();
  log('关闭联网开关后不产生新服务请求');

  const profile = run.profile;
  await run.context.close(); run = await launchTestBrowser({ profile });
  await setup();
  await ball().click({ button: 'right' });
  assert.equal(await page.getByLabel('翻译框主题').inputValue(), 'blue');
  assert.equal(await page.getByLabel('悬浮球风格').inputValue(), 'outline');
  assert.equal(await page.getByLabel('悬浮球颜色').inputValue(), '#cc3344');
  assert.equal(await page.getByLabel('联网翻译总开关').isChecked(), false);
  const reopened = await run.context.newPage();
  await reopened.goto(`chrome-extension://${run.extensionId}/wordbook.html`);
  await reopened.waitForFunction(() => document.querySelectorAll('.book-card').length === 3);
  assert.equal(await reopened.locator('.book-card').count(), 3);
  log('关闭重启浏览器后，外观设置与IndexedDB单词本均保留');
  assert.deepEqual(report.errors, []); report.passed = true;
} catch (error) {
  report.passed = false; report.failure = error.stack; console.error(error); process.exitCode = 1;
  if (page && !page.isClosed()) await page.screenshot({ path: resolve('test-results/features-failure.png') }).catch(() => {});
} finally { await writeFile('test-results/features-report.json', JSON.stringify(report, null, 2)); await run.context.close(); }
