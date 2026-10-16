import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import type { WordbookEntry } from '../src/core/types';

let book: typeof import('../src/storage/wordbook');
let archive: typeof import('../src/storage/archive');

// value 构造纯本地测试词条，text控制去重键，time和videoKey控制真实语境身份
// 不读取任何用户浏览器数据，URL全部为保留测试域
function value(text = 'charge', time = 1, videoKey = 'video-a', translation = '充电') {
  return { kind: 'word' as const, text, translation, partOfSpeech: '动词', tags: ['测试'], examTags: [], contexts: [
    { sentence: 'Please charge the device.', url: 'https://example.test/watch', time, end: time + 3, title: 'Test lesson', videoKey, translation: '请给设备充电', thumbnail: 'https://example.test/poster.jpg' },
  ] };
}

// readRequest 将测试IDB请求转为Promise，request只能来自本用例的隔离工厂
// 不用于生产事务，也不添加网络等待或计时器
function readRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}

// seedLegacy 创建升级前两库，entry写入旧词本，snapshot写入旧版归档
// 测试结束将由独立IDB工厂整体丢弃，不能连接真实扩展来源
async function seedLegacy(entry: WordbookEntry, snapshot?: import('../src/storage/archive').ArchiveSnapshot): Promise<void> {
  const request = indexedDB.open('flowword-wordbook', 1); request.onupgradeneeded = () => request.result.createObjectStore('entries', { keyPath: 'id' });
  const legacy = await readRequest(request);
  await new Promise<void>((resolve, reject) => { const tx = legacy.transaction('entries', 'readwrite'); tx.objectStore('entries').put(entry); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); legacy.close();
  if (snapshot) {
    const request = indexedDB.open('flowword-archive', 1); request.onupgradeneeded = () => { for (const name of ['videos', 'captures', 'occurrences', 'meta']) request.result.createObjectStore(name, { keyPath: 'id' }); };
    const old = await readRequest(request);
    await new Promise<void>((resolve, reject) => { const tx = old.transaction(['videos', 'captures', 'occurrences', 'meta'], 'readwrite');
      for (const name of ['videos', 'captures', 'occurrences'] as const) snapshot[name].forEach((row) => tx.objectStore(name).put(row));
      tx.objectStore('meta').put({ id: 'legacy-v1', at: 1 }); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); old.close();
  }
}

beforeEach(async () => {
  vi.resetModules(); vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  book = await import('../src/storage/wordbook'); archive = await import('../src/storage/archive');
});
afterEach(async () => { vi.restoreAllMocks(); (await archive.canonicalDatabase().catch(() => undefined))?.close(); vi.unstubAllGlobals(); });

describe('canonical事务与旧库迁移', () => {
  it('标题关键词跨大小写与词序搜索，并保留八条摘要之外的视频来源', async () => {
    const original = value(); original.contexts[0]!.title = 'Battery Health and Charging';
    const saved = await book.saveEntry(original);
    for (let index = 0; index < 9; index++) await book.saveEntry(value('charge', index + 5, `other-${index}`));
    expect((await book.queryEntries({ search: 'CHARGING battery' })).entries.map((entry) => entry.id)).toEqual([saved.id]);
    expect((await book.queryEntries({ search: 'battery 充电' })).total).toBe(1);
    expect((await book.queryEntries({ search: 'battery missing' })).total).toBe(0);
    expect((await book.queryEntries({ search: 'charging', videoId: 'other-8' })).total).toBe(0);
  });
  it('保留旧版重复收藏累计超过二十项的标签并可完整导出导入', async () => {
    const entry = { ...book.validateEntry(value()), tags: Array.from({ length: 40 }, (_, index) => `旧标签${index}`) };
    await seedLegacy(entry);
    expect((await book.allEntries())[0]?.tags).toEqual(entry.tags);
    const backup = await book.exportBackup(); expect(book.validateBackup(backup).entries[0]?.tags).toEqual(entry.tags);
    await book.importBackup(backup); expect((await book.allEntries())[0]?.tags).toEqual(entry.tags);
  });
  it('旧库只读迁移并保留超过八条的原归档与每次词义', async () => {
    const entry = { ...book.validateEntry(value()), createdAt: 1, updatedAt: 2 };
    const captures = Array.from({ length: 11 }, (_, time) => ({ ...value().contexts[0]!, time, end: time + 3, id: JSON.stringify(['video-a', time, value().contexts[0]!.sentence]), videoId: 'video-a' }));
    const occurrences = captures.map((capture, index) => ({ id: JSON.stringify([entry.id, capture.id]), entryId: entry.id, captureId: capture.id, text: entry.text, translation: `原语境${index}`, createdAt: 1 }));
    await seedLegacy(entry, { videos: [{ id: 'video-a', url: entry.contexts[0]!.url, title: 'Test', updatedAt: 2 }], captures, occurrences });
    expect((await book.allEntries())[0]).toMatchObject({ id: entry.id, createdAt: 1 });
    const snapshot = await archive.archiveSnapshot(); expect(snapshot.occurrences.filter((item) => item.translation.startsWith('原语境'))).toHaveLength(11);
    expect(() => book.validateBackup({ version: 3, entries: [entry], archive: snapshot })).not.toThrow();
    const legacy = await readRequest(indexedDB.open('flowword-wordbook', 1)); const original = await readRequest(legacy.transaction('entries').objectStore('entries').get(entry.id)); legacy.close();
    expect(original).toEqual(entry);
    await book.deleteEntry(entry.id); expect(await book.allEntries()).toEqual([]); expect(await book.allEntries()).toEqual([]);
  });
  it('归档写入故障会回滚词条、视频和字幕', async () => {
    await book.allEntries(); const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'occurrences') throw new DOMException('Injected quota', 'QuotaExceededError'); return put.apply(this, args);
    });
    await expect(book.saveEntry(value())).rejects.toThrow(); vi.restoreAllMocks();
    expect(await book.allEntries()).toEqual([]); expect(await archive.archiveSnapshot()).toEqual({ videos: [], captures: [], occurrences: [] });
  });
  it('改名关联故障不删除旧词条或历史词义', async () => {
    const saved = await book.saveEntry(value()); const before = await book.exportBackup(); const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'occurrences') throw new Error('Injected rename failure'); return put.apply(this, args);
    });
    await expect(book.saveEntry({ ...saved, text: 'charging', lemma: 'charging' }, saved.id)).rejects.toThrow(); vi.restoreAllMocks();
    expect(await book.allEntries()).toEqual(before.entries); expect((await archive.archiveSnapshot()).occurrences).toEqual(before.archive.occurrences);
  });
  it('同名改名冲突不改任何表，正常改名保留历史语境义', async () => {
    const saved = await book.saveEntry(value()); await book.saveEntry(value('charging'));
    await expect(book.saveEntry({ ...saved, text: 'charging', lemma: 'charging' }, saved.id)).rejects.toThrow('已存在');
    await book.saveEntry({ ...saved, text: 'charged', lemma: 'charged' }, saved.id);
    expect((await book.entryOccurrences('word:charged'))[0]?.translation).toBe('充电'); expect(await book.entryOccurrences(saved.id)).toEqual([]);
  });
  it('旧表单不能覆盖并发新收藏，即使发生在同一毫秒', async () => {
    const first = await book.saveEntry(value()); const next = await book.saveEntry(value('charge', 8, 'video-b', '新的收费义'));
    expect(next.updatedAt).toBeGreaterThan(first.updatedAt);
    await expect(book.saveEntry({ ...first, translation: '旧表单译文' }, first.id)).rejects.toThrow('其他页面更新');
    expect((await book.allEntries())[0]?.translation).toBe('新的收费义');
  });
  it('旧版孤立归档保留原库但阻止导出不可恢复的备份', async () => {
    const entry = book.validateEntry(value()); const capture = { ...value().contexts[0]!, id: 'capture', videoId: 'video-a' };
    await seedLegacy(entry, { videos: [{ id: 'video-a', url: capture.url, title: 'Old', updatedAt: 1 }], captures: [capture],
      occurrences: [{ id: 'orphan', entryId: 'word:deleted', captureId: 'capture', text: 'deleted', translation: '历史孤立资料', createdAt: 1 }] });
    await expect(book.exportBackup()).rejects.toThrow(); expect((await archive.archiveSnapshot()).occurrences.some((item) => item.id === 'orphan')).toBe(true);
    expect((await book.allEntries())[0]?.id).toBe(entry.id);
  });
});

