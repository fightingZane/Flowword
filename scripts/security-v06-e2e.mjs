import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { launchTestBrowser } from './test-browser.mjs';
const fixture = await readFile('tests/fixtures/player.html', 'utf8');
const media = await readFile('tests/fixtures/test-video.webm');
const run = await launchTestBrowser();
const report = { environment: 'production MV3 extension; isolated browser profile; synthetic iframe/video pages', realPaidApiCalled: false, connectionNetwork: 'MOCK Chat Completions at mandatory-permission origin; no real HTTP provider traffic', cases: [], errors: [] };
const syntheticKey = 'security-fixture-key-not-real';
const endpoint = 'https://api.mymemory.translated.net/security-mock-chat';
const network = []; let mockStatus = 200; let page;
// log 记录断言已通过的name，不把密钥或网络请求正文写入报告
function log(name) { report.cases.push({ name, passed: true }); console.log('PASS ' + name); }
// provider 从隔离扩展数据库读写测试配置，value缺省读取，仅返回测试运行内存不向网页暴露
async function provider(value) {
  return run.worker.evaluate((value) => new Promise((resolve, reject) => {
    const open = indexedDB.open('flowword-provider', 1);
    open.onupgradeneeded = () => { open.result.createObjectStore('config'); open.result.createObjectStore('cache'); };
    open.onsuccess = () => {
      const db = open.result; const transaction = db.transaction('config', value ? 'readwrite' : 'readonly'); const store = transaction.objectStore('config');
      const request = value ? store.put(value, 'provider') : store.get('provider');
      transaction.oncomplete = () => { db.close(); resolve(value || request.result); }; transaction.onerror = () => reject(new Error('fixture config transaction failed'));
    }; open.onerror = () => reject(new Error('fixture config open failed'));
  }), value);
}
// rejectedFrame 断言selector嵌入入口拒绝挂载秘密表单与公开配置RPC，parent提供真实未授权网页
async function rejectedFrame(parent, selector) {
  const frame = parent.frameLocator(selector);
  await frame.getByRole('status').filter({ hasText: /FlowWord|标签页|设置会话/ }).waitFor();
  assert.equal(await frame.getByLabel('服务', { exact: true }).count(), 0);
  assert.equal(await frame.getByLabel('API Key').count(), 0);
  assert.equal(await frame.getByRole('button', { name: '授权接口并保存' }).count(), 0);
  const response = await frame.locator('body').evaluate(() => chrome.runtime.sendMessage({ type: 'FLOWWORD_PROVIDER_PUBLIC' }));
  assert.equal(response.ok, false);
  const blocked = await parent.locator(selector).evaluate((element) => { try { return element.contentWindow.document.body.innerText; } catch (error) { return error.name; } });
  assert.equal(blocked, 'SecurityError');
  return frame;
}
try {
  await run.context.route('https://**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'www.youtube.com') {
      if (url.pathname !== '/flowword-test-video.webm') return route.fulfill({ contentType: 'text/html', body: fixture });
      const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/); const start = Number(range?.[1] || 0); const end = Math.min(media.length - 1, range?.[2] ? Number(range[2]) : media.length - 1);
      return route.fulfill({ status: range ? 206 : 200, contentType: 'video/webm', headers: { 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${media.length}` } : {}) }, body: media.subarray(start, end + 1) });
    }
    if (url.hostname === 'flowword-security-ungranted.test') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>Untrusted iframe fixture</title><body><h1>Untrusted fixture</h1></body>' });
    if (url.href === endpoint) {
      network.push({ syntheticAuthorizationMatched: route.request().headers().authorization === 'Bearer ' + syntheticKey, body: route.request().postDataJSON() });
      return route.fulfill({ status: mockStatus, contentType: 'application/json', body: JSON.stringify(mockStatus === 200 ? { choices: [{ message: { content: JSON.stringify({ translation: '这是连接测试' }) } }] } : { error: { message: 'mock rejected credential ' + syntheticKey } }) });
    }
    report.errors.push('Unexpected outbound provider/page request blocked: ' + url.origin + url.pathname); return route.abort();
  });
  await provider({ mode: 'cloud', endpoint, model: 'saved-fixture-model', apiKey: syntheticKey, prefetch: false, prefetchExpressions: false });
  await run.worker.evaluate(() => chrome.storage.local.set({ 'flowword.enabled.v1': false, 'flowword.onlineTranslation.v1': false }));
  const untrusted = await run.context.newPage(); untrusted.setDefaultTimeout(12000); await untrusted.goto('https://flowword-security-ungranted.test/');
  const bareUrl = `chrome-extension://${run.extensionId}/settings.html?embedded=1`;
  await untrusted.evaluate((src) => { const frame = document.createElement('iframe'); frame.id = 'bare'; frame.src = src; document.body.append(frame); }, bareUrl);
  await rejectedFrame(untrusted, '#bare');
  assert.equal((await provider()).model, 'saved-fixture-model'); assert.equal(network.length, 0);
  log('未启用站点直接嵌入设置被拒绝，不挂载密钥表单，公开配置RPC与父页面跨域读取均被阻止');
  await untrusted.evaluate(() => document.querySelector('#bare').contentWindow.postMessage({ type: 'FLOWWORD_PROVIDER_SAVE', config: { mode: 'off', model: 'attacker-change' } }, '*'));
  await untrusted.waitForTimeout(100); assert.equal((await provider()).model, 'saved-fixture-model');
  log('网页postMessage不能修改模型配置');
  await run.worker.evaluate(() => chrome.storage.local.set({ 'flowword.enabled.v1': true }));
  page = await run.context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', (error) => report.errors.push(error.message));
  await page.goto('https://www.youtube.com/watch?v=security-fixture');
  await page.getByRole('button', { name: '暂停视频并捕获字幕' }).click({ button: 'right' });
  await page.getByRole('button', { name: '云端模型与快捷键设置 ↗' }).click();
  const frame = page.frameLocator('iframe[title="模型与快捷键设置"]');
  await frame.getByLabel('服务', { exact: true }).waitFor();
  assert.equal(await frame.getByLabel('API Key').inputValue(), '');
  assert.equal((await frame.locator('html').innerHTML()).includes(syntheticKey), false);
  log('合法悬浮框会话仍可打开设置，已有密钥只显示占位提示且未回填DOM');
  const grantedUrl = await page.locator('iframe[title="模型与快捷键设置"]').getAttribute('src');
  await untrusted.evaluate((src) => { const frame = document.createElement('iframe'); frame.id = 'stolen'; frame.src = src; document.body.append(frame); }, grantedUrl);
  await rejectedFrame(untrusted, '#stolen'); log('复制合法令牌到其他标签页仍无法取得设置会话');
  await frame.getByLabel('模型名称').fill('unsaved-fixture-model');
  assert.equal(network.length, 0);
  await frame.getByRole('button', { name: '测试连接', exact: true }).click();
  await frame.getByRole('status').filter({ hasText: '连接成功' }).waitFor();
  assert.equal(network.length, 1); assert.equal(network[0].syntheticAuthorizationMatched, true);
  assert.equal(network[0].body.messages[1].content.includes('This is a connection test.'), true);
  assert.equal(network[0].body.model, 'unsaved-fixture-model'); assert.equal(JSON.stringify(network[0].body).includes(syntheticKey), false);
  assert.equal((await provider()).model, 'saved-fixture-model'); assert.equal((await run.worker.evaluate(() => chrome.storage.local.get('flowword.onlineTranslation.v1')))['flowword.onlineTranslation.v1'], false);
  log('测试连接只发送自编短句到MOCK，不修改已保存配置或联网开关');
  await frame.getByRole('button', { name: '授权接口并保存', exact: true }).click();
  await frame.getByRole('status').filter({ hasText: '配置已保存' }).waitFor();
  assert.equal((await provider()).model, 'unsaved-fixture-model'); assert.equal(network.length, 1);
  assert.equal(await frame.getByLabel('API Key').inputValue(), '');
  log('保存与连接测试分离，保存不调用模型，留空密钥保留且清空表单秘密');
  mockStatus = 401;
  await frame.getByRole('button', { name: '测试连接', exact: true }).click();
  await frame.getByRole('status').filter({ hasText: '认证或权限失败' }).waitFor();
  assert.equal(network.length, 2); assert.equal((await frame.locator('html').innerHTML()).includes(syntheticKey), false);
  log('MOCK认证错误正文不回显密钥，界面仅显示清晰认证提示');
  const token = new URL(grantedUrl).searchParams.get('token');
  await run.worker.evaluate(async (token) => { const key = 'flowword-settings-grant:' + token; const stored = (await chrome.storage.session.get(key))[key]; await chrome.storage.session.set({ [key]: { ...stored, expires: 0 } }); }, token);
  await frame.getByLabel('模型名称').fill('expired-session-change');
  await frame.getByRole('button', { name: '授权接口并保存', exact: true }).click();
  await frame.getByRole('status').filter({ hasText: /会话已过期/ }).waitFor();
  assert.equal((await provider()).model, 'unsaved-fixture-model'); assert.equal(network.length, 2);
  log('合法会话过期后保存重新校验，拒绝写入且不产生连接请求');
  assert.deepEqual(report.errors, []);
} catch (error) { report.errors.push(error.stack || String(error)); console.error(error); process.exitCode = 1; }
finally { report.passed = !report.errors.length; report.mockConnectionRequests = network.length; await mkdir('test-results', { recursive: true }); await writeFile('test-results/security-v06-report.json', JSON.stringify(report, null, 2)); await run.context.close(); }
