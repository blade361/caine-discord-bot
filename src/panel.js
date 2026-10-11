/**
 * panel.js — the bot's web page.
 *
 * Opening the service URL shows a small menu: pick a server and a channel the
 * bot is in, type a message, and the bot posts it there.
 *
 * Protected by HTTP Basic auth with PANEL_PASSWORD (any username). Without
 * that variable the panel is off and the URL only answers /health, because
 * the page lets anyone who reaches it speak as the bot.
 *
 *   GET  /              the menu
 *   GET  /api/channels  servers and their text channels
 *   POST /api/send      { channelId, content }
 *   GET  /health        readiness JSON, no auth (keep-alive pings this)
 *
 * Hardening: repeated wrong passwords from one IP are locked out for a
 * while, the page refuses to be framed, and /api/send only accepts JSON
 * from this same origin, so another site cannot post through the browser's
 * cached Basic credentials.
 */

import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { ChannelType, PermissionFlagsBits } from 'discord.js';

const SENDABLE = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

const MAX_FAILURES = 10;
const LOCKOUT_MS = 15 * 60 * 1000;
const failures = new Map(); // ip -> { count, until }

export function startPanel({ client, library, port, onListening }) {
  const password = process.env.PANEL_PASSWORD ?? '';
  if (!password) console.warn('[memebot] PANEL_PASSWORD not set — web panel disabled');

  createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/health') return health(res, client, library);
      if (!password) return send(res, 404, 'text/plain', 'Panel disabled: set PANEL_PASSWORD.');

      const ip = clientIp(req);
      const record = failures.get(ip);
      if (record && record.until > Date.now()) return send(res, 429, 'text/plain', 'Too many wrong passwords. Try again later.');
      if (!authorized(req, password)) {
        if (req.headers.authorization) noteFailure(ip);
        res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Caine", charset="UTF-8"' });
        return res.end('Password required.');
      }
      failures.delete(ip);

      if (req.method === 'GET' && url.pathname === '/') return send(res, 200, 'text/html; charset=utf-8', PAGE);
      if (req.method === 'GET' && url.pathname === '/api/channels') return json(res, 200, listChannels(client));
      if (req.method === 'POST' && url.pathname === '/api/send') return await sendMessage(req, res, client);
      send(res, 404, 'text/plain', 'Not found.');
    } catch (err) {
      console.error('[memebot] panel request failed:', err);
      json(res, 500, { error: err.code ? `${err.code} ${err.message}` : err.message });
    }
  }).listen(port, onListening);
}

function health(res, client, library) {
  const ready = client.isReady();
  json(res, ready ? 200 : 503, { ok: ready, memes: library.size, uptime: Math.round(process.uptime()) });
}

function authorized(req, password) {
  const [scheme, encoded] = (req.headers.authorization ?? '').split(' ');
  if (scheme !== 'Basic' || !encoded) return false;
  const decoded = Buffer.from(encoded, 'base64').toString();
  const given = Buffer.from(decoded.slice(decoded.indexOf(':') + 1));
  const expected = Buffer.from(password);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Every server the bot is in, with the text channels it can post to. */
function listChannels(client) {
  if (!client.isReady()) return { ready: false, guilds: [] };
  const guilds = client.guilds.cache
    .map((guild) => {
      const me = guild.members.me;
      const channels = guild.channels.cache
        .filter((c) => SENDABLE.includes(c.type))
        .filter((c) => me && c.permissionsFor(me).has([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
        ]))
        .sort((a, b) => a.rawPosition - b.rawPosition)
        .map((c) => ({ id: c.id, name: c.name, category: c.parent?.name ?? null }));
      return { id: guild.id, name: guild.name, icon: guild.iconURL({ size: 64 }), channels };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return { ready: true, bot: client.user.tag, guilds };
}

async function sendMessage(req, res, client) {
  // A cross-site form or text/plain fetch cannot set a JSON content type
  // without a CORS preflight, which this server never approves.
  if (!(req.headers['content-type'] ?? '').startsWith('application/json')) {
    return json(res, 415, { error: 'Expected application/json.' });
  }
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) return json(res, 403, { error: 'Cross-origin request refused.' });

  const body = await readJson(req);
  const content = String(body.content ?? '').trim();
  if (!content) return json(res, 400, { error: 'Message is empty.' });
  if (content.length > 2000) return json(res, 400, { error: 'Discord allows 2000 characters at most.' });

  const channel = client.channels.cache.get(String(body.channelId ?? ''));
  if (!channel || !SENDABLE.includes(channel.type)) return json(res, 404, { error: 'Channel not found.' });

  const message = await channel.send({ content });
  console.log(`[memebot] panel posted to #${channel.name} in ${channel.guild.name}`);
  json(res, 200, { ok: true, url: message.url });
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 16_000) throw new Error('Request too large.');
  }
  try { return JSON.parse(raw || '{}'); } catch { throw new Error('Invalid JSON.'); }
}

