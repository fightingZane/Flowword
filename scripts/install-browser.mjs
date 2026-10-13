import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { access, mkdir, readFile } from 'node:fs/promises';

process.env.PLAYWRIGHT_BROWSERS_PATH = resolve('.cache/ms-playwright');
const { chromium } = await import('playwright');
if (await access(chromium.executablePath()).then(() => true).catch(() => false)) {
  console.log('项目缓存中已有测试 Chromium');
  process.exit(0);
}
const result = spawnSync(process.execPath, ['node_modules/playwright/cli.js', 'install', 'chromium'], {
  stdio: 'inherit',
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: resolve('.cache/ms-playwright') },
});   // 浏览器测试环境放在项目目录，不修改日常浏览器配置
if (result.status === 0) process.exit(0);
if (process.platform !== 'win32' || process.arch !== 'x64') process.exit(result.status ?? 1);

// 标准下载器失败时，使用官方 Chrome for Testing 同版本下载地址
// 该回退只用于 Windows 测试环境，不影响生产扩展与用户浏览器
const registry = JSON.parse(await readFile('node_modules/playwright-core/browsers.json', 'utf8'));
const browser = registry.browsers.find((item) => item.name === 'chromium');
if (!/^\d+\.\d+\.\d+\.\d+$/.test(browser.browserVersion)) throw new Error('测试浏览器版本无效');
const directory = resolve(`.cache/ms-playwright/chromium-${browser.revision}`);
const archive = resolve('.cache/ms-playwright/chromium.zip');
await mkdir(directory, { recursive: true });
const proxy = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;
const curl = spawnSync('curl.exe', ['-sS', '-L', '--fail', '--max-time', '240',
  ...(proxy ? ['--proxy', proxy] : []),
  `https://storage.googleapis.com/chrome-for-testing-public/${browser.browserVersion}/win64/chrome-win64.zip`, '-o', archive], { stdio: 'inherit' });
if (curl.status !== 0) process.exit(curl.status ?? 1);
const literal = (path) => `'${path.replaceAll("'", "''")}'`;
const unpack = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  `Expand-Archive -LiteralPath ${literal(archive)} -DestinationPath ${literal(directory)} -Force`], { stdio: 'inherit' });
if (unpack.status !== 0) process.exit(unpack.status ?? 1);
await access(chromium.executablePath());
console.log('官方测试 Chromium 已解压到项目缓存');
