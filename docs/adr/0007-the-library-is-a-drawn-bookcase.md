# 7. The library is a bookcase drawn from two pictures, with no 3D engine

Date: 2026-11-13. Status: accepted.

## Context

The library has to hold hundreds of books and still feel like a place. Flat cover tiles did not, and a room that changed colour with every book under the pointer made the page restless. A path-traced room looked right in stills but cannot be laid out for every window size and every number of shelves.

## Decision

The room is assembled in the page from four small pictures and one WebGL2 pass. `tools/make_room.py` makes the pictures from two CC0 sources: a slab of white marble with gold veins, a walnut tile, the same wood turned upright, and the same tile under gold leaf for the rail's lettering. CSS lays the rail, the fluted standards, the slab and its gold frame. `web/shelf.js` draws every book, shelf board and the back of the case as instanced boxes in one draw call, with its own small shader for covers, lettered spines, pages and wood.

The library keeps one palette. A book's own colours begin when it is opened.

## Why

- The whole room is under 300 kB of pictures and no library. It lays out at any width and for any number of books.
- One draw call draws every book in view. A library of 304 books is one of the states the page is checked in.
- Anyone can remake the pictures from the named scans with one command.
- Where WebGL2 is missing the same books fall back to a wall of covers.

## Considered

- three.js: far more than a few hundred boxes need, and one more thing to vendor.
- Rendered plates as page backgrounds: right for one window size only.
- Per-book coloured rooms on the library: kept for the reader, where one book owns the page.

## Cost

The shader is written by hand and is dense. The back of the case and the shelves are lit by a simple model, so the room is plainer than a path-traced one. Depth is drawn only in the shelves; the slab and the standards are flat.
