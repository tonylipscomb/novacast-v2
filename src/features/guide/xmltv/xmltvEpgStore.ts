import * as SQLite from 'expo-sqlite';

import {
  normalizeXmltvChannelId,
  normalizeXmltvDisplayName,
  type ParsedXmltvChannel,
  type ParsedXmltvProgramme,
} from './xmltvParser';

const DATABASE_NAME = 'novacast-guide-epg.db';

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync(DATABASE_NAME);
  }

  const database = await databasePromise;

  await database.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS guide_xmltv_channels (
      provider_key TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      display_name TEXT,
      programmes_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (provider_key, channel_id)
    );

    CREATE INDEX IF NOT EXISTS idx_guide_xmltv_provider_channel
      ON guide_xmltv_channels(provider_key, channel_id);

    CREATE TABLE IF NOT EXISTS guide_xmltv_channel_name_index (
      provider_key TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      display_name TEXT,
      indexed_at INTEGER NOT NULL,
      PRIMARY KEY (provider_key, normalized_name, channel_id)
    );

    CREATE INDEX IF NOT EXISTS idx_guide_xmltv_name_provider
      ON guide_xmltv_channel_name_index(provider_key, normalized_name);

    CREATE TABLE IF NOT EXISTS guide_xmltv_channel_name_meta (
      provider_key TEXT PRIMARY KEY NOT NULL,
      indexed_at INTEGER NOT NULL,
      channel_count INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS guide_xmltv_channel_name_stats (
      provider_key TEXT PRIMARY KEY NOT NULL,
      channel_element_count INTEGER NOT NULL,
      display_name_count INTEGER NOT NULL,
      channels_with_display_name INTEGER NOT NULL,
      channels_with_multiple_display_names INTEGER NOT NULL,
      unique_normalized_name_count INTEGER NOT NULL,
      ambiguous_normalized_name_count INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS guide_xmltv_meta (
      provider_key TEXT PRIMARY KEY NOT NULL,
      imported_at INTEGER NOT NULL,
      channel_count INTEGER NOT NULL,
      programme_count INTEGER NOT NULL,
      malformed_programme_count INTEGER NOT NULL
    );
  `);

  return database;
}

type StoredProgrammeRow = {
  channel_id: string;
  programmes_json: string;
};

type MetaRow = {
  imported_at: number;
  channel_count: number;
  programme_count: number;
  malformed_programme_count: number;
};

export type XmltvCacheMeta = {
  importedAt: number;
  channelCount: number;
  programmeCount: number;
  malformedProgrammeCount: number;
};

export type XmltvChannelNameIndexEntry = {
  channelId: string;
  displayName: string;
};

export type XmltvChannelIndexDiagnostics = {
  xmltvChannelElementCount: number;
  xmltvDisplayNameCount: number;
  xmltvChannelsWithDisplayName: number;
  xmltvChannelsWithMultipleDisplayNames: number;
  uniqueNormalizedNameCount: number;
  ambiguousNormalizedNameCount: number;
};

export type XmltvChannelIndexData = {
  namesByChannelId: Map<string, string[]>;
  namesToChannels: Map<string, XmltvChannelNameIndexEntry[]>;
  diagnostics: XmltvChannelIndexDiagnostics;
};

export async function replaceProviderXmltvCache(
  providerKey: string,
  channels: ParsedXmltvChannel[],
  programmes: ParsedXmltvProgramme[],
  malformedProgrammeCount: number,
): Promise<void> {
  const database = await getDatabase();

  const normalizedProviderKey = providerKey.trim();

  if (!normalizedProviderKey) {
    throw new Error('XMLTV provider cache key is required.');
  }

  const displayNames = new Map<string, string | undefined>();

  for (const channel of channels) {
    const normalizedId = normalizeXmltvChannelId(channel.id);

    if (!normalizedId) continue;

    if (!displayNames.has(normalizedId)) {
      displayNames.set(normalizedId, channel.displayName);
    }
  }

  const grouped = new Map<string, ParsedXmltvProgramme[]>();

  for (const programme of programmes) {
    const normalizedId = normalizeXmltvChannelId(programme.channelId);

    if (!normalizedId) continue;

    const existing = grouped.get(normalizedId);

    if (existing) {
      existing.push(programme);
    } else {
      grouped.set(normalizedId, [programme]);
    }
  }

  for (const list of grouped.values()) {
    list.sort((left, right) => left.startAt - right.startAt);
  }

  const channelIds = new Set<string>([
    ...displayNames.keys(),
    ...grouped.keys(),
  ]);

  const importedAt = Date.now();

  await database.withTransactionAsync(async () => {
    await database.runAsync(
      'DELETE FROM guide_xmltv_channels WHERE provider_key = ?',
      normalizedProviderKey,
    );

    for (const channelId of channelIds) {
      await database.runAsync(
        `
          INSERT OR REPLACE INTO guide_xmltv_channels (
            provider_key,
            channel_id,
            display_name,
            programmes_json,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?)
        `,
        normalizedProviderKey,
        channelId,
        displayNames.get(channelId) ?? null,
        JSON.stringify(grouped.get(channelId) ?? []),
        importedAt,
      );
    }

    await database.runAsync(
      `
        INSERT OR REPLACE INTO guide_xmltv_meta (
          provider_key,
          imported_at,
          channel_count,
          programme_count,
          malformed_programme_count
        )
        VALUES (?, ?, ?, ?, ?)
      `,
      normalizedProviderKey,
      importedAt,
      channelIds.size,
      programmes.length,
      malformedProgrammeCount,
    );
  });
}

export async function getXmltvCacheMeta(
  providerKey: string,
): Promise<XmltvCacheMeta | null> {
  const database = await getDatabase();

  const row = await database.getFirstAsync<MetaRow>(
    `
      SELECT
        imported_at,
        channel_count,
        programme_count,
        malformed_programme_count
      FROM guide_xmltv_meta
      WHERE provider_key = ?
    `,
    providerKey.trim(),
  );

  if (!row) return null;

  return {
    importedAt: Number(row.imported_at),
    channelCount: Number(row.channel_count),
    programmeCount: Number(row.programme_count),
    malformedProgrammeCount: Number(row.malformed_programme_count),
  };
}

export async function getCachedXmltvPrograms(
  providerKey: string,
  channelIds: string[],
  windowStartAt: number,
  windowEndAt: number,
  limitPerChannel = 24,
): Promise<Map<string, ParsedXmltvProgramme[]>> {
  const database = await getDatabase();

  const result = new Map<string, ParsedXmltvProgramme[]>();

  const normalizedIds = Array.from(
    new Set(
      channelIds
        .map(normalizeXmltvChannelId)
        .filter(Boolean),
    ),
  );

  if (!normalizedIds.length) {
    return result;
  }

  const placeholders = normalizedIds.map(() => '?').join(',');

  const rows = await database.getAllAsync<StoredProgrammeRow>(
    `
      SELECT channel_id, programmes_json
      FROM guide_xmltv_channels
      WHERE provider_key = ?
        AND channel_id IN (${placeholders})
    `,
    providerKey.trim(),
    ...normalizedIds,
  );

  for (const row of rows) {
    let parsed: ParsedXmltvProgramme[] = [];

    try {
      const value = JSON.parse(row.programmes_json);

      if (Array.isArray(value)) {
        parsed = value;
      }
    } catch {
      parsed = [];
    }

    const filtered = parsed
      .filter(programme => {
        const endAt = programme.endAt ?? programme.startAt;

        return (
          endAt >= windowStartAt &&
          programme.startAt <= windowEndAt
        );
      })
      .slice(0, Math.max(1, limitPerChannel));

    result.set(
      normalizeXmltvChannelId(row.channel_id),
      filtered,
    );
  }

  return result;
}

export async function getXmltvChannelNameIndex(
  providerKey: string,
): Promise<Map<string, XmltvChannelNameIndexEntry[]> | null> {
  const database = await getDatabase();
  const meta = await database.getFirstAsync<{ channel_count: number }>(
    'SELECT channel_count FROM guide_xmltv_channel_name_meta WHERE provider_key = ?',
    providerKey.trim(),
  );
  if (!meta || Number(meta.channel_count) <= 0) return null;
  const stats = await database.getFirstAsync<{ provider_key: string }>(
    'SELECT provider_key FROM guide_xmltv_channel_name_stats WHERE provider_key = ?',
    providerKey.trim(),
  );
  if (!stats) return null;

  const rows = await database.getAllAsync<{
    normalized_name: string;
    channel_id: string;
    display_name: string | null;
  }>(
    `SELECT normalized_name, channel_id, display_name
       FROM guide_xmltv_channel_name_index
      WHERE provider_key = ?`,
    providerKey.trim(),
  );
  const result = new Map<string, XmltvChannelNameIndexEntry[]>();
  for (const row of rows) {
    const name = normalizeXmltvDisplayName(row.normalized_name);
    const list = result.get(name) ?? [];
    list.push({ channelId: normalizeXmltvChannelId(row.channel_id), displayName: row.display_name ?? '' });
    result.set(name, list);
  }
  return result;
}

export async function getXmltvChannelIndexData(
  providerKey: string,
): Promise<XmltvChannelIndexData | null> {
  const database = await getDatabase();
  const stats = await database.getFirstAsync<XmltvChannelIndexDiagnostics>(
    `SELECT
      channel_element_count AS xmltvChannelElementCount,
      display_name_count AS xmltvDisplayNameCount,
      channels_with_display_name AS xmltvChannelsWithDisplayName,
      channels_with_multiple_display_names AS xmltvChannelsWithMultipleDisplayNames,
      unique_normalized_name_count AS uniqueNormalizedNameCount,
      ambiguous_normalized_name_count AS ambiguousNormalizedNameCount
     FROM guide_xmltv_channel_name_stats WHERE provider_key = ?`,
    providerKey.trim(),
  );
  if (!stats) return null;
  const rows = await database.getAllAsync<{
    normalized_name: string;
    channel_id: string;
  }>(
    `SELECT normalized_name, channel_id FROM guide_xmltv_channel_name_index WHERE provider_key = ?`,
    providerKey.trim(),
  );
  const namesByChannelId = new Map<string, string[]>();
  const namesToChannels = new Map<string, XmltvChannelNameIndexEntry[]>();
  for (const row of rows) {
    const name = normalizeXmltvDisplayName(row.normalized_name);
    const channelId = normalizeXmltvChannelId(row.channel_id);
    const channelNames = namesByChannelId.get(channelId) ?? [];
    if (!channelNames.includes(name)) channelNames.push(name);
    namesByChannelId.set(channelId, channelNames);
    const channels = namesToChannels.get(name) ?? [];
    if (!channels.some(channel => channel.channelId === channelId)) {
      channels.push({ channelId, displayName: name });
    }
    namesToChannels.set(name, channels);
  }
  return { namesByChannelId, namesToChannels, diagnostics: stats };
}

export async function replaceXmltvChannelNameIndex(
  providerKey: string,
  channels: ParsedXmltvChannel[],
): Promise<void> {
  const database = await getDatabase();
  const normalizedProviderKey = providerKey.trim();
  const indexedAt = Date.now();
  await database.withTransactionAsync(async () => {
    await database.runAsync(
      'DELETE FROM guide_xmltv_channel_name_index WHERE provider_key = ?',
      normalizedProviderKey,
    );
    const statements: string[] = [];
    for (const channel of channels) {
      const name = normalizeXmltvDisplayName(channel.displayName);
      const id = normalizeXmltvChannelId(channel.id);
      if (!name || !id) continue;
      const aliases = channel.displayNames?.length ? channel.displayNames : [channel.displayName].filter(Boolean) as string[];
      for (const alias of aliases) {
        const normalizedAlias = normalizeXmltvDisplayName(alias);
        if (!normalizedAlias) continue;
        const sqlValue = (value: string | null) => `'${String(value ?? '').replace(/'/g, "''")}'`;
        statements.push(
          `INSERT OR IGNORE INTO guide_xmltv_channel_name_index
            (provider_key, normalized_name, channel_id, display_name, indexed_at)
           VALUES (${sqlValue(normalizedProviderKey)}, ${sqlValue(normalizedAlias)}, ${sqlValue(id)}, ${sqlValue(alias)}, ${indexedAt})`,
        );
      }
    }
    for (let index = 0; index < statements.length; index += 200) {
      await database.execAsync(statements.slice(index, index + 200).join(';'));
    }
    await database.runAsync(
      `INSERT OR REPLACE INTO guide_xmltv_channel_name_meta
        (provider_key, indexed_at, channel_count) VALUES (?, ?, ?)`,
      normalizedProviderKey,
      indexedAt,
      channels.filter(channel => normalizeXmltvChannelId(channel.id)).length,
    );

    const aliasesByName = new Map<string, Set<string>>();
    let displayNameCount = 0;
    let channelsWithDisplayName = 0;
    let channelsWithMultipleDisplayNames = 0;
    for (const channel of channels) {
      const aliases = (channel.displayNames?.length ? channel.displayNames : [channel.displayName].filter(Boolean)) as string[];
      displayNameCount += aliases.length;
      if (aliases.length) channelsWithDisplayName += 1;
      if (aliases.length > 1) channelsWithMultipleDisplayNames += 1;
      for (const alias of aliases) {
        const normalizedAlias = normalizeXmltvDisplayName(alias);
        if (!normalizedAlias) continue;
        const ids = aliasesByName.get(normalizedAlias) ?? new Set<string>();
        ids.add(normalizeXmltvChannelId(channel.id));
        aliasesByName.set(normalizedAlias, ids);
      }
    }
    await database.runAsync(
      `INSERT OR REPLACE INTO guide_xmltv_channel_name_stats
        (provider_key, channel_element_count, display_name_count,
         channels_with_display_name, channels_with_multiple_display_names,
         unique_normalized_name_count, ambiguous_normalized_name_count)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      normalizedProviderKey,
      channels.length,
      displayNameCount,
      channelsWithDisplayName,
      channelsWithMultipleDisplayNames,
      aliasesByName.size,
      Array.from(aliasesByName.values()).filter(ids => ids.size > 1).length,
    );
  });
}


// NOVACAST_GUIDE_V2_3H_TARGETED_XMLTV_V1

type XmltvChannelFreshnessRow = {
  channel_id: string;
  updated_at: number;
};

export async function getStaleXmltvChannelIds(
  providerKey: string,
  channelIds: string[],
  maxAgeMs: number,
  now = Date.now(),
): Promise<string[]> {
  const database =
    await getDatabase();

  const normalizedProviderKey =
    providerKey.trim();

  const normalizedIds =
    Array.from(
      new Set(
        channelIds
          .map(normalizeXmltvChannelId)
          .filter(Boolean),
      ),
    );

  if (
    !normalizedProviderKey ||
    !normalizedIds.length
  ) {
    return [];
  }

  const placeholders =
    normalizedIds
      .map(() => '?')
      .join(',');

  const rows =
    await database.getAllAsync<XmltvChannelFreshnessRow>(
      `
        SELECT
          channel_id,
          updated_at
        FROM guide_xmltv_channels
        WHERE provider_key = ?
          AND channel_id IN (${placeholders})
      `,
      normalizedProviderKey,
      ...normalizedIds,
    );

  const freshAfter =
    now -
    Math.max(
      0,
      maxAgeMs,
    );

  const freshIds =
    new Set<string>();

  for (const row of rows) {
    if (
      Number(row.updated_at) >=
      freshAfter
    ) {
      freshIds.add(
        normalizeXmltvChannelId(
          row.channel_id,
        ),
      );
    }
  }

  return normalizedIds.filter(
    channelId =>
      !freshIds.has(channelId),
  );
}

export async function upsertProviderXmltvChannels(
  providerKey: string,
  requestedChannelIds: string[],
  channels: ParsedXmltvChannel[],
  programmes: ParsedXmltvProgramme[],
  malformedProgrammeCount: number,
): Promise<void> {
  const database =
    await getDatabase();

  const normalizedProviderKey =
    providerKey.trim();

  if (!normalizedProviderKey) {
    throw new Error(
      'XMLTV provider cache key is required.',
    );
  }

  const requestedIds =
    Array.from(
      new Set(
        requestedChannelIds
          .map(normalizeXmltvChannelId)
          .filter(Boolean),
      ),
    );

  if (!requestedIds.length) {
    return;
  }

  const requestedSet =
    new Set(requestedIds);

  const displayNames =
    new Map<
      string,
      string | undefined
    >();

  for (const channel of channels) {
    const normalizedId =
      normalizeXmltvChannelId(
        channel.id,
      );

    if (
      !normalizedId ||
      !requestedSet.has(
        normalizedId,
      )
    ) {
      continue;
    }

    if (
      !displayNames.has(
        normalizedId,
      )
    ) {
      displayNames.set(
        normalizedId,
        channel.displayName,
      );
    }
  }

  const grouped =
    new Map<
      string,
      ParsedXmltvProgramme[]
    >();

  for (
    const programme of programmes
  ) {
    const normalizedId =
      normalizeXmltvChannelId(
        programme.channelId,
      );

    if (
      !normalizedId ||
      !requestedSet.has(
        normalizedId,
      )
    ) {
      continue;
    }

    const existing =
      grouped.get(
        normalizedId,
      );

    if (existing) {
      existing.push(
        programme,
      );

      continue;
    }

    grouped.set(
      normalizedId,
      [programme],
    );
  }

  for (
    const list of grouped.values()
  ) {
    list.sort(
      (left, right) =>
        left.startAt -
        right.startAt,
    );
  }

  const importedAt =
    Date.now();

  await database.withTransactionAsync(
    async () => {
      for (
        const channelId of requestedIds
      ) {
        await database.runAsync(
          `
            INSERT INTO guide_xmltv_channels (
              provider_key,
              channel_id,
              display_name,
              programmes_json,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?)

            ON CONFLICT(provider_key, channel_id)
            DO UPDATE SET
              display_name =
                COALESCE(
                  excluded.display_name,
                  guide_xmltv_channels.display_name
                ),
              programmes_json =
                excluded.programmes_json,
              updated_at =
                excluded.updated_at
          `,
          normalizedProviderKey,
          channelId,
          displayNames.get(
            channelId,
          ) ?? null,
          JSON.stringify(
            grouped.get(
              channelId,
            ) ?? [],
          ),
          importedAt,
        );
      }

      const countRow =
        await database.getFirstAsync<{
          channel_count: number;
        }>(
          `
            SELECT
              COUNT(*) AS channel_count
            FROM guide_xmltv_channels
            WHERE provider_key = ?
          `,
          normalizedProviderKey,
        );

      await database.runAsync(
        `
          INSERT OR REPLACE INTO guide_xmltv_meta (
            provider_key,
            imported_at,
            channel_count,
            programme_count,
            malformed_programme_count
          )
          VALUES (?, ?, ?, ?, ?)
        `,
        normalizedProviderKey,
        importedAt,
        Number(
          countRow?.channel_count ??
          requestedIds.length,
        ),
        programmes.length,
        malformedProgrammeCount,
      );
    },
  );
}
export async function clearProviderXmltvCache(
  providerKey: string,
): Promise<void> {
  const database = await getDatabase();

  await database.withTransactionAsync(async () => {
    await database.runAsync(
      'DELETE FROM guide_xmltv_channels WHERE provider_key = ?',
      providerKey.trim(),
    );

    await database.runAsync(
      'DELETE FROM guide_xmltv_meta WHERE provider_key = ?',
      providerKey.trim(),
    );
  });
}
