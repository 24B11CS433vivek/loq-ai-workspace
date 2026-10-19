// Thin client around the local FastAPI backend (Phase 3+). Mirrors the
// style of ollama.js. The frontend chat flow does not depend on this —
// it only powers backend-specific features introduced from Phase 3 on.

export async function checkBackendConnection(baseUrl) {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/health`);
    if (!res.ok) return false;
    const data = await res.json();
    return data?.status === "ok";
  } catch {
    return false;
  }
}
