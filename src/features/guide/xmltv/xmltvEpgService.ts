import {
  File,
  Paths,
} from 'expo-file-system';

import {
  getStaleXmltvChannelIds,
  getXmltvChannelIndexData,
  replaceXmltvChannelNameIndex,
  getXmltvCacheMeta,
  upsertProviderXmltvChannels,
  type XmltvCacheMeta,
} from './xmltvEpgStore';

import {
  createXmltvChannelIndexAccumulator,
  createXmltvStreamAccumulator,
  normalizeXmltvChannelId,
} from './xmltvParser';

// NOVACAST_GUIDE_V2_3F_DISK_XMLTV_V1
// NOVACAST_GUIDE_V2_3H_TARGETED_XMLTV_V1
//
// Guide EPG architecture:
//
//   current Guide channel IDs
//        ↓
//   per-channel freshness check
//        ↓
//   reuse/download one native XMLTV cache file
//        ↓
//   scan entire XML file
//        ↓
//   skip body parsing for every unwanted channel/programme
//        ↓
//   upsert only current Guide channels
//
// The provider XMLTV file remains on disk for the TTL so category
// changes do not trigger a 35 MB redownload.

export const XMLTV_CACHE_TTL_MS =
  4 * 60 * 60 * 1000;

const EPG_PAST_WINDOW_MS =
  2 * 60 * 60 * 1000;

const EPG_FUTURE_WINDOW_MS =
  18 * 60 * 60 * 1000;

const XMLTV_MAX_CACHED_PROGRAMMES =
  80_000;

const XMLTV_FILE_READ_BYTES =
  64 * 1024;

const XMLTV_YIELD_EVERY_FILE_CHUNKS =
  4;

type XmltvClientLike = {
  buildXmltvUrl(): string;
};

export type XmltvRefreshResult = {
  refreshed: boolean;
  cacheMeta: XmltvCacheMeta | null;
  channelCount?: number;
  programmeCount?: number;
  malformedProgrammeCount?: number;
  requestedChannelCount?: number;
  refreshedChannelCount?: number;
};

const inFlightRefreshes =
  new Map<
    string,
    Promise<XmltvRefreshResult>
  >();

const inFlightChannelIndexes = new Map<string, Promise<void>>();

function devLog(
  event: string,
  details: Record<string, unknown>,
) {
  if (
    typeof __DEV__ !== 'undefined' &&
    __DEV__
  ) {
    console.log(
      '[GuideXMLTV]',
      event,
      details,
    );
  }
}

function yieldToUiThread() {
  return new Promise<void>(
    resolve => {
      setTimeout(
        resolve,
        0,
      );
    },
  );
}

function throwIfAborted(
  signal?: AbortSignal,
) {
  if (!signal?.aborted) {
    return;
  }

  const error =
    new Error(
      'XMLTV refresh aborted.',
    );

  error.name =
    'AbortError';

  throw error;
}

function hashProviderKey(
  value: string,
) {
  let hash =
    2166136261;

  for (
    let index = 0;
    index < value.length;
    index += 1
  ) {
    hash ^=
      value.charCodeAt(
        index,
      );

    hash =
      Math.imul(
        hash,
        16777619,
      );
  }

  return (
    hash >>> 0
  ).toString(16);
}

function getProviderXmltvFile(
  providerKey: string,
) {
  return new File(
    Paths.cache,
    `novacast-guide-${hashProviderKey(providerKey)}.xml`,
  );
}

function getFileAgeMs(
  file: File,
) {
  if (
    !file.exists ||
    !file.modificationTime
  ) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(
    0,
    Date.now() -
      file.modificationTime,
  );
}

async function ensureXmltvFile(
  options: {
    providerKey: string;
    client: XmltvClientLike;
    force?: boolean;
    signal?: AbortSignal;
  },
) {
  throwIfAborted(
    options.signal,
  );

  const file =
    getProviderXmltvFile(
      options.providerKey,
    );

  const fileAgeMs =
    getFileAgeMs(file);

  if (
    !options.force &&
    file.exists &&
    file.size > 0 &&
    fileAgeMs <
      XMLTV_CACHE_TTL_MS
  ) {
    devLog(
      'file-cache-hit',
      {
        mode:
          'targeted-disk',
        fileBytes:
          file.size,
        fileAgeMs,
      },
    );

    return file;
  }

  const startedAt =
    Date.now();

  let downloadCompleted =
    false;

  try {
    /**
     * Never log the Xtream XMLTV URL.
     * It contains provider credentials.
     */
    const downloaded =
      await File.downloadFileAsync(
        options.client
          .buildXmltvUrl(),
        file,
        {
          idempotent:
            true,
          signal:
            options.signal,
        },
      );

    downloadCompleted =
      true;

    devLog(
      'download-complete',
      {
        mode:
          'targeted-disk',
        fileBytes:
          downloaded.size,
        downloadDurationMs:
          Date.now() -
          startedAt,
      },
    );

    return downloaded;
  } catch (error) {
    if (
      !downloadCompleted &&
      file.exists
    ) {
      try {
        file.delete();
      } catch {
        // Best-effort cleanup of a partial Android download.
      }
    }

    throw error;
  }
}

