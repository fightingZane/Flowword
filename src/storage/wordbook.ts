import type { WordbookEntry } from '../core/types';

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
    contexts: Array.isArray(entry.contexts) ? entry.contexts.filter((context) => typeof context?.sentence === 'string' && /^https:\/\/www\.youtube\.com\/watch\?/.test(context.url) && Number.isFinite(context.time))
      .slice(0, 8).map((context) => ({ sentence: context.sentence.slice(0, 2000), url: context.url.slice(0, 2000), time: Math.max(0, context.time) })) : [],
  };
}

export function mergeEntries(previous: WordbookEntry | undefined, next: WordbookEntry): WordbookEntry {
  if (!previous) return next;
  const contexts = [...previous.contexts, ...next.contexts].filter((context, index, values) => values.findIndex((value) => value.url === context.url && value.time === context.time && value.sentence === context.sentence) === index).slice(-8);
  return { ...next, createdAt: previous.createdAt, translation: next.translation || previous.translation,
    partOfSpeech: next.partOfSpeech === '未分类' || next.partOfSpeech === 'unclassified' ? previous.partOfSpeech : next.partOfSpeech,
    examTags: [...new Set([...previous.examTags, ...next.examTags])], tags: [...new Set([...previous.tags, ...next.tags])], contexts };
}

export async function saveEntry(value: unknown, replaceId?: string): Promise<WordbookEntry> {
  const entry = validateEntry(value);
  const db = await open();
  return new Promise((resolve, reject) => {
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
}

export async function allEntries(): Promise<WordbookEntry[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction('entries').objectStore('entries').getAll();
    request.onsuccess = () => resolve(request.result.sort((a: WordbookEntry, b: WordbookEntry) => b.updatedAt - a.updatedAt));
    request.onerror = () => reject(new Error('无法读取单词本'));
  });
}

export async function deleteEntry(id: string): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('entries', 'readwrite');
    transaction.objectStore('entries').delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(new Error('删除失败'));
  });
}
