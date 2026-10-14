import { useState } from 'react';
import type { WordbookEntry } from '../core/types';

export const EXAM_TAGS = ['词义辨析', '固定搭配', '短语动词', '语法结构', '听力理解', '写作表达', '四级', '六级', '考研', '雅思', '托福'];
export const PARTS = ['未分类', '名词', '动词', '形容词', '副词', '介词', '连词', '代词', '短语', '句子', '其他'];

export function SaveEntryForm({ draft, onSave, onCancel }: { draft: WordbookEntry; onSave(value: WordbookEntry): Promise<void>; onCancel(): void }) {
  const [entry, setEntry] = useState(draft);
  const [tags, setTags] = useState(draft.tags.join('，'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  return <form className="fw-save-form" onSubmit={(event) => {
    event.preventDefault(); setSaving(true); setError('');
    void onSave({ ...entry, tags: tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean) }).catch((error) => setError(error instanceof Error ? error.message : '保存失败')).finally(() => setSaving(false));
  }}>
    <h2>加入单词本</h2>
    <p className="fw-settings-intro">词汇类型与考点由你选择，可同时属于多个分类</p>
    <label>原文<textarea aria-label="原文" required value={entry.text} maxLength={2000} onChange={(event) => setEntry({ ...entry, text: event.target.value, lemma: event.target.value })} /></label>
    <label>中文释义 / 译文<textarea aria-label="中文释义 / 译文" value={entry.translation} maxLength={6000} placeholder="可填写自己的理解" onChange={(event) => setEntry({ ...entry, translation: event.target.value })} /></label>
    <div className="fw-form-row"><label>条目类型<select aria-label="条目类型" value={entry.kind} onChange={(event) => setEntry({ ...entry, kind: event.target.value as WordbookEntry['kind'] })}><option value="word">单词</option><option value="phrase">短语</option><option value="sentence">语句</option></select></label>
      <label>词汇类型<select aria-label="词汇类型" value={entry.partOfSpeech} onChange={(event) => setEntry({ ...entry, partOfSpeech: event.target.value })}>{PARTS.map((part) => <option key={part}>{part}</option>)}</select></label></div>
    <fieldset><legend>考点 / 考试分类 · 多选</legend><div className="fw-tag-options">{EXAM_TAGS.map((tag) => <label key={tag}><input type="checkbox" checked={entry.examTags.includes(tag)} onChange={(event) => setEntry({ ...entry, examTags: event.target.checked ? [...entry.examTags, tag] : entry.examTags.filter((value) => value !== tag) })} />{tag}</label>)}</div></fieldset>
    <label>自定义标签<input aria-label="自定义标签" value={tags} placeholder="用逗号分隔，例如：SQL，工作表达" onChange={(event) => setTags(event.target.value)} /></label>
    {error && <p role="alert">{error}</p>}
    <div className="fw-save-actions"><button type="button" className="fw-retry" onClick={onCancel}>返回翻译</button><button type="submit" className="fw-primary" disabled={saving}>{saving ? '正在保存' : '保存到单词本'}</button></div>
  </form>;
}
