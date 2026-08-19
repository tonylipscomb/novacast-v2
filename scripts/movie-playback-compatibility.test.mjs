import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildMoviePlaybackCompatibilityLog,
  classifyMoviePlaybackErrorCategory,
  DEVICE_PERFORMANCE_RISK_DETAIL,
  DEVICE_PERFORMANCE_RISK_ERROR,
  DEVICE_PERFORMANCE_RISK_REASON,
  inspectMoviePlaybackSource,
  isLegitimateMovieAlternateSource,
  isMovieCodecRisk,
  isMovieResolutionRisk,
  isPlausiblyMoreCompatibleMovieAlternate,
  isVideoDecoderInitFailure,
  MAX_MOVIE_COMPATIBILITY_FALLBACK_ATTEMPTS,
  parseXtreamVodVideoMetadata,
  resolveDevicePlaybackProfile,
  resolveMovieCompatibilityErrorCopy,
  resolveMovieCompatibilityErrorDecision,
  resolveMovieCompatibilityFallback,
  resolveMoviePreplayCompatibilityDecision,
  shouldRecordMovieProgressAfterPlayback,
  shouldRetryMovieUnsupportedFormat,
  shouldRunMovieHttpSourceRecovery,
  UNSUPPORTED_VIDEO_FORMAT_CATEGORY,
  UNSUPPORTED_VIDEO_FORMAT_DETAIL,
  UNSUPPORTED_VIDEO_FORMAT_ERROR,
} from '../src/features/playback/unified/moviePlaybackCompatibility.ts';
import {
  resolveUnifiedPlaybackNotification,
  sanitizePlaybackErrorMessage,
} from '../src/features/playback/unified/unifiedPlayerLogic.ts';
import {
  getUnifiedPlayerState,
  launchUnifiedPlayback,
  resetUnifiedPlayerForTests,
  setUnifiedPlayerError,
} from '../src/features/playback/unified/unifiedPlayerStore.ts';
import { MOVIE_FALLBACK_EXTENSIONS } from '../src/features/providers/playbackSourceDiagnostics.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');

const controller = read('src/features/playback/unified/UnifiedPlayerController.tsx');
const overlay = read('src/features/playback/unified/UnifiedPlayerOverlay.tsx');
const errorState = read('src/features/playback/unified/UnifiedPlayerErrorState.tsx');
const novaStreamPlayer = read('src/features/playback/NovaStreamPlayer.tsx');
const providerPlayback = read('src/features/providers/providerPlayback.ts');
const diagnostics = read('src/features/providers/playbackSourceDiagnostics.ts');
const seriesAutoplay = read('src/features/playback/continuity/seriesUpNext.ts');
const chromeWake = read('src/features/playback/unified/playerChromeWake.ts');
const remoteHandlers = read('src/features/playback/unified/useUnifiedPlayerRemoteHandlers.tsx');
const liveScreen = read('src/features/live/LiveTvScreen.tsx');

const HEVC_4K_DECODER_ERROR =
  'DecoderInitializationException: Decoder init failed: OMX.MTK.VIDEO.DECODER.HEVC configureCodec error -22 DecoderErrorFatal = 1';
const NETWORK_ERROR = 'InvalidResponseCodeException: 551';
const AUTH_ERROR = 'HTTP 401 Unauthorized';
const PRIMARY_MKV = 'http://cdn.example.invalid/movie/user/pass/991.mkv';
const ALT_HLS = 'http://alt.example.invalid/vod/991/index.m3u8';
const SUFFIX_MP4 = 'http://cdn.example.invalid/movie/user/pass/991.mp4';

const hevc4k = inspectMoviePlaybackSource({
  containerExtension: 'mkv',
  video: { codec_name: 'hevc', width: 3840, height: 1608, profile: 'hvc1.2.4.H150.B0' },
});
const hevc4kTall = inspectMoviePlaybackSource({
  containerExtension: 'mkv',
  video: 'HEVC / H.265 3840x2072 hvc1.2.4.L150.90',
});
const avc1080 = inspectMoviePlaybackSource({
  containerExtension: 'mp4',
  video: { codec_name: 'h264', width: 1920, height: 1080 },
});
const hevc1080 = inspectMoviePlaybackSource({
  containerExtension: 'mkv',
  video: { codec_name: 'hevc', width: 1920, height: 1080 },
});
const avc4k = inspectMoviePlaybackSource({
  containerExtension: 'mp4',
  video: { codec_name: 'h264', width: 3840, height: 2160 },
});
const missingDims = inspectMoviePlaybackSource({
  containerExtension: 'mkv',
  video: { codec_name: 'hevc' },
});

