import type { WordbookEntry } from './types';

export function filterWordbook(entries: WordbookEntry[], filters: { search: string; kind: string; part: string; exam: string; tag: string }): WordbookEntry[] {
  const query = filters.search.trim().toLowerCase();
  return entries.filter((entry) => (!filters.kind || entry.kind === filters.kind)
    && (!filters.part || entry.partOfSpeech === filters.part)
    && (!filters.exam || entry.examTags.includes(filters.exam))
    && (!filters.tag || entry.tags.includes(filters.tag))
    && (!query || `${entry.text} ${entry.translation} ${entry.tags.join(' ')} ${entry.examTags.join(' ')}`.toLowerCase().includes(query)));
}
