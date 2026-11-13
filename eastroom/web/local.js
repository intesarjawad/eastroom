// Where there is no Home (a published copy), this browser reads a book file itself: East Room's own Python runs here, in WebAssembly (Pyodide), on a thread of its own.
// A file comes in, the book's files go back to the page, which keeps them. Nothing is sent anywhere.
const RUNTIME = 'pyodide/314.0.7/';                               // served by this site, never by another; tools/demo_runtime.py puts it there
const CANNOT = 'This copy of East Room cannot read files in the browser. On your own computer it can: github.com/intesarjawad/eastroom';
let py;
async function runtime() {
  const { loadPyodide } = await import('./' + RUNTIME + 'pyodide.mjs');
  const [made, code] = await Promise.all([loadPyodide({ indexURL: new URL(RUNTIME, location).href }), fetch('py/eastroom.zip').then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))]);
  made.unpackArchive(code, 'zip', { extractDir: '/py' });
  made.runPython('import sys, json, shutil\nsys.path.insert(0, "/py")\nfrom pathlib import Path\nfrom eastroom import export');
  return made;
}
function files(dir, at = '') {                                    // every file under `dir`, with its address
  return py.FS.readdir(dir).filter((n) => n !== '.' && n !== '..').flatMap((n) => (py.FS.isDir(py.FS.stat(`${dir}/${n}`).mode) ? files(`${dir}/${n}`, `${at}${n}/`) : [[at + n, py.FS.readFile(`${dir}/${n}`)]]));
}
onmessage = async ({ data: { file, taken } }) => {                // the page sends one file at a time
  const say = (text, step) => postMessage({ text, step });
  try {
    if (!py) say('Getting the reader, once', 0.5);
    py ??= await runtime().catch((err) => { console.error(err); throw new Error(CANNOT); });
    say('Reading the file', 1.2);
    const name = file.name.replace(/[/\\]/g, ' ');
    py.FS.mkdirTree('/in'); py.FS.writeFile('/in/' + name, new Uint8Array(await file.arrayBuffer()));
    py.globals.set('job', py.toPy({ file: '/in/' + name, taken }));   // names travel as values, never as code
    let book;
    try { book = JSON.parse(py.runPython('json.dumps(export.read_here(Path(job["file"]), Path("/out"), job["taken"]))')); }
    catch (err) {                                                 // East Room's own refusals are written for the reader; anything else is not theirs to decode
      const last = String(err.message).trim().split('\n').pop();
      console.error(err); throw new Error(last.startsWith('ValueError: ') ? last.slice(12) : /MemoryError/.test(last) ? 'This file is too large to read in a browser. East Room on your own computer reads it: github.com/intesarjawad/eastroom' : 'This file could not be read.');
    }
    const out = files('/out').filter(([path]) => path !== 'api/library');
    postMessage({ book, files: out }, out.map(([, bytes]) => bytes.buffer));
  } catch (err) { postMessage({ error: err.message }); }
  finally { py?.runPython('shutil.rmtree("/in", True); shutil.rmtree("/out", True)'); }
};
