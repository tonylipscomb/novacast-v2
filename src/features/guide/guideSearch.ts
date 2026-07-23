import type { NormalizedGuideRow } from './guideTimeline';

import { buildSearchHaystack, matchesSearchQuery } from '../search/searchRanking.ts';
import { normalizeSearchQuery } from '../search/searchQuery.ts';

export type GuideFilter = 'all' | 'favorites';

export function filterGuideRows(rows: NormalizedGuideRow[], filter: GuideFilter, favoriteIds: ReadonlySet<string>, query: string) {
  const normalizedQuery = normalizeSearchQuery(query);

  return rows
    .map((row) => {
      const channelHaystack = buildSearchHaystack([row.channel.name, row.channel.number]);
      const channelMatches =
        !normalizedQuery ||
        matchesSearchQuery(query, { title: row.channel.name, metadata: channelHaystack }) ||
        String(row.channel.number) === normalizedQuery;
      const programs = row.programs.filter((program) => {
        if (!normalizedQuery) {
          return true;
        }

        const programHaystack = buildSearchHaystack([program.title, program.description, row.channel.name]);
        return (
          channelMatches ||
          matchesSearchQuery(query, { title: program.title, metadata: programHaystack }) ||
          programHaystack.includes(normalizedQuery)
        );
      });
      const matchesFilter = filter === 'all' || favoriteIds.has(row.channel.id);
      if (!matchesFilter || (normalizedQuery && !channelMatches && !programs.length)) return null;
      return { ...row, programs: normalizedQuery && !channelMatches ? programs : row.programs };
    })
    .filter((row): row is NormalizedGuideRow => Boolean(row));
}
