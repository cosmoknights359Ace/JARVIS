#!/usr/bin/env python3
"""
SPDX-License-Identifier: MIT
Copyright (c) 2026 cosmoknight — J.A.R.V.I.S Xconvert Local File Conversion Engine

Disk-to-disk local file converter with zero browser/base64 memory limits.
Supports Images, Documents, Data, Media, and Archives using installed optional
Python engines with graceful degradation and clear install hints.
"""

from __future__ import annotations

import csv
import html as html_lib
import importlib.util
import io
import json
import os
import re
import shutil
import subprocess
import tarfile
import tempfile
import time
import xml.etree.ElementTree as ET
import zipfile
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

IS_WINDOWS = os.name == "nt"
CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0) if IS_WINDOWS else 0

OPTIONAL_PACKAGES: Sequence[Tuple[str, str]] = (
    ("PIL", "Pillow"),
    ("img2pdf", "img2pdf"),
    ("fitz", "PyMuPDF"),
    ("docx", "python-docx"),
    ("pdf2docx", "pdf2docx"),
    ("pandas", "pandas"),
    ("openpyxl", "openpyxl"),
    ("yaml", "PyYAML"),
    ("imageio_ffmpeg", "imageio-ffmpeg"),
    ("py7zr", "py7zr"),
    ("markdown", "markdown"),
)

IMAGE_INPUT_EXTS = ("png", "jpg", "jpeg", "webp", "bmp", "tiff", "gif", "ico")
IMAGE_TARGET_EXTS = ("png", "jpg", "jpeg", "webp", "bmp", "tiff", "gif", "ico", "pdf")

DOCUMENT_EXTS = ("pdf", "docx", "txt", "md", "html")

DATA_EXTS = ("csv", "xlsx", "json", "yaml", "yml", "xml")

VIDEO_EXTS = ("mp4", "mkv", "mov", "avi", "webm")
AUDIO_EXTS = ("mp3", "wav", "flac", "ogg", "m4a")
MEDIA_VIDEO_TARGETS = ("mp4", "mkv", "mov", "avi", "webm", "mp3", "wav", "flac", "ogg", "m4a", "gif")
MEDIA_AUDIO_TARGETS = ("mp3", "wav", "flac", "ogg", "m4a")

ARCHIVE_EXTS = ("zip", "tar", "tar.gz", "7z")

ALL_SUPPORTED_TARGETS = set(
    IMAGE_TARGET_EXTS
    + DOCUMENT_EXTS
    + DATA_EXTS
    + MEDIA_VIDEO_TARGETS
    + ARCHIVE_EXTS
)


def _has_module(module_name: str) -> bool:
    try:
        return importlib.util.find_spec(module_name) is not None
    except (ImportError, ValueError):
        return False


def get_capabilities() -> Dict[str, Any]:
    """
    Checks which optional conversion packages are installed and returns:
    `{ "engines": Record<string, bool>, "install_hint": str }`.
    """
    engines: Dict[str, bool] = {}
    missing_pip: List[str] = []

    for mod_name, pip_name in OPTIONAL_PACKAGES:
        available = _has_module(mod_name)
        engines[mod_name] = available
        if not available:
            missing_pip.append(pip_name)

    install_hint = f"pip install {' '.join(missing_pip)}" if missing_pip else ""
    return {
        "engines": engines,
        "install_hint": install_hint,
    }


def _extract_ext(file_path: Path) -> str:
    lower_name = file_path.name.lower()
    if lower_name.endswith(".tar.gz"):
        return "tar.gz"
    if lower_name.endswith(".tgz"):
        return "tar.gz"
    suffix = file_path.suffix.lower().lstrip(".")
    if suffix == "tif":
        return "tiff"
    if suffix == "htm":
        return "html"
    if suffix == "markdown":
        return "md"
    return suffix


def _strip_known_ext(file_path: Path) -> str:
    lower_name = file_path.name.lower()
    if lower_name.endswith(".tar.gz"):
        return file_path.name[:-7]
    if lower_name.endswith(".tgz"):
        return file_path.name[:-4]
    return file_path.stem


