import json
import tempfile
import unittest
from pathlib import Path

from eastroom import ingest
from tests.epub_fixture import PARAGRAPH, make_epub, png


def read(documents: list[str], **metadata) -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "book.epub"
        path.write_bytes(make_epub(documents, **metadata))
        return ingest.read_epub(path)


class ParseBlocks(unittest.TestCase):
    def test_keeps_the_authors_words_exactly(self):
        blocks = ingest.parse_blocks("<p>He said: “Stay.”  Then   he left.</p>")
        self.assertEqual(blocks[0]["t"], "He said: “Stay.” Then he left.")

    def test_tells_headings_quotations_and_attributions_apart(self):
        blocks = ingest.parse_blocks(
            "<h2>Keys</h2><blockquote><p>Love is a kind of war.</p>"
            "<p>—Ovid, The Art of Love</p></blockquote><p>Plain text.</p>"
        )
        self.assertEqual([b["k"] for b in blocks], ["h", "q", "a", "p"])

    def test_verse_keeps_the_lines_the_author_broke(self):
        blocks = ingest.parse_blocks(
            "<p>How doth the little crocodile<br/>\n  Improve his shining tail,<br/><br/>"
            "How cheerfully</p><h2>One<br/>Two</h2>"
        )
        self.assertEqual(
            [b["t"] for b in blocks],
            [
                "How doth the little crocodile\nImprove his shining tail,\n\nHow cheerfully",
                "One Two",
            ],
        )

    def test_footnote_markers_and_scripts_are_not_text(self):
        blocks = ingest.parse_blocks("<p>A claim<sup>12</sup> stands.</p><script>alert(1)</script>")
        self.assertEqual([b["t"] for b in blocks], ["A claim stands."])

    def test_a_picture_heading_takes_its_name_from_its_anchor(self):
        blocks = ingest.parse_blocks(
            '<h2><a id="CHAPTER_XII"/><img src="x.jpg" alt=""/></h2><p>Text.</p>'
        )
        self.assertEqual(blocks[0], {"k": "h", "t": "Chapter XII", "lv": 2})


class Chapters(unittest.TestCase):
    def test_one_file_holding_many_chapters_is_split_at_its_headings(self):
        body = "".join(f"<h2>CHAPTER {n}</h2>{PARAGRAPH}" for n in range(1, 5))
        book = read([body])
        self.assertEqual(
            [c["title"] for c in book["chapters"]],
            ["Chapter 1", "Chapter 2", "Chapter 3", "Chapter 4"],
        )

    def test_a_chapter_cut_across_two_files_stays_one_chapter(self):
        first = f"<h2>One</h2>{PARAGRAPH}<h2>Two</h2>{PARAGRAPH}"
        second = f"{PARAGRAPH}<h2>Three</h2>{PARAGRAPH}"
        book = read([first, second])
        self.assertEqual([c["title"] for c in book["chapters"]], ["One", "Two", "Three"])
        self.assertEqual(len(book["chapters"][1]["blocks"]), 2)

    def test_subheadings_stay_inside_their_chapter_as_parts(self):
        book = read(
            [f"<h1>Chapter {n}</h1>{PARAGRAPH}<h2>Dangers</h2>{PARAGRAPH}" for n in range(3)]
        )
        self.assertEqual(len(book["chapters"]), 3)
        self.assertEqual([b["k"] for b in book["chapters"][0]["blocks"]], ["p", "h", "p"])

    def test_a_book_without_heading_tags_still_gets_titles(self):
        book = read([f"<p>The Siren</p>{PARAGRAPH}", f"<p>The Rake</p>{PARAGRAPH}"])
        self.assertEqual([c["title"] for c in book["chapters"]], ["The Siren", "The Rake"])

    def test_distributor_header_and_licence_are_not_part_of_the_book(self):
        body = (
            "<p>The Project Gutenberg eBook of A Test Book</p>"
            "<p>*** START OF THE PROJECT GUTENBERG EBOOK A TEST BOOK ***</p>"
            f"<h2>One</h2>{PARAGRAPH}<h2>Two</h2>{PARAGRAPH}<h2>Three</h2>{PARAGRAPH}"
            "<p>*** END OF THE PROJECT GUTENBERG EBOOK A TEST BOOK ***</p>"
            f"<h2>Licence</h2>{PARAGRAPH}"
        )
        book = read([body])
        self.assertEqual([c["title"] for c in book["chapters"]], ["One", "Two", "Three"])
        self.assertNotIn("Gutenberg", json.dumps(book["chapters"]))

    def test_no_words_are_lost_between_chapters(self):
        body = "".join(f"<h2>Part {n}</h2>{PARAGRAPH}" for n in range(6))
        book = read([body])
        words = sum(len(b["t"].split()) for c in book["chapters"] for b in c["blocks"])
        self.assertEqual(words, 6 * len(ingest.parse_blocks(PARAGRAPH)[0]["t"].split()))


