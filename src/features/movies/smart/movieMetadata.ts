const GENRE_KEYWORDS: Record<string, string[]> = {
  action: ['action', 'martial', 'war', 'battle'],
  comedy: ['comedy', 'funny', 'laugh'],
  horror: ['horror', 'zombie', 'vampire', 'nightmare', 'haunt'],
  family: ['family', 'disney', 'pixar', 'kids'],
  kids: ['kids', 'child', 'cartoon', 'barney', 'peppa'],
  scifi: ['sci-fi', 'scifi', 'space', 'alien', 'star trek', 'star wars', 'interstellar'],
  romance: ['romance', 'romantic', 'love story'],
  crime: ['crime', 'detective', 'mafia', 'gangster'],
  thriller: ['thriller', 'suspense', 'mystery'],
  documentary: ['documentary', 'docu'],
  animation: ['animation', 'animated', 'anime'],
  superhero: ['superhero', 'marvel', 'dc', 'batman', 'spider-man', 'avengers'],
  christmas: ['christmas', 'xmas', 'santa', 'holiday'],
  halloween: ['halloween', 'horror night'],
  documentary2: ['based on a true story', 'true story'],
};

export function parseRatingNumber(rating?: string | number) {
  if (typeof rating === 'number' && Number.isFinite(rating)) {
    return rating;
  }

  if (typeof rating === 'string') {
    const parsed = Number.parseFloat(rating);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

export function parseYearFromTitle(title: string) {
  const match = title.match(/\((19|20)\d{2}\)/);
  if (match) {
    return Number.parseInt(match[0].slice(1, 5), 10);
  }

  const trailing = title.match(/\b(19|20)\d{2}\b/);
  if (trailing) {
    return Number.parseInt(trailing[0], 10);
  }

  return undefined;
}

export function parseYearFromStreamFields(
  title: string,
  fields: { releasedate?: unknown; releaseDate?: unknown; year?: unknown; added?: unknown },
) {
  for (const candidate of [fields.releasedate, fields.releaseDate, fields.year]) {
    if (typeof candidate === 'number' && candidate >= 1900 && candidate <= 2100) {
      return candidate;
    }

    if (typeof candidate === 'string' && candidate.trim()) {
      const parsedDate = Date.parse(candidate);
      if (Number.isFinite(parsedDate)) {
        return new Date(parsedDate).getFullYear();
      }

      const yearMatch = candidate.match(/\b(19|20)\d{2}\b/);
      if (yearMatch) {
        return Number.parseInt(yearMatch[0], 10);
      }
    }
  }

  const fromTitle = parseYearFromTitle(title);
  if (fromTitle) {
    return fromTitle;
  }

  const addedYear = parseAddedTimestamp(typeof fields.added === 'string' ? fields.added : undefined);
  if (addedYear > 0) {
    return new Date(addedYear).getFullYear();
  }

  return undefined;
}

export function parseAddedTimestamp(added?: string) {
  if (!added?.trim()) {
    return 0;
  }

  const numeric = Number(added);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
  }

  const parsed = Date.parse(added);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function inferGenreTags(title: string, genres: string[] = []) {
  const haystack = `${title} ${genres.join(' ')}`.toLowerCase();
  const tags = new Set<string>();

  for (const [tag, keywords] of Object.entries(GENRE_KEYWORDS)) {
    if (keywords.some((keyword) => haystack.includes(keyword))) {
      tags.add(tag === 'documentary2' ? 'true-story' : tag);
    }
  }

  return [...tags];
}

export function isSeasonalActive(tag: 'christmas' | 'halloween', now = new Date()) {
  const month = now.getMonth() + 1;
  if (tag === 'christmas') {
    return month === 11 || month === 12;
  }

  return month === 9 || month === 10;
}