def _classify_ext(ext: str) -> Tuple[str, List[str]]:
    clean = (ext or "").strip().lower().lstrip(".")
    if clean in IMAGE_INPUT_EXTS:
        targets = [t for t in IMAGE_TARGET_EXTS if t != clean]
        return "image", targets
    if clean in DOCUMENT_EXTS:
        targets = [t for t in DOCUMENT_EXTS if t != clean]
        return "document", targets
    if clean in DATA_EXTS:
        targets = [t for t in DATA_EXTS if t != clean]
        return "data", targets
    if clean in VIDEO_EXTS:
        targets = [t for t in MEDIA_VIDEO_TARGETS if t != clean]
        return "media", targets
    if clean in AUDIO_EXTS:
        targets = [t for t in MEDIA_AUDIO_TARGETS if t != clean]
        return "media", targets
    if clean in ARCHIVE_EXTS:
        targets = [t for t in ARCHIVE_EXTS if t != clean]
        return "archive", targets
    return "unsupported", []


def inspect_file(path: str) -> Dict[str, Any]:
    """
    Inspects a local file on disk and returns:
    `{ path, name, ext, size_bytes, category, compatible_targets }`.
    """
    p = Path(str(path or "")).expanduser()
    resolved = str(p.resolve()) if p.exists() else str(p)
    ext = _extract_ext(p)
    category, compatible_targets = _classify_ext(ext)
    size_bytes = 0
    try:
        if p.is_file():
            size_bytes = p.stat().st_size
    except OSError:
        size_bytes = 0

    return {
        "path": resolved,
        "name": p.name,
        "ext": ext,
        "size_bytes": size_bytes,
        "category": category,
        "compatible_targets": compatible_targets,
    }


def _resolve_safe_output_path(input_path: Path, target_format: str, output_dir: Optional[str]) -> Path:
    fmt = target_format.strip().lower().lstrip(".")
    dest_dir = Path(output_dir).expanduser() if output_dir and str(output_dir).strip() else input_path.parent
    dest_dir.mkdir(parents=True, exist_ok=True)

    stem = _strip_known_ext(input_path) or "converted_file"
    candidate = dest_dir / f"{stem}.{fmt}"
    if not candidate.exists():
        return candidate

    converted_candidate = dest_dir / f"{stem}_converted.{fmt}"
    if not converted_candidate.exists():
        return converted_candidate

    counter = 2
    while True:
        numbered = dest_dir / f"{stem}_converted_{counter}.{fmt}"
        if not numbered.exists():
            return numbered
        counter += 1


# ==============================================================================
# 1. Image Conversion (Pillow + img2pdf)
# ==============================================================================


def _flatten_to_rgb(img: Any) -> Any:
    from PIL import Image  # type: ignore

    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        background = Image.new("RGB", rgba.size, (255, 255, 255))
        background.paste(rgba, mask=rgba.split()[3])
        return background
    if img.mode != "RGB":
        return img.convert("RGB")
    return img


def _convert_image(input_path: Path, output_path: Path, target_fmt: str) -> None:
    try:
        from PIL import Image  # type: ignore
    except ImportError as exc:
        raise RuntimeError("Pillow is required for image conversion. Run: pip install Pillow") from exc

    with Image.open(input_path) as img:
        if target_fmt == "pdf":
            rgb = _flatten_to_rgb(img)
            if _has_module("img2pdf"):
                import img2pdf  # type: ignore

                buf = io.BytesIO()
                rgb.save(buf, format="PNG")
                output_path.write_bytes(img2pdf.convert(buf.getvalue()))
            else:
                rgb.save(output_path, format="PDF", resolution=150.0)
            return

        if target_fmt in ("jpg", "jpeg"):
            rgb = _flatten_to_rgb(img)
            rgb.save(output_path, format="JPEG", quality=92, optimize=True)
            return

        if target_fmt == "ico":
            rgba = img.convert("RGBA")
            max_side = max(rgba.width, rgba.height)
            standard_sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
            chosen_sizes = [sz for sz in standard_sizes if sz[0] <= max_side] or [(32, 32)]
            if (256, 256) not in chosen_sizes and max_side >= 256:
                chosen_sizes.append((256, 256))
            rgba.save(output_path, format="ICO", sizes=chosen_sizes)
            return

        if target_fmt == "bmp":
            rgb = _flatten_to_rgb(img)
            rgb.save(output_path, format="BMP")
            return

        format_map = {
            "png": "PNG",
            "webp": "WEBP",
            "tiff": "TIFF",
            "gif": "GIF",
        }
        pil_fmt = format_map.get(target_fmt)
        if not pil_fmt:
            raise ValueError(f"Unsupported image target format: {target_fmt}")

        if target_fmt == "webp":
            img.save(output_path, format="WEBP", quality=90)
        elif target_fmt == "gif":
            img.convert("P", palette=Image.ADAPTIVE).save(output_path, format="GIF")
        else:
            img.save(output_path, format=pil_fmt)


