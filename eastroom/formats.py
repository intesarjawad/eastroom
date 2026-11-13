"""Books that are not EPUB: plain text, comics in a zip (CBZ), and PDF.

Each reader returns what eastroom.ingest.read_epub returns. A book whose unit is the page (a comic,
a scan, a PDF whose layout is the book) comes back with kind "pages": every block is a picture of
one page, and a page counts as PAGE_WORDS words so that place, progress and time
left work as they do for prose.

PDF needs one optional package on Home (pypdfium2, with Pillow to pack the pictures). The rules for
taking a book's text out of a PDF follow what long-lived converters do: running heads and page
numbers are lines that repeat at the edge of pages, a word broken at a line end is joined when the
joined word occurs elsewhere in the book, and a paragraph ends at a short line, a gap or an indent.
"""

from __future__ import annotations

import importlib
import io
import itertools
import re
import statistics
import zipfile
from collections import Counter
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

from . import ingest

PAGE_WORDS = 60  # what one page of pictures counts for: about a quarter of a minute
PAGES_PER_PART = 40
PAGE_SIDE = 1800  # pixels on the longer side of a page made from a PDF
MAX_COMIC = 2 << 30
CHAPTERISH = re.compile(
    r"^(chapter|part|book|section|prologue|epilogue|introduction|preface)\b", re.I
)
PAGE_NUMBER = re.compile(r"^\W*(page\s+)?(\d{1,4}|[ivxlcdm]{1,7})\W*$", re.I)
JUNK = re.compile(r"(^|/)(__MACOSX|@eaDir|\.[^/]*)(/|$)|(^|/)Thumbs\.db$", re.I)
NEEDS_PDF = 'Reading PDFs needs one more package on Home. Run: pip install "eastroom[pdf]"'


def natural(name: str) -> list[int | str]:
    """Sorts page2 before page10, without regard to case, as every comic reader does."""
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", name)]


def paged(
    title: str,
    author: str,
    pages: list[tuple[str, bytes, int, int, str]],
    parts: list[tuple[str, int]] | None = None,
    rtl: bool = False,
) -> dict[str, Any]:
    """A book of pages. `pages`: (file type, bytes, width, height, the page's own text). `parts`:
    (title, first page) from the file, if it has any."""
    if not parts or len(parts) < 2:
        parts = (
            [
                (f"Pages {i + 1} to {min(i + PAGES_PER_PART, len(pages))}", i)
                for i in range(0, len(pages), PAGES_PER_PART)
            ]
            if len(pages) > PAGES_PER_PART * 1.5
            else [(title, 0)]
        )
    pictures: dict[str, bytes] = {}
    chapters: list[dict[str, Any]] = []
    starts = sorted({max(0, min(len(pages) - 1, at)) for _, at in parts} | {0})
    names = {at: name for name, at in reversed(parts)}
    for n, start in enumerate(starts):
        end = starts[n + 1] if n + 1 < len(starts) else len(pages)
        blocks: list[dict[str, Any]] = []
        for i in range(start, end):
            kind, data, w, h, text = pages[i]
            name = f"pages/{i + 1:04d}{kind}"
            pictures[name] = data
            blocks.append(
                {"k": "f", "t": "", "src": name, "w": w, "h": h, **({"text": text} if text else {})}
            )
        chapters.append(
            {
                "title": (names.get(start) or f"Page {start + 1}")[:120],
                "blocks": blocks,
                "words": len(blocks) * PAGE_WORDS,
            }
        )
    cover = ("cover" + pages[0][0], pages[0][1]) if pages else None
    return {
        "title": title,
        "author": author,
        "cover": cover,
        "chapters": chapters,
        "pictures": pictures,
        "kind": "pages",
        "rtl": rtl,
    }


