import os
import re
import asyncio
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from urllib.parse import urlparse

import httpx
import trafilatura
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

try:
    from youtube_transcript_api import YouTubeTranscriptApi
    _HAS_YT_TRANSCRIPT = True
except Exception:
    _HAS_YT_TRANSCRIPT = False

router = APIRouter(prefix="/tools/search", tags=["search"])

# ── CONFIG ──────────────────────────────────────────────────────────────
# Local SearXNG ONLY. No public-mirror fallback: public mirrors are the
# thing that actually gets CAPTCHA'd/rate-limited -- the local instance is
# the one backend we fully control (auto-started/healed by
# searxng_manager.py), so it's the only place this router ever talks to.
SEARXNG_URL = os.environ.get("SEARXNG_URL", "http://localhost:8888")

MAX_RESULTS = 8
MAX_NEWS = 6
MAX_IMAGES = 10
MAX_VIDEOS = 6
MAX_FILES = 6
MAX_SCIENCE = 6
MAX_SHOPPING = 6
MAX_SOCIAL = 5

CATEGORY_TIMEOUT = 15        # per SearXNG category call (seconds)
RESEARCH_API_TIMEOUT = 8     # per arXiv/OpenAlex/Crossref call (seconds)

# Page-text extraction ("read the actual page", not just the snippet) --
# top few general results only, fully concurrent, hard time budget, always
# falls back to the SearXNG snippet on failure. Never adds more than
# ~TRANSCRIPT_TOTAL_BUDGET seconds and never throws.
TRANSCRIPT_TOP_N = 4
TRANSCRIPT_FETCH_TIMEOUT = 6
TRANSCRIPT_TOTAL_BUDGET = 9
MIN_TEXT_LENGTH = 200
MAX_TEXT_CHARS_PER_SOURCE = 3000

# YouTube transcript extraction -- top few video results only, same
# never-block/never-throw shape as the page-text step above.
VIDEO_TRANSCRIPT_TOP_N = 2
VIDEO_TRANSCRIPT_TOTAL_BUDGET = 8
MAX_TRANSCRIPT_CHARS = 4000

_HIGH_TRUST_HINTS = re.compile(
    r"\.(gov|edu)$|\b(reuters|apnews|bbc|nature\.com|who\.int|nih\.gov)\b", re.I
)
_LOW_QUALITY_HINTS = re.compile(
    r"(pinterest|quora|answers\.|baidu|content-farm|listicle)", re.I
)
_BOILERPLATE_MARKERS = (
    "technical storage or access", "we use cookies", "use technologies like cookies",
    "accept all cookies", "manage your privacy", "consent preferences",
    "subscribe to our newsletter", "enable javascript", "advertising, or to track the user",
)
_DOC_EXT_RE = re.compile(r"\.(pdf|docx?|pptx?|xlsx?|csv|epub)(?:[?#]|$)", re.I)
_YOUTUBE_RE = re.compile(r"(?:youtube\.com/watch\?v=|youtube\.com/shorts/|youtu\.be/)([A-Za-z0-9_-]{6,})")


class WebSearchQuery(BaseModel):
    query: str
    num_results: int = MAX_RESULTS


def _domain(url: str) -> str:
    try:
        netloc = urlparse(url).netloc.lower()
        return netloc[4:] if netloc.startswith("www.") else netloc
    except Exception:
        return url


def _dedupe_by_url(items: list) -> list:
    seen, out = set(), []
    for it in items:
        u = it.get("url")
        if not u or u in seen:
            continue
        seen.add(u)
        out.append(it)
    return out


def _trust_badge(url: str) -> dict:
    host = _domain(url)
    if _HIGH_TRUST_HINTS.search(host):
        return {"label": "verified", "tier": "high"}
    if _LOW_QUALITY_HINTS.search(host):
        return {"label": "low-quality", "tier": "low"}
    return {"label": None, "tier": "normal"}


