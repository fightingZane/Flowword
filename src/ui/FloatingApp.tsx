import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BALL_SIZE, DRAG_THRESHOLD, bubblePosition, constrain, rememberPosition, restorePosition, snapToEdge } from '../core/geometry';
import type { InteractionController } from '../core/interaction-controller';
import type { Appearance, BallPosition, Point, Settings, WordbookEntry } from '../core/types';
import { browser } from 'wxt/browser';
import { QuickWordbook } from './QuickWordbook';
import { EmbeddedSettings } from './EmbeddedSettings';
import { ScrollArea } from './ScrollArea';
import { NeighborLine } from './NeighborLine';
import './quick-wordbook.css';
import { SettingsPanel } from './SettingsPanel';
import { SaveEntryForm } from './SaveEntryForm';
import { FlowMark, Icon } from './Icons';
import { getCuratedMeaning, GENERAL_MEANING_NOTE } from '../core/curated-meanings';
import { entryKey, hasMeaning, hasSourceSpan } from '../core/learning-view';
import { observedSentenceRange } from '../adapters/html5-subtitles';

interface Props {
  controller: InteractionController;
  settings: Settings;
  onPosition(position: BallPosition): Promise<void>;
  onOffset(offset: number): Promise<void>;
  onAppearance(appearance: Partial<Appearance>): Promise<void>;
  onOnlineTranslation(value: boolean): Promise<void>;
  requestedPanel?: { view: 'provider' | 'book' | 'scope'; revision: number };
  onRepeat?(): Promise<void>;
  onFollow?(): Promise<void>;
}