const fhdFireTv = resolveDevicePlaybackProfile({
  displayWidth: 1920,
  displayHeight: 1080,
  os: 'android',
  isTv: true,
  manufacturer: 'Amazon',
  model: 'AFTMM',
  apiLevel: 28,
});
const uhdAndroidTv = resolveDevicePlaybackProfile({
  displayWidth: 3840,
  displayHeight: 2160,
  os: 'android',
  isTv: true,
  manufacturer: 'Amazon',
  apiLevel: 28,
});

test('1. 1080p H.264 movie plays normally with no fallback', () => {
  assert.equal(avc1080.codec, 'avc');
  assert.equal(avc1080.width, 1920);
  assert.equal(avc1080.height, 1080);
  assert.equal(isMovieCodecRisk(avc1080), false);
  assert.equal(
    resolveMovieCompatibilityErrorDecision({
      mediaType: 'movie',
      error: 'ready',
      fallbackAttempted: false,
      primaryStreamUrl: PRIMARY_MKV,
    }).action,
    'passthrough',
  );
  assert.equal(
    resolveMovieCompatibilityFallback({
      primaryStreamUrl: PRIMARY_MKV,
      directSourceUrl: SUFFIX_MP4,
    }),
    null,
  );
});

test('2. 4K HEVC decoder init failure is codec incompatibility', () => {
  assert.equal(hevc4k.codec, 'hevc');
  assert.equal(hevc4k.width, 3840);
  assert.equal(hevc4k.height, 1608);
  assert.equal(isMovieCodecRisk(hevc4k), true);
  assert.equal(hevc4kTall.codec, 'hevc');
  assert.equal(hevc4kTall.height, 2072);
  assert.equal(isMovieCodecRisk(hevc4kTall), true);
  assert.equal(isVideoDecoderInitFailure(HEVC_4K_DECODER_ERROR), true);
  assert.equal(classifyMoviePlaybackErrorCategory(HEVC_4K_DECODER_ERROR), UNSUPPORTED_VIDEO_FORMAT_CATEGORY);
});

