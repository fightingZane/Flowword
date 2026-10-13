import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { STORAGE } from '../src/storage/settings';

export default defineBackground(() => {
  async function updateBadge() {
    const stored = await browser.storage.local.get(STORAGE.enabled);
    const enabled = stored[STORAGE.enabled] === true;
    await browser.action.setBadgeText({ text: enabled ? 'ON' : '' });
    await browser.action.setBadgeBackgroundColor({ color: '#355f47' });
    await browser.action.setTitle({ title: enabled ? 'FlowWord · 悬浮球已开启' : 'FlowWord · 开启悬浮球' });
  }
  const refresh = () => { void updateBadge().catch((error) => console.warn('FlowWord 标识更新失败', error)); };
  browser.runtime.onInstalled.addListener(refresh);
  browser.runtime.onStartup.addListener(refresh);
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && STORAGE.enabled in changes) refresh();
  });   // 后台只更新图标，核心交互和设置不依赖内存中的全局变量
});
