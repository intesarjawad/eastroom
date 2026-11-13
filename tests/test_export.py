import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from eastroom import export
from tests.epub_fixture import PARAGRAPH, make_epub, png

BODY = (
    f"<h2>One</h2>{PARAGRAPH}<figure><img src='img/map.png' alt='A map'/></figure>{PARAGRAPH}"
    f"{PARAGRAPH}"
)


class OneFile(unittest.TestCase):
    """What a visitor's browser runs on a published copy: a file in, the book's files out."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.file = Path(self.tmp.name) / "the-harbour.epub"
        self.file.write_bytes(make_epub([BODY], files={"img/map.png": png(800, 600)}))
        self.out = Path(self.tmp.name) / "out"

    def test_the_book_lands_at_the_addresses_the_page_asks_for(self):
        book = export.read_here(self.file, self.out)
        slug, part = book["slug"], book["chapters"][0]
        text = json.loads((self.out / "api" / "book" / slug / part["id"]).read_text("utf-8"))
        self.assertTrue(part["v"] and text["takeaways"])  # stamped, and with its key lines
        figure = next(b for b in text["blocks"] if b["k"] == "f")
        # a picture that stands in the text travels with it
        self.assertTrue((self.out / "media" / slug / figure["src"]).is_file())
        self.assertEqual(len(book["source"]), 64)  # the file's own mark: the same file is known

    def test_a_folder_name_in_use_is_not_given_again(self):
        first = export.read_here(self.file, self.out)["slug"]
        again = export.read_here(self.file, Path(self.tmp.name) / "again", [first, "../x"])
        self.assertEqual(again["slug"], first + "-2")

    def test_a_file_that_is_not_a_book_says_so(self):
        note = Path(self.tmp.name) / "note.txt"
        note.write_text("Too short to be a book.", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "no readable chapters"):
            export.read_here(note, self.out)

    def test_a_published_copy_carries_the_code_its_visitors_run(self):
        site = Path(self.tmp.name) / "site"
        export.export_site(Path(self.tmp.name) / "empty", site)
        with zipfile.ZipFile(site / "py" / "eastroom.zip") as package:
            names = package.namelist()
        self.assertIn("eastroom/export.py", names)
        self.assertTrue(all(n.startswith("eastroom/") and n.endswith(".py") for n in names))


if __name__ == "__main__":
    unittest.main()
