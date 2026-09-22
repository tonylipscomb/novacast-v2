export const MAX_TRANSLATION_TEXT_BYTES = 16 * 1024;
export const MAX_TRANSLATION_TEXT_LENGTH = 4_000;

export type TranslationRequest = {
  providerId: string;
  mediaType: 'movie' | 'series';
  itemId: string;
  sourceText: string;
  sourceTextHash: string;
  targetLanguage: 'en';
};

export function isValidTranslationRequest(value: unknown): value is TranslationRequest {
  if (!value || typeof value !== 'object') return false;
  const input = value as Partial<TranslationRequest>;
  return typeof input.providerId === 'string' && input.providerId.length > 0 && input.providerId.length <= 200 &&
    (input.mediaType === 'movie' || input.mediaType === 'series') &&
    typeof input.itemId === 'string' && input.itemId.length > 0 && input.itemId.length <= 200 &&
    typeof input.sourceText === 'string' && input.sourceText.trim().length > 0 && input.sourceText.length <= MAX_TRANSLATION_TEXT_LENGTH &&
    typeof input.sourceTextHash === 'string' && /^[a-f0-9]{8,64}$/i.test(input.sourceTextHash) &&
    input.targetLanguage === 'en';
}

export function normalizeTranslatedText(value: unknown) {
  if (typeof value !== 'string') return null;
  const text = value.trim().slice(0, MAX_TRANSLATION_TEXT_LENGTH);
  return text || null;
}