# ---------- plain text and Markdown ----------
def read_text(path: Path) -> dict[str, Any]:
    raw = path.read_bytes().decode("utf-8-sig", "replace").replace("\r\n", "\n").replace("\r", "\n")
    blocks: list[dict[str, Any]] = []
    title = ""
    for para in re.split(r"\n[ \t]*\n", raw):
        lines = [line.strip() for line in para.split("\n") if line.strip()]
        if not lines:
            continue
        heading = re.match(r"^(#{1,6})\s+(.+?)\s*#*$", lines[0])
        if heading and len(lines) == 1:
            blocks.append({"k": "h", "t": heading[2], "lv": len(heading[1])})
            title = title or (heading[2] if len(heading[1]) == 1 else "")
        elif (
            len(lines) == 1
            and len(lines[0].split()) <= 10
            and (CHAPTERISH.match(lines[0]) or (lines[0].isupper() and len(lines[0]) > 3))
        ):
            blocks.append({"k": "h", "t": lines[0], "lv": 2})
        elif len(lines) > 1 and max(map(len, lines)) < 52:
            blocks.append(
                {"k": "p", "t": "\n".join(lines), "lv": 0}
            )  # short lines the author broke: verse, a letter's heading
        else:
            blocks.append({"k": "p", "t": " ".join(lines), "lv": 0})
    return {
        "title": title or path.stem,
        "author": "",
        "cover": None,
        "chapters": ingest.chapters_of([blocks]),
    }


# ---------- comics ----------
def read_cbz(path: Path) -> dict[str, Any]:
    with zipfile.ZipFile(path) as z:
        members = {
            i.filename: i for i in z.infolist()
        }  # a name given twice is one file, the last: counted once and read once
        if sum(i.file_size for i in members.values()) > MAX_COMIC:
            raise ValueError(
                "This file unpacks to more than 2 GB, which is too large for East Room."
            )
        info: dict[str, str] = {}
        meta = next((n for n in members if n.lower().endswith("comicinfo.xml")), None)
        if meta:
            try:
                info = {
                    e.tag: (e.text or "").strip() for e in ET.fromstring(z.read(meta)) if e.text
                }
            except ET.ParseError:
                info = {}
        pages: list[tuple[str, bytes, int, int, str]] = []
        folders: list[str] = []
        for name in sorted(
            (n for n in members if not n.endswith("/") and not JUNK.search(n)), key=natural
        ):
            data = z.read(members[name])
            size = ingest.image_size(
                data
            )  # what is not a picture is not a page, whatever its name says
            if size:
                pages.append((ingest.PICTURE_TYPES[data[:2]], data, *size, ""))
                folders.append(name.rsplit("/", 1)[0] if "/" in name else "")
    if not pages:
        raise ValueError(f"{path.name}: no pages found. A comic file is a zip of pictures.")
    firsts = [
        (folder.rsplit("/", 1)[-1], folders.index(folder)) for folder in dict.fromkeys(folders)
    ]
    title = (
        info.get("Title")
        or " ".join(filter(None, [info.get("Series"), info.get("Number") and f"#{info['Number']}"]))
        or path.stem
    )
    return paged(
        title,
        info.get("Writer", "").split(",")[0].strip(),
        pages,
        firsts if len(firsts) > 1 else None,
        rtl=info.get("Manga") == "YesAndRightToLeft",
    )


# ---------- PDF ----------
def _lines(textpage: Any, height: float) -> list[dict[str, Any]]:
    """The lines of one page, top to bottom: {x0, x1, top, size, t}. PDFium gives runs of text;
    runs on one baseline are one line."""
    runs: list[dict[str, Any]] = []
    for i in range(textpage.count_rects()):
        left, bottom, right, top = textpage.get_rect(i)
        text = " ".join(textpage.get_text_bounded(left, bottom, right, top).split())
        if text:
            runs.append(
                {"x0": left, "x1": right, "top": height - top, "bottom": height - bottom, "t": text}
            )
    runs.sort(key=lambda r: (round(r["top"] + (r["bottom"] - r["top"]) / 2), r["x0"]))
    lines: list[dict[str, Any]] = []
    for run in runs:
        last = lines[-1] if lines else None
        middle = (run["top"] + run["bottom"]) / 2
        if last and last["top"] <= middle <= last["bottom"]:
            gap = run["x0"] - last["x1"]
            last["t"] += ("" if gap < (last["bottom"] - last["top"]) * 0.15 else " ") + run["t"]
            last["x1"], last["top"], last["bottom"] = (
                max(last["x1"], run["x1"]),
                min(last["top"], run["top"]),
                max(last["bottom"], run["bottom"]),
            )
        else:
            lines.append(dict(run))
    for line in lines:
        line["size"] = round((line["bottom"] - line["top"]) * 2) / 2
    return lines


def _edge_key(text: str) -> str:
    return re.sub(r"\d+|\b[ivxlcdm]+\b", "#", text.lower()).strip()


