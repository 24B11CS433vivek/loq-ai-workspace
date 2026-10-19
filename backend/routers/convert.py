"""
Conversion Mode — Phase 20. "iLovePDF/CloudConvert at home": one endpoint
that takes one or more uploaded files plus a plain-English prompt
("convert to png", "compress this", "merge these pdfs", "docx to pdf")
and returns one or more converted files, served the same way every
other generated file already is (GENERATED_DIR + the /files static
mount in main.py).

Engines used, all CPU-only / no GPU:
  - Pillow (+ optional pillow-heif, cairosvg)  -> images
  - pypdf                                       -> pdf merge/split/rotate/compress, text extraction
  - pandoc (subprocess, system binary)          -> md <-> docx <-> txt
  - soffice/libreoffice --headless (subprocess) -> docx -> pdf
  - pdftoppm (poppler, subprocess)              -> pdf -> images
  - pandas / openpyxl                           -> csv <-> xlsx <-> json
  - ffmpeg (subprocess)                         -> audio conversions, video -> audio
  - zipfile (stdlib)                            -> archive extract / create

Every "engine missing" case (pandoc/soffice/pdftoppm/ffmpeg not
installed) raises a clear HTTPException telling the user what to
install, instead of a bare 500.
"""
import io
import json as jsonlib
import logging
import re
import shutil
import subprocess
import uuid
import zipfile
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

router = APIRouter(prefix="/tools/convert", tags=["convert"])
logger = logging.getLogger("routers.convert")

GENERATED_DIR = Path(__file__).resolve().parent.parent / "generated"
GENERATED_DIR.mkdir(exist_ok=True)

IMAGE_EXTS = {"jpg", "jpeg", "png", "webp", "bmp", "tiff", "tif", "gif", "heic", "heif"}
SVG_EXTS = {"svg"}
DOC_TEXT_EXTS = {"md", "txt", "html"}
PDF_EXT = "pdf"
DOCX_EXT = "docx"
DATA_EXTS = {"csv", "xlsx", "json"}
AUDIO_EXTS = {"mp3", "wav", "m4a", "ogg"}
VIDEO_EXTS = {"mp4", "mov", "mkv", "avi", "webm"}
ARCHIVE_EXTS = {"zip"}

ALL_KNOWN_EXTS = (
    IMAGE_EXTS | SVG_EXTS | DOC_TEXT_EXTS | {PDF_EXT, DOCX_EXT} | DATA_EXTS | AUDIO_EXTS | VIDEO_EXTS | ARCHIVE_EXTS
)

OP_KEYWORDS = {
    "merge": ["merge", "combine", "join"],
    "split": ["split"],
    "rotate": ["rotate"],
    "compress": ["compress", "shrink", "reduce size"],
    "resize": ["resize", "scale"],
    "extract": ["extract", "unzip", "unpack"],
}

# Natural-language target descriptions that people type instead of a
# real file extension (e.g. "convert this pdf to images"). Without this,
# a word like "images" matches nothing, and detection used to fall through
# to the bare-mention scan below -- which would then latch onto the word
# "pdf" elsewhere in the same sentence (naming the file's OWN current
# type) and return that as if it were the requested target.
TARGET_SYNONYMS = {
    "image": "png", "images": "png", "picture": "png", "pictures": "png",
    "photo": "png", "photos": "png",
    "word": "docx", "document": "docx",
    "text": "txt", "spreadsheet": "xlsx", "excel": "xlsx",
}


def _ext_of(filename: str) -> str:
    return (filename or "").rsplit(".", 1)[-1].lower() if "." in (filename or "") else ""


def _detect_op(prompt: str) -> str | None:
    p = prompt.lower()
    for op, words in OP_KEYWORDS.items():
        if any(w in p for w in words):
            return op
    return None


