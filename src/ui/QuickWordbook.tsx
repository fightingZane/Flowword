import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import type { WordbookEntry } from '../core/types';

// quickWordbookEntries 表示快捷词本结果，按 search 搜索 entries 后返回最近二十条
// 搜索原文、词形和译文，不修改传入数组，updatedAt 相同时按创建时间排序
export function quickWordbookEntries(entries: WordbookEntry[], search: string): WordbookEntry[] {
  const query = search.normalize('NFKC').trim().toLocaleLowerCase();
  return entries.filter((entry) => !query || [entry.text, entry.lemma || '', entry.translation].some((value) => value.normalize('NFKC').toLocaleLowerCase().includes(query)))
    .sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt).slice(0, 20);
}

// QuickWordbook 表示悬浮快捷词本，从后台读取最近收藏并提供搜索和刷新
// onOpenFull 用于打开完整词本，由父组件控制窗口，不会自行跳转或暂停视频
export function QuickWordbook({ onOpenFull }: { onOpenFull(): void }) {
  const [entries, setEntries] = useState<WordbookEntry[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const operation = useRef(0);
  // reload 表示刷新收藏，无参数，通过后台消息获取数据并忽略卸载后的旧响应
  // 请求失败保留现有列表并显示原因，刷新按钮可重新尝试
  async function reload() {
    const request = ++operation.current; setLoading(true); setError('');
    try {
      const result = await browser.runtime.sendMessage({ type: 'FLOWWORD_BOOK_LIST' });
      if (!result?.ok || !Array.isArray(result.entries)) throw new Error(result?.error || '暂时无法读取单词本');
      if (request === operation.current) setEntries(result.entries);
    } catch (error) { if (request === operation.current) setError(error instanceof Error ? error.message : '读取失败'); }
    finally { if (request === operation.current) setLoading(false); }
  }
  useEffect(() => {
    // changed 表示后台收藏更新通知，message 只有匹配词本变更类型才触发刷新
    const changed = (message: unknown) => { if (message && typeof message === 'object' && 'type' in message && message.type === 'FLOWWORD_BOOK_CHANGED') void reload(); };
    void reload(); browser.runtime.onMessage.addListener(changed);
    return () => { operation.current++; browser.runtime.onMessage.removeListener(changed); };
  }, []);
  const visible = quickWordbookEntries(entries, search);
  return <section className="fw-quick-book" aria-label="悬浮单词本">
    <div className="fw-quick-book-heading"><div><h2>最近收藏</h2><span>按收藏更新时间排序 · 最近 20 条</span></div><button type="button" className="fw-quick-book-refresh" onClick={() => void reload()} disabled={loading}>刷新</button></div>
    <label className="fw-quick-book-search"><span>搜索词句</span><input type="search" aria-label="搜索悬浮单词本" placeholder="原文、词形或译文" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
    {error && <p className="fw-quick-book-message" role="alert">{error}</p>}
    {loading && !entries.length ? <p className="fw-quick-book-message" role="status">正在读取收藏…</p> : visible.length ? <ul className="fw-quick-book-list">{visible.map((entry) => <li key={entry.id}>
      <div className="fw-quick-book-meta"><span>{entry.kind === 'word' ? '单词' : entry.kind === 'phrase' ? '表达' : '整句'}</span><time dateTime={new Date(entry.updatedAt).toISOString()}>{new Date(entry.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time></div>
      <strong lang="en">{entry.text}</strong><p>{entry.translation || '暂无译文'}</p>
    </li>)}</ul> : !error && <p className="fw-quick-book-message">{search.trim() ? '没有匹配的词句，试试其他关键词' : '还没有收藏，在翻译框中收藏词句后会显示在这里'}</p>}
    <footer className="fw-quick-book-footer"><span>{visible.length} / {entries.length} 条</span><button type="button" onClick={onOpenFull}>打开完整词本 ↗</button></footer>
  </section>;
}
