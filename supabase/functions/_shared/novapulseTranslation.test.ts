import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  isValidTranslationRequest,
  normalizeTranslatedText,
  MAX_TRANSLATION_TEXT_LENGTH,
} from './novapulseTranslation.ts';

const base = {
  providerId: 'provider-1', mediaType: 'movie' as const, itemId: 'movie-1',
  sourceText: 'Una historia de detectives.', sourceTextHash: 'abcdef12', targetLanguage: 'en' as const,
};

Deno.test('accepts bounded Spanish and Polish translation requests', () => {
  assertEquals(isValidTranslationRequest(base), true);
  assertEquals(isValidTranslationRequest({ ...base, mediaType: 'series', sourceText: 'To jest opis serialu.' }), true);
});

Deno.test('rejects empty, oversized, or non-English-target requests', () => {
  assertEquals(isValidTranslationRequest({ ...base, sourceText: '' }), false);
  assertEquals(isValidTranslationRequest({ ...base, sourceText: 'x'.repeat(MAX_TRANSLATION_TEXT_LENGTH + 1) }), false);
  assertEquals(isValidTranslationRequest({ ...base, targetLanguage: 'pl' }), false);
});

Deno.test('normalizes only nonempty translated text and bounds its length', () => {
  assertEquals(normalizeTranslatedText('  English plot  '), 'English plot');
  assertEquals(normalizeTranslatedText(''), null);
  assertEquals(normalizeTranslatedText(null), null);
  assertEquals(normalizeTranslatedText('x'.repeat(MAX_TRANSLATION_TEXT_LENGTH + 20))?.length, MAX_TRANSLATION_TEXT_LENGTH);
});
