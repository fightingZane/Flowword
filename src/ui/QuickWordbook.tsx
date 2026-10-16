import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import type { WordbookEntry } from '../core/types';
import { ReviewSession } from './ReviewSession';

// quickWordbookQuery 表示快捷词本分页条件，search 是搜索词，offset 是服务器偏移
// 每次最多获取二十条，排序与搜索交给后台索引，不拉取整个词本
export function quickWordbookQuery(search: string, offset: number) { return { search: search.normalize('NFKC').trim(), sort: 'recent', offset: Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0, limit: 20 }; }

// QuickWordbook 表示悬浮快捷词本，从后台读取最近收藏并提供搜索和刷新
// onOpenFull 用于打开完整词本，由父组件控制窗口，不会自行跳转或暂停视频
export function QuickWordbook({ onOpenFull }: { onOpenFull(): void }) {
  const [entries, setEntries] = useState<WordbookEntry[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  const operation = useRef(0);
  // reload 表示刷新收藏，无参数，通过后台消息获取数据并忽略卸载后的旧响应
  // 请求失败保留现有列表并显示原因，刷新按钮可重新尝试
  async function reload() {
    const request = ++operation.current; setLoading(true); setError('');
    try {
      const result = await browser.runtime.sendMessage({ type: 'FLOWWORD_BOOK_QUERY', query: quickWordbookQuery(search, offset) });
      if (!result?.ok || !Array.isArray(result.entries)) throw new Error(result?.error || '暂时无法读取单词本');
      if (request === operation.current) { if (!result.entries.length && result.total > 0 && offset >= result.total) { setOffset(Math.floor((result.total - 1) / 20) * 20); return; } setEntries(result.entries); setTotal(result.total || 0); }
    } catch (error) { if (request === operation.current) setError(error instanceof Error ? error.message : '读取失败'); }
    finally { if (request === operation.current) setLoading(false); }
  }
  useEffect(() => {
    // changed 表示后台收藏更新通知，message 只有匹配词本变更类型才触发刷新
    const changed = (message: unknown) => { if (message && typeof message === 'object' && 'type' in message && message.type === 'FLOWWORD_BOOK_CHANGED') void reload(); };
    const timer = setTimeout(() => void reload(), search ? 180 : 0); browser.runtime.onMessage.addListener(changed);
    return () => { clearTimeout(timer); operation.current++; browser.runtime.onMessage.removeListener(changed); };
  }, [search, offset]);
  // replay 表示快捷词本听原句，source 为保存的视频语境，后台负责权限与准确时间校验
  async function replay(source: WordbookEntry['contexts'][number]) {
    try { const result = await browser.runtime.sendMessage({ type: 'FLOWWORD_REPLAY_SOURCE', source }); if (!result?.ok) throw new Error(result?.error || '来源暂时无法播放'); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '来源打开失败'); }
  }
  if (reviewing) return <ReviewSession onClose={() => { setReviewing(false); void reload(); }} />;
  const visible = entries;
  return <section className="fw-quick-book" aria-label="悬浮单词本">
    <div className="fw-quick-book-heading"><div><h2>最近收藏</h2><span>按更新时间排序 · 每页 20 条</span></div><button type="button" className="fw-quick-book-refresh" onClick={() => void reload()} disabled={loading}>刷新</button></div>
    <button type="button" className="fw-quick-book-review" onClick={() => setReviewing(true)}>开始词句复习 · 不调用模型</button>
    <label className="fw-quick-book-search"><span>搜索词句</span><input type="search" aria-label="搜索悬浮单词本" placeholder="词句、译文或视频标题" value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0); }} /></label>
    {error && <p className="fw-quick-book-message" role="alert">{error}</p>}
    {loading && !entries.length ? <p className="fw-quick-book-message" role="status">正在读取收藏…</p> : visible.length ? <ul className="fw-quick-book-list">{visible.map((entry) => <li key={entry.id}>
      <div className="fw-quick-book-meta"><span>{entry.kind === 'word' ? '单词' : entry.kind === 'phrase' ? '表达' : '整句'}</span><time dateTime={new Date(entry.updatedAt).toISOString()}>{new Date(entry.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time></div>
      <strong lang="en">{entry.text}</strong><p>{entry.translation || '暂无译文'}</p>{entry.contexts.at(-1) && <button type="button" className="fw-quick-book-source" title={entry.contexts.at(-1)!.title || entry.contexts.at(-1)!.url} onClick={() => void replay(entry.contexts.at(-1)!)}>▷ {(entry.contexts.at(-1)!.title || '来源视频').slice(0, 28)} · {Math.floor(entry.contexts.at(-1)!.time / 60)}:{String(Math.floor(entry.contexts.at(-1)!.time % 60)).padStart(2, '0')}</button>}
    </li>)}</ul> : !error && <p className="fw-quick-book-message">{search.trim() ? '没有匹配的词句，试试其他关键词' : '还没有收藏，在翻译框中收藏词句后会显示在这里'}</p>}
    {total > 20 && <div className="fw-quick-book-pages"><button type="button" disabled={!offset || loading} onClick={() => setOffset(Math.max(0, offset - 20))}>上一页</button><span>{Math.floor(offset / 20) + 1} / {Math.ceil(total / 20)}</span><button type="button" disabled={offset + 20 >= total || loading} onClick={() => setOffset(offset + 20)}>下一页</button></div>}
    <footer className="fw-quick-book-footer"><span>{visible.length} / {total} 条</span><button type="button" onClick={onOpenFull}>打开完整词本 ↗</button></footer>
  </section>;
}
