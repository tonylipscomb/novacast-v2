export type DiagnosticCause = 'HEALTHY' | 'DEVICE_NETWORK' | 'PROVIDER_API' | 'STREAM_SERVER' | 'PLAYBACK_DECODER' | 'NOVACAST_APP' | 'UNKNOWN';

export function classifyDiagnostics(input: {
  providerLatencyMs?: number;
  providerTimedOut?: boolean;
  streamTimedOut?: boolean;
  decoderError?: boolean;
  broadAppFailure?: boolean;
  buffering?: boolean;
  networkFailures?: number;
}) {
  if (input.decoderError) return { cause: 'PLAYBACK_DECODER' as const, explanation: 'The stream responded, but the device decoder reported a playback failure.' };
  if (input.providerTimedOut || (input.providerLatencyMs ?? 0) >= 8_000) return { cause: 'PROVIDER_API' as const, explanation: 'The provider API is timing out or responding unusually slowly.' };
  if (input.streamTimedOut) return { cause: 'STREAM_SERVER' as const, explanation: 'The provider API is reachable, but the stream host repeatedly timed out.' };
  if ((input.networkFailures ?? 0) >= 3) return { cause: 'DEVICE_NETWORK' as const, explanation: 'Multiple unrelated requests are failing on this device, suggesting a network problem.' };
  if (input.broadAppFailure) return { cause: 'NOVACAST_APP' as const, explanation: 'Multiple providers or devices show failures around the same NovaCast application operation.' };
  if (!input.buffering) return { cause: 'HEALTHY' as const, explanation: 'No recent playback or provider health problem was detected.' };
  return { cause: 'UNKNOWN' as const, explanation: 'The available telemetry is not sufficient to identify a single cause.' };
}
