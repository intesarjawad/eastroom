// Every script of the app parses. The service worker and the file reader run where no other test loads them,
// and a service worker that does not parse is never installed: the browser keeps the old one and says nothing.
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const web = new URL('../../eastroom/web/', import.meta.url);
test('every script of the app parses', () => {
  for (const name of readdirSync(web).filter((n) => n.endsWith('.js'))) execFileSync(process.execPath, ['--check', new URL(name, web).pathname]);
});