# ==============================================================================
# 2. Document Conversion (PyMuPDF / fitz, pdf2docx, python-docx, markdown)
# ==============================================================================


class _HtmlToTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._chunks: List[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]) -> None:
        t = tag.lower()
        if t in ("script", "style"):
            self._skip_depth += 1
        elif t in ("p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6"):
            self._chunks.append("\n")

    def handle_endtag(self, tag: str) -> None:
        t = tag.lower()
        if t in ("script", "style") and self._skip_depth > 0:
            self._skip_depth -= 1
        elif t in ("p", "div", "h1", "h2", "h3", "h4", "h5", "h6"):
            self._chunks.append("\n")

    def handle_data(self, data: str) -> None:
        if self._skip_depth == 0:
            self._chunks.append(data)

    def get_text(self) -> str:
        raw = "".join(self._chunks)
        lines = [line.strip() for line in raw.splitlines()]
        cleaned = re.sub(r"\n{3,}", "\n\n", "\n".join(lines))
        return cleaned.strip()


def _html_to_plain_text(html_content: str) -> str:
    parser = _HtmlToTextParser()
    parser.feed(html_content)
    parser.close()
    return parser.get_text()


def _markdown_to_html(md_text: str, title: str) -> str:
    if _has_module("markdown"):
        import markdown as md_lib  # type: ignore

        body = md_lib.markdown(md_text, extensions=["tables", "fenced_code"])
    else:
        # Clean stdlib fallback for headings, bullets, and paragraphs
        html_lines: List[str] = []
        for raw_line in md_text.splitlines():
            stripped = raw_line.strip()
            if not stripped:
                continue
            heading_match = re.match(r"^(#{1,6})\s+(.*)$", stripped)
            if heading_match:
                lvl = len(heading_match.group(1))
                html_lines.append(f"<h{lvl}>{html_lib.escape(heading_match.group(2))}</h{lvl}>")
            elif stripped.startswith(("- ", "* ")):
                html_lines.append(f"<p>&bull; {html_lib.escape(stripped[2:])}</p>")
            else:
                html_lines.append(f"<p>{html_lib.escape(stripped)}</p>")
        body = "\n".join(html_lines)

    safe_title = html_lib.escape(title)
    return (
        "<!DOCTYPE html>\n"
        "<html lang=\"en\">\n"
        "<head>\n"
        "  <meta charset=\"UTF-8\" />\n"
        f"  <title>{safe_title}</title>\n"
        "  <style>body{font-family:system-ui,sans-serif;max-width:800px;margin:2rem auto;padding:0 1rem;line-height:1.6;color:#18181b;}</style>\n"
        "</head>\n"
        "<body>\n"
        f"{body}\n"
        "</body>\n"
        "</html>\n"
    )


