import type { EntryPage, EntryPatch, EntryQuery, LearningContext, ReviewGrade, ReviewState, SourceKind, WordbookEntry } from '../core/types';
import { BACKUP_LIMITS, mergeEntries, safeSourceUrl, sourceKind, validTime, validateContext, validateEntry, validatePatch } from './data-validation';

export { BACKUP_LIMITS, safeSourceUrl } from './data-validation';
export interface ArchiveContext extends LearningContext {}
export interface ArchiveSource { id: string; kind?: SourceKind; url: string; title: string; updatedAt: number; thumbnail?: string }
export type ArchiveVideo = ArchiveSource;
export interface ArchiveCapture extends ArchiveContext { id: string; sourceId?: string; videoId?: string }
export interface ArchiveOccurrence { id: string; entryId: string; captureId: string; text: string; translation: string; createdAt: number; updatedAt?: number }
export interface ArchiveSnapshot { videos: ArchiveVideo[]; sources?: ArchiveSource[]; captures: ArchiveCapture[]; occurrences: ArchiveOccurrence[] }
export interface ResolvedOccurrence extends ArchiveOccurrence { capture: ArchiveCapture }
export interface WordbookBackup { version: 4; exportedAt: string; entries: WordbookEntry[]; archive: { sources: ArchiveSource[]; captures: ArchiveCapture[]; occurrences: ArchiveOccurrence[] } }
export interface ReviewCard { entry: WordbookEntry; contexts: ResolvedOccurrence[] }
interface UndoRecord { id: string; expiresAt: number; entries: WordbookEntry[]; occurrences: ArchiveOccurrence[] }
const STORES = ['entries', 'videos', 'captures', 'occurrences', 'meta', 'undo'];
const UNDO_AGE = 24 * 60 * 60 * 1000;
let database: Promise<IDBDatabase> | undefined;
let ready: Promise<IDBDatabase> | undefined;

// requestValue 把request数据库请求转换为Promise，参数必须属于当前仍活动的事务
// 只等待IndexedDB本身，不在事务中穿插网络或计时器，防止事务提前自动提交
function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error || new Error('本地资料读取失败')); });
}

// transact 在db的stores表执行work操作，mode决定读写权限，全部请求成功后才返回结果
// work中的校验失败会回滚整个事务，禁止在work里等待外部网络或用户输入
async function transact<T>(db: IDBDatabase, stores: string[], mode: IDBTransactionMode, work: (transaction: IDBTransaction) => Promise<T>): Promise<T> {
  const transaction = db.transaction(stores, mode);
  const done = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('操作未完成，资料已回滚，请重试'));
    transaction.onerror = () => {};
  });
  void done.catch(() => {});
  try { const result = await work(transaction); await done; return result; }
  catch (error) { try { transaction.abort(); } catch { /* 已结束的事务无需再次回滚 */ } await done.catch(() => {}); throw error; }
}

// openDatabase 打开canonical归档库，无参数，升级只新增表和索引，不删除旧资料
// 旧窗口收到versionchange后关闭连接，升级被阻塞时提示先关闭旧版词本窗口
function openDatabase(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('flowword-archive', 3); let blocked = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of STORES) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      const tx = request.transaction!; const entries = tx.objectStore('entries');
      for (const field of ['updatedAt', 'text', 'kind']) if (!entries.indexNames.contains(field)) entries.createIndex(field, [field, 'id']);
      const occurrences = tx.objectStore('occurrences');
      for (const field of ['entryId', 'captureId']) if (!occurrences.indexNames.contains(field)) occurrences.createIndex(field, field);
      const captures = tx.objectStore('captures'); if (!captures.indexNames.contains('videoId')) captures.createIndex('videoId', 'videoId');
      if (!captures.indexNames.contains('sourceId')) captures.createIndex('sourceId', 'sourceId');
      const sources = tx.objectStore('videos'); if (!sources.indexNames.contains('kind')) sources.createIndex('kind', 'kind');
      // backfill 为旧表记录补充正式来源类型与索引键，store决定要更新的表，不改原ID或关联
      // 升级事务失败会整体回滚，旧videoId继续保留给兼容调用，不删除任何原数据
      const backfill = (store: IDBObjectStore) => {
        const cursor = store.openCursor(); cursor.onsuccess = () => {
          const row = cursor.result; if (!row) return;
          if (store.name === 'videos') row.update({ ...row.value, kind: row.value.kind ?? 'video' });
          else if (store.name === 'captures') row.update({ ...row.value, source: row.value.source ?? { kind: 'video' }, sourceId: row.value.sourceId ?? row.value.videoId });
          else row.update({ ...row.value, contexts: Array.isArray(row.value.contexts) ? row.value.contexts.map((context: LearningContext) => ({ ...context, source: context.source ?? { kind: 'video' } })) : row.value.contexts });
          row.continue();
        };
      };
      backfill(sources); backfill(captures); backfill(entries);
    };
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => { request.result.close(); database = undefined; ready = undefined; }; resolve(request.result);
    };
    request.onblocked = () => { blocked = true; database = undefined; reject(new Error('请关闭旧版单词本窗口后重试，原资料仍保留')); };
    request.onerror = () => { database = undefined; reject(new Error('无法打开学习资料库，原资料仍保留')); };
  });
  return database;
}

// legacyEntries 只读旧flowword-wordbook资料，无参数，不更新或删除旧库
// 新装没有旧库时创建空结构，已有旧库始终保持版本一，迁移失败可重新读取
async function legacyEntries(): Promise<WordbookEntry[]> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('flowword-wordbook', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('entries', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('旧词本读取失败，尚未迁移，请保留原资料并重试'));
  });
  try { return await transact(db, ['entries'], 'readonly', async (tx) => (await requestValue(tx.objectStore('entries').getAll())).map((entry) => validateEntry(entry, true, true))); }
  finally { db.close(); }
}

