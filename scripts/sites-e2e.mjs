import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchTestBrowser } from './test-browser.mjs';

const origin = 'https://flowword-native.test';
const deniedOrigin = 'https://flowword-ungranted.test';
const media = await readFile('tests/fixtures/test-video.webm');
const youtubeFixture = await readFile('tests/fixtures/player.html', 'utf8');
const report = { environment: 'Production MV3 extension and native HTML5 TextTracks, permission mode recorded separately',
  realWebsites: false, cloudApi: 'MOCK response in isolated test Service Worker',
  notCovered: ['真实通用网站播放器兼容性', '操作系统实际快捷键触发及用户浏览器改绑', '真实云端模型质量和延迟'], cases: [], errors: [] };
let run = await launchTestBrowser();
let pregrantedFixture = false;
let page;
// log 意为记录已通过场景，name 给出验证目标，detail 区分真实状态与模拟数据，失败不能调用
const log = (name, detail = '') => { report.cases.push({ name, passed: true, detail }); console.log('PASS ' + name); };
// until 意为等待实际状态，check 返回是否满足，timeout 限定毫秒，不通过延时掩盖生产竞态
async function until(check, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 80)); }
  throw new Error('等待实际浏览器状态超时');
}
const fixture = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Owned native subtitle fixture</title>
<style>body{margin:20px;background:#eeeee6}#player{position:relative;width:640px;height:360px}#main{width:640px;height:360px}#secondary{width:1px;height:1px;opacity:0}button{padding:12px}</style></head>
<body><h1>Synthetic video and native captions — no real website data</h1><div id="player"><video id="main" src="/flowword-test-video.webm" muted playsinline controls></video></div>
<video id="secondary" src="/flowword-test-video.webm" muted></video><button id="fullscreen">Fullscreen container</button><script>
const video = document.querySelector('#main');
const metadata = video.addTextTrack('metadata', 'not captions', 'en'); metadata.mode = 'hidden'; metadata.addCue(new VTTCue(0,90,'Do not capture metadata.'));
const english = video.addTextTrack('captions', 'English', 'en'); english.mode = 'hidden';
const texts = ['A previous sentence.','The current sentence explains an obscure reference.','A following sentence ends here.','One final short sentence.','A stable closing sentence.'];
texts.forEach((text,index) => english.addCue(new VTTCue(index*2,index===4?90:index*2+2,text)));
// setEnglish 切换原生轨道，value 决定启用或禁用，两个 world 都能观察到真实模式变化
window.setEnglish = (value) => { english.mode = value ? 'hidden' : 'disabled'; };
// addSecondEnglish 添加第二条显示轨道，无参数，用于验证歧义选择拒绝
window.addSecondEnglish = () => { const track = video.addTextTrack('captions','Another English','en'); track.mode='showing'; english.mode='showing'; track.addCue(new VTTCue(0,90,'Ambiguous caption.')); return true; };
// resetEnglish 恢复唯一英文轨道，无参数，只调整本测试夹具的原生对象
window.resetEnglish = () => { Array.from(video.textTracks).filter(track => track!==english).forEach(track => track.mode='disabled'); english.mode='hidden'; };
const canvas = document.createElement('canvas'); canvas.width=32;canvas.height=32;canvas.getContext('2d').fillRect(0,0,32,32);
// makeLive 生成真实直播流，无参数，持续绘图保证真实视频帧，绝不覆盖 duration 属性
window.makeLive = async () => { video.srcObject=canvas.captureStream(5);let frame=0;setInterval(()=>{canvas.getContext('2d').fillStyle=frame++%2?'#245':'#432';canvas.getContext('2d').fillRect(0,0,32,32);},100);await video.play(); };
document.querySelector('#fullscreen').onclick = () => document.querySelector('#player').requestFullscreen();
</script></body></html>`;

// routeFixture 意为返回自建页面媒体，route 是 Playwright 请求，body 是明确标注的字幕夹具
// 返回有限 WebM 及合法字节范围，不访问真实网站，也不模拟播放器的媒体属性
async function routeFixture(route, body) {
  if (new URL(route.request().url()).pathname !== '/flowword-test-video.webm') return route.fulfill({ contentType: 'text/html', body });
  const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
  if (!range) return route.fulfill({ contentType: 'video/webm', headers: { 'Accept-Ranges': 'bytes' }, body: media });
  const start = Number(range[1]); const end = Math.min(media.length - 1, range[2] ? Number(range[2]) : media.length - 1);
  if (start > end) return route.fulfill({ status: 416, headers: { 'Content-Range': `bytes */${media.length}` } });
  return route.fulfill({ status: 206, contentType: 'video/webm', body: media.subarray(start, end + 1),
    headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${media.length}` } });
}   // 真实有限 WebM 保留 Range 跳转，不能通过覆盖 duration 伪造跨 world 视频状态