// viewport 读取当前可见窗口尺寸，无参数，供球和面板边界计算使用
const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
// clock 将seconds视频时间格式化为分秒，负值按零处理，不改变视频进度
const clock = (seconds: number) => {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60).toString().padStart(2, '0')}:${(value % 60).toString().padStart(2, '0')}`;
};

// FloatingApp 渲染球与学习面板，controller提供当前状态，settings提供已保存配置
// onPosition和onOffset保存位置与偏移，onAppearance和onOnlineTranslation保存外观与联网开关
// onRepeat和onFollow是可选播放动作，仅在已授权内容脚本挂载，不接收或显示API密钥
export function FloatingApp({ controller, settings, onPosition, onOffset, onAppearance, onOnlineTranslation, requestedPanel, onRepeat, onFollow }: Props) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [screen, setScreen] = useState(viewport);
  const [point, setPoint] = useState(() => restorePosition(settings.position, viewport()));
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);
  const [panelHeight, setPanelHeight] = useState(360);
  const [size, setSize] = useState({ width: settings.appearance.panelWidth, height: settings.appearance.panelHeight ?? 620 });
  const liveSize = useRef(size);
  liveSize.current = size;
  const [manualPoint, setManualPoint] = useState<Point | null>(null);
  const panelGesture = useRef<{ id: number; x: number; y: number; width: number; height: number; point: Point; resize: boolean } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [secondaryView, setSecondaryView] = useState<'provider' | 'book' | 'scope' | null>(null);
  useEffect(() => { if (requestedPanel) { setSecondaryView(requestedPanel.view); setSettingsOpen(false); } }, [requestedPanel?.revision]);
  const [draft, setDraft] = useState<WordbookEntry | null>(null);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const savedRevision = useRef(0);
  const [expanded, setExpanded] = useState(false);
  const contextKey = `${state.context?.videoKey}:${state.context?.capturedTime}:${state.context?.text}`;
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<{ id: number; origin: Point; startPoint: Point; point: Point; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visible = Boolean(secondaryView) || settingsOpen || state.phase !== 'IDLE';
  const busy = ['CAPTURING', 'ANALYZING', 'RESUME'].includes(state.phase);
  const panelWidth = Math.min(size.width, Math.max(180, screen.width - 24));
  const displayHeight = Math.min(size.height, Math.max(120, screen.height - 24));
  const boundPanel = (value: Point) => ({ x: Math.max(12, Math.min(value.x, screen.width - panelWidth - 12)), y: Math.max(12, Math.min(value.y, screen.height - displayHeight - 12)) });
  const panelPoint = manualPoint ? boundPanel(manualPoint) : bubblePosition(point, screen, panelWidth, displayHeight);
  useEffect(() => setSize({ width: settings.appearance.panelWidth, height: settings.appearance.panelHeight ?? 620 }), [settings.appearance.panelWidth, settings.appearance.panelHeight]);

  useEffect(() => {
    setPoint(restorePosition(settings.position, viewport()));
  }, [settings.position.x, settings.position.y]);

  useEffect(() => { setExpanded(false); setDraft(null); }, [contextKey]);

  useEffect(() => {
    const resize = () => {
      const next = viewport();
      setScreen(next);
      setPoint((previous) => constrain(previous, next));   // 缩小窗口后将悬浮球带回边界内
    };
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
  }, []);

  useLayoutEffect(() => {
    if (!visible || !panel.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setPanelHeight(entry.target.getBoundingClientRect().height);
    });
    observer.observe(panel.current);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (visible) panel.current?.querySelector<HTMLButtonElement>('[data-close]')?.focus({ preventScroll: true });
  }, [visible]);

  // flash 临时显示message操作反馈，供保存失败和成功提示使用，不改变播放状态
  function flash(message: string) {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => { setNotice(''); setCopied(false); }, 2200);
  }

  // finishDrag 结束球拖动，event提供指针身份，cancelled表示浏览器取消操作
  // 只处理本次指针并按配置保存自由位置或贴边位置，拖动结束不能误触发暂停点击
  function finishDrag(event: React.PointerEvent<HTMLButtonElement>, cancelled = false) {
    const active = drag.current;
    if (!active || active.id !== event.pointerId) return;
    suppressClick.current = active.moved || cancelled;
    if (active.moved) {
      const final = settings.appearance.ballPlacement === 'edge' ? snapToEdge(active.point, viewport()) : constrain(active.point, viewport());
      setPoint(final);
      void onPosition(rememberPosition(final, viewport())).catch(() => flash('位置没有保存成功，请重新拖动'));
    }
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  // close 收起配置或分析面板，无参数，由叉号和Escape调用，不自动恢复视频
  function close() {
    if (secondaryView) { setSecondaryView(null); setSettingsOpen(false); return; }
    if (settingsOpen) { setSettingsOpen(false); return; }
    setDraft(null);
    controller.close();
    button.current?.focus({ preventScroll: true });
  }

  // add 创建收藏草稿，text和kind描述原文与类型，translation是本次语境义
  // lemma用于去重，partOfSpeech是可编辑词性，保存前保留真实句首和来源
  function add(text: string, kind: WordbookEntry['kind'], translation: string, lemma = text, partOfSpeech = '未分类') {
    const context = state.context;
    if (!context) return;
    const range = observedSentenceRange(context);   // 与重听一致，拼接句从实际参与片段的句首溯源
    setDraft({ id: '', kind, text, lemma, translation, partOfSpeech, examTags: [], tags: [], createdAt: 0, updatedAt: 0,
      contexts: [{ sentence: context.text, url: context.url, time: range.start, end: range.end,
        title: context.title, videoKey: context.videoKey, thumbnail: context.thumbnail, translation: context.learning?.translation }] });
  }

  // save 将entry草稿交给扩展后台校验保存，成功后关闭表单，失败交回表单提示
  async function save(entry: WordbookEntry) {
    const response = await browser.runtime.sendMessage({ type: 'FLOWWORD_BOOK_SAVE', entry });
    if (!response?.ok) throw new Error(response?.error || '保存失败');
    savedRevision.current += 1;   // 保存确认使更早发出的收藏列表失效
    setSavedIds((previous) => [...new Set([...previous, response.entry.id])]);
    setDraft(null); flash('已加入本地单词本');
  }

  // saved 判断kind类型与原文或lemma是否已收藏，允许再次点击保存当前视频的新语境
  function saved(kind: WordbookEntry['kind'], text: string, lemma = text): boolean {
    const keys = [entryKey(kind, text), entryKey(kind, lemma)];
    return keys.some((key) => savedIds.includes(key));
  }

  const savedLookupIds = JSON.stringify([...new Set([
    ...(state.context ? [entryKey('sentence', state.context.text)] : []),
    ...(state.context?.learning?.expressions ?? []).map((item) => entryKey('phrase', item.text)),
    ...(state.context?.learning?.candidates ?? []).flatMap((item) => [entryKey('word', item.text), entryKey('phrase', item.text), entryKey('word', item.lemma || item.text)]),
  ])].slice(0, 100));

  useEffect(() => {
    if (!visible || secondaryView || settingsOpen || !state.context) return;
    let active = true;
    // refresh 读取后台确认的收藏记录，无参数，打开面板或切回网页时同步删除与新增
    const refresh = () => {
      const revision = ++savedRevision.current;
      void browser.runtime.sendMessage({ type: 'FLOWWORD_BOOK_STATUS', ids: JSON.parse(savedLookupIds) }).then((response) => {
        if (active && revision === savedRevision.current && response?.ok && Array.isArray(response.savedIds)) setSavedIds(response.savedIds);
      }).catch(() => {});
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => { active = false; window.removeEventListener('focus', refresh); };
  }, [visible, secondaryView, settingsOpen, savedLookupIds]);

  const expressions = state.context?.learning?.expressions?.filter((item) => hasMeaning(item.meaning) && hasSourceSpan(state.context!.text, item.text)) ?? [];
  const candidates = state.context?.learning?.candidates.filter((item) => hasMeaning(item.translation || item.meaning) && hasSourceSpan(state.context!.text, item.text)) ?? [];

  const appearanceStyle = { '--fw-font': `${settings.appearance.fontSize}px`, '--fw-ball-color': settings.appearance.ballColor,
    '--fw-ball-opacity': settings.appearance.ballOpacity / 100 } as React.CSSProperties;

  // copy 复制当前原句，无参数，只在用户点击后写剪贴板，失败保留可选原文
  async function copy() {
    if (!state.context) return;
    try {
      await navigator.clipboard.writeText(state.context.text);
      setCopied(true);
      flash('原文已复制');
    } catch {
      flash('无法复制，可以直接选中原文');
    }
  }

  // offset 保存value秒偏移后重新捕获，只选已读取字幕，不移动视频时间轴
  async function offset(value: number) {
    try {
      await onOffset(value);
      await controller.capture(value);
    } catch {
      flash('时间偏移没有保存成功，请重试');
    }
  }

  return <div className="fw-app" data-phase={state.phase} data-theme={settings.appearance.panelTheme} data-ball-style={settings.appearance.ballStyle} style={appearanceStyle}>
    <button
      ref={button}
      className={`fw-ball ${visible ? 'is-open' : ''} ${dragging ? 'is-dragging' : ''}`}
      style={{ left: point.x, top: point.y, width: BALL_SIZE, height: BALL_SIZE }}
      type="button"
      aria-label={state.phase !== 'IDLE' ? '继续播放并关闭翻译框' : '暂停视频并捕获字幕'}
      aria-expanded={visible}
      aria-controls="flowword-bubble"
      title="左键暂停 / 继续 · 右键配置 · 拖动调整位置"
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setSecondaryView(null); setSettingsOpen(true); }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        suppressClick.current = false;
        drag.current = { id: event.pointerId, origin: { x: event.clientX, y: event.clientY }, startPoint: point, point, moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);   // 鼠标移出球体后仍能结束拖动
      }}
      onPointerMove={(event) => {
        const active = drag.current;
        if (!active || active.id !== event.pointerId) return;
        const dx = event.clientX - active.origin.x;
        const dy = event.clientY - active.origin.y;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD && !active.moved) return;
        active.moved = true;
        active.point = constrain({ x: active.startPoint.x + dx, y: active.startPoint.y + dy }, viewport());
        setDragging(true);
        setPoint(active.point);
      }}
      onPointerUp={(event) => finishDrag(event)}
      onPointerCancel={(event) => finishDrag(event, true)}
      onLostPointerCapture={() => { drag.current = null; setDragging(false); }}
      onClick={(event) => {
        if (suppressClick.current && event.detail !== 0) { suppressClick.current = false; return; }
        setSettingsOpen(false); setSecondaryView(null); setDraft(null);
        if (state.phase !== 'IDLE') void controller.resume();   // 再次左键就是继续观看，不只收起面板
        else void controller.capture(settings.offset);
      }}
    >
      {busy ? <span className="fw-spinner" /> : <FlowMark />}
      <span className="fw-ball-dot" />
      {!visible && !dragging && <span className="fw-tooltip" style={point.x < screen.width / 2 ? { left: 66, right: 'auto' } : undefined}>停一下，看懂这一句</span>}
    </button>

    {visible && <section
      ref={panel}
      id="flowword-bubble"
      className="fw-bubble"
      role="dialog"
      aria-label={secondaryView === 'provider' ? 'FlowWord 模型设置' : secondaryView === 'book' ? 'FlowWord 快捷单词本' : settingsOpen ? 'FlowWord 配置框' : 'FlowWord 字幕面板'}
      style={{ left: panelPoint.x, top: panelPoint.y, width: panelWidth, height: displayHeight, maxHeight: Math.max(120, screen.height - 24) }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); close(); }
        event.stopPropagation();   // 面板按键不触发 YouTube 的空格播放和方向键跳转
      }}
      onKeyUp={(event) => event.stopPropagation()}
    >
      <header className="fw-header" onPointerDown={(event) => {
        if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
        panelGesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, ...size, point: panelPoint, resize: false };
        event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerMove={(event) => {
        const gesture = panelGesture.current;
        if (gesture?.id === event.pointerId && !gesture.resize) setManualPoint(boundPanel({ x: gesture.point.x + event.clientX - gesture.x, y: gesture.point.y + event.clientY - gesture.y }));
      }} onPointerUp={() => { panelGesture.current = null; }} onPointerCancel={() => { panelGesture.current = null; }}>
        <div className="fw-brand"><span className="fw-mini-mark"><FlowMark size={17} /></span><span>FlowWord</span><span className="fw-dot-separator">/</span><span className="fw-brand-caption">{secondaryView === 'provider' ? '模型设置' : secondaryView === 'book' ? '单词本' : settingsOpen ? '配置' : '这一句'}</span></div>
        {!settingsOpen && !secondaryView && <button type="button" className="fw-header-config" onClick={() => setSecondaryView('book')}><Icon name="bookmark" size={15} />单词本</button>}
        {!settingsOpen && !secondaryView && <button type="button" className="fw-header-config" onClick={() => { setSecondaryView(null); setSettingsOpen(true); }}><Icon name="settings" size={15} />配置</button>}
        <button type="button" data-close className="fw-icon-button" aria-label="关闭面板，保持视频暂停" title="关闭面板 · 保持暂停" onClick={close}><Icon name="close" size={16} /></button>
      </header>

      <ScrollArea busy={busy}>
        {secondaryView === 'scope' ? <EmbeddedSettings view="scope" /> : secondaryView === 'provider' ? <EmbeddedSettings /> : secondaryView === 'book' ? <QuickWordbook onOpenFull={() => void browser.runtime.sendMessage({ type: 'FLOWWORD_BOOK_OPEN' })} /> : settingsOpen ? <SettingsPanel onProvider={() => { setSettingsOpen(false); setSecondaryView('provider'); }} settings={settings} onAppearance={onAppearance} onError={flash} onOnline={async (value) => {
          await onOnlineTranslation(value);
          if (state.context) void controller.capture(settings.offset);
        }} /> : draft ? <SaveEntryForm draft={draft} onSave={save} onCancel={() => setDraft(null)} /> : <>
        {busy && <div className="fw-loading">
          <div className="fw-loading-symbol"><span className="fw-spinner" /></div>
          <p>{state.phase === 'RESUME' ? '正在继续播放' : '留住刚才这一句'}</p>
          <span>稍等一下</span>
        </div>}

        {!busy && state.context && <>
          <div className="fw-eyebrow"><span className="fw-source-dot" />{state.context.isPartial ? '字幕片段' : '字幕原文'}<span className="fw-time">{clock(state.context.targetTime)}</span></div>
          {state.context.learning?.timeline?.filter((line) => line.end <= observedSentenceRange(state.context!).start).slice(-1).map((line) => <NeighborLine key={`${contextKey}:before:${line.start}`} line={line} current={state.context!.text} online={settings.onlineTranslation} label="上文" />)}
          <p className="fw-sentence" lang="en">{state.context.text}</p>
          {state.context.learning && <div className="fw-current-translation">
            {state.context.learning.translation ? <p className="fw-translation">{state.context.learning.translation}</p>
              : state.context.learning.status === 'loading' ? <p className="fw-learning-note">正在准备这一句译文…</p>
              : state.context.learning.status === 'disabled' ? <p className="fw-learning-note">联网翻译尚未开启 <button type="button" onClick={() => setSettingsOpen(true)}>右键配置 / 开启翻译</button></p>
              : <p className="fw-learning-note" role="status">{state.context.learning.error || '暂没有可用译文'}</p>}
            <details className="fw-result-details"><summary>译文详情</summary><div className="fw-translation-label">当前句译文 <span>{state.context.learning.cached ? '缓存命中' : state.context.learning.status === 'loading' ? '正在准备' : state.context.learning.status === 'error' ? '请求失败' : state.context.learning.provider || '参考翻译'}{state.context.learning.elapsedMs !== undefined ? ` · ${state.context.learning.elapsedMs} ms` : ''}{state.context.learning.segmented ? ' · 分段译文' : ''}</span></div></details>
          </div>}
          {state.context.learning?.provider === 'mymemory' && <details className="fw-result-details"><summary>参考翻译服务</summary><p className="fw-context-note">MyMemory · 无语境分析 <button type="button" onClick={() => { setSecondaryView('provider'); setSettingsOpen(false); }}>配置语境模型 ↗</button></p></details>}
          {state.context.learning?.timeline?.filter((line) => line.start >= observedSentenceRange(state.context!).end).slice(0, 1).map((line) => <NeighborLine key={`${contextKey}:after:${line.start}`} line={line} current={state.context!.text} online={settings.onlineTranslation} label="下文" />)}
          {state.context.learning?.status === 'error' && <button type="button" className="fw-retry" onClick={() => void controller.retryLearning('translate')}>重试整句翻译</button>}
          <div className="fw-current-actions">
            <button type="button" className="fw-primary" onClick={() => add(state.context!.text, 'sentence', state.context!.learning?.translation || '', state.context!.text, '句子')}>{saved('sentence', state.context.text) ? '已加入整句' : '收藏整句'}</button>
            {onRepeat && <button type="button" className="fw-retry" onClick={() => void onRepeat().catch((error) => flash(error instanceof Error ? error.message : '无法重听'))}>重听这一句 ↻</button>}
            {onFollow && <button type="button" className="fw-retry" onClick={() => void onFollow().catch((error) => flash(error instanceof Error ? error.message : '无法跟随'))}>字幕跟随 ▷</button>}
          </div>
          {state.context.learning && <div className="fw-learning" key={`${state.context.selected.start}:${state.context.text}`}>


            <div className="fw-learning-title">值得记住的表达</div>
            {expressions.map((expression) => <div className="fw-candidate fw-context-expression" key={expression.text}>
              <div className="fw-candidate-title"><strong>{expression.text}</strong><span className="fw-kind">{expression.partOfSpeech}</span><button type="button" onClick={() => add(expression.text, expression.kind, expression.meaning, expression.text, expression.partOfSpeech)} title="已收藏的表达仍可点击记录当前语境">{saved(expression.kind, expression.text) ? '已加入' : '加入'}</button></div>
              <p>{expression.meaning}</p><details className="fw-expression-details"><summary>用法说明</summary><span className="fw-candidate-reason">{expression.reason}</span></details>
            </div>)}
            {state.context.learning.contextStatus === 'loading' && <p className="fw-learning-note">语境表达解析中…</p>}
            {state.context.learning.contextError && <p className="fw-learning-note">{state.context.learning.contextError} <button type="button" onClick={() => void controller.retryLearning('context')}>重试表达释义</button></p>}


            {state.context.learning.provider !== 'cloud' && state.context.learning.provider !== 'codex-cli' && !expressions.length && <>
            <details className="fw-result-details"><summary>参考释义说明</summary><p className="fw-context-note">{GENERAL_MEANING_NOTE}</p></details>
            {candidates.length ? candidates.slice(0, expanded ? 8 : 3).map((candidate, index) => {
              const meaning = candidate.translation || candidate.meaning;
              const curated = getCuratedMeaning(candidate.lemma);
              const parts: Record<string, string> = { noun: '名词', verb: '动词', adjective: '形容词', adverb: '副词', phrase: '短语' };
              return <div className="fw-candidate" key={candidate.lemma}>
                <div className="fw-candidate-title"><span className="fw-rank">{index + 1}</span><strong lang="en">{candidate.text}</strong><span className="fw-kind">{candidate.kind === 'phrase' ? '短语' : '单词'}</span>
                  <button type="button" aria-label={`加入单词本 ${candidate.text}`} onClick={() => add(candidate.text, candidate.kind, meaning || '', candidate.lemma, parts[candidate.partOfSpeech ?? ''] || '未分类')} title="已收藏的表达仍可点击记录当前语境">{saved(candidate.kind, candidate.text, candidate.lemma) ? '已加入' : '加入'}</button></div>
                {curated && <p className="fw-context-note">本地核验通用义（中文自编） · <a href={curated.sourceUrl} target="_blank" rel="noreferrer">{curated.sourceName} 语义依据</a></p>}
                <p>{meaning}</p>
                <details className="fw-expression-details"><summary>用法说明</summary><span className="fw-candidate-reason">{candidate.reason}</span></details>
              </div>;
            }) : <p className="fw-learning-note">当前服务未提供可用表达释义，可配置语境模型</p>}
            {candidates.length > 3 && <button type="button" className="fw-retry" onClick={() => setExpanded(!expanded)}>{expanded ? '收起更多' : '展开更多表达'}</button>}
            </>}
            {state.context.learning.translation && state.context.learning.error && <p className="fw-learning-note">{state.context.learning.error}</p>}
          </div>}
          <details className="fw-result-details"><summary>字幕来源</summary><p className="fw-context-note">{state.context.selected.language === 'und' ? '页面字幕，请确认播放器选择了 English' : '视频英文字幕轨道'}</p></details>
          <div className="fw-tools">
            <button type="button" onClick={() => void controller.previous()}><Icon name="back" size={15} />上一条字幕</button>
            <button type="button" onClick={() => void controller.capture(settings.offset)}>回到点击时刻</button>
            <button type="button" className="fw-copy" onClick={() => void copy()} aria-label="复制原文"><Icon name={copied ? 'check' : 'copy'} size={15} /></button>
          </div>
        </>}

        {!busy && state.error && <div className={state.context ? 'fw-inline-error' : 'fw-error'} role="status">
          {!state.context && <><span className="fw-error-symbol">Aa</span><h2>这一句还没有捕获到</h2></>}
          <p>{state.error}</p>
          {!state.context && <button type="button" className="fw-retry" onClick={() => void controller.capture(settings.offset)}>重新捕获<Icon name="arrow" size={14} /></button>}
        </div>}

        {!busy && <div className="fw-offset">
          <label htmlFor="fw-offset">字幕时间微调</label>
          <select id="fw-offset" value={settings.offset} onChange={(event) => void offset(Number(event.target.value))}>
            {[-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2].map((value) => <option key={value} value={value}>{value === 0 ? '点击时刻 · 0 秒' : `${value > 0 ? '+' : '−'}${Math.abs(value)} 秒`}</option>)}
          </select>
        </div>}
        {notice && <p className="fw-notice" role="status">{notice}</p>}
        </>}
      </ScrollArea>
      <button type="button" className="fw-resize" aria-label="拖动调整翻译框大小" title="拖动调整宽高" onPointerDown={(event) => {
        if (event.button !== 0) return;
        panelGesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, width: panelWidth, height: displayHeight, point: panelPoint, resize: true };
        setManualPoint(panelPoint); event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerMove={(event) => {
        const gesture = panelGesture.current;
        if (!gesture?.resize || gesture.id !== event.pointerId) return;
        const next = { width: Math.min(screen.width - gesture.point.x - 12, Math.max(300, gesture.width + event.clientX - gesture.x)), height: Math.min(screen.height - gesture.point.y - 12, Math.max(280, gesture.height + event.clientY - gesture.y)) };
        liveSize.current = next; setSize(next);   // 同一帧内抬起鼠标时仍保存最后位置，而不是旧render尺寸
      }} onPointerUp={() => { if (panelGesture.current?.resize) void onAppearance({ panelWidth: liveSize.current.width, panelHeight: liveSize.current.height }).catch(() => flash('尺寸保存失败')); panelGesture.current = null; }} onPointerCancel={() => { panelGesture.current = null; }}>◢</button>

      {!draft && <footer className="fw-footer">
        {secondaryView ? <><button type="button" className="fw-retry" onClick={() => { setSecondaryView(null); setSettingsOpen(true); }}>返回配置</button><button type="button" className="fw-primary" onClick={() => { setSecondaryView(null); setSettingsOpen(false); }}>返回字幕</button></> : settingsOpen ? <><button type="button" className="fw-retry" onClick={() => { setSecondaryView('book'); setSettingsOpen(false); }}>打开单词本</button><button type="button" className="fw-primary" onClick={() => setSettingsOpen(false)}>配置完成</button></> : <>
        <span><Icon name="pause" size={13} />{state.canResume ? '视频已为你暂停' : '按原有播放状态结束'}</span>
        <button type="button" className="fw-primary" disabled={state.phase === 'RESUME'} onClick={() => void controller.resume()}>
          {state.canResume ? <>继续观看<Icon name="play" size={15} /></> : <>完成<Icon name="check" size={15} /></>}
        </button>
        </>}
      </footer>}
    </section>}
  </div>;
}
