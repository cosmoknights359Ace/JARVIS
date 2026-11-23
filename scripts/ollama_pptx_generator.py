#!/usr/bin/env python3
"""
SPDX-License-Identifier: MIT
Copyright (c) 2026 cosmoknight — J.A.R.V.I.S Local Ollama PowerPoint Generator

Standalone CLI & importable module for generating 16:9 PowerPoint (.pptx) decks
from a local Ollama model with:
  - Prompt slide-count override (overrides preset num_slides without extra slides)
  - Strict JSON schema ("title", "bullets", "table") with required speaker_notes
  - Anti-repetition & technical depth prompt rules + zero hardcoded fallback copy
  - Automatic 1-shot corrective retry on JSON/schema/count validation errors
  - Native python-pptx table renderer (add_table) + embedded Notes pane speaker notes

Dependencies:
    pip install python-pptx requests

Example CLI usage:
    python scripts/ollama_pptx_generator.py ^
        "Create a 6-slide technical presentation comparing B-Trees vs LSM-Trees with a comparison table" ^
        --preset 8 --model vai-doc:latest --out btree_vs_lsm.pptx
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from typing import Any, Callable, Dict, List, Optional, Tuple

MIN_SLIDES = 2
MAX_SLIDES = 20

PLACEHOLDER_PATTERNS = [
    re.compile(r"^core insights on\b", re.I),
    re.compile(r"^walk the audience through\b", re.I),
    re.compile(r"^key supporting point\b", re.I),
    re.compile(r"^placeholder\b", re.I),
    re.compile(r"^insert .+ here$", re.I),
    re.compile(r"^lorem ipsum", re.I),
]

SLIDE_JSON_SCHEMA: Dict[str, Any] = {
    "title": "Concise Presentation Title",
    "slides": [
        {
            "type": "title",
            "title": "Main Deck Title",
            "subtitle": "Specific 1-line technical framing",
            "speaker_notes": "2-3 concrete spoken sentences introducing the deck scope.",
        },
        {
            "type": "bullets",
            "title": "Specific Technical Section Heading",
            "bullets": [
                "Concrete point with exact mechanism, formula, or Big-O bound (<= 18 words).",
                "Distinct non-overlapping technical fact or trade-off (<= 18 words).",
            ],
            "speaker_notes": "2-3 spoken sentences elaborating on the bullets without repeating them verbatim.",
        },
        {
            "type": "table",
            "title": "Structured Comparison Matrix",
            "headers": ["Dimension", "Option A", "Option B"],
            "rows": [
                ["Lookup Complexity", "O(log_B N)", "O(L * log N) + Bloom filter"],
                ["Write Path", "In-place random page I/O", "Sequential WAL + MemTable flush"],
            ],
            "speaker_notes": "2-3 spoken sentences highlighting the decisive engineering trade-off in the table.",
        },
    ],
}


def build_ollama_system_prompt(
    num_slides: int,
    max_bullets: int = 5,
    max_words_per_bullet: int = 18,
) -> str:
    """Builds the strict Ollama system prompt enforcing count, schema, and technical depth."""
    return f"""You are a senior technical presentation architect generating strict JSON for python-pptx.

HARD CONSTRAINTS:
1. EXACT SLIDE COUNT: Output EXACTLY {num_slides} slides in the "slides" array. Do NOT add extra intro, benchmark, appendix, or summary slides beyond {num_slides}.
2. ALLOWED SLIDE TYPES: Every slide MUST set "type" to one of: "title", "bullets", or "table".
   - Slide 1 MUST be "type": "title" with "title", "subtitle", and "speaker_notes".
   - Use "type": "table" whenever the prompt requests or implies a comparison, matrix, or side-by-side trade-offs. Every "table" slide MUST include "headers" (2-5 columns) and "rows" (2-6 rows, each matching len(headers)).
   - For "type": "bullets", provide 3 to {max_bullets} bullets, each <= {max_words_per_bullet} words.
