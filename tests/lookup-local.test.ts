import { beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
vi.mock('wxt/browser', () => ({ browser: { runtime: { id: 'fixture', getURL: (path: string) => `chrome-extension://fixture${path}` } } }));
let lookup: typeof import('../src/services/lookup-local-messages');
let archive: typeof import('../src/storage/archive');
beforeEach(async () => { vi.resetModules(); vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('IDBKeyRange', IDBKeyRange); archive = await import('../src/storage/archive'); lookup = await import('../src/services/lookup-local-messages'); });
it('matches whole words and normalized phrases without compound or substring false positives', () => {
  expect(lookup.lookupSentenceMatches('I understand this.', 'stand')).toBe(false);
  expect(lookup.lookupSentenceMatches('A stand-alone solution.', 'stand')).toBe(false);
  expect(lookup.lookupSentenceMatches('We take\nfor granted the result.', 'take for granted')).toBe(true);
  expect(lookup.lookupSentenceMatches('Charge the device.', 'charge')).toBe(true);
  expect(lookup.lookupSentenceMatches('This is C++ code.', 'C++')).toBe(true);
});
it('validates bounded lookup text and rejects foreign senders', async () => {
  expect(lookup.normalizeLookupText('  take   for granted ')).toBe('take for granted');
  expect(() => lookup.normalizeLookupText('x'.repeat(121))).toThrow();
  expect(await lookup.handleLookupLocalMessage({ type: 'FLOWWORD_LOOKUP_LOCAL', text: 'charge' }, { id: 'foreign', url: 'https://example.test' })).toMatchObject({ ok: false });
});
it('scans all archived captures, excludes orphan captures and caps returned rows at twenty', async () => {
  const db = await archive.canonicalDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['captures', 'occurrences'], 'readwrite');
    for (let index = 0; index < 26; index++) {
      tx.objectStore('captures').put({ id: `c${index}`, sentence: `Please charge device ${index}.`, url: 'https://example.test/article', source: { kind: 'web' } });
      if (index < 25) tx.objectStore('occurrences').put({ id: `o${index}`, captureId: `c${index}`, entryId: 'word:device', translation: '设备' });
    }
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
  });
  const result = await lookup.searchSavedSentences('charge');
  expect(result.total).toBe(25); expect(result.matches).toHaveLength(20);
  expect(result.matches.every((capture) => capture.source?.kind === 'web' && capture.time === undefined)).toBe(true);
});