def _detect_target_ext(prompt: str, src_ext: str | None = None) -> str | None:
    """Best-effort: look for '.ext' or 'to ext' / 'as ext' / 'into ext' in the prompt."""
    p = prompt.lower()
    m = re.search(r"\.([a-z0-9]{2,5})\b", p)
    if m and m.group(1) in ALL_KNOWN_EXTS:
        return m.group(1)
    for kw in ("to ", "as ", "into "):
        for m in re.finditer(re.escape(kw) + r"([a-z0-9]{2,5})\b", p):
            token = m.group(1)
            if token in ALL_KNOWN_EXTS:
                return token
    for word, ext in TARGET_SYNONYMS.items():
        if ext != src_ext and re.search(rf"\b{re.escape(word)}\b", p):
            return ext
    # bare mentions like "convert jpg" or "make this an mp3" -- but never
    # the file's OWN current extension: casually naming the source file's
    # type (e.g. "convert this pdf...") is not a requested target, and
    # returning it here used to produce a nonsensical "from .pdf to .pdf"
    # conversion request.
    for ext in sorted(ALL_KNOWN_EXTS, key=len, reverse=True):
        if ext != src_ext and re.search(rf"\b{re.escape(ext)}\b", p):
            return ext

    return None
    return None


def _new_name(stem: str, ext: str) -> str:
    return f"{stem}-{uuid.uuid4().hex[:8]}.{ext}"


def _save_bytes(data: bytes, stem: str, ext: str) -> dict:
    filename = _new_name(stem, ext)
    (GENERATED_DIR / filename).write_bytes(data)
    return {"filename": filename, "url": f"/files/{filename}"}


def _run_subprocess(cmd: list[str], missing_tool_msg: str, timeout: int = 120) -> None:
    exe = cmd[0]
    if shutil.which(exe) is None:
        raise HTTPException(status_code=501, detail=missing_tool_msg)
    try:
        result = subprocess.run(cmd, capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail=f"{exe} timed out after {timeout}s")
    if result.returncode != 0:
        err = (result.stderr or result.stdout or b"").decode(errors="ignore")[-800:]
        if "does not contain any stream" in err or "Output file does not contain any stream" in err:
            raise HTTPException(
                status_code=422,
                detail="This file doesn't have the stream your target format needs "
                       "(e.g. extracting audio from a video with no audio track).",
            )
        raise HTTPException(status_code=422, detail=f"{exe} failed: {err or 'unknown error'}")


# ---------------------------------------------------------------- images --

def _open_image(data: bytes, ext: str):
    from PIL import Image
    if ext in ("heic", "heif"):
        try:
            import pillow_heif
            pillow_heif.register_heif_opener()
        except ImportError:
            raise HTTPException(
                status_code=501,
                detail="HEIC support needs `pip install pillow-heif --break-system-packages` on the backend.",
            )
    return Image.open(io.BytesIO(data))


def _convert_image(data: bytes, src_ext: str, target_ext: str, stem: str) -> dict:
    img = _open_image(data, src_ext)
    buf = io.BytesIO()
    save_fmt = {"jpg": "JPEG", "tif": "TIFF"}.get(target_ext, target_ext.upper())
    if save_fmt == "JPEG" and img.mode in ("RGBA", "P", "LA"):
        img = img.convert("RGB")
    img.save(buf, format=save_fmt)
    return _save_bytes(buf.getvalue(), stem, target_ext)


def _resize_or_compress_image(data: bytes, src_ext: str, prompt: str, stem: str) -> dict:
    from PIL import Image
    img = _open_image(data, src_ext)
    p = prompt.lower()

    m = re.search(r"(\d+)\s*[x×]\s*(\d+)", p)
    if m:
        img = img.resize((int(m.group(1)), int(m.group(2))))
    else:
        m = re.search(r"(\d+)\s*%", p)
        pct = int(m.group(1)) / 100 if m else (0.5 if "compress" in p or "shrink" in p else 1.0)
        if pct != 1.0:
            img = img.resize((max(1, int(img.width * pct)), max(1, int(img.height * pct))))

    m = re.search(r"quality\s*(\d+)", p)
    quality = int(m.group(1)) if m else 70

    buf = io.BytesIO()
    out_ext = src_ext if src_ext not in ("png", "bmp", "tiff", "tif") else "jpg"
    save_fmt = "JPEG" if out_ext == "jpg" else out_ext.upper()
    if save_fmt == "JPEG" and img.mode in ("RGBA", "P", "LA"):
        img = img.convert("RGB")
    img.save(buf, format=save_fmt, quality=quality, optimize=True)
    return _save_bytes(buf.getvalue(), stem, out_ext)