// command 意为发送生产命令协议，commandName 指定暂停恢复或重听
// 只用于专用测试站标签页，不冒充操作系统真实快捷键触发
async function command(commandName) {
  return run.worker.evaluate(async ({ origin, commandName }) => {
    const tabs = await chrome.tabs.query({}); const tab = tabs.find((tab) => tab.url?.startsWith(origin + '/'));
    return chrome.tabs.sendMessage(tab.id, { type: 'FLOWWORD_COMMAND', command: commandName });
  }, { origin, commandName });
}
// state 意为读取界面阶段，无参数，直接观察生产 UI，不读取控制器私有数据
const state = () => page.locator('flowword-ui .fw-app').getAttribute('data-phase');
// seek 意为设置测试媒体位置，time 给出秒数，playing 决定是否开始真实播放
// 等待原生 seeked 和界面清理后返回，不更改扩展暂停或字幕逻辑
async function seek(time, playing = false) {
  await page.locator('#main').evaluate(async (video, time) => { video.pause(); video.currentTime = time; }, time);
  await page.waitForFunction((time) => { const video = document.querySelector('#main'); return video.readyState >= 2 && !video.seeking && Math.abs(video.currentTime - time) < 0.2; }, time);
  await until(async () => await state() === 'IDLE');
  if (playing) await page.locator('#main').evaluate((video) => video.play());
}
// paused 意为读取真实暂停状态，无参数，只查询测试页主视频
const paused = () => page.locator('#main').evaluate((video) => video.paused);

