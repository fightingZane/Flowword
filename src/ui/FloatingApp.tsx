import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BALL_SIZE, DRAG_THRESHOLD, bubblePosition, constrain, rememberPosition, restorePosition, snapToEdge } from '../core/geometry';
import type { InteractionController } from '../core/interaction-controller';
import type { Appearance, BallPosition, Point, Settings, WordbookEntry } from '../core/types';
import { browser } from 'wxt/browser';
import { SettingsPanel } from './SettingsPanel';
import { SaveEntryForm } from './SaveEntryForm';
import { FlowMark, Icon } from './Icons';
import { getCuratedMeaning, GENERAL_MEANING_NOTE } from '../core/curated-meanings';

interface Props {
  controller: InteractionController;
  settings: Settings;
  onPosition(position: BallPosition): Promise<void>;
  onOffset(offset: number): Promise<void>;
  onAppearance(appearance: Partial<Appearance>): Promise<void>;
  onOnlineTranslation(value: boolean): Promise<void>;
}

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
const clock = (seconds: number) => {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60).toString().padStart(2, '0')}:${(value % 60).toString().padStart(2, '0')}`;
};

export function FloatingApp({ controller, settings, onPosition, onOffset, onAppearance, onOnlineTranslation }: Props) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [screen, setScreen] = useState(viewport);
  const [point, setPoint] = useState(() => restorePosition(settings.position, viewport()));
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);
  const [panelHeight, setPanelHeight] = useState(360);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState<WordbookEntry | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [extraMeanings, setExtraMeanings] = useState<Record<string, string>>({});
  const [lookingUp, setLookingUp] = useState('');
  const contextKey = `${state.context?.videoKey}:${state.context?.capturedTime}:${state.context?.text}`;
  const currentContext = useRef(contextKey);
  currentContext.current = contextKey;
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<{ id: number; origin: Point; startPoint: Point; point: Point; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visible = settingsOpen || state.phase !== 'IDLE';
  const busy = ['CAPTURING', 'ANALYZING', 'RESUME'].includes(state.phase);
  const panelWidth = Math.min(settings.appearance.panelWidth, Math.max(180, screen.width - 24));
  const panelPoint = bubblePosition(point, screen, panelWidth, panelHeight);

  useEffect(() => {
    setPoint(restorePosition(settings.position, viewport()));
  }, [settings.position.x, settings.position.y]);

  useEffect(() => { setExtraMeanings({}); setLookingUp(''); setExpanded(false); setDraft(null); }, [contextKey]);

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

  function flash(message: string) {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => { setNotice(''); setCopied(false); }, 2200);
  }

  function finishDrag(event: React.PointerEvent<HTMLButtonElement>, cancelled = false) {
    const active = drag.current;
    if (!active || active.id !== event.pointerId) return;
    suppressClick.current = active.moved || cancelled;
    if (active.moved) {
      const final = snapToEdge(active.point, viewport());
      setPoint(final);
      void onPosition(rememberPosition(final, viewport())).catch(() => flash('位置没有保存成功，请重新拖动'));
    }
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function close() {
    if (settingsOpen) { setSettingsOpen(false); return; }
    setDraft(null);
    controller.close();
    button.current?.focus({ preventScroll: true });
  }

  function add(text: string, kind: WordbookEntry['kind'], translation: string, lemma = text, partOfSpeech = '未分类') {
    const context = state.context;
    if (!context) return;
    setDraft({ id: '', kind, text, lemma, translation, partOfSpeech, examTags: [], tags: [], createdAt: 0, updatedAt: 0,
      contexts: [{ sentence: context.text, url: context.url, time: context.targetTime }] });
  }

  async function save(entry: WordbookEntry) {
    const response = await browser.runtime.sendMessage({ type: 'FLOWWORD_BOOK_SAVE', entry });
    if (!response?.ok) throw new Error(response?.error || '保存失败');
    setDraft(null); flash('已加入本地单词本');
  }

  async function lookup(lemma: string) {
    const key = contextKey;
    setLookingUp(lemma);
    try {
      const response = await browser.runtime.sendMessage({ type: 'FLOWWORD_TRANSLATE', sentence: lemma, words: [] });
      if (currentContext.current !== key) return;
      if (!response?.translation) throw new Error(response?.error || '暂没有可用参考译文');
      setExtraMeanings((previous) => ({ ...previous, [lemma]: response.translation }));
    } catch (error) { if (currentContext.current === key) flash(error instanceof Error ? error.message : '查询失败'); }
    finally { if (currentContext.current === key) setLookingUp(''); }
  }

  const appearanceStyle = { '--fw-font': `${settings.appearance.fontSize}px`, '--fw-ball-color': settings.appearance.ballColor,
    '--fw-ball-opacity': settings.appearance.ballOpacity / 100 } as React.CSSProperties;

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
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setSettingsOpen(true); }}
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
        setSettingsOpen(false); setDraft(null);
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
      aria-label={settingsOpen ? 'FlowWord 配置框' : 'FlowWord 字幕面板'}
      style={{ left: panelPoint.x, top: panelPoint.y, width: panelWidth, maxHeight: Math.max(120, screen.height - 24) }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); close(); }
        event.stopPropagation();   // 面板按键不触发 YouTube 的空格播放和方向键跳转
      }}
      onKeyUp={(event) => event.stopPropagation()}
    >
      <header className="fw-header">
        <div className="fw-brand"><span className="fw-mini-mark"><FlowMark size={17} /></span><span>FlowWord</span><span className="fw-dot-separator">/</span><span className="fw-brand-caption">{settingsOpen ? '配置' : '这一句'}</span></div>
        {!settingsOpen && <button type="button" className="fw-header-config" onClick={() => setSettingsOpen(true)}>配置</button>}
        <button type="button" data-close className="fw-icon-button" aria-label="关闭面板，保持视频暂停" title="关闭面板 · 保持暂停" onClick={close}><Icon name="close" size={16} /></button>
      </header>

      <div className="fw-body" aria-live="polite" aria-busy={busy}>
        {settingsOpen ? <SettingsPanel settings={settings} onAppearance={onAppearance} onError={flash} onOnline={async (value) => {
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
          <p className="fw-sentence" lang="en">{state.context.text}</p>
          {state.context.learning && <div className="fw-learning">
            <div className="fw-translation-label">中文参考译文 <span>MyMemory{state.context.learning.segmented ? ' · 分段译文' : ''}</span></div>
            {state.context.learning.translation ? <p className="fw-translation">{state.context.learning.translation}</p>
              : state.context.learning.status === 'loading' ? <p className="fw-learning-note">正在翻译，字幕已为你保留…</p>
              : state.context.learning.status === 'disabled' ? <p className="fw-learning-note">联网翻译尚未开启 <button type="button" onClick={() => setSettingsOpen(true)}>右键配置 / 开启翻译</button></p>
              : <p className="fw-learning-note" role="status">{state.context.learning.error || '暂没有可用译文'}</p>}
            <div className="fw-learning-title">优先看这些表达 <span>难度参考 · 非概率</span></div>
            <p className="fw-context-note">{GENERAL_MEANING_NOTE}</p>
            {state.context.learning.candidates.length ? state.context.learning.candidates.slice(0, expanded ? 8 : 3).map((candidate, index) => {
              const meaning = extraMeanings[candidate.lemma] || candidate.translation || candidate.meaning;
              const curated = getCuratedMeaning(candidate.lemma);
              const parts: Record<string, string> = { noun: '名词', verb: '动词', adjective: '形容词', adverb: '副词', phrase: '短语' };
              return <div className="fw-candidate" key={candidate.lemma}>
                <div className="fw-candidate-title"><span className="fw-rank">{index + 1}</span><strong lang="en">{candidate.text}</strong><span className="fw-kind">{candidate.kind === 'phrase' ? '短语' : '单词'}</span>
                  <button type="button" aria-label={`加入单词本 ${candidate.text}`} onClick={() => add(candidate.text, candidate.kind, meaning || '', candidate.lemma, parts[candidate.partOfSpeech ?? ''] || '未分类')}>加入</button></div>
                {curated && <p className="fw-context-note">本地核验通用义（中文自编） · <a href={curated.sourceUrl} target="_blank" rel="noreferrer">Cambridge 语义依据</a></p>}
                <p>{meaning || (state.context!.learning!.status === 'loading' && index < 3 ? '参考释义查询中…' : '暂无参考释义')}
                  {!meaning && settings.onlineTranslation && <button type="button" disabled={Boolean(lookingUp)} onClick={() => void lookup(candidate.lemma)}>{lookingUp === candidate.lemma ? '查询中' : '查参考义'}</button>}</p>
                <span className="fw-candidate-reason">{candidate.reason}</span>
              </div>;
            }) : <p className="fw-learning-note">这段字幕没有筛选出需要优先提示的表达</p>}
            {state.context.learning.candidates.length > 3 && <button type="button" className="fw-retry" onClick={() => setExpanded(!expanded)}>{expanded ? '收起更多' : '展开更多表达'}</button>}
            {state.context.learning.translation && state.context.learning.error && <p className="fw-learning-note">{state.context.learning.error}</p>}
          </div>}
          <div className="fw-context-note">{state.context.selected.language === 'und' ? '已捕获页面字幕 · 请确认播放器选择了 English' : '来自视频的英文字幕轨道'}</div>
          <div className="fw-tools">
            <button type="button" onClick={() => add(state.context!.text, 'sentence', state.context!.learning?.translation || '', state.context!.text, '句子')}>加入整句</button>
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
      </div>

      {!draft && <footer className="fw-footer">
        {settingsOpen ? <><button type="button" className="fw-retry" onClick={() => void browser.runtime.sendMessage({ type: 'FLOWWORD_BOOK_OPEN' })}>打开单词本</button><button type="button" className="fw-primary" onClick={() => setSettingsOpen(false)}>配置完成</button></> : <>
        <span><Icon name="pause" size={13} />{state.canResume ? '视频已为你暂停' : '按原有播放状态结束'}</span>
        <button type="button" className="fw-primary" disabled={state.phase === 'RESUME'} onClick={() => void controller.resume()}>
          {state.canResume ? <>继续观看<Icon name="play" size={15} /></> : <>完成<Icon name="check" size={15} /></>}
        </button>
        </>}
      </footer>}
    </section>}
  </div>;
}