export async function ensureXmltvChannelNameIndex(options: {
  providerKey: string;
  client: XmltvClientLike;
  signal?: AbortSignal;
  force?: boolean;
}): Promise<void> {
  const providerKey = options.providerKey.trim();
  const previous = inFlightChannelIndexes.get(providerKey);
  if (previous) return previous;

  const run = (async () => {
    const scanStartedAt = Date.now();
    devLog('channel-index-start', { mode: 'channel-name-index' });
    const file = await ensureXmltvFile({
      providerKey,
      client: options.client,
      signal: options.signal,
      force: options.force,
    });
    const accumulator = createXmltvChannelIndexAccumulator();
    const decoder = new TextDecoder('utf-8');
    const handle = file.open();
    let bytesRead = 0;
    let chunksRead = 0;
    try {
      for (;;) {
        throwIfAborted(options.signal);
        const value = handle.readBytes(XMLTV_FILE_READ_BYTES);
        if (!value.length) break;
        bytesRead += value.length;
        chunksRead += 1;
        accumulator.feed(decoder.decode(value, { stream: true }));
        if (chunksRead > 0 && chunksRead % 64 === 0) {
          devLog('scan-progress', {
            mode: 'channel-name-index',
            bytesRead,
            chunksRead,
            channelCount: accumulator.getChannelCount(),
            durationMs: Date.now() - scanStartedAt,
          });
        }
        await yieldToUiThread();
      }
    } finally {
      handle.close();
    }
    accumulator.feed(decoder.decode());
    const channels = accumulator.finish();
    devLog('channel-index-parse-complete', {
      mode: 'channel-name-index',
      bytesRead,
      channelCount: channels.length,
    });
    await replaceXmltvChannelNameIndex(providerKey, channels);
    const indexData = await getXmltvChannelIndexData(providerKey);
    devLog('channel-index-complete', {
      mode: 'channel-name-index',
      bytesRead,
      channelCount: channels.length,
      ...(indexData?.diagnostics ?? {}),
    });
  })();

  inFlightChannelIndexes.set(providerKey, run);
  try {
    await run;
  } finally {
    if (inFlightChannelIndexes.get(providerKey) === run) {
      inFlightChannelIndexes.delete(providerKey);
    }
  }
}

export async function refreshXmltvEpgCache(
  options: {
    providerKey: string;
    client: XmltvClientLike;
    channelIds: string[];
    force?: boolean;
    signal?: AbortSignal;
    reason?: string;
  },
): Promise<XmltvRefreshResult> {
  const providerKey =
    options.providerKey.trim();

  if (!providerKey) {
    throw new Error(
      'XMLTV provider key is required.',
    );
  }

  const requestedChannelIds =
    Array.from(
      new Set(
        options.channelIds
          .map(
            normalizeXmltvChannelId,
          )
          .filter(Boolean),
      ),
    );

  if (
    !requestedChannelIds.length
  ) {
    return {
      refreshed:
        false,
      cacheMeta:
        await getXmltvCacheMeta(
          providerKey,
        ),
      requestedChannelCount:
        0,
      refreshedChannelCount:
        0,
    };
  }

  const runRefresh = () =>
    refreshXmltvEpgCacheInternal({
      ...options,
      providerKey,
      channelIds:
        requestedChannelIds,
    });

  const previous =
    inFlightRefreshes.get(
      providerKey,
    );

  const refreshPromise =
    previous
      ? previous
          .catch(
            () => null,
          )
          .then(
            runRefresh,
          )
      : runRefresh();

  inFlightRefreshes.set(
    providerKey,
    refreshPromise,
  );

  try {
    return await refreshPromise;
  } finally {
    if (
      inFlightRefreshes.get(
        providerKey,
      ) === refreshPromise
    ) {
      inFlightRefreshes.delete(
        providerKey,
      );
    }
  }
}