def _images_to_pdf(files: list[tuple[str, bytes]], stem: str) -> dict:
    from PIL import Image
    pages = []
    for filename, data in files:
        img = _open_image(data, _ext_of(filename))
        if img.mode != "RGB":
            img = img.convert("RGB")
        pages.append(img)
    buf = io.BytesIO()
    pages[0].save(buf, format="PDF", save_all=True, append_images=pages[1:])
    return _save_bytes(buf.getvalue(), stem, "pdf")


def _svg_to_raster(data: bytes, target_ext: str, stem: str) -> dict:
    try:
        import cairosvg
    except ImportError:
        raise HTTPException(
            status_code=501,
            detail="SVG rasterization needs `pip install cairosvg --break-system-packages` on the backend.",
        )
    buf = io.BytesIO()
    if target_ext == "png":
        cairosvg.svg2png(bytestring=data, write_to=buf)
    else:
        png_buf = io.BytesIO()
        cairosvg.svg2png(bytestring=data, write_to=png_buf)
        from PIL import Image
        img = Image.open(png_buf).convert("RGB")
        img.save(buf, format="JPEG")
    return _save_bytes(buf.getvalue(), stem, target_ext)


# ------------------------------------------------------------------ pdf --

def _pdf_merge(files: list[tuple[str, bytes]], stem: str) -> dict:
    from pypdf import PdfWriter
    writer = PdfWriter()
    for _, data in files:
        writer.append(io.BytesIO(data))
    buf = io.BytesIO()
    writer.write(buf)
    return _save_bytes(buf.getvalue(), stem, "pdf")


def _pdf_split(data: bytes, prompt: str, stem: str) -> list[dict]:
    from pypdf import PdfReader, PdfWriter
    reader = PdfReader(io.BytesIO(data))
    n = len(reader.pages)
    m = re.search(r"(\d+)\s*-\s*(\d+)", prompt)
    ranges = [(int(m.group(1)) - 1, int(m.group(2)))] if m else [(i, i + 1) for i in range(n)]
    out = []
    for start, end in ranges:
        writer = PdfWriter()
        for i in range(max(0, start), min(n, end)):
            writer.add_page(reader.pages[i])
        buf = io.BytesIO()
        writer.write(buf)
        out.append(_save_bytes(buf.getvalue(), f"{stem}-p{start + 1}-{end}", "pdf"))
    return out


def _pdf_rotate(data: bytes, prompt: str, stem: str) -> dict:
    from pypdf import PdfReader, PdfWriter
    m = re.search(r"(\d+)\s*(?:deg|degrees)?", prompt.lower().split("rotate", 1)[-1])
    angle = int(m.group(1)) if m else 90
    reader = PdfReader(io.BytesIO(data))
    writer = PdfWriter()
    for page in reader.pages:
        page.rotate(angle)
        writer.add_page(page)
    buf = io.BytesIO()
    writer.write(buf)
    return _save_bytes(buf.getvalue(), stem, "pdf")


def _pdf_compress(data: bytes, stem: str) -> dict:
    from pypdf import PdfReader, PdfWriter
    reader = PdfReader(io.BytesIO(data))
    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    for page in writer.pages:
        page.compress_content_streams()
    buf = io.BytesIO()
    writer.write(buf)
    return _save_bytes(buf.getvalue(), stem, "pdf")


def _pdf_to_images(data: bytes, stem: str) -> list[dict]:
    if shutil.which("pdftoppm") is None:
        raise HTTPException(
            status_code=501,
            detail="PDF -> image needs poppler-utils installed on the backend host (`apt install poppler-utils`).",
        )
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        src = Path(td) / "in.pdf"
        src.write_bytes(data)
        out_prefix = Path(td) / "page"
        _run_subprocess(["pdftoppm", "-png", str(src), str(out_prefix)], "poppler-utils not found")
        pages = sorted(Path(td).glob("page-*.png"))
        return [_save_bytes(p.read_bytes(), f"{stem}-{p.stem}", "png") for p in pages]


