# FlowWord 0.3 架构

WXT + React + TypeScript，Chrome MV3。内容脚本runtime编译，manifest唯一静态匹配YouTube，其他站按可选权限动态注册。CSS作为web-accessible资源手动送入Shadow UI，不以CSS可读范围代替网站读取授权。

YouTube适配器继续读取页面字幕/轨道；Generic适配器只识别顶层可见主HTML5视频与单一有效英文轨道。Subtitle Timeline整理真实当前及邻句，统一预译与点击的拼句/上下文缓存键。

InteractionController以操作编号与AbortSignal阻止过期结果；enrich并行请求整句与表达，独立emit合并字段、独立失败。Follow不暂停视频。独立ReplayController按视频时间重听，自己的seek/play有所有权，外部跳转或换源取消，句末暂停产生新的暂停归属。

云服务在background运行，完整HTTPS端点与密钥只在独立设置页配置。Key存在provider IndexedDB，公开消息只返回mode/model/prefetch/configured。请求禁止redirect、不带Cookie/referrer、输入是字幕数据，结果校验中文、JSON和原文表达跨度。MyMemory仅整句并保留限速。缓存绑定服务、模型、任务、原句和邻语境；预译单独开关与会话预算。

旧词本库保持version1，新archive库分别保存video/capture/occurrence，保留同词多来源语境。首次迁移是幂等操作，不删除旧库。跨库事务不能原子提交，失败可重试；v2备份包含词本和归档，v1也可导入。

浮框固定width/height，以flex内滚动支持字体独立。Pointer Capture处理移动/缩放，抬起用最后尺寸ref防同帧旧state。词本主题独立保存，主题变量在documentElement，html/body/root与内容区共用背景，覆盖两侧及底部。

0.3.1仅对DeepSeek官方域请求thinking disabled与任务输出上限，其他服务不附加专属参数。cache store继续v1，整句和表达各自保存校验JSON，键增加语言/提示版本/思考配置。旧预译只整句，新prefetchExpressions默认false，用户独立开启后每新句最多多一次解析调用，同20句预算。

## 0.4 阅读与收藏状态
球位置默认free，可选edge，仍以可视区域归一坐标持久化
面板打开和网页focus从后台读取收藏，保存确认后更新标识，不禁用重复表达的新语境收藏
表达推荐先校验中文义再slice，参考义来源名动态展示；MyMemory明确标参考机译
词本使用视频侧栏和响应式卡片，封面默认本地占位，仅主动加载YouTube图片
云质量缓存v4只归一空白，保留大小写字形标点与重复真实邻句

## 0.5 内嵌入口
模型设置使用web accessible settings.html的扩展来源iframe，Key仍仅扩展DB/ref且不回填input
内容脚本面板只获得公开服务信息，设置iframe不使用postMessage传Key
Popup用FLOWWORD_PANEL_OPEN通知当前已授权视频的内容脚本切换面板，快捷词本只有完整入口创建网页
NeighborLine在当前拼句范围外筛真实邻句，展开才查询，卸载忽略旧结果

## 0.5.1滚动与DOM重听
ScrollArea保留原生内容滚动但隐藏原生轨道，ResizeObserver/MutationObserver同步自绘滑块，指针和键盘映射scrollTop
ReplayController可选boundary实时确认DOM目标字幕进入后转换，不依赖已观测end或跳回后清理的字幕缓存
原生轨道保持cue.end，DOM实时读可见字幕，外部跳转/换源/暂停按旧归属规则取消
