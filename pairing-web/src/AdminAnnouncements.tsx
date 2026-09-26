import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { adminRequest } from './pairing';
import { announcementListRequestInit, createAnnouncementRefreshGate, normalizeAnnouncementItems } from './adminAnnouncementRefresh';
import {
  ANNOUNCEMENT_IMPORTANCES,
  announcementActionPath,
  announcementKindLabel,
  announcementStatusLabel,
  deriveAnnouncementStatus,
  draftFromRecord,
  emptyAnnouncementDraft,
  localInputToIso,
  MAX_BADGE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_SECONDARY_LENGTH,
  MAX_TITLE_LENGTH,
  validateAnnouncementDraft,
  validateArtworkFile,
  type AnnouncementDraft,
  type AnnouncementRecord,
} from './novaPulseAnnouncements';

type Props = { token: string; onMessage: (message: string) => void };

const actionError = (error: unknown) => {
  const category = error instanceof Error ? error.message : '';
  if (category === 'admin_unauthorized') return 'Your administrator session expired. Sign in again.';
  if (category === 'admin_forbidden') return 'Your account is not allowed to manage NovaPulse announcements.';
  if (category === 'announcement_revision_conflict') return 'Another administrator changed this announcement. Reload the latest version before saving.';
  if (category === 'provider_targeting_unavailable') return 'Provider-targeted alerts are not available yet.';
  if (category === 'critical_requires_future_end') return 'Critical alerts require a future end time.';
  if (category.startsWith('invalid_') || category.includes('_too_long') || category === 'ends_at_must_follow_starts_at') return 'The announcement fields are not valid. Review the highlighted limits and schedule.';
  if (category === 'request_too_large' || category === 'artwork_too_large') return 'The artwork is larger than the 5 MB server limit.';
  if (category === 'artwork_mime_mismatch' || category === 'invalid_artwork_format') return 'The artwork content does not match a supported JPEG, PNG, or WebP image.';
  return 'NovaPulse announcement service is temporarily unavailable. Try again.';
};

function replaceItem(items: AnnouncementRecord[], item: AnnouncementRecord) {
  const found = items.some((value) => value.id === item.id);
  return found ? items.map((value) => value.id === item.id ? item : value) : [item, ...items];
}

