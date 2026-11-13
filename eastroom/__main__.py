"""eastroom [book.epub ...]: add the given books to your library and
open the reader in the browser."""

from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
import webbrowser
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from . import export, ingest, library, voice


def running(port: int) -> bool:
    """Whether the program already listening on this port is East Room itself."""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/library", timeout=2) as answer:
            return isinstance(json.load(answer), list)
    except (OSError, ValueError):
        return False


def shelf(port: int) -> Path:
    """Where the books are kept when no place is named. A library from when the app was called
    Devour is taken over under the new name, once. It stays where it is while a Home from before
    still serves it, or when it cannot be moved."""
    here, before = Path.home() / ".eastroom", Path.home() / ".devour"
    if here.exists() or not before.is_dir():
        return here
    if running(port):
        return before
    try:
        before.rename(here)
    except OSError:
        return before
    return here


def free(port: int) -> bool:
    """Whether nothing is listening on this port, asked the way the server itself will ask."""
    with socket.socket() as probe:
        if os.name != "nt":  # as in library.Server: a port just let go may be taken again at once
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


def narrate(root: Path, name: str, only: str | None = None) -> int:
    """Narrates what the owner is reading, the most recent book first, from the reading
    place on. Looks again each minute.

    With `only`, narrates every part of that one book and then ends.
    """
    from . import narrators  # their packages are optional extras

    try:
        speak = narrators.storyteller(root) if name == "storyteller" else narrators.plain()
    except RuntimeError as err:
        print(f"eastroom: {err}", file=sys.stderr)
        return 2
    if sys.platform == "darwin":  # the machine must not idle-sleep in the middle of a book
        subprocess.Popen(["caffeinate", "-i", "-w", str(os.getpid())])
    for index in root.glob("*/book.json"):
        voice.adopt_embedded(index.parent)
    print(f"Narrating in the {name} voice. Ctrl+C stops it; what is finished stays.")
    try:
        while True:
            for index in root.glob(
                "*/book.json"
            ):  # a chapter whose text changed loses its narration before the queue is read
                voice.drop_stale(index.parent, library.media_root(index.parent))
            records = {
                index.parent.name: library.read_records(index.parent)
                for index in root.glob("*/book.json")
            }
            books = [
                b for b in library.list_library(root) if b.get("kind") != "pages"
            ]  # a book of pictures has no words to speak
            if only:
                one = next((b for b in books if b["slug"] == only), None)
                queue = (
                    [(only, c) for c in voice.whole_book(one, records.get(only, {}), name)]
                    if one
                    else []
                )
                if not queue:
                    return 0
            else:
                queue = voice.wanted(books, records, name)
            if not queue:
                time.sleep(60)
                continue
            slug, chapter = queue[0]  # one chapter, then look again: the reader may have moved on
            started = time.time()
            seconds = voice.narrate(
                root / slug, library.media_root(root / slug), chapter, name, speak
            )
            took = time.time() - started
            speed = seconds / max(took, 0.001)
            print(
                f"{slug} {chapter}: {seconds / 60:.1f} min of audio in {took / 60:.1f} min"
                f" ({speed:.1f}x real time), {len(queue) - 1} to go",
                flush=True,
            )
    except KeyboardInterrupt:
        print()
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="eastroom", description=__doc__)
    ap.add_argument(
        "books",
        nargs="*",
        type=Path,
        help="book files to add to the library: EPUB, PDF, CBZ, plain text or Markdown",
    )
    ap.add_argument(
        "--library",
        type=Path,
        help="where books and reading state are kept (default: ~/.eastroom)",
    )
    ap.add_argument("--port", type=int, default=4800)
    ap.add_argument("--no-open", action="store_true", help="do not open the browser")
    ap.add_argument(
        "--origin",
        action="append",
        default=[],
        metavar="URL",
        help="an outside address whose pages may save to this library,"
        " such as https://name.tailnet.ts.net:8443 (see docs/setup.md)",
    )
    ap.add_argument(
        "--voice",
        choices=["plain", "storyteller"],
        metavar="NAME",
        help="make narration instead of serving: 'plain' (any computer)"
        " or 'storyteller' (Apple chips). Follows what is being read",
    )
    ap.add_argument(
        "--book",
        metavar="NAME",
        help="with --voice: narrate every part of this one book (its folder name), then stop",
    )
    ap.add_argument(
        "--export",
        type=Path,
        metavar="DIR",
        help="write the library as a static site that needs no server, then exit",
    )
    args = ap.parse_args(argv)

    args.library = args.library or shelf(args.port)
    args.library.mkdir(parents=True, exist_ok=True)
    added: list[str] = []
    for path in args.books:
        if not path.is_file():
            print(
                f"eastroom: {path} does not exist. Check the path and try again.", file=sys.stderr
            )
            return 2
        try:
            added.append(ingest.ingest(path, args.library))
            print(f"Added {added[-1]}")
        except (
            ValueError,
            KeyError,
            OSError,
            zipfile.BadZipFile,
            ET.ParseError,
            StopIteration,
        ) as err:
            print(f"eastroom: could not read {path.name}: {err}", file=sys.stderr)
            return 2
    if args.voice:
        return narrate(args.library, args.voice, args.book)
    if args.export:
        count = export.export_site(args.library, args.export)
        print(f"Wrote {count} books to {args.export}. Serve that folder with any static host.")
        return 0
    url = f"http://127.0.0.1:{args.port}/"
    busy = (
        f"eastroom: another program is using port {args.port}."
        f" Run again with --port {args.port + 1}."
    )
    if not free(args.port):
        # opened a second time, from its icon for example: show the one that runs, and leave
        # its library to it
        if not running(args.port):
            print(busy, file=sys.stderr)
            return 2
        print(f"East Room is already running at {url}")
        if not args.no_open:
            webbrowser.open(url)
        return 0
    try:
        server = library.serve(args.library, args.port, tuple(args.origin))
    except OSError:
        print(busy, file=sys.stderr)
        return 2
    for slug in added:
        server.workshop.auto(slug)  # what the owner wants done to every new book
    print(f"East Room is running at {url}  (Ctrl+C to stop)")
    if not args.no_open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print()
    finally:
        server.workshop.stop()  # a narrator started from the app ends with Home
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
