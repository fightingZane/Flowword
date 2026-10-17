import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { launchTestBrowser } from './test-browser.mjs';

const run = await launchTestBrowser(); const page = await run.context.newPage(); page.setDefaultTimeout(15000);
const token = 'a'.repeat(64); const cloudKey = 'fixture-cloud-secret-never-live';
const requests = []; const cloudRequests = [];
const report = { environment: 'production extension; isolated profile; mocked localhost bridge and permission dialog; no real CLI/model call', cases: [], errors: [] };
page.on('pageerror', (error) => report.errors.push(error.message));
// log 表示记录通过的设置界面验收，name 为检查说明，不输出凭据
const log = (name) => { report.cases.push(name); console.log(`PASS ${name}`); };
// savedConfig 表示只读检查隔离配置库，回传非秘密字段及凭据匹配结果，不打印令牌
async function savedConfig() {
  return page.evaluate(({ token, cloudKey }) => new Promise((resolve, reject) => {
    const open = indexedDB.open('flowword-provider', 1); open.onsuccess = () => { const db = open.result; const request = db.transaction('config').objectStore('config').get('provider'); request.onsuccess = () => { const value = request.result; db.close(); resolve(value ? { mode: value.mode, endpoint: value.endpoint, model: value.model, protocol: value.protocol, prefetch: value.prefetch, prefetchExpressions: value.prefetchExpressions, tokenMatches: value.apiKey === token, cloudMatches: value.apiKey === cloudKey, secretEmpty: value.apiKey === '' } : null); }; request.onerror = reject; }; open.onerror = reject;
  }), { token, cloudKey });
}
// upload 表示用户选择连接文件，endpoint 用来检验固定回环地址约束
async function upload(endpoint) { await page.getByLabel('导入 CLI 连接文件', { exact: true }).setInputFiles({ name: 'bridge-connection.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ endpoint, token })) }); }
// waitInputValue 表示等待 React 提交输入框状态，label 为可访问名称，value 为期望值，避免事件后立即读取旧值
async function waitInputValue(label, value) {
  const input = page.getByLabel(label, { exact: true });
  await input.waitFor();
  await page.waitForFunction(({ element, expected }) => element.value === expected, { element: await input.elementHandle(), expected: value });
}
try {
  await page.addInitScript(() => {
    globalThis.permissionRequests = [];
    chrome.permissions.contains = async () => false;
    chrome.permissions.request = async (options) => { globalThis.permissionRequests.push(options.origins); return true; };
  });
  await run.context.route('http://127.0.0.1:17863/**', (route) => {
    const request = route.request(); const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-private-network': 'true' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const path = new URL(request.url()).pathname; const body = request.postDataJSON(); requests.push({ path, method: request.method(), authorizationMatches: request.headers().authorization === `Bearer ${token}`, body });
    return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(path === '/status' ? { ok: true, auth: 'chatgpt' } : { translation: '这是一次连接测试' }) });
  });
  await run.context.route('https://api.deepseek.com/**', (route) => { cloudRequests.push(route.request().url()); return route.fulfill({ status: 401, body: '{}' }); });
  await run.context.route('https://api.openai.com/**', (route) => { cloudRequests.push(route.request().url()); return route.fulfill({ status: 401, body: '{}' }); });
  await page.goto(`chrome-extension://${run.extensionId}/settings.html`); await page.getByLabel('接口协议', { exact: true }).waitFor();
  await page.getByLabel('接口协议', { exact: true }).selectOption('responses'); await page.getByRole('button', { name: '填入 OpenAI 预设', exact: true }).click(); await waitInputValue('HTTPS 接口完整地址', 'https://api.openai.com/v1/responses');
  await page.getByLabel('接口协议', { exact: true }).selectOption('chat-completions'); await waitInputValue('HTTPS 接口完整地址', 'https://api.openai.com/v1/chat/completions'); assert.equal(await savedConfig(), null);
  await page.getByRole('button', { name: '填入 DeepSeek 预设', exact: true }).click(); await page.getByLabel('API Key', { exact: true }).fill(cloudKey); await page.getByRole('button', { name: '授权接口并保存', exact: true }).click(); await page.getByText('配置已保存', { exact: false }).waitFor();
  assert.equal((await savedConfig()).cloudMatches, true); assert.equal(cloudRequests.length, 0); await page.reload(); await page.getByLabel('API Key', { exact: true }).waitFor(); assert.equal(await page.getByLabel('API Key', { exact: true }).inputValue(), '');
  log('Chat/Responses协议与主动预设可切换，旧配置保存不发模型请求且密钥不回填');
  await page.getByLabel('服务', { exact: true }).selectOption('codex-cli'); await page.getByRole('button', { name: '测试连接', exact: true }).click(); await page.getByText('请导入本机桥接连接文件', { exact: false }).waitFor(); assert.equal(requests.length, 0); assert.equal((await savedConfig()).cloudMatches, true);
  await upload('https://example.com/bridge'); await page.getByText('连接文件只能指向', { exact: false }).waitFor(); assert.equal(requests.length, 0);
  await upload('http://127.0.0.1:17863'); await page.getByText('连接文件已导入，点击保存', { exact: false }).waitFor();
  assert.equal((await page.locator('html').innerHTML()).includes(token), false); assert.equal(await page.getByLabel('固定本机地址').inputValue(), 'http://127.0.0.1:17863');
  await page.getByRole('button', { name: '授权接口并保存', exact: true }).click(); await page.getByText('配置已保存', { exact: false }).waitFor();
  const cli = await savedConfig(); assert.equal(cli.mode, 'codex-cli'); assert.equal(cli.tokenMatches, true); assert.equal(cli.prefetch, false); assert.equal(cli.prefetchExpressions, false); assert.equal(cli.model, ''); assert.equal(requests.length, 0);
  assert.ok((await page.evaluate(() => globalThis.permissionRequests)).some((origins) => origins.includes('http://127.0.0.1:17863/*')));
  log('拒绝远端连接文件，合法CLI令牌只入IDB，保存只申请localhost权限并关闭预译');
  await page.getByRole('button', { name: '测试连接', exact: true }).click(); await page.getByText('桥接连接成功', { exact: false }).waitFor(); assert.deepEqual(requests.map((request) => request.path), ['/status']); assert.equal(requests[0].authorizationMatches, true);
  await page.getByRole('button', { name: '试译一句（调用CLI）', exact: true }).click(); await page.getByText('CLI 试译成功', { exact: false }).waitFor(); assert.deepEqual(requests.map((request) => request.path), ['/status', '/translate']); assert.equal(requests[1].body.sentence, 'This is a connection test.'); assert.equal(requests[1].authorizationMatches, true);
  log('测试连接只访问status并确认ChatGPT，明确试译按钮才调用translate');
  await mkdir('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/providers-v08-cli.png', fullPage: true });
  await page.reload(); await page.getByText('已保存本机连接，令牌不回显', { exact: true }).waitFor(); assert.equal((await page.locator('html').innerHTML()).includes(token), false);
  await page.getByLabel('服务', { exact: true }).selectOption('cloud'); assert.equal(await page.getByLabel('API Key', { exact: true }).inputValue(), ''); assert.match(await page.getByLabel('HTTPS 接口完整地址').inputValue(), /^https:/);
  await page.getByRole('button', { name: '测试连接', exact: true }).click(); await page.getByText('修改接口地址后请重新输入 API Key', { exact: false }).waitFor(); assert.equal(cloudRequests.length, 0); assert.equal((await savedConfig()).mode, 'codex-cli');
  await page.getByLabel('服务', { exact: true }).selectOption('codex-cli'); await page.getByLabel('服务', { exact: true }).selectOption('mymemory'); await page.getByRole('button', { name: '授权接口并保存', exact: true }).click(); await page.getByText('配置已保存', { exact: false }).waitFor(); assert.equal((await savedConfig()).secretEmpty, true); assert.match((await savedConfig()).endpoint, /^https:/);
  await page.getByLabel('服务', { exact: true }).selectOption('codex-cli'); await page.getByLabel('服务', { exact: true }).selectOption('off'); await page.getByRole('button', { name: '授权接口并保存', exact: true }).click(); await page.getByText('配置已保存', { exact: false }).waitFor(); assert.equal((await savedConfig()).mode, 'off');
  await page.getByLabel('服务', { exact: true }).selectOption('codex-cli'); await upload('http://127.0.0.1:17863'); await page.getByRole('button', { name: '授权接口并保存', exact: true }).click(); await page.getByText('配置已保存', { exact: false }).waitFor(); await page.getByRole('button', { name: '清除密钥', exact: true }).click(); await page.getByText('密钥已清除，联网已关闭', { exact: true }).waitFor();
  const cleared = await savedConfig(); assert.equal(cleared.mode, 'off'); assert.equal(cleared.secretEmpty, true); assert.match(cleared.endpoint, /^https:/);
  assert.equal(cloudRequests.length, 0); assert.equal(requests.filter((request) => request.path === '/translate').length, 1);
  log('CLI令牌不跨云端复用，MyMemory/关闭可保存，清钥同步关闭并清空令牌');
  await writeFile('test-results/providers-v08-report.json', JSON.stringify({ ...report, requests: requests.map(({ path, method, authorizationMatches }) => ({ path, method, authorizationMatches })) }, null, 2));
} catch (error) { await mkdir('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/providers-v08-failure.png', fullPage: true }).catch(() => {}); await writeFile('test-results/providers-v08-report.json', JSON.stringify({ ...report, failure: error.stack }, null, 2)); throw error; }
finally { await run.context.close(); }