// canonicalDatabase 等待旧词本一次性迁移，无参数，迁移标记与全部词条在同一事务提交
// 旧归档完整语境保持不变，进程中断或失败后标记不落库，可安全重试
export function canonicalDatabase(): Promise<IDBDatabase> {
  ready ??= (async () => {
    const db = await openDatabase();
    const migrated = await transact(db, ['meta'], 'readonly', async (tx) => Boolean(await requestValue(tx.objectStore('meta').get('canonical-v2'))));
    if (!migrated) {
      const entries = await legacyEntries();
      await transact(db, STORES, 'readwrite', async (tx) => {
        if (await requestValue(tx.objectStore('meta').get('canonical-v2'))) return;
        for (const entry of entries) {
          if (!await requestValue(tx.objectStore('entries').get(entry.id))) tx.objectStore('entries').put(entry);
          await writeArchive(tx, entry, true);
        }
        tx.objectStore('meta').put({ id: 'canonical-v2', at: Date.now(), entries: entries.length });
      });
    }
    return db;
  })().catch((error) => { ready = undefined; throw error; });
  return ready;
}

// videoDisplayMetadata 从video已保存来源推导站点和可选封面，不发起网络请求
// thumbnail仅供用户主动点击加载，其他网站始终显示本地占位
export function videoDisplayMetadata(video: ArchiveVideo): { site: string; thumbnail?: string } {
  const source = safeSourceUrl(video.url, video.kind === 'web'); if (!source) return { site: '未知来源' };
  const url = new URL(source); const site = url.hostname.replace(/^www\./, '');
  const id = /(^|\.)youtube\.com$/.test(url.hostname) ? url.searchParams.get('v') : url.hostname === 'youtu.be' ? url.pathname.slice(1) : undefined;
  return { site, thumbnail: video.kind !== 'web' && id && /^[a-zA-Z0-9_-]{6,20}$/.test(id) ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : safeSourceUrl(video.thumbnail) };
}

// sourceIdentity 为context生成稳定来源身份，网页保留路由并与同地址的视频分开
// url须已通过来源校验，视频沿用旧键，网页不删除可能属于正文路由的hash
export function sourceIdentity(context: ArchiveContext): string {
  if (sourceKind(context) === 'web') {
    const url = safeSourceUrl(context.url, true); if (!url) throw new Error('网页来源地址无效'); return `web:${url}`;
  }
  const url = new URL(safeSourceUrl(context.url)!);
  if (/(^|\.)youtube\.com$/.test(url.hostname) && url.searchParams.get('v')) return `youtube:${url.searchParams.get('v')}`;
  if (url.hostname === 'youtu.be') return `youtube:${url.pathname.slice(1)}`;
  url.searchParams.delete('t'); url.searchParams.delete('start'); return context.videoKey?.slice(0, 2000) || url.href;
}

// videoIdentity 是sourceIdentity的兼容名称，context可为旧视频或明确标记的网页
// 新代码使用sourceIdentity，网页身份始终有web前缀，不与同URL的视频分组冲突
export function videoIdentity(context: ArchiveContext): string { return sourceIdentity(context); }

// captureIdentity 为context生成稳定捕获键，sourceId为已验证来源身份
// 视频保持旧ID，网页采用真实句子及选文定位，不创建虚构秒数
function captureIdentity(context: ArchiveContext, sourceId = sourceIdentity(context)): string {
  const quote = context.source?.quote;
  return sourceKind(context) === 'web' ? JSON.stringify([sourceId, 'web', context.sentence, quote?.exact ?? '', quote?.prefix ?? '', quote?.suffix ?? ''])
    : JSON.stringify([sourceId, context.time, context.sentence]);
}

// videoSourceLink 根据context来源与秒数生成回看链接，无效来源返回空字符串
// 普通网站采用媒体时间片段，网站可能忽略时间参数，不承诺所有站点支持定位
export function videoSourceLink(context: ArchiveContext): string {
  const web = sourceKind(context) === 'web'; const source = safeSourceUrl(context.url, web); if (!source) return '';
  if (web) return source;
  if (typeof context.time !== 'number' || !Number.isFinite(context.time) || context.time < 0) return '';
  const url = new URL(source);
  if (/(^|\.)youtube\.com$/.test(url.hostname) || url.hostname === 'youtu.be') url.searchParams.set('t', `${Math.floor(context.time)}s`);
  else url.hash = `t=${Math.floor(context.time)}`; return url.href;
}

// sourceLink 返回context真实来源链接，网页保留原地址，视频附加已有时间定位
// 本函数不请求页面或播放音视频，网页文字定位只是可选保存资料，不保证页面改版后定位成功
export function sourceLink(context: ArchiveContext): string { return videoSourceLink(context); }

// writeArchive 将entry真实语境写进tx已有事务，preserve为true时现有字幕编辑优先
// 已有occurrence保留当次词义，不能用词条当前通用义覆盖其他视频的历史语义
async function writeArchive(tx: IDBTransaction, entry: WordbookEntry, preserve = false): Promise<void> {
  for (const context of entry.contexts) {
    const kind = sourceKind(context); const url = safeSourceUrl(context.url, kind === 'web'); if (!url) continue;
    const videoId = sourceIdentity({ ...context, url }); const captureId = captureIdentity(context, videoId);
    const videos = tx.objectStore('videos'); const captures = tx.objectStore('captures'); const occurrences = tx.objectStore('occurrences');
    const [oldVideo, oldCapture, oldOccurrence] = await Promise.all([
      requestValue(videos.get(videoId)) as Promise<ArchiveVideo | undefined>, requestValue(captures.get(captureId)) as Promise<ArchiveCapture | undefined>,
      requestValue(occurrences.get(JSON.stringify([entry.id, captureId]))) as Promise<ArchiveOccurrence | undefined>,
    ]);
    if (oldVideo && (oldVideo.kind ?? 'video') !== kind) throw new Error('来源标识与已有来源类型冲突，尚未覆盖原资料');
    if (!preserve || !oldVideo) videos.put({ id: videoId, kind, url, title: context.title || oldVideo?.title || new URL(url).hostname, updatedAt: Math.max(entry.updatedAt, oldVideo?.updatedAt ?? 0), thumbnail: safeSourceUrl(context.thumbnail) || oldVideo?.thumbnail });
    if (!preserve || !oldCapture) captures.put({ ...context, id: captureId, sourceId: videoId, ...(kind === 'video' ? { videoId, end: context.end ?? oldCapture?.end } : {}), url, title: context.title || oldCapture?.title, translation: context.translation || oldCapture?.translation });
    if (!oldOccurrence) occurrences.put({ id: JSON.stringify([entry.id, captureId]), entryId: entry.id, captureId, text: entry.text, translation: entry.translation, createdAt: entry.createdAt });
  }
}