def _freshness_label(date_value):
    if not date_value:
        return None
    try:
        dt = datetime.fromisoformat(str(date_value).replace("Z", "+00:00"))
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    except Exception:
        return None
    diff_hours = (datetime.utcnow() - dt).total_seconds() / 3600
    if diff_hours < 0:
        return None
    if diff_hours < 1:
        return "just now"
    if diff_hours < 24:
        return f"{round(diff_hours)}h ago"
    diff_days = diff_hours / 24
    if diff_days < 30:
        return f"{round(diff_days)}d ago"
    diff_months = diff_days / 30
    if diff_months < 12:
        return f"{round(diff_months)}mo ago"
    return f"{round(diff_months / 12)}y ago"


def _score_confidence(urls: list) -> dict:
    domains = {_domain(u) for u in urls if u}
    n = len(domains)
    if n >= 3:
        return {"label": "High confidence", "tier": "high", "domains": n}
    if n == 2:
        return {"label": "Moderate confidence", "tier": "med", "domains": n}
    return {"label": "Low confidence", "tier": "low", "domains": n}


def _extract_instant_answer(data: dict):
    answers = data.get("answers", [])
    if answers:
        first = answers[0]
        text = first.get("answer") if isinstance(first, dict) else first
        if text:
            return {"type": "answer", "text": str(text)}
    infoboxes = data.get("infoboxes", [])
    if infoboxes:
        box = infoboxes[0]
        content = box.get("content", "")
        if content:
            return {
                "type": "infobox",
                "title": box.get("infobox", ""),
                "text": content[:500],
                "url": (box.get("urls") or [{}])[0].get("url", ""),
            }
    return None


def _is_document_url(url: str) -> bool:
    return bool(_DOC_EXT_RE.search(url or ""))


def _youtube_id(url: str):
    m = _YOUTUBE_RE.search(url or "")
    return m.group(1) if m else None


# ── relevance filtering (research/shopping/social/files come from
#    broader keyword search than the main web results and drift off-topic
#    much more easily -- e.g. a Crossref/arXiv/mastodon hit that only
#    shares one word with the query). Require a majority of the query's
#    significant words to actually appear before trusting a candidate. ──
_STOPWORDS = {
    "a", "an", "the", "is", "are", "was", "were", "who", "what", "when",
    "where", "why", "how", "of", "in", "on", "at", "for", "to", "and",
    "or", "do", "does", "did", "that", "this", "these", "those", "it",
    "its", "be", "with", "as", "by", "from",
}
CANDIDATE_MULTIPLIER = 3


def _keywords(query: str) -> list:
    toks = re.findall(r"[a-zA-Z0-9]+", query.lower())
    return [t for t in toks if t not in _STOPWORDS and len(t) > 1]


