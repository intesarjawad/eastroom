import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from eastroom import export, ingest, library, voice
from tests.epub_fixture import PARAGRAPH, make_epub

BODY = "".join(f"<h2>Part {n}</h2>{PARAGRAPH}" for n in range(3))
EPUB = make_epub([BODY])


class Server(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.library = Path(self.tmp.name) / "library"
        self.library.mkdir()
        self.server = library.serve(self.library, 0)
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.server.workshop.stop()  # nothing may still be writing when the folder goes
        self.tmp.cleanup()

    def test_home_tells_the_address_other_devices_open(self):
        self.assertEqual(json.loads(self.call("/api/engines")[1])["reach"], [])
        self.server.RequestHandlerClass.origins = frozenset({"https://home.example.ts.net:10000"})
        self.assertEqual(
            json.loads(self.call("/api/engines")[1])["reach"], ["https://home.example.ts.net:10000"]
        )

    def call(self, path, method="GET", body=None, headers=None):
        request = urllib.request.Request(
            self.base + path, data=body, method=method, headers=headers or {}
        )
        try:
            with urllib.request.urlopen(request) as response:
                return response.status, response.read(), response.headers
        except urllib.error.HTTPError as err:
            with err:
                return err.code, err.read(), err.headers

    def add_book(self) -> str:
        status, body, _ = self.call("/api/import", "POST", EPUB)
        self.assertEqual(status, 200)
        return json.loads(body)["slug"]

    def test_an_imported_book_appears_in_the_library_and_can_be_read(self):
        slug = self.add_book()
        books = json.loads(self.call("/api/library")[1])
        self.assertEqual([b["slug"] for b in books], [slug])
        chapter = json.loads(self.call(f"/api/book/{slug}/c001")[1])
        self.assertEqual(chapter["title"], "Part 0")

    def test_a_file_that_is_not_an_epub_is_refused_with_a_reason(self):
        status, body, _ = self.call("/api/import", "POST", b"not a zip file")
        self.assertEqual(status, 400)
        self.assertIn("EPUB", json.loads(body)["error"])

    def test_a_file_name_no_disk_would_take_is_refused_the_same_way(self):
        status, body, _ = self.call("/api/import?name=book.%00x", "POST", EPUB)
        self.assertEqual(status, 400)
        self.assertIn("EPUB", json.loads(body)["error"])

    def put(self, slug, device, record, headers=None):
        return self.call(
            f"/api/state/{slug}/{device}", "PUT", json.dumps(record).encode(), headers
        )[0]

    def test_each_device_keeps_its_own_record_and_neither_overwrites_the_other(self):
        slug = self.add_book()
        phone = {"place": {"ch": "c002", "w": 41, "t": 1000}, "days": {"2026-11-12": 60}}
        tablet = {"place": {"ch": "c003", "w": 5, "t": 2000}, "days": {"2026-11-12": 30}}
        self.assertEqual(
            (self.put(slug, "phone1", phone), self.put(slug, "tablet1", tablet)), (200, 200)
        )
        records = json.loads(self.call(f"/api/state/{slug}")[1])
        self.assertEqual(
            {d: r["place"] for d, r in records.items()},
            {"phone1": phone["place"], "tablet1": tablet["place"]},
        )
        self.assertEqual(json.loads(self.call("/api/state")[1])[slug].keys(), records.keys())

    def test_the_state_file_of_older_versions_is_passed_on_untouched(self):
        slug = self.add_book()
        old = self.library / slug / "state.json"
        old.write_text('{"ch": "c002", "g": 41, "at": 5}', encoding="utf-8")
        self.put(slug, "phone1", {"place": {"ch": "c001", "w": 1, "t": 9}})
        self.assertEqual(
            json.loads(self.call(f"/api/state/{slug}")[1])["before"],
            {"ch": "c002", "g": 41, "at": 5},
        )
        self.assertEqual(old.read_text(encoding="utf-8"), '{"ch": "c002", "g": 41, "at": 5}')

    def test_a_clock_that_runs_ahead_cannot_win_for_ever(self):
        slug = self.add_book()
        far = 99999999999999
        self.put(
            slug,
            "phone1",
            {
                "place": {"ch": "c001", "w": 1, "t": far},
                "kept": {"c001:1:3": {"t": far, "exact": "a b c"}},
            },
        )
        record = json.loads(self.call(f"/api/state/{slug}")[1])["phone1"]
        self.assertLess(record["place"]["t"], far)
        self.assertLess(record["kept"]["c001:1:3"]["t"], far)

    def test_a_record_must_be_an_object_from_a_named_device(self):
        slug = self.add_book()
        self.assertEqual(self.call(f"/api/state/{slug}/phone1", "PUT", b"[1]")[0], 400)
        self.assertEqual(self.put(slug, "../x", {}), 404)
        self.assertEqual(self.put(slug, "No", {}), 404)

    def test_another_website_cannot_write_to_the_library(self):
        slug = self.add_book()
        self.assertEqual(self.put(slug, "phone1", {}, {"Origin": "https://example.com"}), 403)
        self.assertEqual(self.put(slug, "phone1", {"place": {}}, {"Origin": self.base}), 200)
        self.assertEqual(
            self.put(slug, "phone1", {"place": {}}, {"Origin": "http://localhost:1"}), 403
        )  # another program on this computer

    def test_home_answers_only_to_its_own_name(self):
        self.add_book()
        self.assertEqual(self.call("/api/library", headers={"Host": "evil.example"})[0], 403)
        self.assertEqual(
            self.call(
                "/api/library", headers={"Host": f"localhost:{self.server.server_address[1]}"}
            )[0],
            200,
        )
        self.server.RequestHandlerClass.origins = frozenset({"https://home.example.ts.net:8443"})
        self.assertEqual(
            self.call("/api/library", headers={"Host": "home.example.ts.net:8443"})[0], 200
        )

    def test_the_owners_private_address_may_write_when_it_is_named_at_start(self):
        slug = self.add_book()
        self.server.RequestHandlerClass.origins = frozenset({"https://home.example.ts.net:8443"})
        self.assertEqual(
            self.put(slug, "phone1", {"place": {}}, {"Origin": "https://home.example.ts.net:8443"}),
            200,
        )
        self.assertEqual(
            self.put(slug, "phone1", {"place": {}}, {"Origin": "https://home.example.ts.net"}), 403
        )

    def test_the_same_file_twice_is_one_book_and_the_same_title_twice_is_two(self):
        slug = self.add_book()
        status, body, _ = self.call("/api/import?name=again.epub", "POST", EPUB)
        self.assertEqual((status, json.loads(body)), (200, {"slug": slug, "known": True}))
        other = make_epub(["".join(f"<h2>Other {n}</h2>{PARAGRAPH}" for n in range(3))])
        self.put(slug, "phone1", {"place": {"ch": "c002", "w": 4, "t": 1}})
        second = json.loads(self.call("/api/import", "POST", other)[1])
        self.assertEqual(second, {"slug": slug + "-2", "known": False})
        self.assertEqual(
            json.loads(self.call(f"/api/state/{second['slug']}")[1]),
            {},
            "a new book must not inherit another book's place",
        )

    def test_a_locked_file_is_refused_in_plain_words(self):
        status, body, _ = self.call("/api/import", "POST", make_epub([PARAGRAPH], locked=True))
        self.assertEqual(status, 400)
        self.assertIn("locked", json.loads(body)["error"])

    def test_narration_records_are_listed_with_stamps_and_served(self):
        slug = self.add_book()
        voice.write_record(
            self.library / slug,
            "plain",
            "c002",
            "abc",
            [{"src": "voice/plain/c002-01.m4a", "sentences": []}],
        )
        chapters = json.loads(self.call("/api/library")[1])[0]["chapters"]
        self.assertEqual([sorted(c.get("voices", {})) for c in chapters], [[], ["plain"], []])
        self.assertTrue(all(c["v"] for c in chapters))
        status, body, headers = self.call(
            f"/api/voice/{slug}/plain/c002?v={chapters[1]['voices']['plain']}"
        )
        self.assertEqual((status, json.loads(body)["text"]), (200, "abc"))
        self.assertIn("immutable", headers["Cache-Control"])
        self.assertEqual(self.call(f"/api/book/{slug}/c001")[2]["Cache-Control"], "no-cache")

    def test_an_address_with_an_old_stamp_is_not_kept(self):
        slug = self.add_book()
        status, _, headers = self.call(f"/api/book/{slug}/c001?v=0.0")
        self.assertEqual((status, headers["Cache-Control"]), (200, "no-store"))

    def test_a_save_that_arrives_late_does_not_undo_a_newer_one(self):
        slug = self.add_book()
        self.put(slug, "phone001", {"rev": 5, "place": {"ch": "c002", "w": 9, "t": 2}})
        self.assertEqual(
            self.put(slug, "phone001", {"rev": 4, "place": {"ch": "c001", "w": 1, "t": 1}}), 200
        )
        self.assertEqual(
            json.loads(self.call(f"/api/state/{slug}")[1])["phone001"]["place"]["ch"], "c002"
        )
        self.put(slug, "phone001", {"rev": 6, "place": {"ch": "c003", "w": 0, "t": 3}})
        self.assertEqual(
            json.loads(self.call(f"/api/state/{slug}")[1])["phone001"]["place"]["ch"], "c003"
        )

    def test_nothing_inside_a_book_can_run_as_a_page_of_the_app(self):
        page = b"<script>fetch('/api/state')</script>"
        slug = json.loads(
            self.call("/api/import", "POST", make_epub([BODY], cover=("cover.html", page)))[1]
        )["slug"]
        self.assertIsNone(
            json.loads(self.call("/api/library")[1])[0]["cover"]
        )  # a cover that is not a picture is not kept
        self.assertEqual(self.call(f"/media/{slug}/cover.html")[0], 404)
        other = json.loads(
            self.call(
                "/api/import",
                "POST",
                make_epub([BODY + "<p>Other.</p>"], cover=("cover.png", b"\x89PNG")),
            )[1]
        )["slug"]
        headers = self.call(f"/media/{other}/cover.png")[2]
        self.assertEqual(
            (headers["Content-Security-Policy"], headers["X-Content-Type-Options"]),
            ("sandbox", "nosniff"),
        )
        self.assertIsNone(
            self.call("/")[2]["Content-Security-Policy"]
        )  # the app's own pages are not sandboxed

    def test_a_spine_that_repeats_a_document_does_not_multiply_the_book(self):
        self.call("/api/import", "POST", make_epub([BODY], spine_repeats=50))
        self.assertEqual(len(json.loads(self.call("/api/library")[1])[0]["chapters"]), 3)

    def test_paths_cannot_escape_the_served_folders(self):
        slug = self.add_book()
        (self.library / "secret.txt").write_text("private", encoding="utf-8")
        for path in (
            f"/media/{slug}/../secret.txt",
            f"/media/{slug}/%2e%2e/secret.txt",
            "/../library.py",
            "/api/book/..%2f..%2fetc/c001",
        ):
            with self.subTest(path=path):
                self.assertEqual(self.call(path)[0], 404)

    def test_audio_can_be_fetched_in_byte_ranges(self):
        slug = self.add_book()
        (self.library / slug / "clip.m4a").write_bytes(bytes(range(100)))
        status, body, headers = self.call(
            f"/media/{slug}/clip.m4a", headers={"Range": "bytes=10-19"}
        )
        self.assertEqual(
            (status, body, headers["Content-Range"]), (206, bytes(range(10, 20)), "bytes 10-19/100")
        )
        self.assertEqual(headers["Content-Type"], "audio/mp4")

    def test_export_writes_a_site_that_mirrors_the_server_routes(self):
        slug = self.add_book()
        self.put(slug, "phone1", {"place": {"ch": "c002", "w": 9, "t": 1}})
        voice.write_record(
            self.library / slug,
            "plain",
            "c001",
            "abc",
            [{"src": "voice/plain/c001-01.m4a", "sentences": []}],
        )
        (self.library / slug / "voice" / "plain" / "c001-01.m4a").write_bytes(b"sound")
        out = Path(self.tmp.name) / "site"
        self.assertEqual(export.export_site(self.library, out), 1)
        self.assertEqual(
            json.loads((out / "api" / "library").read_text(encoding="utf-8"))[0]["slug"], slug
        )
        self.assertFalse(
            (out / "api" / "state").exists(),
            "a published copy must not carry the owner's reading records",
        )
        self.assertEqual(
            json.loads((out / "api" / "book" / slug / "c001").read_text(encoding="utf-8"))["title"],
            "Part 0",
        )
        self.assertEqual(
            json.loads(
                (out / "api" / "voice" / slug / "plain" / "c001").read_text(encoding="utf-8")
            )["voice"],
            "plain",
        )
        self.assertEqual(
            (out / "media" / slug / "voice" / "plain" / "c001-01.m4a").read_bytes(), b"sound"
        )
        self.assertTrue((out / "index.html").is_file() and (out / "read.html").is_file())


class Slugs(unittest.TestCase):
    def test_slug_is_safe_for_a_path(self):
        self.assertEqual(ingest.slugify("Moby Dick; Or, The Whale"), "moby-dick-or-the-whale")
        self.assertEqual(ingest.slugify("../../etc"), "etc")
        self.assertEqual(ingest.slugify("???"), "book")


if __name__ == "__main__":
    unittest.main()


class Workshop(Server):
    def send(self, path, obj, method="POST", origin=None):
        status, body, _ = self.call(
            path, method, json.dumps(obj).encode(), {"Origin": origin} if origin else None
        )
        return status, json.loads(body)

    def test_the_owner_can_ask_for_a_step_and_see_it_done(self):
        slug = self.add_book()
        status, job = self.send("/api/work", {"book": slug, "step": "takeaways"})
        self.assertEqual((status, job["step"]), (200, "takeaways"))
        for _ in range(200):
            shown = json.loads(self.call("/api/work")[1])
            if shown["books"][0]["steps"]["takeaways"].get("state") == "done":
                break
            threading.Event().wait(0.02)
        self.assertEqual(shown["books"][0]["steps"]["takeaways"]["state"], "done")
        self.assertEqual(shown["books"][0]["original"], "epub")
        self.assertTrue(json.loads(self.call(f"/api/book/{slug}/c001")[1])["takeaways"])

    def test_a_removed_book_is_held_and_can_be_brought_back(self):
        slug = self.add_book()
        status, entry = self.send("/api/remove", {"book": slug, "what": "book"})
        self.assertEqual(status, 200, entry)
        self.assertEqual(json.loads(self.call("/api/library")[1]), [])
        self.assertEqual(
            [h["id"] for h in json.loads(self.call("/api/work")[1])["held"]], [entry["id"]]
        )
        self.assertEqual(self.send("/api/restore", {"id": entry["id"]})[0], 200)
        self.assertEqual(len(json.loads(self.call("/api/library")[1])), 1)

    def test_what_cannot_be_done_is_answered_in_words(self):
        slug = self.add_book()
        self.assertEqual(self.send("/api/work", {"book": "nope", "step": "takeaways"})[0], 404)
        self.assertEqual(self.send("/api/work", {"book": slug, "step": "rm -rf"})[0], 400)
        self.assertEqual(self.send("/api/remove", {"book": slug, "what": "../.."})[0], 400)
        self.assertEqual(self.send("/api/restore", {"id": "../../x"})[0], 400)
        self.assertEqual(self.send("/api/remove", {"book": "*", "what": "book"})[0], 404)
        self.assertEqual(self.send("/api/nothing", {})[0], 404)

    def test_another_site_cannot_change_settings_or_remove_books(self):
        slug = self.add_book()
        for path, obj, method in (
            ("/api/remove", {"book": slug, "what": "book"}, "POST"),
            ("/api/settings", {"auto": {"takeaways": False}}, "PUT"),
            ("/api/work", {"book": slug, "step": "read"}, "POST"),
            (f"/api/book/{slug}", {"title": "x"}, "PUT"),
        ):
            self.assertEqual(
                self.send(path, obj, method, origin="https://elsewhere.example")[0], 403
            )
        self.assertEqual(len(json.loads(self.call("/api/library")[1])), 1)

    def test_a_servers_key_goes_in_and_never_comes_back_out(self):
        self.send(
            "/api/settings",
            {"apis": [{"id": "mine", "name": "Mine", "url": "http://127.0.0.1:9/v1"}]},
            "PUT",
        )
        self.assertEqual(self.send("/api/engines/key", {"id": "other", "key": "k"})[0], 400)
        self.assertEqual(
            self.send(
                "/api/engines/key",
                {"id": "mine", "key": "sk-very-secret"},
                origin="https://elsewhere.example",
            )[0],
            403,
        )
        self.assertEqual(
            self.send("/api/engines/key", {"id": "mine", "key": "sk-very-secret"})[0], 200
        )
        shown = (
            self.call("/api/engines")[1] + self.call("/api/settings")[1] + self.call("/api/work")[1]
        )
        self.assertNotIn(b"sk-very-secret", shown)
        mine = json.loads(self.call("/api/engines")[1])["apis"][0]
        self.assertEqual((mine["key"], mine["up"]), (True, False))
        self.send(
            "/api/settings",
            {"apis": [{"id": "mine", "name": "Mine", "url": "http://127.0.0.1:9/elsewhere"}]},
            "PUT",
        )
        self.assertFalse(
            json.loads(self.call("/api/engines")[1])["apis"][0]["key"]
        )  # the address changed, so its key is not used
        self.assertEqual(self.call("/secrets.json")[0], 404)
        self.assertEqual(self.send("/api/engines/try", {"engine": "tool:sh", "model": ""})[0], 400)

    def test_settings_are_saved_and_a_books_details_can_be_corrected(self):
        slug = self.add_book()
        status, saved = self.send(
            "/api/settings", {"auto": {"takeaways": False}, "storage": {"voice_days": 30}}, "PUT"
        )
        self.assertEqual(
            (status, saved["auto"]["takeaways"], saved["storage"]["voice_days"]), (200, False, 30)
        )
        self.assertEqual(json.loads(self.call("/api/settings")[1]), saved)
        self.assertEqual(
            self.send(
                f"/api/book/{slug}",
                {"title": "  The  Real Title ", "author": "A. Writer", "slug": "x"},
                "PUT",
            )[0],
            200,
        )
        book = json.loads(self.call("/api/library")[1])[0]
        self.assertEqual(
            (book["title"], book["author"], book["slug"]), ("The Real Title", "A. Writer", slug)
        )
