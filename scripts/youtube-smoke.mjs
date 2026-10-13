import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchTestBrowser } from './test-browser.mjs';

// 本脚本只验证真实公开视频，不登录账号、不改用户浏览器资料
const target = process.env.FLOWWORD_TEST_URL ?? 'https://www.youtube.com/watch?v=H14bBuluwB8';
const proxy = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;
const run = await launchTestBrowser({ browserOptions: proxy ? { proxy: { server: proxy } } : {} });
const report = { environment: 'Chromium with production extension, public YouTube page', url: target, results: [], status: 'pending' };
const page = await run.context.newPage();
report.captionNetwork = [];
page.on('response', async (response) => {
  const url = new URL(response.url());
  if (!url.pathname.includes('timedtext')) return;
  const bytes = await response.body().then((body) => body.length).catch(() => null);
  report.captionNetwork.push({ path: url.pathname, language: url.searchParams.get('lang'), status: response.status(), bytes });
});
page.on('requestfailed', (request) => {
  const url = new URL(request.url());
  if (url.pathname.includes('timedtext')) report.captionNetwork.push({ path: url.pathname, failure: request.failure()?.errorText });
});
await mkdir('test-results', { recursive: true });

async function englishSubtitles() {
  await page.locator('.ytp-settings-button').click();
  const menu = page.locator('.ytp-settings-menu');
  await menu.waitFor();
  const items = await menu.locator('.ytp-menuitem').allTextContents();
  report.results.push({ case: '真实播放器字幕菜单', items: items.map((text) => text.trim()) });
  const captionMenu = menu.locator('.ytp-menuitem').filter({ hasText: /字幕|Subtitles|Captions/i }).first();
  if (!await captionMenu.count()) throw new Error('真实播放器没有字幕选项');
  await captionMenu.click();
  const languages = await menu.locator('.ytp-menuitem').allTextContents();
  report.results.push({ case: '可选字幕语言', languages: languages.map((text) => text.trim()) });
  const english = menu.locator('.ytp-menuitem').filter({ hasText: /英语|英文|English/i }).first();
  if (!await english.count()) throw new Error('测试视频没有可选的 English 字幕');
  await english.click();
  if (await menu.isVisible()) await page.locator('.ytp-settings-button').click();
}

