/**
 * check-index.js — validate the library and try queries, no Discord needed.
 *
 *   npm run check                      validate + run the sample queries
 *   npm run check -- "everything is on fire"     try one query
 *   npm run check -- "gore" dark                 ...with a tone filter
 */

import path from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MemeLibrary } from './memeIndex.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', 'memes');

const library = new MemeLibrary({ root, minScore: Number(process.env.MIN_SCORE) || 0.45 });
const { count, problems } = await library.load();

console.log(`\n${count} memes loaded`, library.countByTone());

const byType = {};
let total = 0;
for (const m of library.memes.values()) {
  const ext = path.extname(m.file).slice(1).toLowerCase();
  byType[ext] = (byType[ext] ?? 0) + 1;
  total += m.bytes ?? 0;
}
console.log('formats:', byType, `| ${(total / 1024 / 1024).toFixed(1)}MB total`);

const heavy = [...library.memes.values()]
  .filter((m) => m.bytes > 4 * 1024 * 1024)
  .sort((a, b) => b.bytes - a.bytes);
if (heavy.length) {
  console.log('\nlargest files:');
  for (const m of heavy) console.log(`    ${(m.bytes / 1024 / 1024).toFixed(1)}MB  ${m.file}`);
}

/* Every entry must have its file, and every file must have an entry. A meme
   missing from disk fails only when someone picks it, which is the worst
   possible time to find out. */
const missing = [...library.memes.values()].filter((m) => !existsSync(library.filePath(m)));
const listed = new Set([...library.memes.keys()]);
const onDisk = existsSync(path.join(root, 'images')) ? readdirSync(path.join(root, 'images')) : [];
const unlisted = onDisk.filter((f) => !listed.has(f));

if (missing.length) console.log('\nMISSING FILES:', missing.map((m) => m.file).join(', '));
if (unlisted.length) console.log('\nIMAGES WITH NO ENTRY:', unlisted.join(', '));
for (const p of problems) console.log('WARNING:', p);
if (!missing.length && !unlisted.length && !problems.length) console.log('index and images agree, no warnings');

const [queryArg, toneArg] = process.argv.slice(2);

const queries = queryArg
  ? [[queryArg, toneArg ?? 'either']]
  : [
      ['everything is on fire', 'either'],
      ['refusing to do something', 'either'],
      ['nope alastor', 'either'],
      ['flirting being smooth', 'either'],
      ['losing my mind panicking', 'either'],
      ['hating ai', 'either'],
      ['gore', 'dark'],
      ['gore', 'normal'],
      ['zee posted art', 'either'],
      ['completely unrelated nonsense about tractors', 'either'],
    ];

console.log('\n--- queries ---');
for (const [q, tone] of queries) {
  const { results, confident } = library.search(q, tone, 3);
  const label = tone === 'either' ? `"${q}"` : `"${q}" [${tone}]`;
  if (!results.length) {
    console.log(`\n${label}\n    library has no memes of that tone`);
    continue;
  }
  console.log(`\n${label}${confident ? '' : '   (below ' + library.minScore + ' — best guess only)'}`);
  for (const r of results) {
    const bar = '#'.repeat(Math.round(r.score * 30));
    console.log(`    ${r.score.toFixed(2)} ${r.exact ? '(exact) ' : '        '}${r.meme.file.padEnd(32)} ${bar}`);
  }
}
console.log();
