/**
 * games.js — the Hazbin games on Render (workspace "games") that /game opens rooms in.
 *
 * Poker, pool and hangman share one room system: POST /api/create returns
 * { code, hostToken }; /host/CODE/TOKEN is the private admin link and
 * /join/CODE the link for everyone else. Duck Hunt is single player, so it
 * only gets a public link. Each URL can be overridden with an env var if a
 * service moves again.
 */

export const GAMES = {
  poker: {
    name: "Hazbin Hold'em",
    url: process.env.GAME_URL_POKER || 'https://hazbin-poker-mudf.onrender.com',
    rooms: true,
  },
  pool: {
    name: 'Hazbin 8-Ball',
    url: process.env.GAME_URL_POOL || 'https://hazbin-pool-nxwb.onrender.com',
    rooms: true,
  },
  hangman: {
    name: "Lucifer's Gallows",
    url: process.env.GAME_URL_HANGMAN || 'https://lucifer-hangman-wkzo.onrender.com',
    rooms: true,
  },
  duckhunt: {
    name: "Alastor's Duck Hunt",
    url: process.env.GAME_URL_DUCKHUNT || 'https://alastor-hunt-lyv7.onrender.com',
    rooms: false,
  },
};

// Free Render services sleep when idle and take up to about a minute to wake,
// so the first request gets a long timeout and one retry.
const CREATE_TIMEOUT_MS = 90_000;

export async function createRoom(game) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetch(`${game.url}/api/create`, {
        method: 'POST',
        signal: AbortSignal.timeout(CREATE_TIMEOUT_MS),
      });
      const body = await resp.json().catch(() => ({}));
      if (resp.ok && body.code && body.hostToken) {
        return {
          adminUrl: `${game.url}/host/${body.code}/${body.hostToken}`,
          joinUrl: `${game.url}/join/${body.code}`,
        };
      }
      // A full server (too_many_rooms) won't get better by retrying.
      throw Object.assign(new Error(body.error || `HTTP ${resp.status}`), { final: resp.status < 500 || body.error });
    } catch (err) {
      lastError = err;
      if (err.final) break;
    }
  }
  throw new Error(`${game.name} couldn't open a room (${lastError.message})`);
}