try {
  await run.worker.evaluate(() => chrome.storage.local.set({ 'flowword.enabled.v1': true }));
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.screenshot({ path: resolve('test-results/youtube-initial.png') });
  const consent = page.getByRole('button', { name: /Reject all|全部拒绝|拒绝全部/i }).first();
  if (await consent.isVisible().catch(() => false)) await consent.click();
  await page.locator('#movie_player video.html5-main-video').waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: '暂停视频并捕获字幕' }).waitFor({ timeout: 12000 });
  const blocked = await page.locator('#movie_player').innerText();
  if (/Sign in to confirm|登录以确认|unavailable|无法播放|not available/i.test(blocked)) {
    throw new Error(`真实播放器受限：${blocked.slice(0, 400)}`);
  }
  await page.locator('#movie_player video.html5-main-video').evaluate((video) => video.play());
  await page.waitForFunction(() => document.querySelector('#movie_player video.html5-main-video').currentTime > 1, undefined, { timeout: 12000 });
  await page.waitForTimeout(2000);
  const englishSelected = await englishSubtitles().then(() => true).catch(async (error) => {
    report.results.push({ case: '选择 English 字幕', passed: false, reason: error.message });
    const menu = page.locator('.ytp-settings-menu');
    if (await menu.isVisible()) await page.locator('.ytp-settings-button').click();
    return false;
  });
  const captionsAvailable = await page.waitForFunction(() => Array.from(document.querySelectorAll('.ytp-caption-segment')).some((node) => node.textContent.trim()), undefined, { timeout: 12000 })
    .then(() => true).catch(() => false);
  report.results.push({ case: '真实 English 字幕显示', passed: captionsAvailable });
  const before = await page.locator('#movie_player video.html5-main-video').evaluate((video) => ({ time: video.currentTime, paused: video.paused }));
  const start = performance.now();
  await page.getByRole('button', { name: '暂停视频并捕获字幕' }).click();
  await page.waitForFunction(() => document.querySelector('flowword-ui')?.shadowRoot?.querySelector('[data-phase="READY"], [data-phase="ERROR"]'), undefined, { timeout: 5000 });
  const after = await page.locator('#movie_player video.html5-main-video').evaluate((video) => ({ time: video.currentTime, paused: video.paused }));
  const sentence = page.locator('flowword-ui').locator('.fw-sentence');
  const captured = await sentence.count() ? await sentence.innerText() : null;
  report.results.push({ case: '真实页面暂停与字幕捕获', before, after, captured, roundTripMs: Math.round(performance.now() - start),
    panel: await page.getByRole('dialog', { name: 'FlowWord 字幕面板' }).innerText() });
  await page.screenshot({ path: resolve('test-results/youtube-captured.png') });
  await page.getByRole('button', { name: '继续观看', exact: true }).click();
  report.results.push({ case: '显式继续播放', playing: await page.locator('#movie_player video.html5-main-video').evaluate((video) => !video.paused) });
  for (const mode of ['theater', 'fullscreen']) {
    await page.locator(mode === 'theater' ? '.ytp-size-button' : '.ytp-fullscreen-button').click();
    if (mode === 'fullscreen') await page.waitForFunction(() => document.fullscreenElement?.contains(document.querySelector('flowword-ui')), undefined, { timeout: 5000 });
    await page.getByRole('button', { name: '暂停视频并捕获字幕' }).click();
    await page.waitForFunction(() => document.querySelector('flowword-ui')?.shadowRoot?.querySelector('[data-phase="READY"], [data-phase="ERROR"]'), undefined, { timeout: 5000 });
    const paused = await page.locator('#movie_player video.html5-main-video').evaluate((video) => video.paused);
    await page.screenshot({ path: resolve(`test-results/youtube-${mode}.png`) });
    await page.getByRole('button', { name: '继续观看', exact: true }).click();
    const playing = await page.locator('#movie_player video.html5-main-video').evaluate((video) => !video.paused);
    report.results.push({ case: `真实 YouTube ${mode} 悬浮球与暂停恢复`, paused, playing });
    if (mode === 'fullscreen') await page.evaluate(() => document.exitFullscreen());
  }
  report.status = after.paused && captured && englishSelected ? 'limited-success' : after.paused ? 'partial-validation' : 'failed';
  report.note = captionsAvailable ? '仅一个公开视频的有限验证，不代表全部平台场景及量化指标达标' : '视频控制和模式切换进行了真实验证，但 English 字幕未显示，真实字幕读取未验收';
} catch (error) {
  report.status = 'blocked-or-failed';
  report.reason = error.message;
  report.pageUrl = page.url();
  report.playerDiagnostics = await page.evaluate(() => {
    const video = document.querySelector('#movie_player video.html5-main-video');
    const cc = document.querySelector('.ytp-subtitles-button');
    return { time: video?.currentTime, paused: video?.paused, duration: video?.duration, readyState: video?.readyState,
      ccPressed: cc?.getAttribute('aria-pressed'), ccTitle: cc?.getAttribute('title'),
      captionText: Array.from(document.querySelectorAll('.ytp-caption-segment')).map((node) => node.textContent),
      captionContainer: document.querySelector('.ytp-caption-window-container')?.outerHTML.slice(0, 3000),
      tracks: video ? Array.from(video.textTracks).map((track) => ({ kind: track.kind, language: track.language, mode: track.mode })) : [] };
  }).catch(() => null);
  await page.screenshot({ path: resolve('test-results/youtube-blocked.png') }).catch(() => {});
} finally {
  await writeFile('test-results/youtube-report.json', JSON.stringify(report, null, 2));
  await appendFile('test-results/youtube-history.jsonl', JSON.stringify({ testedAt: new Date().toISOString(), ...report }) + '\n');
  console.log(JSON.stringify(report, null, 2));
  await run.context.close();
}