// mergeImported 合并备份incoming到current现有词条，当前编辑和复习计划优先
// 只补充缺少标签与语境并恢复更早创建时间，导入不能覆盖并发新收藏
function mergeImported(current: WordbookEntry, incoming: WordbookEntry): WordbookEntry {
  const combined = mergeEntries(incoming, current);
  return { ...combined, createdAt: Math.min(current.createdAt, incoming.createdAt), updatedAt: Math.max(current.updatedAt, incoming.updatedAt), status: current.status ?? incoming.status, review: current.review ?? incoming.review };
}

// saveCanonical 校验value并在单个事务保存词条与全部语境，replaceId表示明确编辑旧条目
// 改名冲突或任一表写入失败时全部回滚，不会出现词条成功但语境失败
export async function saveCanonical(value: unknown, replaceId?: string, restoring = false): Promise<WordbookEntry> {
  const next = validateEntry(value, restoring, restoring); const db = await canonicalDatabase();
  return transact(db, STORES, 'readwrite', async (tx) => {
    const entries = tx.objectStore('entries'); const previous = await requestValue(entries.get(replaceId || next.id)) as WordbookEntry | undefined;
    if (replaceId && !previous) throw new Error('原词条已变化或已删除，请刷新后重试');
    if (replaceId && (value as WordbookEntry).updatedAt !== previous!.updatedAt) throw new Error('词条已在其他页面更新，请刷新后重新编辑，尚未覆盖新内容');
    if (replaceId && replaceId !== next.id && await requestValue(entries.get(next.id))) throw new Error('改名后的词条已存在，尚未修改任何资料');
    const saved = replaceId ? { ...next, createdAt: previous!.createdAt, status: next.status ?? previous!.status, review: next.review ?? previous!.review }
      : restoring && previous ? mergeImported(previous, next) : mergeEntries(previous, next);
    if (!restoring) saved.updatedAt = Math.max(next.updatedAt, (previous?.updatedAt ?? 0) + 1);
    if (replaceId && replaceId !== next.id) {
      const occurrences = tx.objectStore('occurrences');
      for (const occurrence of await requestValue(occurrences.index('entryId').getAll(replaceId)) as ArchiveOccurrence[]) {
        occurrences.delete(occurrence.id); occurrences.put({ ...occurrence, id: JSON.stringify([next.id, occurrence.captureId]), entryId: next.id });
      }
      entries.delete(replaceId);
    }
    entries.put(saved); await writeArchive(tx, { ...next, id: saved.id, createdAt: saved.createdAt, updatedAt: saved.updatedAt }, restoring); return saved;
  });
}

// archiveEntry 保留旧归档入口，entry为完整词本条目，内部已改为canonical原子保存
// 新代码使用wordbook的saveEntry，不能再写旧词本库后重复调用本函数
export async function archiveEntry(entry: WordbookEntry): Promise<void> { await saveCanonical(entry); }

// archiveSnapshot 读取同一事务的视频、字幕和词义快照，不含配置或密钥
// 大列表界面应使用分页查询，完整快照仅用于兼容旧版和受限备份
export async function archiveSnapshot(): Promise<ArchiveSnapshot> {
  const db = await canonicalDatabase();
  return transact(db, ['videos', 'captures', 'occurrences'], 'readonly', async (tx) => {
    const [videos, captures, occurrences] = await Promise.all(['videos', 'captures', 'occurrences'].map((name) => requestValue(tx.objectStore(name).getAll())));
    const sources = videos as ArchiveSource[];
    return { sources, videos: sources.filter((source) => source.kind !== 'web'), captures: captures as ArchiveCapture[], occurrences: occurrences as ArchiveOccurrence[] };
  });
}

// migrateLegacyEntries 保留兼容入口，entries是旧调用方传入的只读快照
// 迁移已自行读取原库并原子提交，避免旧窗口重复重建被删除的收藏
export async function migrateLegacyEntries(_entries: WordbookEntry[]): Promise<void> { await canonicalDatabase(); }

// allCanonicalEntries 读取完整词本并按最近更新排序，无参数，不做跨库写入
// Quick界面使用queryEntries分页，完整读取只为兼容旧RPC保留
export async function allCanonicalEntries(): Promise<WordbookEntry[]> {
  const db = await canonicalDatabase();
  return transact(db, ['entries'], 'readonly', async (tx) => (await requestValue(tx.objectStore('entries').getAll()) as WordbookEntry[]).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)));
}

// savedEntryIds 查询ids中已存在的canonical收藏键，返回顺序与输入去重后相同
// 每次最多一百项且允许空列表，只读取键供悬浮球显示已加入，不加载完整收藏
export async function savedEntryIds(ids: string[]): Promise<string[]> {
  if (!Array.isArray(ids) || ids.length > 100 || ids.some((id) => typeof id !== 'string' || !id || id.length > 2100)) throw new Error('收藏状态查询最多100项有效标识');
  const keys = [...new Set(ids)]; const db = await canonicalDatabase();
  return transact(db, ['entries'], 'readonly', async (tx) => {
    const present = await Promise.all(keys.map((id) => requestValue(tx.objectStore('entries').getKey(id))));
    return keys.filter((_id, index) => present[index] !== undefined);
  });
}