def _strip_markdown(md_text: str) -> str:
    text = re.sub(r"```[a-zA-Z0-9_-]*\n?", "", md_text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"!\[([^\]]*)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"^#{1,6}\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)
    text = re.sub(r"\*([^*]+)\*", r"\1", text)
    return text.strip()


def _write_text_to_docx(text: str, output_path: Path, is_markdown: bool = False) -> None:
    try:
        from docx import Document  # type: ignore
    except ImportError as exc:
        raise RuntimeError("python-docx is required for DOCX export. Run: pip install python-docx") from exc

    doc = Document()
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if is_markdown:
            heading_match = re.match(r"^(#{1,4})\s+(.*)$", stripped)
            if heading_match:
                doc.add_heading(heading_match.group(2), level=min(len(heading_match.group(1)), 4))
                continue
            if stripped.startswith(("- ", "* ")):
                doc.add_paragraph(stripped[2:], style="List Bullet")
                continue
        doc.add_paragraph(stripped)
    doc.save(str(output_path))


def _write_text_or_html_to_pdf(content: str, output_path: Path, is_html: bool = False) -> None:
    try:
        import fitz  # type: ignore
    except ImportError as exc:
        raise RuntimeError("PyMuPDF (fitz) is required for PDF export. Run: pip install PyMuPDF") from exc

    html_payload = (
        content
        if is_html
        else (
            "<html><body style='font-family:Helvetica,Arial,sans-serif;font-size:11pt;line-height:1.5;'>"
            + "".join(f"<p>{html_lib.escape(line)}</p>" for line in content.splitlines() if line.strip())
            + "</body></html>"
        )
    )

    # Use PyMuPDF Story API when available for clean multi-page pagination
    if hasattr(fitz, "Story") and hasattr(fitz, "DocumentWriter"):
        story = fitz.Story(html=html_payload)
        mediabox = fitz.paper_rect("letter")
        where = mediabox + (54, 54, -54, -54)
        writer = fitz.DocumentWriter(str(output_path))
        try:
            more = True
            while more:
                device = writer.begin_page(mediabox)
                more, _ = story.place(where)
                story.draw(device)
                writer.end_page()
        finally:
            writer.close()
        return

    # Fallback simple PyMuPDF page writer
    doc = fitz.open()
    try:
        plain = _html_to_plain_text(content) if is_html else content
        lines = plain.splitlines() or [""]
        chunk_size = 48
        for idx in range(0, len(lines), chunk_size):
            page = doc.new_page()
            block = "\n".join(lines[idx : idx + chunk_size])
            page.insert_textbox(fitz.Rect(54, 54, 558, 738), block, fontsize=11)
        doc.save(str(output_path))
    finally:
        doc.close()


def _convert_document(input_path: Path, output_path: Path, src_ext: str, target_fmt: str) -> None:
    if src_ext == "pdf":
        if target_fmt == "docx":
            if _has_module("pdf2docx"):
                from pdf2docx import Converter  # type: ignore

                cv = Converter(str(input_path))
                try:
                    cv.convert(str(output_path))
                finally:
                    cv.close()
                return
            # Fallback via PyMuPDF text extraction -> python-docx
            if not _has_module("fitz"):
                raise RuntimeError("pdf2docx or PyMuPDF is required for PDF to DOCX. Run: pip install pdf2docx PyMuPDF python-docx")
            import fitz  # type: ignore

            with fitz.open(str(input_path)) as doc:
                text = "\n\n".join(page.get_text("text") for page in doc)
            _write_text_to_docx(text, output_path)
            return

        try:
            import fitz  # type: ignore
        except ImportError as exc:
            raise RuntimeError("PyMuPDF (fitz) is required for PDF conversion. Run: pip install PyMuPDF") from exc

        with fitz.open(str(input_path)) as doc:
            if target_fmt == "html":
                pages_html = "\n<hr/>\n".join(page.get_text("html") for page in doc)
                output_path.write_text(pages_html, encoding="utf-8")
            else:
                pages_txt = "\n\n".join(page.get_text("text").strip() for page in doc)
                output_path.write_text(pages_txt.strip() + "\n", encoding="utf-8")
        return

    if src_ext == "docx":
        try:
            from docx import Document  # type: ignore
        except ImportError as exc:
            raise RuntimeError("python-docx is required for DOCX conversion. Run: pip install python-docx") from exc

        doc = Document(str(input_path))
        paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
        for table in doc.tables:
            for row in table.rows:
                cells = [c.text.strip().replace("\n", " ") for c in row.cells]
                if any(cells):
                    paragraphs.append(" | ".join(cells))
        joined = "\n\n".join(paragraphs)

        if target_fmt in ("txt", "md"):
            output_path.write_text(joined + "\n", encoding="utf-8")
        elif target_fmt == "html":
            output_path.write_text(_markdown_to_html(joined, input_path.stem), encoding="utf-8")
        elif target_fmt == "pdf":
            _write_text_or_html_to_pdf(joined, output_path, is_html=False)
        return

    raw_text = input_path.read_text(encoding="utf-8", errors="replace")

    if src_ext == "md":
        if target_fmt == "html":
            output_path.write_text(_markdown_to_html(raw_text, input_path.stem), encoding="utf-8")
        elif target_fmt == "txt":
            output_path.write_text(_strip_markdown(raw_text) + "\n", encoding="utf-8")
        elif target_fmt == "docx":
            _write_text_to_docx(raw_text, output_path, is_markdown=True)
        elif target_fmt == "pdf":
            _write_text_or_html_to_pdf(_markdown_to_html(raw_text, input_path.stem), output_path, is_html=True)
        return

    if src_ext == "html":
        plain = _html_to_plain_text(raw_text)
        if target_fmt in ("txt", "md"):
            output_path.write_text(plain + "\n", encoding="utf-8")
        elif target_fmt == "docx":
            _write_text_to_docx(plain, output_path)
        elif target_fmt == "pdf":
            _write_text_or_html_to_pdf(raw_text, output_path, is_html=True)
        return

    if src_ext == "txt":
        if target_fmt == "md":
            output_path.write_text(raw_text, encoding="utf-8")
        elif target_fmt == "html":
            output_path.write_text(_markdown_to_html(raw_text, input_path.stem), encoding="utf-8")
        elif target_fmt == "docx":
            _write_text_to_docx(raw_text, output_path)
        elif target_fmt == "pdf":
            _write_text_or_html_to_pdf(raw_text, output_path, is_html=False)
        return

    raise ValueError(f"Unsupported document conversion: {src_ext} -> {target_fmt}")


# ==============================================================================
# 3. Data Conversion (pandas, openpyxl, PyYAML + stdlib CSV/JSON/XML)
# ==============================================================================


def _sanitize_xml_tag(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.-]", "_", str(name or "field"))
    if not cleaned or not re.match(r"^[A-Za-z_]", cleaned):
        cleaned = f"f_{cleaned}"
    return cleaned


def _records_to_xml(records: List[Dict[str, Any]]) -> str:
    root = ET.Element("rows")
    for record in records:
        row_el = ET.SubElement(root, "row")
        for key, val in record.items():
            child = ET.SubElement(row_el, _sanitize_xml_tag(key))
            child.text = "" if val is None else str(val)
    if hasattr(ET, "indent"):
        ET.indent(root, space="  ")
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="unicode") + "\n"