def _prose(pages: list[list[dict[str, Any]]], widths: list[float]) -> list[list[dict[str, Any]]]:
    """Pages of lines into blocks, one list per page. Running heads go, broken words
    are joined, paragraphs are found."""
    edges = Counter(
        _edge_key(line["t"])
        for lines in pages
        for line in (lines[:2] + lines[-2:] if len(lines) > 4 else [])
    )
    repeated = {key for key, n in edges.items() if n >= max(4, len(pages) // 25)}
    kept: list[list[dict[str, Any]]] = []
    for lines in pages:
        edge: set[int] = {id(line) for line in lines[:2] + lines[-2:]} if len(lines) > 4 else set()
        kept.append(
            [
                line
                for line in lines
                if not (
                    id(line) in edge
                    and (_edge_key(line["t"]) in repeated or PAGE_NUMBER.match(line["t"]))
                )
            ]
        )
    sizes: Counter[float] = Counter()
    for lines in kept:
        for line in lines:
            sizes[line["size"]] += len(line["t"])
    body = sizes.most_common(1)[0][0] if sizes else 10.0
    words = Counter(
        w.lower() for lines in kept for line in lines for w in re.findall(r"[A-Za-z]+", line["t"])
    )
    bigger = sorted({s for s in sizes if s >= body * 1.18}, reverse=True)
    out: list[list[dict[str, Any]]] = []
    open_block: dict[str, Any] | None = None  # a paragraph may run on to the next page
    for lines, width in zip(kept, widths, strict=True):
        blocks: list[dict[str, Any]] = []
        body_lines = [line for line in lines if line["size"] < body * 1.18]
        left = statistics.median_low([line["x0"] for line in body_lines]) if body_lines else 0.0
        right = max((line["x1"] for line in body_lines), default=width)
        gaps = [
            b["top"] - a["top"]
            for a, b in itertools.pairwise(body_lines)
            if 0 < b["top"] - a["top"] < body * 3
        ]
        pitch = statistics.median(gaps) if gaps else body * 1.3
        previous = None
        for line in lines:
            text = line["t"]
            if line["size"] >= body * 1.18 and len(text.split()) <= 14:
                last = blocks[-1] if blocks else None
                if (
                    last
                    and last["k"] == "h"
                    and last.get("size") == line["size"]
                    and previous
                    and line["top"] - previous["top"] < line["size"] * 2
                ):
                    last["t"] += " " + text  # a heading set on two lines
                else:
                    blocks.append(
                        {
                            "k": "h",
                            "t": text,
                            "lv": min(6, 2 + bigger.index(line["size"]))
                            if line["size"] in bigger
                            else 2,
                            "size": line["size"],
                        }
                    )
                open_block, previous = None, line
                continue
            starts = (
                open_block is None
                or (previous is not None and line["top"] - previous["top"] > pitch * 1.45)
                or line["x0"] > left + body * 0.9
                or (
                    previous is not None
                    and previous["x1"] < right - (right - left) * 0.12
                    and re.search(r"[.!?:\"”’)]$", previous["t"])
                )
            )
            if (
                previous is None
                and open_block is not None
                and not re.search(r"[.!?:\"”’)]$", open_block["t"])
                and line["x0"] <= left + body * 0.9
            ):
                starts = False  # the page turned in the middle of a sentence
            if starts or open_block is None:
                open_block = {"k": "p", "t": text, "lv": 0}
                blocks.append(open_block)
            else:
                broken = re.search(
                    r"([A-Za-z]+)[-\x02]$", open_block["t"]
                )  # PDFium writes a hyphen at a line end as \x02
                first = re.match(r"[a-z]+", text)
                if broken and first and words[(broken[1] + first[0]).lower()] > 0:
                    open_block["t"] = (
                        open_block["t"][:-1] + text
                    )  # "con-" + "tinued", and "continued" is a word of this book
                elif broken and first:
                    open_block["t"] += text  # a compound that happens to break at its hyphen
                else:
                    open_block["t"] += " " + text
            previous = line
        for block in blocks:
            block.pop("size", None)
            block["t"] = block["t"].replace("\x02", "-")
        out.append(blocks)
    return out


def read_pdf(path: Path) -> dict[str, Any]:
    try:
        pdfium = importlib.import_module("pypdfium2")
        # pypdfium2 needs it to hand over a picture
        importlib.import_module("PIL.Image")
    except ImportError as err:
        raise RuntimeError(NEEDS_PDF) from err
    try:
        pdf = pdfium.PdfDocument(str(path))
    except pdfium.PdfiumError as err:
        raise ValueError(
            f"{path.name}: this PDF could not be opened."
            " If it asks for a password, East Room cannot read it."
        ) from err
    count = len(pdf)
    if not count:
        raise ValueError(f"{path.name}: this PDF has no pages.")
    meta = pdf.get_metadata_dict()
    title, author = (
        (meta.get("Title") or "").strip() or path.stem,
        (meta.get("Author") or "").strip(),
    )
    outline: list[tuple[int, str, int]] = []
    for mark in pdf.get_toc(max_depth=3):
        try:
            at = mark.get_dest().get_index()
        except (AttributeError, pdfium.PdfiumError):
            at = None
        if at is not None and mark.get_title().strip():
            outline.append((mark.level, mark.get_title().strip(), at))
    pages: list[list[dict[str, Any]]] = []
    widths: list[float] = []
    texts: list[str] = []
    wordy, pictured = 0, 0
    for i in range(count):
        page = pdf[i]
        width, height = page.get_size()
        textpage = page.get_textpage()
        lines = _lines(textpage, height)
        n = sum(len(line["t"].split()) for line in lines)
        area = 0.0
        for obj in page.get_objects(filter=[pdfium.raw.FPDF_PAGEOBJ_IMAGE], max_depth=2):
            left, bottom, right, top = obj.get_bounds()
            area = max(area, (right - left) * (top - bottom) / max(1.0, width * height))
        wordy += n >= 80
        pictured += area >= 0.5
        pages.append(lines)
        widths.append(width)
        texts.append(" ".join(line["t"] for line in lines))
    # a book of prose has words on most of its pages; anything else is shown as the pages it is
    if wordy >= count * 0.6 and pictured < count * 0.3:
        docs_by_page = _prose(pages, widths)
        level = min((lv for lv, _, _ in outline), default=0)
        marks = [(name, at) for lv, name, at in outline if lv == level]
        docs: list[list[dict[str, Any]]] = []
        if len(marks) >= 3:  # the file's own contents list says where the chapters begin
            cuts = sorted({at for _, at in marks} | {0})
            names = {at: name for name, at in reversed(marks)}
            for n, start in enumerate(cuts):
                blocks = [
                    b
                    for page_blocks in docs_by_page[
                        start : cuts[n + 1] if n + 1 < len(cuts) else count
                    ]
                    for b in page_blocks
                ]
                if start in names:

                    def same(t: str) -> str:
                        return re.sub(r"\W+", "", t).lower()

                    if (
                        blocks
                        and blocks[0]["k"] == "h"
                        and (
                            same(blocks[0]["t"]) in same(names[start])
                            or same(names[start]) in same(blocks[0]["t"])
                        )
                    ):
                        blocks = blocks[
                            1:
                        ]  # the page prints the same title the contents list gives
                    blocks = [
                        {"k": "h", "t": names[start], "lv": 1},
                        *({**b, "lv": max(b["lv"], 3)} if b["k"] == "h" else b for b in blocks),
                    ]
                docs.append(blocks)
        else:
            docs = [[b for page_blocks in docs_by_page for b in page_blocks]]
        chapters = ingest.chapters_of(docs)
        if chapters:
            cover = (
                pdf[0].render(scale=PAGE_SIDE / 2 / max(pdf[0].get_size())).to_pil().convert("RGB")
            )
            data = io.BytesIO()
            cover.save(data, "JPEG", quality=86)
            return {
                "title": title,
                "author": author,
                "cover": ("cover.jpg", data.getvalue()),
                "chapters": chapters,
            }
    made: list[tuple[str, bytes, int, int, str]] = []
    # shortcut: every page is held in memory until the book is
    # written; write page by page when a 1000-page scan arrives
    for i in range(count):
        page = pdf[i]
        image = page.render(scale=PAGE_SIDE / max(page.get_size())).to_pil().convert("RGB")
        data = io.BytesIO()
        image.save(data, "JPEG", quality=82)
        made.append((".jpg", data.getvalue(), image.width, image.height, texts[i][:20000]))
    level = min((lv for lv, _, _ in outline), default=0)
    return paged(title, author, made, [(name, at) for lv, name, at in outline if lv == level])


READERS = {"pdf": read_pdf, "cbz": read_cbz, "text": read_text}
