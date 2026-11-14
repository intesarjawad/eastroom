import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from eastroom import ingest, library, takeaways, voice, work
from tests.epub_fixture import make_epub

TOPICS = ["harbour", "weather", "cargo", "crew", "compass", "storm", "island", "letters"]
PARAGRAPHS = "".join(
    f"<p>The {t} decided the voyage more than any captain would admit in his log."
    f" Every plan the owners made began with the {t} and ended with it too. "
    f"Nobody aboard spoke of the {t} without lowering his voice a little."
    " Was it luck? It was not.</p>"
    for t in TOPICS
)
BOOK = make_epub([f"<h2>Part {n}</h2>{PARAGRAPHS}" for n in range(3)])


class Shelf(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.library = Path(self.tmp.name)
        path = self.library / "in.epub"
        path.write_bytes(BOOK)
        self.slug = ingest.ingest(path, self.library)
        self.book = self.library / self.slug

    def tearDown(self):
        self.tmp.cleanup()

    def narrate(self, name="plain"):
        for chapter in ("c001", "c002"):
            voice.narrate(
                self.book,
                self.book,
                chapter,
                name,
                lambda text: (b"\0\0" * 240, 24000),
                pack=lambda wav, out: out.write_bytes(b"sound" * 100),
            )


class Room(Shelf):
    def test_a_file_that_a_step_replaces_while_the_room_is_measured_counts_as_nothing(self):
        (self.book / "chapters" / "c001.tmp").write_text("half written", encoding="utf-8")
        real = Path.stat

        def stat(path, **how):
            if path.suffix == ".tmp":
                raise FileNotFoundError(path)  # replaced between being listed and being measured
            return real(path, **how)

        whole = work.status(self.book)["bytes"]["text"]
        with mock.patch.object(Path, "stat", stat):
            self.assertEqual(work.status(self.book)["bytes"]["text"], whole - len("half written"))


class KeyLines(Shelf):
    def test_every_key_line_is_a_sentence_of_the_book_and_no_paragraph_gives_two(self):
        self.assertEqual(takeaways.make(self.book), 3)
        chapter = json.loads((self.book / "chapters" / "c001.json").read_text(encoding="utf-8"))
        text = {b["id"]: b["t"] for b in chapter["blocks"]}
        lines = chapter["takeaways"]
        self.assertGreaterEqual(len(lines), 3)
        for line in lines:
            self.assertIn(line["quote"], text[line["block"]])
            self.assertEqual(line["by"], "rank")
        self.assertEqual(len({line["block"] for line in lines}), len(lines))
        self.assertEqual(takeaways.make(self.book), 0)  # made once

    def test_a_model_can_only_choose_among_the_books_own_sentences(self):
        chapter = json.loads((self.book / "chapters" / "c001.json").read_text(encoding="utf-8"))
        picked = takeaways.for_chapter(chapter, lambda sentences, n: [0, 99, "x", 1, 2])
        self.assertEqual({line["by"] for line in picked}, {"model"})
        self.assertTrue(
            all(line["quote"] in " ".join(b["t"] for b in chapter["blocks"]) for line in picked)
        )
        broken = takeaways.for_chapter(
            chapter, lambda sentences, n: (_ for _ in ()).throw(OSError("no model"))
        )
        self.assertEqual({line["by"] for line in broken}, {"rank"})

    def test_lines_that_came_with_the_book_are_left_alone(self):
        path = self.book / "chapters" / "c001.json"
        chapter = json.loads(path.read_text(encoding="utf-8"))
        chapter["takeaways"] = [{"block": "b0001", "quote": "The harbour decided the voyage"}]
        path.write_text(json.dumps(chapter), encoding="utf-8")
        takeaways.make(self.book)
        self.assertEqual(
            json.loads(path.read_text(encoding="utf-8"))["takeaways"], chapter["takeaways"]
        )


class Removing(Shelf):
    def test_a_removed_voice_is_held_and_comes_back_whole(self):
        self.narrate()
        before = sorted(p.name for p in (self.book / "voice" / "plain").iterdir())
        on_disk = sum(p.stat().st_size for p in (self.book / "voice" / "plain").iterdir())
        self.assertEqual(work.status(self.book)["bytes"]["voice"], {"plain": on_disk})
        entry = work.remove(self.library, self.slug, "voice:plain")
        self.assertEqual(voice.voices(self.book), {})
        again = (
            self.book / "voice" / "plain" / before[0]
        )  # the same file exists again while a copy is held
        again.parent.mkdir(parents=True)
        again.write_bytes(b"newer")
        self.assertEqual(
            work.restore(self.library, entry["id"])["left"], 1
        )  # what cannot go back without overwriting stays held, not deleted
        self.assertEqual(
            (again.read_bytes(), [h["id"] for h in work.held(self.library)]),
            (b"newer", [entry["id"]]),
        )
        work.purge(self.library, entry["id"])
        entry = work.remove(self.library, self.slug, "voice:plain")
        self.assertEqual(voice.voices(self.book), {})
        self.assertEqual(
            [(h["what"], h["days_left"]) for h in work.held(self.library)],
            [("voice:plain", work.HOLD_DAYS)],
        )
        work.restore(self.library, entry["id"])
        self.assertEqual(sorted(p.name for p in (self.book / "voice" / "plain").iterdir()), before)
        self.assertEqual(work.held(self.library), [])

    def test_a_removed_book_leaves_the_library_but_keeps_what_the_reader_made(self):
        (self.book / "state").mkdir()
        (self.book / "state" / "dev1.json").write_text(
            json.dumps({"kept": {"c001:3:4": {"t": 1, "exact": "began with the harbour"}}}),
            encoding="utf-8",
        )
        work.remove(self.library, self.slug, "book")
        self.assertEqual(library.list_library(self.library), [])
        self.assertEqual(
            [b["removed"] for b in library.list_library(self.library, removed=True)], [True]
        )
        self.assertIn("dev1", library.read_records(self.book))
        self.assertFalse((self.book / "chapters").exists())
        path = self.library / "in.epub"
        self.assertEqual(
            ingest.ingest(path, self.library), self.slug
        )  # the same file again: the book returns to its own folder
        self.assertEqual(len(library.list_library(self.library)), 1)
        self.assertIn("dev1", library.read_records(self.book))

    def test_forgetting_a_book_takes_everything_and_the_hold_can_be_emptied(self):
        entry = work.remove(self.library, self.slug, "book", forget=True)
        self.assertEqual(library.list_library(self.library, removed=True), [])
        self.assertEqual(work.purge(self.library), 0)  # not yet: it is held for a week
        self.assertEqual(work.purge(self.library, entry["id"]), 1)
        self.assertFalse(self.book.exists())

    def test_nothing_unknown_can_be_removed(self):
        for what in ("voice:../../x", "chapters", "voice:recorded", ""):
            with self.assertRaises(ValueError):
                work.remove(self.library, self.slug, what)

    def test_voice_of_a_book_finished_long_ago_is_tidied_away_when_the_owner_asks_for_that(self):
        self.narrate()
        (self.book / "state").mkdir()
        long_ago = (time.time() - 40 * 86400) * 1000
        (self.book / "state" / "dev1.json").write_text(
            json.dumps({"done": {c: {"t": long_ago, "v": True} for c in ("c001", "c002", "c003")}}),
            encoding="utf-8",
        )
        self.assertEqual(work.tidy(self.library), 0)  # no rule, nothing moves
        work.save_settings(self.library, {"storage": {"voice_days": 30}})
        self.assertEqual(work.tidy(self.library), 1)
        self.assertEqual(voice.voices(self.book), {})


class Settings(Shelf):
    def test_only_known_settings_of_the_right_kind_are_kept(self):
        saved = work.save_settings(
            self.library,
            {
                "auto": {"takeaways": "yes", "letters": False, "rm": True},
                "engines": {"words": {"engine": 7, "model": "m" * 999}},
                "evil": 1,
                "storage": {"voice_days": -4},
            },
        )
        self.assertEqual(saved["auto"], {"takeaways": True, "letters": False, "pictures": True})
        self.assertEqual(
            saved["engines"]["words"], {"engine": "", "model": ""}
        )  # an engine that is not one of Home's is no engine
        self.assertEqual(saved["storage"]["voice_days"], 0)
        self.assertNotIn("evil", saved)
        self.assertEqual(work.settings(self.library), saved)


class Queue(Shelf):
    def wait(self, shop, job):
        for _ in range(200):
            if job in shop.past:
                return
            time.sleep(0.02)
        self.fail("the job did not end")

    def test_a_step_runs_is_recorded_and_can_be_asked_for_twice_without_harm(self):
        shop = work.Workshop(self.library)
        job = shop.add(self.slug, "takeaways")
        self.assertIs(shop.add(self.slug, "takeaways"), job)
        self.wait(shop, job)
        self.assertEqual(job["state"], "done")
        status = work.status(self.book)
        self.assertEqual(
            (
                status["steps"]["takeaways"]["state"],
                status["steps"]["takeaways"]["by"],
                status["original"],
            ),
            ("done", "rank", "epub"),
        )
        self.assertEqual(json.loads((self.library / "queue.json").read_text(encoding="utf-8")), [])

    def test_a_step_that_fails_says_why_and_the_queue_goes_on(self):
        shop = work.Workshop(self.library)
        (self.book / "original.epub").unlink()
        bad, good = shop.add(self.slug, "read"), shop.add(self.slug, "takeaways")
        self.wait(shop, good)
        self.assertEqual((bad["state"], good["state"]), ("failed", "done"))
        self.assertIn("Add its file again", work.status(self.book)["steps"]["read"]["note"])

    def test_waiting_work_survives_a_restart_and_can_be_cancelled(self):
        shop = work.Workshop(self.library, run=False)
        job = shop.add(self.slug, "letters")
        again = work.Workshop(self.library, run=False)
        self.assertEqual([j["id"] for j in again.jobs], [job["id"]])
        self.assertTrue(again.cancel(job["id"]))
        self.assertEqual(work.Workshop(self.library, run=False).jobs, [])

    def test_a_page_cannot_name_a_program_or_an_address_with_a_fragment(self):
        saved = work.save_settings(
            self.library,
            {
                "voice": {"python": "/bin/sh"},
                "apis": [{"id": "a", "name": "A", "url": "http://169.254.169.254/latest/#"}],
            },
        )
        self.assertEqual((saved["voice"]["python"], saved["apis"]), ("", []))
        self.assertEqual(
            work.save_settings(
                self.library,
                {"apis": [{"id": "a", "name": "A", "url": "http://desk.example:11434/v1"}]},
            )["apis"][0]["url"],
            "http://desk.example:11434/v1",
        )

    def test_only_an_interpreter_can_be_named_for_the_voices(self):
        (self.library / "settings.json").write_text(
            json.dumps({"voice": {"python": "/bin/sh"}}), encoding="utf-8"
        )
        shop = work.Workshop(self.library, run=False)
        with mock.patch.object(work.subprocess, "run", return_value=mock.Mock(returncode=0)) as run:
            shop.python_for("plain")
        self.assertNotIn("/bin/sh", [call.args[0][0] for call in run.call_args_list])

    def test_a_job_finished_just_before_home_stopped_is_not_run_again(self):
        asked = time.time() - 5
        (self.library / "queue.json").write_text(
            json.dumps(
                [
                    {
                        "id": "a",
                        "book": self.slug,
                        "step": "takeaways",
                        "arg": "",
                        "by": "hand",
                        "t": asked,
                    },
                    {
                        "id": "b",
                        "book": self.slug,
                        "step": "letters",
                        "arg": "",
                        "by": "hand",
                        "t": asked,
                    },
                ]
            ),
            encoding="utf-8",
        )
        work.note(self.book, "takeaways", state="done")
        self.assertEqual([j["id"] for j in work.Workshop(self.library, run=False).jobs], ["b"])

    def test_a_broken_time_from_a_device_does_not_break_tidying(self):
        self.assertEqual(
            work.finished_at({"phone": {"done": {"c001": {"t": "bad", "v": True}}}}, ["c001"]), 0.0
        )

    def test_unknown_steps_books_and_voices_are_refused(self):
        shop = work.Workshop(self.library, run=False)
        for args in (("nope", "takeaways"), (self.slug, "rm"), (self.slug, "voice", "loud")):
            with self.assertRaises(ValueError):
                shop.add(*args)
        with self.assertRaises(ValueError):
            shop.add_all("rm")

    def test_a_step_made_by_an_older_version_is_shown_as_improvable(self):
        work.note(self.book, "takeaways", state="done")
        steps = json.loads((self.book / "steps.json").read_text(encoding="utf-8"))
        steps["takeaways"]["v"] = 0
        (self.book / "steps.json").write_text(json.dumps(steps), encoding="utf-8")
        self.assertEqual(work.status(self.book)["steps"]["takeaways"]["state"], "stale")