3. SPEAKER NOTES REQUIRED: Every single slide MUST include a non-empty "speaker_notes" string (2-3 concrete presenter sentences).
4. ANTI-REPETITION RULE: Never repeat the same fact, metric, or bullet point across different slides. Each slide must introduce strictly new information.
5. TECHNICAL ACCURACY RULE: For technical topics, include exact definitions, formulas, Big-O complexity bounds, protocol names, and accurate trade-offs rather than vague summaries.
6. NO PLACEHOLDERS: Never output generic filler such as "Core insights on...", "Key takeaway", or "TBD".
7. STRICT JSON ONLY: Return ONLY a single valid JSON object matching the schema below. No markdown fences, no commentary, and properly escape all double quotes inside strings (\\").

SCHEMA EXAMPLE:
{json.dumps(SLIDE_JSON_SCHEMA, indent=2)}"""


def parse_slide_count_override(prompt: str, preset_num_slides: int) -> Tuple[int, bool]:
    """
    Uses UI preset_num_slides by default; overrides it if the user prompt explicitly
    specifies a slide count (e.g., 'Create a 6-slide presentation', '4 slides').
    Returns (target_num_slides, was_overridden).
    """
    safe_preset = max(MIN_SLIDES, min(MAX_SLIDES, int(preset_num_slides)))
    if not prompt or not prompt.strip():
        return safe_preset, False

    patterns = [
        r"\b(\d{1,2})\s*[-\s]?\s*slides?\b",
        r"\bslides?\s*(?:count|total)?\s*[:=]\s*(\d{1,2})\b",
        r"\b(?:deck|presentation|ppt|pptx)\s+(?:of|with)\s+(\d{1,2})\s+slides?\b",
    ]
    for pat in patterns:
        match = re.search(pat, prompt, flags=re.IGNORECASE)
        if match:
            parsed = int(match.group(1))
            if MIN_SLIDES <= parsed <= MAX_SLIDES:
                return parsed, (parsed != safe_preset)

    return safe_preset, False


def extract_json_object(raw_text: str) -> Dict[str, Any]:
    """Strips optional markdown fences and extracts the outermost JSON object."""
    text = (raw_text or "").strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, flags=re.IGNORECASE)
    if fence:
        text = fence.group(1).strip()

    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("Model output did not contain a JSON object.")

    return json.loads(text[start : end + 1])


def _is_placeholder(text: str) -> bool:
    t = (text or "").strip()
    return (not t) or any(p.search(t) for p in PLACEHOLDER_PATTERNS)


def validate_deck_json(data: Dict[str, Any], expected_slides: int) -> List[str]:
    """Returns a list of validation errors (empty list == valid)."""
    errors: List[str] = []
    if not isinstance(data, dict):
        return ["Root JSON must be an object."]

    slides = data.get("slides")
    if not isinstance(slides, list) or not slides:
        return ['Missing or empty "slides" list.']

    if len(slides) != expected_slides:
        errors.append(f"Expected exactly {expected_slides} slides, got {len(slides)}.")

    seen_bullets = set()

    for idx, slide in enumerate(slides, start=1):
        if not isinstance(slide, dict):
            errors.append(f"Slide {idx} is not an object.")
            continue

        stype = str(slide.get("type", "")).strip().lower()
        if stype not in {"title", "bullets", "table"}:
            errors.append(
                f'Slide {idx} has invalid type "{stype}" (must be title, bullets, or table).'
            )

        title = str(slide.get("title", "")).strip()
        if _is_placeholder(title):
            errors.append(f"Slide {idx} has a missing or placeholder title.")

        notes = str(slide.get("speaker_notes", "")).strip()
        if len(notes) < 15 or _is_placeholder(notes):
            errors.append(f"Slide {idx} is missing concrete non-empty speaker_notes.")

        if stype == "table":
            headers = slide.get("headers")
            rows = slide.get("rows")
            if not isinstance(headers, list) or len(headers) < 2:
                errors.append(f"Slide {idx} (table) must have >= 2 headers.")
            if not isinstance(rows, list) or len(rows) < 2:
                errors.append(f"Slide {idx} (table) must have >= 2 rows.")
            elif isinstance(headers, list):
                for r_idx, row in enumerate(rows, start=1):
                    if not isinstance(row, list) or len(row) != len(headers):
                        errors.append(
                            f"Slide {idx} table row {r_idx} length must equal header count ({len(headers)})."
                        )
        elif stype == "bullets":
            bullets = slide.get("bullets")
            if not isinstance(bullets, list) or not bullets:
                errors.append(f"Slide {idx} (bullets) has no bullet points.")
            else:
                for b in bullets:
                    b_clean = str(b).strip()
                    if _is_placeholder(b_clean):
                        errors.append(f"Slide {idx} contains placeholder bullet text.")
                    norm = re.sub(r"\W+", " ", b_clean.lower()).strip()
                    if norm and norm in seen_bullets:
                        errors.append(
                            f'Slide {idx} repeats a bullet from an earlier slide: "{b_clean[:40]}..."'
                        )
                    seen_bullets.add(norm)

    return errors


def call_local_ollama(
    system_prompt: str,
    user_message: str,
    model: str = "vai-doc:latest",
    host: str = "http://127.0.0.1:11434",
    timeout_sec: int = 180,
) -> str:
    """Calls local Ollama /api/chat with format=json and bounded num_ctx."""
    url = f"{host.rstrip('/')}/api/chat"
    payload = {
        "model": model,
        "stream": False,
        "format": "json",
        "keep_alive": "10m",
        "options": {
            "temperature": 0.25,
            "num_ctx": 8192,
        },
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            return str(body.get("message", {}).get("content", ""))
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Could not reach local Ollama at {url}: {exc}") from exc


def generate_validated_deck_json(
    user_prompt: str,
    preset_num_slides: int,
    call_ollama_fn: Callable[[str, str], str],
) -> Dict[str, Any]:
    """
    Resolves exact target slide count, calls Ollama, validates JSON, and performs
    1 automatic corrective retry if validation fails.
    """
    num_slides, _ = parse_slide_count_override(user_prompt, preset_num_slides)
    system_prompt = build_ollama_system_prompt(num_slides)

    raw = call_ollama_fn(system_prompt, user_prompt)
    data: Optional[Dict[str, Any]] = None
    try:
        data = extract_json_object(raw)
        errors = validate_deck_json(data, num_slides)
    except Exception as exc:
        errors = [f"JSON parse failure: {exc}"]

    if errors:
        correction_msg = (
            f"Original request: {user_prompt}\n\n"
            "Your previous JSON failed validation for these exact reasons:\n"
            + "\n".join(f"- {e}" for e in errors)
            + f"\n\nReturn ONLY a corrected, strictly valid JSON object with EXACTLY {num_slides} slides."
        )
        raw_retry = call_ollama_fn(system_prompt, correction_msg)
        data = extract_json_object(raw_retry)
        retry_errors = validate_deck_json(data, num_slides)

        # Strictly trim if the model still over-generated; never inject dummy slides
        if isinstance(data.get("slides"), list) and len(data["slides"]) > num_slides:
            data["slides"] = data["slides"][:num_slides]
            retry_errors = validate_deck_json(data, num_slides)

        if retry_errors:
            raise ValueError(
                "Deck JSON failed validation after retry:\n- " + "\n".join(retry_errors)
            )

    assert data is not None
    return data


def build_pptx_from_deck(deck_json: Dict[str, Any], output_path: str) -> str:
    """
    Compiles validated deck JSON into a 16:9 .pptx file with native tables,
    embedded speaker notes, and zero hardcoded fallback strings.
    """
    from pptx import Presentation
    from pptx.dml.color import RGBColor
    from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
    from pptx.util import Inches, Pt

    theme = {
        "bg": RGBColor(0x09, 0x09, 0x0D),
        "surface": RGBColor(0x14, 0x14, 0x1B),
        "surface_alt": RGBColor(0x0F, 0x0F, 0x15),
        "accent": RGBColor(0xF9, 0x73, 0x16),
        "text": RGBColor(0xF4, 0xF4, 0xF6),
        "muted": RGBColor(0xA1, 0xA1, 0xAA),
        "header_text": RGBColor(0x09, 0x09, 0x0D),
    }

    def apply_bg(slide) -> None:
        fill = slide.background.fill
        fill.solid()
        fill.fore_color.rgb = theme["bg"]

    def write_notes(slide, notes_text: str) -> None:
        text = (notes_text or "").strip()
        if not text:
            raise ValueError("Refusing to build slide with empty speaker_notes.")
        slide.notes_slide.notes_text_frame.text = text

    def add_header(slide, title: str, slide_idx: int, total_slides: int) -> None:
        bar = slide.shapes.add_shape(1, Inches(0), Inches(0), Inches(13.333), Inches(0.08))
        bar.fill.solid()
        bar.fill.fore_color.rgb = theme["accent"]
        bar.line.fill.background()

        title_box = slide.shapes.add_textbox(Inches(0.65), Inches(0.35), Inches(11.0), Inches(0.8))
        tf = title_box.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        p.text = title
        p.font.name = "Calibri"
        p.font.size = Pt(28)
        p.font.bold = True
        p.font.color.rgb = theme["text"]

        footer_box = slide.shapes.add_textbox(Inches(11.4), Inches(6.95), Inches(1.3), Inches(0.35))
        fp = footer_box.text_frame.paragraphs[0]
        fp.text = f"{slide_idx:02d} / {total_slides:02d}"
        fp.alignment = PP_ALIGN.RIGHT
        fp.font.name = "Calibri"
        fp.font.size = Pt(11)
        fp.font.color.rgb = theme["muted"]

    def render_table(slide, headers: List[str], rows: List[List[str]]) -> None:
        num_cols = len(headers)
        num_rows = len(rows) + 1

        left = Inches(0.65)
        top = Inches(1.4)
        width = Inches(12.03)
        row_height_in = min(0.72, 5.15 / max(num_rows, 2))
        height = Inches(row_height_in * num_rows)

        table = slide.shapes.add_table(num_rows, num_cols, left, top, width, height).table

        if num_cols >= 3:
            first_w = width * 0.24
            other_w = (width - first_w) / (num_cols - 1)
            table.columns[0].width = int(first_w)
            for c in range(1, num_cols):
                table.columns[c].width = int(other_w)
        else:
            col_w = int(width / num_cols)
            for c in range(num_cols):
                table.columns[c].width = col_w

        body_font_pt = 13 if len(rows) <= 4 else 11.5

        def style_cell(cell, text: str, is_header: bool, is_first_col: bool, row_idx: int) -> None:
            cell.text = ""
            cell.vertical_anchor = MSO_ANCHOR.MIDDLE
            cell.margin_left = Inches(0.14)
            cell.margin_right = Inches(0.14)
            cell.margin_top = Inches(0.08)
            cell.margin_bottom = Inches(0.08)

            cell.fill.solid()
            if is_header:
                cell.fill.fore_color.rgb = theme["accent"]
            else:
                cell.fill.fore_color.rgb = theme["surface"] if row_idx % 2 == 0 else theme["surface_alt"]

            tf = cell.text_frame
            tf.word_wrap = True
            p = tf.paragraphs[0]
            p.text = str(text).strip()
            p.alignment = PP_ALIGN.LEFT
            p.font.name = "Calibri"
            p.font.size = Pt(14 if is_header else body_font_pt)
            p.font.bold = is_header or is_first_col
            p.font.color.rgb = theme["header_text"] if is_header else theme["text"]

        for c_idx, h in enumerate(headers):
            style_cell(table.cell(0, c_idx), h, is_header=True, is_first_col=(c_idx == 0), row_idx=0)

        for r_idx, row in enumerate(rows):
            for c_idx in range(num_cols):
                val = row[c_idx] if c_idx < len(row) else ""
                style_cell(
                    table.cell(r_idx + 1, c_idx),
                    val,
                    is_header=False,
                    is_first_col=(c_idx == 0),
                    row_idx=r_idx,
                )

    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    blank_layout = prs.slide_layouts[6]

    slides_data = deck_json["slides"]
    total = len(slides_data)

    for idx, slide_data in enumerate(slides_data, start=1):
        slide = prs.slides.add_slide(blank_layout)
        apply_bg(slide)

        stype = slide_data["type"].strip().lower()
        title = slide_data["title"].strip()

        if stype == "title":
            bar = slide.shapes.add_shape(1, Inches(0.8), Inches(2.15), Inches(1.4), Inches(0.1))
            bar.fill.solid()
            bar.fill.fore_color.rgb = theme["accent"]
            bar.line.fill.background()

            t_box = slide.shapes.add_textbox(Inches(0.8), Inches(2.4), Inches(11.6), Inches(1.8))
            t_tf = t_box.text_frame
            t_tf.word_wrap = True
            tp = t_tf.paragraphs[0]
            tp.text = title
            tp.font.name = "Calibri"
            tp.font.size = Pt(42)
            tp.font.bold = True
            tp.font.color.rgb = theme["text"]

            subtitle = str(slide_data.get("subtitle", "")).strip()
            if subtitle:
                s_box = slide.shapes.add_textbox(Inches(0.8), Inches(4.3), Inches(10.8), Inches(1.1))
                s_tf = s_box.text_frame
                s_tf.word_wrap = True
                sp = s_tf.paragraphs[0]
                sp.text = subtitle
                sp.font.name = "Calibri"
                sp.font.size = Pt(20)
                sp.font.color.rgb = theme["muted"]

        elif stype == "table":
            add_header(slide, title, idx, total)
            render_table(slide, slide_data["headers"], slide_data["rows"])

        elif stype == "bullets":
            add_header(slide, title, idx, total)
            box = slide.shapes.add_textbox(Inches(0.75), Inches(1.45), Inches(11.8), Inches(5.2))
            tf = box.text_frame
            tf.word_wrap = True

            for b_idx, bullet in enumerate(slide_data["bullets"]):
                p = tf.paragraphs[0] if b_idx == 0 else tf.add_paragraph()
                p.text = f"•  {str(bullet).strip()}"
                p.space_after = Pt(14)
                p.font.name = "Calibri"
                p.font.size = Pt(19)
                p.font.color.rgb = theme["text"]
        else:
            raise ValueError(f"Unsupported slide type on slide {idx}: {stype}")

        write_notes(slide, slide_data["speaker_notes"])

    prs.save(output_path)
    return output_path


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Generate a 16:9 .pptx deck via local Ollama.")
    parser.add_argument("prompt", help="Presentation topic / prompt (may include slide count override)")
    parser.add_argument("--preset", type=int, default=8, help="Default slide count preset (default: 8)")
    parser.add_argument("--model", default="vai-doc:latest", help="Local Ollama model tag")
    parser.add_argument("--host", default="http://127.0.0.1:11434", help="Local Ollama host URL")
    parser.add_argument("--out", default="jarvis_deck.pptx", help="Output .pptx file path")
    args = parser.parse_args(argv)

    target_count, overridden = parse_slide_count_override(args.prompt, args.preset)
    print(
        f"[Xslide-Py] Target slides: {target_count}"
        f"{' (overridden from prompt)' if overridden else ' (from preset)'} · Model: {args.model}"
    )

    deck = generate_validated_deck_json(
        user_prompt=args.prompt,
        preset_num_slides=args.preset,
        call_ollama_fn=lambda sys_p, usr_p: call_local_ollama(
            sys_p, usr_p, model=args.model, host=args.host
        ),
    )
    saved = build_pptx_from_deck(deck, args.out)
    print(f"[Xslide-Py] Saved {len(deck['slides'])}-slide presentation to {saved}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
