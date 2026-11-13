"""The local server: a library of books on disk, the reader's static files,
and each device's reading record.

Binds to 127.0.0.1 only. Nothing leaves the machine: no accounts, no telemetry, no outside requests.
Other devices of the same owner reach it through a private network that forwards
to this address (docs/setup.md).
"""

from __future__ import annotations

import json
import mimetypes
import os
import re
import shutil
import tempfile
import threading
import time
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, BinaryIO
from urllib.parse import parse_qs, unquote, urlparse
from xml.etree import ElementTree as ET

from . import engines, home, ingest, voice, work
from .files import patient
from .jsontypes import is_object

mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type(
    "audio/mp4", ".m4a"
)  # the standard library says audio/mp4a-latm, which some browsers will not play
WEB = Path(__file__).parent / "web"
SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{0,80}$")
DEVICE = re.compile(r"^[a-z0-9]{4,16}$")
VOICE = re.compile(r"^[a-z0-9][a-z0-9-]{0,31}$")
MAX_UPLOAD = 300 * 1024 * 1024
MAX_RECORD = 2 * 1024 * 1024
CLOCK_SLACK_MS = 60_000
LOCAL_ORIGIN = re.compile(r"^https?://(127\.0\.0\.1|localhost)(:\d+)?$")
UNREADABLE = (
    "This file could not be read. East Room reads EPUB, PDF, CBZ and text files;"
    " one with copy protection (DRM) cannot be opened."
)
_write_lock = threading.Lock()


def media_root(book: Path) -> Path:
    """Where a book's pictures and audio live: beside it, or in the folder
    named by its `media` pointer file."""
    pointer = book / "media"
    return Path(pointer.read_text(encoding="utf-8").strip()) if pointer.is_file() else book


def list_library(library: Path, removed: bool = False) -> list[dict[str, Any]]:
    """Every book with its chapters. Each chapter carries a stamp (`v`) and the stamps of
    its narration records (`voices`).

    A book the owner removed is left out, unless `removed` asks for those too: its kept
    lines still belong to the owner.
    """
    books: list[dict[str, Any]] = []
    for index in sorted(library.glob("*/book.json")):
        book = json.loads(index.read_text(encoding="utf-8"))
        root = index.parent
        if book.get("removed"):
            if removed:
                books.append(
                    {
                        "slug": book["slug"],
                        "title": book["title"],
                        "author": book.get("author") or "",
                        "removed": True,
                        "chapters": book["chapters"],
                    }
                )
            continue
        with os.scandir(root / "chapters") as entries:
            stamps = {
                entry.name[:-5]: voice.stamp(entry.stat())
                for entry in entries
                if entry.name.endswith(".json")
            }
        narrated = voice.voices(root)
        for chapter in book["chapters"]:
            chapter["v"] = stamps.get(chapter["id"], "")
            if chapter["id"] in narrated:
                chapter["voices"] = narrated[chapter["id"]]
        if not book.get("cover") and (media_root(root) / "cover.jpg").is_file():
            book["cover"] = "cover.jpg"  # an adopted book keeps its cover with its other pictures
        book["worlds"] = (root / "worlds.json").is_file()
        book["depth"] = (
            bool(book.get("cover"))
            and (media_root(root) / Path(book["cover"]).with_suffix(".depth.preview.png")).is_file()
        )
        book["added"] = index.stat().st_mtime
        books.append(book)
    return books


def read_records(book: Path) -> dict[str, Any]:
    """Every device's record for one book. The single state file of older versions is
    passed on as the device "before"."""
    paths = {"before": book / "state.json"}
    if (book / "state").is_dir():
        paths.update({path.stem: path for path in sorted((book / "state").glob("*.json"))})
    records: dict[str, Any] = {}
    for device, path in paths.items():
        try:
            records[device] = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue  # a missing or damaged record must not hide the others
    return records


def _hold_back_the_future(record: dict[str, Any], now: float) -> None:
    """A device whose clock runs ahead would win every "newest" for ever:
    stamps from the future become now."""
    entries: list[Any] = [record.get("place")]
    for key in ("kept", "done"):
        if isinstance(record.get(key), dict):
            entries += record[key].values()
    for entry in entries:
        if (
            is_object(entry)
            and isinstance(entry.get("t"), (int, float))
            and entry["t"] > now + CLOCK_SLACK_MS
        ):
            entry["t"] = now


