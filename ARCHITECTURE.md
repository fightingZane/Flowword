# FlowWord 0.3 架构

WXT + React + TypeScript，Chrome MV3。内容脚本runtime编译，manifest唯一静态匹配YouTube，其他站按可选权限动态注册。CSS作为web-accessible资源手动送入Shadow UI，不以CSS可读范围代替网站读取授权。

YouTube适配器继续读取页面字幕/轨道；Generic适配器只识别顶层可见主HTML5视频与单一有效英文轨道。Subtitle Timeline整理真实当前及邻句，统一预译与点击的拼句/上下文缓存键。

InteractionController以操作编号与AbortSignal阻止过期结果；enrich可分步emit整句再表达。Follow不暂停视频。独立ReplayController按视频时间重听，自己的seek/play有所有权，外部跳转或换源取消，句末暂停产生新的暂停归属。

云服务在background运行，完整HTTPS端点与密钥只在独立设置页配置。Key存在provider IndexedDB，公开消息只返回mode/model/prefetch/configured。请求禁止redirect、不带Cookie/referrer、输入是字幕数据，结果校验中文、JSON和原文表达跨度。MyMemory仅整句并保留限速。缓存绑定服务、模型、任务、原句和邻语境；预译单独开关与会话预算。

旧词本库保持version1，新archive库分别保存video/capture/occurrence，保留同词多来源语境。首次迁移是幂等操作，不删除旧库。跨库事务不能原子提交，失败可重试；v2备份包含词本和归档，v1也可导入。

浮框固定width/height，以flex内滚动支持字体独立。Pointer Capture处理移动/缩放，抬起用最后尺寸ref防同帧旧state。词本主题独立保存。
