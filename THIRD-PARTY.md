# Third-party notices

East Room's own code is under the MIT licence (see `LICENSE`). The files below ship inside the app and stay under their own terms.

## Code

| What | Where | Licence |
|---|---|---|
| GSAP 3.15.1, GreenSock | `eastroom/web/vendor/gsap.min.js` | [Standard "no charge" GSAP licence](https://gsap.com/standard-license). It is not an open-source licence. It allows free use in websites and apps and does not allow use in a visual animation builder that competes with Webflow. If you fork East Room, read it. |
| Lenis 1.3.27, darkroom.engineering | `eastroom/web/vendor/lenis.min.js` | MIT, text in `eastroom/web/vendor/LICENSE-lenis.txt` |
| Pretext, from [chenglou/pretext](https://github.com/chenglou/pretext) | `eastroom/web/vendor/pretext/` | MIT, text in `eastroom/web/vendor/pretext/LICENSE` |

The demo site also serves [Pyodide](https://pyodide.org) 314.0.7, unchanged, so that a visitor's browser can read their own book files. It is not in this repository and not in the package: `tools/demo_runtime.py` fetches the release from [github.com/pyodide/pyodide](https://github.com/pyodide/pyodide/releases/tag/314.0.7) when the site is built. Pyodide is under the Mozilla Public Licence 2.0 and carries CPython under the Python Software Foundation licence.

## Typefaces

| What | Where | Licence |
|---|---|---|
| Literata | `eastroom/web/fonts/Literata*.woff2` | SIL Open Font Licence 1.1, text in `eastroom/web/fonts/OFL-Literata.txt` |
| Science Gothic | `eastroom/web/fonts/ScienceGothic.woff2` | SIL Open Font Licence 1.1, text in `eastroom/web/fonts/OFL-ScienceGothic.txt` |
| League Spartan | `eastroom/web/fonts/LeagueSpartan.woff2` | SIL Open Font Licence 1.1, text in `eastroom/web/fonts/OFL-LeagueSpartan.txt` |
| EB Garamond | `eastroom/web/fonts/EBGaramond.woff2` | SIL Open Font Licence 1.1, text in `eastroom/web/fonts/OFL-EBGaramond.txt` |
| Playfair Display | `eastroom/web/fonts/PlayfairDisplay.woff2` | SIL Open Font Licence 1.1, text in `eastroom/web/fonts/OFL-PlayfairDisplay.txt` |
| Cinzel | `eastroom/web/fonts/Cinzel.woff2` | SIL Open Font Licence 1.1, text in `eastroom/web/fonts/OFL-Cinzel.txt` |
| Caveat | `eastroom/web/fonts/Caveat.woff2` | SIL Open Font Licence 1.1, text in `eastroom/web/fonts/OFL-Caveat.txt` |
| Zilla Slab | `eastroom/web/fonts/ZillaSlab.woff2` | SIL Open Font Licence 1.1, text in `eastroom/web/fonts/OFL-ZillaSlab.txt` |
| UnifrakturCook | `eastroom/web/fonts/UnifrakturCook.woff2` | SIL Open Font Licence 1.1, text in `eastroom/web/fonts/OFL-UnifrakturCook.txt` |
| Pinyon Script | `eastroom/web/fonts/PinyonScript.woff2` | SIL Open Font Licence 1.1, text in `eastroom/web/fonts/OFL-PinyonScript.txt` |
| Poiret One | `eastroom/web/fonts/PoiretOne.woff2` | SIL Open Font Licence 1.1, text in `eastroom/web/fonts/OFL-PoiretOne.txt` |
| Special Elite | `eastroom/web/fonts/SpecialElite.woff2` | Apache Licence 2.0, text in `eastroom/web/fonts/LICENSE-SpecialElite.txt` |

## Pictures

The library's room is made from two pictures by `tools/make_room.py`. The files in `eastroom/web/room/` are the results.

| Picture | Source | Terms |
|---|---|---|
| `marble.webp` | [Marble 107](https://www.sharetextures.com/textures/floor/marble-107) by ShareTextures, base colour map of the 4K set | CC0 1.0 |
| `walnut.webp`, `post.webp`, `gilt.webp` | [Rosewood Veneer 02](https://polyhaven.com/a/rosewood_veneer_02) by Jenelle van Heerden, Poly Haven, 2K diffuse map | CC0 1.0 |

## Books in the pictures

The recordings and stills in `docs/media` show [Standard Ebooks](https://standardebooks.org/) editions with their covers, and the Meditations kept in `samples/`. Standard Ebooks states that the source texts and cover artwork are in the United States public domain and gives its own work to the public domain (CC0 1.0). The demo site is built from the same books.

The first recording also shows John William Waterhouse's *Ulysses and the Sirens* (1891), in the public domain, from [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:John_William_Waterhouse_-_Ulysses_and_the_Sirens_(1891).jpg). The demo site fetches the pictures named in `tools/demo-pictures.json` from Wikimedia Commons when it is built. The pictures step keeps only files that Commons marks as public domain or CC0, and each part of the book names its picture's maker and links to its page there.

## Sample book

`samples/meditations.epub` is Project Gutenberg's [ebook 2680](https://www.gutenberg.org/ebooks/2680), unchanged: the Meditations of Marcus Aurelius, in the public domain in the USA. It carries Project Gutenberg's own licence inside the file. Check the law where you live before passing it on.

## Sounds

The eight interface sounds in `eastroom/web/sfx/` are short cuts from real recordings. `eastroom/web/sfx/sources.json` names the recording and the cut for each one.

| Sounds | Source | Terms |
|---|---|---|
| `go`, `stop`, `key`, `tick`, `part`, `book`, `open` | Recordings by 344 Audio, InMotionAudio, Sonic Bat and Cinematic Sound Design, from the Sonniss GameAudioGDC bundles | The [Sonniss GDC bundle licence](https://sonniss.com/gdc-bundle-license/) allows use inside a finished project without attribution. It does not allow passing the sounds on as a sound library or using them to train a model. Please do not lift them out of this repository for reuse: get the bundle from Sonniss instead. |
| `turn` | Kenney, Casino Audio | CC0 |

## Not included

The narration models are not part of this package. `eastroom --voice` downloads the one you ask for on first use, under that model's own licence.
