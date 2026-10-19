// Phase 11 — Voice. Mirrors the shape of vision.js/imagegen.js: plain
// FormData uploads to the backend, JSON back. transcribeAudio() powers
// the mic button in Composer.jsx; speakText() + audioDownloadUrl()
// power the speaker icon in Message.jsx.

export async function transcribeAudio({ backendUrl, blob, language }) {
  const form = new FormData();
  const ext = (blob.type.split("/")[1] || "webm").split(";")[0];
  form.append("file", blob, `recording.${ext}`);
  if (language) form.append("language", language);

  const res = await fetch(`${backendUrl.replace(/\/$/, "")}/tools/voice/transcribe`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Transcription failed (${res.status})`);
  }

  return res.json(); // { text, language }
}

export async function speakText({ backendUrl, text, voice }) {
  const form = new FormData();
  form.append("text", text);
  if (voice) form.append("voice", voice);

  const res = await fetch(`${backendUrl.replace(/\/$/, "")}/tools/voice/speak`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Speech synthesis failed (${res.status})`);
  }

  return res.json(); // { filename, voice, url }
}

export function audioDownloadUrl(backendUrl, relativeUrl) {
  return `${backendUrl.replace(/\/$/, "")}${relativeUrl}`;
}

// Voice cloning (Coqui XTTS-v2, zero-shot) -- powers the "Clone a voice"
// section of SettingsModal.jsx. sampleBlob is whatever the file input (or
// a future mic recording) hands us; the backend saves it as a reusable
// profile and returns a preview wav generated from `text` in that voice.
export async function cloneVoice({ backendUrl, sampleBlob, sampleFilename, text, name, language }) {
  const form = new FormData();
  form.append("sample", sampleBlob, sampleFilename || "sample.wav");
  form.append("text", text);
  form.append("name", name);
  if (language) form.append("language", language);

  const res = await fetch(`${backendUrl.replace(/\/$/, "")}/tools/voice/clone`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Voice cloning failed (${res.status})`);
  }

  return res.json(); // { filename, url, profile: { id, name } }
}

export async function listVoiceProfiles({ backendUrl }) {
  const res = await fetch(`${backendUrl.replace(/\/$/, "")}/tools/voice/clone/profiles`);
  if (!res.ok) return { profiles: [] };
  return res.json(); // { profiles: [{ id, name, sample_path, sample_seconds, created_at }] }
}

export async function deleteVoiceProfile({ backendUrl, profileId }) {
  const res = await fetch(`${backendUrl.replace(/\/$/, "")}/tools/voice/clone/profiles/${encodeURIComponent(profileId)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Delete failed (${res.status})`);
  }
  return res.json(); // { deleted: profileId }
}

// Phase 13 -- combined voice picker: built-in Piper voices (English +
// Telugu, each flagged `available` depending on whether the model has
// been downloaded) plus cloned profiles, already shaped as { id, label }
// so SettingsModal can drop them straight into one <select>.
export async function getVoices({ backendUrl }) {
  const res = await fetch(`${backendUrl.replace(/\/$/, "")}/tools/voice/voices`);
  if (!res.ok) return { builtin: [], clones: [] };
  return res.json(); // { builtin: [{id,label,lang,available}], clones: [{id,label,lang}] }
}
