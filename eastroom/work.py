"""The workshop: what can be done to a book after it is in, the queue that does it, the settings,
and the room it all takes.

    <library>/settings.json        what the owner chose
    <library>/queue.json           work that is waiting, so a restart loses nothing
    <library>/<book>/steps.json    what was done to this book, by which version, and what went wrong
    <library>/.held/<id>/          things the owner removed, kept for HOLD_DAYS before they are
                                   deleted for good

A step works in units (a part, a cover) and writes each unit when it is finished: stopping
loses at most one unit.
One step runs at a time. Voice runs in a process of its own, because its packages are
optional extras.
"""

from __future__ import annotations

import contextlib
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from . import engines, ingest, pictures, takeaways, voice
from .files import patient
from .jsontypes import is_object

HOLD_DAYS = 7
STEPS = {  # name: (version, what the owner reads)
    "read": (2, "Read the file again"),
    "takeaways": (takeaways.VERSION, "Key lines"),
    "letters": (1, "Spine lettering"),
    "pictures": (pictures.VERSION, "Pictures"),
    "voice": (1, "Recorded voice"),
}
VOICES = ("storyteller", "plain")
DEFAULTS: dict[str, Any] = {
    # what runs by itself when a book is added
    "auto": {"takeaways": True, "letters": True, "pictures": True},
    "takeaways": {
        "by": "rank"
    },  # rank: no model. model: the local text model picks among ranked lines
    "voice": {
        "follow": "",
        "python": "",
    },  # follow: the voice made ahead of what is being read ("" for none)
    "apis": [],  # the owner's servers that speak the OpenAI chat API: {"id", "name", "url"}
    "engines": {
        "eyes": {"engine": "", "model": ""},
        "words": {"engine": "", "model": ""},
    },  # who looks at covers, who reads sentences
    "storage": {
        "voice_days": 0,
        "one_voice": False,
    },  # voice_days: remove recorded voice this long after a book is finished (0: never)
}
_lock = threading.RLock()


def _write(path: Path, obj: Any) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")
    patient(tmp.replace, path)