// resolvedRows 在tx读取entryId词条的完整语境，videoId可限定一个视频
// 使用真实capture关联，缺失关联不伪造字幕，事务必须声明两张表
async function resolvedRows(tx: IDBTransaction, entryId: string, videoId?: string): Promise<ResolvedOccurrence[]> {
  const occurrences = await requestValue(tx.objectStore('occurrences').index('entryId').getAll(entryId)) as ArchiveOccurrence[]; const rows: ResolvedOccurrence[] = [];
  await Promise.all(occurrences.map(async (occurrence) => {
    const capture = await requestValue(tx.objectStore('captures').get(occurrence.captureId)) as ArchiveCapture | undefined;
    if (capture && (!videoId || (capture.sourceId ?? capture.videoId) === videoId)) rows.push({ ...occurrence, capture });
  }));
  return rows.sort((a, b) => sourceKind(a.capture) === 'video' && sourceKind(b.capture) === 'video' ? a.capture.time! - b.capture.time! || a.createdAt - b.createdAt || a.id.localeCompare(b.id)
    : a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

// entryOccurrences 查询entryId词条全部真实语境，videoId可限制一个学习视频
// 摘要只有八条也不会丢失历史，capture包含来源定位和该句译文
export async function entryOccurrences(entryId: string, videoId?: string): Promise<ResolvedOccurrence[]> {
  if (typeof entryId !== 'string') throw new Error('词条标识无效'); const db = await canonicalDatabase();
  return transact(db, ['occurrences', 'captures'], 'readonly', (tx) => resolvedRows(tx, entryId, videoId));
}

// videoEntryTimes 从tx读取videoId视频的条目及最早时间，用于视频筛选和时间排序
// 只读取该视频捕获句索引，不加载其他视频的全部语境
async function videoEntryTimes(tx: IDBTransaction, videoId: string): Promise<Map<string, number>> {
  const captures = await requestValue(tx.objectStore('captures').index('sourceId').getAll(videoId)) as ArchiveCapture[]; const times = new Map<string, number>();
  await Promise.all(captures.map(async (capture) => {
    const occurrences = await requestValue(tx.objectStore('occurrences').index('captureId').getAll(capture.id)) as ArchiveOccurrence[];
    for (const occurrence of occurrences) times.set(occurrence.entryId, Math.min(times.get(occurrence.entryId) ?? Infinity, capture.time ?? Infinity));
  })); return times;
}

// queryEntries 按query搜索分类并返回有界页面，offset从零开始，limit默认二十且最多一百
// 最近收藏按索引游标扫描并仅保留请求页，total为筛选后总数，不截断搜索范围
export async function queryEntries(query: EntryQuery = {}): Promise<EntryPage> {
  if (!query || typeof query !== 'object' || Array.isArray(query)) throw new Error('查询条件无效');
  const offset = query.offset ?? 0; const limit = query.limit ?? 20;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('分页范围无效，每页最多100条');
  if (query.search !== undefined && (typeof query.search !== 'string' || query.search.length > 2000)) throw new Error('搜索内容无效');
  if (query.sort && !['recent', 'alphabet', 'kind', 'time'].includes(query.sort)) throw new Error('排序方式无效');
  if (query.sourceKind !== undefined && !['video', 'web'].includes(query.sourceKind)) throw new Error('来源类型筛选无效');
  if ((query.sourceId !== undefined && typeof query.sourceId !== 'string') || (query.videoId !== undefined && typeof query.videoId !== 'string') || (query.sourceId && query.videoId && query.sourceId !== query.videoId)) throw new Error('来源筛选标识无效或冲突');
  const selectedSource = query.sourceId || query.videoId;
  const db = await canonicalDatabase();
  return transact(db, ['entries', 'videos', 'captures', 'occurrences'], 'readonly', async (tx) => {
    const times = selectedSource ? await videoEntryTimes(tx, selectedSource) : undefined; const search = query.search?.normalize('NFKC').trim().toLocaleLowerCase() ?? '';
    const terms = search.split(/\s+/).filter(Boolean);
    const titles = new Map<string, string[]>();
    const allowedSources = query.sourceKind ? new Set<string>() : undefined;
    if (terms.length || allowedSources) {
      const videos = await requestValue(tx.objectStore('videos').getAll()) as ArchiveVideo[];
      // 标题按完整归档关联词条，不依赖最近八条语境摘要，旧视频也能检索
      for (const video of videos) {
        if ((selectedSource && video.id !== selectedSource) || (query.sourceKind && (video.kind ?? 'video') !== query.sourceKind)) continue;
        for (const id of (await videoEntryTimes(tx, video.id)).keys()) { if (terms.length) titles.set(id, [...(titles.get(id) ?? []), video.title]); allowedSources?.add(id); }
      }
    }
    const entries: WordbookEntry[] = []; const timed: WordbookEntry[] = []; let total = 0;
    const source = tx.objectStore('entries').index(query.sort === 'alphabet' ? 'text' : query.sort === 'kind' ? 'kind' : 'updatedAt');
    await new Promise<void>((resolve, reject) => {
      const request = source.openCursor(undefined, !query.sort || query.sort === 'recent' || query.sort === 'time' ? 'prev' : 'next');
      request.onerror = () => reject(new Error('词本分页读取失败'));
      request.onsuccess = () => {
        const cursor = request.result; if (!cursor) { resolve(); return; } const entry = cursor.value as WordbookEntry;
        const matches = (!times || times.has(entry.id)) && (!allowedSources || allowedSources.has(entry.id)) && (!query.kind || entry.kind === query.kind) && (!query.part || entry.partOfSpeech === query.part) &&
          (!query.exam || entry.examTags.includes(query.exam)) && (!query.tag || entry.tags.includes(query.tag)) && (!query.status || (entry.status ?? 'new') === query.status) &&
          (!terms.length || terms.every((term) => [entry.text, entry.lemma, entry.translation, entry.partOfSpeech, ...entry.examTags, ...entry.tags, ...(titles.get(entry.id) ?? [])].filter(Boolean).join(' ').normalize('NFKC').toLocaleLowerCase().includes(term)));
        if (matches) { if (times && query.sort === 'time') timed.push(entry); else if (total >= offset && entries.length < limit) entries.push(entry); total++; }
        cursor.continue();
      };
    });
    if (times && query.sort === 'time') entries.push(...timed.sort((a, b) => times.get(a.id)! - times.get(b.id)! || a.id.localeCompare(b.id)).slice(offset, offset + limit));
    if (selectedSource || query.sourceKind) await Promise.all(entries.map(async (entry, index) => {
      const rows = (await resolvedRows(tx, entry.id, selectedSource)).filter((row) => !query.sourceKind || sourceKind(row.capture) === query.sourceKind);
      entries[index] = { ...entry, contexts: rows.slice(0, 8).map((row) => {
        const { id: _id, sourceId: _sourceId, videoId: _videoId, ...context } = row.capture;
        return context;
      }) };
    }));
    return { entries, total, offset, limit };
  });
}

// bookSummary 读取视频计数和全局分类选项，无参数，不把完整词条与原句发给界面
// 仅收藏关联计入视频count，保留的历史视频没有收藏时仍可显示零计数
export async function bookSummary(): Promise<{ sources: (ArchiveSource & { count: number })[]; videos: (ArchiveVideo & { count: number })[]; total: number; parts: string[]; tags: string[]; exams: string[]; counts: Record<WordbookEntry['kind'], number> }> {
  const db = await canonicalDatabase();
  return transact(db, ['entries', 'videos', 'captures', 'occurrences'], 'readonly', async (tx) => {
    const parts = new Set<string>(); const tags = new Set<string>(); const exams = new Set<string>(); const counts = { word: 0, phrase: 0, sentence: 0 }; let total = 0;
    await new Promise<void>((resolve, reject) => {
      const request = tx.objectStore('entries').openCursor(); request.onerror = () => reject(new Error('分类读取失败'));
      request.onsuccess = () => { const cursor = request.result; if (!cursor) { resolve(); return; } const entry = cursor.value as WordbookEntry;
        parts.add(entry.partOfSpeech); entry.tags.forEach((tag) => tags.add(tag)); entry.examTags.forEach((tag) => exams.add(tag)); counts[entry.kind]++; total++; cursor.continue(); };
    });
    const videos = await requestValue(tx.objectStore('videos').getAll()) as ArchiveVideo[];
    const summaries = await Promise.all(videos.map(async (video) => ({ ...video, count: (await videoEntryTimes(tx, video.id)).size })));
    const sources = summaries.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    return { sources, videos: sources.filter((source) => source.kind !== 'web'), total, parts: [...parts].sort(), tags: [...tags].sort(), exams: [...exams].sort(), counts };
  });
}

// videoSummaries 返回视频摘要与关联词条数，无参数，避免界面读取全部原句
// 同时需要全局筛选选项时使用bookSummary，避免重复扫描
export async function videoSummaries(): Promise<(ArchiveVideo & { count: number })[]> { return (await bookSummary()).videos; }

// updateOccurrence 仅修改id某次收藏的translation语境义，不修改其他视频词义
// 新译文必须非空且不超过六千字符，关联消失时整次操作拒绝
export async function updateOccurrence(id: string, translation: string): Promise<ArchiveOccurrence> {
  if (typeof id !== 'string' || typeof translation !== 'string' || !translation.trim() || translation.length > 6000) throw new Error('语境释义无效'); const db = await canonicalDatabase();
  return transact(db, ['entries', 'occurrences'], 'readwrite', async (tx) => {
    const store = tx.objectStore('occurrences'); const previous = await requestValue(store.get(id)) as ArchiveOccurrence | undefined;
    if (!previous || !await requestValue(tx.objectStore('entries').get(previous.entryId))) throw new Error('该次收藏已删除，请刷新后重试');
    const occurrence = { ...previous, translation: translation.trim(), updatedAt: Date.now() }; store.put(occurrence); return occurrence;
  });
}

// checkedIds 校验ids批量词条标识并去重，禁止空列表与超千条的一次修改
// 必须在创建写事务前调用，非法项不会变成部分成功
function checkedIds(ids: unknown): string[] {
  if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || ids.some((id) => typeof id !== 'string' || !id || id.length > 2100)) throw new Error('批量操作需选择1至1000条有效词条'); return [...new Set(ids)];
}

// batchEntries 原子修改ids词条的patch分类和学习状态，所有目标必须仍存在
// 批量标签按用户选择替换以允许移除，任一目标已删除时整批不修改
export async function batchEntries(ids: string[], patch: EntryPatch): Promise<{ updated: number }> {
  const keys = checkedIds(ids); const changes = validatePatch(patch); const db = await canonicalDatabase();
  return transact(db, ['entries'], 'readwrite', async (tx) => {
    const store = tx.objectStore('entries'); const entries = await Promise.all(keys.map((id) => requestValue(store.get(id)))) as (WordbookEntry | undefined)[];
    if (entries.some((entry) => !entry)) throw new Error('部分词条已变化，整批尚未修改，请刷新后重试');
    for (const entry of entries as WordbookEntry[]) store.put({ ...entry, ...changes, updatedAt: Math.max(Date.now(), entry.updatedAt + 1) }); return { updated: entries.length };
  });
}

// deleteEntries 原子删除ids词条与收藏关联，返回二十四小时内可用的undoToken
// 视频和字幕记录保留，撤销日志与删除属于同一事务，任一失败全部回滚
export async function deleteEntries(ids: string[]): Promise<{ undoToken: string; deleted: number }> {
  const keys = checkedIds(ids); const db = await canonicalDatabase();
  return transact(db, ['entries', 'occurrences', 'undo'], 'readwrite', async (tx) => {
    const entries = await Promise.all(keys.map((id) => requestValue(tx.objectStore('entries').get(id)))) as (WordbookEntry | undefined)[];
    if (entries.some((entry) => !entry)) throw new Error('部分词条已删除，整批尚未操作，请刷新后重试');
    const occurrences = (await Promise.all(keys.map((id) => requestValue(tx.objectStore('occurrences').index('entryId').getAll(id))))).flat() as ArchiveOccurrence[];
    const undoToken = crypto.randomUUID();
    tx.objectStore('undo').put({ id: undoToken, expiresAt: Date.now() + UNDO_AGE, entries: entries as WordbookEntry[], occurrences } satisfies UndoRecord);
    keys.forEach((id) => tx.objectStore('entries').delete(id)); occurrences.forEach((item) => tx.objectStore('occurrences').delete(item.id));
    const cleanup = tx.objectStore('undo').openCursor(); cleanup.onsuccess = () => { const cursor = cleanup.result; if (!cursor) return; if (cursor.value.expiresAt < Date.now()) cursor.delete(); cursor.continue(); };
    return { undoToken, deleted: entries.length };
  });
}

// undoDelete 按token恢复一次删除的完整词条和各次词义，成功后令token失效
// 用户已重新收藏同键时拒绝覆盖并保留撤销记录，避免撤销覆盖新数据
export async function undoDelete(token: string): Promise<{ restored: number }> {
  if (typeof token !== 'string' || token.length > 100) throw new Error('撤销标识无效'); const db = await canonicalDatabase();
  return transact(db, ['entries', 'occurrences', 'undo'], 'readwrite', async (tx) => {
    const record = await requestValue(tx.objectStore('undo').get(token)) as UndoRecord | undefined;
    if (!record || record.expiresAt < Date.now()) throw new Error('撤销记录已过期或已经使用');
    const present = await Promise.all(record.entries.map((entry) => requestValue(tx.objectStore('entries').get(entry.id))));
    if (present.some(Boolean)) throw new Error('词条已重新加入，撤销不会覆盖新收藏，请先处理同名词条');
    record.entries.forEach((entry) => tx.objectStore('entries').put(entry)); record.occurrences.forEach((item) => tx.objectStore('occurrences').put(item));
    tx.objectStore('undo').delete(token); return { restored: record.entries.length };
  });
}

// deleteArchivedEntry 保留旧删除入口，id为现存词条键，已统一删除词条与关联
// 调用方需要撤销时使用deleteEntries并保留返回token
export async function deleteArchivedEntry(id: string): Promise<void> { await deleteEntries([id]); }

// renameArchivedEntry 保留旧改名入口，previousId旧键和entry新词条一起原子提交
// 不能先更新其他数据库再调用，键冲突时不会删除旧词条
export async function renameArchivedEntry(previousId: string, entry: WordbookEntry): Promise<void> { await saveCanonical(entry, previousId); }

// assertBackupSize 检查backup数量与UTF8文件大小，导出导入共用一组上限
// 超限直接报错并提示按视频拆分，禁止用slice静默丢弃备份资料
function assertBackupSize(backup: WordbookBackup): void {
  if (backup.entries.length > BACKUP_LIMITS.entries || backup.archive.sources.length > BACKUP_LIMITS.videos || backup.archive.captures.length > BACKUP_LIMITS.captures || backup.archive.occurrences.length > BACKUP_LIMITS.occurrences || new TextEncoder().encode(JSON.stringify(backup, null, 2)).byteLength > BACKUP_LIMITS.bytes) throw new Error('备份超过统一上限，请按来源分别导出');
}

// validateBackup 在任何写入前校验value整份备份，一至三版按视频兼容，四版明确区分来源
// 拒绝null、超限数组与断开的关联，不静默截断，返回纯数据白名单
export function validateBackup(value: unknown): WordbookBackup {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('备份格式无效');
  const backup = value as { version?: unknown; entries?: unknown; archive?: unknown; exportedAt?: unknown };
  if (![1, 2, 3, 4].includes(backup.version as number) || !Array.isArray(backup.entries) || backup.entries.length > BACKUP_LIMITS.entries) throw new Error('备份版本或条目数量无效');
  const entries = backup.entries.map((entry) => validateEntry(entry, true, true)); if (new Set(entries.map((entry) => entry.id)).size !== entries.length) throw new Error('备份包含重复词条标识');
  if (backup.version !== 4 && entries.some((entry) => entry.contexts.some((context) => sourceKind(context) === 'web'))) throw new Error('网页来源需要版本四备份，旧备份不能混入网页资料');
  const ids = new Set(entries.map((entry) => entry.id)); const oldIds = new Map<string, string>();
  backup.entries.forEach((raw, index) => { if (raw && typeof raw.id === 'string') oldIds.set(raw.id, entries[index]!.id); });
  const archive: WordbookBackup['archive'] = { sources: [], captures: [], occurrences: [] };
  if (backup.archive === undefined && backup.version !== 1) throw new Error('备份缺少完整归档');
  if (backup.archive !== undefined) {
    if (!backup.archive || typeof backup.archive !== 'object') throw new Error('备份归档无效'); const raw = backup.archive as ArchiveSnapshot;
    const sourceRows = backup.version === 4 ? raw.sources : raw.videos;
    if (!Array.isArray(sourceRows) || !Array.isArray(raw.captures) || !Array.isArray(raw.occurrences) || sourceRows.length > BACKUP_LIMITS.videos || raw.captures.length > BACKUP_LIMITS.captures || raw.occurrences.length > BACKUP_LIMITS.occurrences) throw new Error('归档数量无效或超过备份上限');
    const captureIds = new Map<string, string>(); const sourceKinds = new Map<string, SourceKind>();
    for (const source of sourceRows) {
      const kind = backup.version === 4 ? source?.kind : 'video';
      if (!source || !['video', 'web'].includes(kind ?? '') || typeof source.id !== 'string' || !source.id || source.id.length > 2100 || !safeSourceUrl(source.url, kind === 'web') || typeof source.title !== 'string' || source.title.length > 300 || !validTime(source.updatedAt) || sourceKinds.has(source.id) || (source.thumbnail !== undefined && !safeSourceUrl(source.thumbnail))) throw new Error('备份来源资料无效或重复');
      sourceKinds.set(source.id, kind!); archive.sources.push({ id: source.id, kind, url: safeSourceUrl(source.url, kind === 'web')!, title: source.title, updatedAt: source.updatedAt, ...(source.thumbnail ? { thumbnail: safeSourceUrl(source.thumbnail) } : {}) });
      if (kind === 'web' && source.id !== `web:${safeSourceUrl(source.url, true)}`) throw new Error('网页来源身份与链接不一致');
    }
    const canonicalIds = new Set<string>();
    for (const capture of raw.captures) {
      if (!capture || typeof capture.id !== 'string' || !capture.id) throw new Error('备份捕获关联无效');
      const rawSourceId = backup.version === 4 ? capture.sourceId : capture.videoId;
      if (typeof rawSourceId !== 'string' || !sourceKinds.has(rawSourceId)) throw new Error('备份捕获来源关联无效');
      const kind = sourceKinds.get(rawSourceId)!;
      if (sourceKind(capture) !== kind || (kind === 'web' && capture.videoId !== undefined) || (capture.videoId !== undefined && capture.videoId !== rawSourceId)) throw new Error('来源类型和捕获关联不一致');
      const context = validateContext({ ...capture, ...(kind === 'video' ? { videoKey: capture.videoKey ?? rawSourceId } : {}) }, true)!;
      const sourceId = sourceIdentity(context); const id = captureIdentity(context, sourceId);
      if (backup.version === 4 && sourceId !== rawSourceId) throw new Error('来源身份与原文定位不一致');
      if (captureIds.has(capture.id) || canonicalIds.has(id)) throw new Error('备份包含重复捕获身份'); captureIds.set(capture.id, id); canonicalIds.add(id);
      archive.captures.push({ ...context, id, sourceId, ...(kind === 'video' ? { videoId: sourceId } : {}) });
    }
    const occurrenceIds = new Set<string>();
    for (const occurrence of raw.occurrences) {
      if (!occurrence || typeof occurrence.entryId !== 'string' || typeof occurrence.captureId !== 'string' || typeof occurrence.text !== 'string' || !occurrence.text.trim() || occurrence.text.length > 2000 || typeof occurrence.translation !== 'string' || occurrence.translation.length > 6000 || !validTime(occurrence.createdAt) || (occurrence.updatedAt !== undefined && !validTime(occurrence.updatedAt))) throw new Error('备份语境释义无效');
      const entryId = oldIds.get(occurrence.entryId) ?? occurrence.entryId; const captureId = captureIds.get(occurrence.captureId);
      if (!ids.has(entryId) || !captureId) throw new Error('备份语境存在断开的词条或字幕关联'); const id = JSON.stringify([entryId, captureId]);
      if (occurrenceIds.has(id)) throw new Error('备份包含重复收藏关联'); occurrenceIds.add(id);
      archive.occurrences.push({ id, entryId, captureId, text: occurrence.text, translation: occurrence.translation, createdAt: occurrence.createdAt, ...(occurrence.updatedAt !== undefined ? { updatedAt: occurrence.updatedAt } : {}) });
    }
    const sources = new Map(archive.sources.map((source) => [source.id, source]));
    for (const capture of archive.captures) if (!sources.has(capture.sourceId!)) sources.set(capture.sourceId!, { id: capture.sourceId!, kind: sourceKind(capture), url: capture.url, title: capture.title || new URL(capture.url).hostname, updatedAt: Date.now(), thumbnail: capture.thumbnail }); archive.sources = [...sources.values()];
  }
  const result: WordbookBackup = { version: 4, exportedAt: typeof backup.exportedAt === 'string' ? backup.exportedAt : new Date().toISOString(), entries, archive }; assertBackupSize(result); return result;
}

// exportBackup 在同一只读事务导出query指定视频或完整词本，含完整语境与复习计划
// 不含配置和密钥，先检查统一上限，生成备份可由importBackup原样恢复
export async function exportBackup(query: { videoId?: string; sourceId?: string; sourceKind?: SourceKind } = {}): Promise<WordbookBackup> {
  if (!query || typeof query !== 'object' || (query.videoId !== undefined && typeof query.videoId !== 'string') || (query.sourceId !== undefined && typeof query.sourceId !== 'string') || (query.sourceKind !== undefined && !['video', 'web'].includes(query.sourceKind)) || (query.videoId && query.sourceId && query.videoId !== query.sourceId)) throw new Error('导出范围无效');
  const selectedSource = query.sourceId || query.videoId; const scoped = !!selectedSource || !!query.sourceKind; const db = await canonicalDatabase();
  return transact(db, ['entries', 'videos', 'captures', 'occurrences'], 'readonly', async (tx) => {
    const [allEntries, allVideos, allCaptures, allOccurrences] = await Promise.all(['entries', 'videos', 'captures', 'occurrences'].map((name) => requestValue(tx.objectStore(name).getAll())));
    const sources = (allVideos as ArchiveSource[]).filter((source) => (!selectedSource || source.id === selectedSource) && (!query.sourceKind || (source.kind ?? 'video') === query.sourceKind)); const sourceIds = new Set(sources.map((source) => source.id));
    const captures = (allCaptures as ArchiveCapture[]).filter((capture) => sourceIds.has((capture.sourceId ?? capture.videoId)!)); const captureIds = new Set(captures.map((capture) => capture.id));
    const occurrences = (allOccurrences as ArchiveOccurrence[]).filter((occurrence) => captureIds.has(occurrence.captureId)); const entryIds = new Set(occurrences.map((occurrence) => occurrence.entryId));
    const entries = (allEntries as WordbookEntry[]).filter((entry) => !scoped || entryIds.has(entry.id)).map((entry) => scoped ? { ...entry, contexts: entry.contexts.filter((context) => sourceIds.has(sourceIdentity(context))) } : entry);
    const backup: WordbookBackup = { version: 4, exportedAt: new Date().toISOString(), entries, archive: { sources, captures, occurrences } };
    validateBackup(backup); return backup;
  });
}

// importBackup 完整预校验value后在一个事务追加恢复词条和归档，任何错误全部回滚
// 与收藏事务串行，现有词义和复习计划优先，新增语境按身份幂等合并
export async function importBackup(value: unknown): Promise<{ imported: number }> {
  const backup = validateBackup(value); const db = await canonicalDatabase();
  return transact(db, STORES, 'readwrite', async (tx) => {
    for (const incoming of backup.entries) {
      const current = await requestValue(tx.objectStore('entries').get(incoming.id)) as WordbookEntry | undefined; tx.objectStore('entries').put(current ? mergeImported(current, incoming) : incoming);
    }
    for (const source of backup.archive.sources) if (!await requestValue(tx.objectStore('videos').get(source.id))) tx.objectStore('videos').put(source);
    for (const capture of backup.archive.captures) if (!await requestValue(tx.objectStore('captures').get(capture.id))) tx.objectStore('captures').put(capture);
    for (const occurrence of backup.archive.occurrences) if (!await requestValue(tx.objectStore('occurrences').get(occurrence.id))) tx.objectStore('occurrences').put(occurrence);
    for (const incoming of backup.entries) await writeArchive(tx, incoming, true);
    return { imported: backup.entries.length };
  });
}

// importArchive 保留旧归档导入入口，value需完整预校验，allowedEntryIds限定已存在词条
// 新界面必须用importBackup保证整份词本与归档原子提交，本入口不做部分容错
export async function importArchive(value: unknown, allowedEntryIds: Set<string>): Promise<void> {
  if (value === undefined) return; const entries = (await allCanonicalEntries()).filter((entry) => allowedEntryIds.has(entry.id)); await importBackup({ version: (value as ArchiveSnapshot)?.sources ? 4 : 3, entries, archive: value });
}

// reviewDue 返回query范围内到期学习卡，limit默认二十且最多一百，不向界面发送整库原句
// 未复习词条视为到期，mastered默认不进入待复习，本地间隔规则不代表记忆概率
export async function reviewDue(query: { limit?: number; videoId?: string; sourceId?: string; sourceKind?: SourceKind } = {}): Promise<ReviewCard[]> {
  const limit = query.limit ?? 20; if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (query.sourceKind !== undefined && !['video', 'web'].includes(query.sourceKind))) throw new Error('复习范围或数量无效');
  const selectedSource = query.sourceId || query.videoId; const db = await canonicalDatabase();
  return transact(db, ['entries', 'videos', 'captures', 'occurrences'], 'readonly', async (tx) => {
    let times = selectedSource ? await videoEntryTimes(tx, selectedSource) : undefined;
    if (query.sourceKind) {
      const allowed = new Map<string, number>();
      const sources = await requestValue(tx.objectStore('videos').index('kind').getAll(query.sourceKind)) as ArchiveSource[];
      for (const source of sources) if (!selectedSource || source.id === selectedSource) for (const [id, time] of await videoEntryTimes(tx, source.id)) allowed.set(id, time);
      times = allowed;
    }
    const due = (await requestValue(tx.objectStore('entries').getAll()) as WordbookEntry[]).filter((entry) => entry.status !== 'mastered' && (!entry.review || entry.review.dueAt <= Date.now()) && (!times || times.has(entry.id)))
      .sort((a, b) => (a.review?.dueAt ?? 0) - (b.review?.dueAt ?? 0) || a.createdAt - b.createdAt || a.id.localeCompare(b.id)).slice(0, limit);
    return Promise.all(due.map(async (entry) => ({ entry, contexts: (await resolvedRows(tx, entry.id, selectedSource)).filter((row) => !query.sourceKind || sourceKind(row.capture) === query.sourceKind) })));
  });
}

