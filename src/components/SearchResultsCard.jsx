import { useState, useEffect } from "react";

const favicon = (url) => {
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=32`;
  } catch {
    return "";
  }
};

const CONF_META = {
  high: { label: "High confidence", cls: "src-conf-high" },
  med: { label: "Moderate confidence", cls: "src-conf-med" },
  low: { label: "Low confidence", cls: "src-conf-low" },
};

const ChevronIcon = ({ open }) => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 14 14"
    fill="none"
    style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}
  >
    <path d="M3 5.5L7 9.5L11 5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function SourceRow({ c }) {
  const tier = c.trust?.tier || "normal";
  return (
    <a className="src-source" href={c.url} target="_blank" rel="noopener noreferrer" title={c.title}>
      <span className={`src-rail src-rail-${tier}`} />
      <img className="src-favicon" src={favicon(c.url)} loading="lazy" alt="" onError={(e) => (e.target.style.visibility = "hidden")} />
      <span className="src-source-text">
        <span className="src-source-title">
          [{c.index}] {c.title}
        </span>
        <span className="src-source-meta">
          {c.domain && <span className="src-source-domain">{c.domain}</span>}
          {c.trust?.label && (
            <>
              <span className="src-dot">·</span>
              <span className={`src-trust src-trust-${tier}`}>{c.trust.label}</span>
            </>
          )}
        </span>
      </span>
    </a>
  );
}

function SourcesPanel({ citations }) {
  return (
    <div className="src-source-list">
      {citations.map((c) => (
        <SourceRow key={c.index} c={c} />
      ))}
    </div>
  );
}

function NewsPanel({ news }) {
  return (
    <div className="msg-media-news">
      {news.map((n, i) => (
        <a key={i} className="msg-news-card" href={n.url} target="_blank" rel="noopener noreferrer" title={n.title}>
          {n.thumbnail && <img className="msg-news-thumb" src={n.thumbnail} alt="" loading="lazy" />}
          <div className="msg-news-text">
            <span className="msg-news-title">{n.title}</span>
            <span className="msg-news-meta">
              {n.domain}
              {n.fresh ? ` · ${n.fresh}` : ""}
            </span>
          </div>
        </a>
      ))}
    </div>
  );
}

function ImagesPanel({ images }) {
  return (
    <div className="msg-media-images msg-media-images-grid">
      {images.map((img, i) => (
        <a key={i} className="msg-image-card" href={img.url} target="_blank" rel="noopener noreferrer" title={img.title}>
          <img className="msg-image-thumb" src={img.thumbnail} alt="" loading="lazy" />
        </a>
      ))}
    </div>
  );
}

function VideosPanel({ videos }) {
  return (
    <div className="msg-media-videos msg-media-videos-grid">
      {videos.map((v, i) => (
        <a key={i} className="msg-video-card" href={v.url} target="_blank" rel="noopener noreferrer" title={v.title}>
          {v.thumbnail ? (
            <img className="msg-video-thumb" src={v.thumbnail} alt="" loading="lazy" />
          ) : (
            <div className="msg-video-thumb msg-video-thumb-empty">▶</div>
          )}
          <span className="msg-video-title">
            {v.title}
            {v.has_transcript && <span className="msg-transcript-badge">🎙️ transcript</span>}
          </span>
        </a>
      ))}
    </div>
  );
}

function ShoppingPanel({ shopping }) {
  return (
    <div className="msg-media-shopping msg-media-shopping-grid">
      {shopping.map((s, i) => (
        <a key={i} className="msg-shopping-card" href={s.url} target="_blank" rel="noopener noreferrer" title={s.title}>
          {s.thumbnail && <img className="msg-shopping-thumb" src={s.thumbnail} alt="" loading="lazy" />}
          <div className="msg-shopping-text">
            <span className="msg-shopping-title">{s.title}</span>
            {s.price && <span className="msg-shopping-price">{s.price}</span>}
          </div>
        </a>
      ))}
    </div>
  );
}

function ScholarPanel({ science }) {
  return (
    <div className="msg-media-science">
      {science.map((s, i) => (
        <a key={i} className="msg-science-card" href={s.url} target="_blank" rel="noopener noreferrer" title={s.title}>
          <div className="msg-science-text">
            <span className="msg-science-title">{s.title}</span>
            {s.snippet && <span className="msg-science-snippet">{s.snippet}</span>}
            <span className="msg-science-meta">{s.source}</span>
          </div>
        </a>
      ))}
    </div>
  );
}

function FilesPanel({ files }) {
  return (
    <div className="msg-media-files">
      {files.map((f, i) => (
        <a key={i} className="msg-files-card" href={f.url} target="_blank" rel="noopener noreferrer" title={f.title}>
          <span className="msg-files-icon">📄</span>
          <div className="msg-files-text">
            <span className="msg-files-title">{f.title}</span>
            {f.filesize && <span className="msg-files-meta">{f.filesize}</span>}
          </div>
        </a>
      ))}
    </div>
  );
}

function SocialPanel({ social }) {
  return (
    <div className="msg-media-social">
      {social.map((so, i) => (
        <a key={i} className="msg-social-card" href={so.url} target="_blank" rel="noopener noreferrer" title={so.title}>
          {so.thumbnail && <img className="msg-social-thumb" src={so.thumbnail} alt="" loading="lazy" />}
          <div className="msg-social-text">
            <span className="msg-social-title">{so.title}</span>
            {so.snippet && <span className="msg-social-snippet">{so.snippet}</span>}
            <span className="msg-social-meta">{so.source}</span>
          </div>
        </a>
      ))}
    </div>
  );
}

// "All" tab: a compact overview strip per category (a taste of each, not
// the full list) so switching to a dedicated tab still feels worthwhile.
function AllPanel({ citations, news, images, videos, shopping, science, files, social, onJump }) {
  const PREVIEW = 4;
  const row = (key, label, count, body) =>
    count > 0 && (
      <div className="src-section" key={key}>
        <button type="button" className="src-section-label src-section-label-btn" onClick={() => onJump(key)}>
          {label} <span className="src-count">{count}</span>
          <span className="src-section-more">See all ›</span>
        </button>
        {body}
      </div>
    );

  return (
    <>
      {row("sources", "Sources", citations.length, <SourcesPanel citations={citations.slice(0, PREVIEW)} />)}
      {row("news", "News", news.length, <NewsPanel news={news.slice(0, PREVIEW)} />)}
      {row("images", "Images", images.length, <ImagesPanel images={images.slice(0, 8)} />)}
      {row("videos", "Videos", videos.length, <VideosPanel videos={videos.slice(0, PREVIEW)} />)}
      {row("shopping", "Shopping", shopping.length, <ShoppingPanel shopping={shopping.slice(0, PREVIEW)} />)}
      {row("research", "Research", science.length, <ScholarPanel science={science.slice(0, PREVIEW)} />)}
      {row("documents", "PDFs / Documents", files.length, <FilesPanel files={files.slice(0, PREVIEW)} />)}
      {row("discussions", "Discussions", social.length, <SocialPanel social={social.slice(0, PREVIEW)} />)}
    </>
  );
}

export default function SearchResultsCard({ query, confidence, summary, citations = [], media = {} }) {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState("all");

  const news = media.news || [];
  const videos = media.videos || [];
  const images = media.images || [];
  const science = media.science || [];
  const files = media.files || [];
  const social = media.social || [];
  const shopping = media.shopping || [];

  const totalCount =
    citations.length + news.length + videos.length + images.length +
    science.length + files.length + social.length + shopping.length;

  const TABS = [
    { key: "all", label: "All" },
    { key: "sources", label: "Sources", count: citations.length },
    { key: "news", label: "News", count: news.length },
    { key: "images", label: "Images", count: images.length },
    { key: "videos", label: "Videos", count: videos.length },
    { key: "shopping", label: "Shopping", count: shopping.length },
    { key: "research", label: "Research", count: science.length },
    { key: "documents", label: "Documents", count: files.length },
    { key: "discussions", label: "Discussions", count: social.length },
  ].filter((t) => t.key === "all" || t.count > 0);

  // If the active tab's data disappears (new message re-render with a
  // different result set), fall back to "All" instead of showing empty.
  useEffect(() => {
    if (!TABS.some((t) => t.key === tab)) setTab("all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  if (totalCount === 0) return null;

  const conf = confidence ? CONF_META[confidence.tier] || CONF_META.low : null;

  return (
    <div className="src-card">
      <button type="button" className="src-head" onClick={() => setOpen((v) => !v)}>
        <span className="src-head-label">🌐 {query || "Web search"}</span>
        {conf && <span className={`src-conf-badge ${conf.cls}`}>{conf.label}</span>}
        <span className="src-head-spacer" />
        <ChevronIcon open={open} />
      </button>

      {summary && <div className="src-summary">{summary}</div>}

      {open && (
        <div className="src-body">
          <div className="src-tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                className={`src-tab ${tab === t.key ? "active" : ""}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
                {typeof t.count === "number" && <span className="src-tab-count">{t.count}</span>}
              </button>
            ))}
          </div>

          <div className="src-tab-panel">
            {tab === "all" && (
              <AllPanel
                citations={citations} news={news} images={images} videos={videos}
                shopping={shopping} science={science} files={files} social={social}
                onJump={setTab}
              />
            )}
            {tab === "sources" && <SourcesPanel citations={citations} />}
            {tab === "news" && <NewsPanel news={news} />}
            {tab === "images" && <ImagesPanel images={images} />}
            {tab === "videos" && <VideosPanel videos={videos} />}
            {tab === "shopping" && <ShoppingPanel shopping={shopping} />}
            {tab === "research" && <ScholarPanel science={science} />}
            {tab === "documents" && <FilesPanel files={files} />}
            {tab === "discussions" && <SocialPanel social={social} />}
          </div>
        </div>
      )}
    </div>
  );
}
