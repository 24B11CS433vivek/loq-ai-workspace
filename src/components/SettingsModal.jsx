import { useEffect, useState } from "react";
import { checkConnection, listModels } from "../lib/ollama";
import { checkBackendConnection } from "../lib/backend";
import { loadPersonalities, savePersonalities, newPersonality } from "../lib/storage";
import { cloneVoice, getVoices, speakText, audioDownloadUrl, deleteVoiceProfile } from "../lib/tools/voice";

export default function SettingsModal({ settings, onSave, onClose, theme, onThemeChange, onApplyPersonality }) {
  const [url, setUrl] = useState(settings.ollamaUrl);
  const [model, setModel] = useState(settings.model);
  const [models, setModels] = useState([]);
  const [connected, setConnected] = useState(null);
  const [backendUrl, setBackendUrl] = useState(settings.backendUrl);
  const [backendConnected, setBackendConnected] = useState(null);
  const [defaultImageStyle, setDefaultImageStyle] = useState(settings.defaultImageStyle || "illustrative");
  const [imageInputMode, setImageInputMode] = useState(settings.imageInputMode || "generate");
  // Phase 19B -- SVG Studio preset. svgModel reuses the same `models`
  // list fetched from Ollama below (via the `url` connection check),
  // so any locally pulled model is selectable, not a hardcoded one.
  const [svgModel, setSvgModel] = useState(settings.svgModel || "");
  const [defaultSvgStyle, setDefaultSvgStyle] = useState(settings.defaultSvgStyle || "icon");
  const [svgThink, setSvgThink] = useState(settings.svgThink !== false);
  // Phase 19B (revised) -- Chart Engine setting. chartModel reuses
  // the same `models` list as svgModel above.
  const [chartModel, setChartModel] = useState(settings.chartModel || "");
  // Phase 19C -- Diagram Engine setting. diagramModel reuses the
  // same `models` list as svgModel/chartModel above.
  const [diagramModel, setDiagramModel] = useState(settings.diagramModel || "");
  const [personalities, setPersonalities] = useState(loadPersonalities);

  // Phase 13 -- voice library. ttsVoice is "piper" (default English), a
  // built-in id like "te_IN-padmavathi-medium", or "clone:<profileId>";
  // saved into settings and wired into Message.jsx's read-aloud button
  // via App.jsx (ttsVoice={settings.ttsVoice}).
  const [ttsVoice, setTtsVoice] = useState(settings.ttsVoice || "piper");
  const [voiceTab, setVoiceTab] = useState("library"); // "library" | "create"
  const [builtinVoices, setBuiltinVoices] = useState([]);
  const [voiceProfiles, setVoiceProfiles] = useState([]);
  const [cloneFile, setCloneFile] = useState(null);
  const [cloneName, setCloneName] = useState("");
  const [cloneText, setCloneText] = useState("");
  const [cloning, setCloning] = useState(false);
  const [cloneError, setCloneError] = useState(null);
  const [clonePreviewUrl, setClonePreviewUrl] = useState(null);
  const [deletingProfileId, setDeletingProfileId] = useState(null);
  const [deleteError, setDeleteError] = useState(null);
  const [playgroundText, setPlaygroundText] = useState("");
  const [playgroundState, setPlaygroundState] = useState("idle"); // idle | loading
  const [playgroundError, setPlaygroundError] = useState(null);
  const [playgroundNote, setPlaygroundNote] = useState(null);
  const [playgroundAudioUrl, setPlaygroundAudioUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await checkConnection(url);
      if (cancelled) return;
      setConnected(ok);
      if (ok) setModels(await listModels(url));
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await checkBackendConnection(backendUrl);
      if (!cancelled) setBackendConnected(ok);
    })();
    return () => {
      cancelled = true;
    };
  }, [backendUrl]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { builtin, clones } = await getVoices({ backendUrl });
      if (!cancelled) {
        setBuiltinVoices(builtin || []);
        setVoiceProfiles(clones || []);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backendUrl]);

  const handleCloneVoice = async () => {
    if (!cloneFile || !cloneName.trim() || !cloneText.trim()) {
      setCloneError("Pick a ~15s sample, name the voice, and enter text to preview.");
      return;
    }
    setCloning(true);
    setCloneError(null);
    setClonePreviewUrl(null);
    try {
      const result = await cloneVoice({
        backendUrl,
        sampleBlob: cloneFile,
        sampleFilename: cloneFile.name,
        text: cloneText,
        name: cloneName,
      });
      setClonePreviewUrl(audioDownloadUrl(backendUrl, result.url));
      const { clones } = await getVoices({ backendUrl });
      setVoiceProfiles(clones || []);
      setTtsVoice(`clone:${result.profile.id}`);
      setVoiceTab("library");
    } catch (err) {
      setCloneError(err.message);
    } finally {
      setCloning(false);
    }
  };

  const handleDeleteProfile = async (profileId) => {
    if (!window.confirm("Delete this cloned voice? This can't be undone.")) return;
    setDeletingProfileId(profileId);
    setDeleteError(null);
    try {
      await deleteVoiceProfile({ backendUrl, profileId });
      const { clones } = await getVoices({ backendUrl });
      setVoiceProfiles(clones || []);
      if (ttsVoice === `clone:${profileId}`) setTtsVoice("piper");
    } catch (err) {
      setDeleteError(err.message);
    } finally {
      setDeletingProfileId(null);
    }
  };

  const handleSpeakPlayground = async () => {
    if (!playgroundText.trim()) {
      setPlaygroundError("Type something to read aloud first.");
      return;
    }
    setPlaygroundState("loading");
    setPlaygroundError(null);
    setPlaygroundNote(null);
    try {
      const result = await speakText({
        backendUrl,
        text: playgroundText,
        voice: ttsVoice && ttsVoice !== "piper" ? ttsVoice : undefined,
      });
      setPlaygroundAudioUrl(audioDownloadUrl(backendUrl, result.url));
      setPlaygroundNote(result.note || null);
    } catch (err) {
      setPlaygroundError(err.message);
    } finally {
      setPlaygroundState("idle");
    }
  };

  const updatePersonality = (id, patch) => {
    setPersonalities((prev) => {
      const next = prev.map((p) => (p.id === id ? { ...p, ...patch } : p));
      savePersonalities(next);
      return next;
    });
  };

  const addPersonality = () => {
    setPersonalities((prev) => {
      const next = [...prev, newPersonality()];
      savePersonalities(next);
      return next;
    });
  };

  const removePersonality = (id) => {
    setPersonalities((prev) => {
      const next = prev.filter((p) => p.id !== id);
      savePersonalities(next);
      return next;
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Settings</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close settings">✕</button>
        </div>

        <div className="modal-body">

        <div className="settings-section">
          <div className="settings-section-title">Connection</div>
        <div className="field">
          <label>
            <span className={`conn-dot ${connected ? "ok" : "bad"}`} />
            Ollama server URL
          </label>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://localhost:11434" />
        </div>

        <div className="field">
          <label>Model</label>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">Select a model…</option>
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>
            <span className={`conn-dot ${backendConnected ? "ok" : "bad"}`} />
            Backend server URL
          </label>
          <input value={backendUrl} onChange={(e) => setBackendUrl(e.target.value)} placeholder="http://localhost:8008" />
        </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">Image & SVG</div>
        <div className="field">
          <label>Default image style</label>
          <select value={defaultImageStyle} onChange={(e) => setDefaultImageStyle(e.target.value)}>
            <option value="illustrative">Illustrative</option>
            <option value="realistic">Realistic</option>
            <option value="cyberrealistic">CyberRealistic</option>
          </select>
        </div>

        <div className="field">
          <label>SVG model</label>
          <select value={svgModel} onChange={(e) => setSvgModel(e.target.value)}>
            <option value="">Use default ({model || "backend fallback"})</option>
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <p className="field-hint">Any model pulled in Ollama can generate SVGs — pick one here, or leave on default to reuse your chat model / the backend's fallback.</p>
        </div>

        <div className="field">
          <label>Default SVG style</label>
          <select value={defaultSvgStyle} onChange={(e) => setDefaultSvgStyle(e.target.value)}>
            <option value="icon">Icon</option>
            <option value="logo">Logo</option>
            <option value="illustration">Illustration</option>
            <option value="badge">Badge</option>
          </select>
        </div>

        <div className="field">
          <label className="field-checkbox">
            <input
              type="checkbox"
              checked={svgThink}
              onChange={(e) => setSvgThink(e.target.checked)}
            />
            Think before generating SVGs
          </label>
          <p className="field-hint">Runs a quick design-brief pass (layout, shapes, colors) before generating the SVG itself — better results, one extra round-trip.</p>
        </div>

        <div className="field">
          <label>Chart model</label>
          <select value={chartModel} onChange={(e) => setChartModel(e.target.value)}>
            <option value="">{model ? `Use main model (${model})` : "Use default (qwen3:4b)"}</option>
            {models.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <p className="field-hint">Model used to turn a typed chart request into a type + labels + values. Leave on "Use main model" to always follow whatever you have selected as your main model above, or pin a specific (ideally small/fast) model here instead. Toggle chart mode in the composer, type a prompt, press Enter.</p>
        </div>

        <div className="field">
          <label>Diagram model</label>
          <select value={diagramModel} onChange={(e) => setDiagramModel(e.target.value)}>
            <option value="">{model ? `Use main model (${model})` : "Use default (qwen3:4b)"}</option>
            {models.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <p className="field-hint">Model used to turn a typed diagram request into Mermaid code. Leave on "Use main model" to always follow whatever you have selected as your main model above, or pin a specific (ideally small/fast) model here instead. Toggle diagram mode in the composer, type a prompt, press Enter.</p>
        </div>

        <div className="field">
          <label>Image mode input</label>
          <select value={imageInputMode} onChange={(e) => setImageInputMode(e.target.value)}>
            <option value="generate">Create images (type a prompt)</option>
            <option value="upload">Upload a photo (enhance & download)</option>
          </select>
        </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">Voice</div>
        <div className="field voice-section">
          <p className="field-hint">Pick a voice for chat read-aloud and try it below, or record a new one. Telugu text is auto-detected and read with the Telugu voice.</p>

          <div className="voice-tabs">
            <button
              type="button"
              className={`voice-tab ${voiceTab === "library" ? "active" : ""}`}
              onClick={() => setVoiceTab("library")}
            >
              Use a voice
            </button>
            <button
              type="button"
              className={`voice-tab ${voiceTab === "create" ? "active" : ""}`}
              onClick={() => setVoiceTab("create")}
            >
              Create voice
            </button>
          </div>

          {voiceTab === "library" ? (
            <div className="voice-panel">
              <select value={ttsVoice} onChange={(e) => setTtsVoice(e.target.value)}>
                <option value="piper">English (default)</option>
                {builtinVoices.filter((v) => v.id !== "en_US-lessac-medium").map((v) => (
                  <option key={v.id} value={v.id} disabled={v.available === false}>
                    {v.label}{v.available === false ? " (not downloaded)" : ""}
                  </option>
                ))}
                {voiceProfiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>

              {voiceProfiles.length > 0 && (
                <div className="voice-profile-list">
                  {voiceProfiles.map((p) => {
                    const rawId = p.id.replace(/^clone:/, "");
                    return (
                      <div key={p.id} className="voice-profile-row">
                        <span className="voice-profile-label">{p.label}</span>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => handleDeleteProfile(rawId)}
                          disabled={deletingProfileId === rawId}
                          title="Delete this cloned voice"
                        >
                          {deletingProfileId === rawId ? "…" : "✕"}
                        </button>
                      </div>
                    );
                  })}
                  {deleteError && <div className="field-error">{deleteError}</div>}
                </div>
              )}

              <textarea
                rows={2}
                value={playgroundText}
                onChange={(e) => setPlaygroundText(e.target.value)}
                placeholder="Paste or type text (English or Telugu) to hear it in the selected voice…"
              />

              <button className="btn btn-ghost btn-block" onClick={handleSpeakPlayground} disabled={playgroundState === "loading"}>
                {playgroundState === "loading" ? "Synthesizing…" : "Speak with this voice"}
              </button>

              {playgroundError && <div className="field-error">{playgroundError}</div>}
              {playgroundNote && <div className="field-note">{playgroundNote}</div>}
              {playgroundAudioUrl && <audio controls src={playgroundAudioUrl} className="clone-audio-preview" />}
            </div>
          ) : (
            <div className="voice-panel voice-clone-card">
              <p className="field-hint">Upload a clear 10–30s sample, name it, then preview. Cloned voices read English (and a handful of other languages) — not Telugu yet, since the underlying model doesn't support it.</p>

              <label className="file-drop">
                <input
                  type="file"
                  accept="audio/*"
                  onChange={(e) => setCloneFile(e.target.files?.[0] || null)}
                />
                <span>{cloneFile ? cloneFile.name : "Choose audio sample…"}</span>
              </label>

              <input
                value={cloneName}
                onChange={(e) => setCloneName(e.target.value)}
                placeholder="Voice name (e.g. My Voice)"
              />

              <textarea
                rows={2}
                value={cloneText}
                onChange={(e) => setCloneText(e.target.value)}
                placeholder="Type something to preview in the cloned voice…"
              />

              <button className="btn btn-ghost btn-block" onClick={handleCloneVoice} disabled={cloning}>
                {cloning ? "Cloning… (first run downloads the model)" : "Clone & preview"}
              </button>

              {cloneError && <div className="field-error">{cloneError}</div>}
              {clonePreviewUrl && <audio controls src={clonePreviewUrl} className="clone-audio-preview" />}
            </div>
          )}
        </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">Appearance</div>
        <div className="field">
          <label>Theme</label>
          <select value={theme} onChange={(e) => onThemeChange(e.target.value)}>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">Personalities</div>
          <div className="personality-list">
            {personalities.map((p) => (
              <div className="personality-item" key={p.id}>
                <div className="personality-item-header">
                  <input
                    className="personality-name"
                    value={p.name}
                    placeholder="Name"
                    onChange={(e) => updatePersonality(p.id, { name: e.target.value })}
                  />
                  <button className="btn btn-ghost personality-remove" onClick={() => removePersonality(p.id)} title="Remove personality">✕</button>
                </div>
                <select
                  value={p.preferredModel}
                  onChange={(e) => updatePersonality(p.id, { preferredModel: e.target.value })}
                >
                  <option value="">No preferred model</option>
                  {models.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <textarea
                  className="personality-prompt"
                  rows={2}
                  placeholder="System prompt…"
                  value={p.systemPrompt}
                  onChange={(e) => updatePersonality(p.id, { systemPrompt: e.target.value })}
                />
                {onApplyPersonality && (
                  <div className="personality-item-actions">
                    <button className="btn btn-ghost" onClick={() => onApplyPersonality(p)}>Apply to current chat</button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <button className="btn btn-ghost" onClick={addPersonality}>+ Add personality</button>
        </div>

        </div>

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={() => {
              onSave({ ollamaUrl: url, model, backendUrl, defaultImageStyle, imageInputMode, ttsVoice, svgModel, defaultSvgStyle, svgThink, chartModel, diagramModel });
              onClose();
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}