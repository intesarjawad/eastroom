"""Turn an EPUB into East Room's library format using only the standard library.

A book becomes chapters; a chapter becomes blocks in reading order. Every block keeps the author's
exact words. The only interpretation is structural: which blocks are headings (they start a part),
which are quotations and which are their attributions. No model is involved.

    library/<slug>/book.json            title, author, cover, chapters [{id, title, words}]
    library/<slug>/chapters/<id>.json   {id, title, blocks: [{id, k, t}]}
                                        k: h | p | q | a | f (picture) | t (table)
    library/<slug>/pictures/            the book's own pictures, named in the order they are met
    library/<slug>/original.<type>      the file as it was added, so the book can be read again by a
                                        better reader later

A picture block carries src, w, h and its caption as t. A table block carries rows. Any block may
carry n: the notes it points to.
"""

from __future__ import annotations

import hashlib
import itertools
import json
import posixpath
import re
import shutil
import zipfile
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import unquote
from xml.etree import ElementTree as ET

BLOCK_TAGS = {
    "p",
    "div",
    "li",
    "blockquote",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "pre",
    "td",
    "dd",
    "dt",
    "section",
    "article",
}
HEADING_TAGS = {"h1", "h2", "h3", "h4", "h5", "h6"}
SKIP_TAGS = {"script", "style", "head", "nav", "sup"}  # sup: footnote markers
VOID_TAGS = {"br", "img", "image", "hr", "meta", "link", "input", "col", "wbr", "source"}
CAPTION_CLASS = re.compile(r"caption|figcap|legend", re.I)
NOTEREF = re.compile(r"noteref|footnote-?ref|fn-?ref|doc-noteref", re.I)
NOTE_BODY = re.compile(r"\b(footnote|endnote|rearnote|doc-footnote|doc-endnote)\b", re.I)
BACKLINK = re.compile(r"backlink|doc-backlink", re.I)
MIN_PICTURE = (
    120  # pixels on the shorter side; smaller images are ornaments, rules and inline glyphs
)
PICTURE_WORDS = 40  # what a picture counts for when deciding whether a section is worth keeping
MAX_TABLE = (200, 12)  # rows, columns kept
HEADING_CLASS = re.compile(r"head|title|subh|chapter|section-?name", re.I)
QUOTE_CLASS = re.compile(r"epigraph|quot|extract|poem|verse|blockq|sidebar", re.I)
ATTRIBUTION_CLASS = re.compile(r"attrib|source|credit|signature", re.I)
MIN_CHAPTER_WORDS = 150  # shorter spine documents are title pages, copyright notices and the like
BOILERPLATE = re.compile(r"project gutenberg|all rights reserved|table of contents|ISBN", re.I)
CHAPTER_ANCHOR = re.compile(r"^chap(?:ter)?[_-]?([ivxlcdm]+|\d+)$", re.I)
COVER_TYPES = (".jpg", ".jpeg", ".png", ".webp", ".gif")
MIN_BODY_WORDS = 20  # a "chapter" with less text than this is a part title or a title page
GUTENBERG_MARK = re.compile(r"^\*{3}\s*(START|END) OF TH(?:E|IS) PROJECT GUTENBERG", re.I)
CONTENTS = re.compile(r"^(table of )?contents\.?$", re.I)
PUBLISHER_PAGE = re.compile(
    r"^(uncopyright|colophon|imprint|copyright( page)?)$", re.I
)  # the edition's own pages, not the author's
ROMAN = re.compile(r"^[IVXLCDM]+[.:]?$")
MAX_PICTURE = 40 * 1024 * 1024
PICTURE_TYPES = {b"\x89P": ".png", b"GI": ".gif", b"RI": ".webp", b"\xff\xd8": ".jpg"}
MAX_UNPACKED = 1 << 30  # an EPUB is a zip; one that unpacks past 1 GB is not a book
FONT_OBFUSCATION = (
    "http://www.idpf.org/2008/embedding",
    "http://ns.adobe.com/pdf/enc#RC",
)  # scrambled fonts are not copy protection
LOCKED = "This file is locked by its shop (DRM). East Room cannot open it."


