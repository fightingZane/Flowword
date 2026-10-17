import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { launchTestBrowser } from './test-browser.mjs';
const run = await launchTestBrowser();
const page = await run.context.newPage();
page.setDefaultTimeout(15000);
const fixture = await readFile('tests/fixtures/player.html', 'utf8');
const media = await readFile('tests/fixtures/test-video.webm');
const report = { environment: 'production extension, synthetic authorized YouTube fixture, no model requests', cases: [] };
try {
  await run.context.route('https://www.youtube.com/**', (route) => new URL(route.request().url()).pathname === '/flowword-test-video.webm' ? route.fulfill({ contentType: 'video/webm', body: media }) : route.fulfill({ contentType: 'text/html', body: fixture }));
  await run.context.route('https://api.**/*', (route) => route.abort());
  await run.worker.evaluate(() => chrome.storage.local.set({ 'flowword.enabled.v1': true, 'flowword.onlineTranslation.v1': false }));
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('https://www.youtube.com/watch?v=settings-v091-fixture');
  const ball = page.getByRole('button', { name: '暂停视频并捕获字幕' });
  await ball.waitFor();
  for (const theme of ['blue', 'dark', 'light']) {
    await run.worker.evaluate(async (theme) => { const key = 'flowword.appearance.v1'; const stored = await chrome.storage.local.get(key); await chrome.storage.local.set({ [key]: { ...stored[key], panelTheme: theme, panelWidth: 700, panelHeight: 850 } }); }, theme);
    await ball.click({ button: 'right' });
    const tabs = page.locator('.fw-settings-tabs');
    await tabs.waitFor();
    const colors = await tabs.locator('button').evaluateAll((buttons) => buttons.map((button) => {
      const style = getComputedStyle(button);
      // luminance 计算sRGB颜色亮度，color来自浏览器计算值，只用于对比度验收
      const luminance = (color) => { const rgb = color.match(/[\d.]+/g).slice(0, 3).map(Number).map((n) => { const x = n / 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; }); return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722; };
      const a = luminance(style.color); const b = luminance(style.backgroundColor);
      return { text: button.textContent, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), background: style.backgroundColor };
    }));
    for (const button of colors) assert(button.ratio >= 4.5, `${theme} ${button.text} contrast ${button.ratio}`);
    await tabs.getByRole('button', { name: '总设置', exact: true }).click();
    const iframe = page.locator('iframe[title="模型与快捷键设置"]');
    const frame = page.frameLocator('iframe[title="模型与快捷键设置"]');
    await frame.getByRole('heading', { name: '使用范围' }).waitFor();
    await page.waitForTimeout(150);
    const size = await iframe.evaluate((element) => ({ height: element.getBoundingClientRect().height, bodyHeight: element.closest('.fw-body').getBoundingClientRect().height, bodyScroll: element.closest('.fw-body').scrollHeight - element.closest('.fw-body').clientHeight }));
    assert(size.height > size.bodyHeight * .6, JSON.stringify(size));
    assert(size.bodyScroll <= 1, `outer body scroll ${size.bodyScroll}`);
    assert.equal(await frame.locator('html').getAttribute('data-theme'), theme);
    await frame.getByRole('button', { name: '模型服务', exact: true }).click();
    await frame.getByLabel('服务', { exact: true }).waitFor();
    await frame.getByRole('button', { name: '网站范围', exact: true }).click();
    await frame.getByRole('heading', { name: '使用范围' }).waitFor();
    await page.waitForTimeout(180);
    report.cases.push({ theme, colors, size });
    await mkdir('test-results', { recursive: true });
    await page.screenshot({ path: `test-results/settings-v091-${theme}.png` });
    await page.getByRole('button', { name: '关闭面板，保持视频暂停' }).click();
  }
  await run.worker.evaluate(async () => { const key='flowword.appearance.v1'; const stored=await chrome.storage.local.get(key); await chrome.storage.local.set({[key]:{...stored[key],panelTheme:'blue'}}); });
  await ball.click({button:'right'});
  await page.locator('.fw-app').evaluate((node) => { for (const [key,color] of Object.entries({paper:'#1d2122',ink:'#cbdce8',muted:'#9dafa8',line:'#315064',green:'#365c75',wash:'#252b2e','on-green':'#d3e3ef'})) node.style.setProperty('--fw-'+key,color); });
  await page.locator('.fw-settings-tabs').getByRole('button',{name:'总设置',exact:true}).click();
  const matched=page.frameLocator('iframe[title="模型与快捷键设置"]'); await matched.getByRole('heading',{name:'使用范围'}).waitFor();
  await page.waitForFunction(() => document.querySelector('flowword-ui')?.shadowRoot?.querySelector('iframe')?.src.includes('palette='));
  const outside=await page.locator('.fw-bubble').evaluate((node)=>({background:getComputedStyle(node).backgroundColor,color:getComputedStyle(node).color}));
  const inside=await matched.locator('main').evaluate((node)=>({background:getComputedStyle(node).backgroundColor,color:getComputedStyle(node).color}));
  assert.deepEqual(inside,outside);
  const accent=await matched.getByRole('button',{name:'显示所有打开的网站',exact:true}).evaluate((node)=>getComputedStyle(node).backgroundColor); assert.equal(accent,'rgb(54, 92, 117)');
  report.cases.push({name:'actual parent palette overrides named theme',outside,inside});
  await page.screenshot({path:'test-results/settings-v092-matched.png'});
  await page.getByRole('button',{name:'关闭面板，保持视频暂停'}).click();
  await page.setViewportSize({ width: 375, height: 720 });
  await ball.click({ button: 'right' });
  await page.locator('.fw-settings-tabs').getByRole('button', { name: '总设置', exact: true }).click();
  const frame = page.frameLocator('iframe[title="模型与快捷键设置"]');
  await frame.getByRole('heading', { name: '使用范围' }).waitFor();
  const narrow = await page.locator('iframe[title="模型与快捷键设置"]').evaluate((element) => { const box = element.getBoundingClientRect(); return { x: box.x, right: box.right, width: innerWidth, height: box.height }; });
  assert(narrow.x >= 0 && narrow.right <= narrow.width + 1 && narrow.height > 300, JSON.stringify(narrow));
  const inner = await frame.locator('html').evaluate((element) => ({ width: element.clientWidth, scroll: element.scrollWidth }));
  assert(inner.scroll <= inner.width + 1, JSON.stringify(inner));
  report.cases.push({ narrow, inner });
  await page.screenshot({ path: 'test-results/settings-v091-narrow.png' });
  console.log('PASS settings themes, tab contrast, flexible frame and narrow viewport');
} finally {
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/settings-v091-report.json', JSON.stringify(report, null, 2));
  await run.context.close();
}