class Server(ThreadingHTTPServer):
    workshop: work.Workshop
    # Windows lets a second program take a port that is in use when this is on: a second East Room
    # would start beside the first instead of finding it
    allow_reuse_address = os.name != "nt"


class Handler(BaseHTTPRequestHandler):
    server: Server  # pyright: ignore[reportIncompatibleVariableOverride] only serve() starts it
    library: Path
    workshop: work.Workshop
    origins: frozenset[str] = frozenset()
    server_version = "EastRoom"

    # the terminal stays quiet; errors go to the browser
    def log_message(self, format: str, *args: Any) -> None:
        pass

    def _json(self, obj: Any, code: int = 200) -> None:
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _file(self, path: Path, root: Path, lasting: bool = False, v: str | None = None) -> None:
        """`lasting`: the address may be kept for good. `v`: the stamp the address carries, which
        must be the file's own for that."""
        try:
            path = path.resolve()
            path.relative_to(root.resolve())
            # opened once: the size and the bytes come from
            # the same file even if it is replaced meanwhile
            f = patient(lambda: path.open("rb"))
        except (ValueError, OSError):
            return self._json({"error": "not found"}, 404)
        with f:
            self._send(
                f,
                path,
                root,
                lasting if v is None else v == voice.stamp(os.fstat(f.fileno())),
                stale=v is not None,
            )

    def _send(self, f: BinaryIO, path: Path, root: Path, lasting: bool, stale: bool) -> None:
        size = os.fstat(f.fileno()).st_size
        start, end = 0, size - 1
        rng = re.fullmatch(r"bytes=(\d*)-(\d*)", self.headers.get("Range", ""))
        if rng and (rng[1] or rng[2]):  # browsers need byte ranges to seek inside audio
            start = int(rng[1]) if rng[1] else max(0, size - int(rng[2]))
            end = min(int(rng[2]), size - 1) if rng[1] and rng[2] else size - 1
            if start > end:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        else:
            self.send_response(200)
        self.send_header(
            "Content-Type", mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        )
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Accept-Ranges", "bytes")
        # an address that carries the file's stamp never changes its content, so a device may
        # keep it for good; an address with an older stamp gets today's bytes and must not be
        # kept under yesterday's name
        self.send_header(
            "Cache-Control",
            "public, max-age=31536000, immutable"
            if lasting
            else "no-store"
            if stale
            else "no-cache",
        )
        if root != WEB:  # books come from outside: nothing in them may run as a page of this app
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "sandbox")
        self.end_headers()
        f.seek(start)
        remaining = end - start + 1
        while remaining > 0:
            chunk = f.read(min(1 << 16, remaining))
            if not chunk:
                break
            try:
                self.wfile.write(chunk)
            except (BrokenPipeError, ConnectionResetError):
                return
            remaining -= len(chunk)

    def _named(self) -> bool:
        """Home answers only when it is asked for by its own name. A page elsewhere that points a
        made-up name at this computer is refused."""
        port, host = self.server.server_port, (self.headers.get("Host") or "").lower()
        if host in (f"127.0.0.1:{port}", f"localhost:{port}", f"[::1]:{port}") or host in {
            urlparse(o).netloc.lower() for o in self.origins
        }:
            return True
        self._json({"error": "Home was asked for by a name it does not know."}, 403)
        return False

    def _book(self, slug: str) -> Path | None:
        book = self.library / slug
        return book if SLUG.fullmatch(slug) and (book / "book.json").is_file() else None

    def do_GET(self) -> None:
        if not self._named():
            return
        url = urlparse(self.path)
        parts = [unquote(p) for p in url.path.split("/") if p]
        v = parse_qs(url.query).get("v", [None])[0]
        lasting = v is not None
        if parts == ["api", "library"]:
            return self._json(list_library(self.library, removed="all" in parse_qs(url.query)))
        if parts == ["api", "queue"]:
            return self._json(self.workshop.listing())
        if parts == ["api", "work"]:
            free = shutil.disk_usage(self.library).free
            return self._json(
                {
                    "queue": self.workshop.listing(),
                    "books": work.overview(self.library),
                    "held": work.held(self.library),
                    "free": free,
                    "steps": {name: label for name, (_, label) in work.STEPS.items()},
                    "hold_days": work.HOLD_DAYS,
                }
            )
        if parts == ["api", "settings"]:
            return self._json(work.settings(self.library))
        if parts == ["api", "engines"]:
            return self._json(
                {**home.engines(self.library, self.workshop), "reach": sorted(self.origins)}
            )  # the addresses other devices open
        if parts == ["api", "state"]:
            every = {
                index.parent.name: read_records(index.parent)
                for index in sorted(self.library.glob("*/book.json"))
            }
            return self._json({slug: records for slug, records in every.items() if records})
        if parts[:2] == ["api", "state"] and len(parts) == 3 and (book := self._book(parts[2])):
            return self._json(read_records(book))
        if parts[:2] == ["api", "book"] and len(parts) == 4 and (book := self._book(parts[2])):
            if parts[3] == "worlds":
                return self._file(book / "worlds.json", book)
            if re.fullmatch(r"c\d{3}", parts[3]):
                return self._file(book / "chapters" / f"{parts[3]}.json", book, v=v)
        if (
            parts[:2] == ["api", "voice"]
            and len(parts) == 5
            and (book := self._book(parts[2]))
            and VOICE.fullmatch(parts[3])
            and re.fullmatch(r"c\d{3}", parts[4])
        ):
            return self._file(book / "voice" / parts[3] / f"{parts[4]}.json", book, v=v)
        if parts[:1] == ["media"] and len(parts) >= 3 and (book := self._book(parts[1])):
            own = (
                parts[2].startswith("cover.") and (book / parts[2]).is_file()
            )  # an imported book's cover sits beside its book.json
            root = book if own else media_root(book)
            return self._file(root.joinpath(*parts[2:]), root, lasting)
        return self._file(WEB.joinpath(*parts) if parts else WEB / "index.html", WEB)

    def _body(self, limit: int = MAX_UPLOAD) -> bytes | None:
        origin = self.headers.get("Origin")
        local = LOCAL_ORIGIN.match(origin or "")
        own = local and (local.group(2) or ":80")[1:] == str(
            self.server.server_port
        )  # this Home's own page, not another program on this computer
        if origin and not own and origin not in self.origins:
            self._json(
                {"error": "requests from other sites are refused", "origin": origin}, 403
            )  # another page must not write to the library
            return None
        length = int(self.headers.get("Content-Length") or 0)
        if not 0 < length <= limit:
            self._json({"error": f"empty or too large (limit {limit // (1024 * 1024)} MB)"}, 413)
            return None
        return self.rfile.read(length)

    def do_PUT(self) -> None:
        if not self._named():
            return
        parts = [p for p in urlparse(self.path).path.split("/") if p]
        if (
            parts[:2] == ["api", "state"]
            and len(parts) == 4
            and (book := self._book(parts[2]))
            and DEVICE.fullmatch(parts[3])
        ):
            if (body := self._body(MAX_RECORD)) is None:
                return
            try:
                record = json.loads(body)
            except ValueError:
                record = None
            if not is_object(record):
                return self._json({"error": "a record must be a JSON object"}, 400)
            now = time.time() * 1000
            _hold_back_the_future(record, now)
            record["seen"] = now
            with (
                _write_lock
            ):  # write to a temporary file first so a crash never leaves half a record
                (book / "state").mkdir(exist_ok=True)
                path = book / "state" / f"{parts[3]}.json"
                try:
                    stored = json.loads(path.read_text(encoding="utf-8")).get("rev")
                except (OSError, ValueError, AttributeError):
                    stored = None
                rev = record.get("rev")
                # two saves from one device can arrive out of
                # order: the older one must not undo the newer
                late = (
                    isinstance(stored, (int, float))
                    and isinstance(rev, (int, float))
                    and rev < stored
                )
                if not late:
                    tmp = path.with_suffix(".tmp")
                    tmp.write_text(json.dumps(record, ensure_ascii=False), encoding="utf-8")
                    patient(tmp.replace, path)
            return self._json({"ok": True, "seen": now, "late": late})
        if parts == ["api", "settings"]:
            if (sent := self._sent(MAX_RECORD)) is None:
                return
            saved = work.save_settings(self.library, sent)
            self.workshop.wake.set()  # a voice to follow may have been chosen or dropped
            return self._json(saved)
        if parts[:2] == ["api", "book"] and len(parts) == 3 and (book := self._book(parts[2])):
            if (sent := self._sent(MAX_RECORD)) is None:
                return
            with _write_lock:
                index = json.loads((book / "book.json").read_text(encoding="utf-8"))
                for key in ("title", "author"):
                    if isinstance(sent.get(key), str) and (sent[key].strip() or key == "author"):
                        index[key] = " ".join(sent[key].split())[:300]
                tmp = book / "book.tmp"
                tmp.write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
                tmp.replace(book / "book.json")
            return self._json({"ok": True, "title": index["title"], "author": index["author"]})
        self._json({"error": "not found"}, 404)

    def _sent(self, limit: int = MAX_RECORD) -> dict[str, Any] | None:
        """A JSON object sent by one of the owner's own pages, or None when
        it was refused (and answered)."""
        if (body := self._body(limit)) is None:
            return None
        try:
            sent = json.loads(body)
        except ValueError:
            sent = None
        if not is_object(sent):
            self._json({"error": "a JSON object is expected"}, 400)
            return None
        return sent

    def _act(self, path: str) -> None:
        """What the owner asks of the workshop. Every answer is plain words the screen can show."""
        if (sent := self._sent()) is None:
            return

        def text(key: str) -> str:
            value = sent.get(key)
            return value if isinstance(value, str) else ""

        book = text("book")
        every = book == "*" and path == "/api/work"  # only the workshop takes every book at once
        if book and not every and not self._book(book):
            return self._json({"error": "That book is not in the library."}, 404)
        try:
            if path == "/api/work" and book == "*":
                out = {"added": self.workshop.add_all(text("step"), text("arg"))}
            elif path == "/api/work":
                out = self.workshop.add(book, text("step"), text("arg"))
            elif path == "/api/work/cancel":
                out = {"ok": self.workshop.cancel(text("id"))}
            elif path == "/api/remove" and book:
                with _write_lock:
                    out = work.remove(self.library, book, text("what"), sent.get("forget") is True)
            elif path == "/api/restore":
                with _write_lock:
                    out = work.restore(self.library, text("id"))
            elif path == "/api/purge" and text("id"):
                out = {"gone": work.purge(self.library, text("id"))}
            elif path == "/api/engines/key":
                api = next(
                    (a for a in work.settings(self.library)["apis"] if a["id"] == text("id")), None
                )
                if not api:
                    raise ValueError("That server is not in the settings.")
                engines.set_key(self.library, api, text("key"))
                out = {"ok": True}
            elif path == "/api/engines/try":
                out = engines.try_out(
                    self.library, work.settings(self.library), text("engine"), text("model")[:300]
                )
            elif path == "/api/login":
                out = home.at_login(
                    sent.get("on") is True,
                    self.library,
                    self.server.server_port,
                    sorted(self.origins),
                )
            else:
                return self._json({"error": "not found"}, 404)
        except (ValueError, RuntimeError, OSError) as err:
            return self._json({"error": str(err)}, 400)
        self._json(out)

    def do_POST(self) -> None:
        if not self._named():
            return
        url = urlparse(self.path)
        if url.path != "/api/import":
            return self._act(url.path)
        if (body := self._body()) is None:
            return
        name = (
            Path(parse_qs(url.query).get("name", [""])[0]).name or None
        )  # the file's own name, without any folders
        # a folder, not an open temporary file: Windows will not open one of those a second time
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as folder:
            suffix = Path(name or "").suffix.lower()
            # only a known suffix names the file on disk:
            # a sent one can be too long or hold a zero byte
            tmp = Path(folder) / ("book" + (suffix if suffix in ingest.FORMATS else ".epub"))
            tmp.write_bytes(body)
            try:
                with _write_lock:
                    had = {index.parent.name for index in self.library.glob("*/book.json")}
                    slug = ingest.ingest(tmp, self.library, name)
            except ValueError as err:  # ingest explains what it could not find
                return self._json({"error": str(err)}, 400)
            except (
                RuntimeError
            ) as err:  # a format whose reader is an optional extra that is not installed
                return self._json({"error": str(err)}, 400)
            except (KeyError, OSError, zipfile.BadZipFile, ET.ParseError, StopIteration):
                return self._json({"error": UNREADABLE}, 400)
        if slug not in had:
            self.workshop.auto(slug)
        self._json({"slug": slug, "known": slug in had})


def serve(library: Path, port: int, origins: tuple[str, ...] = ()) -> Server:
    """`origins` are the exact outside addresses (scheme, name, port) whose pages may write,
    such as the private HTTPS name."""
    library.mkdir(parents=True, exist_ok=True)
    for index in library.glob("*/book.json"):
        voice.adopt_embedded(index.parent)
    workshop = work.Workshop(library)
    handler = type(
        "LibraryHandler",
        (Handler,),
        {
            "library": library,
            "workshop": workshop,
            "origins": frozenset(o.rstrip("/") for o in origins),
        },
    )
    server = Server(("127.0.0.1", port), handler)
    server.workshop = workshop
    return server