def _is_relevant(keywords: list, *texts: str) -> bool:
    if not keywords:
        return True
    hay = " ".join(t for t in texts if t).lower()
    hits = sum(1 for k in keywords if k in hay)
    need = max(1, (len(keywords) + 1) // 2)  # majority, at least 1
    return hits >= need


def _filter_relevant(items: list, keywords: list) -> list:
    return [
        it for it in items
        if _is_relevant(keywords, it.get("title", ""), it.get("snippet") or it.get("text") or "")
    ]


# ── SearXNG (single local instance, one category per call) ───────────────
async def _searxng_json(client: httpx.AsyncClient, query: str, category: str = None):
    params = {"q": query, "format": "json"}
    if category:
        params["categories"] = category
    res = await client.get(f"{SEARXNG_URL}/search", params=params, timeout=CATEGORY_TIMEOUT)
    res.raise_for_status()
    return res.json()


async def _fetch_general(client: httpx.AsyncClient, query: str):
    try:
        data = await _searxng_json(client, query)
        return data, data.get("results", [])
    except Exception as e:
        print(f"[search] general fetch failed: {e}")
        return None, []


async def _fetch_category(client: httpx.AsyncClient, query: str, category: str, limit: int):
    """Never raises -- an unsupported/misconfigured category (e.g. no
    'shopping' engines set up on this SearXNG instance) just comes back
    empty instead of breaking the rest of the search."""
    try:
        data = await _searxng_json(client, query, category)
        return data.get("results", [])[:limit]
    except Exception as e:
        print(f"[search] '{category}' fetch failed: {e}")
        return []


# ── free research sources (no API key, used alongside SearXNG's own
#    'science' category so paper coverage doesn't depend on which
#    scholarly engines happen to be enabled locally) ───────────────────────
async def _fetch_arxiv(client: httpx.AsyncClient, query: str, limit: int = 4):
    try:
        res = await client.get(
            "http://export.arxiv.org/api/query",
            params={"search_query": f"all:{query}", "start": 0, "max_results": limit},
            timeout=RESEARCH_API_TIMEOUT,
        )
        res.raise_for_status()
        ns = {"a": "http://www.w3.org/2005/Atom"}
        root = ET.fromstring(res.text)
        items = []
        for entry in root.findall("a:entry", ns):
            url = entry.findtext("a:id", default="", namespaces=ns)
            if not url:
                continue
            title = " ".join((entry.findtext("a:title", default="", namespaces=ns) or "").split())
            summary = " ".join((entry.findtext("a:summary", default="", namespaces=ns) or "").split())
            items.append({"url": url, "title": title, "snippet": summary[:280], "source": "arXiv"})
        return items
    except Exception as e:
        print(f"[search] arXiv fetch failed: {e}")
        return []


async def _fetch_openalex(client: httpx.AsyncClient, query: str, limit: int = 4):
    try:
        res = await client.get(
            "https://api.openalex.org/works",
            params={"search": query, "per-page": limit},
            timeout=RESEARCH_API_TIMEOUT,
        )
        res.raise_for_status()
        items = []
        for w in res.json().get("results", []):
            url = (w.get("primary_location") or {}).get("landing_page_url") or w.get("id", "")
            if not url:
                continue
            venue = (w.get("primary_location") or {}).get("source") or {}
            snippet = f"{w.get('publication_year', '')} · {venue.get('display_name', '')}".strip(" ·")
            items.append({"url": url, "title": w.get("display_name", ""), "snippet": snippet, "source": "OpenAlex"})
        return items
    except Exception as e:
        print(f"[search] OpenAlex fetch failed: {e}")
        return []


async def _fetch_crossref(client: httpx.AsyncClient, query: str, limit: int = 4):
    try:
        res = await client.get(
            "https://api.crossref.org/works",
            params={"query": query, "rows": limit},
            timeout=RESEARCH_API_TIMEOUT,
        )
        res.raise_for_status()
        items = []
        for w in res.json().get("message", {}).get("items", []):
            url = w.get("URL", "")
            title = " ".join(w.get("title") or [])
            if not url or not title:
                continue
            items.append({
                "url": url, "title": title,
                "snippet": (w.get("container-title") or [""])[0],
                "source": "Crossref",
            })
        return items
    except Exception as e:
        print(f"[search] Crossref fetch failed: {e}")
        return []


# ── page-text and video-transcript extraction ─────────────────────────────
def _looks_like_boilerplate(text: str) -> bool:
    lowered = text.lower()
    return sum(1 for m in _BOILERPLATE_MARKERS if m in lowered) >= 2


async def _fetch_transcript(client: httpx.AsyncClient, url: str) -> str:
    try:
        res = await client.get(url, timeout=TRANSCRIPT_FETCH_TIMEOUT, follow_redirects=True)
        res.raise_for_status()
        text = trafilatura.extract(res.text, include_comments=False, include_tables=False, favor_precision=True)
        if not text or len(text) < MIN_TEXT_LENGTH or _looks_like_boilerplate(text):
            return ""
        return text[:MAX_TEXT_CHARS_PER_SOURCE]
    except Exception as e:
        print(f"[search] page-text fetch failed for {url}: {e}")
        return ""


async def _fetch_video_transcript(video_url: str):
    if not _HAS_YT_TRANSCRIPT:
        return None
    vid = _youtube_id(video_url)
    if not vid:
        return None

    def _get():
        try:
            # youtube-transcript-api >= 1.0 (instance API)
            fetched = YouTubeTranscriptApi().fetch(vid)
            return " ".join(seg.text for seg in fetched)
        except AttributeError:
            # youtube-transcript-api < 1.0 (classmethod API)
            segs = YouTubeTranscriptApi.get_transcript(vid)
            return " ".join(seg["text"] for seg in segs)

    try:
        text = await asyncio.to_thread(_get)
        text = re.sub(r"\s+", " ", text or "").strip()
        return text[:MAX_TRANSCRIPT_CHARS] if text else None
    except Exception as e:
        print(f"[search] video transcript failed for {video_url}: {e}")
        return None


@router.post("/web")
async def search_web(body: WebSearchQuery):
    query = body.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="query cannot be empty")

    async with httpx.AsyncClient(headers={"User-Agent": "Mozilla/5.0"}) as client:
        # Single wave: every result type fetched in parallel, every call
        # swallows its own errors and returns [] -- one slow/broken
        # category (e.g. no 'shopping' engines configured) never blocks
        # or breaks the rest of the search.
        (
            (general_data, general_raw),
            news_raw, images_raw, videos_raw, files_raw,
            science_raw, shopping_raw, social_raw,
            arxiv_raw, openalex_raw, crossref_raw,
        ) = await asyncio.gather(
            _fetch_general(client, query),
            _fetch_category(client, query, "news", MAX_NEWS),
            _fetch_category(client, query, "images", MAX_IMAGES),
            _fetch_category(client, query, "videos", MAX_VIDEOS),
            _fetch_category(client, query, "files", MAX_FILES * CANDIDATE_MULTIPLIER),
            _fetch_category(client, query, "science", MAX_SCIENCE * CANDIDATE_MULTIPLIER),
            _fetch_category(client, query, "shopping", MAX_SHOPPING * CANDIDATE_MULTIPLIER),
            _fetch_category(client, query, "social media", MAX_SOCIAL * CANDIDATE_MULTIPLIER),
            _fetch_arxiv(client, query),
            _fetch_openalex(client, query),
            _fetch_crossref(client, query),
        )

        if general_data is None and not any(
            [news_raw, images_raw, videos_raw, files_raw, science_raw, shopping_raw, social_raw]
        ):
            raise HTTPException(
                status_code=502,
                detail=f"Web search backend (SearXNG) unavailable at {SEARXNG_URL}",
            )

        instant_answer = _extract_instant_answer(general_data or {})
        keywords = _keywords(query)

        results = _dedupe_by_url([
            {
                "url": r.get("url", ""),
                "title": r.get("title", ""),
                "text": r.get("content", ""),
                "domain": _domain(r.get("url", "")),
                "trust": _trust_badge(r.get("url", "")),
            }
            for r in general_raw if r.get("url")
        ])[: body.num_results]

        # Real page text for the top few general results only (concurrent,
        # hard time budget) -- everything else keeps the SearXNG snippet.
        top = results[:TRANSCRIPT_TOP_N]
        try:
            page_texts = await asyncio.wait_for(
                asyncio.gather(*[_fetch_transcript(client, r["url"]) for r in top], return_exceptions=True),
                timeout=TRANSCRIPT_TOTAL_BUDGET,
            )
        except asyncio.TimeoutError:
            page_texts = ["" for _ in top]
        for r, t in zip(top, page_texts):
            if isinstance(t, str) and t:
                r["text"] = t
                r["extracted"] = True

        videos = _dedupe_by_url([
            {"url": r.get("url", ""), "title": r.get("title", ""),
             "thumbnail": r.get("thumbnail") or r.get("img_src") or ""}
            for r in videos_raw if r.get("url")
        ])

        # Real transcript text for the top couple of YouTube videos.
        vtop = videos[:VIDEO_TRANSCRIPT_TOP_N]
        try:
            vtexts = await asyncio.wait_for(
                asyncio.gather(*[_fetch_video_transcript(v["url"]) for v in vtop], return_exceptions=True),
                timeout=VIDEO_TRANSCRIPT_TOTAL_BUDGET,
            )
        except asyncio.TimeoutError:
            vtexts = [None for _ in vtop]
        video_transcripts = []
        for v, t in zip(vtop, vtexts):
            if isinstance(t, str) and t:
                v["has_transcript"] = True
                video_transcripts.append({"url": v["url"], "title": v["title"], "text": t})

        images = _dedupe_by_url([
            {"url": r.get("url") or r.get("img_src", ""), "title": r.get("title", ""),
             "img_src": r.get("img_src") or r.get("thumbnail_src", ""),
             "thumbnail": r.get("thumbnail_src") or r.get("img_src", "")}
            for r in images_raw if r.get("img_src") or r.get("thumbnail_src")
        ])

        news = _dedupe_by_url([
            {"url": r.get("url", ""), "title": r.get("title", ""),
             "domain": _domain(r.get("url", "")), "trust": _trust_badge(r.get("url", "")),
             "thumbnail": r.get("img_src") or r.get("thumbnail") or "",
             "fresh": _freshness_label(r.get("publishedDate"))}
            for r in news_raw if r.get("url")
        ])

        shopping = _dedupe_by_url(_filter_relevant([
            {"url": r.get("url", ""), "title": r.get("title", ""),
             "snippet": r.get("content", ""), "price": r.get("price", ""),
             "thumbnail": r.get("thumbnail") or r.get("img_src", ""),
             "source": r.get("engine", "")}
            for r in shopping_raw if r.get("url")
        ], keywords))[:MAX_SHOPPING]

        social = _dedupe_by_url(_filter_relevant([
            {"url": r.get("url", ""), "title": r.get("title", ""),
             "snippet": (r.get("content") or "")[:200], "thumbnail": r.get("thumbnail") or "",
             "source": r.get("engine", "")}
            for r in social_raw if r.get("url")
        ], keywords))[:MAX_SOCIAL]

        # "PDFs / Documents" = SearXNG's files category + any doc-shaped
        # URL that happened to surface in general results.
        doc_candidates = list(files_raw) + [r for r in general_raw if _is_document_url(r.get("url", ""))]
        files = _dedupe_by_url(_filter_relevant([
            {"url": r.get("url", ""), "title": r.get("title", ""),
             "snippet": r.get("content", ""),
             "filesize": r.get("filesize", ""), "source": r.get("engine", "")}
            for r in doc_candidates if r.get("url")
        ], keywords))[:MAX_FILES]

        # "Research / academic papers" = SearXNG's science category +
        # arXiv/OpenAlex/Crossref, deduped together, filtered for
        # relevance (Crossref/arXiv full-text search drifts off-topic
        # easily on short queries -- e.g. "CEO" alone pulling in unrelated
        # compensation-research papers).
        science = _dedupe_by_url(_filter_relevant(
            [
                {"url": r.get("url", ""), "title": r.get("title", ""),
                 "snippet": (r.get("content") or "")[:280], "source": r.get("engine", "")}
                for r in science_raw if r.get("url")
            ] + arxiv_raw + openalex_raw + crossref_raw,
            keywords,
        ))[:10]

    confidence = _score_confidence([r["url"] for r in results] + [n["url"] for n in news])
    parts = []
    if results: parts.append(f"{len(results)} website" + ("s" if len(results) != 1 else ""))
    if news: parts.append(f"{len(news)} news article" + ("s" if len(news) != 1 else ""))
    if images: parts.append(f"{len(images)} image" + ("s" if len(images) != 1 else ""))
    if videos: parts.append(f"{len(videos)} video" + ("s" if len(videos) != 1 else ""))
    if science: parts.append(f"{len(science)} paper" + ("s" if len(science) != 1 else ""))
    if files: parts.append(f"{len(files)} document" + ("s" if len(files) != 1 else ""))
    if shopping: parts.append(f"{len(shopping)} shopping result" + ("s" if len(shopping) != 1 else ""))
    summary = (
        f"Found {', '.join(parts)} across {confidence['domains']} domain(s) — {confidence['label'].lower()}."
        if parts else "No usable results came back for this query."
    )

    return {
        "query": query,
        "retrieved_at": datetime.utcnow().isoformat() + "Z",
        "instant_answer": instant_answer,
        "results": results,
        "videos": videos,
        "video_transcripts": video_transcripts,
        "images": images,
        "news": news,
        "science": science,
        "files": files,
        "shopping": shopping,
        "social": social,
        "confidence": confidence,
        "summary": summary,
    }
