import io
import uuid
import httpx
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/tools/rag", tags=["rag"])

OLLAMA_URL = "http://localhost:11434"
EMBED_MODEL = "nomic-embed-text"
EMBED_MODEL_FALLBACK = "qwen3:4b"  # small local model used only to rewrite follow-up questions
CHROMA_PATH = "./rag_store"

# Cosine distance ranges 0 (identical) to 2 (opposite). Chunks above
# this are treated as not relevant enough to answer from.
RELEVANCE_THRESHOLD = 0.68  # loosened: let the LLM judge relevance/sufficiency itself instead of the backend silently dropping borderline chunks

_client = None


def get_client():
    global _client
    if _client is None:
        import chromadb
        _client = chromadb.PersistentClient(path=CHROMA_PATH)
    return _client


def get_or_create(client, name):
    # cosine distance is far more meaningful to threshold than raw L2
    return client.get_or_create_collection(name, metadata={"hnsw:space": "cosine"})


async def embed_text(text: str):
    async with httpx.AsyncClient(timeout=60) as client:
        res = await client.post(
            f"{OLLAMA_URL}/api/embeddings",
            json={"model": EMBED_MODEL, "prompt": text},
        )
        res.raise_for_status()
        return res.json()["embedding"]


def chunk_text(text: str, chunk_size: int = 900, overlap: int = 150):
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    if not paragraphs:
        paragraphs = [text]

    chunks = []
    current = ""
    for para in paragraphs:
        if len(current) + len(para) + 2 <= chunk_size:
            current = f"{current}\n\n{para}" if current else para
        else:
            if current:
                chunks.append(current)
            if len(para) > chunk_size:
                start = 0
                while start < len(para):
                    end = start + chunk_size
                    chunks.append(para[start:end])
                    start = end - overlap
                current = ""
            else:
                current = para
    if current:
        chunks.append(current)

    return [c for c in chunks if c.strip()]


class CollectionCreate(BaseModel):
    name: str


@router.get("/collections")
def list_collections():
    client = get_client()
    result = []
    for c in client.list_collections():
        coll = client.get_collection(c.name)
        result.append({"name": c.name, "chunk_count": coll.count()})
    return {"collections": result}


@router.post("/collections")
def create_collection(body: CollectionCreate):
    client = get_client()
    get_or_create(client, body.name)
    return {"name": body.name, "created": True}


@router.delete("/collections/{name}")
def delete_collection(name: str):
    client = get_client()
    try:
        client.delete_collection(name)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"name": name, "deleted": True}


@router.get("/collections/{name}/files")
def list_files(name: str):
    client = get_client()
    try:
        coll = client.get_collection(name)
    except Exception:
        raise HTTPException(status_code=404, detail=f"Collection '{name}' not found")

    data = coll.get(include=["metadatas"])
    counts = {}
    for meta in data.get("metadatas", []):
        source = meta.get("source", "unknown")
        counts[source] = counts.get(source, 0) + 1

    files = [{"filename": k, "chunk_count": v} for k, v in counts.items()]
    return {"collection": name, "files": files}


@router.delete("/collections/{name}/files/{filename}")
def delete_file(name: str, filename: str):
    client = get_client()
    try:
        coll = client.get_collection(name)
    except Exception:
        raise HTTPException(status_code=404, detail=f"Collection '{name}' not found")

    coll.delete(where={"source": filename})
    return {"collection": name, "filename": filename, "deleted": True}


@router.post("/ingest")
async def ingest_document(
    collection: str = Form(...),
    filename: str = Form(...),
    text: str = Form(...),
):
    client = get_client()
    coll = get_or_create(client, collection)

    chunks = chunk_text(text)
    if not chunks:
        raise HTTPException(status_code=400, detail=f"No extractable text found in {filename} (it may be a scanned/image-only file)")

    ids, embeddings, metadatas, documents = [], [], [], []
    for i, chunk in enumerate(chunks):
        emb = await embed_text(chunk)
        ids.append(f"{filename}-{uuid.uuid4().hex[:8]}-{i}")
        embeddings.append(emb)
        metadatas.append({"source": filename, "chunk_index": i})
        documents.append(chunk)

    coll.add(ids=ids, embeddings=embeddings, metadatas=metadatas, documents=documents)
    return {"collection": collection, "filename": filename, "chunks_added": len(chunks)}


class RagQuery(BaseModel):
    collection: str
    query: str
    top_k: int = 8
    threshold: float = RELEVANCE_THRESHOLD
    history: list[str] = []


async def expand_query_with_history(query: str, history: list[str]) -> str:
    if not history:
        return query
    context = "\n".join(history[-6:])
    prompt = f'''Conversation so far:
{context}

Latest question: "{query}"

Rewrite the latest question into a fully self-contained search query — resolve any pronouns (he/his/that/it/this) using the conversation above, and keep it short (one sentence, no explanation, no quotes around it).'''
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.post(
                f"{OLLAMA_URL}/api/generate",
                json={"model": EMBED_MODEL_FALLBACK, "prompt": prompt, "stream": False},
            )
            res.raise_for_status()
            rewritten = res.json().get("response", "").strip().strip('"')
            return rewritten or query
    except Exception:
        return query


@router.post("/query")
async def query_collection(body: RagQuery):
    client = get_client()
    try:
        coll = client.get_collection(body.collection)
    except Exception:
        raise HTTPException(status_code=404, detail=f"Collection '{body.collection}' not found")

    search_query = await expand_query_with_history(body.query, body.history)
    query_emb = await embed_text(search_query)
    results = coll.query(query_embeddings=[query_emb], n_results=body.top_k)

    docs = results.get("documents", [[]])[0]
    metas = results.get("metadatas", [[]])[0]
    distances = results.get("distances", [[]])[0]

    raw = [
        {"text": d, "source": m.get("source", "unknown"), "chunk_index": m.get("chunk_index", 0), "distance": dist}
        for d, m, dist in zip(docs, metas, distances)
    ]

    relevant = [c for c in raw if c["distance"] <= body.threshold]
    relevant.sort(key=lambda c: c["distance"])

    by_source = {}
    for c in relevant:
        by_source.setdefault(c["source"], []).append(c)

    merged = []
    for source, chunks in by_source.items():
        chunks.sort(key=lambda c: c["chunk_index"])
        best_distance = min(c["distance"] for c in chunks)
        combined_text = "\n\n".join(c["text"] for c in chunks)
        merged.append({"source": source, "text": combined_text, "distance": best_distance})

    merged.sort(key=lambda c: c["distance"])

    return {"collection": body.collection, "query": body.query, "chunks": merged}
