// Phase 5 — RAG client. Mirrors ollama.js / backend.js style.
const base = (url) => url.replace(/\/$/, "");

export async function listCollections(backendUrl) {
  const res = await fetch(`${base(backendUrl)}/tools/rag/collections`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.collections || []; // [{ name, chunk_count }]
}

export async function createCollection(backendUrl, name) {
  const res = await fetch(`${base(backendUrl)}/tools/rag/collections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Create failed");
  return res.json();
}

export async function deleteCollection(backendUrl, name) {
  const res = await fetch(`${base(backendUrl)}/tools/rag/collections/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Delete failed");
  return res.json();
}

export async function listFiles(backendUrl, collection) {
  const res = await fetch(`${base(backendUrl)}/tools/rag/collections/${encodeURIComponent(collection)}/files`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.files || []; // [{ filename, chunk_count }]
}

export async function deleteFile(backendUrl, collection, filename) {
  const res = await fetch(
    `${base(backendUrl)}/tools/rag/collections/${encodeURIComponent(collection)}/files/${encodeURIComponent(filename)}`,
    { method: "DELETE" }
  );
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Delete failed");
  return res.json();
}

export async function ingestDocument(backendUrl, { collection, filename, text }) {
  const form = new FormData();
  form.append("collection", collection);
  form.append("filename", filename);
  form.append("text", text);

  const res = await fetch(`${base(backendUrl)}/tools/rag/ingest`, { method: "POST", body: form });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Ingest failed");
  return res.json();
}

export async function queryCollection(backendUrl, { collection, query, top_k = 8, history = [] }) {
  const res = await fetch(`${base(backendUrl)}/tools/rag/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ collection, query, top_k, history }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Query failed");
  return res.json(); // { chunks: [{text, source, distance}] }
}
