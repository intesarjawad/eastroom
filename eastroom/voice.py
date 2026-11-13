"""Narration records: one small file per voice per chapter, beside the book and
never inside the chapter text.

A record names its voice, lists its audio files with the start and end of every sentence, and
carries a hash of the chapter text it was made from. Any generator that
writes this record is a narrator.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import wave
from collections.abc import Callable
from pathlib import Path
from typing import Any

ADOPTED = "recorded"  # narration that older versions stored inside the chapter files


def text_hash(blocks: list[dict[str, Any]]) -> str:
    return hashlib.sha256("\n".join(b["t"] for b in blocks).encode()).hexdigest()[:16]


def stamp(stat: os.stat_result) -> str:
    """Changes whenever the file does, without reading it. Devices
    keep a stamped address for good."""
    return f"{stat.st_mtime_ns:x}.{stat.st_size:x}"


def write_record(
    book: Path, voice: str, chapter: str, text: str, audio: list[dict[str, Any]]
) -> None:
    """Whole or not at all: a reader must never be served half a record."""
    path = book / "voice" / voice / f"{chapter}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(
        json.dumps(
            {"voice": voice, "chapter": chapter, "text": text, "audio": audio}, ensure_ascii=False
        ),
        encoding="utf-8",
    )
    tmp.replace(path)


def voices(book: Path) -> dict[str, dict[str, str]]:
    """Chapter id -> {voice name: stamp of its record}."""
    found: dict[str, dict[str, str]] = {}
    folder = book / "voice"
    if not folder.is_dir():
        return found
    for voice in sorted(p for p in folder.iterdir() if p.is_dir()):
        with os.scandir(voice) as entries:
            for entry in entries:
                if entry.name.endswith(".json"):
                    found.setdefault(entry.name[:-5], {})[voice.name] = stamp(entry.stat())
    return found


def voices_of(book: Path) -> list[str]:
    """The names of the voices this book has anything in."""
    folder = book / "voice"
    return (
        sorted(p.name for p in folder.iterdir() if p.is_dir() and any(p.glob("c*.json")))
        if folder.is_dir()
        else []
    )


def whole_book(book: dict[str, Any], records: dict[str, Any], voice: str) -> list[str]:
    """Every part of one book that lacks this voice: from the reading place to the
    end first, then what came before."""
    ids = [c["id"] for c in book["chapters"]]
    places = [
        r.get("place")
        for r in records.values()
        if isinstance(r.get("place"), dict) and r["place"].get("ch") in ids
    ]
    at = ids.index(max(places, key=lambda p: p.get("t") or 0)["ch"]) if places else 0
    have = {c["id"] for c in book["chapters"] if voice in c.get("voices", {})}
    return [c for c in ids[at:] + ids[:at] if c not in have]


def adopt_embedded(book: Path) -> int:
    """Copies narration found inside chapter files into records, once. The
    chapter files are left as they are."""
    if (book / "voice").is_dir():
        return 0
    count = 0
    for path in sorted((book / "chapters").glob("c*.json")):
        chapter = json.loads(path.read_text(encoding="utf-8"))
        if chapter.get("audio"):
            write_record(
                book, ADOPTED, chapter["id"], text_hash(chapter["blocks"]), chapter["audio"]
            )
            count += 1
    (book / "voice").mkdir(exist_ok=True)
    return count


# ---------- making narration ----------
VOICES = (
    "storyteller",
    ADOPTED,
    "plain",
)  # best first; the reader plays the best one a chapter has
SENTENCE_GAP, PARAGRAPH_GAP, FILE_SECONDS = 0.28, 0.7, 480.0
ABBREVIATIONS = {
    "mr",
    "mrs",
    "ms",
    "dr",
    "st",
    "vs",
    "etc",
    "b.c",
    "a.d",
    "c",
    "b",
    "a",
    "d",
    "jr",
    "sr",
    "vol",
    "no",
}
SENTENCE_END = re.compile(r'[.!?]["”’)]*\s+(?=["“‘(]?[A-Z])')


def sentences(text: str) -> list[str]:
    """Split a paragraph into sentences. A wrong split only makes one spoken unit
    shorter or longer; no word is lost."""
    out: list[str] = []
    start = 0
    for match in SENTENCE_END.finditer(text):
        before = text[start : match.start()].split()
        word = before[-1].lower().rstrip(".") if before else ""
        if word in ABBREVIATIONS or len(word) == 1:
            continue
        out.append(text[start : match.end()].strip())
        start = match.end()
    if text[start:].strip():
        out.append(text[start:].strip())
    return out


def wanted(
    books: list[dict[str, Any]], records: dict[str, dict[str, Any]], voice: str
) -> list[tuple[str, str]]:
    """What to narrate next, in order: only books being read, from each reading place to the end.

    The chapter being read comes first in every book, then the one after it in every book, and so
    on, the most recently read book first at each step. So every book in progress has a voice a
    little ahead of its reader before any is narrated to its end.
    `books` is the library listing and `records` every device's record per book. A chapter that
    already has a better voice is left alone.
    """
    reading: list[tuple[float, str, list[dict[str, Any]]]] = []
    for book in books:
        ids = [c["id"] for c in book["chapters"]]
        newest = None
        for record in records.get(book["slug"], {}).values():
            place = record.get("place") or (
                {"ch": record.get("ch"), "t": record.get("at", 0)} if "ch" in record else None
            )  # the state file of older versions
            if (
                place
                and place.get("ch") in ids
                and (newest is None or (place.get("t") or 0) > (newest.get("t") or 0))
            ):
                newest = place
        if newest:
            reading.append(
                (newest.get("t") or 0, book["slug"], book["chapters"][ids.index(newest["ch"]) :])
            )
    better = VOICES[: VOICES.index(voice)] if voice in VOICES else ()
    ahead = sorted(
        (n, -t, slug, c) for t, slug, chapters in reading for n, c in enumerate(chapters)
    )
    return [
        (slug, c["id"])
        for _, _, slug, c in ahead
        if voice not in c.get("voices", {}) and not any(b in c.get("voices", {}) for b in better)
    ]


def remove_record(record: Path, media: Path) -> None:
    """The record goes first, so nothing is ever listed whose audio is missing."""
    audio = json.loads(record.read_text(encoding="utf-8")).get("audio", [])
    record.unlink()
    for part in audio:
        (media / part["src"]).unlink(missing_ok=True)


def drop_stale(book: Path, media: Path) -> int:
    """Removes records whose chapter text has changed since they were made:
    their sentence times no longer fit."""
    dropped = 0
    for record in sorted((book / "voice").glob("*/c*.json")):
        chapter = book / "chapters" / record.name
        if not chapter.is_file() or json.loads(record.read_text(encoding="utf-8")).get(
            "text"
        ) != text_hash(json.loads(chapter.read_text(encoding="utf-8"))["blocks"]):
            if record.parent.name == ADOPTED:
                # its audio belongs to the book as it was imported and is left alone
                record.unlink()
            else:
                remove_record(record, media)
            dropped += 1
    return dropped


def encode(wav: Path, out: Path) -> None:
    if shutil.which("ffmpeg"):
        command = [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-i",
            str(wav),
            "-c:a",
            "aac",
            "-b:a",
            "72k",
            str(out),
        ]
    elif shutil.which("afconvert"):  # every Mac has it
        command = ["afconvert", "-f", "m4af", "-d", "aac", "-b", "72000", str(wav), str(out)]
    else:
        raise RuntimeError("Narration needs ffmpeg to pack the audio. Install it and run again.")
    subprocess.run(command, check=True)


def narrate(
    book: Path,
    media: Path,
    chapter_id: str,
    voice: str,
    speak: Callable[[str], tuple[bytes, int]],
    pack: Callable[[Path, Path], None] = encode,
) -> float:
    """Speaks one chapter sentence by sentence and writes its record.
    Returns the seconds of audio made.

    `speak(text)` returns (16-bit mono PCM bytes, sample rate). Each sentence is measured as it is
    made, so the times in the record are exact and nothing has to listen to the audio afterwards.
    Every block is spoken, in the author's order.
    """
    chapter = json.loads((book / "chapters" / f"{chapter_id}.json").read_text(encoding="utf-8"))
    made_from = text_hash(chapter["blocks"])
    folder = media / "voice" / voice
    folder.mkdir(parents=True, exist_ok=True)
    audio: list[dict[str, Any]] = []
    lines: list[dict[str, Any]] = []
    rate: int | None = None
    pcm, t, total = bytearray(), 0.0, 0.0

    def close_file() -> None:
        nonlocal pcm, lines, t, total
        if not lines or rate is None:
            return
        # named after the text, so audio for other text never sits at this address
        name = f"{chapter_id}-{made_from[:8]}-{len(audio) + 1:02d}.m4a"
        with tempfile.TemporaryDirectory() as tmp:
            raw = Path(tmp) / "part.wav"
            with wave.open(str(raw), "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(rate)
                w.writeframes(bytes(pcm))
            pack(raw, folder / name)
        audio.append({"src": f"voice/{voice}/{name}", "sentences": lines})
        total += t
        pcm, lines, t = bytearray(), [], 0.0

    for block in chapter["blocks"]:
        text = " ".join(block["t"].split())
        if not text:
            continue
        if t > FILE_SECONDS:  # a new file at a paragraph, so no file grows past a few minutes
            close_file()
        for n, sentence in enumerate(sentences(text)):
            spoken, sample_rate = (
                speak(sentence) if re.search(r"\w", sentence) else (b"", rate or 24000)
            )
            rate = rate or sample_rate
            if lines:
                gap = int((SENTENCE_GAP if n else PARAGRAPH_GAP) * rate)
                pcm += b"\0\0" * gap
                t += gap / rate
            start = t
            pcm += spoken
            t += len(spoken) / 2 / rate
            lines.append({"b": block["id"], "s": round(start, 3), "e": round(t, 3), "t": sentence})
    close_file()
    write_record(book, voice, chapter_id, made_from, audio)
    plain = book / "voice" / "plain" / f"{chapter_id}.json"
    if (
        voice == VOICES[0] and plain.is_file()
    ):  # the storyteller has arrived: the plain take of this chapter goes
        remove_record(plain, media)
    return total