def _read(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def _fit(new: Any, shape: Any) -> Any:
    """`new` cut to the shape of `shape`: only known names, only the same kind of value. What the
    owner's page sends is not trusted."""
    if isinstance(shape, list):
        return engines.apis(new)
    if is_object(shape):
        return {k: _fit(new[k], v) if is_object(new) and k in new else v for k, v in shape.items()}
    if isinstance(shape, bool):
        return new if isinstance(new, bool) else shape
    if isinstance(shape, int):
        return (
            max(0, min(3650, new)) if isinstance(new, int) and not isinstance(new, bool) else shape
        )
    return new[:300] if isinstance(new, str) else shape


def settings(library: Path) -> dict[str, Any]:
    return _fit(_read(library / "settings.json", {}), DEFAULTS)


def save_settings(library: Path, new: Any) -> dict[str, Any]:
    with _lock:
        now = settings(library)
        fitted = _fit(new, now)
        fitted["voice"]["python"] = now["voice"][
            "python"
        ]  # which program runs is set in settings.json by hand, never by a page
        if not is_object(new) or "apis" not in new:
            fitted["apis"] = now[
                "apis"
            ]  # a page that says nothing about the servers leaves them as they are
        for pick in fitted["engines"].values():
            if not engines.known(pick["engine"], fitted):
                pick.update(engine="", model="")
        _write(library / "settings.json", fitted)
    return fitted


def ledger(book: Path) -> dict[str, Any]:
    return _read(book / "steps.json", {})


def note(book: Path, step: str, **fields: Any) -> None:
    with _lock:
        steps = ledger(book)
        steps[step] = {"v": STEPS[step][0], "at": time.time(), **fields}
        _write(book / "steps.json", steps)


# ---------- what a book has ----------
def _size(path: Path) -> int:
    """The bytes under `path`. A step may replace a file while this looks: one that is gone
    by the time it is measured counts as nothing."""
    total = 0
    for file in [path] if path.is_file() else path.rglob("*") if path.is_dir() else []:
        with contextlib.suppress(OSError):
            total += file.stat().st_size if file.is_file() else 0
    return total


def _media(book: Path) -> Path:
    from . import library  # library imports this module

    return library.media_root(book)


def status(book: Path) -> dict[str, Any]:
    """One book as the workshop shows it: its steps, and the room each kind of thing takes."""
    index = json.loads((book / "book.json").read_text(encoding="utf-8"))
    steps, media = ledger(book), _media(book)
    parts = len(index["chapters"])
    original = ingest.original_of(book)
    narrated = voice.voices(book)
    names = sorted({name for by in narrated.values() for name in by})
    out: dict[str, Any] = {
        "slug": index["slug"],
        "title": index["title"],
        "author": index.get("author") or "",
        "parts": parts,
        "removed": bool(index.get("removed")),
        "kind": index.get("kind") or "words",
        "format": index.get("format") or "epub",
        "original": original.suffix[1:] if original else "",
        "outside": media != book,
        "spine": index.get("spine"),
        "steps": {},
        "cover": any(
            p.is_file() for p in (book / (index.get("cover") or "cover.jpg"), media / "cover.jpg")
        ),
    }
    for name, (version, _) in STEPS.items():
        entry = dict(steps.get(name) or {})
        if entry.get("state") == "done" and entry.get("v", 0) < version:
            entry["state"] = "stale"  # made by an older version of this step: it can be made better
        out["steps"][name] = entry
    out["voice"] = {name: sum(name in by for by in narrated.values()) for name in names}
    room: dict[str, Any] = {
        "original": _size(original) if original else 0,
        "text": _size(book / "chapters"),
        "pictures": _size(book / "pictures") + _size(book / "pages"),
        "voice": {
            name: _size(book / "voice" / name)
            + (_size(media / "voice" / name) if media != book else 0)
            for name in names
        },
    }
    room["total"] = sum(v for v in room.values() if isinstance(v, int)) + sum(
        room["voice"].values()
    )
    out["bytes"] = room
    return out


def overview(library: Path) -> list[dict[str, Any]]:
    return [status(index.parent) for index in sorted(library.glob("*/book.json"))]


# ---------- removing, holding, bringing back ----------
def held(library: Path) -> list[dict[str, Any]]:
    now = time.time()
    out: list[dict[str, Any]] = []
    for meta in sorted((library / ".held").glob("*/meta.json")):
        entry = _read(meta, None)
        if entry:
            entry["bytes"] = _size(meta.parent / "payload")
            entry["days_left"] = max(0, HOLD_DAYS - int((now - entry["t"]) / 86400))
            out.append(entry)
    return out


def _move(path: Path, target: Path) -> None:
    """A rename either happens or does not, so it can be tried again; only a target on another
    disk needs the copy that `shutil.move` makes."""
    try:
        patient(path.rename, target)
    except PermissionError:
        raise
    except OSError:
        shutil.move(str(path), str(target))


def remove(library: Path, slug: str, what: str, forget: bool = False) -> dict[str, Any]:
    """Moves something out of a book into the holding folder. `what`:
    "book", "original" or "voice:<name>". "pictures" takes out the pictures Home found for the
    book: they are not held, because finding them again costs nothing.

    Removing a book keeps its index, its reading records and its kept lines
    in place unless `forget` is set.
    Nothing outside the book's own folder is ever touched.
    """
    book = library / slug
    index = json.loads((book / "book.json").read_text(encoding="utf-8"))
    media = _media(book)
    if what == "pictures":
        with _lock:
            gone = pictures.clear(book, media)
            steps = ledger(book)
            if steps.pop("pictures", None):
                _write(book / "steps.json", steps)
        if not gone:
            raise ValueError("Home found no pictures for this book.")
        return {"slug": slug, "title": index["title"], "what": what, "gone": gone}
    if what == "book":
        moves = [
            p
            for p in book.iterdir()
            if forget or p.name not in ("book.json", "state", "state.json", "steps.json")
        ]
    elif what == "original":
        moves = list(book.glob("original.*"))
    elif (
        what.startswith("voice:")
        and what[6:] in voice.voices_of(book)
        and what[6:] != voice.ADOPTED
    ):
        if media != book:
            raise ValueError(
                "This book's sound lives outside the library, so East Room leaves it alone."
            )
        moves = [book / "voice" / what[6:]]  # records and their audio share this folder
    else:
        raise ValueError("Nothing by that name can be removed.")
    if not moves:
        raise ValueError("There is nothing of that kind in this book.")
    entry: dict[str, Any] = {
        "id": uuid.uuid4().hex[:12],
        "slug": slug,
        "title": index["title"],
        "what": what,
        "forget": forget,
        "t": time.time(),
    }
    with _lock:
        payload = library / ".held" / entry["id"] / "payload"
        payload.mkdir(parents=True)
        for path in moves:
            target = payload / path.relative_to(book)
            target.parent.mkdir(parents=True, exist_ok=True)
            _move(path, target)
        if what == "book" and not forget:
            index["removed"] = True
            _write(book / "book.json", index)
        _write(payload.parent / "meta.json", entry)
    return entry


def restore(library: Path, held_id: str) -> dict[str, Any]:
    if not SAFE_ID(
        held_id
    ):  # the id becomes a folder name: nothing but letters and digits may reach the disk
        raise ValueError("That is no longer held.")
    folder = library / ".held" / held_id
    entry = _read(folder / "meta.json", None)
    if not entry:
        raise ValueError("That is no longer held.")
    book = library / entry["slug"]
    with _lock:
        for path in sorted((folder / "payload").rglob("*")):
            target = book / path.relative_to(folder / "payload")
            if path.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            elif not target.exists():  # what has been made again since is the newer one and stays
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(path), str(target))
        if entry["what"] == "book" and (book / "book.json").is_file():
            index = json.loads((book / "book.json").read_text(encoding="utf-8"))
            index.pop("removed", None)
            _write(book / "book.json", index)
        entry["left"] = sum(p.is_file() for p in (folder / "payload").rglob("*"))
        if not entry[
            "left"
        ]:  # an older copy of something made again since stays held until its days run out
            shutil.rmtree(folder)
    return entry


