import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchTestBrowser } from './test-browser.mjs';

const fixture = await readFile('tests/fixtures/player.html', 'utf8');
const media = await readFile('tests/fixtures/test-video.webm');
const report = { environment: 'Playwright Chromium + production MV3 extension + local synthetic fixture', realYouTube: false,
  fixtureNote: '自建有限 VP8 WebM 文件，真实 HTMLMediaElement 播放暂停；直播用真实 MediaStream，字幕为预设夹具数据',
  notCovered: ['真实 YouTube 网站及 Chrome / Edge 用户安装'], cases: [], errors: [] };
await mkdir('test-results', { recursive: true });
let run = await launchTestBrowser();
const log = (name, detail = '') => { report.cases.push({ name, passed: true, detail }); console.log(`PASS ${name}`); };
let page;
const pauseState = () => page.locator('video.html5-main-video').evaluate((video) => video.paused);
const enable = (value) => run.worker.evaluate((enabled) => chrome.storage.local.set({ 'flowword.enabled.v1': enabled }), value);
const ball = () => page.locator('flowword-ui').getByRole('button', { name: '暂停视频并捕获字幕' });
const openBall = () => page.locator('flowword-ui').getByRole('button', { name: '收起 FlowWord 字幕面板' });
const dialog = () => page.getByRole('dialog', { name: 'FlowWord 字幕面板' });
async function ready() { await page.waitForFunction(() => document.querySelector('flowword-ui')?.shadowRoot?.querySelector('[data-phase="READY"]')); }
async function idle() { await page.waitForFunction(() => document.querySelector('flowword-ui')?.shadowRoot?.querySelector('[data-phase="IDLE"]')); }
async function setupPage() {
  await run.context.route('https://www.youtube.com/**', (route) => {
    const isMedia = new URL(route.request().url()).pathname === '/flowword-test-video.webm';
    if (!isMedia) return route.fulfill({ contentType: 'text/html', body: fixture });
    const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
    if (!range) return route.fulfill({ contentType: 'video/webm', headers: { 'Accept-Ranges': 'bytes' }, body: media });
    const start = Number(range[1]);
    const end = Math.min(media.length - 1, range[2] ? Number(range[2]) : media.length - 1);
    if (start > end) return route.fulfill({ status: 416, headers: { 'Content-Range': `bytes */${media.length}` } });
    return route.fulfill({ status: 206, contentType: 'video/webm', body: media.subarray(start, end + 1),
      headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${media.length}` } });
  });
  page = await run.context.newPage();
  page.on('pageerror', (error) => report.errors.push(error.message));
  await page.goto('https://www.youtube.com/watch?v=flowword-fixture');
  await page.waitForFunction(() => document.querySelector('video.html5-main-video').readyState >= 2);
  assert.ok(await page.locator('video.html5-main-video').evaluate((video) => Number.isFinite(video.duration) && video.duration >= 60));
}

try {
  await setupPage();
  await page.waitForTimeout(400);
  assert.equal(await page.locator('flowword-ui').count(), 0);
  log('初始关闭，不显示悬浮球');

  await enable(true);
  await ball().waitFor();
  assert.equal(await ball().count(), 1);
  log('设置开启后只挂载一个 Shadow DOM 悬浮球');

  await page.locator('#play').click();
  await page.locator('#secondary').evaluate((video) => video.play());
  const playingTime = await page.locator('video.html5-main-video').evaluate((video) => video.currentTime);
  await page.waitForTimeout(650);
  assert.ok(await page.locator('video.html5-main-video').evaluate((video) => video.currentTime) > playingTime);
  const start = await ball().boundingBox();
  await page.mouse.move(start.x + 27, start.y + 27);
  await page.mouse.down();
  await page.mouse.move(80, 280, { steps: 15 });
  await page.mouse.up();
  assert.equal(await pauseState(), false);
  assert.equal(await dialog().count(), 0);
  const dragged = await ball().boundingBox();
  assert.equal(Math.round(dragged.x), 14);
  log('拖动贴边且不误暂停、不打开面板');
  await page.waitForTimeout(200);

  await ball().click();
  await ready();
  assert.equal(await pauseState(), true);
  assert.match(await dialog().innerText(), /I came across a rather obscure reference\./);
  assert.equal(await page.locator('#secondary').evaluate((video) => video.paused), false);
  log('捕获真实 DOM 字幕并只暂停主视频');
  await page.screenshot({ path: resolve('test-results/floating-light.png') });

  await page.getByRole('button', { name: '关闭面板，保持视频暂停' }).click();
  await idle();
  assert.equal(await pauseState(), true);
  await ball().click();
  await ready();
  await page.getByRole('button', { name: '继续观看', exact: true }).click();
  await idle();
  assert.equal(await pauseState(), false);
  const resumedTime = await page.locator('video.html5-main-video').evaluate((video) => video.currentTime);
  await page.waitForTimeout(250);
  assert.ok(await page.locator('video.html5-main-video').evaluate((video) => video.currentTime) > resumedTime);
  log('关闭后保持暂停，再打开仍可显式继续观看');

  await page.locator('#play').click();
  await ball().click();
  await ready();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await idle();
  assert.equal(await pauseState(), true);
  log('视频原本暂停时，完成操作不会恢复播放');

  await page.evaluate(() => window.testCaption(''));
  await page.locator('#play').click();
  await page.waitForTimeout(1050);
  await ball().click();
  await page.waitForFunction(() => document.querySelector('flowword-ui')?.shadowRoot?.querySelector('[data-phase="ERROR"]'));
  assert.match(await dialog().innerText(), /没有读到英文字幕/);
  await page.getByRole('button', { name: '继续观看', exact: true }).click();
  await idle();
  assert.equal(await pauseState(), false);
  log('无字幕时明确报错且可以继续观看');

  await page.evaluate(() => window.testLive(true));
  await page.waitForFunction(() => document.querySelector('video.html5-main-video').duration === Infinity);
  await ball().click();
  await page.waitForFunction(() => document.querySelector('flowword-ui')?.shadowRoot?.querySelector('[data-phase="ERROR"]'));
  assert.match(await dialog().innerText(), /暂不支持直播/);
  assert.equal(await pauseState(), false);
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await idle();
  await page.evaluate(() => window.testLive(false));
  await page.waitForFunction(() => Number.isFinite(document.querySelector('video.html5-main-video').duration));
  log('Infinity 直播场景明确拒绝，且不暂停视频');

  await page.evaluate(() => window.testCaption('The first sentence.'));
  await page.waitForTimeout(650);
  await page.evaluate(() => window.testCaption('An obscure reference appears.'));
  await page.waitForTimeout(450);
  await ball().click();
  await ready();
  await page.getByRole('button', { name: '上一条字幕', exact: true }).click();
  await ready();
  assert.match(await dialog().innerText(), /The first sentence\./);
  await page.getByRole('button', { name: '回到点击时刻', exact: true }).click();
  await ready();
  assert.match(await dialog().innerText(), /An obscure reference appears\./);
  log('上一条缓存与点击时刻切换，无需跳转视频');

  await page.getByLabel('字幕时间微调').selectOption('-0.5');
  await page.waitForFunction(() => document.querySelector('flowword-ui')?.shadowRoot?.querySelector('.fw-sentence')?.textContent.includes('The first sentence.'));
  await ready();
  assert.equal(await page.getByLabel('字幕时间微调').inputValue(), '-0.5');
  await page.getByLabel('字幕时间微调').selectOption('0');
  await page.waitForFunction(() => document.querySelector('flowword-ui')?.shadowRoot?.querySelector('.fw-sentence')?.textContent.includes('An obscure reference appears.'));
  log('时间偏移真实读取附近缓存，并能回到点击位置');

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: resolve('test-results/floating-dark.png') });
  assert.equal(await dialog().evaluate((node) => getComputedStyle(node).backgroundColor), 'rgb(32, 43, 37)');
  await page.emulateMedia({ colorScheme: 'light' });
  log('深浅主题跟随系统');

  await page.setViewportSize({ width: 400, height: 570 });
  const panelBox = await dialog().boundingBox();
  assert.ok(panelBox.x >= 0 && panelBox.y >= 0 && panelBox.x + panelBox.width <= 400 && panelBox.y + panelBox.height <= 570);
  await page.screenshot({ path: resolve('test-results/floating-narrow.png') });
  await page.setViewportSize({ width: 1280, height: 800 });
  log('窄窗口中悬浮球及面板不越界');

  await page.getByRole('button', { name: '继续观看', exact: true }).click();
  await idle();
  await page.locator('#fullscreen').click();
  await page.waitForFunction(() => document.fullscreenElement?.contains(document.querySelector('flowword-ui')));
  assert.equal(await page.evaluate(() => document.fullscreenElement?.id), 'movie_player');
  await ball().click();
  await ready();
  assert.equal(await pauseState(), true);
  await page.screenshot({ path: resolve('test-results/floating-fullscreen.png') });
  await page.getByRole('button', { name: '继续观看', exact: true }).click();
  await idle();
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => document.querySelector('flowword-ui')?.parentElement === document.body);
  log('实际进入播放器容器全屏，操作成功并在退出后归位');

  await ball().focus();
  await page.keyboard.press('Enter');
  await ready();
  await page.keyboard.press('Escape');
  await idle();
  assert.equal(await pauseState(), true);
  log('键盘 Enter 捕获、Escape 关闭且不自动播放');

  await page.locator('video.html5-main-video').evaluate(async (video) => { await video.play(); video.pause(); });

  await page.evaluate(() => {
    const video = document.querySelector('video.html5-main-video');
    const metadata = video.addTextTrack('metadata', 'English metadata', 'en');
    metadata.mode = 'hidden';
    metadata.addCue(new VTTCue(0, 89, 'CHAPTER METADATA MUST NOT BE READ'));
    const first = video.addTextTrack('captions', 'English', 'en');
    first.mode = 'showing';
    first.addCue(new VTTCue(0, 89, 'A <b>verified</b> English track.'));
    window.fixtureTrack = first;
  });
  await ball().click();
  await ready();
  assert.match(await dialog().innerText(), /A verified English track\./);
  assert.doesNotMatch(await dialog().innerText(), /CHAPTER METADATA/);
  assert.match(await dialog().innerText(), /来自视频的英文字幕轨道/);
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await idle();
  log('标准英文字幕轨道优先，WebVTT 标签解析正确，metadata 被排除');

  await page.evaluate(() => { window.fixtureTrack.mode = 'disabled'; window.testCaption(''); });
  await page.locator('#play').click();
  await page.waitForTimeout(850);
  await ball().click();
  await page.waitForFunction(() => document.querySelector('flowword-ui')?.shadowRoot?.querySelector('[data-phase="ERROR"]'));
  assert.doesNotMatch(await dialog().innerText(), /A verified English track/);
  await page.getByRole('button', { name: '继续观看', exact: true }).click();
  await idle();
  log('关闭字幕轨道后不把旧 cue 的未来时段当成已观测缓存');

  await page.evaluate(() => {
    const video = document.querySelector('video.html5-main-video');
    window.fixtureTrack.mode = 'hidden';
    const second = video.addTextTrack('captions', 'English alternative', 'en');
    second.mode = 'hidden';
    second.addCue(new VTTCue(0, 89, 'A different English caption.'));
    window.fixtureSecondTrack = second;
    window.testCaption('Visible DOM fallback.');
  });
  await page.waitForTimeout(200);
  await ball().click();
  await ready();
  assert.match(await dialog().innerText(), /Visible DOM fallback\./);
  assert.doesNotMatch(await dialog().innerText(), /A different English caption|A verified English track/);
  await page.getByRole('button', { name: '继续观看', exact: true }).click();
  await idle();
  log('多个英文 hidden 轨道不混读，使用可见 DOM 后备');

  await page.evaluate(() => { window.fixtureSecondTrack.mode = 'showing'; });
  await page.waitForTimeout(180);
  await ball().click();
  await ready();
  assert.match(await dialog().innerText(), /A different English caption\./);
  assert.doesNotMatch(await dialog().innerText(), /A verified English track|Visible DOM fallback/);
  await page.locator('video.html5-main-video').evaluate((video) => { video.currentTime = 25; });
  await page.waitForFunction(() => { const video = document.querySelector('video.html5-main-video'); return !video.seeking && Math.abs(video.currentTime - 25) < 0.2; });
  await idle();
  assert.equal(await pauseState(), true);
  await ball().click();
  await ready();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await idle();
  assert.equal(await pauseState(), true);
  log('字幕轨道切换不混合旧文本，真实 seeking 清除旧暂停归属');

  await page.evaluate(() => {
    for (const track of document.querySelector('video.html5-main-video').textTracks) track.mode = 'disabled';
    window.testCaption('A fresh observed sentence.');
  });
  await page.locator('#play').click();
  await ball().click();
  await ready();
  await page.evaluate(() => {
    history.pushState({}, '', '/watch?v=another-fixture');
    document.dispatchEvent(new Event('yt-navigate-finish'));
  });
  await idle();
  assert.equal(await pauseState(), true);
  await ball().click();
  await ready();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await idle();
  assert.equal(await pauseState(), true);
  log('SPA 视频导航清除面板及旧暂停归属');

  await page.locator('#play').click();
  await page.locator('#movie_player').evaluate((player) => player.classList.add('ad-showing'));
  await ball().click();
  await page.waitForFunction(() => document.querySelector('flowword-ui')?.shadowRoot?.querySelector('[data-phase="ERROR"]'));
  assert.match(await dialog().innerText(), /广告播放期间/);
  assert.equal(await pauseState(), false);
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await idle();
  await page.locator('#movie_player').evaluate((player) => player.classList.remove('ad-showing'));
  log('广告标志存在时不捕获、不暂停');

  await ball().dblclick();
  await idle();
  assert.equal(await pauseState(), false);
  await page.locator('#play').click();
  log('快速两次左键按新规则暂停后继续，不丢失暂停归属');

  const popup = await run.context.newPage();
  await popup.goto(`chrome-extension://${run.extensionId}/popup.html`);
  await page.bringToFront();
  await popup.reload();
  await popup.getByRole('switch').waitFor();
  await popup.waitForTimeout(250);
  await popup.screenshot({ path: resolve('test-results/popup.png') });
  assert.equal(await popup.getByRole('switch').getAttribute('aria-checked'), 'true');
  await popup.getByRole('switch').click();
  await page.waitForFunction(() => !document.querySelector('flowword-ui'));
  assert.equal(await pauseState(), true);
  log('弹出界面可关闭悬浮球，保持视频播放状态');
  await popup.close();
  await enable(true);
  await ball().waitFor();

  const storedPosition = await run.worker.evaluate(async () => (await chrome.storage.local.get('flowword.position.v1'))['flowword.position.v1']);
  const profile = run.profile;
  await run.context.close();
  run = await launchTestBrowser({ profile });
  await setupPage();
  await ball().waitFor();
  const reopened = await ball().boundingBox();
  assert.equal(Math.round(reopened.x), 14);
  assert.deepEqual(await run.worker.evaluate(async () => (await chrome.storage.local.get('flowword.position.v1'))['flowword.position.v1']), storedPosition);
  log('关闭重启测试浏览器后开关和悬浮球位置持久化');

  await page.goto('https://www.youtube.com/');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('flowword-ui').count(), 0);
  log('非标准视频页不挂载悬浮球');
  assert.deepEqual(report.errors, []);
  log('全部操作期间无页面 JavaScript 异常');
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = error.stack;
  report.failureState = page && !page.isClosed() ? await page.evaluate(() => ({
    phase: document.querySelector('flowword-ui')?.shadowRoot?.querySelector('[data-phase]')?.getAttribute('data-phase'),
    text: document.querySelector('flowword-ui')?.shadowRoot?.querySelector('.fw-sentence')?.textContent,
    offset: document.querySelector('flowword-ui')?.shadowRoot?.querySelector('select')?.value,
    time: document.querySelector('video.html5-main-video')?.currentTime,
  })).catch(() => null) : null;
  console.error(error);
  if (page && !page.isClosed()) await page.screenshot({ path: resolve('test-results/failure.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  await writeFile('test-results/e2e-report.json', JSON.stringify(report, null, 2));
  await run.context.close();
}
