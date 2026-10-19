import { useRef, useState } from "react";

// Conversion Mode — click opens the native file picker straight away
// (no separate "arm mode then attach" step). Picked files are stored
// as raw base64 (type: "convert-file") instead of extracted text, so
// the actual bytes can be posted to /tools/convert unmodified once the
// person types a prompt like "convert to png" and hits send. Composer's
// send() checks for a "convert-file" attachment and routes to
// onGenerateConvert instead of a normal chat message — see Composer.jsx.
export default function ConvertToggle({ active, onAttachFiles }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const readAsDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });

  const handleFiles = async (e) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = "";
    if (picked.length === 0) return;

    setBusy(true);
    try {
      const attachments = await Promise.all(
        picked.map(async (file) => ({
          id: crypto.randomUUID(),
          type: "convert-file",
          name: file.name,
          dataUrl: await readAsDataUrl(file),
          mime: file.type || "application/octet-stream",
        }))
      );
      onAttachFiles(attachments);
    } catch (err) {
      console.error("[convert] failed to read picked file(s)", err);
      alert(`Couldn't read one of the picked files:\n\n${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={handleFiles}
      />
      <button
        className={`tool-btn compare-toggle ${active ? "active" : ""}`}
        title={active ? "Conversion mode — type what to convert to, then press Enter" : "Convert a file (image/PDF/doc/audio/etc.)"}
        disabled={busy}
        onClick={() => fileRef.current?.click()}
      >
        {busy ? "…" : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <path d="M17 2l4 4-4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3 12v-1a4 4 0 0 1 4-4h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M7 22l-4-4 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M21 12v1a4 4 0 0 1-4 4H3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
    </>
  );
}
