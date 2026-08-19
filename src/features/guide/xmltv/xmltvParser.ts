export type ParsedXmltvChannel = {
  id: string;
  displayName?: string;
  displayNames?: string[];
};

export type ParsedXmltvProgramme = {
  channelId: string;
  startAt: number;
  endAt?: number;
  title: string;
  description?: string;
  category?: string;
};

export type ParsedXmltvDocument = {
  channels: ParsedXmltvChannel[];
  programmes: ParsedXmltvProgramme[];
  malformedProgrammeCount: number;
};

export function normalizeXmltvDisplayName(value: string | undefined | null): string {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
}

export function normalizeXmltvChannelId(
  value: string | undefined | null,
): string {
  return String(value ?? '').trim().toLowerCase();
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(
      /&#x([0-9a-f]+);/gi,
      (_, hex: string) =>
        String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(
      /&#([0-9]+);/g,
      (_, decimal: string) =>
        String.fromCodePoint(Number.parseInt(decimal, 10)),
    )
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function cleanXmlText(
  value: string | undefined,
): string {
  return decodeXmlEntities(
    String(value ?? '')
      .replace(
        /<!\[CDATA\[([\s\S]*?)\]\]>/gi,
        '$1',
      )
      .replace(/<[^>]+>/g, '')
      .trim(),
  );
}

function getAttribute(
  source: string,
  name: string,
): string | undefined {
  const expression = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    'i',
  );

  const match = expression.exec(source);

  return match?.[1] ?? match?.[2];
}

function getElementText(
  source: string,
  elementName: string,
): string | undefined {
  const expression = new RegExp(
    `<${elementName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${elementName}>`,
    'i',
  );

  const match = expression.exec(source);

  if (!match) return undefined;

  const value = cleanXmlText(match[1]);

  return value || undefined;
}

/**
 * XMLTV:
 * 20260811013000 +0200
 * 20260811013000 -0400
 */
export function parseXmltvTimestamp(
  value: string | undefined | null,
): number | undefined {
  const raw = String(value ?? '').trim();

  const match =
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-])(\d{2})(\d{2}))?$/.exec(
      raw,
    );

  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return undefined;
  }

  let result = Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
    second,
  );

  if (match[7]) {
    const offsetHours = Number(match[8]);
    const offsetMinutes = Number(match[9]);

    if (
      offsetHours > 23 ||
      offsetMinutes > 59
    ) {
      return undefined;
    }

    const totalOffsetMinutes =
      offsetHours * 60 + offsetMinutes;

    const signedOffset =
      match[7] === '+'
        ? totalOffsetMinutes
        : -totalOffsetMinutes;

    result -= signedOffset * 60_000;
  }

  return Number.isFinite(result)
    ? result
    : undefined;
}

function parseChannelParts(
  attributes: string,
  body: string,
): ParsedXmltvChannel | null {
  const id =
    getAttribute(attributes, 'id')?.trim();

  if (!id) return null;

  const displayNames: string[] = [];
  const displayNameExpression = /<display-name(?:\s[^>]*)?>([\s\S]*?)<\/display-name\s*>/gi;
  let displayNameMatch: RegExpExecArray | null;
  while ((displayNameMatch = displayNameExpression.exec(body))) {
    const displayName = cleanXmlText(displayNameMatch[1]);
    if (displayName) displayNames.push(displayName);
  }

  return {
    id,
    displayName: displayNames[0],
    displayNames,
  };
}

function parseProgrammeParts(
  attributes: string,
  body: string,
): ParsedXmltvProgramme | null {
  const channelId =
    getAttribute(
      attributes,
      'channel',
    )?.trim();

  const startAt =
    parseXmltvTimestamp(
      getAttribute(attributes, 'start'),
    );

  const endAt =
    parseXmltvTimestamp(
      getAttribute(attributes, 'stop'),
    );

  const title =
    getElementText(body, 'title');

  if (
    !channelId ||
    startAt === undefined ||
    !title
  ) {
    return null;
  }

  return {
    channelId,
    startAt,
    endAt,
    title,
    description:
      getElementText(body, 'desc'),
    category:
      getElementText(body, 'category'),
  };
}

export function parseXmltvDocument(
  xml: string,
): ParsedXmltvDocument {
  const channels: ParsedXmltvChannel[] = [];
  const programmes: ParsedXmltvProgramme[] = [];

  let malformedProgrammeCount = 0;

  const channelExpression =
    /<channel\b([^>]*)>([\s\S]*?)<\/channel\s*>/gi;

  let channelMatch:
    RegExpExecArray | null;

  while (
    (channelMatch =
      channelExpression.exec(xml))
  ) {
    const channel =
      parseChannelParts(
        channelMatch[1],
        channelMatch[2],
      );

    if (channel) {
      channels.push(channel);
    }
  }

  const programmeExpression =
    /<programme\b([^>]*)>([\s\S]*?)<\/programme\s*>/gi;

  let programmeMatch:
    RegExpExecArray | null;

  while (
    (programmeMatch =
      programmeExpression.exec(xml))
  ) {
    const programme =
      parseProgrammeParts(
        programmeMatch[1],
        programmeMatch[2],
      );

    if (!programme) {
      malformedProgrammeCount += 1;
      continue;
    }

    programmes.push(programme);
  }

  return {
    channels,
    programmes,
    malformedProgrammeCount,
  };
}

