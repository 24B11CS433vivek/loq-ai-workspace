import { useRef, useState } from "react";
import { analyzeData } from "../../lib/tools/dataAnalysis";

// Phase 7 — attach a spreadsheet (CSV/XLSX). Mirrors DocumentButton's
// pattern (hardcoded into Composer.jsx since it needs backendUrl),
// but stores the raw file as a data: URL on the attachment instead of
// extracted text, so it can be re-uploaded to /tools/data/* for each
// follow-up question in the conversation.
export default function DataButton({ backendUrl, onAttach }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setBusy(true);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
        reader.readAsDataURL(file);
      });

      // Default ("describe") call — just to confirm the file parses
      // and to show the user a quick schema preview as the chip lands.
      const { schema } = await analyzeData({ backendUrl, file });

      onAttach({
        id: crypto.randomUUID(),
        type: "data",
        name: file.name,
        dataUrl,
        meta: { schema },
      });
    } catch (err) {
      console.error("[data] failed to attach", file.name, err);
      onAttach({
        id: crypto.randomUUID(),
        type: "data-error",
        name: `${file.name} — FAILED TO ATTACH`,
        dataUrl: "",
        meta: { error: err.message },
      });
      // A silently-ignored bad attachment is how you end up asking
      // questions about a file the model never actually got.
      alert(`Couldn't attach ${file.name} for analysis:\n\n${err.message}\n\nThis file will NOT be used — remove the red chip and try again once the backend issue is fixed.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        style={{ display: "none" }}
        onChange={handleFile}
      />
      <button
        className="tool-btn"
        title="Attach spreadsheet (CSV/XLSX) for data analysis"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
      >
        {busy ? "…" : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.7" />
            <path d="M3 9h18M3 15h18M9 3v18M15 3v18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        )}
      </button>
    </>
  );
}

function DataTable({ rows }) {
  if (!rows || rows.length === 0) return <p className="data-artifact-empty">No rows.</p>;
  const cols = Object.keys(rows[0]);
  return (
    <div className="data-artifact-table-wrap">
      <table className="data-artifact-table">
        <thead>
          <tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.slice(0, 100).map((r, i) => (
            <tr key={i}>{cols.map((c) => <td key={c}>{String(r[c])}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Renders an /tools/data/analyze result + optional /tools/data/chart
// image inside <ArtifactPanel/>. Exported alongside the default button
// so App.jsx can build panel content without a second new file.
export function DataArtifact({ filename, operation, result, imageBase64, error }) {
  if (error) {
    return <div className="data-artifact-error">⚠️ {error}</div>;
  }
  return (
    <div className="data-artifact">
      <h3 className="data-artifact-title">{filename}</h3>
      <p className="data-artifact-op">Operation: {operation?.op}</p>
      {imageBase64 && (
        <img
          className="data-artifact-chart"
          src={`data:image/png;base64,${imageBase64}`}
          alt="Generated chart"
        />
      )}
      {result?.op === "filter" && (
        <>
          <p className="data-artifact-caption">{result.matched} matching row(s)</p>
          <DataTable rows={result.rows} />
        </>
      )}
      {result?.op === "groupby" && <DataTable rows={result.rows} />}
      {result?.op === "describe" && (
        <>
          <p className="data-artifact-caption">
            {result.row_count} rows · {result.columns.length} columns
          </p>
          <DataTable rows={result.preview} />
        </>
      )}
      {result?.op === "correlation" && (
        <p className="data-artifact-caption">Columns: {result.columns.join(", ")}</p>
      )}
    </div>
  );
}
