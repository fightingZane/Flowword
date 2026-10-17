# 开发与文件管理

## 环境和命令

使用 package.json 规定范围内的 Node.js，推荐 Node.js 24。依赖版本由 package-lock.json 锁定，首次使用 npm ci，不需要全局安装 WXT。

```powershell
npm ci                    # 安装锁定版本依赖
npm run build             # 生产构建，加载 .output/chrome-mv3
npm run typecheck         # 检查类型
npm test                  # 执行单元测试
npm run browser:install   # 下载项目内测试浏览器，首次运行需要网络
npm run verify            # 执行完整本地验证链路
npm run bridge            # 启动可选本机Codex桥接，连接文件在.local
npm run zip               # 生成 .output/flowword-版本号-chrome.zip
```

完整回归使用独立浏览器资料和自建字幕夹具。真实服务脚本不在普通单元测试内；执行前阅读脚本，确认将发送的文本和服务。不要用个人视频或真实 Key 替换测试代码中的模拟值。

## 源码模块

| 目录 | 内容 |
| --- | --- |
| entrypoints/ | MV3 后台、内容脚本、工具栏、模型配置与完整词本入口 |
| src/adapters/ | YouTube 与通用 HTML5 视频、字幕适配 |
| src/core/ | 交互状态、拼句、重听、词汇候选与筛选 |
| src/services/ | 云模型与参考翻译、请求调度、预译 |
| src/storage/ | IndexedDB 词本、归档、服务配置与设置 |
| src/ui/ | 悬浮框、快捷词本、邻句、主题滚动条和收藏表单 |
| tests/ | 单元测试、归档浏览器验证及本地视频夹具 |
| scripts/ | 其余浏览器验证、图标、测试浏览器与发布辅助 |
| public/ | 扩展图标等静态资源 |
| docs/assets/ | README 使用的演示截图，不含真实密钥或个人词本 |

## 生成目录

| 目录 | 是否提交 Git | 用途 |
| --- | --- | --- |
| node_modules/ | 否 | 项目依赖，可用 npm ci 恢复 |
| .cache/ | 否 | 测试浏览器、隔离资料和下载缓存 |
| .wxt/ | 否 | WXT 生成的类型与构建辅助 |
| .output/ | 否 | 可加载扩展和 ZIP |
| test-results/ | 否 | 截图与验证报告 |
| release/ | 否 | 本机交付目录、ZIP 与验证证据 |

不要移动用户当前浏览器已加载的扩展目录。目录名称可能保留旧版编号，实际版本以 manifest.json 为准。

## 发布整理脚本的边界

普通源码使用 build，ZIP 分发使用 zip。package 脚本主要整理本机 release，并复制一组验证截图和历史报告；缺失证据会在evidence-manifest.json中逐项标记，不当作已验证；普通使用者无需收集历史截图。

## 文档规范

README 描述当前能力，不把计划写成已完成。CHANGELOG 记录版本变化，TEST_REPORT 记录实测范围与限制。实现细节放在 docs/，历史修改按版本归入 docs/changes/。

当前没有新增许可证或云端同步功能。发布源码不等于同步用户浏览器内的收藏和 API 配置。

0.6完整本地验收执行npm run verify，包含事务单元测试、新词本7场景和设置安全8场景；网络均为模拟，不调用用户实际付费模型。

0.7新增npm run test:selection与npm run test:ui，均使用隔离浏览器与自编网页/来源。测试用受控单域授权克隆时必须明确记录，不能视作真实浏览器原生授权弹窗验收。

## 可选CLI后端

桥接是项目内Node程序，浏览器只提交固定翻译任务，不能传命令或执行路径。凭据仅保存在.local与扩展来源IDB，不参与备份/日志/Git；CLI登录由官方工具自行管理，插件不读取登录文件。服务协议、模型与地址参与缓存身份，切换服务取消旧共享请求；CLI不自动预译、不静默退回其他服务。
