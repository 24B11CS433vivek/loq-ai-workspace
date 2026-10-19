// Renders a /tools/convert result (or its error) inline in the chat,
// under the assistant's message. Reuses .data-artifact-* classes, same
// pattern as GenerateCard.jsx. A single conversion can produce more
// than one output file (pdf split into pages, a zip's contents, a
// batch of images), so this always renders a list.
export function ConvertCard({ results = [], error }) {
  if (error) {
    return <div className="data-artifact-error">⚠️ Conversion failed: {error}</div>;
  }
  if (!results.length) {
    return <div className="data-artifact-error">⚠️ Conversion produced no files.</div>;
  }
  return (
    <div className="data-artifact">
      <h3 className="data-artifact-title">
        {results.length === 1 ? results[0].filename : `${results.length} files`}
      </h3>
      <p className="data-artifact-op">
        {results[0].source_format?.toUpperCase()} → {results[0].target_format?.toUpperCase()}
      </p>
      <div className="convert-download-list">
        {results.map((r) => (
          <a
            key={r.filename}
            className="generate-download-btn"
            href={r.downloadUrl}
            download={r.filename}
            target="_blank"
            rel="noreferrer"
          >
            ⬇ Download {r.filename}
          </a>
        ))}
      </div>
    </div>
  );
}
