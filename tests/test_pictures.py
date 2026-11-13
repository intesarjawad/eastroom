import importlib.util
import io
import json
import unittest
import unittest.mock
import urllib.parse

from eastroom import pictures, work
from tests.test_work import Shelf

HAS_PILLOW = importlib.util.find_spec("PIL") is not None


def page(index, name, licence="Public domain", wide=3000, high=2000, host="upload.wikimedia.org"):
    return {
        "index": index,
        "title": f"File:{name}.jpg",
        "imageinfo": [
            {
                "width": wide,
                "height": high,
                "thumburl": f"https://{host}/thumb/{name}.jpg",
                "descriptionurl": f"https://commons.wikimedia.org/wiki/File:{name}.jpg",
                "extmetadata": {
                    "LicenseShortName": {"value": licence},
                    "Artist": {"value": '<a href="//x">A. Painter</a>'},
                },
            }
        ],
    }


def commons(pages):
    """A stand-in for Wikimedia: `pages` by search words, and a red picture for every file."""
    asked = []

    def get(url):
        asked.append(url)
        if url.startswith(pictures.API):
            words = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)["gsrsearch"][0]
            found = pages.get(words.split(" filemime:")[0], [])
            return json.dumps(
                {"query": {"pages": {str(i): p for i, p in enumerate(found)}}}
            ).encode()
        from PIL import Image

        out = io.BytesIO()  # a drawing on bare paper where the name says so, a red scene otherwise
        colour = (250, 250, 250) if "drawing" in url else (200, 30, 20)
        Image.new("RGB", (64, 40), colour).save(out, "JPEG")
        return out.getvalue()

    get.asked = asked
    return get


class Search(unittest.TestCase):
    def test_only_free_whole_pictures_from_wikimedia_itself_are_offered(self):
        get = commons(
            {
                "storm at sea": [
                    page(1, "Storm kept under a licence", licence="CC BY-SA 4.0"),
                    page(2, "Storm (detail)"),
                    page(3, "Storm on a banner", wide=6000, high=900),
                    page(4, "Storm from elsewhere", host="example.org"),
                    page(5, "A small Storm", wide=1200, high=800),
                    page(6, "Storm at Sea"),
                    page(7, "Another Storm", licence="CC0"),
                    page(8, "Washerwomen by a river"),  # matched on its page's words only
                ]
            }
        )
        found = pictures.search("storm at sea", get)
        self.assertEqual(  # the sharp ones first, the small one as a last resort
            [f["file"][5:-4] for f in found], ["Storm at Sea", "Another Storm", "A small Storm"]
        )
        self.assertEqual(
            found[0]["credit"], "A. Painter, Storm at Sea. Public domain, via Wikimedia Commons."
        )

    def test_the_colours_are_the_ones_the_page_would_make(self):
        # the same three calls of fit() in web/colour.js answer with these
        self.assertEqual(
            [
                pictures.fit(0.28, 0.14, 25),
                pictures.fit(0.8, 0.17, 65),
                pictures.fit(0.17, 0.09, 305),
            ],
            ["#530108", "#ffa746", "#19012c"],
        )


@unittest.skipUnless(HAS_PILLOW, "the pictures step needs Pillow")
class Found(Shelf):
    def ask(self, prompt, schema):
        self.prompts.append(prompt)
        return {
            "parts": [
                {"n": 1, "look_for": ["nothing by this name", "storm at sea"]},
                {"n": 2, "look_for": ["storm at sea"]},
                {"n": 3, "look_for": ["storm at sea"]},
                {"n": 9, "look_for": ["a part the book does not have"]},
            ]
        }

    def setUp(self):
        super().setUp()
        self.prompts = []
        self.get = commons(
            {
                "storm at sea": [
                    page(1, "A drawing of a Storm"),
                    page(2, "Storm at Sea"),
                    page(3, "Another Storm"),
                ]
            }
        )

    def chapter(self, cid):
        return json.loads((self.book / "chapters" / f"{cid}.json").read_text(encoding="utf-8"))

    def test_each_part_gets_its_own_free_picture_with_its_credit(self):
        made = pictures.make(self.book, self.book, self.ask, get=self.get, pause=0)
        # the drawing on bare paper is turned away: two scenes are left, the third part stays bare
        self.assertEqual(made, (2, 3))
        first, second = self.chapter("c001")["art"], self.chapter("c002")["art"]
        self.assertEqual((first["src"], first["file"]), ("found/c001.jpg", "File:Storm at Sea.jpg"))
        self.assertEqual(second["file"], "File:Another Storm.jpg")  # no picture is used twice
        self.assertIn("Public domain, via Wikimedia Commons.", first["credit"])
        self.assertNotIn("art", self.chapter("c003"))
        for name in ("found/c001.jpg", "thumbs/c001.jpg", "found/c002.jpg"):
            self.assertTrue((self.book / name).is_file(), name)
        worlds = json.loads((self.book / "worlds.json").read_text(encoding="utf-8"))
        self.assertEqual([w["thumb"] for w in worlds], [True, True, False])
        self.assertEqual(worlds[0]["ground"], pictures.fit(0.28, 0.14, worlds[0]["h"][0]))
        self.assertIn("1. Part 0: The harbour decided", self.prompts[0])

    def test_a_second_run_leaves_found_pictures_alone_and_removal_takes_them_out(self):
        pictures.make(self.book, self.book, self.ask, get=self.get, pause=0)
        before = self.chapter("c001")["art"]
        self.assertEqual(
            pictures.make(self.book, self.book, self.ask, get=self.get, pause=0), (0, 1)
        )
        self.assertEqual(self.chapter("c001")["art"], before)
        work.note(self.book, "pictures", state="done")
        self.assertEqual(work.remove(self.library, self.slug, "pictures")["gone"], 2)
        self.assertNotIn("art", self.chapter("c001"))
        self.assertFalse((self.book / "found" / "c001.jpg").exists())
        self.assertFalse((self.book / "worlds.json").exists())
        self.assertNotIn("pictures", work.ledger(self.book))
        with self.assertRaises(ValueError):
            work.remove(self.library, self.slug, "pictures")

    def test_new_books_get_pictures_once_an_engine_for_sentences_is_chosen(self):
        shop = work.Workshop(self.library, run=False)
        shop.auto(self.slug)
        self.assertNotIn("pictures", [j["step"] for j in shop.jobs])
        with unittest.mock.patch.object(
            work,
            "settings",
            lambda library: {
                **work.DEFAULTS,
                "engines": {"eyes": {"engine": ""}, "words": {"engine": "tool:x"}},
            },
        ):
            shop.auto(self.slug)
        self.assertIn("pictures", [j["step"] for j in shop.jobs])


if __name__ == "__main__":
    unittest.main()
