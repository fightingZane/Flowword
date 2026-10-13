import { resolve } from 'node:path';
import { mkdir, mkdtemp } from 'node:fs/promises';

export async function launchTestBrowser(options = {}) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = resolve('.cache/ms-playwright');
  const { chromium } = await import('playwright');
  await mkdir('.cache/profiles', { recursive: true });
  const profile = options.profile ?? await mkdtemp(resolve('.cache/profiles/flowword-'));
  const extension = resolve('.output/chrome-mv3');
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--autoplay-policy=no-user-gesture-required'],
    ...options.browserOptions,
  });   // 只使用专用测试配置，完全隔离用户的 Chrome/Edge 浏览器资料
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 20000 });
  const extensionId = new URL(worker.url()).hostname;
  return { context, worker, profile, extensionId };
}