def _xml_to_records(xml_text: str) -> List[Dict[str, Any]]:
    root = ET.fromstring(xml_text)
    records: List[Dict[str, Any]] = []
    for child in list(root):
        subchildren = list(child)
        if subchildren:
            row: Dict[str, Any] = {}
            for field in subchildren:
                row[field.tag] = (field.text or "").strip()
            records.append(row)
        else:
            records.append({child.tag: (child.text or "").strip()})
    return records


def _load_data_records(input_path: Path, src_ext: str) -> Any:
    if src_ext == "csv":
        if _has_module("pandas"):
            import pandas as pd  # type: ignore

            return pd.read_csv(input_path).to_dict(orient="records")
        with input_path.open("r", encoding="utf-8-sig", newline="") as fh:
            return list(csv.DictReader(fh))

    if src_ext == "xlsx":
        if _has_module("pandas") and _has_module("openpyxl"):
            import pandas as pd  # type: ignore

            return pd.read_excel(input_path, engine="openpyxl").to_dict(orient="records")
        if _has_module("openpyxl"):
            import openpyxl  # type: ignore

            wb = openpyxl.load_workbook(input_path, read_only=True, data_only=True)
            try:
                ws = wb.active
                rows = list(ws.iter_rows(values_only=True))
            finally:
                wb.close()
            if not rows:
                return []
            headers = [str(h or f"col_{i}") for i, h in enumerate(rows[0])]
            return [dict(zip(headers, r)) for r in rows[1:]]
        raise RuntimeError("openpyxl is required to read XLSX files. Run: pip install openpyxl pandas")

    if src_ext == "json":
        return json.loads(input_path.read_text(encoding="utf-8"))

    if src_ext in ("yaml", "yml"):
        try:
            import yaml  # type: ignore
        except ImportError as exc:
            raise RuntimeError("PyYAML is required for YAML conversion. Run: pip install PyYAML") from exc
        return yaml.safe_load(input_path.read_text(encoding="utf-8"))

    if src_ext == "xml":
        return _xml_to_records(input_path.read_text(encoding="utf-8"))

    raise ValueError(f"Unsupported data input format: {src_ext}")


