// Thin client around the local Ollama HTTP API. Kept dependency-free
// (native fetch) so the whole app has zero backend of its own.

export async function checkConnection(baseUrl) {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function listModels(baseUrl) {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models || []).map((m) => m.name);
  } catch {
    return [];
  }
}

/**
 * Streams a chat completion from Ollama's /api/chat (NDJSON stream).
 * onFirstToken() fires once, right before the first content token
 * (used to flip the UI from "thinking" to "writing").
 * onToken(deltaText) fires per chunk. Returns the full assistant text.
 */
export async function streamChat({ baseUrl, model, messages, signal, onFirstToken, onToken }) {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // num_predict: -1 tells Ollama to generate until it's actually done
    // instead of stopping at its own default 128-token cap -- that cap
    // was silently truncating every long answer, on every model.
    body: JSON.stringify({ model, messages, stream: true, options: { num_predict: -1 } }),
    signal,
  });
  if (!res.ok || !res.body) {
    // Surface Ollama's own error text ("model not found", "requires
    // more system memory than is available", etc.) instead of a bare
    // status code -- this was getting swallowed and replaced with a
    // misleading "check the URL" toast no matter what actually failed.
    let detail = "";
    try {
      detail = (await res.clone().json())?.error || "";
    } catch {
      try { detail = await res.clone().text(); } catch { detail = ""; }
    }
    throw new Error(detail ? `Ollama: ${detail}` : `Ollama request failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  let firstFired = false;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      const delta = obj?.message?.content ?? "";
      if (delta) {
        if (!firstFired) {
          firstFired = true;
          onFirstToken?.();
        }
        full += delta;
        onToken?.(delta);
      }
      if (obj.done) return full;
    }
  }
  return full;
}
