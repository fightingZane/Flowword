import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import type { WordbookEntry } from '../../src/core/types';
import { SaveEntryForm, PARTS, EXAM_TAGS } from '../../src/ui/SaveEntryForm';
import { FlowMark } from '../../src/ui/Icons';
import { ReviewSession } from '../../src/ui/ReviewSession';
import { BACKUP_LIMITS, videoDisplayMetadata, videoSourceLink, type ArchiveContext } from '../../src/storage/archive';

const THEMES = [['light', '薄雾森林'], ['dark', '午夜墨绿'], ['warm', '焦糖奶茶'], ['blue', '深海蓝调'], ['lavender', '紫藤花园'], ['rose', '玫瑰信笺'], ['sunset', '落日橘光'], ['mint', '薄荷冰川']];
const STATUS = [['new', '新收藏'], ['learning', '学习中'], ['mastered', '已掌握']];
interface VideoSummary { id: string; url: string; title: string; updatedAt: number; count: number; thumbnail?: string }
interface Occurrence { id: string; translation: string; capture: ArchiveContext & { id: string; videoId: string } }
interface Summary { videos: VideoSummary[]; total: number; parts: string[]; tags: string[]; counts?: { word: number; phrase: number; sentence: number } }

// request 表示可信词本后台请求，type 是消息类型，payload 是对应的输入字段
// 统一把失败转为异常，调用方必须显示错误，不直接读写数据库以避免并发绕过后台
async function request(type: string, payload: Record<string, unknown> = {}) {
  const result = await browser.runtime.sendMessage({ type, ...payload });
  if (!result?.ok) throw new Error(result?.error || '操作未完成，请重试');
  return result;
}
// clock 表示来源秒数的显示格式，time 是视频时间，不是收藏日期
// 对未知值按零处理，只用于文案，跳转仍使用保存的精确时间
export function clock(time: number): string { const seconds = Math.max(0, Math.floor(Number.isFinite(time) ? time : 0)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
// briefTitle 表示来源简称，title 是原视频标题，max 是显示字符上限
// 只缩短可见文案，完整标题通过 title 属性保留，不改变归档资料
export function briefTitle(title: string, max = 35): string { return title.length > max ? title.slice(0, max - 1) + '…' : title; }

// VideoItem 表示视频资料项，source 提供元数据，selected 标记当前分组，onSelect 切换视频
// thumbnails 是用户封面开关，只有接近可视区域才装载 YouTube 图像，失败显示占位
function VideoItem({ source, selected, thumbnails, onSelect }: { source: VideoSummary; selected: boolean; thumbnails: boolean; onSelect(): void }) {
  const cover = useRef<HTMLDivElement>(null); const [nearby, setNearby] = useState(false); const [failed, setFailed] = useState(false);
  const metadata = videoDisplayMetadata(source);
  useEffect(() => {
    if (!cover.current || !thumbnails) return;
    const observer = new IntersectionObserver((records) => { if (records.some((record) => record.isIntersecting)) { setNearby(true); observer.disconnect(); } }, { rootMargin: '60px' });
    observer.observe(cover.current); return () => observer.disconnect();
  }, [thumbnails]);
  return <article className="book-video" data-selected={selected}><button className="book-video-select" type="button" aria-pressed={selected} aria-label={`查看视频：${source.title}`} onClick={onSelect}>
    <div className="book-video-cover" ref={cover}>{metadata.thumbnail && thumbnails && nearby && !failed ? <img src={metadata.thumbnail} alt={`${source.title} 视频封面`} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span aria-hidden="true">▷</span>}<span className="book-video-site">{metadata.site}</span></div>
    <strong title={source.title}>{briefTitle(source.title, 65)}</strong><span className="book-video-meta">{source.count} 条收藏 · {new Date(source.updatedAt).toLocaleDateString('zh-CN')}</span>
  </button><div className="book-video-links"><a href={source.url} target="_blank" rel="noreferrer">来源 ↗</a>{failed && thumbnails && <span>封面暂不可用</span>}</div></article>;
}

// OccurrenceSources 表示某条词句来源，entryId 为词本键，videoId 可限制视频，onChanged 通知更新
// 展开才查询语境，不读取全部归档，编辑只修改所选语境释义
function OccurrenceSources({ entryId, videoId, onChanged }: { entryId: string; videoId?: string; onChanged(): void }) {
  const [items, setItems] = useState<Occurrence[]>([]); const [loaded, setLoaded] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [editing, setEditing] = useState(''); const [meaning, setMeaning] = useState(''); const operation = useRef(0);
  useEffect(() => { operation.current++; setLoaded(false); setItems([]); setEditing(''); }, [entryId, videoId]);
  // load 表示读取本条来源，无参数，重复展开复用结果，不读取整个归档
  async function load() {
    if (loaded || busy) return; const current = ++operation.current; setBusy(true); setError('');
    try { const result = await request('FLOWWORD_BOOK_OCCURRENCES', { id: entryId, videoId }); if (current === operation.current) { setItems(result.occurrences); setLoaded(true); } }
    catch (failure) { setError(failure instanceof Error ? failure.message : '来源读取失败'); } finally { setBusy(false); }
  }
  // saveMeaning 表示保存当前语境中文，无参数，只提交 editing 对应关联，不覆盖同词其他来源
  async function saveMeaning() {
    setBusy(true); setError('');
    try { const result = await request('FLOWWORD_OCCURRENCE_UPDATE', { id: editing, translation: meaning }); setItems((previous) => previous.map((item) => item.id === editing ? { ...item, translation: result.occurrence.translation } : item)); setEditing(''); onChanged(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '语境保存失败'); } finally { setBusy(false); }
  }
  // replay 表示听力回顾，source 为保存的视频时间及原句，后台负责权限和定位校验
  async function replay(source: ArchiveContext) { try { await request('FLOWWORD_REPLAY_SOURCE', { source }); } catch (failure) { setError(failure instanceof Error ? failure.message : '来源无法播放'); } }
  return <details className="book-occurrences" onToggle={(event) => { if (event.currentTarget.open) void load(); }}><summary>查看来源语境</summary>{error && <p role="alert">{error}</p>}{busy && !loaded && <p>正在读取语境…</p>}{loaded && !items.length && <p>这条收藏没有保存来源</p>}
    {items.map((item) => <section className="book-source" key={item.id}><strong>{item.capture.title || new URL(item.capture.url).hostname} · {clock(item.capture.time)}</strong><p lang="en">{item.capture.sentence}</p>{item.capture.translation && <p>{item.capture.translation}</p>}
      {editing === item.id ? <div className="book-meaning-editor"><label>当前语境释义<textarea aria-label="当前语境释义" value={meaning} maxLength={6000} onChange={(event) => setMeaning(event.target.value)} /></label><button type="button" disabled={busy} onClick={() => void saveMeaning()}>保存这条语境</button><button type="button" disabled={busy} onClick={() => setEditing('')}>取消</button></div> : <><p>该语境释义：{item.translation || '未填写'}</p><button type="button" onClick={() => { setEditing(item.id); setMeaning(item.translation); }}>编辑这条语境释义</button></>}
      <div className="book-source-actions"><button type="button" onClick={() => void replay(item.capture)}>听原句 ↗</button><a href={videoSourceLink(item.capture)} target="_blank" rel="noreferrer">回到视频这一句</a></div>
    </section>)}
  </details>;
}

// Wordbook 表示完整学习档案，无参数，以后台索引分页读取收藏与视频摘要
// 所有写入交给后台事务，主题与布局本地保存，列表不加载整个语境库
export function Wordbook() {
  const [entries, setEntries] = useState<WordbookEntry[]>([]); const [total, setTotal] = useState(0); const [summary, setSummary] = useState<Summary>({ videos: [], total: 0, parts: [], tags: [] });
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<WordbookEntry | null>(null); const [filters, setFilters] = useState({ search: '', kind: '', part: '', exam: '', tag: '', status: '' });
  const [sort, setSort] = useState('recent'); const [theme, setTheme] = useState('dark'); const [layout, setLayout] = useState('auto'); const [thumbnails, setThumbnails] = useState(true); const [preferencesReady, setPreferencesReady] = useState(false);
  const [video, setVideo] = useState(''); const [sidebarCollapsed, setSidebarCollapsed] = useState(false); const [offset, setOffset] = useState(0); const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set()); const [batchOpen, setBatchOpen] = useState(false); const [batch, setBatch] = useState({ partOfSpeech: '', tags: '', examTags: '', status: '' });
  const [undoToken, setUndoToken] = useState(''); const [reviewing, setReviewing] = useState(false); const fileInput = useRef<HTMLInputElement>(null); const requestId = useRef(0); const limit = 40;
  useLayoutEffect(() => { document.documentElement.dataset.bookTheme = theme; }, [theme]);
  useEffect(() => {
    void browser.storage.local.get(['flowword-book-theme', 'flowword-book-layout.v1', 'flowword-book-thumbnails.v1']).then((stored) => {
      if (THEMES.some(([id]) => id === stored['flowword-book-theme'])) setTheme(String(stored['flowword-book-theme']));
      if (['list', 'cards', 'auto'].includes(String(stored['flowword-book-layout.v1']))) setLayout(String(stored['flowword-book-layout.v1']));
      if (typeof stored['flowword-book-thumbnails.v1'] === 'boolean') setThumbnails(stored['flowword-book-thumbnails.v1']);
    }).catch(() => setThumbnails(false)).finally(() => setPreferencesReady(true));
    // refresh 表示词本变更通知，无参数，只重取摘要与当前页，不扫描归档
    const refresh = () => setRevision((previous) => previous + 1);
    // changed 表示扩展消息，message 只有词本更新类型才触发刷新
    const changed = (message: unknown) => { if (message && typeof message === 'object' && 'type' in message && message.type === 'FLOWWORD_BOOK_CHANGED') refresh(); };
    browser.runtime.onMessage.addListener(changed); window.addEventListener('focus', refresh);
    return () => { browser.runtime.onMessage.removeListener(changed); window.removeEventListener('focus', refresh); };
  }, []);
  useEffect(() => {
    let active = true;
    void request('FLOWWORD_BOOK_SUMMARY').then((result) => { if (active) setSummary({ videos: result.videos || [], total: result.total || 0, parts: result.parts || [], tags: result.tags || [], counts: result.counts }); }).catch((failure) => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, [revision]);
  useEffect(() => {
    const current = ++requestId.current; setLoading(true);
    const timer = setTimeout(() => { void request('FLOWWORD_BOOK_QUERY', { query: { ...filters, videoId: video || undefined, sort, offset, limit } }).then((result) => {
      if (current !== requestId.current) return;
      if (!result.entries.length && result.total > 0 && offset >= result.total) { setOffset(Math.max(0, Math.floor((result.total - 1) / limit) * limit)); return; }
      setEntries(result.entries); setTotal(result.total); setSelected((previous) => new Set([...previous].filter((id) => result.entries.some((entry: WordbookEntry) => entry.id === id))));
    }).catch((failure) => { if (current === requestId.current) setError(failure.message); }).finally(() => { if (current === requestId.current) setLoading(false); }); }, filters.search ? 180 : 0);
    return () => { clearTimeout(timer); requestId.current++; };
  }, [filters, video, sort, offset, revision]);
  // updateFilter 表示修改筛选项，key 为筛选字段，value 为用户选择，改变后回第一页
  function updateFilter(key: keyof typeof filters, value: string) { setFilters((previous) => ({ ...previous, [key]: value })); setOffset(0); setSelected(new Set()); }
  // chooseVideo 表示切换视频分组，id 为空查看全部，视频内默认按原时间排序
  function chooseVideo(id: string) { setVideo(id); setOffset(0); setSelected(new Set()); if (id) setSort('time'); }
  // reload 表示写入后刷新，无参数，保留分页筛选并更新摘要
  function reload() { setRevision((previous) => previous + 1); }
  // save 表示条目编辑，entry 含原键和原更新时间，用于后台冲突检测
  async function save(entry: WordbookEntry) { await request('FLOWWORD_BOOK_SAVE', { entry, replaceId: entry.id }); setEditing(null); reload(); }
  // remove 表示删除所选，ids 是当前页明确选中的键，后台返回可撤销凭据
  async function remove(ids: string[]) {
    if (!ids.length || busy) return; setBusy(true); setError('');
    try { const result = await request('FLOWWORD_BOOK_DELETE_MANY', { ids }); setUndoToken(result.undoToken); setNotice(`已删除 ${result.deleted} 条收藏，可撤销`); setSelected(new Set()); reload(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '删除失败'); } finally { setBusy(false); }
  }
  // undo 表示撤销上次删除，无参数，后台不会覆盖后来同名重新收藏的资料
  async function undo() { setBusy(true); try { const result = await request('FLOWWORD_BOOK_UNDO', { token: undoToken }); setUndoToken(''); setNotice(`已恢复 ${result.restored} 条收藏`); reload(); } catch (failure) { setError(failure instanceof Error ? failure.message : '撤销失败'); } finally { setBusy(false); } }
  // applyBatch 表示批量替换明确填写的分类，无参数，空白字段保持原值
  async function applyBatch() {
    if (!selected.size) return; setBusy(true); setError(''); const patch: Record<string, unknown> = {};
    if (batch.partOfSpeech) patch.partOfSpeech = batch.partOfSpeech; if (batch.status) patch.status = batch.status;
    if (batch.tags.trim()) patch.tags = batch.tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean); if (batch.examTags.trim()) patch.examTags = batch.examTags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
    try { const result = await request('FLOWWORD_BOOK_BATCH', { ids: [...selected], patch }); setNotice(`已更新 ${result.updated} 条收藏`); setBatchOpen(false); setSelected(new Set()); reload(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '批量保存失败'); } finally { setBusy(false); }
  }
  // exportBook 表示下载备份，onlyVideo 为真时只包含当前视频关联，后台返回一致快照
  async function exportBook(onlyVideo = false) {
    setBusy(true); setError('');
    try { const result = await request('FLOWWORD_BOOK_EXPORT', { query: onlyVideo ? { videoId: video } : {} }); const url = URL.createObjectURL(new Blob([JSON.stringify(result.backup, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = onlyVideo ? 'FlowWord-视频收藏.json' : 'FlowWord-单词本.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '导出失败'); } finally { setBusy(false); }
  }
  // importBook 表示后台原子导入，file 是用户选择的 JSON，解析失败不提交
  // 导入期间锁定入口，结构和容量上限由后台校验，不在界面静默截断
  async function importBook(file?: File) {
    if (!file || busy) return; setBusy(true); setError('');
    try { if (file.size > BACKUP_LIMITS.bytes) throw new Error(`备份超过 ${BACKUP_LIMITS.bytes / 1024 / 1024} MB 上限，请使用按视频备份`); const result = await request('FLOWWORD_BOOK_IMPORT', { backup: JSON.parse(await file.text()) }); setNotice(`已导入 ${result.imported} 条收藏`); reload(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '导入失败'); } finally { setBusy(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  // setStatus 表示单条学习状态更新，entry 为当前条目，status 是状态枚举
  async function setStatus(entry: WordbookEntry, status: string) { try { await request('FLOWWORD_BOOK_BATCH', { ids: [entry.id], patch: { status } }); reload(); } catch (failure) { setError(failure instanceof Error ? failure.message : '状态保存失败'); } }
  const selectedVideo = summary.videos.find((source) => source.id === video); const actualLayout = layout === 'auto' ? total <= 12 ? 'list' : 'cards' : layout;
  const parts = [...new Set([...PARTS, ...summary.parts, ...entries.map((entry) => entry.partOfSpeech)])]; const tags = [...new Set([...summary.tags, ...entries.flatMap((entry) => entry.tags)])].sort();
  return <main className="book fw-app" style={{ '--fw-font': '16px' } as React.CSSProperties} data-theme={theme} data-sidebar-collapsed={sidebarCollapsed} data-layout={actualLayout}>
    <header className="book-header"><div><FlowMark size={32} /><span>FlowWord <small>学习档案 · 单词本</small></span></div><div className="book-actions"><select aria-label="单词本主题" value={theme} onChange={(event) => { setTheme(event.target.value); void browser.storage.local.set({ 'flowword-book-theme': event.target.value }); }}>{THEMES.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select><button type="button" disabled={busy} onClick={() => fileInput.current?.click()}>导入备份</button><input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(event) => void importBook(event.target.files?.[0])} /><button type="button" disabled={busy} className="fw-primary" onClick={() => void exportBook()}>导出单词本</button></div></header>
    <div className="book-layout"><aside className="book-sidebar" aria-label="视频资料栏"><div className="book-sidebar-heading"><span>视频资料</span><button type="button" aria-label={sidebarCollapsed ? '展开视频资料栏' : '收起视频资料栏'} aria-expanded={!sidebarCollapsed} onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>{sidebarCollapsed ? '☰' : '‹'}</button></div>
      {!sidebarCollapsed && <><button className="book-all" type="button" aria-pressed={!video} onClick={() => chooseVideo('')}><span>全部收藏</span><strong>{summary.total}</strong></button><button className="book-review-entry" type="button" onClick={() => setReviewing(true)}>词句复习</button><nav className="book-video-list" aria-label="学习视频">{summary.videos.map((source) => <VideoItem key={source.id} source={source} selected={video === source.id} thumbnails={thumbnails && preferencesReady} onSelect={() => chooseVideo(source.id)} />)}</nav>{!summary.videos.length && <p className="book-sidebar-empty">收藏视频中的词句后<br />在这里按视频查看</p>}</>}
    </aside><div className="book-content">{reviewing ? <ReviewSession videoId={video || undefined} onClose={() => { setReviewing(false); reload(); }} /> : <>
      <section className="book-overview"><div><h1>{selectedVideo?.title || '全部收藏'}</h1><p className="book-subtitle">{selectedVideo ? `${videoDisplayMetadata(selectedVideo).site} · 按视频时间整理词句` : '词句、来源与复习进度'}</p></div><div className="book-stats"><span><strong>{summary.counts?.word ?? '—'}</strong>单词</span><span><strong>{summary.counts?.phrase ?? '—'}</strong>表达</span><span><strong>{summary.counts?.sentence ?? '—'}</strong>整句</span></div></section>
      <div className="book-search"><input aria-label="搜索单词本" placeholder="搜索词句、译文、标签或视频标题" value={filters.search} onChange={(event) => updateFilter('search', event.target.value)} /><span>{total} 条结果</span></div>
      <div className="book-view-toolbar"><label>显示<select aria-label="词本显示方式" value={layout} onChange={(event) => { setLayout(event.target.value); void browser.storage.local.set({ 'flowword-book-layout.v1': event.target.value }); }}><option value="auto">自动 · 少量优先列表</option><option value="list">紧凑列表</option><option value="cards">卡片</option></select></label><button type="button" onClick={() => setReviewing(true)}>开始复习</button>{video && <button type="button" disabled={busy} onClick={() => void exportBook(true)}>导出当前视频</button>}</div>
      <details className="book-filter-panel" open><summary>分类与排序</summary><section className="book-filters" aria-label="单词本筛选"><label className="book-thumbnail-option"><input type="checkbox" aria-label="自动加载视频封面" checked={thumbnails} onChange={(event) => { setThumbnails(event.target.checked); void browser.storage.local.set({ 'flowword-book-thumbnails.v1': event.target.checked }); }} />显示视频封面</label>
        <select aria-label="条目类型筛选" value={filters.kind} onChange={(event) => updateFilter('kind', event.target.value)}><option value="">全部条目</option><option value="word">单词</option><option value="phrase">短语</option><option value="sentence">语句</option></select>
        <select aria-label="学习状态筛选" value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}><option value="">全部学习状态</option>{STATUS.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select>
        <select aria-label="词汇类型筛选" value={filters.part} onChange={(event) => updateFilter('part', event.target.value)}><option value="">全部词汇类型</option>{parts.map((part) => <option key={part}>{part}</option>)}</select>
        <select aria-label="考点筛选" value={filters.exam} onChange={(event) => updateFilter('exam', event.target.value)}><option value="">全部考点 / 考试</option>{EXAM_TAGS.map((tag) => <option key={tag}>{tag}</option>)}</select>
        <select aria-label="标签筛选" value={filters.tag} onChange={(event) => updateFilter('tag', event.target.value)}><option value="">全部自定义标签</option>{tags.map((tag) => <option key={tag}>{tag}</option>)}</select>
        <select className="book-sr-only" aria-label="视频分组" value={video} onChange={(event) => chooseVideo(event.target.value)}><option value="">全部视频</option>{summary.videos.map((source) => <option key={source.id} value={source.id}>{source.title}</option>)}</select>
        <select aria-label="排序方式" value={sort} onChange={(event) => { setSort(event.target.value); setOffset(0); }}><option value="recent">最近加入</option><option value="alphabet">字母顺序</option><option value="kind">条目类型</option><option value="time">视频时间顺序</option></select>
      </section></details>
      <div className="book-batch-toolbar"><label><input type="checkbox" aria-label="选择当前页全部条目" checked={entries.length > 0 && selected.size === entries.length} onChange={(event) => setSelected(event.target.checked ? new Set(entries.map((entry) => entry.id)) : new Set())} />本页全选</label><span>已选 {selected.size} 条</span><button type="button" disabled={!selected.size || busy} onClick={() => setBatchOpen(!batchOpen)}>批量分类</button><button type="button" disabled={!selected.size || busy} onClick={() => void remove([...selected])}>删除所选</button></div>
      {batchOpen && <section className="book-batch-editor" aria-label="批量分类"><p>填写字段替换所选条目的对应分类，空白保持原值</p><label>词汇类型<select aria-label="批量词汇类型" value={batch.partOfSpeech} onChange={(event) => setBatch({ ...batch, partOfSpeech: event.target.value })}><option value="">保持原值</option>{parts.map((part) => <option key={part}>{part}</option>)}</select></label><label>学习状态<select aria-label="批量学习状态" value={batch.status} onChange={(event) => setBatch({ ...batch, status: event.target.value })}><option value="">保持原值</option>{STATUS.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label><label>自定义标签<input aria-label="批量自定义标签" value={batch.tags} onChange={(event) => setBatch({ ...batch, tags: event.target.value })} placeholder="逗号分隔" /></label><label>考点标签<input aria-label="批量考点标签" value={batch.examTags} onChange={(event) => setBatch({ ...batch, examTags: event.target.value })} placeholder="逗号分隔" /></label><button type="button" disabled={busy} onClick={() => void applyBatch()}>应用到所选条目</button><button type="button" onClick={() => setBatchOpen(false)}>取消</button></section>}
      <p className="book-count">显示 {total ? offset + 1 : 0}–{Math.min(offset + entries.length, total)} / {total} 条</p>{error && <p role="alert">{error}</p>}{notice && <div className="book-notice" role="status">{notice}{undoToken && <button type="button" disabled={busy} onClick={() => void undo()}>撤销删除</button>}</div>}
      {editing ? <section className="book-editor"><SaveEntryForm key={editing.id} draft={editing} onSave={save} onCancel={() => setEditing(null)} /></section> : loading && !entries.length ? <p>正在读取本地单词本…</p> : entries.length ? <div className="book-grid">{entries.map((entry) => {
        const source = video ? entry.contexts.find((context) => context.videoKey === video || context.url === selectedVideo?.url) : entry.contexts.at(-1);
        const status = (entry as WordbookEntry & { status?: string }).status || 'new';
        return <article className="book-card" key={entry.id}><div className="book-card-meta"><label className="book-select-entry"><input type="checkbox" aria-label={`选择 ${entry.text}`} checked={selected.has(entry.id)} onChange={(event) => setSelected((previous) => { const next = new Set(previous); if (event.target.checked) next.add(entry.id); else next.delete(entry.id); return next; })} /><span>{entry.kind === 'word' ? '单词' : entry.kind === 'phrase' ? '短语' : '语句'} · {entry.partOfSpeech}</span></label><button type="button" onClick={() => setEditing(entry)}>编辑分类</button></div><div className="book-card-main"><div><h2 lang="en">{entry.text}</h2><p className="book-entry-meaning">{entry.translation || '暂无译文，可在编辑中补充自己的理解'}</p></div><select className="book-entry-status" aria-label={`学习状态 ${entry.text}`} value={status} onChange={(event) => void setStatus(entry, event.target.value)}>{STATUS.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></div>
          {source && <a className="book-direct-source" title={source.title || source.url} href={videoSourceLink(source)} target="_blank" rel="noreferrer">▷ {briefTitle(source.title || new URL(source.url).hostname)} · {clock(source.time)}</a>}
          <div className="book-tags">{[...new Set([...entry.examTags, ...entry.tags])].map((tag) => <span key={tag}>{tag}</span>)}</div><OccurrenceSources key={`${entry.id}:${video}`} entryId={entry.id} videoId={video || undefined} onChanged={reload} /><button type="button" disabled={busy} className="book-delete" onClick={() => void remove([entry.id])}>删除条目</button>
        </article>;
      })}</div> : <div className="book-empty">{summary.total ? '没有符合这些分类的条目，调整筛选再试' : '还没有条目，在翻译框收藏词句开始记录'}</div>}
      {total > limit && <nav className="book-pagination" aria-label="词本分页"><button type="button" disabled={!offset || loading} onClick={() => setOffset(Math.max(0, offset - limit))}>上一页</button><span>{Math.floor(offset / limit) + 1} / {Math.ceil(total / limit)}</span><button type="button" disabled={offset + limit >= total || loading} onClick={() => setOffset(offset + limit)}>下一页</button></nav>}
      </>}
    </div></div>
  </main>;
}
