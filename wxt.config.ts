import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'FlowWord · 英语视频悬浮助手',
    description: '停一下，看懂这一句 · 英语字幕、语境释义与视频学习档案',
    permissions: ['storage', 'activeTab', 'scripting'],   // 动态脚本仅注册到用户已授权的具体网站
    host_permissions: ['https://api.mymemory.translated.net/*'],   // 只访问固定翻译服务，用户开启联网后才请求
    optional_host_permissions: ['https://*/*', 'http://*/*'],   // 跨站与自选接口需要用户逐站授权，安装时不取得全站访问
    content_scripts: [{ matches: ['https://www.youtube.com/*'], js: ['content-scripts/flowword.js'], run_at: 'document_idle', all_frames: false }],
    web_accessible_resources: [{ resources: ['content-scripts/flowword.css', 'settings.html'], matches: ['https://*/*', 'http://*/*'] }],
    commands: {
      'flowword-toggle': { suggested_key: { default: 'Alt+Shift+P' }, description: '暂停捕获 / 继续观看' },
      'flowword-repeat': { suggested_key: { default: 'Alt+Shift+R' }, description: '重听当前字幕片段' },
    },   // 用户可在浏览器扩展快捷键页面改绑，不截获网页普通输入
    action: { default_title: 'FlowWord · 开启悬浮球' },
    icons: {
      16: '/icons/16.png',
      32: '/icons/32.png',
      48: '/icons/48.png',
      128: '/icons/128.png',
    },
  },
});
