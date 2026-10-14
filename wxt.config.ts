import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'FlowWord · 英语视频悬浮助手',
    description: '停一下，看懂这一句 · 在 YouTube 中捕获当前字幕，安静地陪你学习',
    permissions: ['storage', 'activeTab'],   // 仅保存设置并读取用户主动打开插件的标签页
    host_permissions: ['https://api.mymemory.translated.net/*'],   // 只访问固定翻译服务，用户开启联网后才请求
    action: { default_title: 'FlowWord · 开启悬浮球' },
    icons: {
      16: '/icons/16.png',
      32: '/icons/32.png',
      48: '/icons/48.png',
      128: '/icons/128.png',
    },
  },
});
