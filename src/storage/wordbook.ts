import type { WordbookEntry } from '../core/types';
import { allCanonicalEntries, deleteEntries, saveCanonical } from './archive';

export { validateEntry, mergeEntries, BACKUP_LIMITS } from './data-validation';
export { queryEntries, savedEntryIds, videoSummaries, bookSummary, entryOccurrences, updateOccurrence, batchEntries, deleteEntries, undoDelete, exportBackup, importBackup, validateBackup, reviewDue, gradeReview } from './archive';
export type { WordbookBackup, ResolvedOccurrence, ReviewCard } from './archive';

// saveEntry 保存value收藏或编辑replaceId旧词条，词条和语境由同一库事务提交
// 普通重复收藏合并标签，明确编辑替换分类，失败不留下半成功资料
export async function saveEntry(value: unknown, replaceId?: string): Promise<WordbookEntry> { return saveCanonical(value, replaceId); }

// allEntries 读取完整收藏列表，无参数，仅兼容旧界面和收藏状态检查
// Quick和完整词本列表优先使用queryEntries分页，首次调用会安全迁移旧库
export async function allEntries(): Promise<WordbookEntry[]> { return allCanonicalEntries(); }

// deleteEntry 按id删除单条收藏及语境关联，视频历史继续保留
// 需要撤销时用deleteEntries取得undoToken，此兼容入口只等待原子提交
export async function deleteEntry(id: string): Promise<void> { await deleteEntries([id]); }

// restoreEntry 恢复value单条旧备份并保留创建日期，现有编辑和复习计划优先
// 新版整份备份必须用importBackup，不可循环本接口代替原子导入
export async function restoreEntry(value: unknown): Promise<WordbookEntry> { return saveCanonical(value, undefined, true); }
