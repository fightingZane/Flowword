import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { launchTestBrowser } from '../scripts/test-browser.mjs';

const run = await launchTestBrowser();
const page = await run.context.newPage();
page.setDefaultTimeout(15000);
const cases = [];
// log 表示记录界面验收项，name 为通过项目文字，只在断言成功后调用
const log = (name) => { cases.push(name); console.log(`PASS ${name}`); };
try {
  const thumbnailRequests = [];
  await run.context.route('https://i.ytimg.com/**', (route) => { thumbnailRequests.push(route.request().url()); return route.fulfill({ status: 404, body: '' }); });
  await page.goto(`chrome-extension://${run.extensionId}/wordbook.html`);
  const texts = ['telephoto lens', 'computational photography', 'dynamic range', 'rule of thumb', 'in a nutshell', 'optical stabilisation', 'Depth perception depends on visual cues.', 'A subtle change makes a difference.', 'feasible'];
  for (let index = 0; index < texts.length; index++) {
    const video = index % 3;
    const result = await page.evaluate((entry) => chrome.runtime.sendMessage({ type: 'FLOWWORD_BOOK_SAVE', entry }), { kind: index < 6 ? 'phrase' : index < 8 ? 'sentence' : 'word', text: texts[index], translation: ['长焦镜头', '计算摄影', '动态范围', '经验法则', '简而言之', '光学防抖', '深度感知取决于视觉线索', '细微变化也会产生影响', '可行的'][index], partOfSpeech: '短语', tags: ['科技表达'], examTags: ['听力理解'], contexts: [{ sentence: `This lesson explains ${texts[index]}.`, url: video === 2 ? 'https://example.com/course/photography' : `https://www.youtube.com/watch?v=${video ? 'abcdefghijk' : 'zyxwvutsrqp'}`, title: ['Camera design and the art of seeing', 'Everyday English · natural expressions', 'Photography fundamentals'][video], time: index * 17, end: index * 17 + 5 }] });
    assert.equal(result.ok, true);
  }
  await page.reload(); await page.getByRole('heading', { name: 'telephoto lens', exact: true }).waitFor();
  await page.setViewportSize({ width: 1920, height: 1080 });
  assert.equal(await page.locator('.book').getAttribute('data-layout'), 'list');
  await page.getByLabel('词本显示方式').selectOption('cards');
  await page.waitForFunction(() => document.querySelector('.book')?.dataset.layout === 'cards');
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.book-video-links')).some((item) => item.textContent.includes('封面暂不可用')));
  assert.ok(thumbnailRequests.length >= 1);
  assert.equal(await page.locator('.book-video').count(), 3);
  const cardWidth = await page.locator('.book-card').first().evaluate((element) => element.getBoundingClientRect().width);
  assert.ok(cardWidth < 500);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/wordbook-sidebar-wide.png', fullPage: true });
  log('宽屏默认少量列表，可切换紧凑词卡，授权的封面自动加载且无横向溢出');
  await page.getByRole('button', { name: '查看视频：Camera design and the art of seeing', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.book-card').length === 3);
  await page.getByLabel('自动加载视频封面').uncheck();
  assert.equal(await page.locator('.book-video img').count(), 0);
  log('视频筛选与封面关闭，失败保持本地占位');
  await page.getByRole('button', { name: '收起视频资料栏' }).click();
  assert.equal(await page.locator('.book').getAttribute('data-sidebar-collapsed'), 'true');
  await page.getByRole('button', { name: '展开视频资料栏' }).click();
  await page.getByRole('button', { name: '全部收藏', exact: false }).click();
  await page.getByLabel('单词本主题').selectOption('dark');
  await page.screenshot({ path: 'test-results/wordbook-sidebar-dark.png', fullPage: true });
  log('侧栏折叠展开与全页暗色主题');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: 'test-results/wordbook-sidebar-narrow.png', fullPage: true });
  log('窄屏视频横向资料栏与单列卡片无页面横向溢出');
  await writeFile('test-results/archive-layout-report.json', JSON.stringify({ environment: 'production extension; synthetic self-authored learning entries; remote thumbnail intercepted', cases }, null, 2));
} catch (error) {
  await mkdir('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/archive-layout-failure.png', fullPage: true });
  await writeFile('test-results/archive-layout-report.json', JSON.stringify({ cases, failure: error.stack }, null, 2)); throw error;
} finally { await run.context.close(); }
