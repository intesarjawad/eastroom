# Changelog

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [semantic versioning](https://semver.org/).

## [Unreleased]

The app has a new name: **East Room**. It was called Devour. The command is `eastroom`, the repository is `intesarjawad/eastroom` and the demo is at eastroom.intesarjawad.com. Nothing you had is lost: a library in `~/.devour` is taken over as `~/.eastroom` at the first start, each device carries its own reading record over, and running the install line again replaces the old command and icon.

### Added
- Pictures for books that have none. With an AI tool chosen for sentences in Settings, the workshop asks it to name a painting, an engraving or an old photograph for each part from how the part begins. Home looks for that name on Wikimedia Commons and keeps the first file that is in the public domain or CC0. The reader shows it behind the part in the part's two colours, and names its maker where the part ends. It runs for new books by itself, from the Workshop for the ones you have, and "Remove found pictures" takes them out again. A model never makes a picture.
- One-line installers: `install.sh` for macOS and Linux, `install.ps1` for Windows. They need no Python and no administrator rights. They fetch uv when it is missing, install East Room with PDF support, and leave an East Room icon in Applications, the app menu or the Start menu. The same line updates, and a second form removes everything but your books. An automated run installs, uses and removes East Room on all three systems for every change.
- Opening East Room a second time shows the one that is already running, without touching its library. Before, the second start ended with an error about the port.
- The README shows a library of 17 public-domain books and a second recording of 336 on the shelves. The demo site is built from the same 17, and its Odyssey has pictures from Wikimedia Commons: `tools/demo_pictures.py` runs the pictures step with a kept list of names in place of a model.

- The demo takes your own books. Add an EPUB, a comic (CBZ) or a text file on the demo site and your browser reads it itself, with the same Python that Home runs, on Pyodide. The book is kept in that browser's storage and stands on the shelf beside the others; Settings, Devices lists the books added this way and removes them. No server receives the file. PDF stays with the installed app. `tools/demo_runtime.py` fetches the pinned runtime for the site and checks its hash.

### Changed
- The demo and the README's pictures have Alice's Adventures in Wonderland in place of The Art of War. Lionel Giles, who translated that edition, died in 1958, so outside the USA his text stays in copyright until 2029. The README's first recording now shows the books with their covers facing out; the recording of 336 books keeps the spines.
- The README starts with the install line and a three-step start written for people who have never opened a terminal. Developer notes moved to the end. The setup guide uses the installed app and no longer asks for pip.
- In the demo, Settings says in plain words that there is no Home behind it. Before, it showed a status number.
- Library: the case fills the window up to 2568 px wide instead of stopping at 1640 px, and the rail runs the whole width of the room. On a wider window the case stands against walnut panelling strung with gold.
- Library: the slab is a white marble with gold veins of its own, laid as one piece. It is no longer one half beside its mirror image.
- Library: under the last row of books the shelves go on, empty, to the foot of the window.
- Library: the rail's lettering, the line around the search field and the Add button are gold leaf on the walnut, with the wood's grain running through them. `tools/make_room.py` makes the leaf from the walnut tile, so the grain in a letter is the grain of the wood around it.
- Library: the room is shown whole or not at all. The window stays dark until the rail, the standards, the slab, the shelves and the back of the case can all be drawn with their wood and stone. Then they come up together and the books are set down on them. Before, the standards and one gold line stood alone while the rest filled in.
- Library: the case no longer waits for book colours, and covers are read for their colours in idle time. A large library shows its case sooner for it.
- Library: the note about Home shows only when it has something to say: changes that have not reached Home yet, or a device that cannot save. It no longer reports each time Home was reached.
- East Room needs Python 3.11 or newer. Python 3.10 is past its end of life, and the libraries behind PDF reading and the voices (Pillow, filelock) publish their security fixes only for newer versions. The installers bring their own Python, so nothing changes for anyone who used them.

### Fixed
- Export: pictures that stand inside a book's text, and the pages of a comic, were left out of the exported site. The demo's Alice in Wonderland was missing John Tenniel's drawings for it.
- Export: a library with no books in it can be exported.
- Settings: the Workshop page could lose its answer from Home when it asked at the instant a step was replacing a file. Seen as a failed check on Windows.
- Reader: a heading too long for one line ran off the right edge of the window. It now stands in rows of one size that fit the column, on a phone too, and a row stays lit after it has been read.
- Library: on a wide window the back of the case no longer ends in a hard edge beside the standards.
- Library: in the phone's menu the note about Home no longer lies across the Settings link.
- Library: the open books on the slab were drawn in the wrong place when another device's reading places arrived while the page was being built. The slab is now built once, with those places in hand, and measures its books correctly while they are being set down.
- Home: a file sent under a name no disk would take (a zero byte, an endless suffix) is refused with the usual reason. Before, the request ended without an answer.
- Home: "every book" is accepted only by the workshop. Remove, restore and the other actions name one book.
- Home: a book, device or voice name that ends in a line break is refused by the name check itself.
- Settings: the file that keeps a server's key is readable by its owner alone even when an earlier run was stopped while writing it.

## [0.3.0] - 2026-11-13

### Added
- The library is one bookcase. Fluted walnut standards run the height of the page, the shelves are walnut boards, and the back of the case stands behind the books in true depth, lit by the same light as the books.
- The book you are in is named on a slab of white marble at the top of the case, with gold in the stone's veins, a gold button and a gold line of parts. Its name is set in Literata, the face the books are read in.
- The other open books stand spine out on the slab's sill at the size of the book beside them. They are the shelves' own books: reach for one and it turns its cover to you, press and it opens.
- On a phone and a tablet the rail is one row (find, add, and one button for Ideas, Settings and the note about Home) and the dock is one row (what is shown, and one button for order and form).
- Settings and Ideas stand before the same walnut, in the same cream and gold.
- `tools/make_room.py` makes the room's three pictures from two CC0 scans.
- Type checking in strict mode, a pinned linter and formatter, `make check`, CodeQL and weekly dependency updates.

### Changed
- Library: a new order, cover size or view no longer sends every book on its own path. What stands on the shelves steps back, and the new arrangement steps forward row by row. Filtering and opening a book's details slide books along their shelf; a book bound for another shelf leaves its place and appears in the new one.
- Library: the room no longer takes the colours of the book under the pointer. A book's own colours begin when you open it.
- Touch: a press no longer flashes the system highlight, hover styles no longer stick after a tap, and the page keeps clear of the notch and the home bar.

### Fixed
- Library: titles no longer flash across the shelves when switching from the list to the shelves, and list rows no longer scatter from shelf positions.
- Windows: adding a book works (the upload is no longer read from a file that is still open), books with accents or curly quotes can be written (every text file is UTF-8), and a chapter read or a book removed while a step is running on it is tried again instead of refused.
- A book whose manifest names an entry without a file is imported without that entry instead of stopping.

## [0.2.0] - 2026-11-12

### Added
- One app for every device: installable from the browser, with the app and the books you are reading kept on the device and usable without a connection.
- One reading record per device (place, kept lines, finished parts, time read), combined in the app. Two devices can no longer overwrite each other. The library offers the furthest place when it differs from the newest.
- `eastroom --origin URL`: name the private address whose pages may save to the library. [docs/setup.md](docs/setup.md) covers the Tailscale Serve setup.
- `eastroom --voice plain` and `eastroom --voice storyteller`: narrate the books being read, from the reading place on, one sentence at a time with exact sentence times.
- The device's own voice reads parts that have no narration yet, with the light following its word events.
- Kept lines from the reader (K), marked in the text. "Keep on this device" for a whole book's narration.
- Adding a book from any device shows upload progress. The same file twice is one book. Files with copy protection are refused with a plain message.
- Colours for books without a colour set, stepped from the cover's strongest hue.
- Recorded interface sounds. Sources and terms are in [THIRD-PARTY.md](THIRD-PARTY.md).
- PDF, CBZ, plain text and Markdown files beside EPUB. A PDF of prose becomes flowing text with running heads removed and broken words joined. Comics, fixed-layout EPUBs and scanned PDFs are read page by page, with a light that moves from panel to panel.
- Pictures, captions, tables and notes from the book appear in the reader. A note opens under the sentence that cites it. A press on a picture enlarges it.
- Key lines: three to five sentences a part in the author's own words, ranked without a model, shown as a recap when the next part starts. A local model may choose among the ranked sentences.
- Words read are recorded per day beside reading time, and a day is now the reader's own day instead of Greenwich's.
- Ideas: every kept line by book, with your own note on each, a search and a Markdown export.
- Settings with five rooms (Reading, Workshop, Engines, Storage, Devices). The workshop runs one job at a time, survives a restart, and can read a book's file again, make key lines, match spine lettering and record a voice. `eastroom --voice NAME --book NAME` narrates one book.
- Spine lettering matched to the cover, set in one of 12 open faces. Font licences are in [THIRD-PARTY.md](THIRD-PARTY.md).
- Engines: the two jobs that can use a model (looking at covers, choosing key lines) go to whoever you choose in Settings. That is an AI tool already signed in on Home (Claude Code, Codex, agy, OpenCode) or any server that speaks the OpenAI chat API (Ollama, LM Studio, OpenRouter and others). No model is named in the code.
- Settings are changed by holding the thing itself. Reading shows a passage of the book you are in: a caliper in the margin sizes the real text, a ruler sets the pace and the light on the page obeys it, and each key shows its effect on the page. Engines is two jobs joined by a line to whoever does each. Every control works from the keyboard, and the light stands still when motion is reduced. The Devices room shows the address your phone opens, and "Everything for this book" in the library opens the Workshop on that book. Nothing in a room moves when you press something else: what can be done with a book opens beside its button, a room is updated in place instead of being rebuilt, and no scroll area sits inside the page.
- Removing a book, its file or one voice holds it for seven days. Your place and kept lines stay unless you ask to forget them. Home keeps the file you added so a book can be read again by a newer version.

- Going into a book and back is one move: the cover comes forward on its own room, the reader opens on that same frame, and the text arrives under it.
- A small library is shown whole: the book you are in, and the others standing beside it with their author, time left and a line of parts. A press on a part opens the book there.
- The contents of a book without pictures show each part's number, title and opening words. The library can be reached from the contents.

- A real icon for the tab and the Home Screen: the word under the reading light, drawn from the app's own reading face and colours by `tools/make_icons.py`. The old one was a reduced screenshot, and `/favicon.ico` answered 404.
- An empty library opens on the place the first book will take and asks for it, with the file types it reads. Search, filters and the count stay out of the way until there is a book.
- The Devices room gives the three steps to reach Home from a phone when no private address is set.

### Security
- Files that come out of a book are served sandboxed and cannot run as a page of the app. A cover must be a picture.
- Saving is refused for pages from any address that was not named at start.
- A page on this computer may save only when it comes from Home's own port. Another local program's page is refused.
- Settings sent by a page are checked: a server is a plain address, an engine is one of four known tools or one of your servers, and the program that records voices can be set only in `settings.json` by hand.
- A server's key is kept in a file only you can read and is never sent back to a page. The key is used only for the address it was given for, and a server that redirects is not followed. AI tools are started in an empty folder with their own tools off, read-only or in planning mode, are never told to approve their own actions, and a model's name can never be read as a flag.
- Home answers only when it is asked for by its own address or one named at start.
- A comic archive that names one file many times is counted and read once. Fixed-layout books have a 1 GB budget for their pages.

### Fixed
- "Start with the computer" now belongs to the library that turned it on. A second library no longer shows another one's entry as its own, and cannot remove it.
- The word follower stood three lines above its word after arriving from the library: lines were measured while the page was still drawn at 97%.
- Pressing the book at the top of the library skipped its opening motion (a name inside `hero()` hid `open`).

### Changed
- The library is shelves of books: every book is a lit solid with its own cover, a lettered spine and pages, drawn in one WebGL pass (`shelf.js`). The book under the pointer comes out and turns its cover to you, sorting re-shelves the books, and a pressed book comes forward into the reader. A few books stand face out. Without WebGL2 the wall of covers remains.
- Each book on the shelves is built as a bound book: two boards with rounded corners and turned edges, a block of pages set inside them with a hollow fore-edge, a rounded back, a joint groove and headbands. About one book in four has gilt page edges.
- The reader's word follower rests on a word, leaves in time to land on the next one as it begins, stretches as it travels and leaves a trail.
- The reader and library are rebuilt: `index.html` is the library and `read.html` the reader.
- Narration moved out of chapter files into records beside them (`voice/<voice>/<chapter>.json`). Existing narration is copied once.
- Addresses carry a stamp and are cached for good; the reading state is never cached.

### Compatibility
- A `state.json` from 0.1 is still read, as a device named "before", and is not written again.

## [0.1.0] - 2026-11-11

### Added
- `eastroom book.epub`: import EPUB files with the standard library only and open the reader in the browser.
- Library: the book you are reading, the time left in it, and a shelf of the others, each in its cover's colour.
- Reader: a highlighter paced in words a minute, parts cut at the author's headings, a screen between parts, kept lines, contents, text size, saved place.
- Narration playback with a voice on/off switch for books that carry audio and timings.
- `eastroom --export DIR`: write the library as a static site that needs no server.