def _pdf_to_text_family(data: bytes, target_ext: str, stem: str) -> dict:
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data))
    text = "\n\n".join((p.extract_text() or "") for p in reader.pages)
    if target_ext == "docx":
        from docx import Document
        doc = Document()
        for para in text.split("\n"):
            doc.add_paragraph(para)
        buf = io.BytesIO()
        doc.save(buf)
        return _save_bytes(buf.getvalue(), stem, "docx")
    return _save_bytes(text.encode("utf-8"), stem, target_ext)  # md/txt


def _docx_to_pdf(data: bytes, stem: str) -> dict:
    exe = "soffice" if shutil.which("soffice") else "libreoffice"
    if shutil.which(exe) is None:
        raise HTTPException(
            status_code=501,
            detail="DOCX -> PDF needs LibreOffice installed on the backend host (`apt install libreoffice`).",
        )
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        src = Path(td) / "in.docx"
        src.write_bytes(data)
        _run_subprocess(
            [exe, "--headless", "--convert-to", "pdf", "--outdir", td, str(src)],
            "LibreOffice not found", timeout=120,
        )
        out = Path(td) / "in.pdf"
        if not out.exists():
            raise HTTPException(status_code=422, detail="LibreOffice did not produce a PDF")
        return _save_bytes(out.read_bytes(), stem, "pdf")


def _pandoc_convert(data: bytes, src_ext: str, target_ext: str, stem: str) -> dict:
    if shutil.which("pandoc") is None:
        raise HTTPException(
            status_code=501,
            detail=f"{src_ext} -> {target_ext} needs pandoc installed on the backend host (`apt install pandoc`).",
        )
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        src = Path(td) / f"in.{src_ext}"
        out = Path(td) / f"out.{target_ext}"
        src.write_bytes(data)
        _run_subprocess(["pandoc", str(src), "-o", str(out)], "pandoc not found", timeout=90)
        if not out.exists():
            raise HTTPException(status_code=422, detail="pandoc did not produce output")
        return _save_bytes(out.read_bytes(), stem, target_ext)


def _text_to_pdf(data: bytes, stem: str) -> dict:
    """.md / .txt -> .pdf via ReportLab, no LaTeX/wkhtmltopdf dependency."""
    from reportlab.lib.pagesizes import LETTER
    from reportlab.pdfgen import canvas
    text = data.decode("utf-8", errors="ignore")
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=LETTER)
    width, height = LETTER
    y = height - 50
    for line in text.split("\n"):
        for chunk in [line[i:i + 100] for i in range(0, len(line), 100)] or [""]:
            if y < 50:
                c.showPage()
                y = height - 50
            c.drawString(50, y, chunk)
            y -= 14
    c.save()
    return _save_bytes(buf.getvalue(), stem, "pdf")


# ----------------------------------------------------------------- data --

def _convert_data(data: bytes, src_ext: str, target_ext: str, stem: str) -> dict:
    import pandas as pd
    buf_in = io.BytesIO(data)
    if src_ext == "csv":
        df = pd.read_csv(buf_in)
    elif src_ext == "xlsx":
        df = pd.read_excel(buf_in)
    elif src_ext == "json":
        df = pd.read_json(buf_in)
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported data source: {src_ext}")

    out = io.BytesIO()
    if target_ext == "csv":
        df.to_csv(out, index=False)
    elif target_ext == "xlsx":
        df.to_excel(out, index=False)
    elif target_ext == "json":
        out.write(df.to_json(orient="records", indent=2).encode("utf-8"))
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported data target: {target_ext}")
    return _save_bytes(out.getvalue(), stem, target_ext)


# ---------------------------------------------------------------- audio --

