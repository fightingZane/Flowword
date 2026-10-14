# FlowWord 0.2 架构

WXT + React + TypeScript，Chrome MV3，YouTube Shadow DOM界面。

字幕适配器读取轨道与页面字幕；InteractionController 管理捕获和暂停所有权，以操作编号和 AbortSignal 拒绝旧结果。候选分析本地运行，核验八词先显示本地多义参考。允许联网时通过 background 请求固定 MyMemory 服务，缓存、串行队列、失败限速、UTF8分段；部分失败不标为完整翻译。

再次点击恢复所属视频并清理面板。已发出的服务请求不会因关框撤销，但迟到结果不覆盖当前句。外观设置队列避免快速更新相互覆盖。

词本在扩展 origin 的 IndexedDB，后台校验、去重合并、编辑标签可移除、重命名碰撞校验。独立词本页组合筛选；通知与窗口返回刷新，导出重新读取全部最新数据。
