# Design: the bookcase

The library opens on one bookcase in a dark room. Fluted walnut standards run up both sides, walnut shelves cross between them, and the top bay holds a slab of white marble with gold in its veins. The book you are in stands on the slab's sill with its name let into the stone beside it. Everything below is your books, standing on the shelves as objects.

A reader who stopped mid-chapter should be back in the book in one press. So the first thing on the page is that book, its name, and one gold button. The shelves come second.

## What it takes, and from where

- **College and club libraries.** Fluted pilasters carry each bay, the wood is dark and evenly lit, and lettering sits on a member of the joinery, never beside it. I studied photographs of the Long Room at Trinity College Dublin and of the honours boards at Lord's for how small and how plain such lettering is.
- **One piece of stone.** The slab is a single cut of white marble with gold veins, laid whole. An earlier version opened one cut beside its mirror image, as masons do, and the symmetry read as a trick instead of stone.
- **Gold that belongs to the stone.** The veins in the slab are the marble's own. An earlier version painted gold into a plain white scan, and it showed.
- **A wall worth standing against.** A window wider than the case shows walnut panelling behind it, each panel strung with a line of gold. Empty shelves beside the case looked unfinished, and a second stone beside the walnut did not belong.
- **A case shows all its shelves.** Under the last row of books the shelves go on, empty, to the foot of the window.
- **A bound book as a binder builds it.** A rounded back, two boards, a block of pages a little inside them, a hinge, a headband. Each book takes its spine colour from the edge of its own cover, and its spine is lettered in one of three ways a publisher might choose.

Not taken: any photograph. The room is drawn from two CC0 material pictures ([THIRD-PARTY.md](THIRD-PARTY.md)) and the books' own covers. The reference photographs stayed on my desk.

## How the room is built

Four pictures, some CSS and one WebGL pass. No 3D engine.

- `eastroom/web/room/marble.webp` is the slab. The page lays it once, between the standards, under a gold frame that stands on the slab's own edges: a blade down each side and a bead along the top, meeting at the corners. At the foot the stone is cut as a sill with one gold line.
- `eastroom/web/room/walnut.webp` is the wood of the rail, the shelves and the back of the case. `post.webp` is the same wood with its grain running up, for the standards. The flutes are gradients over it.
- `eastroom/web/room/gilt.webp` is the walnut tile under gold leaf: bright on the high grain, dark where the pores stay open. The rail lays it exactly where its walnut lies and shows it only through the lettering, the line around the search field and the Add button. A letter therefore carries the grain of the wood around it. Nothing on the rail has a shadow or a shine of its own: no bevels, no embossing, no gradients that stand in for metal.
- `eastroom/web/shelf.js` draws every book, every shelf and the back of the case as instanced boxes in a single draw call. The plane of the spines is the page itself, so a spine stays locked to the words under it and only depth moves when you scroll. The back of the case stands about 240 px behind that plane, which is why it slides against the books as the page moves.
- The room is shown whole or not at all. Until every part of the case can be drawn with its wood and stone, the window stays dark. Then the rail, the standards, the slab, the shelves and the back come up together in 0.3 s, and the books are set down after. No part of the case ever stands alone waiting for the rest.
- One light follows the pointer. A cover keeps its own colours whatever the light does; spines, pages, boards and wood stand in half dark until it comes by.

## The slab

The words on the slab are set in Literata, the face the books themselves are read in, in sentence case and dark inlay. Nothing else on the page uses it, so the book's name reads as part of the book.

- The name is set at 60 px and steps down for long names. It is never cut.
- Under it: the author, then the gold button with what a press does ("Continue") and how long that takes, then where you are in the whole book over a line of its parts.
- Read parts of the line are gold. The part you are in is gold as far as you have read. A press on any part opens the book there.
- Each letter keeps a breath of clear stone round it, so a vein never runs through a word.

The other books you have open stand spine out on the same sill, at the size of the book beside them, with the time left above each. They are drawn by the shelves' own code, so they behave as shelf books do: reach for one and it turns its cover to you, press and it comes forward and opens.

## Phone and tablet

One slab. The words come first, then every book stands on the sill at its foot. The rail is one row (find, add, and one round button for Ideas, Settings and, when changes are waiting for Home, a note that says so). The dock is one row at the thumb (what is shown, and one round button for order and form). Both buttons open native popovers.

## Colour and type

| Token | Value | Used for |
|---|---|---|
| `--ink` | `#efe3c8` | words on wood |
| `--accent` | `#d9b56c` | gold on wood: marks, focus, what is pressed |
| `--leaf` | `#b8862f` | gold on stone: the line of parts, the button |
| `--stone` | `#171514` | words on marble |
| `--deep` | `#170e0a` | the dark of the room |

Science Gothic sets everything on wood: counts, labels, controls. Literata sets the slab and running text. Spines use the reader's own shelf of faces so a spine can match its cover.

The library keeps these colours whatever you read. A book's own colours begin when you open it: the page gives way to that book's ground colour while its cover comes forward, and the reader opens on the same frame. Settings and Ideas are rooms off the library and stand before the same walnut.

## Motion

- A book taken in the hand leaves the shelf first and turns as it comes, on a spring just short of settling at once.
- A new order, size or view is not a journey for each book. What stands there steps back, then the new arrangement steps forward together.
- Nothing moves under a press: controls keep their place and their size when pressed, and menus open over the page without shifting it.
- With reduced motion set, books and pages change in place and the page still works in full.

## What is not checked

I have judged the page in Chromium at desktop, wide, tablet and phone sizes, with 18 and with 304 books, in a list, in a search, with no books and with a long name. I have not measured contrast on every part of the slab, and I do not claim conformance with any accessibility standard. In Firefox and WebKit I checked that the page draws, that a phone menu opens and that a book opens, and nothing more. I have not held it on a real phone yet.