describe('完整备份预校验、原子恢复与并发', () => {
  it('中途null词条或null归档不会留下前半份备份', async () => {
    await expect(book.importBackup({ version: 1, entries: [value('valid'), null] })).rejects.toThrow(); expect(await book.allEntries()).toEqual([]);
    await expect(book.importBackup({ version: 2, entries: [value('valid')], archive: { videos: [null], captures: [], occurrences: [] } })).rejects.toThrow(); expect(await book.allEntries()).toEqual([]);
  });
  it('写入后半份失败时前半份词条与关联全部回滚', async () => {
    await book.allEntries(); const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'entries' && (args[0] as WordbookEntry).text === 'fail') throw new Error('Injected import failure'); return put.apply(this, args);
    });
    await expect(book.importBackup({ version: 1, entries: [value('valid'), value('fail')] })).rejects.toThrow(); vi.restoreAllMocks();
    expect(await book.allEntries()).toEqual([]); expect((await archive.archiveSnapshot()).occurrences).toEqual([]);
  });
  it('并发导入不覆盖新收藏与新语境义', async () => {
    await book.allEntries(); const backup = { version: 1, entries: [{ ...value('charge', 2, 'video-b', '旧备份义'), createdAt: 1, updatedAt: 2 }] };
    await Promise.all([book.saveEntry(value('charge', 1, 'video-a', '新收藏义')), book.importBackup(backup), book.saveEntry(value('independent'))]);
    expect((await book.allEntries()).find((entry) => entry.id === 'word:charge')?.translation).toBe('新收藏义');
    expect((await book.entryOccurrences('word:charge')).map((item) => item.translation).sort()).toEqual(['新收藏义', '旧备份义']);
    expect((await book.allEntries()).some((entry) => entry.id === 'word:independent')).toBe(true);
  });
  it('完整备份恢复每次语境义、复习数据、封面和原日期且重复导入幂等', async () => {
    const saved = await book.saveEntry(value()); await book.saveEntry(value('charge', 8, 'video-b', '收费'));
    const rows = await book.entryOccurrences(saved.id); await book.updateOccurrence(rows[0]!.id, '当前视频内：给设备充电'); await book.gradeReview(saved.id, 'remember');
    const backup = await book.exportBackup(); const deleted = await book.deleteEntries([saved.id]); expect(deleted.deleted).toBe(1);
    await book.importBackup(backup); await book.importBackup(backup);
    expect(await book.allEntries()).toEqual(backup.entries); expect((await book.entryOccurrences(saved.id)).map((item) => item.translation).sort()).toEqual(['当前视频内：给设备充电', '收费']);
    expect((await book.exportBackup()).archive.captures[0]?.thumbnail).toBe('https://example.test/poster.jpg');
  });
  it('导出导入共享数量和文件上限并明确拒绝超限，按视频导出不带其他视频', async () => {
    await book.saveEntry(value()); await book.saveEntry(value('other', 7, 'video-b'));
    const scoped = await book.exportBackup({ videoId: 'video-a' }); expect(scoped.entries.map((entry) => entry.id)).toEqual(['word:charge']);
    expect(scoped.archive.captures.every((capture) => capture.videoId === 'video-a')).toBe(true); expect(() => book.validateBackup(scoped)).not.toThrow();
    await expect(book.importBackup({ version: 1, entries: new Array(book.BACKUP_LIMITS.entries + 1).fill(null) })).rejects.toThrow('数量');
    const oldBytes = book.BACKUP_LIMITS.bytes; (book.BACKUP_LIMITS as { bytes: number }).bytes = 50;
    try { await expect(book.exportBackup()).rejects.toThrow('统一上限'); await expect(book.importBackup({ version: 1, entries: [value()] })).rejects.toThrow('统一上限'); }
    finally { (book.BACKUP_LIMITS as { bytes: number }).bytes = oldBytes; }
  });
  it('拒绝危险URL、断开关联与超长字段，不执行部分写入', async () => {
    await expect(book.importBackup({ version: 1, entries: [value(), { ...value('unsafe'), contexts: [{ ...value().contexts[0], url: 'javascript:alert(1)' }] }] })).rejects.toThrow();
    expect(await book.allEntries()).toEqual([]);
    const entry = await book.saveEntry(value()); const backup = await book.exportBackup(); backup.archive.occurrences[0]!.entryId = 'word:missing';
    await expect(book.importBackup(backup)).rejects.toThrow('断开'); expect((await book.allEntries())[0]?.id).toBe(entry.id);
  });
});

