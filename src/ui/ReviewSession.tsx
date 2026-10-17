import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import type { WordbookEntry } from '../core/types';
import './review-session.css';

interface ReviewCard { entry: WordbookEntry; contexts?: { translation: string; capture: WordbookEntry['contexts'][number] }[] }
interface Props { sourceId?: string; sourceKind?: 'video' | 'web'; videoId?: string; onClose(): void; onUpdated?(): void }

// ReviewSession 表示本地回忆练习，sourceId 限定来源，sourceKind 限定视频或网页
// videoId 兼容旧调用，onClose 返回词本，onUpdated 在评分成功后通知父列表
// 中文默认隐藏，评分只更新本地计划，不调用模型，也不会自动控制网页视频
export function ReviewSession({ sourceId, sourceKind, videoId, onClose, onUpdated }: Props) {
  const [cards, setCards] = useState<ReviewCard[]>([]);
  const [position, setPosition] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState(0);
  const operation = useRef(0);
  const repeated = useRef(new Set<string>());
  const completedIds = useRef(new Set<string>());
  const selectedSource = sourceId ?? videoId;
  useEffect(() => {
    const request = ++operation.current; repeated.current.clear(); completedIds.current.clear(); setCards([]); setLoading(true); setError(''); setPosition(0); setCompleted(0); setRevealed(false);
    void browser.runtime.sendMessage({ type: 'FLOWWORD_REVIEW_DUE', query: { sourceId: selectedSource, sourceKind, limit: 10 } }).then((result) => {
      if (!result?.ok) throw new Error(result?.error || '复习资料读取失败');
      if (request === operation.current) setCards(result.cards || []);
    }).catch((failure) => { if (request === operation.current) setError(failure instanceof Error ? failure.message : '复习读取失败'); })
      .finally(() => { if (request === operation.current) setLoading(false); });
    return () => { operation.current++; };
  }, [selectedSource, sourceKind]);
  const card = cards[position];
  const occurrence = card?.contexts?.[0];
  const context = occurrence?.capture || card?.entry.contexts.at(-1);
  // grade 表示记录回忆结果，value 是忘了、模糊或记住了的内部枚举
  // 后台成功才前进，失败留在本卡重试，避免未保存评分却跳过词句
  async function grade(value: 'forgot' | 'uncertain' | 'remember') {
    if (!card || busy) return;
    setBusy(true); setError('');
    try {
      const result = await browser.runtime.sendMessage({ type: 'FLOWWORD_REVIEW_GRADE', id: card.entry.id, grade: value });
      if (!result?.ok) throw new Error(result?.error || '复习结果未保存');
      if (value === 'forgot' && !repeated.current.has(card.entry.id)) { repeated.current.add(card.entry.id); setCards((previous) => [...previous, card]); }
      completedIds.current.add(card.entry.id); setCompleted(completedIds.current.size); setPosition((previous) => previous + 1); setRevealed(false); onUpdated?.();
    } catch (failure) { setError(failure instanceof Error ? failure.message : '评分失败'); }
    finally { setBusy(false); }
  }
  // replay 表示回顾原句听力，无参数，将已保存来源交给后台定位并播放
  // 不调用模型，来源无效或网站不支持时显示明确原因
  async function replay() {
    if (!context) return;
    try { const result = await browser.runtime.sendMessage({ type: 'FLOWWORD_REPLAY_SOURCE', source: context }); if (!result?.ok) throw new Error(result?.error || '来源暂时无法打开'); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '来源打开失败'); }
  }
  return <section className="fw-review" aria-label="词句回忆复习">
    <header className="fw-review-header"><div><h2>词句回忆</h2><p>本地复习 · 不调用模型</p></div><button type="button" onClick={onClose}>返回词本</button></header>
    {error && <p className="fw-review-error" role="alert">{error}</p>}
    {loading ? <p role="status">正在准备复习…</p> : card ? <>
      <div className="fw-review-progress"><span>第 {position + 1} / {cards.length} 条</span><span>先想一想，再查看答案</span></div>
      <article className="fw-review-card"><span className="fw-review-kind">{card.entry.kind === 'word' ? '单词' : card.entry.kind === 'phrase' ? '表达' : '整句'}</span><h3 lang="en">{card.entry.text}</h3>
        {context && <>{context.sentence !== card.entry.text && <p lang="en" className="fw-review-sentence">{context.sentence}</p>}<button type="button" className="fw-review-listen" onClick={() => void replay()}>{context.source?.kind === 'web' ? '回到原文 ↗' : '听原句 ↗'}</button></>}
        {revealed ? <div className="fw-review-answer"><strong>{occurrence?.translation || card.entry.translation || '暂无释义，可返回词本补充'}</strong>{context?.translation && <p>{context.translation}</p>}</div> : <button className="fw-review-reveal" type="button" onClick={() => setRevealed(true)}>查看中文答案</button>}
      </article>
      {revealed && <div className="fw-review-grades"><button type="button" disabled={busy} onClick={() => void grade('forgot')}>忘了</button><button type="button" disabled={busy} onClick={() => void grade('uncertain')}>有点模糊</button><button type="button" disabled={busy} onClick={() => void grade('remember')}>记住了</button></div>}
      <p className="fw-review-note">每轮最多 10 个词句，忘了的词句本轮稍后再出现一次；按结果安排 1 / 3 / 7 / 14 / 30 天后的复习</p>
    </> : <div className="fw-review-empty"><h3>{completed ? `本次完成 ${completed} 条` : '今天的复习已完成'}</h3><p>{completed ? '结果已保存在本机，按计划再见' : '收藏新词句，或到下次复习时间再来'}</p><button type="button" onClick={onClose}>返回词本</button></div>}
  </section>;
}
