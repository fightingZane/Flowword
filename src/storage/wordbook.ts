import type { WordbookEntry } from '../core/types';
import { archiveEntry, deleteArchivedEntry, migrateLegacyEntries, renameArchivedEntry, safeSourceUrl } from './archive';

let database: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('flowword-wordbook', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('entries', { keyPath: 'id' });
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = undefined; }; resolve(request.result); };
    request.onerror = () => { database = undefined; reject(new Error('无法打开本地单词本')); };
  });   // 只在扩展后台和扩展页面调用，数据库属于扩展来源，不属于 YouTube
  return database;
}

export function validateEntry(value: unknown): WordbookEntry {
  const entry = value as Partial<WordbookEntry>;
  if (!entry || !['word', 'phrase', 'sentence'].includes(entry.kind ?? '') || typeof entry.text !== 'string' || !entry.text.trim() || entry.text.length > 2000) throw new Error('单词本条目无效');
  const strings = (values: unknown) => Array.isArray(values) ? [...new Set(values.filter((value): value is string => typeof value === 'string').map((value) => value.trim().slice(0, 50)).filter(Boolean))].slice(0, 20) : [];
  const canonical = typeof entry.lemma === 'string' && entry.lemma.trim() ? entry.lemma.trim().slice(0, 2000) : entry.text;
  const now = Date.now();
  return { id: `${entry.kind}:${canonical.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()}`,
    kind: entry.kind!, text: entry.text.trim(), lemma: canonical, translation: typeof entry.translation === 'string' ? entry.translation.slice(0, 6000) : '',
    partOfSpeech: typeof entry.partOfSpeech === 'string' ? entry.partOfSpeech.slice(0, 40) : '未分类',
    examTags: strings(entry.examTags), tags: strings(entry.tags), createdAt: now, updatedAt: now,
    contexts: Array.isArray(entry.contexts) ? entry.contexts.filter((context) => typeof context?.sentence === 'string' && safeSourceUrl(context.url) && Number.isFinite(context.time))
      .slice(0, 8).map((context) => { const source = context as typeof context & { title?: string; videoKey?: string; end?: number; translation?: string }; return { sentence: context.sentence.slice(0, 2000), url: safeSourceUrl(context.url)!, time: Math.max(0, context.time), title: typeof source.title === 'string' ? source.title.slice(0, 300) : undefined, videoKey: typeof source.videoKey === 'string' ? source.videoKey.slice(0, 2000) : undefined, end: Number.isFinite(source.end) ? source.end : undefined, translation: typeof source.translation === 'string' ? source.translation.slice(0, 6000) : undefined }; }) : [],
  };
}

export function mergeEntries(previous: WordbookEntry | undefined, next: WordbookEntry): WordbookEntry {
  if (!previous) return next;
  const contexts = [...previous.contexts, ...next.contexts].filter((context, index, values) => values.findIndex((value) => value.url === context.url && value.videoKey === context.videoKey && value.time === context.time && value.sentence === context.sentence) === index).slice(-8);
  return { ...next, createdAt: previous.createdAt, translation: next.translation || previous.translation,
    partOfSpeech: next.partOfSpeech === '未分类' || next.partOfSpeech === 'unclassified' ? previous.partOfSpeech : next.partOfSpeech,
    examTags: [...new Set([...previous.examTags, ...next.examTags])], tags: [...new Set([...previous.tags, ...next.tags])], contexts };
}

export async function saveEntry(value: unknown, replaceId?: string): Promise<WordbookEntry> {
  const entry = validateEntry(value);
  const db = await open();
  const saved = await new Promise<WordbookEntry>((resolve, reject) => {
    const transaction = db.transaction('entries', 'readwrite');
    const store = transaction.objectStore('entries');
    const request = store.get(replaceId || entry.id);
    let saved = entry;
    request.onsuccess = () => {
      saved = replaceId ? { ...entry, createdAt: request.result?.createdAt ?? entry.createdAt } : mergeEntries(request.result, entry);
      if (replaceId && replaceId !== entry.id) {
        const collision = store.get(entry.id);
        collision.onsuccess = () => {
          if (collision.result) { transaction.abort(); return; }
          store.delete(replaceId); store.put(saved);
        };
      } else store.put(saved);
    };   // 编辑分类替换用户选择，重复收藏才合并标签，改名与旧条目删除同属一个事务
    transaction.oncomplete = () => resolve(saved);
    transaction.onerror = transaction.onabort = () => reject(new Error('没有保存成功，请重试'));
  });
  if (replaceId && replaceId !== saved.id) await renameArchivedEntry(replaceId, saved);
  await archiveEntry(saved);
  return saved;
}

export async function allEntries(): Promise<WordbookEntry[]> {
  const db = await open();
  const entries = await new Promise<WordbookEntry[]>((resolve, reject) => {
    const request = db.transaction('entries').objectStore('entries').getAll();
    request.onsuccess = () => resolve(request.result.sort((a: WordbookEntry, b: WordbookEntry) => b.updatedAt - a.updatedAt));
    request.onerror = () => reject(new Error('无法读取单词本'));
  });
  await migrateLegacyEntries(entries);
  return entries;
}

export async function deleteEntry(id: string): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('entries', 'readwrite');
    transaction.objectStore('entries').delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(new Error('删除失败'));
  });
  await deleteArchivedEntry(id);
}

// restoreEntry 表示恢复备份条目，校验 value 后合并收藏并恢复有效的原收藏日期
// 仅备份导入调用，普通收藏使用 saveEntry，跨库写入失败后可以幂等重试
export async function restoreEntry(value: unknown): Promise<WordbookEntry> {
  const raw = value as Partial<WordbookEntry>;
  const saved = await saveEntry(value);
  // validTime 表示有效备份时间，time 必须是合理范围内的毫秒时间戳
  // 无效时间不参与恢复，最多容忍一分钟的设备时钟差
  const validTime = (time: unknown) => typeof time === 'number' && Number.isFinite(time) && time >= 0 && time <= Date.now() + 60000;
  const restored = { ...saved, createdAt: validTime(raw.createdAt) ? Math.min(saved.createdAt, raw.createdAt!) : saved.createdAt, updatedAt: validTime(raw.updatedAt) ? raw.updatedAt! : saved.updatedAt };
  const db = await open();
  await new Promise<void>((resolve, reject) => { const transaction = db.transaction('entries', 'readwrite'); transaction.objectStore('entries').put(restored); transaction.oncomplete = () => resolve(); transaction.onerror = transaction.onabort = () => reject(new Error('备份时间恢复失败')); });
  return restored;   // 备份恢复原收藏日期，普通收藏仍使用当前时间
}