export function AdminAnnouncements({ token, onMessage }: Props) {
  const [items, setItems] = useState<AnnouncementRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<AnnouncementRecord | null>(null);
  const [draft, setDraft] = useState<AnnouncementDraft>(emptyAnnouncementDraft);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const refreshGate = useRef(createAnnouncementRefreshGate());

  const load = useCallback(async (quiet = false) => {
    if (!refreshGate.current.tryStart()) return;
    if (quiet) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const result = await adminRequest(`${announcementActionPath('list')}&limit=100`, token, announcementListRequestInit());
      setItems(normalizeAnnouncementItems<AnnouncementRecord>(result));
    } catch (requestError) {
      setError(actionError(requestError));
    } finally {
      if (quiet) setRefreshing(false); else setLoading(false);
      refreshGate.current.finish();
    }
  }, [token]);

  // Data hydration is the external-system synchronization this effect owns.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const beginCreate = () => {
    setEditing(null); setDraft(emptyAnnouncementDraft); setFile(null); setPreviewUrl(null); setConflict(false);
    setEditorOpen(true);
  };
  const beginEdit = (item: AnnouncementRecord) => {
    setEditing(item); setDraft(draftFromRecord(item)); setFile(null); setPreviewUrl(item.artworkUrl); setConflict(false); setEditorOpen(true);
  };
  const cancel = () => { setEditing(null); setFile(null); setPreviewUrl(null); setConflict(false); setEditorOpen(false); };
  const change = (field: keyof AnnouncementDraft, value: string) => setDraft((current) => ({ ...current, [field]: value }));

  const upload = async (item: AnnouncementRecord, selectedFile: File) => {
    const form = new FormData();
    form.append('id', item.id);
    form.append('revision', String(item.revision));
    form.append('file', selectedFile);
    const result = await adminRequest(announcementActionPath('upload_artwork'), token, { method: 'POST', body: form });
    return result.item as AnnouncementRecord;
  };

  const save = async (event: FormEvent, publish: boolean) => {
    event.preventDefault();
    const validation = validateAnnouncementDraft(draft, publish);
    if (validation || busy) { if (validation) onMessage(validation); return; }
    setBusy(true); setConflict(false);
    try {
      const body = {
        title: draft.title,
        description: draft.description,
        secondaryText: draft.secondaryText || null,
        badge: draft.badge || null,
        kind: draft.kind,
        importance: draft.importance,
        priority: Number(draft.priority),
        startsAt: localInputToIso(draft.startsAt),
        endsAt: localInputToIso(draft.endsAt),
      };
      const result = await adminRequest(announcementActionPath(editing ? 'update' : 'create_draft'), token, {
        method: 'POST', body: JSON.stringify(editing ? { ...body, id: editing.id, revision: editing.revision } : body),
      });
      let item = result.item as AnnouncementRecord;
      setItems((current) => replaceItem(current, item));
      if (file) {
        try { item = await upload(item, file); setItems((current) => replaceItem(current, item)); }
        catch (uploadError) { setEditing(item); setDraft(draftFromRecord(item)); onMessage(`Announcement saved, but artwork upload failed: ${actionError(uploadError)}`); return; }
      }
      if (publish) {
        const published = await adminRequest(announcementActionPath('publish'), token, { method: 'POST', body: JSON.stringify({ id: item.id, revision: item.revision }) });
        item = published.item as AnnouncementRecord;
        setItems((current) => replaceItem(current, item));
      }
      onMessage(publish ? 'NovaPulse announcement published.' : 'NovaPulse draft saved.');
      cancel();
    } catch (requestError) {
      if (requestError instanceof Error && requestError.message === 'announcement_revision_conflict') setConflict(true);
      onMessage(actionError(requestError));
    } finally { setBusy(false); }
  };
  const saveWithPublish = () => void save({ preventDefault: () => undefined } as FormEvent, true);

  const mutate = async (item: AnnouncementRecord, action: 'disable' | 'archive' | 'delete_artwork') => {
    if (busy) return;
    if (action === 'archive' && !window.confirm('Archive this announcement? It will no longer appear in the TV feed.')) return;
    setBusy(true);
    try {
      const result = await adminRequest(announcementActionPath(action), token, { method: 'POST', body: JSON.stringify({ id: item.id, revision: item.revision }) });
      const next = result.item as AnnouncementRecord;
      setItems((current) => replaceItem(current, next));
      if (editing?.id === next.id) { setEditing(next); setDraft(draftFromRecord(next)); setPreviewUrl(next.artworkUrl); }
      onMessage(action === 'archive' ? 'Announcement archived.' : action === 'disable' ? 'Announcement disabled.' : 'Artwork removed.');
    } catch (requestError) { onMessage(actionError(requestError)); }
    finally { setBusy(false); }
  };

  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time', []);
  const editorTitle = editing ? 'Edit announcement' : 'Create announcement';

  return <section className="announcementAdmin opsPage">
    <div className="announcementHeader">
      <div><span className="cloudTopEyebrow">NOVAPULSE CONTROL</span><h2>Announcements</h2><p>Publish short, safe TV messages without touching the device app.</p></div>
      <div className="announcementHeaderActions"><button onClick={() => void load(true)} disabled={refreshing}>{refreshing ? 'Refreshing' : 'Refresh'}</button><button className="cloudPrimary" onClick={beginCreate}>New announcement</button></div>
    </div>
    {error ? <div className="cloudAdminNotice error" role="alert"><span>{error}</span><button onClick={() => void load()}>Retry</button></div> : null}
    <div className="announcementLayout">
      <div className="announcementListPanel cloudSimplePanel">
        <header><div><span className="cloudTopEyebrow">CONTENT QUEUE</span><h3>Published and drafted messages</h3></div><strong>{items.length}</strong></header>
        {loading ? <div className="announcementEmpty">Loading announcements…</div> : !items.length && !error ? <div className="announcementEmpty"><strong>No announcements yet</strong><span>Create a draft to prepare the first NovaPulse message.</span></div> : <div className="announcementList">{items.map((item) => <AnnouncementRow key={item.id} item={item} onEdit={() => beginEdit(item)} onDisable={() => void mutate(item, 'disable')} onArchive={() => void mutate(item, 'archive')} onArtwork={() => void mutate(item, 'delete_artwork')} />)}</div>}
      </div>
      <div className="announcementEditorPanel">
        {editorOpen ? <form className="announcementEditor cloudSimplePanel" onSubmit={(event) => void save(event, false)}>
          <header><div><span className="cloudTopEyebrow">EDITOR</span><h3>{editorTitle}</h3></div><button type="button" className="ghostButton" onClick={cancel}>Cancel</button></header>
          {conflict ? <div className="announcementConflict"><strong>Revision conflict</strong><span>Another admin saved a newer version. Your edits are preserved.</span><button type="button" onClick={() => { if (editing) { const latest = items.find((item) => item.id === editing.id); if (latest) beginEdit(latest); } setConflict(false); }}>Reload latest</button></div> : null}
          <div className="announcementFields">
            <label>Badge / label<input maxLength={MAX_BADGE_LENGTH} value={draft.badge} onChange={(event) => change('badge', event.target.value)} placeholder="UPDATE" /></label>
            <label>Title<input maxLength={MAX_TITLE_LENGTH} value={draft.title} onChange={(event) => change('title', event.target.value)} /></label>
            <label>Subtitle<input maxLength={MAX_SECONDARY_LENGTH} value={draft.secondaryText} onChange={(event) => change('secondaryText', event.target.value)} /></label>
            <label>Description / body<textarea maxLength={MAX_DESCRIPTION_LENGTH} rows={5} value={draft.description} onChange={(event) => change('description', event.target.value)} /></label>
            <label>Content type<select value={draft.kind} onChange={(event) => change('kind', event.target.value)}>{[['general', 'Announcement'], ['update', 'Update'], ['service_alert', 'Service alert']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}{draft.kind === 'provider_alert' ? <option value="provider_alert" disabled>Provider alert (unsupported)</option> : null}</select></label>
            <label>Importance<select value={draft.importance} onChange={(event) => change('importance', event.target.value)}>{ANNOUNCEMENT_IMPORTANCES.map((value) => <option key={value} value={value}>{value}</option>)}</select>{draft.importance === 'critical' ? <span className="fieldHint">End time is required for critical alerts.</span> : null}</label>
            <label>Priority <span className="fieldHint">0–100; higher appears first</span><input type="number" min="0" max="100" step="1" value={draft.priority} onChange={(event) => change('priority', event.target.value)} /></label>
            <div className="scheduleFields"><label>Starts at <span className="fieldHint">{timezone}</span><input type="datetime-local" value={draft.startsAt} onChange={(event) => change('startsAt', event.target.value)} /></label><label>Ends at <span className="fieldHint">optional</span><input type="datetime-local" value={draft.endsAt} onChange={(event) => change('endsAt', event.target.value)} /></label></div>
            <label>Artwork <span className="fieldHint">JPEG, PNG, or WebP · max 5 MB</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const selected = event.target.files?.[0] ?? null; if (!selected) return; const failure = validateArtworkFile(selected); if (failure) { onMessage(failure); event.target.value = ''; return; } setFile(selected); setPreviewUrl(URL.createObjectURL(selected)); }} /></label>
          </div>
          <div className="announcementEditorActions"><button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save draft'}</button><button type="button" className="cloudPrimary" disabled={busy || Boolean(validateAnnouncementDraft(draft, true))} onClick={saveWithPublish}>Publish / schedule</button>{editing?.artworkUrl ? <button type="button" className="dangerButton" disabled={busy} onClick={() => void mutate(editing, 'delete_artwork')}>Remove artwork</button> : null}</div>
          <small>Publishing now or scheduling uses the server’s authoritative revision and schedule validation.</small>
        </form> : <div className="announcementEditor cloudSimplePanel announcementEditorEmpty"><span className="cloudTopEyebrow">TV PREVIEW</span><h3>Select an announcement</h3><p>Create a message to see the NovaPulse card preview and edit its schedule.</p></div>}
        {editorOpen ? <TvPreview draft={draft} artworkUrl={previewUrl} /> : null}
      </div>
    </div>
  </section>;
}

