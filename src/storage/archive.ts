import type { WordbookEntry } from '../core/types';

export interface ArchiveContext { sentence: string; url: string; time: number; title?: string; videoKey?: string; end?: number; translation?: string }
export interface ArchiveVideo { id: string; url: string; title: string; updatedAt: number }
export interface ArchiveCapture extends ArchiveContext { id: string; videoId: string }
export interface ArchiveOccurrence { id: string; entryId: string; captureId: string; text: string; translation: string; createdAt: number }
export interface ArchiveSnapshot { videos: ArchiveVideo[]; captures: ArchiveCapture[]; occurrences: ArchiveOccurrence[] }
let database: Promise<IDBDatabase> | undefined;
// open 表示打开归档库，作用是复用扩展来源的数据库连接
// 无参数，只在扩展后台或扩展页面调用，失败后下次调用可以重试
function open() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('flowword-archive', 1);
    request.onupgradeneeded = () => { for (const name of ['videos', 'captures', 'occurrences', 'meta']) request.result.createObjectStore(name, { keyPath: 'id' }); };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = undefined; }; resolve(request.result); };
    request.onerror = () => { database = undefined; reject(new Error('学习归档暂时无法打开')); };
  });   // 新归档与旧词本分库，旧版本仍可读取原词本
  return database;
}
// safeSourceUrl 表示安全来源地址，检查 value 并返回规范化 HTTP 或 HTTPS 地址
// value 可来自备份，带凭据或危险协议返回空值，调用方需先检查结果
export function safeSourceUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2000) return;
  try { const url = new URL(value); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return; url.hash = ''; return url.href; } catch { return; }
}
// videoIdentity 表示视频身份，按 context 生成跨时间收藏共用的归档键
// context.url 必须先通过来源校验，同页多个媒体应提供稳定 videoKey
export function videoIdentity(context: ArchiveContext): string {
  const url = new URL(safeSourceUrl(context.url)!);
  if (/(^|\.)youtube\.com$/.test(url.hostname) && url.searchParams.get('v')) return `youtube:${url.searchParams.get('v')}`;
  if (url.hostname === 'youtu.be') return `youtube:${url.pathname.slice(1)}`;
  url.searchParams.delete('t'); url.searchParams.delete('start');
  return context.videoKey?.slice(0, 2000) || url.href;
}
// videoSourceLink 表示来源定位链接，根据 context.url 与 time 生成回看地址
// 来源无效返回空字符串，普通网站是否支持时间片段由网站决定
export function videoSourceLink(context: ArchiveContext): string {
  const source = safeSourceUrl(context.url); if (!source) return '';
  const url = new URL(source);
  if (/(^|\.)youtube\.com$/.test(url.hostname) || url.hostname === 'youtu.be') url.searchParams.set('t', `${Math.floor(context.time)}s`);
  else url.hash = `t=${Math.floor(context.time)}`;
  return url.href;   // 通用媒体片段定位是尽力而为，站点可能忽略时间参数
}
// complete 表示等待事务完成，把 transaction 的成功或失败转换成异步结果
// 必须在事务结束前调用，不要在同一事务上重复设置完成回调
function complete(transaction: IDBTransaction) { return new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = transaction.onabort = () => reject(new Error('学习归档写入失败')); }); }
// archiveEntry 表示归档收藏条目，把 entry 的视频、原句和语境词义关联保存
// entry 应先通过词本校验，重复调用幂等，已有语境词义保留以避免新词义覆盖
export async function archiveEntry(entry: WordbookEntry) {
  const db = await open(); const transaction = db.transaction(['videos', 'captures', 'occurrences'], 'readwrite');
  for (const raw of entry.contexts) {
    const context = raw as ArchiveContext; const url = safeSourceUrl(context.url); if (!url) continue;
    const videoId = videoIdentity({ ...context, url });
    const captureId = JSON.stringify([videoId, context.time, context.sentence]);
    transaction.objectStore('videos').put({ id: videoId, url, title: context.title?.slice(0, 300) || new URL(url).hostname, updatedAt: entry.updatedAt });
    const captureStore = transaction.objectStore('captures');
    const captureRequest = captureStore.get(captureId);
    captureRequest.onsuccess = () => captureStore.put({ ...captureRequest.result, id: captureId, videoId, videoKey: context.videoKey, sentence: context.sentence, url, time: context.time, end: context.end ?? captureRequest.result?.end, title: context.title || captureRequest.result?.title, translation: context.translation || captureRequest.result?.translation });
    const occurrenceStore = transaction.objectStore('occurrences');
    const id = JSON.stringify([entry.id, captureId]); const request = occurrenceStore.get(id);
    request.onsuccess = () => { if (!request.result) occurrenceStore.put({ id, entryId: entry.id, captureId, text: entry.text, translation: entry.translation, createdAt: entry.createdAt }); };
  }
  await complete(transaction);
}
// archiveSnapshot 表示归档快照，无参数，读取视频、捕获句和收藏关联供展示或导出
// 返回当前数据库资料，不包含模型配置和密钥，调用方仍需处理读取失败
export async function archiveSnapshot(): Promise<ArchiveSnapshot> {
  const db = await open(); const transaction = db.transaction(['videos', 'captures', 'occurrences']);
  // read 表示读取表，name 为本次只读事务已声明的表名，T 是结果条目的类型
  // 三张表在同一事务中立即发起读取，不要等待外部异步操作后再次调用
  const read = <T,>(name: string) => new Promise<T[]>((resolve, reject) => { const request = transaction.objectStore(name).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('归档读取失败')); });
  const [videos, captures, occurrences] = await Promise.all([read<ArchiveVideo>('videos'), read<ArchiveCapture>('captures'), read<ArchiveOccurrence>('occurrences')]);
  return { videos, captures, occurrences };
}
// migrateLegacyEntries 表示迁移旧词本，将 entries 的现有语境首次写入独立归档
// 所有条目迁移成功才记录完成标记，失败可重试，不修改旧库版本
export async function migrateLegacyEntries(entries: WordbookEntry[]) {
  const db = await open();
  const migrated = await new Promise<boolean>((resolve, reject) => { const request = db.transaction('meta').objectStore('meta').get('legacy-v1'); request.onsuccess = () => resolve(Boolean(request.result)); request.onerror = () => reject(new Error('迁移状态读取失败')); });
  if (migrated) return;
  for (const entry of entries) await archiveEntry(entry);
  const transaction = db.transaction('meta', 'readwrite'); transaction.objectStore('meta').put({ id: 'legacy-v1', at: Date.now() }); await complete(transaction);
}
// deleteArchivedEntry 表示删除词条归档关联，id 是规范化词本条目键
// 只删除收藏关联，保留视频和捕获句资料用于学习记录
export async function deleteArchivedEntry(id: string) {
  const db = await open(); const transaction = db.transaction('occurrences', 'readwrite'); const store = transaction.objectStore('occurrences');
  const request = store.openCursor(); request.onsuccess = () => { const cursor = request.result; if (!cursor) return; if (cursor.value.entryId === id) cursor.delete(); cursor.continue(); }; await complete(transaction);
}
// renameArchivedEntry 表示迁移改名关联，把 previousId 的全部收藏关联迁至 entry.id
// 调用前应确认新词本键无冲突，历史语境译义和收藏时间保持不变
export async function renameArchivedEntry(previousId: string, entry: WordbookEntry) {
  const db = await open(); const transaction = db.transaction('occurrences', 'readwrite'); const store = transaction.objectStore('occurrences');
  const request = store.openCursor(); request.onsuccess = () => { const cursor = request.result; if (!cursor) return; if (cursor.value.entryId === previousId) { const occurrence = cursor.value as ArchiveOccurrence; cursor.delete(); store.put({ ...occurrence, id: JSON.stringify([entry.id, occurrence.captureId]), entryId: entry.id }); } cursor.continue(); }; await complete(transaction);
}   // 改名迁移全部关联，不从旧词本的八条摘要重新构建归档
// importArchive 表示导入归档，value 是备份资料，allowedEntryIds 是已恢复词条键白名单
// 只复制受限字段，保留媒体身份与语境词义，不导入配置或密钥
export async function importArchive(value: unknown, allowedEntryIds: Set<string>) {
  const snapshot = value as Partial<ArchiveSnapshot>; if (!snapshot || !Array.isArray(snapshot.captures) || !Array.isArray(snapshot.occurrences)) return;
  const db = await open(); const transaction = db.transaction(['videos', 'captures', 'occurrences'], 'readwrite');
  const identities = new Map<string, string>();
  for (const capture of snapshot.captures.slice(0, 50000)) {
    const url = safeSourceUrl(capture?.url); if (!url || typeof capture.sentence !== 'string' || !Number.isFinite(capture.time) || capture.time < 0) continue;
    const context: ArchiveContext = { url, sentence: capture.sentence.slice(0, 2000), time: capture.time, videoKey: typeof capture.videoKey === 'string' ? capture.videoKey.slice(0, 2000) : typeof capture.videoId === 'string' ? capture.videoId.slice(0, 2000) : undefined, end: Number.isFinite(capture.end) && capture.end! >= capture.time ? capture.end : undefined, title: typeof capture.title === 'string' ? capture.title.slice(0, 300) : undefined, translation: typeof capture.translation === 'string' ? capture.translation.slice(0, 6000) : undefined };
    const videoId = videoIdentity(context); const id = JSON.stringify([videoId, context.time, context.sentence]); identities.set(capture.id, id);
    transaction.objectStore('videos').put({ id: videoId, url, title: context.title || new URL(url).hostname, updatedAt: Date.now() }); transaction.objectStore('captures').put({ ...context, id, videoId });
  }
  for (const occurrence of snapshot.occurrences.slice(0, 100000)) {
    const captureId = identities.get(occurrence.captureId); if (!captureId || !allowedEntryIds.has(occurrence.entryId) || typeof occurrence.text !== 'string') continue;
    transaction.objectStore('occurrences').put({ id: JSON.stringify([occurrence.entryId, captureId]), entryId: occurrence.entryId, captureId, text: occurrence.text.slice(0, 2000), translation: typeof occurrence.translation === 'string' ? occurrence.translation.slice(0, 6000) : '', createdAt: Number.isFinite(occurrence.createdAt) && occurrence.createdAt >= 0 && occurrence.createdAt <= Date.now() + 60000 ? occurrence.createdAt : Date.now() });
  }
  await complete(transaction);   // 只复制白名单字段，密钥和任意备份字段不会落库
}
