import { mkdir, writeFile } from 'node:fs/promises';
import { launchTestBrowser } from './test-browser.mjs';

// 只使用自编测试句，隔离资料，不读取或上传用户正在看的视频字幕
const proxy = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;
const run = await launchTestBrowser({ browserOptions: proxy ? { proxy: { server: proxy } } : {} });
const report = { environment: 'production MV3 background with live MyMemory service', inputSource: 'self-authored test sentence', status: 'pending' };
try {
  const page = await run.context.newPage();
  await page.goto(`chrome-extension://${run.extensionId}/wordbook.html`);
  await run.worker.evaluate(() => chrome.storage.local.set({ 'flowword.onlineTranslation.v1': true }));
  const result = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'FLOWWORD_TRANSLATE', sentence: 'I came across a rather obscure reference.' }));
  report.result = result;
  report.status = result?.ok && result.translation && result.provider === 'mymemory' ? 'passed' : 'partial-or-failed';
} catch (error) { report.status = 'failed'; report.reason = error.message; }
finally {
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/translation-live-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2)); await run.context.close();
  if (report.status !== 'passed') process.exitCode = 1;
}