test('3. compatibility failure does not trigger network retry logic', () => {
  assert.equal(
    shouldRunMovieHttpSourceRecovery({
      mediaType: 'movie',
      httpStatus: 551,
      decoderInitFailure: false,
    }),
    true,
  );
  assert.equal(
    shouldRunMovieHttpSourceRecovery({
      mediaType: 'movie',
      httpStatus: 551,
      decoderInitFailure: true,
    }),
    false,
  );
  assert.equal(
    shouldRunMovieHttpSourceRecovery({
      mediaType: 'movie',
      httpStatus: null,
      decoderInitFailure: true,
    }),
    false,
  );
  assert.equal(isVideoDecoderInitFailure(NETWORK_ERROR), false);
  assert.equal(isVideoDecoderInitFailure(AUTH_ERROR), false);
  assert.equal(classifyMoviePlaybackErrorCategory(NETWORK_ERROR), null);
  assert.match(controller, /shouldRunMovieHttpSourceRecovery\(/);
  assert.match(controller, /decoderInitFailure/);
});

test('4. one valid 1080p/H.264 alternate source retries once', () => {
  assert.equal(isLegitimateMovieAlternateSource(PRIMARY_MKV, SUFFIX_MP4), false);
  assert.equal(isLegitimateMovieAlternateSource(PRIMARY_MKV, PRIMARY_MKV), false);
  assert.equal(isLegitimateMovieAlternateSource(PRIMARY_MKV, ALT_HLS), true);
  const fallback = resolveMovieCompatibilityFallback({
    primaryStreamUrl: PRIMARY_MKV,
    directSourceUrl: ALT_HLS,
  });
  assert.ok(fallback);
  assert.equal(fallback.reason, 'direct-source-hls');
  assert.equal(fallback.container, 'm3u8');
  const decision = resolveMovieCompatibilityErrorDecision({
    mediaType: 'movie',
    error: HEVC_4K_DECODER_ERROR,
    fallbackAttempted: false,
    primaryStreamUrl: PRIMARY_MKV,
    directSourceUrl: ALT_HLS,
  });
  assert.equal(decision.action, 'fallback');
  assert.equal(MAX_MOVIE_COMPATIBILITY_FALLBACK_ATTEMPTS, 1);
  assert.match(controller, /decision\.action === 'fallback'/);
  assert.match(controller, /fallbackAttempted = true/);
});

test('5. successful fallback clears error/loading state', () => {
  resetUnifiedPlayerForTests();
  launchUnifiedPlayback({
    id: '991',
    mediaType: 'movie',
    title: 'Test',
    streamUrl: PRIMARY_MKV,
    isLive: false,
  });
  setUnifiedPlayerError(UNSUPPORTED_VIDEO_FORMAT_ERROR, UNSUPPORTED_VIDEO_FORMAT_CATEGORY);
  assert.equal(getUnifiedPlayerState().machineState, 'error');
  launchUnifiedPlayback({
    id: '991',
    mediaType: 'movie',
    title: 'Test',
    streamUrl: ALT_HLS,
    isLive: false,
  });
  assert.equal(getUnifiedPlayerState().machineState, 'loading');
  assert.equal(getUnifiedPlayerState().errorMessage, null);
  assert.equal(getUnifiedPlayerState().errorCategory, null);
  assert.match(controller, /event: 'fallback-success'/);
});

test('6. no alternate -> unsupported format error displayed', () => {
  const decision = resolveMovieCompatibilityErrorDecision({
    mediaType: 'movie',
    error: HEVC_4K_DECODER_ERROR,
    fallbackAttempted: false,
    primaryStreamUrl: PRIMARY_MKV,
    directSourceUrl: SUFFIX_MP4,
  });
  assert.equal(decision.action, 'unsupported');
  assert.equal(sanitizePlaybackErrorMessage(HEVC_4K_DECODER_ERROR, 'movie'), UNSUPPORTED_VIDEO_FORMAT_ERROR);
  assert.equal(sanitizePlaybackErrorMessage(HEVC_4K_DECODER_ERROR, 'episode'), 'Playback unavailable');
  assert.equal(
    resolveUnifiedPlaybackNotification('error', false, UNSUPPORTED_VIDEO_FORMAT_CATEGORY),
    null,
  );
  assert.match(overlay, /resolveMovieCompatibilityErrorCopy/);
  assert.equal(
    resolveMovieCompatibilityErrorCopy({
      errorMessage: UNSUPPORTED_VIDEO_FORMAT_ERROR,
      errorCategory: UNSUPPORTED_VIDEO_FORMAT_CATEGORY,
    }).title,
    UNSUPPORTED_VIDEO_FORMAT_ERROR,
  );
  assert.equal(UNSUPPORTED_VIDEO_FORMAT_DETAIL, 'Try another version or device.');
});

test('7. fallback failure stops after one attempt', () => {
  const second = resolveMovieCompatibilityErrorDecision({
    mediaType: 'movie',
    error: HEVC_4K_DECODER_ERROR,
    fallbackAttempted: true,
    primaryStreamUrl: PRIMARY_MKV,
    directSourceUrl: ALT_HLS,
  });
  assert.equal(second.action, 'unsupported');
  assert.equal(shouldRetryMovieUnsupportedFormat(UNSUPPORTED_VIDEO_FORMAT_CATEGORY), false);
  assert.match(controller, /shouldRetryMovieUnsupportedFormat\(current\.errorCategory\)/);
  assert.doesNotMatch(controller, /while \(.*fallback/);
});

test('8. credentials/full URLs never logged', () => {
  const payload = buildMoviePlaybackCompatibilityLog({
    event: 'decoder-failure',
    codec: 'hevc',
    width: 3840,
    height: 1608,
    container: 'mkv',
    fallbackAttempt: 0,
  });
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /https?:\/\//i);
  assert.doesNotMatch(serialized, /user|pass|token|credential/i);
  assert.equal('streamUrl' in payload, false);
  assert.equal('directSourceUrl' in payload, false);
  assert.match(controller, /logMoviePlaybackCompatibility\(/);
  const logBlocks = [...controller.matchAll(/logMoviePlaybackCompatibility\(\{[\s\S]*?\}\);/g)].map(
    (match) => match[0],
  );
  assert.ok(logBlocks.length >= 6);
  for (const block of logBlocks) {
    assert.doesNotMatch(block, /streamUrl|directSourceUrl|password|username|token=/i);
  }
  const compat = read('src/features/playback/unified/moviePlaybackCompatibility.ts');
  assert.match(compat, /\[NovaCast Movie Playback Compatibility\]/);
  assert.doesNotMatch(compat, /console\.info\([^)]*streamUrl/);
});

test('9. Series playback unchanged', () => {
  assert.equal(
    resolveMovieCompatibilityErrorDecision({
      mediaType: 'episode',
      error: HEVC_4K_DECODER_ERROR,
      fallbackAttempted: false,
      primaryStreamUrl: PRIMARY_MKV,
      directSourceUrl: ALT_HLS,
    }).action,
    'passthrough',
  );
  assert.match(controller, /mediaType === 'episode'/);
  assert.match(controller, /playNextEpisode/);
  assert.doesNotMatch(seriesAutoplay, /moviePlaybackCompatibility/);
});

test('10. Series autoplay unchanged', () => {
  assert.match(controller, /resolveSeriesAutoplayDecision/);
  assert.match(controller, /logSeriesAutoplay/);
  assert.match(seriesAutoplay, /autoplay-complete/);
  assert.match(controller, /autoplayCompletePendingEpisodeIdRef/);
});

test('11. Live playback unchanged', () => {
  assert.equal(
    resolveMovieCompatibilityErrorDecision({
      mediaType: 'live',
      error: HEVC_4K_DECODER_ERROR,
      fallbackAttempted: false,
    }).action,
    'passthrough',
  );
  assert.doesNotMatch(liveScreen, /moviePlaybackCompatibility/);
  assert.match(controller, /item\.mediaType === 'live'/);
});

test('12. VOD player focus/chrome wake unchanged', () => {
  assert.match(remoteHandlers, /shouldConsumePlayerChromeWake/);
  assert.match(chromeWake, /wake-consumed/);
  assert.match(controller, /from '.\/playerChromeWake.ts'/);
});

test('13. BACK works from unsupported-format error', () => {
  assert.match(errorState, /canRetry/);
  assert.match(errorState, /hasTVPreferredFocus=\{!canRetry\}/);
  assert.match(errorState, /onBack\(\)/);
  assert.match(overlay, /onBack=\{onBack\}/);
  assert.match(controller, /onBack=\{handleBack\}/);
  assert.equal(shouldRetryMovieUnsupportedFormat(UNSUPPORTED_VIDEO_FORMAT_CATEGORY), false);
});

test('14. Continue Watching does not record fake progress from failed playback', () => {
  assert.equal(
    shouldRecordMovieProgressAfterPlayback({
      firstFrameSeen: false,
      positionMs: 0,
      durationMs: 7200000,
      errorCategory: UNSUPPORTED_VIDEO_FORMAT_CATEGORY,
    }),
    false,
  );
  assert.equal(
    shouldRecordMovieProgressAfterPlayback({
      firstFrameSeen: false,
      positionMs: 120000,
      durationMs: 7200000,
    }),
    false,
  );
  assert.equal(
    shouldRecordMovieProgressAfterPlayback({
      firstFrameSeen: true,
      positionMs: 180000,
      durationMs: 7200000,
    }),
    true,
  );
  assert.match(controller, /shouldRecordMovieProgressAfterPlayback\(/);
  assert.match(controller, /firstFrameSeen/);
});

test('AVC 1080p / HEVC 1080p / HEVC 4K classification', () => {
  assert.equal(isMovieCodecRisk(avc1080), false);
  assert.equal(isMovieCodecRisk(hevc1080), false);
  assert.equal(isMovieCodecRisk(hevc4k), true);
  assert.equal(hevc1080.codec, 'hevc');
  assert.equal(hevc1080.height, 1080);
});

test('Xtream metadata parse and extension suffix is not a quality switch', () => {
  const parsed = parseXtreamVodVideoMetadata({
    container_extension: 'mkv',
    video: { codec_name: 'hevc', width: '3840', height: '1608' },
    direct_source: ALT_HLS,
  });
  assert.equal(parsed.videoCodec, 'hevc');
  assert.equal(parsed.videoWidth, 3840);
  assert.equal(parsed.directSource, ALT_HLS);
  assert.ok(MOVIE_FALLBACK_EXTENSIONS.includes('mp4'));
  assert.match(providerPlayback, /buildVodStreamUrl/);
  assert.match(diagnostics, /vodInfoContainerExtension/);
  assert.equal(isLegitimateMovieAlternateSource(PRIMARY_MKV, SUFFIX_MP4), false);
});

test('Media3 software decoder fallback is not forced for 4K HEVC', () => {
  assert.doesNotMatch(novaStreamPlayer, /decoderFallback|enableDecoderFallback|setDecoderFallback/);
  const compat = read('src/features/playback/unified/moviePlaybackCompatibility.ts');
  assert.match(compat, /software decoder fallback is not enabled/i);
});

test('FHD Fire TV / 4K TV device profiles', () => {
  assert.equal(fhdFireTv.conservativePlayback, true);
  assert.equal(fhdFireTv.platform, 'android-tv');
  assert.equal(uhdAndroidTv.conservativePlayback, false);
  assert.equal(
    resolveDevicePlaybackProfile({
      displayWidth: 1080,
      displayHeight: 1920,
      os: 'android',
      isTv: true,
      manufacturer: 'Amazon',
      apiLevel: 28,
    }).conservativePlayback,
    true,
  );
});

test('1b. FHD low-end + 3840x1608 HEVC is blocked before playback', () => {
  const decision = resolveMoviePreplayCompatibilityDecision({
    mediaType: 'movie',
    probe: hevc4k,
    profile: fhdFireTv,
    primaryStreamUrl: PRIMARY_MKV,
    categoryName: '4K',
  });
  assert.equal(isMovieResolutionRisk(hevc4k), true);
  assert.equal(decision.action, 'block');
  assert.equal(decision.reason, 'source-exceeds-device-profile');
  assert.match(controller, /event: 'preplay-blocked'/);
  assert.match(controller, /DEVICE_PERFORMANCE_RISK_ERROR/);
});

test('2b. FHD low-end + 3840x2072 HEVC is blocked', () => {
  assert.equal(
    resolveMoviePreplayCompatibilityDecision({
      mediaType: 'movie',
      probe: hevc4kTall,
      profile: fhdFireTv,
      primaryStreamUrl: PRIMARY_MKV,
    }).action,
    'block',
  );
});

test('3b. FHD low-end + 1920x1080 HEVC is allowed', () => {
  assert.equal(isMovieResolutionRisk(hevc1080), false);
  assert.equal(
    resolveMoviePreplayCompatibilityDecision({
      mediaType: 'movie',
      probe: hevc1080,
      profile: fhdFireTv,
      primaryStreamUrl: PRIMARY_MKV,
    }).action,
    'play',
  );
});

test('4b. FHD low-end + 1920x1080 AVC is allowed', () => {
  assert.equal(
    resolveMoviePreplayCompatibilityDecision({
      mediaType: 'movie',
      probe: avc1080,
      profile: fhdFireTv,
      primaryStreamUrl: PRIMARY_MKV,
    }).action,
    'play',
  );
});

test('5b. 4K category name + actual 1080p source is allowed', () => {
  assert.equal(
    resolveMoviePreplayCompatibilityDecision({
      mediaType: 'movie',
      probe: avc1080,
      profile: fhdFireTv,
      primaryStreamUrl: PRIMARY_MKV,
      categoryName: '4K Ultra HD Movies',
    }).action,
    'play',
  );
});

test('6b. missing dimensions are allowed and rely on runtime decoder handling', () => {
  assert.equal(missingDims.width, null);
  assert.equal(missingDims.height, null);
  assert.equal(isMovieResolutionRisk(missingDims), false);
  assert.equal(
    resolveMoviePreplayCompatibilityDecision({
      mediaType: 'movie',
      probe: missingDims,
      profile: fhdFireTv,
      primaryStreamUrl: PRIMARY_MKV,
    }).action,
    'play',
  );
  assert.equal(isVideoDecoderInitFailure(HEVC_4K_DECODER_ERROR), true);
});

test('7b. real compatible direct_source is used once', () => {
  const decision = resolveMoviePreplayCompatibilityDecision({
    mediaType: 'movie',
    probe: { ...hevc4k, directSourceKind: 'hls' },
    profile: fhdFireTv,
    primaryStreamUrl: PRIMARY_MKV,
    directSourceUrl: ALT_HLS,
  });
  assert.equal(decision.action, 'fallback');
  assert.equal(decision.source.reason, 'direct-source-hls');
  assert.equal(
    isPlausiblyMoreCompatibleMovieAlternate({
      primaryStreamUrl: PRIMARY_MKV,
      directSourceUrl: ALT_HLS,
      alternateProbe: { codec: null, width: null, height: null, directSourceKind: 'hls' },
      profile: fhdFireTv,
    }),
    true,
  );
  assert.match(controller, /streamOverride/);
});

test('8b. fake extension-only alternate is rejected', () => {
  assert.equal(isLegitimateMovieAlternateSource(PRIMARY_MKV, SUFFIX_MP4), false);
  assert.equal(
    resolveMoviePreplayCompatibilityDecision({
      mediaType: 'movie',
      probe: hevc4k,
      profile: fhdFireTv,
      primaryStreamUrl: PRIMARY_MKV,
      directSourceUrl: SUFFIX_MP4,
    }).action,
    'block',
  );
});

test('9b. no alternate -> clean compatibility error', () => {
  const copy = resolveMovieCompatibilityErrorCopy({
    errorMessage: DEVICE_PERFORMANCE_RISK_ERROR,
    errorCategory: UNSUPPORTED_VIDEO_FORMAT_CATEGORY,
  });
  assert.equal(copy.title, DEVICE_PERFORMANCE_RISK_ERROR);
  assert.equal(copy.message, DEVICE_PERFORMANCE_RISK_DETAIL);
  assert.equal(DEVICE_PERFORMANCE_RISK_REASON, 'device-performance-risk');
  assert.equal(shouldRetryMovieUnsupportedFormat(UNSUPPORTED_VIDEO_FORMAT_CATEGORY), false);
});

test('10b. no Continue Watching entry for preplay block', () => {
  assert.equal(
    shouldRecordMovieProgressAfterPlayback({
      firstFrameSeen: false,
      positionMs: 0,
      durationMs: 7200000,
      preplayBlocked: true,
      errorCategory: UNSUPPORTED_VIDEO_FORMAT_CATEGORY,
    }),
    false,
  );
  assert.match(controller, /preplayBlocked/);
});

test('11b. Series untouched by preplay block', () => {
  assert.equal(
    resolveMoviePreplayCompatibilityDecision({
      mediaType: 'episode',
      probe: hevc4k,
      profile: fhdFireTv,
      primaryStreamUrl: PRIMARY_MKV,
    }).action,
    'play',
  );
});

test('12b. Live untouched by preplay block', () => {
  assert.equal(
    resolveMoviePreplayCompatibilityDecision({
      mediaType: 'live',
      probe: hevc4k,
      profile: fhdFireTv,
    }).action,
    'play',
  );
  assert.doesNotMatch(liveScreen, /resolveMoviePreplayCompatibilityDecision/);
});

test('13b. VOD focus/chrome wake untouched', () => {
  assert.match(remoteHandlers, /shouldConsumePlayerChromeWake/);
  assert.match(chromeWake, /wake-consumed/);
});

test('4K AVC on FHD low-end is also preplay-blocked', () => {
  assert.equal(isMovieCodecRisk(avc4k), false);
  assert.equal(isMovieResolutionRisk(avc4k), true);
  assert.equal(
    resolveMoviePreplayCompatibilityDecision({
      mediaType: 'movie',
      probe: avc4k,
      profile: fhdFireTv,
      primaryStreamUrl: PRIMARY_MKV,
    }).action,
    'block',
  );
  assert.equal(
    resolveMoviePreplayCompatibilityDecision({
      mediaType: 'movie',
      probe: avc4k,
      profile: uhdAndroidTv,
      primaryStreamUrl: PRIMARY_MKV,
    }).action,
    'play',
  );
});

test('errorCategory is deterministic for movie decoder init failure', () => {
  resetUnifiedPlayerForTests();
  launchUnifiedPlayback({
    id: 'hevc-4k',
    mediaType: 'movie',
    title: 'Test',
    streamUrl: PRIMARY_MKV,
    isLive: false,
  });
  setUnifiedPlayerError(UNSUPPORTED_VIDEO_FORMAT_ERROR, UNSUPPORTED_VIDEO_FORMAT_CATEGORY);
  assert.equal(getUnifiedPlayerState().errorCategory, 'unsupported-video-format');
  assert.equal(getUnifiedPlayerState().errorMessage, UNSUPPORTED_VIDEO_FORMAT_ERROR);
});
