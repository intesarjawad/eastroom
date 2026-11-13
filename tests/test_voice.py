import json
import re
import struct
import tempfile
import unittest
from itertools import pairwise
from pathlib import Path

from eastroom import ingest, library, voice
from tests.epub_fixture import PARAGRAPH, make_epub

RATE = 8000


def speak(text):
    """A stand-in narrator: a tenth of a second per word, so every time in the
    record can be worked out by hand."""
    return struct.pack("<h", 0) * int(RATE * 0.1 * len(text.split())), RATE


def no_pack(wav: Path, out: Path) -> None:
    out.write_bytes(wav.read_bytes())


class Sentences(unittest.TestCase):
    def test_every_word_survives_the_split(self):
        text = (
            "Mr. Darcy bowed. “Is that so?” she said. He left at 5 p.m."
            " The room was quiet! J. K. wrote it."
        )
        parts = voice.sentences(text)
        self.assertEqual(" ".join(parts), text)
        self.assertEqual(parts[0], "Mr. Darcy bowed.")
        self.assertGreater(len(parts), 3)


class Narration(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.library = Path(self.tmp.name)
        epub = self.library / "book.epub"
        epub.write_bytes(
            make_epub(
                [
                    "".join(
                        f"<h2>Part {n}</h2>{PARAGRAPH}<p>Second one. It is short.</p>"
                        for n in range(3)
                    )
                ]
            )
        )
        self.slug = ingest.ingest(epub, self.library)
        self.book = self.library / self.slug
        self.ids = [
            c["id"]
            for c in json.loads((self.book / "book.json").read_text(encoding="utf-8"))["chapters"]
        ]

    def tearDown(self):
        self.tmp.cleanup()

    def narrate(self, chapter, name="plain"):
        return voice.narrate(
            self.book, library.media_root(self.book), chapter, name, speak, no_pack
        )

    def record(self, chapter, name="plain"):
        return json.loads(
            (self.book / "voice" / name / f"{chapter}.json").read_text(encoding="utf-8")
        )

    def test_the_record_covers_every_block_in_order_with_measured_times(self):
        seconds = self.narrate(self.ids[0])
        record, chapter = (
            self.record(self.ids[0]),
            json.loads(
                (self.book / "chapters" / f"{self.ids[0]}.json").read_text(encoding="utf-8")
            ),
        )
        lines = [line for part in record["audio"] for line in part["sentences"]]
        self.assertEqual(record["text"], voice.text_hash(chapter["blocks"]))
        self.assertEqual(
            list(dict.fromkeys(line["b"] for line in lines)),
            [b["id"] for b in chapter["blocks"] if b["t"].strip()],
        )
        self.assertEqual(
            " ".join(line["t"] for line in lines).split(),
            " ".join(b["t"] for b in chapter["blocks"]).split(),
        )
        for before, after in pairwise(lines):
            self.assertLessEqual(before["e"], after["s"])
            gap = voice.SENTENCE_GAP if before["b"] == after["b"] else voice.PARAGRAPH_GAP
            self.assertAlmostEqual(after["s"] - before["e"], gap, places=2)
        for line in lines:
            self.assertAlmostEqual(line["e"] - line["s"], 0.1 * len(line["t"].split()), places=2)
        self.assertAlmostEqual(seconds, lines[-1]["e"], places=2)
        for part in record["audio"]:
            self.assertTrue((library.media_root(self.book) / part["src"]).is_file())

    def test_a_long_chapter_is_cut_into_files_at_paragraphs(self):
        limit, voice.FILE_SECONDS = voice.FILE_SECONDS, 1.0
        try:
            self.narrate(self.ids[0])
        finally:
            voice.FILE_SECONDS = limit
        audio = self.record(self.ids[0])["audio"]
        self.assertGreater(len(audio), 1)
        for part in audio:
            self.assertEqual(part["sentences"][0]["s"], 0)

    def test_the_library_lists_the_voice_and_the_queue_follows_the_reader(self):
        books = library.list_library(self.library)
        self.assertEqual(
            voice.wanted(books, {}, "plain"), []
        )  # nobody is reading: nothing is narrated
        records = {
            self.slug: {
                "phone": {"place": {"ch": self.ids[1], "w": 0, "t": 5}},
                "before": {"ch": self.ids[0], "at": 2},
            }
        }
        self.assertEqual(
            voice.wanted(books, records, "plain"), [(self.slug, c) for c in self.ids[1:]]
        )  # from the newest place on
        self.narrate(self.ids[1])
        books = library.list_library(self.library)
        self.assertIn("plain", books[0]["chapters"][1]["voices"])
        self.assertEqual(
            voice.wanted(books, records, "plain"), [(self.slug, c) for c in self.ids[2:]]
        )
        self.assertEqual(
            voice.wanted(books, records, "storyteller"), [(self.slug, c) for c in self.ids[1:]]
        )

    def test_every_book_in_progress_gets_its_next_chapter_before_any_is_finished(self):
        books = [
            {"slug": s, "chapters": [{"id": f"c00{n}"} for n in (1, 2, 3)]} for s in ("old", "new")
        ]
        records = {
            "old": {"a": {"place": {"ch": "c002", "t": 1}}},
            "new": {"a": {"place": {"ch": "c001", "t": 9}}},
        }
        self.assertEqual(
            voice.wanted(books, records, "plain"),
            [("new", "c001"), ("old", "c002"), ("new", "c002"), ("old", "c003"), ("new", "c003")],
        )

    def test_the_storyteller_replaces_the_plain_take_of_a_chapter(self):
        self.narrate(self.ids[0])
        plain = [
            library.media_root(self.book) / part["src"]
            for part in self.record(self.ids[0])["audio"]
        ]
        self.narrate(self.ids[0], "storyteller")
        self.assertFalse((self.book / "voice" / "plain" / f"{self.ids[0]}.json").exists())
        self.assertFalse(any(path.exists() for path in plain))
        books = library.list_library(self.library)
        records = {self.slug: {"phone": {"place": {"ch": self.ids[0], "w": 0, "t": 5}}}}
        self.assertNotIn(
            (self.slug, self.ids[0]), voice.wanted(books, records, "plain")
        )  # not given back to the plain voice

    def test_a_record_made_from_older_text_is_dropped(self):
        self.narrate(self.ids[0])
        self.narrate(self.ids[1])
        path = self.book / "chapters" / f"{self.ids[0]}.json"
        chapter = json.loads(path.read_text(encoding="utf-8"))
        chapter["blocks"][0]["t"] += " More."
        path.write_text(json.dumps(chapter), encoding="utf-8")
        plain = [
            library.media_root(self.book) / part["src"]
            for part in self.record(self.ids[0])["audio"]
        ]
        self.assertEqual(voice.drop_stale(self.book, library.media_root(self.book)), 1)
        self.assertFalse(any(path.exists() for path in plain))
        self.assertFalse((self.book / "voice" / "plain" / f"{self.ids[0]}.json").exists())
        self.assertTrue((self.book / "voice" / "plain" / f"{self.ids[1]}.json").exists())


class AppFiles(unittest.TestCase):
    def test_the_offline_copy_lists_exactly_the_files_of_the_app(self):
        web = library.WEB
        listed = set(
            re.findall(
                r"'([^']+)'",
                re.search(
                    r"const FILES = \[(.*?)\];", (web / "sw.js").read_text(encoding="utf-8"), re.S
                )[1],
            )
        )
        skipped = ("sw.js", "index.html", ".DS_Store")  # the page is listed as "./"
        on_disk = {
            p.relative_to(web).as_posix()
            for p in web.rglob("*")
            if p.is_file() and p.name not in skipped
        }
        licences = {name for name in on_disk if name.endswith((".txt", "LICENSE", "sources.json"))}
        self.assertEqual(listed - {"./"}, on_disk - licences)


if __name__ == "__main__":
    unittest.main()