def _ffmpeg_convert(data: bytes, src_ext: str, target_ext: str, stem: str, audio_only: bool = False) -> dict:
    if shutil.which("ffmpeg") is None:
        raise HTTPException(
            status_code=501,
            detail="Audio/video conversion needs ffmpeg installed on the backend host (`apt install ffmpeg`).",
        )
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        src = Path(td) / f"in.{src_ext}"
        out = Path(td) / f"out.{target_ext}"
        src.write_bytes(data)
        cmd = ["ffmpeg", "-y", "-i", str(src)]
        if audio_only:
            cmd += ["-vn"]
        cmd += [str(out)]
        _run_subprocess(cmd, "ffmpeg not found", timeout=180)
        if not out.exists():
            raise HTTPException(status_code=422, detail="ffmpeg did not produce output")
        return _save_bytes(out.read_bytes(), stem, target_ext)


# -------------------------------------------------------------- archive --

def _zip_extract(data: bytes, stem: str) -> list[dict]:
    out = []
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        for name in zf.namelist():
            if name.endswith("/"):
                continue
            content = zf.read(name)
            safe_stem = Path(name).stem or "file"
            ext = Path(name).suffix.lstrip(".") or "bin"
            out.append(_save_bytes(content, f"{stem}-{safe_stem}", ext))
    return out


def _zip_create(files: list[tuple[str, bytes]], stem: str) -> dict:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for filename, data in files:
            zf.writestr(filename, data)
    return _save_bytes(buf.getvalue(), stem, "zip")


# ------------------------------------------------------------------- API --

