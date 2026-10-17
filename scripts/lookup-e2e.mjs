import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { launchTestBrowser } from './test-browser.mjs';

const run = await launchTestBrowser(); const page = await run.context.newPage();
const report = { environment: 'production UI with isolated profile and mocked lookup RPC; no live model call', cases: [] };
try {
  await page.addInitScript(() => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime); globalThis.lookupCalls = [];
    chrome.runtime.sendMessage = async (message, ...rest) => {
      if (message.type === 'FLOWWORD_LOOKUP') { globalThis.lookupCalls.push(message); return { ok: true, translation: '认为理所当然', examples: [{ sentence: 'Never take clean water for granted.', translation: '不要认为干净的水理所当然' }] }; }
      if (message.type === 'FLOWWORD_LOOKUP_LOCAL') return { ok: true, total: 1, matches: [{ id: 'fixture-source', sentence: 'We take for granted the things around us.', translation: '我们把身边的事物视作理所当然', url: 'https://example.test/essay', title: '真实收藏示例', source: { kind: 'web' } }] };
      if (message.type === 'FLOWWORD_REPLAY_SOURCE') { globalThis.openedSource = message.source; return { ok: true }; }
      return send(message, ...rest);
    };
  });
  await page.goto(`chrome-extension://${run.extensionId}/wordbook.html`);
  await page.getByRole('button', { name: '查词', exact: true }).click();
  await page.getByLabel('单词或词组', { exact: true }).fill('take for granted');
  assert.equal(await page.evaluate(() => globalThis.lookupCalls.length), 0);
  await page.locator('.fw-word-lookup form').evaluate((form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  assert.equal(await page.evaluate(() => globalThis.lookupCalls.length), 0);
  await page.getByRole('button', { name: '查找', exact: true }).click();
  await page.getByText('AI 生成例句', { exact: true }).waitFor();
  await page.getByText('Never take clean water for granted.', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => globalThis.lookupCalls.length), 1);
  await page.getByRole('button', { name: '真实收藏示例 · 回到原文', exact: true }).click();
  await page.waitForFunction(() => globalThis.openedSource?.url === 'https://example.test/essay');
  assert.equal(await page.evaluate(() => globalThis.openedSource.time), undefined);
  report.cases.push('输入不调用模型，显式提交自动生成例句，并展示真实收藏原句与网页回跳');
  await mkdir('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/lookup-wide.png', fullPage: true });
  await page.setViewportSize({ width: 420, height: 850 }); await page.screenshot({ path: 'test-results/lookup-narrow.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await page.getByRole('button', { name: '返回词本', exact: true }).click(); await page.getByRole('heading', { name: '全部收藏', exact: true }).waitFor();
  report.cases.push('窄屏无横向溢出，可返回完整词本');
  await writeFile('test-results/lookup-report.json', JSON.stringify(report, null, 2)); console.log('PASS lookup UI 2 cases (mocked RPC)');
} finally { await run.context.close(); }