// NOVACAST_GUIDE_V2_3H_TARGETED_XMLTV_V1
//
// Target-aware linear XMLTV scanner.
//
// The Guide gives us the XMLTV channel IDs for the currently loaded
// page. For all other provider channels, we still scan forward through
// the XML document but completely skip expensive programme body parsing.
//
// A 35 MB provider guide therefore no longer turns into tens of
// thousands of title/description/category parsing operations.

export type XmltvStreamAccumulatorOptions = {
  minimumProgrammeAt?: number;
  maximumProgrammeAt?: number;
  maxProgrammes?: number;
  wantedChannelIds?: string[];
};

export function createXmltvStreamAccumulator(
  options: XmltvStreamAccumulatorOptions = {},
) {
  let buffer = '';

  const channels: ParsedXmltvChannel[] = [];
  const programmes: ParsedXmltvProgramme[] = [];

  let malformedProgrammeCount = 0;
  let droppedOutsideWindowCount = 0;
  let droppedCapacityCount = 0;
  let skippedUnwantedChannelCount = 0;
  let skippedUnwantedProgrammeCount = 0;

  const maxProgrammes =
    Math.max(
      1,
      options.maxProgrammes ?? 80_000,
    );

  const wantedChannelIds =
    new Set(
      (options.wantedChannelIds ?? [])
        .map(normalizeXmltvChannelId)
        .filter(Boolean),
    );

  const isTargeted =
    wantedChannelIds.size > 0;

  const channelIdAttributeExpression =
    /\bid\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

  const programmeChannelAttributeExpression =
    /\bchannel\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

  const readAttribute = (
    expression: RegExp,
    attributes: string,
  ) => {
    const match =
      expression.exec(attributes);

    return String(
      match?.[1] ??
      match?.[2] ??
      '',
    ).trim();
  };

  const findElementStart = (
    tagName: 'channel' | 'programme',
    fromIndex: number,
  ) => {
    const token = `<${tagName}`;

    let index =
      buffer.indexOf(
        token,
        fromIndex,
      );

    while (index >= 0) {
      const boundary =
        buffer[
          index +
          token.length
        ];

      if (
        boundary === '>' ||
        boundary === '/' ||
        boundary === ' ' ||
        boundary === '\t' ||
        boundary === '\r' ||
        boundary === '\n'
      ) {
        return index;
      }

      index =
        buffer.indexOf(
          token,
          index +
            token.length,
        );
    }

    return -1;
  };

  const consume = () => {
    let cursor = 0;

    for (;;) {
      const channelIndex =
        findElementStart(
          'channel',
          cursor,
        );

      const programmeIndex =
        findElementStart(
          'programme',
          cursor,
        );

      let startIndex = -1;

      let kind:
        | 'channel'
        | 'programme'
        | null = null;

      if (
        channelIndex >= 0 &&
        programmeIndex >= 0
      ) {
        if (
          channelIndex <
          programmeIndex
        ) {
          startIndex =
            channelIndex;

          kind =
            'channel';
        }

        if (
          programmeIndex <=
          channelIndex
        ) {
          startIndex =
            programmeIndex;

          kind =
            'programme';
        }
      }

      if (
        channelIndex >= 0 &&
        programmeIndex < 0
      ) {
        startIndex =
          channelIndex;

        kind =
          'channel';
      }

      if (
        programmeIndex >= 0 &&
        channelIndex < 0
      ) {
        startIndex =
          programmeIndex;

        kind =
          'programme';
      }

      if (
        startIndex < 0 ||
        !kind
      ) {
        if (cursor > 0) {
          buffer =
            buffer.slice(cursor);
        }

        if (
          buffer.length >
          256
        ) {
          buffer =
            buffer.slice(-256);
        }

        return;
      }

      const openingEnd =
        buffer.indexOf(
          '>',
          startIndex,
        );

      if (
        openingEnd < 0
      ) {
        if (startIndex > 0) {
          buffer =
            buffer.slice(
              startIndex,
            );
        }

        return;
      }

      const openingToken =
        kind === 'channel'
          ? '<channel'
          : '<programme';

      const attributes =
        buffer.slice(
          startIndex +
            openingToken.length,
          openingEnd,
        );

      const bodyStart =
        openingEnd + 1;

      const closingToken =
        kind === 'channel'
          ? '</channel'
          : '</programme';

      const closingStart =
        buffer.indexOf(
          closingToken,
          bodyStart,
        );

      if (
        closingStart < 0
      ) {
        if (startIndex > 0) {
          buffer =
            buffer.slice(
              startIndex,
            );
        }

        return;
      }

      const closingEnd =
        buffer.indexOf(
          '>',
          closingStart +
            closingToken.length,
        );

      if (
        closingEnd < 0
      ) {
        if (startIndex > 0) {
          buffer =
            buffer.slice(
              startIndex,
            );
        }

        return;
      }

      let shouldParse =
        true;

      if (
        isTargeted &&
        kind === 'channel'
      ) {
        const channelId =
          normalizeXmltvChannelId(
            readAttribute(
              channelIdAttributeExpression,
              attributes,
            ),
          );

        shouldParse =
          Boolean(
            channelId &&
            wantedChannelIds.has(
              channelId,
            ),
          );

        if (!shouldParse) {
          skippedUnwantedChannelCount +=
            1;
        }
      }

      if (
        isTargeted &&
        kind === 'programme'
      ) {
        const programmeChannelId =
          normalizeXmltvChannelId(
            readAttribute(
              programmeChannelAttributeExpression,
              attributes,
            ),
          );

        shouldParse =
          Boolean(
            programmeChannelId &&
            wantedChannelIds.has(
              programmeChannelId,
            ),
          );

        if (!shouldParse) {
          skippedUnwantedProgrammeCount +=
            1;
        }
      }

      if (
        shouldParse &&
        kind === 'channel'
      ) {
        const body =
          buffer.slice(
            bodyStart,
            closingStart,
          );

        const channel =
          parseChannelParts(
            attributes,
            body,
          );

        if (channel) {
          channels.push(
            channel,
          );
        }
      }

      if (
        shouldParse &&
        kind === 'programme'
      ) {
        const body =
          buffer.slice(
            bodyStart,
            closingStart,
          );

        const programme =
          parseProgrammeParts(
            attributes,
            body,
          );

        if (!programme) {
          malformedProgrammeCount +=
            1;
        }

        if (programme) {
          const programmeEnd =
            programme.endAt ??
            programme.startAt;

          const beforeWindow =
            options.minimumProgrammeAt !==
              undefined &&
            programmeEnd <
              options.minimumProgrammeAt;

          const afterWindow =
            options.maximumProgrammeAt !==
              undefined &&
            programme.startAt >
              options.maximumProgrammeAt;

          if (
            beforeWindow ||
            afterWindow
          ) {
            droppedOutsideWindowCount +=
              1;
          }

          if (
            !beforeWindow &&
            !afterWindow &&
            programmes.length <
              maxProgrammes
          ) {
            programmes.push(
              programme,
            );
          }

          if (
            !beforeWindow &&
            !afterWindow &&
            programmes.length >=
              maxProgrammes
          ) {
            droppedCapacityCount +=
              1;
          }
        }
      }

      cursor =
        closingEnd + 1;

      if (
        cursor >=
        1024 * 1024
      ) {
        buffer =
          buffer.slice(cursor);

        cursor = 0;
      }
    }
  };

  return {
    feed(chunk: string) {
      if (!chunk) {
        return;
      }

      buffer += chunk;

      consume();
    },

    finish() {
      consume();

      return {
        channels,
        programmes,
        malformedProgrammeCount,
        droppedOutsideWindowCount,
        droppedCapacityCount,
        skippedUnwantedChannelCount,
        skippedUnwantedProgrammeCount,
        trailingBufferLength:
          buffer.length,
      };
    },
  };
}

