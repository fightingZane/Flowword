import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { launchTestBrowser } from './test-browser.mjs';

const run = await launchTestBrowser();
const cases = []; const errors = [];
const fixture = await readFile('tests/fixtures/player.html', 'utf8');
const media = await readFile('tests/fixtures/test-video.webm');
const log = (name) => { cases.push(name); console.log('PASS ' + name); };
let page;
try {
  await run.context.route('https://www.youtube.com/**', (route) => route.request().url().includes('.webm') ? route.fulfill({ contentType: 'video/webm', body: media }) : route.fulfill({ contentType: 'text/html', body: fixture }));
  page = await run.context.newPage(); page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('https://www.youtube.com/watch?v=upgrade-test');
  await run.worker.evaluate(() => chrome.storage.local.set({ 'flowword.enabled.v1': true }));
  const ball = page.getByRole('button', { name: '暂停视频并捕获字幕' }); await ball.waitFor();
  await page.locator('#play').click(); await ball.click();
  const panel = page.getByRole('dialog'); await page.getByRole('button', { name: '收藏整句' }).waitFor();
  const initial = await panel.boundingBox(); assert.equal(Math.round(initial.height), 620);
  await page.getByRole('button', { name: '配置', exact: true }).click();
  await page.getByLabel(/字体大小/).evaluate((input) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '24'); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForFunction(() => document.querySelector('flowword-ui')?.shadowRoot?.querySelector('.fw-app')?.style.getPropertyValue('--fw-font') === '24px');
  const large = await panel.boundingBox(); assert.equal(large.height, initial.height); assert.equal(large.width, initial.width);
  await page.getByLabel('翻译框主题').selectOption('purple'); await page.getByRole('button', { name: '配置完成' }).click();
  const header = await page.locator('flowword-ui .fw-header').boundingBox();
  await page.mouse.move(header.x + 80, header.y + 28); await page.mouse.down(); await page.mouse.move(header.x - 200, header.y + 28, { steps: 10 }); await page.mouse.up();
  const handle = await page.getByRole('button', { name: '拖动调整翻译框大小' }).boundingBox();
  await page.mouse.move(handle.x + 8, handle.y + 8); await page.mouse.down(); await page.mouse.move(handle.x + 108, handle.y - 72, { steps: 10 }); await page.mouse.up();
  const resized = await panel.boundingBox(); assert.ok(resized.width > initial.width + 80); assert.ok(resized.height < initial.height - 60);
  log('字号14–24与固定外框独立，鼠标自由调宽高，主题切换');
  await page.getByRole('button', { name: '收藏整句' }).click(); await page.getByRole('button', { name: '保存到单词本' }).click();
  log('当前原句旁固定收藏入口可保存整句');
  const settings = await run.context.newPage(); await settings.goto(`chrome-extension://${run.extensionId}/settings.html`);
  await settings.getByLabel('服务', { exact: true }).selectOption('cloud');
  await settings.getByLabel('HTTPS 接口完整地址').fill('https://api.mymemory.translated.net/v1/chat/completions');
  await settings.getByLabel('模型名称').fill('flowword-test-model'); await settings.getByLabel('API Key').fill('TEST-ONLY-DUMMY-KEY');
  await settings.getByRole('button', { name: '授权接口并保存' }).click(); await settings.getByText('配置已保存', { exact: false }).waitFor();
  await run.worker.evaluate(() => {
    globalThis.cloudRequests = [];
    globalThis.fetch = async (_url, options) => {
      const data = JSON.parse(options.body); globalThis.cloudRequests.push(data);
      const details = data.messages[0].content.includes('Explain up to');
      await new Promise((resolve) => setTimeout(resolve, details ? 900 : 80));
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(details ? { expressions: [{ text: 'came across', meaning: '句中表示偶然发现资料，而不是走过某处', partOfSpeech: '动词短语', kind: 'phrase', reason: '地道表达' }] } : { translation: '我偶然发现了一条相当冷门的参考资料。' }) } }] }), { status: 200 });
    };
  });
  await page.bringToFront(); await page.getByRole('button', { name: '继续播放并关闭翻译框' }).click(); await ball.waitFor(); await ball.click();
  await page.locator('flowword-ui .fw-translation').filter({ hasText: '冷门' }).waitFor();
  assert.equal(await page.locator('flowword-ui .fw-context-expression').count(), 0);
  await page.locator('flowword-ui .fw-context-expression').waitFor(); assert.match(await panel.innerText(), /而不是走过某处/);
  log('模拟云模型整句先展示，慢语境表达随后显示，表达定位到原句');
  const publicConfig = await settings.evaluate(() => chrome.runtime.sendMessage({ type: 'FLOWWORD_PROVIDER_PUBLIC' }));
  assert.ok(!JSON.stringify(publicConfig).includes('DUMMY')); assert.ok(!('apiKey' in publicConfig));
  const local = await settings.evaluate(() => chrome.storage.local.get(null)); assert.ok(!JSON.stringify(local).includes('DUMMY'));
  assert.equal(await page.locator('input[type=password]').count(), 0);
  log('密钥不进入网页、storage.local或公开设置消息');
  const before = await run.worker.evaluate(() => globalThis.cloudRequests.length);
  await page.getByRole('button', { name: '继续播放并关闭翻译框' }).click(); await ball.waitFor(); await ball.click();
  await page.locator('flowword-ui .fw-translation').waitFor();
  const calls = await run.worker.evaluate(() => globalThis.cloudRequests.length); assert.ok(calls <= before + 1);
  log('相同整句命中持久缓存，不重复整句请求');
  await page.screenshot({ path: 'test-results/upgrade-v03.png' });
  assert.deepEqual(errors, []);
} catch (error) { errors.push(error.stack); console.error(error); process.exitCode = 1; if (page) await page.screenshot({ path: 'test-results/upgrade-failure.png' }).catch(() => {}); }
finally { await mkdir('test-results', { recursive: true }); await writeFile('test-results/upgrade-report.json', JSON.stringify({ environment: 'Production MV3, synthetic subtitles and MOCK cloud API', cases, errors, passed: !errors.length }, null, 2)); await run.context.close(); }