describe('分页、单次语境编辑与批量撤销', () => {
  it('少量收藏状态只返回存在的canonical键并限制一百项', async () => {
    await book.saveEntry(value()); expect(await book.savedEntryIds(['word:charge', 'word:missing', 'word:charge'])).toEqual(['word:charge']);
    expect(await book.savedEntryIds([])).toEqual([]); await expect(book.savedEntryIds(new Array(101).fill('word:charge'))).rejects.toThrow('最多100');
  });
  it('分页搜索范围覆盖旧收藏，分类摘要覆盖所有页', async () => {
    for (let index = 0; index < 26; index++) await book.saveEntry({ ...value(`word${String(index).padStart(2, '0')}`), tags: [index === 0 ? '仅旧页标签' : '测试'] });
    const page = await book.queryEntries({ sort: 'alphabet', offset: 20, limit: 5 }); expect(page.total).toBe(26); expect(page.entries).toHaveLength(5); expect(page.entries[0]?.text).toBe('word20');
    expect((await book.queryEntries({ search: '仅旧页标签', limit: 20 })).entries[0]?.text).toBe('word00');
    const summary = await book.bookSummary(); expect(summary.tags).toContain('仅旧页标签'); expect(summary.total).toBe(26); expect(summary.videos[0]?.count).toBe(26);
    await expect(book.queryEntries({ limit: 101 })).rejects.toThrow('分页');
  });
  it('按视频时间排序且只修改某次语境义', async () => {
    const first = await book.saveEntry(value('charge', 20)); await book.saveEntry(value('charge', 8, 'video-b', '收费')); await book.saveEntry(value('before', 2));
    expect((await book.queryEntries({ videoId: 'video-a', sort: 'time' })).entries.map((entry) => entry.text)).toEqual(['before', 'charge']);
    const rows = await book.entryOccurrences(first.id, 'video-a'); await book.updateOccurrence(rows[0]!.id, '给设备充电');
    expect((await book.entryOccurrences(first.id, 'video-b'))[0]?.translation).toBe('收费'); expect((await book.allEntries()).find((entry) => entry.id === first.id)?.translation).toBe('收费');
  });
  it('视频分页来源从完整归档补回，不误用其他视频的最近八条摘要', async () => {
    await book.saveEntry(value('charge', 1, 'video-old'));
    for (let time = 2; time < 12; time++) await book.saveEntry(value('charge', time, 'video-new'));
    expect((await book.allEntries())[0]?.contexts.every((context) => context.videoKey === 'video-new')).toBe(true);
    const page = await book.queryEntries({ videoId: 'video-old' }); expect(page.entries[0]?.contexts[0]?.videoKey).toBe('video-old'); expect(page.entries[0]?.contexts[0]?.time).toBe(1);
  });
  it('批量编辑与删除任一目标消失则整批回滚', async () => {
    const a = await book.saveEntry(value('a')); const b = await book.saveEntry(value('b'));
    await expect(book.batchEntries([a.id, 'word:missing'], { status: 'mastered' })).rejects.toThrow('整批'); expect((await book.allEntries()).find((entry) => entry.id === a.id)?.status).toBeUndefined();
    await expect(book.deleteEntries([a.id, 'word:missing'])).rejects.toThrow('整批'); expect(await book.allEntries()).toHaveLength(2);
    expect(await book.batchEntries([a.id, b.id], { status: 'learning', tags: [] })).toEqual({ updated: 2 }); expect((await book.allEntries()).every((entry) => entry.status === 'learning' && entry.tags.length === 0)).toBe(true);
  });
  it('删除故障回滚，成功后撤销恢复原词条与语境，token不可重复使用', async () => {
    const saved = await book.saveEntry(value()); const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) { if (this.name === 'undo') throw new Error('Injected undo failure'); return put.apply(this, args); });
    await expect(book.deleteEntries([saved.id])).rejects.toThrow(); vi.restoreAllMocks(); expect(await book.allEntries()).toHaveLength(1); expect(await book.entryOccurrences(saved.id)).toHaveLength(1);
    const deletion = await book.deleteEntries([saved.id]); expect(await book.allEntries()).toEqual([]); expect(await book.undoDelete(deletion.undoToken)).toEqual({ restored: 1 });
    expect((await book.entryOccurrences(saved.id))[0]?.translation).toBe('充电'); await expect(book.undoDelete(deletion.undoToken)).rejects.toThrow('已经使用');
  });
  it('撤销不覆盖删除后新收藏的同名词条', async () => {
    const saved = await book.saveEntry(value()); const deletion = await book.deleteEntries([saved.id]); await book.saveEntry(value('charge', 8, 'video-b', '新义'));
    await expect(book.undoDelete(deletion.undoToken)).rejects.toThrow('不会覆盖'); expect((await book.allEntries())[0]?.translation).toBe('新义'); expect(await book.entryOccurrences(saved.id)).toHaveLength(1);
  });
});

describe('透明本地复习计划', () => {
  it('新条目到期，记住按1/3/7/14/30天且不自动变为mastered', async () => {
    const saved = await book.saveEntry(value()); expect((await book.reviewDue())[0]?.contexts[0]?.capture.videoId).toBe('video-a');
    for (const days of [1, 3, 7, 14, 30, 30]) expect((await book.gradeReview(saved.id, 'remember')).intervalDays).toBe(days);
    expect((await book.allEntries())[0]?.status).toBe('learning'); expect(await book.reviewDue()).toEqual([]);
  });
  it('忘记与模糊均次日到期，掌握仅由手动状态管理', async () => {
    const saved = await book.saveEntry(value()); const forgot = await book.gradeReview(saved.id, 'forgot'); expect(forgot.intervalDays).toBe(1); expect(forgot.lapses).toBe(1); expect(forgot.repetitions).toBe(0);
    expect((await book.gradeReview(saved.id, 'uncertain')).intervalDays).toBe(1);
    await book.batchEntries([saved.id], { status: 'mastered' }); await book.gradeReview(saved.id, 'remember'); expect((await book.allEntries())[0]?.status).toBe('mastered');
  });
});
