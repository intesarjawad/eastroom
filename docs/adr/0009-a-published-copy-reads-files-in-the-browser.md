# 9. A published copy reads a visitor's files in their own browser

Date: 2026-11-13. Status: accepted.

## Context

`eastroom --export` writes the app and a library as plain files, and the demo site is such a copy. It has no Home, so it could not take a file: a visitor saw 17 books I chose and could not try their own. A demo that accepts uploads would need a server that receives other people's books, many of them in copyright, and would have to store and process them.

## Decision

The file is read where it is dropped. A worker (`web/local.js`) starts Pyodide, a build of CPython for WebAssembly, loads the package's own modules from a zip the export writes (`py/eastroom.zip`), and calls `export.read_here`: the importer and the key-lines step that Home runs, writing the files Home would serve. The page stores them in the browser's Cache Storage under those same addresses (`web/hold.js`), with the book's entry in a list beside them. The service worker answers those addresses from that store and adds the list to `api/library`. The reader, the library and Settings need no second code path.

A file is sent only to a Home that has answered. The page asks once whether there is a Home; a published copy answers 404. When the answer is unclear (a host's error, a lost connection), the page looks for `py/eastroom.zip`, which only a published copy carries, and otherwise sends nothing.

Pyodide is not a dependency of the package (see ADR 4). The demo's build fetches one pinned release, checks its hash and serves it from the site (`tools/demo_runtime.py`), under an address that carries the version, so the service worker fetches it once.

## Why

- The same importer, not a second one in JavaScript: a book reads the same in the demo as at Home, and one set of tests covers both.
- Nothing is uploaded, so there is nothing to host, moderate or leak. The claim can be checked in the browser's network panel.
- The page still loads nothing from other sites.

## Cost

The first book waits for a download of about 13 MB. PDF is left out: its reader needs a native library that has no WebAssembly build. Pictures from Wikimedia, recorded voices and spine lettering stay with the installed app, which has the engines for them. A browser may clear the store when the device runs short of room, and a private window keeps nothing: the page says so, and Home remains the lasting place for a library.
