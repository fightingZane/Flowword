# FlowWord

停一下，看懂这一句。

这是 **0.1.0 字幕捕获技术预览版（S0/S1）**，优先支持 Windows 上 Chrome / Edge 的 YouTube 标准视频页。现阶段提供真实字幕原文，不提供生词释义、整句翻译或 AI 分析。

## 三分钟安装

1. Chrome 打开 `chrome://extensions`；Edge 打开 `edge://extensions`
2. 打开「开发者模式」
3. 点击「加载已解压的扩展程序」或「加载解压缩的扩展」
4. 选择本项目下的 `release/FlowWord-0.1.0` 文件夹，文件夹里面应直接有 `manifest.json`
5. 打开 YouTube 普通视频页，**首次安装后刷新该页**
6. 在播放器打开 CC，选择 **English / 英语**，然后点击浏览器工具栏中的 FlowWord 图标，开启「YouTube 悬浮球」

无需注册、API Key、服务器或安装 Node.js。扩展尚未发布到商店，开发者模式安装可能显示浏览器的常规提醒。

## 使用

- **单击悬浮球**：暂停主视频，显示刚才捕获到的字幕原文
- **拖动悬浮球**：移动并贴到最近的屏幕边缘，记住相对位置
- **上一条字幕**：查看已缓存的上一条片段，不跳转视频进度
- **回到点击时刻**：回到本次暂停位置对应的字幕
- **字幕时间微调**：在 −2 到 +2 秒之间按 0.5 秒调整，不会移动视频进度
- **复制原文**：复制捕获的字幕
- **继续观看**：只恢复由插件亲自暂停且身份未改变的主视频
- **完成**：视频原本暂停时，结束查看并维持暂停
- **关闭面板 / Escape**：收起气泡，维持当前播放状态
- **浏览器图标中的开关**：关闭后不读取字幕，也不自动恢复视频

开关是 YouTube 的全局设置：开启后，当前及新开的标准视频页面均生效，不是单标签页的临时开关。插件从不主动暂停视频或弹出分析结果。悬浮球支持 Enter / 空格操作，面板内的键盘操作不会触发播放器快捷键。

## 首版限制

- 仅支持 `https://www.youtube.com/watch?v=...`，不支持 Shorts、嵌入播放器、其他网站、手机或 Windows 系统悬浮窗
- 必须先启用可读取的字幕；没有字幕会明确报错
- 标准英文字幕轨道可确认语言；YouTube 页面字幕通常不提供语言标记，因此显示 English 确认提示，**不能自动证明当前字幕是英语**
- DOM 缓存最多保留 12 秒；正向偏移处尚无已观测字幕时会提示失败，不生成未来原句
- 字幕拼接只使用相邻的已观测片段，不保证得到完整句子
- 广告和直播不支持；页面改版、平台限制及广告切换可能影响读取
- 适配播放器容器全屏；原生 `video` 元素单独全屏时暂时隐藏悬浮球
- 关闭、禁用或换视频不会自动恢复旧视频；可以使用 YouTube 自己的播放按钮

查看 [验证报告](TEST_REPORT.md)，区分本地扩展集成测试与真实 YouTube 的验证结果。S0 是否通过以真实页面证据为准，不能用预设字幕的测试场景代替。

## 隐私与权限

生产扩展仅申请 `storage`、`activeTab`，静态内容脚本的站点匹配只包含 `https://www.youtube.com/*`。静态脚本具有该站点的访问范围，不是仅在点击时获得的临时访问。

默认关闭；开启并进入普通视频页后，字幕缓存在页面内存中。位置、开关和时间偏移保存在扩展自己的 `chrome.storage.local` 中。当前版本不上传字幕、浏览记录或设置，不连接词典 / AI 服务，没有账户系统。

浏览器关闭后不保留字幕缓存。移除扩展会删除扩展设置。

## 本地开发

推荐 Node.js 24，支持 Node.js 22.12 及以上的 22 分支、24 分支或 26 及以后版本；依赖已锁定到 `package-lock.json`。

```powershell
npm ci
npm run typecheck
npm test
npm run build
npm run browser:install
npm run test:e2e
npm run test:youtube
npm run zip
npm run package
```

`npm run dev` 用于开发。正式交付只加载生产目录 `release/FlowWord-0.1.0`；不要加载开发目录。

测试浏览器与临时配置均位于项目 `.cache` 中，不操作用户常用的浏览器资料。下载测试浏览器需要能访问 Playwright / Chrome for Testing 的官方 CDN。真实 YouTube 测试使用公开链接，可通过 `FLOWWORD_TEST_URL` 环境变量指定其他视频。

测试夹具 `tests/fixtures/player.html` 明确标注为本地模拟页面。它用于验证生产扩展的真实加载与交互，不能代表 YouTube 网站兼容性。

正常媒体为项目自建的 90 秒有限 WebM，已随源码保存，运行测试无需安装 Python。只有重新生成媒体时才需要 `scripts/make-test-video.py` 及 OpenCV / NumPy。

## 项目文档

- [ARCHITECTURE.md](ARCHITECTURE.md)：模块和状态机
- [TASKS.md](TASKS.md)：阶段及验收清单
- [DECISIONS.md](DECISIONS.md)：技术取舍与来源
- [TEST_REPORT.md](TEST_REPORT.md)：当前验证结果

后续按 S2 生词与词组 → S3 个性化与词库 → S4 可选 AI 的顺序推进；S0 的真实字幕读取验证通过前，不宣称完整英语学习产品已经完成。
