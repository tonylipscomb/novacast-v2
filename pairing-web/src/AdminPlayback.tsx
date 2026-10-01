import { formatTimestamp } from './providerHealthDisplay';
import { derivePlaybackIssues, type Row } from './operationsCenter';

export function AdminPlayback({ devices, providers, onOpenDevice }: { devices: Row[]; providers: Row[]; onOpenDevice: (deviceKey: string) => void }) {
  const result = derivePlaybackIssues(devices, providers);
  return (
    <section className="playbackPage">
      <header className="simplePageHeader"><div><span className="eyebrow">OPERATIONS</span><h2>Playback issues</h2><p>Read-only playback and recovery signals reported by NovaCast devices.</p></div></header>
      {!result.available ? <div className="providerEmptyState"><strong>Playback telemetry unavailable</strong><span>The current device projection does not include recent playback telemetry.</span></div> : result.rows.length === 0 ? <div className="providerEmptyState"><strong>No recent playback issues</strong><span>No persisted playback failures were reported by the loaded devices.</span></div> : <div className="opsTableWrap"><table className="opsTable"><thead><tr><th>Device</th><th>Provider</th><th>Content</th><th>Route</th><th>Reason</th><th>Timestamp</th><th>Recovery</th></tr></thead><tbody>{result.rows.map((row) => <tr key={row.id}><td><button className="opsTableLink" onClick={() => onOpenDevice(row.deviceKey)}>{row.deviceKey}</button></td><td>{row.provider}</td><td>{row.contentType}</td><td>{row.route}</td><td>{row.reason}</td><td>{row.timestamp ? formatTimestamp(row.timestamp) : 'Not reported'}</td><td>{row.recovery}</td></tr>)}</tbody></table></div>}
    </section>
  );
}
