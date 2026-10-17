import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import type { ArchiveCapture } from '../storage/archive';
import './word-lookup.css';

interface LookupResult { translation: string; examples: { sentence: string; translation: string }[] }

// WordLookup 表示主动查词面板，onClose用于返回词本，只有提交查找才请求模型与本地原句
// 生成例句明确标注为AI内容，不伪造视频来源，不自动收藏，旧请求在改查或卸载后忽略
export function WordLookup({ onClose }: { onClose(): void }) {
  const [text, setText] = useState(''); const [query, setQuery] = useState('');
  const [result, setResult] = useState<LookupResult>(); const [matches, setMatches] = useState<ArchiveCapture[]>([]);
  const [total, setTotal] = useState(0); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [localError, setLocalError] = useState(''); const [notice, setNotice] = useState('');
  const operation = useRef(0);
  const activeRequest = useRef('');
  useEffect(() => () => { operation.current++; if (activeRequest.current) void browser.runtime.sendMessage({ type: 'FLOWWORD_LOOKUP_CANCEL', requestId: activeRequest.current }).catch(() => {}); }, []);
  // lookup 提交当前单词或词组，无参数，两类请求独立完成，模型失败仍显示本地命中
  async function lookup() {
    const value = text.normalize('NFKC').trim().replace(/\s+/g, ' ');
    if (!value || value.length > 120) { setError('请输入 120 字以内的单词或词组'); return; }
    if (activeRequest.current) void browser.runtime.sendMessage({ type: 'FLOWWORD_LOOKUP_CANCEL', requestId: activeRequest.current }).catch(() => {});
    const id = ++operation.current; const requestId = crypto.randomUUID(); activeRequest.current = requestId;
    setQuery(value); setResult(undefined); setMatches([]); setTotal(0); setError(''); setLocalError(''); setNotice(''); setBusy(true);
    const local = browser.runtime.sendMessage({ type: 'FLOWWORD_LOOKUP_LOCAL', text: value }).then((response) => {
      if (id !== operation.current) return;
      if (!response?.ok) throw new Error(response?.error || '收藏原句暂不可用');
      setMatches(Array.isArray(response.matches) ? response.matches : []); setTotal(response.total || 0);
    }).catch((failure) => { if (id === operation.current) setLocalError(failure instanceof Error ? failure.message : '收藏原句读取失败'); });
    const generated = browser.runtime.sendMessage({ type: 'FLOWWORD_LOOKUP', text: value, requestId }).then((response) => {
      if (id !== operation.current) return;
      if (!response?.ok) throw new Error(response?.error || '查词服务暂不可用，请检查模型设置');
      setResult({ translation: response.translation || '', examples: Array.isArray(response.examples) ? response.examples : [] });
    }).catch((failure) => { if (id === operation.current) setError(failure instanceof Error ? failure.message : '查词失败'); });
    await Promise.all([local, generated]); if (id === operation.current) { activeRequest.current = ''; setBusy(false); }
  }
  // copy 复制本次释义和生成例句，无参数，只在用户点击后写剪贴板
  async function copy() {
    try { await navigator.clipboard.writeText([query, result?.translation, ...result?.examples.map((example) => `${example.sentence}\n${example.translation}`) || []].filter(Boolean).join('\n\n')); setNotice('已复制'); }
    catch { setNotice('复制失败，请手动选择文字'); }
  }
  // openSource 打开真实收藏来源，source保留原网页定位与视频时间，后台校验权限
  async function openSource(source: ArchiveCapture) {
    try { const response = await browser.runtime.sendMessage({ type: 'FLOWWORD_REPLAY_SOURCE', source }); if (!response?.ok) throw new Error(response?.error || '来源打开失败'); }
    catch (failure) { setNotice(failure instanceof Error ? failure.message : '来源打开失败'); }
  }
  return <section className="fw-word-lookup" aria-label="查单词与词组">
    <header><div><h2>查词</h2><p>释义、例句与自己的收藏原句</p></div><button type="button" onClick={onClose}>返回词本</button></header>
    <form onSubmit={(event) => { event.preventDefault(); if (event.nativeEvent.isTrusted && !busy) void lookup(); }}><label htmlFor="fw-lookup-text">单词或词组</label><div className="fw-lookup-input"><input id="fw-lookup-text" maxLength={120} value={text} placeholder="例如 take for granted" onChange={(event) => setText(event.target.value)} /><button type="submit" disabled={busy || !text.trim()}>{busy ? '查找中…' : '查找'}</button></div><small>点击查找后生成例句，可能产生模型费用</small></form>
    {error && <p role="alert">{error}</p>}
    {result && <article className="fw-lookup-definition"><div className="fw-lookup-title"><h3 lang="en">{query}</h3><button type="button" onClick={() => void copy()}>复制</button></div><p>{result.translation}</p><h4>AI 生成例句</h4>{result.examples.map((example, index) => <blockquote key={index}><p lang="en">{example.sentence}</p><p>{example.translation}</p></blockquote>)}</article>}
    {query && <section className="fw-lookup-sources"><h3>收藏中的原句 <span>{total} 条</span></h3>{localError ? <p role="alert">{localError}</p> : matches.length ? <><p className="fw-lookup-hint">来自真实收藏，最多显示 20 条</p>{matches.map((source) => <article key={source.id}><p lang="en">{source.sentence}</p>{source.translation && <p>{source.translation}</p>}<button type="button" onClick={() => void openSource(source)}>{source.title || new URL(source.url).hostname} · {source.source?.kind === 'web' ? '回到原文' : '听原句'}</button></article>)}</> : <p className="fw-lookup-hint">{busy ? '正在搜索收藏原句…' : '收藏中没有包含这个词或词组的原句'}</p>}</section>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