class _Blocks(HTMLParser):
    """Collects text block by block. Nested block tags flush, so a <div> of <p>s yields the <p>s.

    Pictures become blocks of their own, after the paragraph they sit in. A note's body is taken out
    of the flow and kept under its id in `notes`; the block that points to it
    carries the address in `refs`.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[dict[str, Any]] = []
        self.notes: dict[str, str] = {}
        self._text: list[str] = []
        self._kind = "p"
        self._skip = 0
        self._quote = 0
        self._bold_chars = 0
        self._level = 0
        self._anchor = ""
        self._refs: list[str] = []
        self._ref_open: list[
            bool
        ] = []  # one entry per open <a>: whether it is a note marker whose text is skipped
        self._pending: list[dict[str, Any]] = []  # pictures met inside a paragraph: they follow it
        self._figure: dict[str, Any] | None = None
        self._caption = False
        self._svg = 0
        self._note: list[Any] | None = None  # [id, depth, texts]
        self._table: dict[str, Any] | None = None

    def _flush(self) -> None:
        text = re.sub(r"\s+", " ", "".join(self._text))
        # a <br> is a line the author broke (verse, letters,
        # addresses); two in a row is a stanza break
        text = re.sub(
            r"\n{3,}", "\n\n", "\n".join(part.strip() for part in text.split("\x00"))
        ).strip()
        named = CHAPTER_ANCHOR.match(self._anchor)
        if not text and self._kind == "h" and named:
            # the heading is a picture; its anchor still names the chapter
            text = f"Chapter {named[1].upper()}"
        self._anchor = ""
        last = self.blocks[-1] if self.blocks else None
        if text and self._caption and self._figure is not None:
            self._figure["cap"] = (
                f"{self._figure['cap']} {text}".strip()
            )  # a figure's caption belongs to its picture, not to the prose
        elif text and self._caption and last and last["k"] == "f" and not last["t"]:
            last["t"] = " ".join(text.split())  # <p class="caption"> straight after a picture
        elif text:
            kind = self._kind
            words = len(text.split())
            if (
                kind == "p"
                and words <= 12
                and self._bold_chars >= len(text) * 0.9
                and not text.endswith((".", ",", ";"))
            ):
                kind = "h"  # a short all-bold line is a heading set with <b> instead of <h2>
            if kind in ("p", "q") and re.match(r"^[—–-]{1,2}\s*\S", text) and words <= 25:
                kind = "a"  # "—Ovid, Cures for Love"
            if kind in ("h", "a"):
                text = " ".join(text.split())  # headings and attributions stay one line
            block: dict[str, Any] = {"k": kind, "t": text, "lv": self._level if kind == "h" else 0}
            if self._refs:
                block["refs"] = self._refs
            self.blocks.append(block)
        elif self._refs and last:
            last.setdefault("refs", []).extend(self._refs)
        self.blocks += self._pending
        self._text, self._bold_chars, self._refs, self._pending = [], 0, [], []

    def _picture(self, src: str, alt: str) -> None:
        fig = {"k": "f", "t": "", "lv": 0, "src": src, "alt": " ".join(alt.split())[:300]}
        if self._figure is not None:
            self._figure["figs"].append(fig)
        if "".join(self._text).strip():
            self._pending.append(fig)
        else:
            self.blocks.append(fig)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = dict(attrs)
        kinds = f"{a.get('epub:type') or ''} {a.get('role') or ''}"
        if (
            tag == "a"
        ):  # a note marker is noticed even inside <sup>, whose text is otherwise dropped
            href = a.get("href") or ""
            marker = (
                bool(NOTEREF.search(f"{kinds} {a.get('class') or ''}"))
                and "#" in href
                and self._note is None
            )
            self._ref_open.append(marker)
            if marker:
                self._refs.append(href)
                self._skip += 1
                return
        if self._note is not None:
            if tag not in VOID_TAGS:
                self._note[1] += 1
            if tag == "a" and BACKLINK.search(f"{kinds} {a.get('class') or ''}"):
                self._ref_open[-1] = True  # "return to text" arrows are not part of the note
                self._skip += 1
            elif tag in BLOCK_TAGS or tag == "br":
                self._note[2].append(" ")
            return
        if tag in SKIP_TAGS:
            self._skip += 1
            return
        if self._skip:
            return
        if self._table is not None:
            if tag == "tr":
                self._table["rows"].append([])
            elif tag in ("td", "th"):
                self._table["cell"] = []
            elif tag == "caption":
                self._table["cell"] = self._table["capt"] = []
            elif tag in BLOCK_TAGS or tag == "br":
                cell: list[str] = self._table.get("cell") or []
                cell.append(" ")
            return
        if tag == "table":
            self._flush()
            self._table = {"rows": [], "cap": "", "cell": None}
            return
        if tag == "svg":
            self._svg += 1
            return
        if tag in ("img", "image"):
            src = a.get("src") or a.get("href") or a.get("xlink:href") or ""
            if (
                src and not src.startswith("data:") and self._kind != "h"
            ):  # a picture inside a heading is the heading, drawn
                self._picture(src, a.get("alt") or "")
            return
        if self._svg:
            return
        if NOTE_BODY.search(kinds) and a.get("id") and tag not in ("a", "section", "body"):
            self._flush()
            self._note = [a["id"], 1, []]
            return
        cls = a.get("class") or ""
        if tag == "figure":
            self._flush()
            self._figure = {"figs": [], "cap": ""}
        elif tag == "figcaption":
            self._flush()
            self._caption = True
        elif tag in BLOCK_TAGS:
            self._flush()
            self._caption = self._figure is None and bool(CAPTION_CLASS.search(cls))
            if tag == "blockquote" or QUOTE_CLASS.search(cls):
                self._quote += tag == "blockquote"
                self._kind = "q"
            else:
                self._kind = "q" if self._quote else "p"
            self._level = int(tag[1]) if tag in HEADING_TAGS else 0
            if tag in HEADING_TAGS or (HEADING_CLASS.search(cls) and tag in ("p", "div")):
                self._kind = "h"
            elif ATTRIBUTION_CLASS.search(cls):
                self._kind = "a"
        elif tag == "a" and self._kind == "h":
            self._anchor = a.get("id") or ""
        elif tag == "br":
            self._text.append("\x00")
        elif tag in ("b", "strong"):
            self._bold = True

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._ref_open and self._ref_open.pop():
            self._skip = max(0, self._skip - 1)
            if self._note is None:
                return
        if self._note is not None:
            self._note[1] -= tag not in VOID_TAGS
            if self._note[1] <= 0:
                text = " ".join("".join(self._note[2]).split())
                text = re.sub(
                    r"^\(?\d{1,4}[.)]?\s+", "", text
                )  # the note's own number repeats the marker
                if text:
                    self.notes[self._note[0]] = text
                self._note = None
            return
        if tag in SKIP_TAGS:
            self._skip = max(0, self._skip - 1)
            return
        if self._table is not None:
            t = self._table
            if tag in ("td", "th") and t["cell"] is not None:
                if not t["rows"]:
                    t["rows"].append([])
                t["rows"][-1].append(" ".join("".join(t["cell"]).split()))
                t["cell"] = None
            elif tag == "caption":
                t["cap"], t["cell"] = " ".join("".join(t.get("capt") or []).split()), None
            elif tag == "table":
                self._table = None
                rows = [row[: MAX_TABLE[1]] for row in t["rows"] if any(row)][: MAX_TABLE[0]]
                cells = [c for row in rows for c in row if c]
                if len(cells) == 1 or (
                    rows and max(len(row) for row in rows) == 1
                ):  # a table used only to place text on the page
                    self.blocks += [{"k": "p", "t": c, "lv": 0} for c in cells]
                elif rows:
                    self.blocks.append({"k": "t", "t": t["cap"], "lv": 0, "rows": rows})
            return
        if tag == "svg":
            self._svg = max(0, self._svg - 1)
        elif tag == "figcaption":
            self._flush()
            self._caption = False
        elif tag == "figure" and self._figure is not None:
            self._flush()
            if self._figure["figs"] and self._figure["cap"]:
                self._figure["figs"][-1]["t"] = self._figure["cap"]
            elif self._figure["cap"]:
                self.blocks.append(
                    {"k": "p", "t": self._figure["cap"], "lv": 0}
                )  # a figure with no picture we can show: its words stay
            self._figure = None
        elif tag in BLOCK_TAGS:
            self._flush()
            self._caption = False
            if tag == "blockquote":
                self._quote = max(0, self._quote - 1)
            self._kind = "q" if self._quote else "p"
        elif tag in ("b", "strong"):
            self._bold = False

    _bold = False

    def handle_data(self, data: str) -> None:
        if self._skip:
            return
        if self._note is not None:
            self._note[2].append(data)
        elif self._table is not None:
            if self._table["cell"] is not None:
                self._table["cell"].append(data)
        elif not self._svg:
            self._text.append(data)
            if self._bold:
                self._bold_chars += len(data.strip())

    def close(self) -> None:
        super().close()
        self._flush()


def _parse(xhtml: str) -> _Blocks:
    parser = _Blocks()
    parser.feed(xhtml)
    parser.close()
    return parser


def parse_blocks(xhtml: str) -> list[dict[str, Any]]:
    return _parse(xhtml).blocks


def image_size(data: bytes) -> tuple[int, int] | None:
    """Width and height of a PNG, GIF, JPEG or WebP from its first bytes, or
    None when it is none of these."""
    if data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) >= 24:
        return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")
    if data[:6] in (b"GIF87a", b"GIF89a") and len(data) >= 10:
        return int.from_bytes(data[6:8], "little"), int.from_bytes(data[8:10], "little")
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP" and len(data) >= 30:
        kind = data[12:16]
        if kind == b"VP8X":
            return int.from_bytes(data[24:27], "little") + 1, int.from_bytes(
                data[27:30], "little"
            ) + 1
        if kind == b"VP8 ":
            return int.from_bytes(data[26:28], "little") & 0x3FFF, int.from_bytes(
                data[28:30], "little"
            ) & 0x3FFF
        if kind == b"VP8L":
            bits = int.from_bytes(data[21:25], "little")
            return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    if data[:2] == b"\xff\xd8":
        i = 2
        while i + 9 < len(data):
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i + 1]
            if marker in (
                0xC0,
                0xC1,
                0xC2,
                0xC3,
                0xC5,
                0xC6,
                0xC7,
                0xC9,
                0xCA,
                0xCB,
                0xCD,
                0xCE,
                0xCF,
            ):  # the frame headers carry the size
                return int.from_bytes(data[i + 7 : i + 9], "big"), int.from_bytes(
                    data[i + 5 : i + 7], "big"
                )
            if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
                i += 2
            else:
                i += 2 + int.from_bytes(data[i + 2 : i + 4], "big")
    return None


def slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:60].strip("-") or "book"


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def read_epub(path: Path) -> dict[str, Any]:
    """Returns {title, author, cover: (name, bytes) | None, chapters: [{title, blocks}]}."""
    with zipfile.ZipFile(path) as z:
        container = ET.fromstring(z.read("META-INF/container.xml"))
        opf_path = next(
            e.get("full-path", "") for e in container.iter() if _local(e.tag) == "rootfile"
        )
        opf = ET.fromstring(z.read(opf_path))
        base = posixpath.dirname(opf_path)
        meta = {
            _local(e.tag): (e.text or "").strip()
            for e in opf.iter()
            if _local(e.tag) in ("title", "creator") and e.text
        }
        items = {e.get("id"): e for e in opf.iter() if _local(e.tag) == "item"}
        spine = [e.get("idref") for e in opf.iter() if _local(e.tag) == "itemref"]

        cover_id = next(
            (
                e.get("content")
                for e in opf.iter()
                if _local(e.tag) == "meta" and e.get("name") == "cover"
            ),
            None,
        )
        cover_item = items.get(cover_id) or next(
            (i for i in items.values() if "cover-image" in (i.get("properties") or "")), None
        )
        cover = None
        if cover_item is not None and (cover_item.get("media-type") or "").startswith("image/"):
            name = posixpath.normpath(posixpath.join(base, cover_item.get("href") or ""))
            if name in z.namelist():
                cover = (posixpath.basename(name), z.read(name))

        htmls = list(
            dict.fromkeys(
                posixpath.normpath(posixpath.join(base, (items[i].get("href") or "").split("#")[0]))
                for i in spine
                if i in items and "html" in (items[i].get("media-type") or "")
            )
        )
        if any(
            _local(e.tag) == "meta"
            and e.get("property") == "rendition:layout"
            and (e.text or "").strip() == "pre-paginated"
            for e in opf.iter()
        ):
            # a fixed-layout book: every spine file is one page, and the page is a picture
            from . import formats

            pages: list[tuple[str, bytes, int, int, str]] = []
            spent = 0
            for name in htmls:
                parsed = _parse(z.read(name).decode("utf-8", "replace"))
                src = next((b["src"] for b in parsed.blocks if b["k"] == "f"), None)
                src = src and posixpath.normpath(
                    posixpath.join(posixpath.dirname(name), unquote(src.split("#")[0]))
                )
                data = (
                    z.read(src)
                    if src in z.namelist() and z.getinfo(src).file_size <= MAX_PICTURE
                    else b""
                )
                spent += len(data)
                if (
                    spent > MAX_UNPACKED
                ):  # many pages may name one large picture: what counts is what would be written
                    raise ValueError(
                        "This book's pages come to more than 1 GB,"
                        " which is too large for East Room."
                    )
                size = image_size(data)
                if size and min(size) >= 300:
                    pages.append(
                        (
                            PICTURE_TYPES[data[:2]],
                            data,
                            *size,
                            " ".join(b["t"] for b in parsed.blocks if b["k"] != "f" and b["t"]),
                        )
                    )
            if pages and len(pages) >= len(htmls) * 0.8:
                rtl = any(
                    _local(e.tag) == "spine" and e.get("page-progression-direction") == "rtl"
                    for e in opf.iter()
                )
                book = formats.paged(meta.get("title") or path.stem, _author(opf), pages, rtl=rtl)
                return {**book, "cover": cover or book["cover"]}
        docs: list[list[dict[str, Any]]] = []
        read: set[str] = set()
        notes: dict[str, str] = {}
        pictures: dict[str, bytes] = {}
        seen: dict[str, tuple[str, int, int] | None] = {}
        own = hashlib.sha256(cover[1]).hexdigest() if cover else None
        for idref in spine:
            item = items.get(idref)
            if item is None or "html" not in (item.get("media-type") or ""):
                continue
            name = posixpath.normpath(posixpath.join(base, (item.get("href") or "").split("#")[0]))
            if name in read:
                # a document is read once: a spine that repeats one
                # must not multiply the book past the size limit
                continue
            read.add(name)
            parsed = _parse(z.read(name).decode("utf-8", "replace"))
            here = posixpath.dirname(name)
            notes.update({f"{name}#{key}": text for key, text in parsed.notes.items()})
            blocks: list[dict[str, Any]] = []
            for b in parsed.blocks:
                if "refs" in b:  # "notes.xhtml#n3" or "#n3", as an address inside the book
                    b["refs"] = [
                        posixpath.normpath(posixpath.join(here, unquote(d))) + "#" + key
                        if d
                        else f"{name}#{key}"
                        for d, key in (r.split("#", 1) for r in b["refs"])
                    ]
                if b["k"] == "f":
                    src = posixpath.normpath(
                        posixpath.join(here, unquote(b.pop("src").split("#")[0]))
                    )
                    if src not in seen:
                        seen[src] = None
                        data = (
                            z.read(src)
                            if src in z.namelist() and z.getinfo(src).file_size <= MAX_PICTURE
                            else b""
                        )
                        size = image_size(data)
                        if (
                            size
                            and min(size) >= MIN_PICTURE
                            and hashlib.sha256(data).hexdigest() != own
                        ):  # the cover is shown as the cover
                            picture = f"pictures/p{len(pictures) + 1:04d}{PICTURE_TYPES[data[:2]]}"
                            seen[src] = (picture, *size)
                            pictures[picture] = data
                    shown = seen[src]
                    if shown is None:
                        continue
                    b["src"], b["w"], b["h"] = shown
                blocks.append(b)
            docs.append(blocks)
    for blocks in docs:
        for b in blocks:
            found = [notes[r] for r in b.pop("refs", []) if r in notes]
            if found:
                b["n"] = found
    chapters = chapters_of(docs)
    used = {
        b["src"] for ch in chapters for b in ch["blocks"] if b["k"] == "f"
    }  # a picture on a page that was left out (a title page, a colophon) is left out too
    return {
        "title": meta.get("title") or path.stem,
        "author": _author(opf),
        "cover": cover,
        "chapters": chapters,
        "pictures": {name: data for name, data in pictures.items() if name in used},
    }


def _author(opf: ET.Element) -> str:
    """The first creator as a plain name. Catalogue forms like "Sunzi, active 6th century
    B.C." lose the catalogue part."""
    creator = next((e for e in opf.iter() if _local(e.tag) == "creator" and e.text), None)
    if creator is None:
        return ""
    filed = next(
        (
            e.text
            for e in opf.iter()
            if _local(e.tag) == "meta"
            and e.get("property") == "file-as"
            and e.get("refines") == "#" + (creator.get("id") or "")
            and e.text
        ),
        None,
    )
    if not filed:
        return (creator.text or "").strip()
    parts = [p.strip() for p in filed.split(",") if p.strip() and not re.search(r"\d", p)]
    if len(parts) == 2 and " of " not in parts[1]:
        return f"{parts[1]} {parts[0]}"  # "Austen, Jane"
    return parts[0] if parts else (creator.text or "").strip()


