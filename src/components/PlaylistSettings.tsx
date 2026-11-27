export interface PlaylistMeta {
  name: string;
  description: string;
  public: boolean;
}

interface PlaylistSettingsProps {
  meta: PlaylistMeta;
  disabled: boolean;
  summary: { ready: number; pending: number; skipped: number; resolving: boolean; checked: number; total: number };
  warnings: string[];
  onChange: (meta: PlaylistMeta) => void;
}

export function PlaylistSettings({ meta, disabled, summary, warnings, onChange }: PlaylistSettingsProps) {
  return (
    <section className="card" aria-label="Playlist">
      <label>
        Nome
        <input disabled={disabled} value={meta.name} onChange={(e) => onChange({ ...meta, name: e.target.value })} />
      </label>
      {/* É um pedido ao Spotify (campo `public` da API), não uma garantia de privacidade. */}
      <fieldset className="visibility" disabled={disabled} aria-describedby="visibility-help">
        <legend>Visibilidade solicitada ao Spotify</legend>
        <label>
          <input type="radio" name="visibility" checked={!meta.public} onChange={() => onChange({ ...meta, public: false })} />
          Playlist não pública
        </label>
        <label>
          <input type="radio" name="visibility" checked={meta.public} onChange={() => onChange({ ...meta, public: true })} />
          Playlist pública
        </label>
        <small id="visibility-help">
          O Spotify pode ignorar essa configuração. Para restringir o acesso pelo link, use Tornar privada no aplicativo do
          Spotify.
        </small>
      </fieldset>
      <p className="summary">
        <span className="ok">{summary.ready} prontas</span>
        {summary.pending > 0 && <span className="warn">{summary.pending} para conferir</span>}
        {summary.skipped > 0 && <span className="muted">{summary.skipped} puladas</span>}
        {summary.resolving && <span className="muted">buscando {summary.checked}/{summary.total}</span>}
      </p>
      {warnings.length > 0 && <ul className="warning">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
    </section>
  );
}
