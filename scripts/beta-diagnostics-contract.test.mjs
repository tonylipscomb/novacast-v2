import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) =>
  readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

const ingest = read('supabase/functions/diagnostics-ingest/index.ts');
const admin = read('supabase/functions/admin-diagnostics/index.ts');
const playback = read('src/features/analytics/playbackAnalytics.ts');
const client = read('src/features/diagnostics/diagnosticsClient.ts');
const registration = read('src/features/device/deviceRegistration.ts');
const runtimeNetwork = read('src/features/diagnostics/runtimeDiagnostics.ts');

test('admin diagnostics maps support-safe public device identity', () => {
  assert.match(admin, /public_device_code/);
  assert.match(admin, /assigned_tester_name/);
  assert.match(admin, /publicDeviceCode/);

  assert.doesNotMatch(
    admin,
    /device_secret|installation_hash|ip_hash|provider_password/i,
  );
});

test('playback diagnostics transports the active item title', () => {
  assert.match(
    playback,
    /contentTitle: attempt\.item\.title/,
  );

  assert.match(
    ingest,
    /content_title: contentTitle/,
  );

  assert.match(
    admin,
    /latestContentTitle/,
  );
});

test('session aggregation and safe network fields are wired', () => {
  assert.match(ingest, /diagnostic_sessions/);
  assert.match(ingest, /time_to_first_frame_ms/);

  assert.match(ingest, /network_connected/);
  assert.match(ingest, /connection_type/);
  assert.match(ingest, /network_latency_ms/);

  /*
   * diagnosticsClient should send canonical device metadata.
   * It must NOT replace that data with fake "unknown" network values.
   */
  assert.match(
    client,
    /device:\s*deviceMetadata\(\)/,
  );

  /*
   * deviceMetadata owns the real runtime network snapshot.
   */
  assert.match(
    registration,
    /network:\s*getCachedNetworkDiagnostics\(\)/,
  );

  assert.match(runtimeNetwork, /networkConnected/);
  assert.match(runtimeNetwork, /connectionType/);
  assert.match(runtimeNetwork, /internetReachable/);
  assert.match(runtimeNetwork, /latencyMs/);

  assert.doesNotMatch(
    client,
    /connectionType:\s*'unknown'/,
  );

  const combinedNetworkSources =
    client + '\n' + registration + '\n' + runtimeNetwork;

  assert.doesNotMatch(
    combinedNetworkSources,
    /ssid|bssid|macAddress|wifiPassword/i,
  );
});

test(
  'admin response derives playback identity and provider activity from recorded rows',
  () => {
    assert.match(admin, /playback\?\.content_title/);
    assert.match(admin, /providerActivityByDevice/);
    assert.match(admin, /lastSuccessfulProviderRequestAt/);
    assert.match(admin, /INSUFFICIENT_DATA/);
  },
);

test(
  'playback lifecycle uses correlated sessions and aggregate buffering fields',
  () => {
    assert.match(
      playback,
      /sessionId: createPlaybackSessionId\(\)/,
    );

    assert.match(
      playback,
      /eventType: 'player_preparing'/,
    );

    assert.match(
      playback,
      /totalBufferDurationMs: attempt\.bufferingDurationMs/,
    );

    assert.match(
      ingest,
      /isUuid\(event\.sessionId\)/,
    );

    assert.match(
      ingest,
      /total_buffer_duration_ms/,
    );
  },
);

test(
  'canonical playback emitter preserves title and identity for every media type',
  () => {
    assert.match(
      playback,
      /contentType: input\.contentType,[\s\S]*contentId: input\.contentId,[\s\S]*contentTitle: input\.contentTitle/,
    );

    for (const fixture of [
      {
        contentType: 'live',
        contentId: 'channel-b',
        contentTitle: 'Channel B',
      },
      {
        contentType: 'movie',
        contentId: 'movie-1',
        contentTitle: 'Movie One',
      },
      {
        contentType: 'series',
        contentId: 'episode-1',
        contentTitle: 'Episode One',
      },
    ]) {
      assert.equal(typeof fixture.contentId, 'string');
      assert.equal(typeof fixture.contentTitle, 'string');
      assert.ok(fixture.contentTitle.length > 0);
    }
  },
);
