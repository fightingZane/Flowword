import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { DEFAULT_SELECTION_LAYOUT, SELECTION_LAYOUT_KEY, sanitizeSelectionLayout, saveSelectionLayout, type SelectionLayout } from '../storage/selection-layout';
import { hasMeaning, hasSourceSpan } from '../core/learning-view';
import { capturePageSelection, selectionNodeExcluded, selectionPlacement, type PageSelection } from '../core/selection';
import type { Theme, WordbookEntry } from '../core/types';
import type { ContextExpression } from '../services/cloud';
import { requestLearningMessage } from '../services/learning';
import { SaveEntryForm } from './SaveEntryForm';
import { EmbeddedSettings } from './EmbeddedSettings';
import { QuickWordbook } from './QuickWordbook';
interface Result { translation?: string; expressions: ContextExpression[]; translating: boolean; explaining: boolean; error?: string; contextError?: string; cached?: boolean }
// SelectionApp 为已授权页面提供选区工具条，enabled控制采样，fontSize仅影响本浮层，不读取输入框或整页正文
export function SelectionApp({ enabled, autoTranslate = false, pageUrl, fontSize = 16, theme = 'auto', requestedPanel }: { enabled: boolean; autoTranslate?: boolean; pageUrl: string; fontSize?: number; theme?: Theme; requestedPanel?: { view: 'provider' | 'book' | 'scope'; revision: number } }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragPosition, setDragPosition] = useState<{ left: number; top: number } | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved?: boolean } | null>(null);
  const resize = useRef<{ x: number; y: number; width: number; height: number; left: number; top: number } | null>(null);
  const [layout, setLayout] = useState<SelectionLayout>(DEFAULT_SELECTION_LAYOUT);
  const layoutRef = useRef(layout); layoutRef.current = layout;
  const geometryRevision = useRef(0);
  useEffect(() => { let active = true; const revision = geometryRevision.current; void browser.storage.local.get(SELECTION_LAYOUT_KEY).then((stored) => { if (active && revision === geometryRevision.current) setLayout(sanitizeSelectionLayout(stored[SELECTION_LAYOUT_KEY])); }).catch(() => {}); return () => { active = false; }; }, []);
  const flights = useRef<{ translate?: AbortController; context?: AbortController }>({});
  const [auxiliary, setAuxiliary] = useState<'provider' | 'book' | 'scope' | null>(null);
  const [picked, setPicked] = useState<PageSelection | null>(null);
  const [expanded, setExpanded] = useState(false); const [pinned, setPinned] = useState(false);
  const expandedRef = useRef(expanded); expandedRef.current = expanded;
  const [result, setResult] = useState<Result>({ expressions: [], translating: false, explaining: false });
  const [draft, setDraft] = useState<WordbookEntry | null>(null); const [notice, setNotice] = useState('');
  const [saved, setSaved] = useState<string[]>([]); const [viewport, setViewport] = useState({ width: innerWidth, height: innerHeight });
  const pickedRef = useRef<PageSelection | null>(null); const pinRef = useRef(false); const dismissed = useRef(''); const operation = useRef<AbortController | null>(null);
  const previousUrl = useRef(pageUrl);
  const selectionVersion = useRef(0);
  const panelRef = useRef<HTMLElement | null>(null); const [panelHeight, setPanelHeight] = useState(52);
  useLayoutEffect(() => { const height = panelRef.current?.getBoundingClientRect().height; if (height) setPanelHeight((previous) => Math.abs(previous - height) > 1 ? height : previous); }, [picked, expanded, auxiliary, draft, result, viewport, fontSize, pinned, menuOpen, notice, layout]);
  // close 关闭本选区并取消其订阅，无参数，不影响其他标签或视频的共享译文
  function close() { selectionVersion.current++; if (pickedRef.current) dismissed.current = pickedRef.current.text + ':' + Math.round(pickedRef.current.rect.left) + ':' + Math.round(pickedRef.current.rect.top); operation.current?.abort(); pickedRef.current = null; pinRef.current = false; setPinned(false); setPicked(null); setDraft(null); setExpanded(false); setAuxiliary(null); setMenuOpen(false); setDragPosition(null); }
  useEffect(() => { if (previousUrl.current !== pageUrl) { previousUrl.current = pageUrl; close(); dismissed.current = ''; } }, [pageUrl]);
  useEffect(() => { if (enabled && requestedPanel) { operation.current?.abort(); setAuxiliary(requestedPanel.view); pinRef.current = true; setPinned(true); } }, [requestedPanel?.revision, enabled]);
  useEffect(() => {
    if (!enabled) { close(); return; }
    let timer: ReturnType<typeof setTimeout> | undefined; let dragging = false; let gestureAt = 0;
    // capture 采样稳定真实Range，无参数，新选区替换时先取消旧网络，固定只约束位置，新选区仍更新内容
    const capture = () => {
      if (dragging || selectionNodeExcluded(document.activeElement) && document.activeElement?.tagName !== 'BODY') return;
      const current = capturePageSelection(window.getSelection(), { width: innerWidth, height: innerHeight }, { url: location.href, title: document.title });
      if (!current) { if (pickedRef.current && !pinRef.current) close(); return; }
      const signature = current.text + ':' + Math.round(current.rect.left) + ':' + Math.round(current.rect.top);
      if (signature === dismissed.current || pickedRef.current?.text === current.text && pickedRef.current.range.startContainer === current.range.startContainer && pickedRef.current.range.startOffset === current.range.startOffset && pickedRef.current.range.endOffset === current.range.endOffset) return;
      const followFixed = pinRef.current && expandedRef.current;
      selectionVersion.current++; operation.current?.abort(); pickedRef.current = current; setPicked(current); if (layoutRef.current.fixed) { pinRef.current = true; setPinned(true); } setMenuOpen(false); setDragPosition(null); setAuxiliary(null); setExpanded(false); setDraft(null); setNotice(''); setSaved([]); setResult({ expressions: [], translating: false, explaining: false });
      if ((autoTranslate || followFixed) && gestureAt && Date.now() - gestureAt < 800) { gestureAt = 0; void translate(); }
    };
    // schedule 等待选区稳定，键鼠事件仅触发本地采样，不触发联网
    const schedule = () => { clearTimeout(timer); timer = setTimeout(capture, 140); };
    // outsideDown 处理页面按下，event路径含插件时保留原文高亮，外部操作关闭未固定浮层
    const outsideDown = (event: PointerEvent) => { if (event.composedPath().some((node) => node instanceof Element && ['FLOWWORD-SELECTION-UI','FLOWWORD-UI'].includes(node.tagName))) return; dragging = true; if (!pinRef.current) { close(); dismissed.current = ''; } };
    // released 结束鼠标或触摸选择，无参数，只在松开并稳定后展示工具条
    const released = (event: Event) => { dragging = false; if (event.isTrusted) gestureAt = Date.now(); schedule(); };
    // keyboard 处理Esc和键盘选择，event来自真实页面，固定状态仍允许显式关闭
    const keyboard = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); else if (event.shiftKey || ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) { dismissed.current = ''; if (event.isTrusted) gestureAt = Date.now(); schedule(); } };
    // reposition 在滚动和视窗变化后重新读取原Range，event若来自本浮层滚动则忽略
    const reposition = (event: Event) => {
      if (event.composedPath().some((node) => node instanceof Element && node.tagName === 'FLOWWORD-SELECTION-UI')) return;
      setViewport({ width: innerWidth, height: innerHeight }); const current = pickedRef.current; if (!current) return;
      if (!current.range.startContainer.isConnected) { if (!pinRef.current) close(); return; }
      const rect = current.range.getBoundingClientRect(); if (rect.width > 0 && rect.height > 0) { const next = { ...current, rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height } }; pickedRef.current = next; setPicked(next); }
    };
    document.addEventListener('selectionchange', schedule); document.addEventListener('pointerdown', outsideDown, true); document.addEventListener('pointerup', released); document.addEventListener('mouseup', released); document.addEventListener('keyup', keyboard); window.addEventListener('scroll', reposition, true); window.addEventListener('resize', reposition); window.addEventListener('pagehide', close); window.addEventListener('pageshow', close);
    return () => { clearTimeout(timer); operation.current?.abort(); document.removeEventListener('selectionchange', schedule); document.removeEventListener('pointerdown', outsideDown, true); document.removeEventListener('pointerup', released); document.removeEventListener('mouseup', released); document.removeEventListener('keyup', keyboard); window.removeEventListener('scroll', reposition, true); window.removeEventListener('resize', reposition); window.removeEventListener('pagehide', close); window.removeEventListener('pageshow', close); };
  }, [enabled, autoTranslate]);
  // translate 仅在用户显式点击时分析当前选区，无参数，发送选中文字与同TextNode的短语境而非URL或整页
  async function translate(task: 'both' | 'translate' | 'context' = 'both') {
    const current = pickedRef.current; if (!current) return; if (location.href !== current.url) { close(); return; }
    if (task === 'both' || !operation.current || operation.current.signal.aborted) { operation.current?.abort(); operation.current = new AbortController(); }
    const lifecycle = operation.current.signal; setExpanded(true); setAuxiliary(null); setMenuOpen(false); setDraft(null);
    if (task === 'both') setResult({ expressions: [], translating: true, explaining: false });
    else setResult((previous) => task === 'context' ? { ...previous, explaining: true, contextError: undefined } : { ...previous, translating: true, error: undefined });
    const signals: { translate?: AbortSignal; context?: AbortSignal } = {};
    for (const name of task === 'both' ? ['translate', 'context'] as const : [task]) { flights.current[name]?.abort(); const child = new AbortController(); flights.current[name] = child; signals[name] = AbortSignal.any([lifecycle, child.signal]); }
    try {
      const info = await browser.runtime.sendMessage({ type: 'FLOWWORD_PROVIDER_PUBLIC' }); if (lifecycle.aborted || location.href !== current.url) return;
      const translateActive = task !== 'context' && !signals.translate?.aborted; const contextActive = task !== 'translate' && !signals.context?.aborted; if (!translateActive && !contextActive) return;
      if (contextActive) setResult((previous) => ({ ...previous, explaining: (info.mode === 'cloud' || info.mode === 'codex-cli') }));
      await Promise.all([
        translateActive ? requestLearningMessage({ type: 'FLOWWORD_TRANSLATE', sentence: current.text, context: current.context }, signals.translate!).then((response) => { if (signals.translate!.aborted) return; if (!response?.ok || !response.translation) throw new Error(response?.error || '暂无有效中文译文'); setResult((previous) => ({ ...previous, translation: response.translation, translating: false, cached: response.cached === true })); }).catch((error) => { if (!signals.translate!.aborted) setResult((previous) => ({ ...previous, translating: false, error: error instanceof Error ? error.message : '翻译失败' })); }) : Promise.resolve(),
        contextActive && (info.mode === 'cloud' || info.mode === 'codex-cli') ? requestLearningMessage({ type: 'FLOWWORD_CONTEXT', sentence: current.text, context: current.context }, signals.context!).then((response) => { if (signals.context!.aborted) return; if (!response?.ok) throw new Error(response?.error || '语境释义暂不可用'); setResult((previous) => ({ ...previous, expressions: (response.expressions ?? []).filter((item: ContextExpression) => hasMeaning(item.meaning) && hasSourceSpan(current.text, item.text)), explaining: false })); }).catch((error) => { if (!signals.context!.aborted) setResult((previous) => ({ ...previous, explaining: false, contextError: error instanceof Error ? error.message : '语境分析失败' })); }) : Promise.resolve(),
      ]);
      if (contextActive && task === 'context' && (info.mode !== 'cloud' && info.mode !== 'codex-cli')) setResult((previous) => ({ ...previous, contextError: '请先配置云端语境模型', explaining: false }));
    } catch (error) { if (!lifecycle.aborted) setResult((previous) => task === 'context' ? { ...previous, explaining: false, contextError: error instanceof Error ? error.message : '服务暂不可用' } : { ...previous, translating: false, error: error instanceof Error ? error.message : '服务暂不可用' }); }
  }  // collect 创建本地网页收藏草稿，text与meaning来自当前选区或已验证表达，无虚构视频时间戳
  function collect(text: string, meaning: string, part = '未分类', expressionKind?: 'word' | 'phrase') {
    const current = pickedRef.current; if (!current) return; if (location.href !== current.url) { close(); return; }
    const kind = expressionKind ?? (/[.!?]["'”’)]?$/.test(text) ? 'sentence' : text.split(/\s+/).length === 1 ? 'word' : 'phrase');
    const now = Date.now();
    const sentence = current.context[0] ?? current.text;
    setDraft({ id: '', kind, text, lemma: text, translation: meaning, partOfSpeech: part, tags: [], examTags: [], createdAt: now, updatedAt: now, contexts: [{ source: { kind: 'web', quote: { exact: text === current.text ? current.exact : text } }, url: current.url, title: current.title, sentence, ...(sentence.replace(/\s+/g, ' ').trim() === current.text ? { translation: result.translation } : {}) }] }); setExpanded(true);
  }
  // save 写入用户确认分类后的entry，不调用模型，后台负责验证网页来源并广播词本变化
  async function save(entry: WordbookEntry) { const version = selectionVersion.current; const response = await browser.runtime.sendMessage({ type: 'FLOWWORD_BOOK_SAVE', entry }); if (!response?.ok) throw new Error(response?.error || '保存失败'); if (version !== selectionVersion.current) return; setSaved((previous) => [...previous, entry.text]); setDraft(null); setNotice('已加入单词本'); }
  // copy 复制用户点击的text，无网络，剪贴板失败时保留浮层便于手动选择
  async function copy(text: string) { const version = selectionVersion.current; try { await navigator.clipboard.writeText(text); if (version === selectionVersion.current) setNotice('已复制'); } catch { if (version === selectionVersion.current) setNotice('复制失败，请手动选择文本'); } }
  if (!enabled || !picked && !auxiliary) return null;
  const full = expanded || !!auxiliary;
  const anchor = picked?.rect ?? { left: viewport.width - 440, top: 30, right: viewport.width - 30, bottom: 30, width: 410, height: 0 };
  const placement = selectionPlacement(anchor, viewport, { width: full ? layout.width : 244, height: full ? layout.height ?? panelHeight : panelHeight });
  const fixedPosition = dragPosition ?? (layout.fixed && layout.left !== undefined && layout.top !== undefined ? { left: layout.left, top: layout.top } : null);
  const position = pinned && fixedPosition ? { ...placement, left: Math.max(12, Math.min(fixedPosition.left, viewport.width - placement.width - 12)), top: Math.max(12, Math.min(fixedPosition.top, viewport.height - panelHeight - 12)) } : placement;
  // togglePin 固定或释放本卡，无参数，固定后可拖动且不被新的页面选区替换
  function togglePin() { const next = !pinned; pinRef.current = next; setPinned(next); setDragPosition(next ? { left: position.left, top: position.top } : null); persistGeometry({ ...layoutRef.current, left: position.left, top: position.top, fixed: next }); setMenuOpen(false); }
  // persistGeometry 更新value几何状态并保存，失败只提示，不清除当前成功译文
  function persistGeometry(value: SelectionLayout) { geometryRevision.current++; const next = sanitizeSelectionLayout(value); layoutRef.current = next; setLayout(next); void saveSelectionLayout(next).catch(() => setNotice('划词框位置保存失败')); }
  // resetGeometry 恢复默认尺寸与跟随选区的位置，无参数，不清空译文或收藏
  function resetGeometry() { pinRef.current = false; setPinned(false); setDragPosition(null); persistGeometry({ ...DEFAULT_SELECTION_LAYOUT }); setMenuOpen(false); }
  return <section ref={panelRef} className="fw-app fw-selection" data-theme={theme} data-expanded={full} style={{ position: 'fixed', ...position, ...(full && (layout.height || auxiliary) ? { height: Math.min(layout.height ?? 620, viewport.height - 24) } : {}), fontSize, '--fw-font': `${fontSize}px` } as React.CSSProperties} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }} onMouseDown={(event) => { if (!(event.target as Element).closest('input,textarea,select')) event.preventDefault(); }} aria-label={auxiliary === 'provider' ? 'FlowWord 模型设置' : auxiliary === 'book' ? 'FlowWord 快捷单词本' : 'FlowWord 网页划词'} role={full ? 'dialog' : 'toolbar'}>
    <header data-draggable={true} onPointerDown={(event) => { if ((event.target as Element).closest('button,input,select,textarea')) return; const box = panelRef.current!.getBoundingClientRect(); drag.current = { x: event.clientX, y: event.clientY, left: box.left, top: box.top }; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); }} onPointerMove={(event) => { if (!drag.current) return; if (Math.abs(event.clientX - drag.current.x) + Math.abs(event.clientY - drag.current.y) < 4 && !drag.current.moved) return; drag.current.moved = true; pinRef.current = true; setPinned(true); setDragPosition({ left: drag.current.left + event.clientX - drag.current.x, top: drag.current.top + event.clientY - drag.current.y }); }} onPointerUp={(event) => { if (drag.current?.moved) { const box = panelRef.current!.getBoundingClientRect(); persistGeometry({ ...layoutRef.current, left: box.left, top: box.top, fixed: true }); } drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onLostPointerCapture={() => { drag.current = null; }}>
      <span className="fw-selection-brand">F<span>⌁</span></span>{full && <strong>{auxiliary === 'provider' ? '模型设置' : auxiliary === 'book' ? '单词本' : '网页划词'}</strong>}
      <div className="fw-selection-actions">
        {!full && <><button className="fw-selection-primary" onClick={(event) => { if (event.isTrusted) void translate(); }}>翻译</button><button onClick={() => collect(picked!.text, result.translation ?? '')} aria-label="收藏选区">{saved.includes(picked!.text) ? '已加入' : '收藏'}</button></>}
        {full && auxiliary && picked && <button onClick={() => { setAuxiliary(null); setExpanded(true); }}>返回翻译</button>}
        {full && <button aria-label={pinned ? '取消固定划词框' : '固定划词框'} aria-pressed={pinned} onClick={togglePin}>{pinned ? '已固定' : '固定'}</button>}
        <button aria-label="划词更多操作" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>⋯</button>{full && <button aria-label="关闭划词框" onClick={close}>×</button>}
      </div>
    </header>
    {menuOpen && <div className="fw-selection-menu" role="menu">{picked && <><button role="menuitem" onClick={() => { void copy(picked.text); setMenuOpen(false); }}>复制选区</button><button role="menuitem" onClick={() => { collect(picked.text, result.translation ?? ''); setMenuOpen(false); }}>收藏选区</button></>}<button role="menuitem" onClick={() => { setAuxiliary('book'); setMenuOpen(false); }}>打开单词本</button><button role="menuitem" onClick={() => { setAuxiliary('scope'); setMenuOpen(false); }}>总设置与划词设置</button><button role="menuitem" onClick={() => { setAuxiliary('provider'); setMenuOpen(false); }}>模型设置</button>{!full && <button role="menuitem" onClick={togglePin}>{pinned ? '取消固定划词框' : '固定划词框'}</button>}<button role="menuitem" onClick={resetGeometry}>恢复默认位置与大小</button><button role="menuitem" onClick={close}>关闭划词框</button></div>}
    {!full && notice && <p className="fw-selection-toast" role="status">{notice}</p>}
    {auxiliary ? <div className="fw-selection-content">{auxiliary === 'scope' ? <EmbeddedSettings view="scope" /> : auxiliary === 'provider' ? <EmbeddedSettings /> : <QuickWordbook onOpenFull={() => void browser.runtime.sendMessage({ type: 'FLOWWORD_BOOK_OPEN' })} />}</div> : expanded && picked && <div className="fw-selection-content">{draft ? <SaveEntryForm key={draft.text} draft={draft} onSave={save} onCancel={() => setDraft(null)} /> : <>
      <p className="fw-selection-original">{picked.text}</p>{(notice || result.translating) && <div className="fw-selection-status" role="status">{notice || '正在翻译选区…'}</div>}
      {result.translation && <p className="fw-selection-translation">{result.translation}</p>}
      {result.error && <div role="alert">{result.error}<button onClick={(event) => { if (event.isTrusted) void translate('translate'); }}>重试翻译</button><button onClick={() => setAuxiliary('provider')}>模型设置</button></div>}
      {result.explaining && <p className="fw-selection-muted">正在补充语境表达…</p>}
      {result.expressions.map((item) => <article key={item.text}><div><strong>{item.text}</strong><button onClick={() => collect(item.text, item.meaning, item.partOfSpeech, item.kind)}>{saved.includes(item.text) ? '已加入' : '加入'}</button></div><p>{item.meaning}</p><details><summary>用法说明</summary><p>{item.reason}</p></details></article>)}
      {result.contextError && <p role="alert">{result.contextError}<button onClick={(event) => { if (event.isTrusted) void translate('context'); }}>重试表达</button></p>}
      <div className="fw-selection-result-actions"><button onClick={() => collect(picked.text, result.translation ?? '')}>{saved.includes(picked.text) ? '已加入单词本' : '收藏选区'}</button>{result.translation && <button onClick={() => void copy(result.translation!)}>复制译文</button>}</div>
      <details className="fw-selection-notes"><summary>用法说明</summary><p>{autoTranslate ? '自动翻译已开启，真实键鼠选中后发送选区及短语境' : '仅在点击翻译后发送选区及最多一条短语境'}，收藏保存在本机。{result.cached ? '本次译文已从缓存读取。' : ''}</p></details>
    </>}</div>}
    {full && <button type="button" className="fw-selection-resize" aria-label="调整划词框大小" title="拖动调整大小" onPointerDown={(event) => { const box = panelRef.current!.getBoundingClientRect(); resize.current = { x: event.clientX, y: event.clientY, width: box.width, height: box.height, left: box.left, top: box.top }; pinRef.current = true; setPinned(true); setDragPosition({ left: box.left, top: box.top }); event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); }} onPointerMove={(event) => { const start = resize.current; if (!start) return; const next = { ...layoutRef.current, fixed: true, left: start.left, top: start.top, width: Math.min(innerWidth - start.left - 12, Math.max(300, start.width + event.clientX - start.x)), height: Math.min(innerHeight - start.top - 12, Math.max(260, start.height + event.clientY - start.y)) }; layoutRef.current = next; setLayout(next); }} onPointerUp={(event) => { if (resize.current) persistGeometry(layoutRef.current); resize.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { resize.current = null; }} onLostPointerCapture={() => { resize.current = null; }}>◢</button>}
  </section>;
}