def SAFE_ID(text: str) -> bool:
    return text.isascii() and text.isalnum() and len(text) <= 32


def purge(library: Path, held_id: str | None = None) -> int:
    """Deletes for good: one held thing when named, otherwise everything held longer
    than HOLD_DAYS. Returns how many."""
    gone = 0
    for entry in held(library):
        if (held_id == entry["id"]) if held_id else (time.time() - entry["t"] > HOLD_DAYS * 86400):
            shutil.rmtree(library / ".held" / entry["id"], ignore_errors=True)
            if entry.get("forget") and not any(
                (library / entry["slug"]).iterdir() if (library / entry["slug"]).is_dir() else []
            ):
                (library / entry["slug"]).rmdir()
            gone += 1
    return gone


def finished_at(records: dict[str, Any], chapters: list[str]) -> float:
    """When the last part was marked finished, in seconds, or 0 while any part is not."""
    newest: dict[str, dict[str, Any]] = {}
    for record in records.values():
        for chapter, entry in (
            record["done"].items() if isinstance(record.get("done"), dict) else ()
        ):
            if (
                is_object(entry)
                and isinstance(entry.get("t", 0), (int, float))
                and entry.get("t", 0) >= newest.get(chapter, {}).get("t", -1)
            ):
                newest[chapter] = entry
    if not chapters or not all(newest.get(c, {}).get("v") for c in chapters):
        return 0.0
    return max(newest[c].get("t", 0) for c in chapters) / 1000


def tidy(library: Path) -> int:
    """The owner's standing rules: recorded voice of books finished long ago goes to the holding
    folder; the holding folder empties itself."""
    from . import library as lib

    rules, moved = settings(library)["storage"], 0
    for index in library.glob("*/book.json"):
        book, info = index.parent, json.loads(index.read_text(encoding="utf-8"))
        if info.get("removed") or _media(book) != book:
            continue
        names = [n for n in voice.voices_of(book) if n != voice.ADOPTED]
        done = finished_at(lib.read_records(book), [c["id"] for c in info["chapters"]])
        drop: set[str] = (
            set(names)
            if rules["voice_days"] and done and time.time() - done > rules["voice_days"] * 86400
            else set()
        )
        full = [
            n
            for n in VOICES
            if n in names
            and all(n in by for by in voice.voices(book).values())
            and len(voice.voices(book)) == len(info["chapters"])
        ]
        if rules["one_voice"] and full:
            drop |= set(names) - {full[0]}  # the best voice that covers the whole book stays
        for name in sorted(drop):
            remove(library, book.name, f"voice:{name}")
            moved += 1
    return moved + purge(library)


