import { enrichChannelWithEpg } from '../live/liveTvChannelEpg.ts';
import type { ProviderGuideProgram, ProviderLiveCategory, ProviderLiveChannel } from '../providers/providerRepositories.ts';

const US_ENTERTAINMENT_PATTERN =
  /\bUS\b[\s|–—-]+Entertainment\b|\bEntertainment\b[\s|–—-]+\bUS\b/i;

export function findUsEntertainmentCategory(categories: ProviderLiveCategory[]) {
  const direct = categories.find((category) => US_ENTERTAINMENT_PATTERN.test(category.name));
  if (direct) {
    return direct;
  }

  return categories.find(
    (category) => /\bUS\b/i.test(category.name) && /entertainment/i.test(category.name),
  );
}

function pickCategoryWithMostChannels(categories: ProviderLiveCategory[]) {
  return categories.reduce<ProviderLiveCategory | null>((best, category) => {
    if (!best || (category.count ?? 0) > (best.count ?? 0)) {
      return category;
    }

    return best;
  }, null);
}

export function findLiveNowCategory(categories: ProviderLiveCategory[]) {
  const usEntertainment = findUsEntertainmentCategory(categories);
  if (usEntertainment) {
    return usEntertainment;
  }

  const entertainmentCategories = categories.filter((category) => /entertainment/i.test(category.name));
  if (entertainmentCategories.length) {
    return pickCategoryWithMostChannels(entertainmentCategories);
  }

  return pickCategoryWithMostChannels(categories);
}

export function pickRandomChannels(channels: ProviderLiveChannel[], count: number) {
  if (channels.length <= count) {
    return [...channels];
  }

  const pool = [...channels];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
  }

  return pool.slice(0, count);
}

export async function loadRandomUsEntertainmentChannels(
  getCategories: () => Promise<ProviderLiveCategory[]>,
  getChannels: (categoryId: string) => Promise<ProviderLiveChannel[]>,
  getShortEpg?: (
    channelId: string,
    limit?: number,
    signal?: AbortSignal,
    epgChannelId?: string,
  ) => Promise<ProviderGuideProgram[]>,
  count = 3,
) {
  const categories = await getCategories().catch(() => []);
  if (!categories.length) {
    return [];
  }

  const preferred = findLiveNowCategory(categories);
  const candidates = preferred ? [preferred] : categories;
  const ordered = [...candidates, ...categories.filter((category) => !candidates.includes(category))];

  for (const category of ordered) {
    const channels = await getChannels(category.id).catch(() => []);
    if (channels.length) {
      const picks = pickRandomChannels(channels, count);
      if (!getShortEpg) {
        return picks;
      }

      return Promise.all(
        picks.map(async (channel) => {
          const programs = await getShortEpg(channel.id, 3, undefined, channel.epgChannelId).catch(() => []);
          return enrichChannelWithEpg(channel, programs);
        }),
      );
    }
  }

  return [];
}