def _normalize_to_record_list(data: Any) -> List[Dict[str, Any]]:
    if isinstance(data, list):
        records: List[Dict[str, Any]] = []
        for item in data:
            if isinstance(item, dict):
                records.append(item)
            else:
                records.append({"value": item})
        return records
    if isinstance(data, dict):
        return [data]
    return [{"value": data}]


def _convert_data(input_path: Path, output_path: Path, src_ext: str, target_fmt: str) -> None:
    data = _load_data_records(input_path, src_ext)

    if target_fmt == "json":
        output_path.write_text(json.dumps(data, indent=2, ensure_ascii=False, default=str) + "\n", encoding="utf-8")
        return

    if target_fmt in ("yaml", "yml"):
        try:
            import yaml  # type: ignore
        except ImportError as exc:
            raise RuntimeError("PyYAML is required for YAML export. Run: pip install PyYAML") from exc
        output_path.write_text(yaml.safe_dump(data, sort_keys=False, allow_unicode=True), encoding="utf-8")
        return

    records = _normalize_to_record_list(data)

    if target_fmt == "xml":
        output_path.write_text(_records_to_xml(records), encoding="utf-8")
        return

    if target_fmt == "csv":
        if _has_module("pandas"):
            import pandas as pd  # type: ignore

            pd.DataFrame(records).to_csv(output_path, index=False)
            return
        fieldnames: List[str] = []
        for rec in records:
            for k in rec.keys():
                if k not in fieldnames:
                    fieldnames.append(str(k))
        with output_path.open("w", encoding="utf-8", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=fieldnames or ["value"])
            writer.writeheader()
            for rec in records:
                writer.writerow({k: rec.get(k, "") for k in (fieldnames or ["value"])})
        return

    if target_fmt == "xlsx":
        if _has_module("pandas") and _has_module("openpyxl"):
            import pandas as pd  # type: ignore

            pd.DataFrame(records).to_excel(output_path, index=False, engine="openpyxl")
            return
        if _has_module("openpyxl"):
            import openpyxl  # type: ignore

            wb = openpyxl.Workbook()
            ws = wb.active
            headers: List[str] = []
            for rec in records:
                for k in rec.keys():
                    if k not in headers:
                        headers.append(str(k))
            if headers:
                ws.append(headers)
                for rec in records:
                    ws.append([rec.get(h, "") for h in headers])
            wb.save(str(output_path))
            return
        raise RuntimeError("openpyxl is required to write XLSX files. Run: pip install openpyxl pandas")

    raise ValueError(f"Unsupported data target format: {target_fmt}")


# ==============================================================================
# 4. Media Conversion (imageio_ffmpeg or system ffmpeg)
# ==============================================================================


def _resolve_ffmpeg_exe() -> Optional[str]:
    if _has_module("imageio_ffmpeg"):
        try:
            import imageio_ffmpeg  # type: ignore

            exe = imageio_ffmpeg.get_ffmpeg_exe()
            if exe and Path(exe).is_file():
                return exe
        except Exception:
            pass
    return shutil.which("ffmpeg")