# ---------- the queue ----------
class Workshop:
    """Runs one step at a time, the owner's own requests first. Jobs survive a restart; a running
    job starts its unfinished units again."""

    def __init__(self, library: Path, run: bool = True) -> None:
        self.library = library
        self.jobs: list[dict[str, Any]] = [
            dict(j, state="waiting", done=0, of=0, note="")
            for j in _read(library / "queue.json", [])
            if is_object(j) and not self._finished(j)
        ]
        # the last few that ended, so the screen can say what happened
        self.past: list[dict[str, Any]] = []
        self.child: subprocess.Popen[str] | None = None
        self.follower: subprocess.Popen[str] | None = None
        self.wake = threading.Event()
        self._tidied = 0.0
        self._closing = False
        self._thread = (
            threading.Thread(target=self._loop, daemon=True, name="workshop") if run else None
        )
        if self._thread:
            self._thread.start()

    def _save(self) -> None:
        _write(
            self.library / "queue.json",
            [{k: j[k] for k in ("id", "book", "step", "arg", "by", "t")} for j in self.jobs],
        )

    def add(self, book: str, step: str, arg: str = "", by: str = "hand") -> dict[str, Any]:
        if step not in STEPS or not (self.library / book / "book.json").is_file():
            raise ValueError("No such step or book.")
        if step == "voice" and arg not in VOICES:
            raise ValueError("No such voice.")
        with _lock:
            same = next(
                (j for j in self.jobs if (j["book"], j["step"], j["arg"]) == (book, step, arg)),
                None,
            )
            if same:
                return same
            job = {
                "id": uuid.uuid4().hex[:12],
                "book": book,
                "step": step,
                "arg": arg,
                "by": by,
                "t": time.time(),
                "state": "waiting",
                "done": 0,
                "of": 0,
                "note": "",
            }
            self.jobs.append(job)
            self._save()
        self.wake.set()
        return job

    def add_all(self, step: str, arg: str = "", only_missing: bool = True) -> int:
        if step not in STEPS:
            raise ValueError("No such step or book.")
        count = 0
        for info in overview(self.library):
            have = (
                info["voice"].get(arg, 0) >= info["parts"]
                if step == "voice"
                else info["steps"][step].get("state") == "done"
            )
            if step == "letters" and not info["cover"]:
                continue  # nothing to look at
            if not info["removed"] and info["kind"] == "words" and not (only_missing and have):
                self.add(info["slug"], step, arg, by="all")
                count += 1
        return count

    def cancel(self, job_id: str) -> bool:
        with _lock:
            job = next((j for j in self.jobs if j["id"] == job_id), None)
            if not job:
                return False
            job["stop"] = True
            if job["state"] == "waiting":
                self.jobs.remove(job)
                self._save()
            elif self.child and self.child.poll() is None:
                self.child.terminate()  # the narrator keeps every part it has finished
        return True

    def _finished(self, job: dict[str, Any]) -> bool:
        """A job whose step was written as done after it was asked for: Home stopped between
        finishing it and saving the queue."""
        made: dict[str, Any] = (
            ledger(self.library / str(job.get("book"))).get(job.get("step", "")) or {}
        )
        return (
            job.get("step") != "voice"
            and made.get("state") == "done"
            and made.get("at", 0) >= job.get("t", 0)
        )

    def listing(self) -> dict[str, Any]:
        with _lock:

            def show(j: dict[str, Any]) -> dict[str, Any]:
                return {
                    k: j.get(k)
                    for k in (
                        "id",
                        "book",
                        "step",
                        "arg",
                        "by",
                        "state",
                        "done",
                        "of",
                        "note",
                        "t",
                        "ended",
                    )
                }

            return {
                "jobs": [show(j) for j in sorted(self.jobs, key=self._order)],
                "past": [show(j) for j in self.past[-12:]],
                "following": bool(self.follower and self.follower.poll() is None),
            }

    @staticmethod
    def _order(job: dict[str, Any]) -> tuple[bool, bool, bool, float]:
        return (
            job["state"] != "running",
            job["by"] != "hand",
            job["step"] == "voice",
            job["t"],
        )  # asked by hand first; voice last, it is the long one

    def auto(self, slug: str) -> None:
        """What the owner wants done to every new book."""
        chosen = settings(self.library)
        if _read(self.library / slug / "book.json", {}).get("kind") == "pages":
            # a book of pictures has no sentences to pick
            # and no lettering to set on a spine of its own
            return
        if chosen["auto"]["takeaways"]:
            self.add(slug, "takeaways", by="auto")
        if (
            chosen["auto"]["letters"]
            and chosen["engines"]["eyes"]["engine"]
            and status(self.library / slug)["cover"]
        ):
            self.add(slug, "letters", by="auto")
        if chosen["auto"]["pictures"] and chosen["engines"]["words"]["engine"]:
            self.add(slug, "pictures", by="auto")

    def stop(self) -> None:
        """Ends the queue with Home. Waiting jobs are on disk and start again next time."""
        self._closing = True
        self.wake.set()
        for child in (self.child, self.follower):
            if child and child.poll() is None:
                child.terminate()
        if self._thread:
            self._thread.join(10)

    # ----- running -----
    def _loop(self) -> None:
        while not self._closing:
            with _lock:
                job = min(
                    (j for j in self.jobs if j["state"] == "waiting"), key=self._order, default=None
                )
                if job:
                    job["state"] = "running"
            if not job:
                self._idle()
                if not self._closing:
                    self.wake.wait(30)
                self.wake.clear()
                continue
            self._stop_follower()
            book = self.library / job["book"]
            try:
                if not (book / "book.json").is_file():
                    raise ValueError("The book is no longer in the library.")
                result: dict[str, Any] = getattr(self, "_" + job["step"])(book, job) or {}
                if job.get("stop"):
                    job.update(state="stopped", note="Stopped. What was finished stays.")
                else:
                    job.update(state="done")
                    note(book, job["step"], state="done", **result)
            except Exception as err:
                reason = (
                    str(err)
                    if isinstance(err, (ValueError, RuntimeError))
                    else f"{type(err).__name__}: {err}"
                )
                job.update(state="failed", note=reason[:400])
                with contextlib.suppress(OSError):
                    note(book, job["step"], state="failed", note=reason[:400])
            with _lock:
                job["ended"] = time.time()
                self.jobs.remove(job)
                self.past.append(job)
                self._save()

    def _idle(self) -> None:
        if time.time() - self._tidied > 6 * 3600:
            self._tidied = time.time()
            with contextlib.suppress(
                Exception
            ):  # tidying reads what devices saved: nothing in it may stop the queue
                tidy(self.library)
        name = settings(self.library)["voice"]["follow"]
        running = self.follower and self.follower.poll() is None
        if name in VOICES and not running:
            self.follower = self._narrator(name)
        elif name not in VOICES and running:
            self._stop_follower()

    def _stop_follower(self) -> None:
        if self.follower and self.follower.poll() is None:
            self.follower.terminate()
            with contextlib.suppress(subprocess.TimeoutExpired):
                self.follower.wait(20)
        self.follower = None

    def python_for(self, name: str) -> str | None:
        """An interpreter that has the voice's packages: the owner's choice, this
        one, or a .venv beside the code."""
        module = "kokoro_onnx" if name == "plain" else "mlx_audio"
        chosen = settings(self.library)["voice"]["python"]
        if not Path(chosen).name.startswith(
            "python"
        ):  # a page may name an interpreter, never any other program
            chosen = ""
        for exe in dict.fromkeys(
            filter(
                None,
                [
                    chosen,
                    sys.executable,
                    str(Path(__file__).parents[1] / ".venv" / "bin" / "python"),
                ],
            )
        ):
            with contextlib.suppress(OSError, subprocess.TimeoutExpired):
                if (
                    subprocess.run(
                        [exe, "-c", f"import {module}"], capture_output=True, timeout=60
                    ).returncode
                    == 0
                ):
                    return exe
        return None

    def _narrator(self, name: str, book: str | None = None) -> subprocess.Popen[str] | None:
        exe = self.python_for(name)
        if not exe:
            return None
        command = [
            exe,
            "-u",
            "-m",
            "eastroom",
            "--library",
            str(self.library),
            "--voice",
            name,
            *(["--book", book] if book else []),
        ]
        return subprocess.Popen(
            command,
            cwd=Path(__file__).parents[1],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            env={**os.environ, "PYTHONPATH": str(Path(__file__).parents[1])},
        )

    def _voice(self, book: Path, job: dict[str, Any]) -> dict[str, Any]:
        name = job["arg"]
        count = lambda: sum(name in by for by in voice.voices(book).values())  # noqa: E731
        job["of"] = len(json.loads((book / "book.json").read_text(encoding="utf-8"))["chapters"])
        self.child = self._narrator(name, book.name)
        if not self.child:
            extra = "voice" if name == "plain" else "storyteller"
            raise RuntimeError(
                f'The {name} voice is not installed on Home. Run: pip install "eastroom[{extra}]"'
            )
        while self.child.poll() is None:
            job["done"] = count()
            time.sleep(2)
        job["done"] = count()
        if self.child.returncode not in (0, -15) and not job.get("stop"):
            said = self.child.stderr.read() if self.child.stderr else ""
            raise RuntimeError((said or "The narrator stopped.").strip().splitlines()[-1][:300])
        return {"voice": name, "parts": job["done"]}

    def _read(self, book: Path, job: dict[str, Any]) -> dict[str, Any]:
        from . import library as lib

        with _lock:
            parts = ingest.reread(self.library, book.name)
            voice.drop_stale(book, lib.media_root(book))
        self.auto(book.name)
        return {"parts": parts}

    def _takeaways(self, book: Path, job: dict[str, Any]) -> dict[str, Any]:
        chosen = settings(self.library)
        model = chosen["takeaways"]["by"] == "model" and bool(chosen["engines"]["words"]["engine"])
        if model:
            engines.ready(
                chosen, chosen["engines"]["words"]["engine"], chosen["engines"]["words"]["model"]
            )  # said now, not hidden behind the ranking
        choose = (
            engines.chooser(
                lambda prompt, schema: engines.ask(
                    self.library, chosen, "words", prompt, schema=schema
                )
            )
            if model
            else None
        )

        def step(done: int, of: int) -> None:
            job["done"], job["of"] = done, of

        made = takeaways.make(book, choose, step, lambda: job.get("stop"))
        return {"by": "model" if model else "rank", "made": made}

    def _pictures(self, book: Path, job: dict[str, Any]) -> dict[str, Any]:
        chosen = settings(self.library)
        pick = chosen["engines"]["words"]
        engines.ready(chosen, pick["engine"], pick["model"])

        def step(done: int, of: int) -> None:
            job["done"], job["of"] = done, of

        found, looked = pictures.make(
            book,
            _media(book),
            lambda prompt, schema: engines.ask(
                self.library, chosen, "words", prompt, schema=schema
            ),
            step,
            lambda: job.get("stop"),
        )
        if looked and not found and not job.get("stop"):
            raise ValueError("Wikimedia Commons had no free picture for any part of this book.")
        return {
            "found": found,
            "of": looked,
            "by": engines.label(pick["engine"], pick["model"], chosen),
        }

    def _letters(self, book: Path, job: dict[str, Any]) -> dict[str, Any]:
        from . import letters

        chosen = settings(self.library)
        pick = chosen["engines"]["eyes"]
        by = (
            engines.label(pick["engine"], pick["model"], chosen)
            if engines.known(pick["engine"], chosen)
            else ""
        )
        job["of"] = 1
        spine = letters.match(
            book,
            lambda prompt, images, schema: engines.ask(
                self.library, chosen, "eyes", prompt, images, schema
            ),
            by,
            _media(book),
        )
        job["done"] = 1
        return {"by": by, "face": spine["face"]}