export function createXmltvChannelIndexAccumulator() {
  let buffer = '';
  const channels: ParsedXmltvChannel[] = [];

  const consume = () => {
    let cursor = 0;
    const lowerBuffer = buffer.toLocaleLowerCase();

    for (;;) {
      const start = lowerBuffer.indexOf('<channel', cursor);
      if (start < 0) break;
      const boundary = buffer[start + '<channel'.length];
      if (boundary && !/[\s>\/]/.test(boundary)) {
        cursor = start + '<channel'.length;
        continue;
      }
      const openingEnd = buffer.indexOf('>', start);
      if (openingEnd < 0) {
        cursor = start;
        break;
      }
      const closingStart = lowerBuffer.indexOf('</channel', openingEnd + 1);
      if (closingStart < 0) {
        cursor = start;
        break;
      }
      const closingEnd = buffer.indexOf('>', closingStart + '</channel'.length);
      if (closingEnd < 0) {
        cursor = start;
        break;
      }
      const channel = parseChannelParts(
        buffer.slice(start + '<channel'.length, openingEnd),
        buffer.slice(openingEnd + 1, closingStart),
      );
      if (channel) channels.push(channel);
      cursor = closingEnd + 1;
    }

    if (cursor > 0) {
      buffer = buffer.slice(cursor);
    } else if (buffer.length > 512) {
      const start = lowerBuffer.lastIndexOf('<channel');
      buffer = start >= 0 ? buffer.slice(start) : buffer.slice(-256);
    }
  };

  return {
    feed(chunk: string) {
      buffer += chunk;
      consume();
    },
    finish() {
      consume();
      return channels;
    },
    getChannelCount() {
      return channels.length;
    },
  };
}