try {
  await mkdir('test-results', { recursive: true });
  const manifest = await run.worker.evaluate(() => chrome.runtime.getManifest());
  assert.deepEqual(manifest.content_scripts.map((item) => item.matches), [['https://www.youtube.com/*']]);
  assert.ok(!manifest.host_permissions.includes('https://*/*') && !manifest.host_permissions.includes('http://*/*'));
  assert.ok(manifest.optional_host_permissions.includes('https://*/*'));
  const commands = await run.worker.evaluate(() => chrome.commands.getAll());
  assert.ok(commands.some((item) => item.name === 'flowword-toggle')); assert.ok(commands.some((item) => item.name === 'flowword-repeat'));
  log('产物权限按站申请，YouTube 唯一静态注入，浏览器已登记两个快捷键');
  await run.context.route(origin + '/**', (route) => routeFixture(route, fixture));
  await run.context.route(deniedOrigin + '/**', (route) => routeFixture(route, fixture));
  await run.context.route('https://www.youtube.com/**', (route) => routeFixture(route, youtubeFixture));
  await run.worker.evaluate(() => chrome.storage.local.set({ 'flowword.enabled.v1': true }));
  page = await run.context.newPage(); page.on('pageerror', (error) => report.errors.push(error.message));
  await page.goto(origin + '/lesson'); await page.waitForFunction(() => document.querySelector('#main').readyState >= 2);
  assert.equal(await page.locator('flowword-ui').count(), 0);
  assert.equal(await run.worker.evaluate(() => chrome.permissions.contains({ origins: ['https://flowword-native.test/*'] })), false);
  log('未授权站即使全局开关已开启也不注入');

  let extension = await run.context.newPage(); await extension.goto(`chrome-extension://${run.extensionId}/settings.html`);
  const rejected = await extension.evaluate(() => chrome.runtime.sendMessage({ type: 'FLOWWORD_ENABLE_SITE', origin: 'https://flowword-native.test' }));
  assert.equal(rejected.ok, false);
  await extension.evaluate((origin) => {
    const button = document.createElement('button'); button.id = 'native-permission'; button.textContent = 'Test authorize native fixture';
    button.onclick = async () => {
      try {
        const granted = await chrome.permissions.request({ origins: [origin + '/*'] });
        window.fixturePermission = { granted, registered: granted ? await chrome.runtime.sendMessage({ type: 'FLOWWORD_ENABLE_SITE', origin }) : null };
      } catch (error) { window.fixturePermission = { error: error.message }; }
    };
    document.body.append(button);
  }, origin);
  await extension.locator('#native-permission').click();
  let permission;
  try {
    await extension.waitForFunction(() => window.fixturePermission !== undefined, undefined, { timeout: 5000 });
    permission = await extension.evaluate(() => window.fixturePermission);
  } catch { permission = { error: '无头 Chromium 的原生权限弹窗没有完成，真实 button user gesture 请求的 Promise 未返回' }; }
  report.permissionAttempt = permission;
  if (!permission.granted) {
    pregrantedFixture = true;
    report.permissionMode = 'Controlled copy grants ONE owned test origin in host_permissions; production optional permission manifest remains unchanged';
    report.notCovered.push('原生 optional permission 同意弹窗与 permissions.remove 撤销流程，需有界面的用户浏览器验收');
    await run.context.close();
    const clone = await mkdtemp(resolve('.cache/sites-extension-'));
    await cp(resolve('.output/chrome-mv3'), clone, { recursive: true });
    const controlled = JSON.parse(await readFile(resolve(clone, 'manifest.json'), 'utf8'));
    controlled.host_permissions = [...controlled.host_permissions, origin + '/*'];
    await writeFile(resolve(clone, 'manifest.json'), JSON.stringify(controlled));
    run = await launchTestBrowser({ browserOptions: { args: [`--disable-extensions-except=${clone}`, `--load-extension=${clone}`, '--autoplay-policy=no-user-gesture-required'] } });
    await run.context.route(origin + '/**', (route) => routeFixture(route, fixture));
    await run.context.route(deniedOrigin + '/**', (route) => routeFixture(route, fixture));
    await run.context.route('https://www.youtube.com/**', (route) => routeFixture(route, youtubeFixture));
    await run.worker.evaluate(() => chrome.storage.local.set({ 'flowword.enabled.v1': true }));
    page = await run.context.newPage(); page.on('pageerror', (error) => report.errors.push(error.message));
    await page.goto(origin + '/lesson');
    extension = await run.context.newPage(); await extension.goto(`chrome-extension://${run.extensionId}/settings.html`);
    const enabled = await extension.evaluate((origin) => chrome.runtime.sendMessage({ type: 'FLOWWORD_ENABLE_SITE', origin }), origin);
    assert.equal(enabled.ok, true);
  } else {
    report.permissionMode = 'Production optional permission granted by actual extension-page user gesture';
    assert.equal(permission.registered.ok, true);
  }
  const registered = await run.worker.evaluate(() => chrome.scripting.getRegisteredContentScripts());
  assert.equal(registered.length, 1); assert.deepEqual(registered[0].matches, [origin + '/*']);
  assert.deepEqual(registered[0].js, ['content-scripts/flowword.js']);
  await page.reload(); await page.getByRole('button', { name: '暂停视频并捕获字幕' }).waitFor();
  assert.equal(await page.locator('flowword-ui .fw-ball').evaluate((button) => getComputedStyle(button).width), '54px');
  log(pregrantedFixture ? '受控副本仅预授予一个测试站，后台按精确 origin 注册且 CSS 正确' : '真实点击完成 optional permission 授权，后台精确注册且 CSS 正确');

  const unauthorized = await run.context.newPage(); await unauthorized.goto(deniedOrigin + '/lesson');
  await unauthorized.waitForFunction(() => document.querySelector('#main').readyState >= 2);
  assert.equal(await unauthorized.locator('flowword-ui').count(), 0); await unauthorized.close();
  log('授权一个站点之后，另一个站点仍不注入');
  await seek(3, true); assert.equal((await command('toggle-playback')).ok, true);
  await until(async () => await state() === 'READY'); assert.equal(await paused(), true);
  assert.equal(await page.locator('flowword-ui .fw-sentence').innerText(), 'The current sentence explains an obscure reference.');
  assert.equal(await page.locator('flowword-ui .fw-neighbor').count(), 2);
  assert.doesNotMatch(await page.getByRole('dialog').innerText(), /Do not capture metadata/);
  assert.equal((await command('toggle-playback')).ok, true); await until(async () => await state() === 'IDLE'); assert.equal(await paused(), false);
  log('生产命令消息暂停和恢复唯一主视频，原生英语字幕排除 metadata，前后句真实');

  await seek(3, true); await command('toggle-playback'); await until(async () => await state() === 'READY');
  await command('repeat-sentence'); assert.equal(await paused(), false); assert.equal(await state(), 'READY');
  await page.waitForFunction(() => { const video = document.querySelector('#main'); return video.paused && video.currentTime >= 4; });
  const endTime = await page.locator('#main').evaluate((video) => video.currentTime); assert.ok(endTime < 4.25, String(endTime));
  assert.equal(await state(), 'READY'); await command('toggle-playback'); assert.equal(await paused(), false);
  log('原生重听自己 seek/play 保留面板，按真实句末暂停且显式继续可用');
  await seek(3, true); await command('toggle-playback'); await command('repeat-sentence');
  await page.locator('#main').evaluate((video) => { video.currentTime = 7; });
  await until(async () => await state() === 'IDLE'); await page.waitForTimeout(400); assert.equal(await paused(), false);
  log('外部跳转立即取消重听，旧句末不会再暂停新时间位置');

  await seek(3); await command('repeat-sentence'); assert.equal(await state(), 'IDLE');
  await page.waitForFunction(() => { const video = document.querySelector('#main'); return video.paused && video.currentTime >= 4; });
  await command('toggle-playback'); assert.equal(await state(), 'IDLE'); assert.equal(await paused(), false);
  log('面板关闭时一键重听当前真实字幕，句末归属允许一键恢复');
  await seek(3, true); await command('toggle-playback');
  await page.getByRole('button', { name: '字幕跟随 ▷' }).click();
  await page.waitForFunction(() => document.querySelector('flowword-ui')?.shadowRoot?.querySelector('.fw-sentence')?.textContent.includes('A following sentence ends here.'));
  assert.equal(await paused(), false); await command('toggle-playback');
  await page.waitForTimeout(2200); assert.equal(await state(), 'IDLE'); assert.equal(await paused(), false);
  log('字幕跟随播放中换句不暂停，关闭后不重新弹出');

  await seek(3, true); await command('toggle-playback');
  await page.locator('#main').evaluate((video) => video.play()); await until(async () => await state() === 'IDLE');
  log('用户手动点击视频播放会关闭旧学习面板');
  await seek(3); await page.evaluate(() => window.setEnglish(false)); await command('toggle-playback');
  assert.equal(await state(), 'ERROR'); assert.match(await page.getByRole('dialog').innerText(), /英文字幕轨道/);
  await command('toggle-playback'); await page.evaluate(() => window.setEnglish(true));
  await seek(3); await page.evaluate(() => window.addSecondEnglish()); await command('toggle-playback');
  assert.equal(await state(), 'ERROR'); await command('toggle-playback'); await page.evaluate(() => window.resetEnglish());
  log('关闭轨道立即拒绝旧字幕，多条显示的英文轨道不猜测');
  await seek(3, true); await command('toggle-playback');
  await page.evaluate(() => history.pushState({}, '', '/another-lesson'));
  await until(async () => await state() === 'IDLE'); assert.equal(await paused(), true);
  log('通用 SPA 页面换地址立即清理旧内容，保持原暂停安全规则');

  await page.evaluate((origin) => { const frame = document.createElement('iframe'); frame.src = origin + '/embed'; frame.id = 'native-frame'; document.body.append(frame); }, origin);
  await page.frameLocator('#native-frame').locator('#main').waitFor();
  assert.equal(await page.frameLocator('#native-frame').locator('flowword-ui').count(), 0);
  await page.locator('#native-frame').evaluate((frame) => frame.remove());
  log('动态脚本只在顶层网页运行，不误入 iframe');

  await run.worker.evaluate(() => {
    globalThis.fixtureCloudRequests = [];
    globalThis.fetch = async (_url, options) => {
      const data = JSON.parse(options.body); const input = JSON.parse(data.messages[1].content);
      const details = data.messages[0].content.includes('Explain up to');
      globalThis.fixtureCloudRequests.push({ input, task: details ? 'context' : 'translate' });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(details ? { expressions: [] } : { translation: '夹具译文：' + input.current }) } }] }));
    };
  });   // 模拟结果只验证授权后的请求编排和缓存，不能证明真实模型译文准确性
  await extension.getByLabel('服务', { exact: true }).selectOption('cloud');
  await extension.getByLabel('HTTPS 接口完整地址').fill('https://api.mymemory.translated.net/v1/chat/completions');
  await extension.getByLabel('模型名称').fill('owned-fixture-model'); await extension.getByLabel('API Key').fill('TEST-ONLY-KEY');
  await extension.getByRole('button', { name: '授权接口并保存' }).click(); await extension.getByText('配置已保存', { exact: false }).waitFor();
  await seek(3, true); await page.waitForTimeout(2300);
  assert.equal(await run.worker.evaluate(() => globalThis.fixtureCloudRequests.length), 0);
  log('云端已配置但预译未启用时，播放字幕零网络请求');
  await extension.getByRole('checkbox').check(); await extension.getByRole('button', { name: '授权接口并保存' }).click();
  await seek(3, true);
  await until(() => run.worker.evaluate(() => globalThis.fixtureCloudRequests.some((item) => item.input.current === 'The current sentence explains an obscure reference.')));
  const predicted = await run.worker.evaluate(() => globalThis.fixtureCloudRequests.filter((item) => item.task === 'translate'));
  const currentRequest = predicted.find((item) => item.input.current === 'The current sentence explains an obscure reference.');
  assert.deepEqual(currentRequest.input.nearby, ['A previous sentence.', 'A following sentence ends here.']);
  assert.ok(predicted.some((item) => item.input.current === 'A following sentence ends here.'));
  assert.doesNotMatch(JSON.stringify(predicted), /https?:\/\/|flowword-native/);
  await command('toggle-playback'); await page.locator('flowword-ui .fw-translation').filter({ hasText: '夹具译文' }).waitFor();
  assert.equal(await run.worker.evaluate(() => globalThis.fixtureCloudRequests.filter((item) => item.task === 'translate' && item.input.current === 'The current sentence explains an obscure reference.').length), 1);
  log('原生播放预译当前及下一句，用稳定前后语境命中点击缓存，不上传网址');

  const dom = await run.context.newPage(); await dom.goto('https://www.youtube.com/watch?v=owned-dom-fixture');
  await dom.getByRole('button', { name: '暂停视频并捕获字幕' }).waitFor(); await dom.locator('#play').click();
  await until(() => run.worker.evaluate(() => globalThis.fixtureCloudRequests.some((item) => item.input.current === 'I came across a rather obscure reference.')));
  const domRequests = await run.worker.evaluate(() => globalThis.fixtureCloudRequests.filter((item) => item.task === 'translate' && item.input.current === 'I came across a rather obscure reference.'));
  assert.deepEqual(domRequests[0].input.nearby, []);
  await dom.waitForTimeout(2300);
  assert.equal(await run.worker.evaluate(() => globalThis.fixtureCloudRequests.filter((item) => item.task === 'translate' && item.input.current === 'I came across a rather obscure reference.').length), 1);
  await dom.getByRole('button', { name: '暂停视频并捕获字幕' }).click(); await dom.locator('flowword-ui .fw-translation').filter({ hasText: '夹具译文' }).waitFor();
  assert.equal(await dom.locator('flowword-ui .fw-neighbor').count(), 0); await dom.close();
  log('YouTube DOM 预译稳定已观测当前片段，去重且没有虚构未来字幕', '这是预设 DOM 夹具，非真实 YouTube');

  await page.locator('#main').evaluate((video) => { video.srcObject = null; video.load(); });
  await page.waitForFunction(() => Number.isFinite(document.querySelector('#main').duration));
  await page.evaluate(() => window.makeLive()); await page.waitForFunction(() => document.querySelector('#main').duration === Infinity);
  await command('toggle-playback'); assert.equal(await state(), 'ERROR'); assert.equal(await paused(), false);
  log('真实 MediaStream Infinity 直播被拒绝且不暂停');

  if (pregrantedFixture) {
    await extension.evaluate(async (origin) => {
      const tabs = await chrome.tabs.query({}); const tab = tabs.find((tab) => tab.url?.startsWith(origin + '/'));
      await chrome.tabs.sendMessage(tab.id, { type: 'FLOWWORD_SITE_REVOKED', origins: [origin + '/*'] });
      const scripts = await chrome.scripting.getRegisteredContentScripts();
      await chrome.scripting.unregisterContentScripts({ ids: scripts.map((script) => script.id) });
    }, origin);
  } else assert.equal(await extension.evaluate((origin) => chrome.permissions.remove({ origins: [origin + '/*'] }), origin), true);
  await until(async () => await page.locator('flowword-ui').count() === 0);
  await until(async () => (await run.worker.evaluate(() => chrome.scripting.getRegisteredContentScripts())).length === 0);
  await page.reload(); await page.waitForFunction(() => document.querySelector('#main').readyState >= 2);
  assert.equal(await page.locator('flowword-ui').count(), 0);
  log(pregrantedFixture ? '可信撤销通知停止当前脚本，删除动态注册后重载不再注入（原生权限撤销待验）' : '真实权限撤销停止当前脚本，动态注册清除，重载不再注入');
  assert.deepEqual(report.errors, []);
} catch (error) {
  report.errors.push(error.stack || String(error)); console.error(error); process.exitCode = 1;
  if (page) await page.screenshot({ path: 'test-results/sites-failure.png' }).catch(() => {});
} finally {
  report.passed = !report.errors.length;
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/sites-report.json', JSON.stringify(report, null, 2));
  await run.context.close();
}