/* Render puts the real client first in X-Forwarded-For. */
function clientIp(req) {
  return (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress;
}

function noteFailure(ip) {
  const record = failures.get(ip) ?? { count: 0, until: 0 };
  record.count++;
  if (record.count >= MAX_FAILURES) {
    record.count = 0;
    record.until = Date.now() + LOCKOUT_MS;
    console.warn(`[memebot] panel: ${ip} locked out after ${MAX_FAILURES} wrong passwords`);
  }
  failures.set(ip, record);
}

function json(res, status, data) {
  send(res, status, 'application/json', JSON.stringify(data));
}

function send(res, status, type, body) {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "frame-ancestors 'none'",
  });
  res.end(body);
}

const PAGE = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Caine</title>
<style>
  :root { --bg:#1e1f22; --panel:#2b2d31; --field:#383a40; --text:#dbdee1; --muted:#949ba4; --accent:#5865f2; --ok:#23a55a; --bad:#f23f43; }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:16px;
         background:var(--bg); color:var(--text); font:15px/1.45 system-ui, sans-serif; }
  main { width:100%; max-width:460px; background:var(--panel); border-radius:12px; padding:20px; box-shadow:0 8px 30px #0006; }
  h1 { margin:0 0 4px; font-size:20px; }
  .sub { margin:0 0 18px; color:var(--muted); font-size:13px; }
  label { display:block; margin:14px 0 6px; font-size:12px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--muted); }
  select, textarea, button { width:100%; font:inherit; color:var(--text); border:0; border-radius:8px; }
  select, textarea { background:var(--field); padding:10px 12px; }
  textarea { min-height:120px; resize:vertical; }
  select:focus, textarea:focus { outline:2px solid var(--accent); }
  .row { display:flex; justify-content:space-between; color:var(--muted); font-size:12px; margin-top:4px; }
  button { margin-top:16px; padding:11px; background:var(--accent); font-weight:600; cursor:pointer; }
  button:disabled { opacity:.5; cursor:default; }
  #status { min-height:20px; margin-top:12px; font-size:13px; }
  #status.ok { color:var(--ok); } #status.bad { color:var(--bad); }
  #status a { color:inherit; }
</style>
</head>
<body>
<main>
  <h1>Caine</h1>
  <p class="sub" id="bot">Cargando…</p>

  <label for="guild">Servidor</label>
  <select id="guild"></select>

  <label for="channel">Canal</label>
  <select id="channel"></select>

  <label for="content">Mensaje</label>
  <textarea id="content" maxlength="2000" placeholder="Escribe lo que dirá Caine…"></textarea>
  <div class="row"><span>Ctrl+Enter para enviar</span><span id="count">0/2000</span></div>

  <button id="send" disabled>Enviar</button>
  <div id="status"></div>
</main>
<script>
  const $ = (id) => document.getElementById(id);
  let guilds = [];

  function status(text, kind) { const s = $('status'); s.className = kind || ''; s.innerHTML = text; }
  function esc(t) { return String(t).replace(/[&<>"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' })[c]); }

  async function load() {
    const res = await fetch('api/channels');
    const data = await res.json();
    if (!data.ready) { $('bot').textContent = 'El bot aún no está conectado. Reintentando…'; return setTimeout(load, 3000); }
    guilds = data.guilds;
    $('bot').textContent = 'Conectado como ' + data.bot + ' · ' + guilds.length + ' servidor' + (guilds.length === 1 ? '' : 'es');
    $('guild').innerHTML = guilds.map((g) => '<option value="' + g.id + '">' + esc(g.name) + '</option>').join('');
    const saved = localStorageGet('guild');
    if (guilds.some((g) => g.id === saved)) $('guild').value = saved;
    fillChannels();
  }

  function fillChannels() {
    const g = guilds.find((x) => x.id === $('guild').value);
    const chans = g ? g.channels : [];
    $('channel').innerHTML = chans.length
      ? chans.map((c) => '<option value="' + c.id + '">#' + esc(c.name) + (c.category ? '  (' + esc(c.category) + ')' : '') + '</option>').join('')
      : '<option value="">Sin canales donde pueda escribir</option>';
    const saved = localStorageGet('channel');
    if (chans.some((c) => c.id === saved)) $('channel').value = saved;
    update();
  }

  function update() {
    const n = $('content').value.length;
    $('count').textContent = n + '/2000';
    $('send').disabled = !$('channel').value || !$('content').value.trim();
  }

  async function send() {
    if ($('send').disabled) return;
    $('send').disabled = true;
    status('Enviando…');
    try {
      const res = await fetch('api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: $('channel').value, content: $('content').value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      status('Enviado. <a href="' + esc(data.url) + '" target="_blank" rel="noopener">Ver en Discord</a>', 'ok');
      $('content').value = '';
    } catch (err) {
      status('No se pudo enviar: ' + esc(err.message), 'bad');
    }
    update();
  }

  function localStorageGet(k) { try { return localStorage.getItem('caine-' + k); } catch { return null; } }
  function localStorageSet(k, v) { try { localStorage.setItem('caine-' + k, v); } catch {} }

  $('guild').onchange = () => { localStorageSet('guild', $('guild').value); fillChannels(); };
  $('channel').onchange = () => { localStorageSet('channel', $('channel').value); update(); };
  $('content').oninput = update;
  $('content').onkeydown = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } };
  $('send').onclick = send;
  load().catch((err) => status('Error cargando canales: ' + esc(err.message), 'bad'));
</script>
</body>
</html>`;
