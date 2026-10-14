import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import type { WordbookEntry } from '../../src/core/types';
import { filterWordbook } from '../../src/core/wordbook-filters';
import { SaveEntryForm, PARTS, EXAM_TAGS } from '../../src/ui/SaveEntryForm';
import { FlowMark } from '../../src/ui/Icons';

export function Wordbook() {
  const [entries, setEntries] = useState<WordbookEntry[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<WordbookEntry | null>(null);
  const [filters, setFilters] = useState({ search: '', kind: '', part: '', exam: '', tag: '' });
  const [sort, setSort] = useState('recent');
  const revision = useRef(0);
  async function reload() {
    const operation = ++revision.current;
    try {
      const result = await browser.runtime.sendMessage({ type: 'FLOWWORD_BOOK_LIST' });
      if (!result?.ok) throw new Error(result?.error || '无法读取单词本');
      if (operation === revision.current) setEntries(result.entries);
    } catch (error) { setError(error instanceof Error ? error.message : '读取失败'); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    const refresh = () => { if (!document.hidden) void reload(); };
    const changed = (message: unknown) => {
      if (message && typeof message === 'object' && 'type' in message && message.type === 'FLOWWORD_BOOK_CHANGED') void reload();
    };
    void reload(); window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    browser.runtime.onMessage.addListener(changed);
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); browser.runtime.onMessage.removeListener(changed); };
  }, []);   // 从视频返回词本时重新读取，不让已打开的页面停留在旧列表
  const tags = [...new Set(entries.flatMap((entry) => entry.tags))].sort();
  const visible = filterWordbook(entries, filters).sort((a, b) => sort === 'alphabet' ? a.text.localeCompare(b.text, 'en') : sort === 'kind' ? a.kind.localeCompare(b.kind) : b.updatedAt - a.updatedAt);
  async function save(entry: WordbookEntry) {
    const result = await browser.runtime.sendMessage({ type: 'FLOWWORD_BOOK_SAVE', entry, replaceId: entry.id });
    if (!result?.ok) throw new Error(result?.error || '保存失败');
    setEditing(null); await reload();
  }
  async function remove(entry: WordbookEntry) {
    const result = await browser.runtime.sendMessage({ type: 'FLOWWORD_BOOK_DELETE', id: entry.id });
    if (!result?.ok) { setError(result?.error || '删除失败'); return; }
    await reload();
  }
  async function exportBook() {
    const operation = ++revision.current;
    try {
      const latest = await browser.runtime.sendMessage({ type: 'FLOWWORD_BOOK_LIST' });
      if (!latest?.ok) throw new Error(latest?.error || '导出失败');
      if (operation === revision.current) setEntries(latest.entries);
      const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), entries: latest.entries }, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'FlowWord-单词本.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);   // 重新读取数据库后导出，不遗漏其他页面刚收藏的条目
    } catch (error) { setError(error instanceof Error ? error.message : '导出失败'); }
  }
  return <main className="book fw-app" style={{ '--fw-font': '16px' } as React.CSSProperties} data-theme="light">
    <header className="book-header"><div><FlowMark size={32} /><span>FlowWord <small>单词本</small></span></div><button type="button" className="fw-primary" onClick={exportBook}>导出单词本</button></header>
    <h1>把理解，留下来。</h1><p className="book-subtitle">单词、短语与整句一起收藏，按词汇类型、考点和你的标签整理 · 本地保存</p>
    <section className="book-filters" aria-label="单词本筛选">
      <input aria-label="搜索单词本" placeholder="搜索原文、译文或标签" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} />
      <select aria-label="条目类型筛选" value={filters.kind} onChange={(event) => setFilters({ ...filters, kind: event.target.value })}><option value="">全部条目</option><option value="word">单词</option><option value="phrase">短语</option><option value="sentence">语句</option></select>
      <select aria-label="词汇类型筛选" value={filters.part} onChange={(event) => setFilters({ ...filters, part: event.target.value })}><option value="">全部词汇类型</option>{PARTS.map((part) => <option key={part}>{part}</option>)}</select>
      <select aria-label="考点筛选" value={filters.exam} onChange={(event) => setFilters({ ...filters, exam: event.target.value })}><option value="">全部考点 / 考试</option>{EXAM_TAGS.map((tag) => <option key={tag}>{tag}</option>)}</select>
      <select aria-label="标签筛选" value={filters.tag} onChange={(event) => setFilters({ ...filters, tag: event.target.value })}><option value="">全部自定义标签</option>{tags.map((tag) => <option key={tag}>{tag}</option>)}</select>
      <select aria-label="排序方式" value={sort} onChange={(event) => setSort(event.target.value)}><option value="recent">最近加入</option><option value="alphabet">字母顺序</option><option value="kind">条目类型</option></select>
    </section>
    <p className="book-count">显示 {visible.length} / {entries.length} 条</p>{error && <p role="alert">{error}</p>}
    {editing ? <section className="book-editor"><SaveEntryForm key={editing.id} draft={editing} onSave={save} onCancel={() => setEditing(null)} /></section>
      : loading ? <p>正在读取本地单词本…</p> : visible.length ? <div className="book-grid">{visible.map((entry) => <article className="book-card" key={entry.id}>
        <div className="book-card-meta"><span>{entry.kind === 'word' ? '单词' : entry.kind === 'phrase' ? '短语' : '语句'} · {entry.partOfSpeech}</span><button type="button" onClick={() => setEditing(entry)}>编辑分类</button></div>
        <h2 lang="en">{entry.text}</h2><p>{entry.translation || '暂无译文，可在编辑中补充自己的理解'}</p>
        <div className="book-tags">{[...new Set([...entry.examTags, ...entry.tags])].map((tag) => <span key={tag}>{tag}</span>)}</div>
        {entry.contexts.at(-1) && <details><summary>查看来源语境</summary><p lang="en">{entry.contexts.at(-1)!.sentence}</p><a href={`${entry.contexts.at(-1)!.url}&t=${Math.floor(entry.contexts.at(-1)!.time)}s`} target="_blank" rel="noreferrer">回到视频这一句</a></details>}
        <button type="button" className="book-delete" onClick={() => void remove(entry)}>删除条目</button>
      </article>)}</div> : <div className="book-empty">{entries.length ? '没有符合这些分类的条目，调整筛选再试' : '还没有条目。在翻译框点击「加入」或「加入整句」开始记录。'}</div>}
  </main>;
}