// gradeReview 根据entryId与grade自评更新复习日期，连续记住按一三七十四三十天延长
// forgot和uncertain次日重看，mastered只由用户手动设置，本地规则不代表记忆概率
export async function gradeReview(entryId: string, grade: ReviewGrade): Promise<ReviewState> {
  if (typeof entryId !== 'string' || !['forgot', 'uncertain', 'remember'].includes(grade)) throw new Error('复习评分无效'); const db = await canonicalDatabase();
  return transact(db, ['entries'], 'readwrite', async (tx) => {
    const entry = await requestValue(tx.objectStore('entries').get(entryId)) as WordbookEntry | undefined; if (!entry) throw new Error('词条已删除'); const previous = entry.review;
    const repetitions = grade === 'remember' ? (previous?.repetitions ?? 0) + 1 : 0;
    const intervalDays = grade === 'remember' ? [1, 3, 7, 14, 30][Math.min(repetitions - 1, 4)]! : 1;
    const now = Date.now(); const review: ReviewState = { dueAt: now + intervalDays * 86400000, lastReviewedAt: now, intervalDays, repetitions, lapses: (previous?.lapses ?? 0) + (grade === 'forgot' ? 1 : 0), lastGrade: grade };
    tx.objectStore('entries').put({ ...entry, status: entry.status === 'mastered' ? 'mastered' : 'learning', review, updatedAt: Math.max(now, entry.updatedAt + 1) }); return review;
  });
}
