import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';

interface Props { line: { text: string; translation?: string }; current: string; online: boolean; label: string }

// NeighborLine 展示可展开的邻句，line提供真实字幕及缓存译文，current用于语境消歧
// online决定能否联网，label区分上下文，只在用户展开且没有译文时查询，不影响视频播放
export function NeighborLine({ line, current, online, label }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [translation, setTranslation] = useState(line.translation || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { if (line.translation) setTranslation(line.translation); }, [line.translation]);
  // toggle 切换当前邻句中文，无参数，已成功的结果复用，错误后可再次收起展开重试
  async function toggle() {
    const next = !expanded; setExpanded(next);
    if (!next || translation || loading) return;
    if (!online) { setError('开启联网翻译后可查看中文'); return; }
    setLoading(true); setError('');
    try {
      const response = await browser.runtime.sendMessage({ type: 'FLOWWORD_TRANSLATE', sentence: line.text, context: [current] });
      if (!active.current) return;
      if (!response?.ok || !response.translation) throw new Error(response?.error || '译文暂不可用，点击收起后可重试');
      setTranslation(response.translation);
    } catch (failure) { if (active.current) setError(failure instanceof Error ? failure.message : '翻译失败，请重试'); }
    finally { if (active.current) setLoading(false); }
  }
  return <div className="fw-neighbor">
    <button type="button" className="fw-neighbor-toggle" aria-label={`${label}：${line.text}`} aria-expanded={expanded} title="点击展开或收起中文" onClick={() => void toggle()} lang="en">{line.text}</button>
    {expanded && <p className="fw-neighbor-translation" role="status">{translation || (loading ? '正在翻译…' : error)}</p>}
  </div>;
}
