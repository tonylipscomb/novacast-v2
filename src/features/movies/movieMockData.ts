import type { MovieCategory, MovieSummary } from './movieTypes.ts';

export const MOVIE_PAGE_SIZE = 30;

export const MOCK_MOVIE_CATEGORIES: MovieCategory[] = (
  [
    { id: 'all', name: 'All Movies', count: 12842 },
    { id: 'action', name: 'Action', count: 2156 },
    { id: 'adventure', name: 'Adventure', count: 1103 },
    { id: 'animation', name: 'Animation', count: 612 },
    { id: 'comedy', name: 'Comedy', count: 1843 },
    { id: 'crime', name: 'Crime', count: 1256 },
    { id: 'documentary', name: 'Documentary', count: 908 },
    { id: 'drama', name: 'Drama', count: 2342 },
    { id: 'family', name: 'Family', count: 1287 },
    { id: 'fantasy', name: 'Fantasy', count: 1024 },
    { id: 'history', name: 'History', count: 554 },
    { id: 'horror', name: 'Horror', count: 1108 },
    { id: 'music', name: 'Music', count: 312 },
    { id: 'romance', name: 'Romance', count: 1538 },
    { id: 'sci-fi', name: 'Sci-Fi', count: 1465 },
    { id: 'thriller', name: 'Thriller', count: 2003 },
  ] satisfies Omit<MovieCategory, 'renderKey'>[]
).map((category) => ({ ...category, renderKey: category.id }));

const TITLE_SEEDS = [
  'Dust Horizon',
  'Black Signal',
  'Velocity Run',
  'Ocean of Glass',
  'Last Orbit',
  'Night Circuit',
  'Red Valley',
  'Silent Harbor',
  'Beyond Tomorrow',
  'Iron Meridian',
  'The Long Winter',
  'Static Hearts',
  'Neon Divide',
  'Cold Meridian',
  'Solar Echo',
  'Glass Kingdom',
];

const POSTER_STYLE_KEYS = [
  'ember',
  'signal',
  'glacier',
  'orbit',
  'midnight',
  'onyx',
  'aurora',
  'dune',
] as const;

const DIRECTORS = [
  'Avery Quinn',
  'Mina Hart',
  'Noah Sloane',
  'Iris Vale',
  'Jonah Mercer',
  'Talia Reed',
  'Cassian Holt',
  'Leona Pike',
];

const CAST_POOL = [
  'Lena Ortiz',
  'Kai Mercer',
  'Nadia Bloom',
  'Theo Cross',
  'Mara Vale',
  'Eli Mercer',
  'Sora Hale',
  'Jules Vega',
  'Rina Park',
  'Owen Frost',
];

const CATEGORY_GENRES: Record<string, string[]> = {
  all: ['Sci-Fi', 'Adventure'],
  action: ['Action', 'Thriller'],
  adventure: ['Adventure', 'Drama'],
  animation: ['Animation', 'Family'],
  comedy: ['Comedy'],
  crime: ['Crime', 'Mystery'],
  documentary: ['Documentary'],
  drama: ['Drama'],
  family: ['Family', 'Adventure'],
  fantasy: ['Fantasy', 'Adventure'],
  history: ['History', 'Drama'],
  horror: ['Horror', 'Thriller'],
  music: ['Music', 'Drama'],
  romance: ['Romance', 'Drama'],
  'sci-fi': ['Sci-Fi', 'Adventure'],
  thriller: ['Thriller', 'Mystery'],
};

const CATEGORY_SEQUENCE = MOCK_MOVIE_CATEGORIES.filter((category) => category.id !== 'all');
const TITLE_VARIANTS = ['', ' II', ': Echo', ': Aftermath', ': Zero', ': Legacy'];

function formatDuration(index: number) {
  return 92 + ((index * 11) % 52);
}

function formatScore(index: number) {
  return Number((7.4 + ((index * 5) % 15) / 10).toFixed(1));
}

function makeMovie(categoryId: string, categoryIndex: number, slot: number): MovieSummary {
  const titleSeed = TITLE_SEEDS[(categoryIndex * 4 + slot) % TITLE_SEEDS.length];
  const suffix = TITLE_VARIANTS[(categoryIndex + slot) % TITLE_VARIANTS.length];
  const title = `${titleSeed}${suffix}`;
  const year = 2020 + ((categoryIndex + slot) % 7);
  const durationMinutes = formatDuration(categoryIndex * 8 + slot);
  const rating = ['PG', 'PG-13', 'R'][((categoryIndex + slot) % 3)];
  const genres = CATEGORY_GENRES[categoryId] ?? CATEGORY_GENRES.all;
  const director = DIRECTORS[(categoryIndex + slot) % DIRECTORS.length];
  const cast = [
    CAST_POOL[(categoryIndex + slot) % CAST_POOL.length],
    CAST_POOL[(categoryIndex + slot + 3) % CAST_POOL.length],
    CAST_POOL[(categoryIndex + slot + 6) % CAST_POOL.length],
  ];

  return {
    id: `${categoryId}-${String(categoryIndex).padStart(2, '0')}-${String(slot).padStart(2, '0')}`,
    categoryId,
    title,
    year,
    durationMinutes,
    rating,
    genres,
    description:
      'A stranded navigator crosses a collapsing desert world while protecting a signal that could reconnect the last surviving colonies.',
    director,
    cast,
    audio: slot % 2 === 0 ? 'English 5.1' : 'English Atmos',
    subtitles: slot % 3 === 0 ? 'English' : 'English, Spanish',
    score: formatScore(categoryIndex + slot),
    audienceScore: 78 + ((categoryIndex * 3 + slot) % 16),
    externalScore: Number((7.0 + ((categoryIndex + slot * 2) % 14) / 10).toFixed(1)),
    posterStyleKey: POSTER_STYLE_KEYS[(categoryIndex + slot) % POSTER_STYLE_KEYS.length],
  };
}

function buildMoviesForCategory(categoryId: string, categoryIndex: number) {
  return Array.from({ length: 6 }, (_, slot) => makeMovie(categoryId, categoryIndex, slot));
}

export const MOCK_MOVIES: MovieSummary[] = CATEGORY_SEQUENCE.flatMap((category, index) =>
  buildMoviesForCategory(category.id, index),
);

export const MOCK_MOVIES_BY_CATEGORY = MOCK_MOVIES.reduce<Record<string, MovieSummary[]>>((acc, movie) => {
  if (!acc[movie.categoryId]) {
    acc[movie.categoryId] = [];
  }

  acc[movie.categoryId].push(movie);
  return acc;
}, {});

export const MOCK_ALL_MOVIES: MovieSummary[] = [
  ...buildMoviesForCategory('all', 0),
  ...MOCK_MOVIES,
];

export function normalizeQuery(query: string) {
  return query.trim().toLowerCase();
}

export function matchesMovie(movie: MovieSummary, query: string) {
  const normalized = normalizeQuery(query);
  if (!normalized) {
    return true;
  }

  const haystack = [
    movie.title,
    movie.genres.join(' '),
    movie.description ?? '',
    movie.director ?? '',
    movie.cast?.join(' ') ?? '',
    movie.rating ?? '',
  ]
    .join(' ')
    .toLowerCase();

  return haystack.includes(normalized);
}
