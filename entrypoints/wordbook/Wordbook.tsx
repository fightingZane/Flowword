import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import type { WordbookEntry } from '../../src/core/types';
import { filterWordbook } from '../../src/core/wordbook-filters';
import { SaveEntryForm, PARTS, EXAM_TAGS } from '../../src/ui/SaveEntryForm';
import { FlowMark } from '../../src/ui/Icons';
import { archiveSnapshot, importArchive, videoSourceLink, type ArchiveSnapshot } from '../../src/storage/archive';
import { restoreEntry, validateEntry } from '../../src/storage/wordbook';

const THEMES = [['light', '薄雾森林'], ['dark', '午夜墨绿'], ['warm', '焦糖奶茶'], ['blue', '深海蓝调'], ['lavender', '紫藤花园'], ['rose', '玫瑰信笺'], ['sunset', '落日橘光'], ['mint', '薄荷冰川']];

// Wordbook 表示学习档案页面，无参数，展示收藏分类、视频语境和个性化主题
// 只在扩展页面挂载，数据保存在扩展来源，切换主题不会修改视频页面
export function Wordbook() {
  const [entries, setEntries] = useState<WordbookEntry[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<WordbookEntry | null>(null);
  const [filters, setFilters] = useState({ search: '', kind: '', part: '', exam: '', tag: '' });
  const [sort, setSort] = useState('recent');
  const [theme, setTheme] = useState('light');
  // 此布局回调无参数，把当前theme同步到整页根节点，避免两侧与滚动背景仍用默认浅色
  useLayoutEffect(() => { document.documentElement.dataset.bookTheme = theme; }, [theme]);
  const [archive, setArchive] = useState<ArchiveSnapshot>({ videos: [], captures: [], occurrences: [] });
  const [video, setVideo] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const revision = useRef(0);
  // reload 表示重新读取，无参数，同步最新词本与归档到页面
  // 递增请求序号以避免旧读取覆盖新结果，页面不可见时由事件入口决定是否调用
  async function reload() {
    const operation = ++revision.current;
    try {
      const result = await browser.runtime.sendMessage({ type: 'FLOWWORD_BOOK_LIST' });
      if (!result?.ok) throw new Error(result?.error || '无法读取单词本');
      const snapshot = await archiveSnapshot();
      if (operation === revision.current) { setEntries(result.entries); setArchive(snapshot); }
    } catch (error) { setError(error instanceof Error ? error.message : '读取失败'); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    void browser.storage.local.get('flowword-book-theme').then((stored) => { const theme = stored['flowword-book-theme']; if (typeof theme === 'string' && THEMES.some(([id]) => id === theme)) setTheme(theme); });
    // refresh 表示可见刷新，无参数，窗口返回前台时重读收藏，隐藏页面不额外读取
    const refresh = () => { if (!document.hidden) void reload(); };
    // changed 表示收藏变更通知，message 来自扩展消息，只响应约定的更新类型
    const changed = (message: unknown) => {
      if (message && typeof message === 'object' && 'type' in message && message.type === 'FLOWWORD_BOOK_CHANGED') void reload();
    };
    void reload(); window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    browser.runtime.onMessage.addListener(changed);
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); browser.runtime.onMessage.removeListener(changed); };
  }, []);   // 从视频返回词本时重新读取，不让已打开的页面停留在旧列表
  const tags = [...new Set(entries.flatMap((entry) => entry.tags))].sort();
  const captureMap = new Map(archive.captures.map((capture) => [capture.id, capture]));
  // occurrenceTime 表示收藏时间轴位置，从 entry 关联语境中取当前视频最早秒数
  // 没有关联时返回无穷大，时间排序会将其放在有时间的条目之后
  const occurrenceTime = (entry: WordbookEntry) => Math.min(...archive.occurrences.filter((item) => item.entryId === entry.id && (!video || captureMap.get(item.captureId)?.videoId === video)).map((item) => captureMap.get(item.captureId)?.time ?? Infinity));
  const visible = filterWordbook(entries, filters).filter((entry) => !video || archive.occurrences.some((item) => item.entryId === entry.id && captureMap.get(item.captureId)?.videoId === video)).sort((a, b) => sort === 'time' ? occurrenceTime(a) - occurrenceTime(b) : sort === 'alphabet' ? a.text.localeCompare(b.text, 'en') : sort === 'kind' ? a.kind.localeCompare(b.kind) : b.updatedAt - a.updatedAt);
  // save 表示保存编辑，将 entry 发送后台并在成功后重读页面
  // 编辑按原键替换分类，失败保留编辑表单让用户修正或重试
  async function save(entry: WordbookEntry) {
    const result = await browser.runtime.sendMessage({ type: 'FLOWWORD_BOOK_SAVE', entry, replaceId: entry.id });
    if (!result?.ok) throw new Error(result?.error || '保存失败');
    setEntries((previous) => previous.map((item) => item.id === entry.id ? result.entry : item));   // 已确认保存后立即更新筛选结果，不等归档重新读取
    setEditing(null); await reload();
  }
  // remove 表示删除收藏，根据 entry.id 删除词条及归档关联后更新列表
  // 视频和捕获句资料仍保留，不要用于清空整个学习数据库
  async function remove(entry: WordbookEntry) {
    const result = await browser.runtime.sendMessage({ type: 'FLOWWORD_BOOK_DELETE', id: entry.id });
    if (!result?.ok) { setError(result?.error || '删除失败'); return; }
    await reload();
  }
  // exportBook 表示导出备份，无参数，重新读取词本并下载包含归档的版本二 JSON
  // 导出本地收藏白名单资料，不包含联网服务配置和密钥
  async function exportBook() {
    const operation = ++revision.current;
    try {
      const latest = await browser.runtime.sendMessage({ type: 'FLOWWORD_BOOK_LIST' });
      if (!latest?.ok) throw new Error(latest?.error || '导出失败');
      if (operation === revision.current) setEntries(latest.entries);
      const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), entries: latest.entries, archive: await archiveSnapshot() }, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'FlowWord-单词本.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);   // 重新读取数据库后导出，不遗漏其他页面刚收藏的条目
    } catch (error) { setError(error instanceof Error ? error.message : '导出失败'); }
  }
  // importBook 表示导入备份，file 是用户选择的版本一或版本二 JSON 文件
  // 先验证全部词条，限制文件大小，逐项合并恢复并在失败时显示原因
  async function importBook(file?: File) {
    if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('备份大于 20 MB，请拆分导入');
      const backup = JSON.parse(await file.text());
      if (![1, 2].includes(backup.version) || !Array.isArray(backup.entries) || backup.entries.length > 10000) throw new Error('请选择 FlowWord 导出的 JSON 备份');
      const validated = backup.entries.map(validateEntry);   // 全部条目先验证，再开始写入
      for (let index = 0; index < validated.length; index++) { const entry = validated[index]; const raw = backup.entries[index]; await restoreEntry({ ...entry, contexts: raw.contexts, createdAt: raw.createdAt, updatedAt: raw.updatedAt }); }
      const ids = new Set<string>(validated.map((entry: WordbookEntry) => entry.id)); await importArchive(backup.archive, ids);
      setError(''); await reload();
    } catch (error) { setError(error instanceof Error ? error.message : '导入失败'); }
    finally { if (fileInput.current) fileInput.current.value = ''; }
  }
  return <main className="book fw-app" style={{ '--fw-font': '16px' } as React.CSSProperties} data-theme={theme}>
    <header className="book-header"><div><FlowMark size={32} /><span>FlowWord <small>学习档案 · 单词本</small></span></div><div className="book-actions"><select aria-label="单词本主题" value={theme} onChange={(event) => { setTheme(event.target.value); void browser.storage.local.set({ 'flowword-book-theme': event.target.value }); }}>{THEMES.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select><button type="button" onClick={() => fileInput.current?.click()}>导入备份</button><input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(event) => void importBook(event.target.files?.[0])} /><button type="button" className="fw-primary" onClick={exportBook}>导出单词本</button></div></header>
    <h1>把理解，留下来。</h1><p className="book-subtitle">单词、短语与整句一起收藏，按词汇类型、考点和你的标签整理 · 本地保存</p>
    <section className="book-filters" aria-label="单词本筛选">
      <input aria-label="搜索单词本" placeholder="搜索原文、译文或标签" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} />
      <select aria-label="条目类型筛选" value={filters.kind} onChange={(event) => setFilters({ ...filters, kind: event.target.value })}><option value="">全部条目</option><option value="word">单词</option><option value="phrase">短语</option><option value="sentence">语句</option></select>
      <select aria-label="词汇类型筛选" value={filters.part} onChange={(event) => setFilters({ ...filters, part: event.target.value })}><option value="">全部词汇类型</option>{[...new Set([...PARTS, ...entries.map((entry) => entry.partOfSpeech)])].map((part) => <option key={part}>{part}</option>)}</select>
      <select aria-label="考点筛选" value={filters.exam} onChange={(event) => setFilters({ ...filters, exam: event.target.value })}><option value="">全部考点 / 考试</option>{EXAM_TAGS.map((tag) => <option key={tag}>{tag}</option>)}</select>
      <select aria-label="标签筛选" value={filters.tag} onChange={(event) => setFilters({ ...filters, tag: event.target.value })}><option value="">全部自定义标签</option>{tags.map((tag) => <option key={tag}>{tag}</option>)}</select>
      <select aria-label="视频分组" value={video} onChange={(event) => { setVideo(event.target.value); if (event.target.value) setSort('time'); }}><option value="">全部视频</option>{archive.videos.filter((source) => archive.occurrences.some((item) => captureMap.get(item.captureId)?.videoId === source.id)).map((source) => <option key={source.id} value={source.id}>{source.title}</option>)}</select>
      <select aria-label="排序方式" value={sort} onChange={(event) => setSort(event.target.value)}><option value="recent">最近加入</option><option value="alphabet">字母顺序</option><option value="kind">条目类型</option><option value="time">视频时间顺序</option></select>
    </section>
    <p className="book-count">显示 {visible.length} / {entries.length} 条</p>{error && <p role="alert">{error}</p>}
    {editing ? <section className="book-editor"><SaveEntryForm key={editing.id} draft={editing} onSave={save} onCancel={() => setEditing(null)} /></section>
      : loading ? <p>正在读取本地单词本…</p> : visible.length ? <div className="book-grid">{visible.map((entry) => <article className="book-card" key={entry.id}>
        <div className="book-card-meta"><span>{entry.kind === 'word' ? '单词' : entry.kind === 'phrase' ? '短语' : '语句'} · {entry.partOfSpeech}</span><button type="button" onClick={() => setEditing(entry)}>编辑分类</button></div>
        <h2 lang="en">{entry.text}</h2><p>{entry.translation || '暂无译文，可在编辑中补充自己的理解'}</p>
        <div className="book-tags">{[...new Set([...entry.examTags, ...entry.tags])].map((tag) => <span key={tag}>{tag}</span>)}</div>
        <details><summary>查看来源语境</summary>{archive.occurrences.filter((item) => item.entryId === entry.id && (!video || captureMap.get(item.captureId)?.videoId === video)).map((item) => { const capture = captureMap.get(item.captureId); return capture ? { ...capture, occurrenceTranslation: item.translation } : undefined; }).filter((capture) => Boolean(capture)).sort((a, b) => a!.time - b!.time).map((capture) => <section key={capture!.id} className="book-source"><strong>{capture!.title || archive.videos.find((source) => source.id === capture!.videoId)?.title} · {Math.floor(capture!.time / 60)}:{String(Math.floor(capture!.time % 60)).padStart(2, '0')}</strong><p lang="en">{capture!.sentence}</p>{capture!.translation && <p>{capture!.translation}</p>}{capture!.occurrenceTranslation && <p>该语境释义：{capture!.occurrenceTranslation}</p>}<a href={videoSourceLink(capture!)} target="_blank" rel="noreferrer">回到视频这一句</a></section>)}</details>
        <button type="button" className="book-delete" onClick={() => void remove(entry)}>删除条目</button>
      </article>)}</div> : <div className="book-empty">{entries.length ? '没有符合这些分类的条目，调整筛选再试' : '还没有条目。在翻译框点击「加入」或「加入整句」开始记录。'}</div>}
  </main>;
}
