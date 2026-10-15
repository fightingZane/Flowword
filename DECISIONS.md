# 技术决策 · 2026-10-13

## D001：交付 S0/S1 技术预览

用户的“开始制作这个悬浮球”明确授权进入实现。按照 V2.0 顺序先做字幕捕获与交互；没有真实 YouTube 验证时，不宣称 S0 完成，不提前开发伪造生词分析。

用户指定 GPT-6.1-sol / Max 子代理负责决策。它确认此交付边界，并审查字幕来源、取消竞态、媒体变化、拖动和权限。

## D002：采用 WXT + React + TypeScript

与审核方案一致。WXT 管理 MV3 清单、构建及 Shadow Root UI；React 负责组件；纯 TypeScript 模块处理可测试逻辑。使用 package-lock.json 与精确依赖版本，避免后续自动更新引入不明变动。

[WXT Shadow Root 官方方案](https://wxt.dev/guide/essentials/content-scripts.html#shadow-root)、[React 模块](https://wxt.dev/guide/essentials/frontend-frameworks.html)

## D003：标准英文轨道优先，页面字幕作为明确后备

只选 captions/subtitles 的单一英文轨道，优先 showing；唯一 hidden 轨道作为回退。chapters / metadata 不作为字幕，不混合多条英文轨道。正常采样使用 activeCues。

WebVTT 内容使用 getCueAsHTML().textContent，不把字幕字符串写进页面 innerHTML。YouTube DOM 选择器集中管理，读取页面中实际可见的字幕。

DOM 通常不能可靠确认语言，因此记录 und 并要求用户确认 English。拉丁字母检查只过滤明显不适合的文本。

[activeCues](https://developer.mozilla.org/en-US/docs/Web/API/TextTrack/activeCues)、[WebVTT 文本解析](https://developer.mozilla.org/en-US/docs/Web/API/VTTCue/getCueAsHTML)

## D004：暂停归属及取消优先

用户点击先暂停，再整理字幕。用户原先暂停的主视频不会自动播放。关闭面板不自动播放；“继续观看”只在视频身份仍匹配时恢复。每个操作的超时和取消都绑定自己的 AbortController。

后台只维护图标，核心状态不依赖 Service Worker 常驻；设置存入 chrome.storage.local。

[扩展存储官方说明](https://developer.chrome.com/docs/extensions/reference/api/storage)

## D005：全屏跟随真实 fullscreenElement

悬浮 UI 移入播放器的全屏容器，退出后移回 body。原生 video 自身全屏时隐藏 UI 并列为限制。测试必须验证 fullscreenElement 非空且包含 shadowHost，不能只用 CSS 模拟全屏。

[fullscreenElement](https://developer.mozilla.org/en-US/docs/Web/API/Document/fullscreenElement)

## D006：最小站点访问范围

权限为 storage 和 activeTab，内容脚本范围为 https://www.youtube.com/*，没有 all_urls、tabs、debugger 或远程服务权限。默认关闭；开关开启后全局应用于标准视频页。

静态内容脚本已经定义了站点访问范围，不将其宣传为纯 activeTab 临时访问。

[activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)、[权限声明](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)

## D007：隔离自动化测试

用 Playwright 自带 Chromium 加载生产扩展，专用缓存与用户资料在项目目录内。Chrome / Edge 日常配置不改动；真实 YouTube 只访问公开视频，不登录。

本地预设字幕用于测试，不作为真实字幕捕获的验收证据。真实页面受限时保留失败截图和原因。

[Playwright 扩展测试](https://playwright.dev/docs/chrome-extensions)

## D008：精确时间命中，过去缓存回退

缓存先选 start <= target <= end 的片段，未命中时只回退到已结束且距离不超过 0.65 秒的片段，不向未来寻找字幕。字幕轨道的缓存 end 只记到实际观测时间，轨道切换及标准轨道 / DOM 来源变化时清空缓存。

单元和真实扩展偏移用例已覆盖时间边界：下一条字幕即使只比目标晚 0.1 秒，也不能覆盖仍应选择的上一条。

## D009：使用真正有限的测试媒体

MAIN world 修改 video.duration 不会改变内容脚本 ISOLATED world 的原生属性，因此不采用属性覆盖模拟有限视频。用户指定的技术决策子代理生成自建 90 秒 VP8 WebM，浏览器两个 world 的原生 duration 均为 90。HTTP 路由支持 Range / 206，验证真实 seeking 完成。

媒体由本项目脚本绘制，无第三方素材，不增加生产依赖。直播拒绝另用真实 MediaStream 测试。

## D010：0.2 翻译与词本

联网默认关闭，用户在右键配置中主动开启。采用固定 MyMemory GET 服务，不使用未经说明的Google接口或上传用户视频地址；匿名服务有额度，字幕可能长期保存并交给第三方机译处理。依据：https://mymemory.translated.net/doc/spec.php 与 https://mymemory.translated.net/terms-and-conditions

整句UTF8分段，失败不标完整成功。候选是本地难度参考，不是个人不会概率。通用义未经语境消歧；八词自编中文义以Cambridge词典核验并保留链接，词性由用户确定。技术决策子代理使用用户指定GPT-6.1-sol Max完成方案与多轮审查；末次集成复审因用量限制未执行，主代理完成类型、单元和浏览器验证。

词本采用本地IndexedDB，重复合并，编辑可移除标签，导出读取最新完整数据。保留旧版加载目录更新内容，避免卸载导致数据丢失。

## D011：0.3批准与交付

用户明确“开始直接开发”，批准云端模型可配置并接受少量费用。密钥只在扩展来源页面输入，存独立IDB；不经content公开配置回传。整句先返回，表达后补；预译单独授权、预算20句、持久缓存、前台保留两槽和有界队列。

通用站optional按origin申请并动态注册，顶层原生英文轨道；无头授权弹窗无法确认时使用只预授一个owned origin的受控副本测试，生产manifest不变。实际系统快捷键/权限同意撤销/真实模型待人工验收，不能把模拟协议当真服务证明。

保留旧DB version1，新archive分库。历史occurrence义与原文不因最新收藏或改名覆盖，videoKey参与去重并导入保留end。溯源句首与重听采用同一观测范围。新增函数按更新AGENTS补名称、参数、用途和限制简介，注释不带句号。

## D012：0.3.1非思考与双缓存
DeepSeek官方思考默认enabled/high，官方来源https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/，仅api.deepseek.com显式disabled，不改变模型名、不把厂商参数强加其他服务。前台两路并行独立emit，整句和表达均JSON持久缓存，空表达列表有效，坏结果不缓存成功。
旧预译范围保留，新prefetchExpressions默认false独立授权，仍20句预算，每新句最多额外解析调用。后台模式与权限出队复查。浏览器缓存命中48ms属于本地合成夹具测量，实际在线延迟仍待用户配置验收，不能承诺任意首句零等待。
主题变量移根节点，避免CSS变量子到父不可继承；中文直接放英文正下方，动作与邻句排后。

## D013：0.4来源与语境边界
已加入只表示条目存在，仍允许收藏新的视频语境，不能因全局去重丢失occurrence
空义候选不展示，不为凑数伪造解释；科技通用义不替代当前语境义
不擅自切换用户的MyMemory到付费云模型，不对整句做全局术语替换
封面需用户点击加载，默认不向第三方发送图片请求
缓存质量升版，不以移除真实邻句语义换命中率

## D014：0.5设置与词本嵌入
新安装预填DeepSeek模型但有效联网保持关闭，已有显式配置保留，未配置不回退MyMemory
扩展iframe承担秘密输入，不将Key交给网页父节点；换endpoint须重输Key
邻句无译文不显示无用占位，按需点击查询，已有结果直接复用
