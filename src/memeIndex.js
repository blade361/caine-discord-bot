/**
 * memeIndex.js — the searchable meme library.
 *
 * Every meme is hashed once at startup from its description, aliases and
 * filename. Searching is a bitwise scan, so it costs microseconds and needs
 * no API call.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { FlyHash } from '../lib/flyhash/flyhash.js';
import { FlyIndex } from '../lib/flyhash/index.js';
import { DIM, normalise } from '../lib/flyhash/featurize.js';

/* Nothing is persisted here — tags are rebuilt on every boot — so changing
   these is harmless, unlike in Wyvern where it would invalidate stored tags.
 *
 * sparsity 0.10 rather than the library default 0.05. Meme descriptions run
 * 20-40 words, and 102 bits cannot hold that much: individual words get
 * squeezed out by winner-take-all, so a query matching real words in the
 * description scored no better than noise. Measured against queries with
 * known right answers, 0.05 put true matches at 0.25 and false ones at 0.26 —
 * indistinguishable. At 0.10 the worst true match is 0.55 and the worst false
 * positive 0.40, which is a threshold you can actually set. Costs nothing:
 * the tag is 256 bytes either way. */
const hasher = new FlyHash({ inputDim: DIM, cells: 2048, sparsity: 0.10, fanIn: 6, seed: 20260913 });

export const TONES = ['normal', 'dark'];

/**
 * The text that represents a meme.
 *
 * Aliases go in twice: they're how people actually ask for a specific meme by
 * name, and repeating a field is how you weight it without putting queries
 * and documents in different spaces.
 *
 * The filename slug is included because it's free signal — "fuck-ai" becomes
 * the tokens "fuck ai" after normalisation.
 */
function memeText(meme) {
  const slug = path.basename(meme.file, path.extname(meme.file)).replace(/[-_]/g, ' ');
  const aliases = (meme.aliases ?? []).join(' ');
  return [aliases, aliases, slug, meme.description].filter(Boolean).join(' ');
}

export class MemeLibrary {
  constructor({ root, minScore = 0.45 }) {
    this.root = root;
    this.minScore = minScore;
    this.index = new FlyIndex({ hasher });
    this.memes = new Map();   // file -> meme record
    this.aliasMap = new Map(); // normalised alias -> file
  }

  async load() {
    const raw = await readFile(path.join(this.root, 'index.json'), 'utf8');
    const data = JSON.parse(raw);

    if (!Array.isArray(data.memes)) {
      throw new Error('index.json must contain a "memes" array');
    }

    const problems = [];
    for (const meme of data.memes) {
      if (!meme.file) { problems.push('an entry has no "file"'); continue; }
      if (!meme.description) problems.push(`${meme.file}: no description — it will never match`);
      if (meme.tone && !TONES.includes(meme.tone)) {
        problems.push(`${meme.file}: tone "${meme.tone}" is not one of ${TONES.join('/')}`);
      }

      const record = { ...meme, tone: meme.tone ?? 'normal' };
      this.memes.set(meme.file, record);
      this.index.add(meme.file, memeText(record), record);

      // Exact alias lookup, so "/meme nope alastor" is never at the mercy of
      // the similarity score.
      for (const alias of [...(meme.aliases ?? []), path.basename(meme.file, path.extname(meme.file))]) {
        this.aliasMap.set(normalise(alias), meme.file);
      }
    }

    this.problems = problems;
    return { count: this.index.size, problems };
  }

  /**
   * @param {string} query      what the user typed
   * @param {string} tone       'normal' | 'dark' | 'either'
   * @param {number} limit      how many results to offer
   * @returns {{results: Array<{meme, score, exact}>, confident: boolean}}
   *   Always returns something if the library has any meme of that tone.
   *   `confident` is false when nothing cleared minScore — the caller should
   *   say so rather than presenting a guess as a real match.
   */
  search(query, tone = 'either', limit = 3) {
    const wanted = (t) => tone === 'either' || t === tone;

    // Exact alias first. Someone who types the meme's name means that meme.
    const exactFile = this.aliasMap.get(normalise(query));
    const exact = exactFile ? this.memes.get(exactFile) : null;

    // No minScore filter here on purpose — it is applied further down only to
    // decide *confidence*, not to decide whether to answer at all.
    const scored = this.index
      .search(query, { limit: this.index.size, minScore: 0, metric: 'containment' })
      .filter((h) => wanted(h.meta.tone))
      .filter((h) => !exact || h.id !== exact.file);

    // Relative cutoff. Containment divides by the smaller bit count, so a
    // two-word query is normalised by a very small number and everything
    // scores high — "hating ai" put the right meme at 1.00 but dragged two
    // unrelated ones up to 0.54 and 0.46. An absolute threshold can't tell
    // those apart without also throwing away real matches on longer queries.
    // Requiring a result to be within 60% of the best one does, because it
    // asks a different question: not "is this good" but "is this competitive
    // with the winner".
    const top = scored[0]?.score ?? 0;
    // An exact alias hit is itself confidence: the user named the meme.
    const hasExact = Boolean(exact && wanted(exact.tone));
    const confident = hasExact || top >= this.minScore;

    // Never come back empty-handed. The picker is private, so a weak match
    // costs the user one glance and nothing else — whereas "nothing found"
    // is a dead end every time. When nothing clears the threshold we drop
    // the relative cutoff too, because among pure noise the gap between
    // first and third is meaningless and more options is strictly better.
    // When we are confident, a companion result has to clear BOTH bars: the
    // absolute threshold (it is a real match) and the relative one (it is
    // competitive with the winner). Using only the relative bar let a 0.38
    // ride along behind a 0.55, and only the absolute bar let junk ride along
    // behind a perfect alias hit.
    const floor = Math.max(this.minScore, top * 0.6);
    const hits = (confident ? scored.filter((h) => h.score >= floor) : scored)
      .slice(0, hasExact ? limit - 1 : limit)
      .map((h) => ({ meme: h.meta, score: h.score, exact: false }));

    const results = hasExact
      ? [{ meme: exact, score: 1, exact: true }, ...hits]
      : hits;

    // Last resort: a query can share literally zero cells with everything,
    // and the scan skips rows with no overlap at all, so `scored` comes back
    // empty. Rather than refuse, offer something random of the right tone.
    if (results.length === 0) {
      const pool = [...this.memes.values()].filter((m) => wanted(m.tone));
      if (pool.length) {
        const pick = pool[Math.floor(Math.random() * pool.length)];
        return { results: [{ meme: pick, score: 0, exact: false }], confident: false };
      }
    }

    return { results, confident };
  }

  filePath(meme) {
    return path.join(this.root, 'images', meme.file);
  }

  get size() {
    return this.index.size;
  }

  countByTone() {
    const counts = { normal: 0, dark: 0 };
    for (const m of this.memes.values()) counts[m.tone] = (counts[m.tone] ?? 0) + 1;
    return counts;
  }
}
