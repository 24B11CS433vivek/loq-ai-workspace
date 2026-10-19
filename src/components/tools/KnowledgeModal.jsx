import { useEffect, useState } from "react";
import {
  listCollections,
  createCollection,
  deleteCollection,
  listFiles,
  deleteFile,
  ingestDocument,
} from "../../lib/tools/rag";
import { extractDocument } from "../../lib/tools/documents";

export default function KnowledgeModal({ backendUrl, activeCollection, onSelectCollection, onClose }) {
  const [collections, setCollections] = useState([]);
  const [filesByCollection, setFilesByCollection] = useState({});
  const [expanded, setExpanded] = useState(null);
  const [newName, setNewName] = useState("");
  const [busyName, setBusyName] = useState(null);
  const [statusByCollection, setStatusByCollection] = useState({});

  const refreshCollections = () => listCollections(backendUrl).then(setCollections);

  const refreshFiles = async (name) => {
    const files = await listFiles(backendUrl, name);
    setFilesByCollection((prev) => ({ ...prev, [name]: files }));
  };

  useEffect(() => {
    refreshCollections();
  }, [backendUrl]);

  const setStatus = (name, msg) =>
    setStatusByCollection((prev) => ({ ...prev, [name]: msg }));

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      await createCollection(backendUrl, newName.trim());
      setNewName("");
      refreshCollections();
    } catch (e) {
      setStatus("__new__", e.message);
    }
  };

  const handleDeleteCollection = async (name) => {
    try {
      await deleteCollection(backendUrl, name);
      if (activeCollection === name) onSelectCollection("");
      refreshCollections();
    } catch (e) {
      setStatus(name, e.message);
    }
  };

  const toggleExpand = (name) => {
    const next = expanded === name ? null : name;
    setExpanded(next);
    if (next) refreshFiles(next);
  };

  const handleAddFile = async (e, name) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusyName(name);
    setStatus(name, `Reading ${file.name}…`);
    try {
      const { filename, text } = await extractDocument({ backendUrl, file });
      setStatus(name, `Adding ${filename} to knowledge base…`);
      const result = await ingestDocument(backendUrl, { collection: name, filename, text });
      setStatus(name, `✓ Added ${filename} (${result.chunks_added} chunks)`);
      refreshFiles(name);
      refreshCollections();
    } catch (e) {
      setStatus(name, `⚠️ ${e.message}`);
    } finally {
      setBusyName(null);
    }
  };

  const handleDeleteFile = async (name, filename) => {
    try {
      await deleteFile(backendUrl, name, filename);
      refreshFiles(name);
      refreshCollections();
    } catch (e) {
      setStatus(name, e.message);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal knowledge-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Knowledge Collections</h2>
        <p className="knowledge-hint">
          Each collection is a separate topic (e.g. "CSE Syllabus", "Attendance"). Select one below to
          make it active — when Knowledge mode is on, answers come <strong>only</strong> from the files in
          the active collection.
        </p>

        <div className="knowledge-collections">
          {collections.length === 0 && (
            <div className="knowledge-empty">No collections yet — create one below to get started.</div>
          )}

          {collections.map((c) => {
            const isActive = activeCollection === c.name;
            const isOpen = expanded === c.name;
            const files = filesByCollection[c.name] || [];
            const status = statusByCollection[c.name];

            return (
              <div className={`knowledge-card ${isActive ? "active" : ""}`} key={c.name}>
                <div className="knowledge-card-header">
                  <label className="knowledge-select">
                    <input
                      type="radio"
                      name="active-collection"
                      checked={isActive}
                      onChange={() => onSelectCollection(c.name)}
                    />
                    <span className="knowledge-card-name">{c.name}</span>
                    <span className="knowledge-card-count">{c.chunk_count} chunks</span>
                  </label>
                  <div className="knowledge-card-actions">
                    <button className="btn btn-ghost" onClick={() => toggleExpand(c.name)}>
                      {isOpen ? "Hide files" : "Manage files"}
                    </button>
                    <button className="btn btn-ghost personality-remove" onClick={() => handleDeleteCollection(c.name)}>✕</button>
                  </div>
                </div>

                {isOpen && (
                  <div className="knowledge-card-body">
                    {files.length === 0 && <div className="knowledge-empty">No files yet.</div>}
                    {files.map((f) => (
                      <div className="knowledge-file-row" key={f.filename}>
                        <span className="knowledge-file-name">{f.filename}</span>
                        <span className="knowledge-file-chunks">{f.chunk_count} chunks</span>
                        <button
                          className="btn btn-ghost personality-remove"
                          onClick={() => handleDeleteFile(c.name, f.filename)}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <label className="btn btn-ghost knowledge-add-file">
                      {busyName === c.name ? "Working…" : "+ Add file"}
                      <input
                        type="file"
                        accept=".pdf,.docx,.xlsx,.pptx"
                        style={{ display: "none" }}
                        disabled={busyName === c.name}
                        onChange={(e) => handleAddFile(e, c.name)}
                      />
                    </label>
                    {status && <div className="knowledge-status">{status}</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="knowledge-new">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New collection name (e.g. CSE Syllabus)"
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
          <button className="btn btn-primary" onClick={handleCreate}>+ Create collection</button>
        </div>
        {statusByCollection.__new__ && (
          <div className="knowledge-status">{statusByCollection.__new__}</div>
        )}

        <div className="modal-actions">
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