def _convert_media(input_path: Path, output_path: Path, target_fmt: str) -> None:
    ffmpeg_exe = _resolve_ffmpeg_exe()
    if not ffmpeg_exe:
        raise RuntimeError("FFmpeg is required for media conversion. Run: pip install imageio-ffmpeg")

    cmd: List[str] = [ffmpeg_exe, "-y", "-i", str(input_path)]

    if target_fmt == "gif":
        cmd.extend(["-vf", "fps=12,scale=640:-1:flags=lanczos", "-loop", "0"])
    elif target_fmt in AUDIO_EXTS:
        cmd.append("-vn")
        if target_fmt == "mp3":
            cmd.extend(["-c:a", "libmp3lame", "-q:a", "2"])
        elif target_fmt == "wav":
            cmd.extend(["-c:a", "pcm_s16le"])
        elif target_fmt == "flac":
            cmd.extend(["-c:a", "flac"])
        elif target_fmt == "ogg":
            cmd.extend(["-c:a", "libvorbis", "-q:a", "4"])
        elif target_fmt == "m4a":
            cmd.extend(["-c:a", "aac", "-b:a", "192k"])
    elif target_fmt == "webm":
        cmd.extend(["-c:v", "libvpx", "-b:v", "1M", "-c:a", "libvorbis"])
    elif target_fmt == "avi":
        cmd.extend(["-c:v", "mpeg4", "-q:v", "4", "-c:a", "libmp3lame"])
    else:
        # mp4, mkv, mov
        cmd.extend(["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac"])

    cmd.append(str(output_path))

    run_kwargs: Dict[str, Any] = {
        "stdout": subprocess.PIPE,
        "stderr": subprocess.PIPE,
        "text": True,
        "check": False,
    }
    if IS_WINDOWS and CREATE_NO_WINDOW:
        run_kwargs["creationflags"] = CREATE_NO_WINDOW

    proc = subprocess.run(cmd, **run_kwargs)
    if proc.returncode != 0:
        err_tail = (proc.stderr or "").strip().splitlines()
        msg = err_tail[-1] if err_tail else f"FFmpeg exited with code {proc.returncode}"
        raise RuntimeError(f"FFmpeg conversion failed: {msg}")


# ==============================================================================
# 5. Archive Conversion (zipfile, tarfile, py7zr) with Zip-Slip Protection
# ==============================================================================


def _assert_within_stage(stage_root: Path, member_name: str) -> Path:
    if not member_name or member_name.startswith(("/", "\\")):
        raise ValueError(f"Unsafe archive entry path: {member_name}")
    target = (stage_root / member_name).resolve()
    root_resolved = stage_root.resolve()
    if target != root_resolved and root_resolved not in target.parents:
        raise ValueError(f"Archive path traversal blocked: {member_name}")
    return target


def _safe_extract_archive(input_path: Path, src_ext: str, stage_root: Path) -> None:
    if src_ext == "zip":
        with zipfile.ZipFile(input_path, "r") as zf:
            for info in zf.infolist():
                target = _assert_within_stage(stage_root, info.filename)
                if info.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with zf.open(info, "r") as src_fh, target.open("wb") as dst_fh:
                        shutil.copyfileobj(src_fh, dst_fh)
        return

    if src_ext in ("tar", "tar.gz"):
        with tarfile.open(input_path, "r:*") as tf:
            for member in tf.getmembers():
                if member.issym() or member.islnk():
                    continue
                target = _assert_within_stage(stage_root, member.name)
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                elif member.isfile():
                    target.parent.mkdir(parents=True, exist_ok=True)
                    extracted = tf.extractfile(member)
                    if extracted is not None:
                        with extracted, target.open("wb") as dst_fh:
                            shutil.copyfileobj(extracted, dst_fh)
        return

    if src_ext == "7z":
        try:
            import py7zr  # type: ignore
        except ImportError as exc:
            raise RuntimeError("py7zr is required for 7z archives. Run: pip install py7zr") from exc
        with py7zr.SevenZipFile(input_path, mode="r") as archive:
            for name in archive.getnames():
                _assert_within_stage(stage_root, name)
            archive.extractall(path=stage_root)
        return

    raise ValueError(f"Unsupported archive input format: {src_ext}")


