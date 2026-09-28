export type NovaPulseWeatherConditionGroup =
  | 'clear'
  | 'partly_cloudy'
  | 'cloudy'
  | 'rain'
  | 'storm'
  | 'snow'
  | 'fog';

export type NovaPulseWeatherTheme = 'generic' | 'urban' | 'coastal' | 'desert' | 'mountain';
export type NovaPulseWeatherTime = 'day' | 'night';

export type NovaPulseWeatherArtSelection = {
  key: string;
  conditionGroup: NovaPulseWeatherConditionGroup;
  theme: NovaPulseWeatherTheme;
  time: NovaPulseWeatherTime;
};

const THEMES: readonly NovaPulseWeatherTheme[] = ['generic', 'urban', 'coastal', 'desert', 'mountain'];

export function normalizeNovaPulseWeatherTheme(value: unknown): NovaPulseWeatherTheme {
  return typeof value === 'string' && THEMES.includes(value.trim().toLowerCase() as NovaPulseWeatherTheme)
    ? value.trim().toLowerCase() as NovaPulseWeatherTheme
    : 'generic';
}

export function normalizeNovaPulseWeatherCondition(value: unknown): NovaPulseWeatherConditionGroup {
  const condition = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (/thunder|storm|lightning/.test(condition)) return 'storm';
  if (/snow|sleet|ice|blizzard/.test(condition)) return 'snow';
  if (/rain|drizzle|shower/.test(condition)) return 'rain';
  if (/fog|mist|haze/.test(condition)) return 'fog';
  if (/partly|mostly sunny|scattered/.test(condition)) return 'partly_cloudy';
  if (/cloud|overcast/.test(condition)) return 'cloudy';
  if (/clear|sunny/.test(condition)) return 'clear';
  return 'cloudy';
}

export function resolveNovaPulseWeatherArt(input: {
  condition: unknown;
  isDay?: boolean;
  marketTheme?: unknown;
}): NovaPulseWeatherArtSelection {
  const conditionGroup = normalizeNovaPulseWeatherCondition(input.condition);
  const theme = normalizeNovaPulseWeatherTheme(input.marketTheme);
  const time: NovaPulseWeatherTime = input.isDay === false ? 'night' : 'day';
  const exactKey = `${theme}_${conditionGroup}_${time}`;
  const genericKey = `generic_${conditionGroup}_${time}`;
  return {
    key: theme === 'generic' ? genericKey : exactKey,
    conditionGroup,
    theme,
    time,
  };
}

export function weatherArtFallbackChain(selection: NovaPulseWeatherArtSelection): string[] {
  const genericKey = `generic_${selection.conditionGroup}_${selection.time}`;
  return Array.from(new Set([
    selection.key,
    genericKey,
    `generic_cloudy_${selection.time}`,
    'generic_cloudy_day',
  ]));
}

export function parseNovaPulseWeatherArtKey(key: string | undefined): NovaPulseWeatherArtSelection {
  const match = /^(generic|urban|coastal|desert|mountain)_(clear|partly_cloudy|cloudy|rain|storm|snow|fog)_(day|night)$/.exec(key ?? '');
  if (match) {
    return {
      key: match[0],
      conditionGroup: match[2] as NovaPulseWeatherConditionGroup,
      theme: match[1] as NovaPulseWeatherTheme,
      time: match[3] as NovaPulseWeatherTime,
    };
  }
  return resolveNovaPulseWeatherArt({ condition: 'unknown', isDay: true, marketTheme: 'generic' });
}
