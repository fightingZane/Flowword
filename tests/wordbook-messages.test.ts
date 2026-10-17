import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ runtime: vi.fn(), query: vi.fn(), tab: vi.fn(), save: vi.fn(), list: vi.fn(), page: vi.fn(), summary: vi.fn(),
  occurrences: vi.fn(), occurrence: vi.fn(), batch: vi.fn(), deletion: vi.fn(), undo: vi.fn(), export: vi.fn(), import: vi.fn(), due: vi.fn(), grade: vi.fn(), status: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: { runtime: { id: 'test-extension', getURL: (path: string) => `chrome-extension://test-extension${path}`, sendMessage: mocks.runtime }, tabs: { query: mocks.query, sendMessage: mocks.tab } } }));
vi.mock('../src/storage/wordbook', () => ({ saveEntry: mocks.save, allEntries: mocks.list, savedEntryIds: mocks.status, queryEntries: mocks.page, bookSummary: mocks.summary,
  entryOccurrences: mocks.occurrences, updateOccurrence: mocks.occurrence, batchEntries: mocks.batch, deleteEntries: mocks.deletion, undoDelete: mocks.undo,
  exportBackup: mocks.export, importBackup: mocks.import, reviewDue: mocks.due, gradeReview: mocks.grade }));
import { handleWordbookMessage } from '../src/services/wordbook-messages';
const extension = { id: 'test-extension', url: 'chrome-extension://test-extension/wordbook.html' };
const content = { id: 'test-extension', url: 'https://example.test/watch', tab: { id: 7 } };

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset()); mocks.runtime.mockResolvedValue(undefined); mocks.query.mockResolvedValue([{ id: 7 }, { id: 8 }, {}]); mocks.tab.mockResolvedValue(undefined);
  mocks.save.mockResolvedValue({ id: 'word:test' }); mocks.list.mockResolvedValue([]); mocks.page.mockResolvedValue({ entries: [], total: 0, offset: 0, limit: 20 });
  mocks.summary.mockResolvedValue({ videos: [], total: 0, parts: [], tags: [], exams: [], counts: { word: 0, phrase: 0, sentence: 0 } }); mocks.deletion.mockResolvedValue({ undoToken: 'token', deleted: 1 });
  mocks.due.mockResolvedValue([]); mocks.grade.mockResolvedValue({ dueAt: 1 }); mocks.occurrences.mockResolvedValue([]); mocks.occurrence.mockResolvedValue({ id: 'occurrence' });
  mocks.batch.mockResolvedValue({ updated: 1 }); mocks.undo.mockResolvedValue({ restored: 1 }); mocks.export.mockResolvedValue({ version: 3 }); mocks.import.mockResolvedValue({ imported: 1 });
  mocks.status.mockResolvedValue(['word:test']);
});