def _pack_archive(stage_root: Path, output_path: Path, target_fmt: str) -> None:
    if target_fmt == "zip":
        with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for root_dir, _, files in os.walk(stage_root):
                for fname in files:
                    full = Path(root_dir) / fname
                    arcname = full.relative_to(stage_root).as_posix()
                    zf.write(full, arcname=arcname)
        return

    if target_fmt in ("tar", "tar.gz"):
        mode = "w:gz" if target_fmt == "tar.gz" else "w"
        with tarfile.open(output_path, mode) as tf:
            for item in stage_root.iterdir():
                tf.add(item, arcname=item.name)
        return

    if target_fmt == "7z":
        try:
            import py7zr  # type: ignore
        except ImportError as exc:
            raise RuntimeError("py7zr is required for 7z export. Run: pip install py7zr") from exc
        with py7zr.SevenZipFile(output_path, mode="w") as archive:
            for item in stage_root.iterdir():
                archive.writeall(item, arcname=item.name)
        return

    raise ValueError(f"Unsupported archive target format: {target_fmt}")


def _convert_archive(input_path: Path, output_path: Path, src_ext: str, target_fmt: str) -> None:
    with tempfile.TemporaryDirectory(prefix="xconvert_stage_") as tmp_dir:
        stage_root = Path(tmp_dir)
        _safe_extract_archive(input_path, src_ext, stage_root)
        _pack_archive(stage_root, output_path, target_fmt)


# ==============================================================================
# Batch Orchestrator
# ==============================================================================


def convert_single(input_path_str: str, target_format: str, output_dir: Optional[str] = None) -> Dict[str, Any]:
    started = time.perf_counter()
    input_path = Path(str(input_path_str or "")).expanduser()
    fmt = str(target_format or "").strip().lower().lstrip(".")

    def _elapsed_ms() -> int:
        return max(1, int((time.perf_counter() - started) * 1000))

    if not input_path.is_file():
        return {
            "input_path": str(input_path),
            "output_path": "",
            "ok": False,
            "error": f"Source file not found: {input_path.name or input_path}",
            "duration_ms": _elapsed_ms(),
        }

    src_ext = _extract_ext(input_path)
    category, compatible = _classify_ext(src_ext)

    if category == "unsupported":
        return {
            "input_path": str(input_path),
            "output_path": "",
            "ok": False,
            "error": f"Unsupported source format: .{src_ext or 'unknown'}",
            "duration_ms": _elapsed_ms(),
        }

    if fmt not in ALL_SUPPORTED_TARGETS or fmt not in compatible:
        return {
            "input_path": str(input_path),
            "output_path": "",
            "ok": False,
            "error": f"Cannot convert .{src_ext} to .{fmt}",
            "duration_ms": _elapsed_ms(),
        }

    output_path: Optional[Path] = None
    try:
        output_path = _resolve_safe_output_path(input_path, fmt, output_dir)
        if category == "image":
            _convert_image(input_path, output_path, fmt)
        elif category == "document":
            _convert_document(input_path, output_path, src_ext, fmt)
        elif category == "data":
            _convert_data(input_path, output_path, src_ext, fmt)
        elif category == "media":
            _convert_media(input_path, output_path, fmt)
        elif category == "archive":
            _convert_archive(input_path, output_path, src_ext, fmt)
        else:
            raise ValueError(f"Unsupported category: {category}")

        return {
            "input_path": str(input_path.resolve()),
            "output_path": str(output_path.resolve()),
            "ok": True,
            "error": None,
            "duration_ms": _elapsed_ms(),
        }
    except Exception as exc:
        # Clean up partial output artifact if creation failed
        if output_path is not None and output_path.exists():
            try:
                output_path.unlink()
            except OSError:
                pass
        return {
            "input_path": str(input_path),
            "output_path": "",
            "ok": False,
            "error": str(exc) or "Conversion failed.",
            "duration_ms": _elapsed_ms(),
        }


def convert_batch(jobs: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Processes each `{ input_path, target_format, output_dir }` job sequentially
    on disk and returns `[{ input_path, output_path, ok, error, duration_ms }]`.
    """
    if not isinstance(jobs, (list, tuple)):
        return []

    results: List[Dict[str, Any]] = []
    for job in jobs:
        if not isinstance(job, dict):
            continue
        results.append(
            convert_single(
                input_path_str=str(job.get("input_path") or ""),
                target_format=str(job.get("target_format") or ""),
                output_dir=job.get("output_dir"),
            )
        )
    return results
