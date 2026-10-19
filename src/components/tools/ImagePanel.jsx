import { useState, useRef } from "react";

const STYLES = [
  { id: "illustrative", label: "Illustrative" },
  { id: "realistic", label: "Realistic" },
  { id: "cyberrealistic", label: "CyberRealistic" },
];

// Phase 9d — Enhance chain options, in the fixed order the backend
// always runs them in (see backend/routers/image.py: face_fix ->
// upscale -> remove_bg -> color_grade).
const ENHANCE_OPTIONS = [
  { id: "face_fix", label: "Face fix" },
  { id: "upscale", label: "Upscale" },
  { id: "remove_bg", label: "Remove background" },
  { id: "color_grade", label: "Color grade" },
];
const ENHANCE_LABELS = Object.fromEntries(ENHANCE_OPTIONS.map((o) => [o.id, o.label]));

// Creative Studio toggle. Style is no longer picked per-click here —
// it lives in Settings ("Default image style", illustrative by
// default) so Generate is a single click. Clicking this button just
// arms "image mode": while it's active, the composer's normal
// Enter/send routes to onGenerateImage instead of a chat message, so
// typing a prompt and hitting Enter generates an image every time,
// no extra click needed. Click it again to go back to normal chat.
export default function ImageButton({ active, onToggle }) {
  return (
    <button
      className={`tool-btn compare-toggle ${active ? "active" : ""}`}
      title={active ? "Image mode on — type a prompt and press Enter to generate" : "Turn on image mode"}
      onClick={onToggle}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.7" />
        <circle cx="8.5" cy="8.5" r="1.5" stroke="currentColor" strokeWidth="1.7" />
        <path d="M21 15.5 16 10l-8.5 8.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

// Upload mode — settings.imageInputMode === "upload". Skips prompting
// entirely: pick a photo off disk and App.jsx's handleUploadImage
// sends it straight to /tools/image/upload, landing in chat as a
// normal ImageCard so the same Enhance popover (face fix / upscale /
// remove bg / color grade) and Download button just work on it.
export function ImageUploadButton({ onUpload }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      await onUpload(file);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        style={{ display: "none" }}
        onChange={handleFile}
      />
      <button
        className="tool-btn"
        title="Upload a photo to enhance (face fix / upscale / remove background / color grade)"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
      >
        {busy ? "…" : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <path d="M12 16V4M12 4l-4 4M12 4l4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
    </>
  );
}

// Enhance popover — pick which steps to run, then Apply. Lives right
// on the ImageCard (not the composer) since it acts on an image that's
// already in the chat. `onEnhance` (wired from App.jsx's
// handleEnhanceImage) does the actual /tools/image/enhance call;
// this component only collects the flags.
function EnhancePopover({ onApply, onClose }) {
  const [selected, setSelected] = useState({
    face_fix: false,
    upscale: true,
    remove_bg: false,
    color_grade: false,
  });
  const [upscaleFactor, setUpscaleFactor] = useState(2);

  const toggle = (id) => setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  const anySelected = Object.values(selected).some(Boolean);

  const handleApply = () => {
    if (!anySelected) return;
    onApply({ ...selected, upscale_factor: upscaleFactor });
    onClose();
  };

  return (
    <div className="generate-popover enhance-popover">
      <div className="generate-popover-row enhance-option-list">
        {ENHANCE_OPTIONS.map((o) => (
          <label key={o.id} className="enhance-option-row">
            <input type="checkbox" checked={!!selected[o.id]} onChange={() => toggle(o.id)} />
            {o.label}
          </label>
        ))}
      </div>
      {selected.upscale && (
        <div className="generate-popover-row generate-slides-row">
          <span>Upscale factor</span>
          <select value={upscaleFactor} onChange={(e) => setUpscaleFactor(Number(e.target.value))}>
            <option value={2}>2x</option>
            <option value={4}>4x</option>
          </select>
        </div>
      )}
      <p className="generate-popover-hint">
        Runs in order: face fix → upscale → remove background → color grade, whichever steps you enable.
      </p>
      <button className="generate-popover-submit" onClick={handleApply} disabled={!anySelected}>
        Apply
      </button>
    </div>
  );
}

// Edit popover — describe the change you want in plain text, pick how
// strongly to apply it, then Edit. Lives next to Enhance on the same
// ImageCard. `onApply` (wired from App.jsx's handleEditImage) calls
// /tools/image/edit (img2img on the current photo); this component
// only collects prompt + strength.
function EditPopover({ onApply, onClose }) {
  const [prompt, setPrompt] = useState("");
  const [strength, setStrength] = useState(0.55);
  // ControlNet locks the photo's composition/edges so edits stay accurate to
  // everything you didn't ask to change. Default on; turn off for edits that
  // deliberately restructure the image (pose changes, adding a big new
  // object) since a locked edge map would otherwise fight those.
  const [useControlnet, setUseControlnet] = useState(true);

  const handleApply = () => {
    const p = prompt.trim();
    if (!p) return;
    onApply({ prompt: p, strength, useControlnet });
    onClose();
  };

  return (
    <div className="generate-popover enhance-popover">
      <div className="generate-popover-row">
        <textarea
          className="edit-popover-textarea"
          placeholder="Describe the edit — e.g. 'add a sunset sky', 'make the jacket red', 'remove the background clutter'"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          autoFocus
        />
      </div>
      <div className="generate-popover-row generate-slides-row">
        <span>Strength</span>
        <input
          type="range"
          min="0.15"
          max="0.85"
          step="0.05"
          value={strength}
          onChange={(e) => setStrength(Number(e.target.value))}
        />
        <span>{strength.toFixed(2)}</span>
      </div>
      <label className="generate-popover-row edit-popover-controlnet-row">
        <input
          type="checkbox"
          checked={useControlnet}
          onChange={(e) => setUseControlnet(e.target.checked)}
        />
        <span>Lock composition (more accurate, keeps pose/layout)</span>
      </label>
      <p className="generate-popover-hint">
        Lower strength keeps the photo close to the original; higher strength follows the description more and changes more of the image. Turn off "Lock composition" if your edit should change the pose or add a large new object.
      </p>
      <button className="generate-popover-submit" onClick={handleApply} disabled={!prompt.trim()}>
        Apply edit
      </button>
    </div>
  );
}

// flight — i.e. before there's a URL to even blur-reveal. Reuses the
// same shimmer skeleton the ImageCard frame uses once the PNG exists,
// so the placeholder and the real card feel like the same element
// rather than the pulse-orb text suddenly being swapped for an image.
export function GeneratingImageSkeleton() {
  return (
    <div className="image-artifact inline-image-artifact">
      <div className="image-artifact-frame">
        <div className="image-artifact-skeleton">
          <div className="image-artifact-skeleton-shimmer" />
        </div>
      </div>
      <div className="image-artifact-footer">
        <span className="image-artifact-caption shimmer-text">Generating image…</span>
      </div>
    </div>
  );
}

// Renders a /tools/image/generate result (or its error) inline in the
// chat, under the assistant's message. The frame starts blurred/faded
// (see .image-artifact-img in theme.css) and the img's onLoad flips
// .is-loaded, which theme.css transitions into a sharp reveal — same
// "blurred-reveal" beat ChatGPT/Grok use, done in pure CSS so there's
// no extra animation library.
//
// Phase 9d — Enhance is wired to /tools/image/enhance. The backend
// runs the whole chain in a single request with no incremental
// updates, so `enhanceState.activeIndex` (driven by a client-side
// timer in App.jsx's handleEnhanceImage) walks the selected steps at
// a steady pace purely as a "something is happening" indicator — it's
// not tied to real per-step completion from the backend.
export function ImageCard({ filename, url, prompt, style, error, enhanced, onEnhance, enhanceState, onEditImage, editState }) {
  const [loaded, setLoaded] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [editPopoverOpen, setEditPopoverOpen] = useState(false);

  if (error) {
    return <div className="data-artifact-error">⚠️ Image generation failed: {error}</div>;
  }

  const styleLabel = STYLES.find((s) => s.id === style)?.label || style;
  const isRunning = enhanceState?.status === "running";
  const hasError = enhanceState?.status === "error";
  const isEditing = editState?.status === "running";
  const hasEditError = editState?.status === "error";

  return (
    <div className="image-artifact">
      <div className={`image-artifact-frame${loaded ? " is-loaded" : ""}`}>
        <div className="image-artifact-skeleton">
          <div className="image-artifact-skeleton-shimmer" />
        </div>
        <img
          className="image-artifact-img"
          src={url}
          alt={prompt || "Generated image"}
          onLoad={() => setLoaded(true)}
        />
      </div>

      {isRunning && (
        <div className="enhance-chain-progress">
          {enhanceState.steps.map((s, idx) => {
            const state =
              idx < enhanceState.activeIndex ? "done" : idx === enhanceState.activeIndex ? "active" : "pending";
            return (
              <div key={s} className={`enhance-chain-step ${state}`}>
                <span className="enhance-chain-dot" />
                <span className={state === "active" ? "shimmer-text" : ""}>{ENHANCE_LABELS[s] || s}</span>
              </div>
            );
          })}
        </div>
      )}
      {hasError && (
        <div className="data-artifact-error">⚠️ Enhancement failed: {enhanceState.error}</div>
      )}
      {hasEditError && (
        <div className="data-artifact-error">⚠️ Edit failed: {editState.error}</div>
      )}

      <div className="image-artifact-footer">
        <span className="image-artifact-caption" title={prompt}>{prompt}</span>
        <span className="image-artifact-badges">
          {enhanced && !isRunning && <span className="image-artifact-style-pill enhanced-pill">✨ Enhanced</span>}
          {styleLabel && <span className="image-artifact-style-pill">{styleLabel}</span>}
        </span>
      </div>

      <div className="image-artifact-actions">
        <div className="enhance-tool-wrap">
          <button
            className="image-artifact-enhance-btn"
            disabled={isRunning || !onEnhance}
            onClick={() => setPopoverOpen((v) => !v)}
            title="Enhance (face fix / upscale / background removal)"
          >
            {isRunning ? "✨ Enhancing…" : "✨ Enhance"}
          </button>
          {popoverOpen && !isRunning && (
            <EnhancePopover
              onApply={(opts) => onEnhance?.(opts)}
              onClose={() => setPopoverOpen(false)}
            />
          )}
        </div>
        <div className="enhance-tool-wrap">
          <button
            className="image-artifact-enhance-btn"
            disabled={isEditing || !onEditImage}
            onClick={() => setEditPopoverOpen((v) => !v)}
            title="Describe an edit and apply it to this photo"
          >
            {isEditing ? "🖌 Editing…" : "🖌 Edit"}
          </button>
          {editPopoverOpen && !isEditing && (
            <EditPopover
              onApply={(opts) => onEditImage?.(opts)}
              onClose={() => setEditPopoverOpen(false)}
            />
          )}
        </div>
        <a className="generate-download-btn" href={url} download={filename} target="_blank" rel="noreferrer">
          ⬇ Download
        </a>
      </div>
    </div>
  );
}