class Metadata(unittest.TestCase):
    def test_author_is_a_plain_name(self):
        cases = {
            ("Jane Austen", "Austen, Jane"): "Jane Austen",
            ("active 6th century B.C. Sunzi", "Sunzi, active 6th century B.C."): "Sunzi",
            (
                "Emperor of Rome Marcus Aurelius",
                "Marcus Aurelius, Emperor of Rome, 121-180",
            ): "Marcus Aurelius",
        }
        for (creator, file_as), expected in cases.items():
            with self.subTest(creator=creator):
                self.assertEqual(
                    read([PARAGRAPH * 2], creator=creator, file_as=file_as)["author"], expected
                )


class Ingest(unittest.TestCase):
    def test_writes_an_index_and_one_file_per_chapter(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "book.epub"
            path.write_bytes(
                make_epub(["".join(f"<h2>Part {n}</h2>{PARAGRAPH}" for n in range(3))])
            )
            slug = ingest.ingest(path, Path(tmp) / "library")
            index = json.loads(
                (Path(tmp) / "library" / slug / "book.json").read_text(encoding="utf-8")
            )
            self.assertEqual(
                (slug, index["author"], len(index["chapters"])), ("a-test-book", "Jane Austen", 3)
            )
            chapter = json.loads(
                (Path(tmp) / "library" / slug / "chapters" / "c001.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(set(chapter["blocks"][0]), {"id", "k", "t"})

    def test_a_book_with_no_text_is_refused_with_a_reason(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "scan.epub"
            path.write_bytes(make_epub(['<img src="page1.jpg"/>']))
            with self.assertRaisesRegex(ValueError, "no readable chapters"):
                ingest.ingest(path, Path(tmp) / "library")


if __name__ == "__main__":
    unittest.main()


class WhatABookCarriesBesidesProse(unittest.TestCase):
    def test_a_picture_keeps_its_place_its_size_and_its_caption(self):
        body = (
            f"<h2>One</h2>{PARAGRAPH}<figure><img src='img/map.png' alt='A map'/>"
            f"<figcaption>The coast in 1850.</figcaption></figure>{PARAGRAPH}"
        )
        book = read([body], files={"img/map.png": png(800, 600)})
        kinds = [b["k"] for b in book["chapters"][0]["blocks"]]
        self.assertEqual(kinds, ["p", "f", "p"])
        fig = book["chapters"][0]["blocks"][1]
        self.assertEqual(
            (fig["t"], fig["w"], fig["h"], fig["alt"]), ("The coast in 1850.", 800, 600, "A map")
        )
        self.assertEqual(list(book["pictures"]), [fig["src"]])

    def test_a_picture_inside_a_paragraph_follows_it_and_does_not_cut_it(self):
        blocks = ingest.parse_blocks("<p>Before <img src='a.png'/> after.</p>")
        self.assertEqual([(b["k"], b["t"]) for b in blocks], [("p", "Before after."), ("f", "")])

    def test_ornaments_and_the_cover_are_not_pictures_of_the_book(self):
        cover = png(600, 900, b"cover")
        body = f"<h2>One</h2><p><img src='rule.png'/><img src='again.png'/></p>{PARAGRAPH}"
        book = read(
            [body], cover=("cover.png", cover), files={"rule.png": png(300, 20), "again.png": cover}
        )
        self.assertEqual([b["k"] for b in book["chapters"][0]["blocks"]], ["p"])
        self.assertEqual(book["pictures"], {})

    def test_a_caption_set_as_a_paragraph_belongs_to_its_picture(self):
        blocks = ingest.parse_blocks(
            "<div><img src='a.png'/></div><p class='caption'>Fig. 1: the engine.</p><p>Prose.</p>"
        )
        self.assertEqual(
            [(b["k"], b["t"]) for b in blocks], [("f", "Fig. 1: the engine."), ("p", "Prose.")]
        )

    def test_a_note_leaves_the_flow_and_stays_with_the_sentence_that_points_to_it(self):
        text = (
            "<p>The fleet sailed at dawn.<sup><a epub:type='noteref' href='#n1'>1</a></sup>"
            " Nobody saw it go.</p>"
        )
        note = (
            "<aside epub:type='footnote' id='n1'><p>1. So says the harbour log."
            " <a epub:type='backlink' href='#r1'>↩</a></p></aside>"
        )
        book = read([f"<h2>One</h2>{PARAGRAPH}{text}{note}"])
        blocks = book["chapters"][0]["blocks"]
        self.assertEqual(blocks[-1]["t"], "The fleet sailed at dawn. Nobody saw it go.")
        self.assertEqual(blocks[-1]["n"], ["So says the harbour log."])
        self.assertNotIn("harbour log", " ".join(b["t"] for b in blocks))

    def test_notes_kept_at_the_end_of_the_book_are_found(self):
        text = "<p>The fleet sailed at dawn.<a epub:type='noteref' href='d1.xhtml#n7'>7</a></p>"
        notes = "<ol><li epub:type='endnote' id='n7'><p>From the harbour log.</p></li></ol>"
        book = read([f"<h2>One</h2>{PARAGRAPH}{text}", notes])
        self.assertEqual(book["chapters"][0]["blocks"][-1]["n"], ["From the harbour log."])
        self.assertEqual(len(book["chapters"]), 1)

    def test_a_table_keeps_its_rows(self):
        blocks = ingest.parse_blocks(
            "<table><caption>Losses</caption><tr><th>Year</th><th>Ships</th></tr><tr><td>1850</td><td><p>12</p></td></tr></table><p>After.</p>"
        )
        self.assertEqual(
            blocks[0],
            {"k": "t", "t": "Losses", "lv": 0, "rows": [["Year", "Ships"], ["1850", "12"]]},
        )
        self.assertEqual(blocks[1]["t"], "After.")

    def test_a_table_used_to_place_text_gives_its_text_back(self):
        blocks = ingest.parse_blocks("<table><tr><td>Only this line.</td></tr></table>")
        self.assertEqual(blocks, [{"k": "p", "t": "Only this line.", "lv": 0}])

    def test_a_fixed_layout_book_is_a_book_of_pages(self):
        pages = {f"p{n}.png": png(900, 1300, bytes([n])) for n in range(3)}
        book = read(
            [f"<div><img src='p{n}.png'/></div>" for n in range(3)], files=pages, fixed=True
        )
        self.assertEqual(
            (book["kind"], [b["w"] for b in book["chapters"][0]["blocks"]]),
            ("pages", [900, 900, 900]),
        )

    def test_sizes_are_read_from_the_first_bytes(self):
        self.assertEqual(ingest.image_size(png(640, 480)), (640, 480))
        self.assertEqual(
            ingest.image_size(
                b"GIF89a" + (320).to_bytes(2, "little") + (200).to_bytes(2, "little")
            ),
            (320, 200),
        )
        jpeg = (
            b"\xff\xd8\xff\xe0\x00\x10"
            + b"\x00" * 14
            + b"\xff\xc0\x00\x11\x08"
            + (480).to_bytes(2, "big")
            + (640).to_bytes(2, "big")
            + b"\x03" * 10
        )
        self.assertEqual(ingest.image_size(jpeg), (640, 480))
        self.assertIsNone(ingest.image_size(b"<svg/>"))


class ReadingAgain(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.library = Path(self.tmp.name)
        self.file = self.library / "in.epub"
        body = f"<h2>One</h2>{PARAGRAPH}<img src='map.png'/>{PARAGRAPH}"
        self.file.write_bytes(make_epub([body], files={"map.png": png(800, 600)}))

    def tearDown(self):
        self.tmp.cleanup()

    def test_the_original_is_kept_and_the_book_can_be_read_again(self):
        slug = ingest.ingest(self.file, self.library)
        root = self.library / slug
        self.assertEqual((root / "original.epub").read_bytes(), self.file.read_bytes())
        self.assertTrue((root / "pictures" / "p0001.png").is_file())
        index = json.loads((root / "book.json").read_text(encoding="utf-8"))
        index["title"], index["spine"] = "Corrected", {"face": "x"}
        (root / "book.json").write_text(json.dumps(index), encoding="utf-8")
        (root / "chapters" / "c009.json").write_text("{}", encoding="utf-8")
        self.assertEqual(ingest.reread(self.library, slug), 1)
        again = json.loads((root / "book.json").read_text(encoding="utf-8"))
        self.assertEqual(
            (again["title"], again["spine"], again["chapters"][0]["pictures"]),
            ("Corrected", {"face": "x"}, 1),
        )
        self.assertFalse((root / "chapters" / "c009.json").exists())

    def test_a_book_from_before_originals_were_kept_says_what_to_do(self):
        slug = ingest.ingest(self.file, self.library)
        (self.library / slug / "original.epub").unlink()
        with self.assertRaisesRegex(ValueError, "Add its file again"):
            ingest.reread(self.library, slug)
        self.assertEqual(ingest.ingest(self.file, self.library), slug)
        self.assertTrue((self.library / slug / "original.epub").is_file())

    def test_other_kinds_of_file_are_refused_by_name(self):
        other = self.library / "notes.docx"
        other.write_bytes(b"x")
        with self.assertRaisesRegex(ValueError, "EPUB, PDF, CBZ"):
            ingest.ingest(other, self.library)