describe('词本消息授权、原子接口路由和变更广播', () => {
  it('未知消息交给其他路由，其他扩展与网页不能访问本地资料', async () => {
    expect(await handleWordbookMessage({ type: 'FLOWWORD_OTHER' }, content)).toBeUndefined();
    expect(await handleWordbookMessage({ type: 'FLOWWORD_BOOK_LIST' }, { ...content, id: 'foreign' })).toMatchObject({ ok: false });
    expect(await handleWordbookMessage({ type: 'FLOWWORD_BOOK_LIST' }, { id: 'test-extension', url: 'file:///secret' })).toMatchObject({ ok: false }); expect(mocks.list).not.toHaveBeenCalled();
  });
  it('自有内容脚本可分页和复习，不能导入导出或批量删除', async () => {
    expect(await handleWordbookMessage({ type: 'FLOWWORD_BOOK_STATUS', ids: ['word:test', 'word:missing'] }, content)).toEqual({ ok: true, savedIds: ['word:test'] });
    expect(mocks.status).toHaveBeenCalledWith(['word:test', 'word:missing']);
    expect(await handleWordbookMessage({ type: 'FLOWWORD_BOOK_QUERY', query: { offset: 20, limit: 20 } }, content)).toMatchObject({ ok: true }); expect(mocks.page).toHaveBeenCalledWith({ offset: 20, limit: 20 });
    expect(await handleWordbookMessage({ type: 'FLOWWORD_REVIEW_DUE', query: { limit: 10 } }, content)).toMatchObject({ ok: true, cards: [] });
    expect(await handleWordbookMessage({ type: 'FLOWWORD_REVIEW_GRADE', id: 'word:test', grade: 'remember' }, content)).toMatchObject({ ok: true }); expect(mocks.grade).toHaveBeenCalledWith('word:test', 'remember');
    for (const type of ['FLOWWORD_BOOK_EXPORT', 'FLOWWORD_BOOK_IMPORT', 'FLOWWORD_BOOK_DELETE_MANY']) expect(await handleWordbookMessage({ type }, content)).toMatchObject({ ok: false });
    expect(mocks.export).not.toHaveBeenCalled(); expect(mocks.import).not.toHaveBeenCalled(); expect(mocks.deletion).not.toHaveBeenCalled();
  });
  it('保存后通知runtime和tab，仅按id查询且不发送词条内容', async () => {
    const result = await handleWordbookMessage({ type: 'FLOWWORD_BOOK_SAVE', entry: { text: 'test' } }, content);
    expect(result).toEqual({ ok: true, entry: { id: 'word:test' } }); expect(mocks.query).toHaveBeenCalledWith({}); expect(mocks.runtime).toHaveBeenCalledWith({ type: 'FLOWWORD_BOOK_CHANGED' });
    expect(mocks.tab.mock.calls).toEqual([[7, { type: 'FLOWWORD_BOOK_CHANGED' }], [8, { type: 'FLOWWORD_BOOK_CHANGED' }]]);
  });
  it('保存已提交后通知失败仍报告保存成功，保存失败不广播', async () => {
    mocks.runtime.mockRejectedValue(new Error('closed')); mocks.query.mockRejectedValue(new Error('closed'));
    expect(await handleWordbookMessage({ type: 'FLOWWORD_BOOK_SAVE', entry: {} }, content)).toMatchObject({ ok: true });
    mocks.runtime.mockClear(); mocks.query.mockClear(); mocks.save.mockRejectedValue(new Error('事务已回滚'));
    expect(await handleWordbookMessage({ type: 'FLOWWORD_BOOK_SAVE', entry: {} }, content)).toEqual({ ok: false, error: '事务已回滚' }); expect(mocks.runtime).not.toHaveBeenCalled(); expect(mocks.query).not.toHaveBeenCalled();
  });
  it('扩展页面各RPC使用固定参数，不再循环逐条恢复备份', async () => {
    await handleWordbookMessage({ type: 'FLOWWORD_BOOK_SUMMARY' }, extension); expect(mocks.summary).toHaveBeenCalledOnce();
    await handleWordbookMessage({ type: 'FLOWWORD_BOOK_OCCURRENCES', id: 'word:test', videoId: 'video-a' }, extension); expect(mocks.occurrences).toHaveBeenCalledWith('word:test', 'video-a');
    await handleWordbookMessage({ type: 'FLOWWORD_BOOK_OCCURRENCES', id: 'word:test', sourceId: 'web:https://example.test/article' }, extension); expect(mocks.occurrences).toHaveBeenCalledWith('word:test', 'web:https://example.test/article');
    await handleWordbookMessage({ type: 'FLOWWORD_OCCURRENCE_UPDATE', id: 'row', translation: '语境义' }, extension); expect(mocks.occurrence).toHaveBeenCalledWith('row', '语境义');
    await handleWordbookMessage({ type: 'FLOWWORD_BOOK_BATCH', ids: ['word:test'], patch: { status: 'learning' } }, extension); expect(mocks.batch).toHaveBeenCalledWith(['word:test'], { status: 'learning' });
    expect(await handleWordbookMessage({ type: 'FLOWWORD_BOOK_DELETE', id: 'word:test' }, extension)).toMatchObject({ ok: true, undoToken: 'token' });
    await handleWordbookMessage({ type: 'FLOWWORD_BOOK_UNDO', token: 'token' }, extension); expect(mocks.undo).toHaveBeenCalledWith('token');
    await handleWordbookMessage({ type: 'FLOWWORD_BOOK_EXPORT', query: { videoId: 'video-a' } }, extension); expect(mocks.export).toHaveBeenCalledWith({ videoId: 'video-a' });
    await handleWordbookMessage({ type: 'FLOWWORD_BOOK_EXPORT', query: { sourceKind: 'web', sourceId: 'web:https://example.test/article' } }, extension); expect(mocks.export).toHaveBeenCalledWith({ sourceKind: 'web', sourceId: 'web:https://example.test/article' });
    const backup = { version: 3, entries: [] }; await handleWordbookMessage({ type: 'FLOWWORD_BOOK_IMPORT', backup }, extension); expect(mocks.import).toHaveBeenCalledWith(backup);
  });
});