@router.post("")
async def convert_files(
    prompt: str = Form(""),
    files: list[UploadFile] = File(...),
):
    if not files:
        raise HTTPException(status_code=400, detail="Attach at least one file to convert.")

    loaded: list[tuple[str, bytes]] = []
    for f in files:
        loaded.append((f.filename or "upload", await f.read()))

    src_exts = {_ext_of(name) for name, _ in loaded}
    op = _detect_op(prompt)
    # Best-effort single-extension hint for _detect_target_ext, so it can
    # avoid ever returning the source file's own extension as the
    # "detected" target (see TARGET_SYNONYMS comment above). Left as None
    # for mixed-type uploads, where there's no single source type to guard
    # against anyway.
    _src_ext_hint = next(iter(src_exts)) if len(src_exts) == 1 else None
    target_ext = _detect_target_ext(prompt, _src_ext_hint)

    # Zipping is explicitly meant to bundle mixed file types together, so it's
    # exempt from the single-type-per-request rule below.
    if target_ext != "zip" and len(src_exts) > 1 and not (src_exts <= IMAGE_EXTS or src_exts <= {PDF_EXT}):
        raise HTTPException(
            status_code=400,
            detail=f"Mixed file types uploaded ({', '.join(sorted(src_exts))}) -- convert one type at a time.",
        )
    src_ext = next(iter(src_exts))
    if target_ext != "zip" and src_ext not in ALL_KNOWN_EXTS:
        raise HTTPException(status_code=400, detail=f"Unsupported source file type: .{src_ext or '?'}")

    # Sanity check: if the prompt names a source format that doesn't match
    # what was actually uploaded, say so instead of guessing.
    mentioned_exts = [e for e in ALL_KNOWN_EXTS if re.search(rf"\b{re.escape(e)}\b", prompt.lower())]
    if len(mentioned_exts) >= 2 and src_ext not in mentioned_exts and op is None:
        raise HTTPException(
            status_code=400,
            detail=(
                f"You uploaded a .{src_ext} file but the prompt mentions {', '.join('.' + e for e in mentioned_exts)}. "
                f"Please upload a matching file or rephrase (e.g. \"convert to {mentioned_exts[-1]}\")."
            ),
        )

    stem = Path(loaded[0][0]).stem[:40] or "file"
    results: list[dict] = []

    try:
        # ---- archives -------------------------------------------------
        if src_ext == "zip" and (op == "extract" or target_ext is None):
            results = _zip_extract(loaded[0][1], stem)
        elif target_ext == "zip":
            results = [_zip_create(loaded, stem)]

        # ---- multi-file pdf merge / multi-image -> single pdf ---------
        elif len(loaded) > 1 and src_ext == PDF_EXT and (op == "merge" or target_ext in (None, PDF_EXT)):
            results = [_pdf_merge(loaded, stem)]
        elif len(loaded) > 1 and src_ext in IMAGE_EXTS and target_ext == PDF_EXT:
            results = [_images_to_pdf(loaded, stem)]

        # ---- pdf single-file ops ---------------------------------------
        elif src_ext == PDF_EXT and op == "split":
            results = _pdf_split(loaded[0][1], prompt, stem)
        elif src_ext == PDF_EXT and op == "rotate":
            results = [_pdf_rotate(loaded[0][1], prompt, stem)]
        elif src_ext == PDF_EXT and op == "compress":
            results = [_pdf_compress(loaded[0][1], stem)]
        elif src_ext == PDF_EXT and target_ext == "png":
            results = _pdf_to_images(loaded[0][1], stem)
        elif src_ext == PDF_EXT and target_ext in ("docx", "md", "txt"):
            results = [_pdf_to_text_family(loaded[0][1], target_ext, stem)]

        # ---- docx / markdown / text family -----------------------------
        elif src_ext == DOCX_EXT and target_ext == PDF_EXT:
            results = [_docx_to_pdf(loaded[0][1], stem)]
        elif src_ext == DOCX_EXT and target_ext in ("md", "txt"):
            results = [_pandoc_convert(loaded[0][1], DOCX_EXT, target_ext, stem)]
        elif src_ext in DOC_TEXT_EXTS and target_ext == DOCX_EXT:
            results = [_pandoc_convert(loaded[0][1], src_ext, DOCX_EXT, stem)]
        elif src_ext in ("md", "txt") and target_ext == PDF_EXT:
            results = [_text_to_pdf(loaded[0][1], stem)]
        # md <-> txt <-> html -- pandoc handles any pair here directly;
        # this was simply never wired up, so e.g. "convert this .md to
        # .txt" fell all the way through to the generic "couldn't work
        # out a conversion" error even though the engine already supports it.
        elif src_ext in DOC_TEXT_EXTS and target_ext in DOC_TEXT_EXTS and target_ext != src_ext:
            results = [_pandoc_convert(loaded[0][1], src_ext, target_ext, stem)]

        # ---- images (incl. svg) -----------------------------------------
        elif src_ext in SVG_EXTS and target_ext in ("png", "jpg", "jpeg"):
            results = [_svg_to_raster(loaded[0][1], "jpg" if target_ext == "jpeg" else target_ext, stem)]
        elif src_ext in IMAGE_EXTS and target_ext == PDF_EXT:
            results = [_images_to_pdf(loaded, stem)]
        elif src_ext in IMAGE_EXTS and op in ("compress", "resize"):
            results = [_resize_or_compress_image(loaded[0][1], src_ext, prompt, stem)]
        elif src_ext in IMAGE_EXTS and target_ext in IMAGE_EXTS:
            results = [_convert_image(f[1], src_ext, "jpg" if target_ext == "jpeg" else target_ext, Path(f[0]).stem[:40] or "file") for f in loaded]

        # ---- data ---------------------------------------------------------
        elif src_ext in DATA_EXTS and target_ext in DATA_EXTS:
            results = [_convert_data(loaded[0][1], src_ext, target_ext, stem)]

        # ---- audio / video --------------------------------------------
        elif src_ext in VIDEO_EXTS and target_ext in AUDIO_EXTS:
            results = [_ffmpeg_convert(loaded[0][1], src_ext, target_ext, stem, audio_only=True)]
        elif src_ext in AUDIO_EXTS and target_ext in AUDIO_EXTS:
            results = [_ffmpeg_convert(loaded[0][1], src_ext, target_ext, stem)]

        else:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Couldn't work out a conversion from .{src_ext} "
                    f"{'to .' + target_ext if target_ext else '(no target format found in your prompt)'}. "
                    "Try phrasing like \"convert to png\" or \"compress this\"."
                ),
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Conversion failed for %s", [n for n, _ in loaded])
        raise HTTPException(status_code=422, detail=f"Conversion failed: {e}")

    for r in results:
        r["source_format"] = src_ext
        r["target_format"] = _ext_of(r["filename"])

    return {"results": results}
