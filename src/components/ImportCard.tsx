interface ImportCardProps {
  text: string;
  errors: string[];
  onTextChange: (text: string) => void;
  onPaste: () => void;
  /** Presente só no modo demonstração. */
  onUseSample?: () => void;
}

export function ImportCard({ text, errors, onTextChange, onPaste, onUseSample }: ImportCardProps) {
  return (
    <section className="card" aria-label="Importar playlist">
      <h2>Cole a playlist aprovada no ChatGPT</h2>
      {onUseSample && (
        <div className="row sample">
          <button className="wide" onClick={onUseSample}>Usar playlist de exemplo</button>
        </div>
      )}
      <div className="row">
        <button className={`wide${onUseSample ? ' secondary' : ''}`} onClick={onPaste}>Colar da área de transferência</button>
        <label className="button secondary file">
          Arquivo .json
          <input type="file" accept=".json,application/json" aria-label="Arquivo JSON" onChange={(e) => e.target.files?.[0]?.text().then(onTextChange)} />
        </label>
      </div>
      <textarea
        aria-label="JSON da playlist"
        rows={6}
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        placeholder='Ou cole aqui: {"schema_version": "1.0", "playlist": {...}, "tracks": [...]}'
      />
      {errors.length > 0 && (
        <ul className="error" role="alert">
          {errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
    </section>
  );
}