def _without_distributor_text(docs: list[list[dict[str, Any]]]) -> list[list[dict[str, Any]]]:
    """Project Gutenberg wraps a book in its own header and licence, marked by ***
    START OF and *** END OF lines."""

    def mark(blocks: list[dict[str, Any]], which: str) -> int | None:
        return next(
            (
                i
                for i, b in enumerate(blocks)
                if (m := GUTENBERG_MARK.match(b["t"])) and m[1].upper() == which
            ),
            None,
        )

    kept: list[list[dict[str, Any]]] = []
    for blocks in docs:
        if (start := mark(blocks, "START")) is not None:
            blocks = blocks[start + 1 :]
        if (end := mark(blocks, "END")) is not None:
            return [*kept, blocks[:end]]
        kept.append(blocks)
    return kept


def chapters_of(docs: list[list[dict[str, Any]]]) -> list[dict[str, Any]]:
    """Chapters begin where the author's chapter headings are, not where the file happens to be cut.

    The chapter level is the shallowest heading level used at least three times. A file starts a
    new chapter too, unless it has chapter headings of its own and opens mid-chapter.
    """
    docs = _without_distributor_text(docs)
    levels = [b["lv"] for blocks in docs for b in blocks if b["lv"]]
    level = next((lv for lv in sorted(set(levels)) if levels.count(lv) >= 3), 0)
    # converted books often have no heading tags at all:
    # a short unpunctuated line before a paragraph is one
    if not level:
        for blocks in docs:
            for b, after in itertools.pairwise(blocks):
                if (
                    b["k"] == "p"
                    and len(b["t"].split()) <= 8
                    and b["t"][-1] not in '.,;:!?"”’)'
                    and len(after["t"].split()) >= 25
                ):
                    b["k"] = "h"
    groups: list[list[dict[str, Any]]] = []
    for blocks in docs:
        has_own = any(b["lv"] and b["lv"] <= level for b in blocks)
        for i, b in enumerate(blocks):
            starts = (b["lv"] and b["lv"] <= level) or (i == 0 and not (has_own and groups))
            if starts or not groups:
                groups.append([])
            groups[-1].append(b)
    chapters: list[dict[str, Any]] = []
    for n, blocks in enumerate(groups):
        body = [len(b["t"].split()) for b in blocks if b["k"] not in ("h", "f", "t")]
        if (
            n < 3
            and body
            and sum(body) / len(body) < 7
            and len(body) == len(blocks) - (blocks[0]["k"] == "h")
        ):
            continue  # a list of short lines at the front is the printed contents page
        prose = sum(len(b["t"].split()) for b in blocks if b["k"] not in ("h", "f", "t"))
        shown = sum(b["k"] in ("f", "t") for b in blocks)
        # pictures make a section worth keeping when it is a section of plates
        # or has prose of its own; a title page set as one picture is neither
        words = prose + (PICTURE_WORDS * shown if shown >= 2 or prose >= MIN_BODY_WORDS else 0)
        title = blocks[0]["t"] if blocks[0]["k"] == "h" else ""
        opening = " ".join(b["t"] for b in blocks[:12])
        if (
            words < MIN_BODY_WORDS
            or CONTENTS.match(title)
            or (PUBLISHER_PAGE.match(title) and words < 600)
            or (words < MIN_CHAPTER_WORDS and not title)
            or (words < 600 and BOILERPLATE.search(opening))
        ):
            continue
        if title:
            blocks = blocks[1:]
        if (
            title.isupper()
        ):  # "THE SECOND BOOK" reads as shouting in a contents list; numerals stay as set
            title = " ".join(w if ROMAN.match(w) else w.capitalize() for w in title.split())
        chapters.append({"title": title[:120], "blocks": blocks})
    return chapters