async function refreshXmltvEpgCacheInternal(
  options: {
    providerKey: string;
    client: XmltvClientLike;
    channelIds: string[];
    force?: boolean;
    signal?: AbortSignal;
    reason?: string;
  },
): Promise<XmltvRefreshResult> {
  const startedAt =
    Date.now();

  try {
    throwIfAborted(
      options.signal,
    );

    const staleChannelIds =
      options.force
        ? options.channelIds
        : await getStaleXmltvChannelIds(
            options.providerKey,
            options.channelIds,
            XMLTV_CACHE_TTL_MS,
          );

    if (
      !staleChannelIds.length
    ) {
      const cacheMeta =
        await getXmltvCacheMeta(
          options.providerKey,
        );

      devLog(
        'channel-cache-hit',
        {
          requestedChannelCount:
            options.channelIds.length,
          staleChannelCount:
            0,
        },
      );

      return {
        refreshed:
          false,
        cacheMeta,
        requestedChannelCount:
          options.channelIds.length,
        refreshedChannelCount:
          0,
      };
    }

    devLog(
      'refresh-start',
      {
        reason:
          options.reason ??
          'stale-channel-page',
        mode:
          'targeted-disk',
        requestedChannelCount:
          options.channelIds.length,
        staleChannelCount:
          staleChannelIds.length,
        readBytes:
          XMLTV_FILE_READ_BYTES,
      },
    );

    const xmltvFile =
      await ensureXmltvFile({
        providerKey:
          options.providerKey,
        client:
          options.client,
        force:
          options.force,
        signal:
          options.signal,
      });

    throwIfAborted(
      options.signal,
    );

    const now =
      Date.now();

    const accumulator =
      createXmltvStreamAccumulator({
        minimumProgrammeAt:
          now -
          EPG_PAST_WINDOW_MS,

        maximumProgrammeAt:
          now +
          EPG_FUTURE_WINDOW_MS,

        maxProgrammes:
          XMLTV_MAX_CACHED_PROGRAMMES,

        wantedChannelIds:
          staleChannelIds,
      });

    const decoder =
      new TextDecoder(
        'utf-8',
      );

    let bytesRead = 0;
    let chunksRead = 0;

    const parseStartedAt =
      Date.now();

    const handle =
      xmltvFile.open();

    try {
      for (;;) {
        throwIfAborted(
          options.signal,
        );

        const value =
          handle.readBytes(
            XMLTV_FILE_READ_BYTES,
          );

        if (!value.length) {
          break;
        }

        bytesRead +=
          value.length;

        chunksRead +=
          1;

        accumulator.feed(
          decoder.decode(
            value,
            {
              stream:
                true,
            },
          ),
        );

        if (
          chunksRead % 128 ===
          0
        ) {
          devLog(
            'target-scan-progress',
            {
              chunksRead,
              bytesRead,
              parseDurationMs:
                Date.now() -
                parseStartedAt,
            },
          );
        }

        if (
          chunksRead %
            XMLTV_YIELD_EVERY_FILE_CHUNKS ===
          0
        ) {
          await yieldToUiThread();
        }
      }
    } finally {
      handle.close();
    }

    accumulator.feed(
      decoder.decode(),
    );

    const parsed =
      accumulator.finish();

    const parseDurationMs =
      Date.now() -
      parseStartedAt;

    devLog(
      'parse-complete',
      {
        mode:
          'targeted-disk',
        bytesRead,
        chunksRead,
        requestedChannelCount:
          staleChannelIds.length,
        matchedChannelCount:
          parsed.channels.length,
        cachedProgrammeCount:
          parsed.programmes.length,
        skippedUnwantedChannelCount:
          parsed.skippedUnwantedChannelCount,
        skippedUnwantedProgrammeCount:
          parsed.skippedUnwantedProgrammeCount,
        malformedProgrammeCount:
          parsed.malformedProgrammeCount,
        parseDurationMs,
      },
    );

    throwIfAborted(
      options.signal,
    );

    await yieldToUiThread();

    const persistenceStartedAt =
      Date.now();

    devLog(
      'persistence-start',
      {
        mode:
          'targeted-upsert',
        channelCount:
          staleChannelIds.length,
        programmeCount:
          parsed.programmes.length,
      },
    );

    await upsertProviderXmltvChannels(
      options.providerKey,
      staleChannelIds,
      parsed.channels,
      parsed.programmes,
      parsed.malformedProgrammeCount,
    );

    const persistenceDurationMs =
      Date.now() -
      persistenceStartedAt;

    const cacheMeta =
      await getXmltvCacheMeta(
        options.providerKey,
      );

    devLog(
      'refresh-complete',
      {
        mode:
          'targeted-disk',
        requestedChannelCount:
          options.channelIds.length,
        refreshedChannelCount:
          staleChannelIds.length,
        cachedProgrammeCount:
          parsed.programmes.length,
        persistenceDurationMs,
        totalDurationMs:
          Date.now() -
          startedAt,
      },
    );

    return {
      refreshed:
        true,
      cacheMeta,
      channelCount:
        parsed.channels.length,
      programmeCount:
        parsed.programmes.length,
      malformedProgrammeCount:
        parsed.malformedProgrammeCount,
      requestedChannelCount:
        options.channelIds.length,
      refreshedChannelCount:
        staleChannelIds.length,
    };
  } catch (error) {
    devLog(
      'refresh-failed',
      {
        mode:
          'targeted-disk',
        reason:
          options.reason ??
          'unknown',
        totalDurationMs:
          Date.now() -
          startedAt,
        message:
          error instanceof Error
            ? error.message
            : String(error),
      },
    );

    throw error;
  }
}