function AnnouncementRow({ item, onEdit, onDisable, onArchive, onArtwork }: { item: AnnouncementRecord; onEdit: () => void; onDisable: () => void; onArchive: () => void; onArtwork: () => void }) {
  const status = deriveAnnouncementStatus(item);
  const schedule = item.startsAt ? `Starts ${new Date(item.startsAt).toLocaleString()}` : item.endsAt ? `Until ${new Date(item.endsAt).toLocaleString()}` : 'Open schedule';
  return <article className="announcementRow"><div className="announcementThumb">{item.artworkUrl ? <img src={item.artworkUrl} alt="" /> : <span>N</span>}</div><div className="announcementRowBody"><div className="announcementRowTitle"><strong>{item.title || 'Untitled draft'}</strong><span className={`announcementStatus status-${status}`}>{announcementStatusLabel(status)}</span></div><p>{item.description || 'No description yet.'}</p><small>{announcementKindLabel(item.kind)} · {item.importance} · priority {item.priority} · {schedule} · revision {item.revision} · updated {new Date(item.updatedAt).toLocaleString()}</small><div className="adminRowActions">{item.kind !== 'provider_alert' ? <button onClick={onEdit}>Edit</button> : null}{status === 'live' || status === 'scheduled' ? <button onClick={onDisable}>Disable</button> : null}{item.artworkUrl ? <button onClick={onArtwork}>Remove artwork</button> : null}<button className="dangerButton" onClick={onArchive}>Archive</button></div></div></article>;
}

function TvPreview({ draft, artworkUrl }: { draft: AnnouncementDraft; artworkUrl: string | null }) {
  return <section className="tvAnnouncementPreview"><div className="tvPreviewLabel">TV PREVIEW <span>Device font rendering may differ slightly</span></div><div className="tvPreviewCard"><div className="tvPreviewCopy"><span className="tvPreviewBadge">{draft.badge || announcementKindLabel(draft.kind).toUpperCase()}</span><h3>{draft.title || 'Announcement title'}</h3><strong>{draft.secondaryText || 'Subtitle'}</strong><p>{draft.description || 'Your announcement description will appear here.'}</p></div><div className="tvPreviewArtwork">{artworkUrl ? <img src={artworkUrl} alt="" /> : <span>✦</span>}</div></div></section>;
}
