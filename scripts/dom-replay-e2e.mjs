import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { launchTestBrowser } from './test-browser.mjs';
const fixture = await readFile('tests/fixtures/player.html', 'utf8');
const media = await readFile('tests/fixtures/test-video.webm');
const report = { realYouTube: false, environment: '生产扩展 + 自建动态DOM字幕 + 真实有限HTMLVideoElement', cases: [], errors: [] };
const run = await launchTestBrowser();
let page;
// command 发送真实生产命令协议，参数是重听或暂停恢复，不冒充操作系统按键
async function command(command) {
  return run.worker.evaluate(async (command) => { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); return chrome.tabs.sendMessage(tab.id, { type: 'FLOWWORD_COMMAND', command }); }, command);
}
try {
  await run.context.route('https://www.youtube.com/**', async (route) => {
    if (new URL(route.request().url()).pathname !== '/flowword-test-video.webm') return route.fulfill({ contentType: 'text/html', body: fixture });
    const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
    if (!range) return route.fulfill({ contentType: 'video/webm', headers: { 'Accept-Ranges': 'bytes' }, body: media });
    const start = Number(range[1]); const end = Math.min(media.length - 1, range[2] ? Number(range[2]) : media.length - 1);
    return route.fulfill({ status: 206, contentType: 'video/webm', body: media.subarray(start, end + 1), headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${media.length}` } });
  });
  await run.worker.evaluate(() => chrome.storage.local.set({ 'flowword.enabled.v1': true, 'flowword.onlineTranslation.v1': false }));
  page = await run.context.newPage(); page.on('pageerror', (error) => report.errors.push(error.message));
  await page.goto('https://www.youtube.com/watch?v=owned-dom-replay');
  await page.getByRole('button', { name: '暂停视频并捕获字幕' }).waitFor();
  await page.evaluate(async () => {
    const video = document.querySelector('video');
    const update = () => window.testCaption(video.currentTime < 4 ? 'I came across a rather obscure reference.' : 'A following sentence starts now.');
    video.addEventListener('timeupdate', update); video.addEventListener('seeked', update);
    update(); await video.play();
  });
  await page.waitForFunction(() => document.querySelector('video').currentTime >= 1.1);
  await command('toggle-playback');
  await page.waitForFunction(() => document.querySelector('flowword-ui')?.shadowRoot?.querySelector('[data-phase=READY]'));
  const captured = await page.locator('video.html5-main-video').evaluate((video) => video.currentTime);
  assert.ok(captured < 2.5, String(captured));
  await command('repeat-sentence');
  await page.waitForFunction((captured) => { const video = document.querySelector('video'); return !video.paused && video.currentTime > captured + 0.55; }, captured);
  assert.ok(await page.locator('flowword-ui .fw-sentence').textContent());
  await page.waitForFunction(() => { const video = document.querySelector('video'); return video.paused && video.currentTime >= 4; });
  const stopped = await page.locator('video.html5-main-video').evaluate((video) => video.currentTime);
  assert.ok(stopped < 4.6, String(stopped));
  report.cases.push({ name: 'DOM重听越过点击观测终点，在实际下一字幕转换后暂停且面板保留', passed: true, captured, stopped });
  await command('toggle-playback');
  assert.equal(await page.locator('video.html5-main-video').evaluate((video) => video.paused), false);
  report.cases.push({ name: '重听暂停归属可由用户显式一键恢复', passed: true });
  await page.locator('video.html5-main-video').evaluate((video) => { video.currentTime = 1; });
  await page.waitForTimeout(300); await command('toggle-playback'); await command('repeat-sentence');
  await page.locator('video.html5-main-video').evaluate((video) => { video.currentTime = 10; });
  await page.waitForFunction(() => document.querySelector('flowword-ui')?.shadowRoot?.querySelector('[data-phase=IDLE]'));
  await page.waitForTimeout(300);
  assert.equal(await page.locator('video.html5-main-video').evaluate((video) => video.paused), false);
  report.cases.push({ name: 'DOM重听外部跳转立即取消，不会延迟误暂停', passed: true });
  assert.deepEqual(report.errors, []);
} catch (error) { report.errors.push(error.stack || String(error)); console.error(error); process.exitCode = 1; }
finally { report.passed = !report.errors.length; await mkdir('test-results', { recursive: true }); await writeFile('test-results/dom-replay-report.json', JSON.stringify(report, null, 2)); await run.context.close(); }
