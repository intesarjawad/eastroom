"""Write a library as plain files so the reader runs from any static host, with no server.

The paths mirror the local server's read routes (api/library, api/book/<slug>/<chapter>,
api/voice/..., media/<slug>/...), so the same front end works unchanged. No reading records are
written: a published copy starts unread for every visitor, and each visitor's
record stays in their own browser.
"""

from __future__ import annotations

import json
import shutil
import tempfile
import zipfile
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from . import ingest, library, takeaways

WEB = Path(__file__).parent / "web"


def export_site(library_dir: Path, out: Path) -> int:
    """Returns the number of books written."""
    shutil.copytree(WEB, out, dirs_exist_ok=True)
    (out / ".nojekyll").touch()  # GitHub Pages must serve the files as they are
    # a published copy has no Home to read a visitor's file: their browser runs this code itself
    (out / "py").mkdir(exist_ok=True)
    with zipfile.ZipFile(out / "py" / "eastroom.zip", "w", zipfile.ZIP_DEFLATED) as package:
        for source in sorted(WEB.parent.glob("*.py")):
            package.write(source, f"eastroom/{source.name}")
    return write_books(library_dir, out)


def read_here(file: Path, out: Path, taken: Iterable[str] = ()) -> dict[str, Any]:
    """One book file, read and written into `out` at the addresses the front end asks for.
    Returns the book's entry for the library. Where there is no Home, the page runs this in
    the visitor's own browser. `taken` are the folder names already in use there."""
    with tempfile.TemporaryDirectory() as tmp:
        shelf = Path(tmp)
        for slug in taken:
            (shelf / Path(slug).name).mkdir(exist_ok=True)  # a folder in use is never given twice
        takeaways.make(shelf / ingest.ingest(file, shelf))
        write_books(shelf, out)
    return json.loads((out / "api" / "library").read_text(encoding="utf-8"))[0]


def write_books(library_dir: Path, out: Path) -> int:
    """The books alone, at the addresses the front end asks for. Returns how many."""
    books = library.list_library(library_dir)
    for book in books:
        source = library_dir / book["slug"]
        media_from, media_to = library.media_root(source), out / "media" / book["slug"]
        chapters_to = out / "api" / "book" / book["slug"]
        chapters_to.mkdir(parents=True, exist_ok=True)
        media_to.mkdir(parents=True, exist_ok=True)
        if book.get("cover"):
            cover = source / book["cover"]
            shutil.copyfile(
                cover if cover.is_file() else media_from / book["cover"], media_to / book["cover"]
            )
        if book["worlds"]:
            shutil.copyfile(source / "worlds.json", chapters_to / "worlds")
        if (media_from / "thumbs").is_dir():
            shutil.copytree(media_from / "thumbs", media_to / "thumbs", dirs_exist_ok=True)
        for entry in book["chapters"]:
            chapter_file = source / "chapters" / f"{entry['id']}.json"
            shutil.copyfile(chapter_file, chapters_to / entry["id"])
            chapter = json.loads(chapter_file.read_text(encoding="utf-8"))
            used = [chapter["art"]["src"]] if chapter.get("art") else []
            used += [picture["src"] for picture in chapter.get("gallery", [])]
            used += [block["src"] for block in chapter["blocks"] if block.get("src")]
            for name in entry.get("voices", {}):
                record_file = source / "voice" / name / f"{entry['id']}.json"
                record_to = out / "api" / "voice" / book["slug"] / name
                record_to.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(record_file, record_to / entry["id"])
                used += [
                    segment["src"]
                    for segment in json.loads(record_file.read_text(encoding="utf-8"))["audio"]
                ]
            for name in used:
                (media_to / name).parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(media_from / name, media_to / name)
    (out / "api").mkdir(parents=True, exist_ok=True)  # a library with no books is still a library
    (out / "api" / "library").write_text(json.dumps(books, ensure_ascii=False), encoding="utf-8")
    return len(books)