def write_book(book: dict[str, Any], library: Path, slug: str | None = None) -> str:
    # a new book never lands in a folder that is in use:
    # it would inherit that book's place and kept lines
    if slug is None:
        base = slug = slugify(book["title"])
        n = 1
        while (library / slug).exists():
            n += 1
            slug = f"{base}-{n}"
    root = library / slug
    (root / "chapters").mkdir(parents=True, exist_ok=True)
    if not any(ch.get("audio") for ch in book["chapters"]):
        (root / "voice").mkdir(
            exist_ok=True
        )  # narration records go here; the folder also says there is no older narration to adopt
    index: dict[str, Any] = {
        "slug": slug,
        "title": book["title"],
        "author": book["author"],
        "cover": None,
        "chapters": [],
    }
    for key in ("source", "kind", "rtl", "format", "spine"):
        if book.get(key):
            index[key] = book[key]
    book_pictures: dict[str, bytes] = book.get("pictures") or {}
    for name, data in book_pictures.items():  # names are made here, never taken from the file
        (root / name).parent.mkdir(exist_ok=True)
        (root / name).write_bytes(data)
    if (
        book.get("cover") and Path(book["cover"][0]).suffix.lower() in COVER_TYPES
    ):  # a "cover" named .html or .svg could run scripts when opened
        name, data = book["cover"]
        index["cover"] = "cover" + Path(name).suffix.lower()
        (root / index["cover"]).write_bytes(data)
    for n, ch in enumerate(book["chapters"], 1):
        cid = f"c{n:03d}"
        blocks = [
            {
                "id": b.get("id") or f"b{i:04d}",
                "k": b["k"],
                "t": b["t"],
                **{k: b[k] for k in ("src", "w", "h", "alt", "rows", "n") if b.get(k)},
            }
            for i, b in enumerate(ch["blocks"], 1)
        ]
        data = {"id": cid, "title": ch["title"] or f"Section {n}", "blocks": blocks}
        for key in ("art", "gallery", "takeaways", "audio"):
            if ch.get(key):
                data[key] = ch[key]
        (root / "chapters" / f"{cid}.json").write_text(
            json.dumps(data, ensure_ascii=False), encoding="utf-8"
        )
        entry = {
            "id": cid,
            "title": data["title"],
            "words": ch.get("words") or sum(len(b["t"].split()) for b in blocks),
        }
        if pictures := sum(b["k"] == "f" for b in blocks):
            entry["pictures"] = pictures
        index["chapters"].append(entry)
    index["art"] = next(
        (c["art"]["src"] for c in book["chapters"] if c.get("art")), None
    )  # stands in for a missing cover
    (root / "book.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    return slug


def _refuse_unreadable(path: Path) -> None:
    with zipfile.ZipFile(path) as z:
        if sum(info.file_size for info in z.infolist()) > MAX_UNPACKED:
            raise ValueError(
                "This file unpacks to more than 1 GB, which is too large to be a book."
            )
        if "META-INF/encryption.xml" in z.namelist():
            methods = [
                e.get("Algorithm")
                for e in ET.fromstring(z.read("META-INF/encryption.xml")).iter()
                if _local(e.tag) == "EncryptionMethod"
            ]
            if any(method not in FONT_OBFUSCATION for method in methods):
                raise ValueError(LOCKED)


FORMATS = {
    ".epub": "epub",
    ".pdf": "pdf",
    ".cbz": "cbz",
    ".zip": "cbz",
    ".txt": "text",
    ".md": "text",
    ".markdown": "text",
}
NO_TEXT = (
    "no readable chapters found. If this is a scan, it has pictures of pages and no text;"
    " East Room cannot read those yet."
)


def read_file(path: Path, kind: str) -> dict[str, Any]:
    """The book in `path`, whatever its format. Formats other than EPUB live in their own modules
    and are loaded when first needed."""
    if kind == "epub":
        _refuse_unreadable(path)
        return read_epub(path)
    from . import formats

    return formats.READERS[kind](path)


def original_of(root: Path) -> Path | None:
    return next((p for p in sorted(root.glob("original.*")) if p.suffix in FORMATS), None)


def ingest(path: Path, library: Path, name: str | None = None) -> str:
    """Adds the book and returns its folder name. `name` is the file's own name
    when `path` is a temporary upload."""
    suffix = Path(name or path.name).suffix.lower()
    if suffix not in FORMATS:
        raise ValueError(
            f"{name or path.name}: East Room reads EPUB, PDF, CBZ and plain text files."
        )
    source = hashlib.sha256(path.read_bytes()).hexdigest()
    slug = None
    for index in library.glob("*/book.json"):
        known = json.loads(index.read_text(encoding="utf-8"))
        if known.get("source") == source:
            if not known.get("removed"):
                if not original_of(index.parent):
                    shutil.copyfile(
                        path, index.parent / f"original{suffix}"
                    )  # a book added before originals were kept gets its file now
                return known[
                    "slug"
                ]  # the same file again: the book is already here, with its place and kept lines
            # a removed book comes back into its own folder, where its place and kept lines waited
            slug = known["slug"]
    book = read_file(path, FORMATS[suffix])
    if not book["chapters"]:
        raise ValueError(f"{name or path.name}: {NO_TEXT}")
    # a file without a title is named after itself, not after the temporary
    # copy it arrived in: "the-voyage_out" reads "The Voyage Out"
    if book["title"] == path.stem:
        stem = re.sub(r"[_-]+", " ", Path(name or path.name).stem).strip()
        book["title"] = stem.title() if stem.islower() else stem
    book["source"], book["format"] = source, FORMATS[suffix]
    slug = write_book(book, library, slug)
    shutil.copyfile(path, library / slug / f"original{suffix}")
    return slug


def reread(library: Path, slug: str) -> int:
    """Reads the kept original again with today's reader, into the same
    folder. Returns the number of parts.

    What later steps wrote into the index stays. Parts the new reading no longer has are removed.
    Place and kept lines are not touched: they carry their own words, so
    the reader can find them again.
    """
    root = library / slug
    original = original_of(root)
    if original is None:
        raise ValueError(
            "This book was added before originals were kept."
            " Add its file again and East Room will keep it."
        )
    old = json.loads((root / "book.json").read_text(encoding="utf-8"))
    book = read_file(original, FORMATS[original.suffix])
    if not book["chapters"]:
        raise ValueError(NO_TEXT)
    book.update({key: old[key] for key in ("source", "spine") if old.get(key)})
    book["title"], book["author"], book["format"] = (
        old["title"],
        old["author"],
        FORMATS[original.suffix],
    )  # the owner may have corrected them
    shutil.rmtree(root / "pictures", ignore_errors=True)
    write_book(book, library, slug)
    for stale in sorted((root / "chapters").glob("c*.json"))[len(book["chapters"]) :]:
        stale.unlink()
    return len(book["chapters"])
