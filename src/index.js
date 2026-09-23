/**
 * index.js — the meme bot.
 *
 * /meme description:<text> [tone:normal|dark|either]
 *
 * Shows the best few matches privately, you pick one, the bot posts it to the
 * channel. Private picker means a bad match is never visible to anyone else,
 * which is what lets the threshold stay generous.
 */

import 'dotenv/config';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  Client,
  GatewayIntentBits,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from 'discord.js';
import { MemeLibrary } from './memeIndex.js';
import { commands } from './commands.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEMES_ROOT = path.join(__dirname, '..', 'memes');
const FRAMES_ROOT = path.join(__dirname, '..', 'fotogramas');

const library = new MemeLibrary({
  root: MEMES_ROOT,
  minScore: Number(process.env.MIN_SCORE) || 0.45,
});

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

/* Pending pickers, so a button click knows what it was offered.
   Keyed by interaction id; dropped after use or after five minutes. */
const pending = new Map();

function expire(id) {
  setTimeout(() => pending.delete(id), 5 * 60 * 1000).unref?.();
}

client.once('clientReady', async (c) => {
  const { count, problems } = await library.load();
  const tones = library.countByTone();

  console.log(`[memebot] logged in as ${c.user.tag}`);
  console.log(`[memebot] ${count} memes loaded (${tones.normal} normal, ${tones.dark} dark)`);
  console.log(`[memebot] minimum score ${library.minScore}`);

  for (const p of problems) console.warn(`[memebot] index warning — ${p}`);

  await registerCommands(c);
});

/* Registers the slash commands on every start, so a new command goes live
   with the deploy instead of needing `npm run deploy` with a local token.
   Same guilds as deploy-commands.js: GUILD_ID, comma separated. */
async function registerCommands(c) {
  const guilds = (process.env.GUILD_ID ?? '').split(',').map((g) => g.trim()).filter(Boolean);
  for (const guild of guilds) {
    try {
      await c.application.commands.set(commands, guild);
      console.log(`[memebot] commands registered in ${guild}`);
    } catch (err) {
      console.error(`[memebot] command registration failed in ${guild}: ${err.message}`);
    }
  }
}

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === 'meme') {
      await handleSearch(interaction);
    } else if (interaction.isChatInputCommand() && interaction.commandName === 'fotogramas') {
      await handleFrames(interaction);
    } else if (interaction.isButton()) {
      await handleButton(interaction);
    }
  } catch (err) {
    // Show the actual reason. A generic "something went wrong" is useless to
    // whoever has to fix it, and these failures are almost always one of two
    // boring things: a missing channel permission or a missing file.
    console.error('[memebot] interaction failed:', err);
    const detail = err.code ? `\`${err.code}\` ${err.message}` : `\`${err.message}\``;
    const msg = {
      content: `That didn't work: ${detail}`,
      flags: MessageFlags.Ephemeral,
    };
    if (interaction.deferred || interaction.replied) await interaction.followUp(msg).catch(() => {});
    else await interaction.reply(msg).catch(() => {});
  }
});

async function handleSearch(interaction) {
  const query = interaction.options.getString('description', true);
  const tone = interaction.options.getString('tone') ?? 'either';

  const { results, confident } = library.search(query, tone, 3);

  if (results.length === 0) {
    // Only possible if the library has no meme of the requested tone at all.
    await interaction.reply({
      content: `I have no **${tone}** memes yet.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  pending.set(interaction.id, results.map((r) => r.meme.file));
  expire(interaction.id);

  const row = new ActionRowBuilder().addComponents(
    ...results.map((r, i) =>
      new ButtonBuilder()
        .setCustomId(`post:${interaction.id}:${i}`)
        .setLabel(label(r))
        .setStyle(i === 0 ? ButtonStyle.Primary : ButtonStyle.Secondary)
    ),
    new ButtonBuilder()
      .setCustomId(`cancel:${interaction.id}`)
      .setLabel('Nope')
      .setStyle(ButtonStyle.Danger)
  );

  const header = confident
    ? `Closest ${results.length === 1 ? 'match' : 'matches'} — pick one to post:`
    : `Nothing really matches that, but here's the closest I have:`;

  await interaction.reply({
    content: header,
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

/** Button label: meme name plus how confident the match is. */
function label(result) {
  const name = result.meme.aliases?.[0]
    ?? path.basename(result.meme.file, path.extname(result.meme.file)).replace(/[-_]/g, ' ');
  const trimmed = name.length > 60 ? name.slice(0, 57) + '…' : name;
  return result.exact ? `${trimmed} (exact)` : `${trimmed} (${Math.round(result.score * 100)}%)`;
}

async function handleButton(interaction) {
  const [action, sourceId, indexStr] = interaction.customId.split(':');

  if (action === 'cancel') {
    pending.delete(sourceId);
    await interaction.update({ content: 'Dropped it.', components: [] });
    return;
  }

  if (action !== 'post') return;

  const files = pending.get(sourceId);
  if (!files) {
    await interaction.update({ content: 'That picker has expired — run `/meme` again.', components: [] });
    return;
  }

  const meme = library.memes.get(files[Number(indexStr)]);
  if (!meme) {
    await interaction.update({ content: 'That meme is missing from the library.', components: [] });
    return;
  }

  // Attach from disk rather than linking. No hosting, no broken embeds, and
  // it works the same for images, gifs and video.
  const filePath = library.filePath(meme);

  if (!existsSync(filePath)) {
    console.error(`[memebot] file missing on disk: ${filePath}`);
    await interaction.update({
      content: `\`${meme.file}\` is in the index but not on disk. Run \`npm run check\`.`,
      components: [],
    });
    return;
  }

  // Two routes to the channel, because they fail in different ways.
  // channel.send needs Send Messages and Attach Files in that specific
  // channel, and interaction.channel is null if the bot cannot even view it.
  // The interaction webhook (followUp) does not go through those checks, so
  // it works in channels where the direct send is refused.
  try {
    if (!interaction.channel) throw new Error('channel not available');
    await interaction.channel.send({ files: [new AttachmentBuilder(filePath, { name: meme.file })] });
  } catch (err) {
    console.warn(`[memebot] direct send failed (${err.code ?? err.message}), using webhook`);
    await interaction.followUp({ files: [new AttachmentBuilder(filePath, { name: meme.file })] });
  }

  pending.delete(sourceId);
  await interaction.update({ content: 'Posted.', components: [] });
}

/* /fotogramas — posts every frame under fotogramas/<video>/, in name order,
 * 10 per message (Discord's attachment limit). One run per channel at a
 * time; `stop:true` ends it after the message in flight. discord.js queues
 * around the rate limit on its own, so the loop just awaits each send. */
const FRAMES_PER_MESSAGE = 10;
const frameRuns = new Map(); // channel id -> { stopped }

async function handleFrames(interaction) {
  const channelId = interaction.channelId;

  if (interaction.options.getBoolean('stop')) {
    const run = frameRuns.get(channelId);
    if (run) run.stopped = true;
    await interaction.reply({
      content: run ? 'Stopping after the current message.' : 'Nothing is running in this channel.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (frameRuns.has(channelId)) {
    await interaction.reply({
      content: 'Already posting frames here. Use `/fotogramas stop:true` to stop it.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!interaction.channel) throw new Error('channel not available');

  const choice = interaction.options.getString('video') ?? 'all';
  const videos = (await readdir(FRAMES_ROOT, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && (choice === 'all' || d.name === choice))
    .map((d) => d.name)
    .sort();

  const batches = [];
  for (const video of videos) {
    const frames = (await readdir(path.join(FRAMES_ROOT, video)))
      .filter((f) => /\.(jpe?g|png|gif|webp)$/i.test(f))
      .sort();
    for (let i = 0; i < frames.length; i += FRAMES_PER_MESSAGE) {
      const chunk = frames.slice(i, i + FRAMES_PER_MESSAGE);
      batches.push({ video, first: i === 0, total: frames.length, files: chunk.map((f) => path.join(FRAMES_ROOT, video, f)) });
    }
  }

  if (batches.length === 0) {
    await interaction.reply({ content: `No frames found for **${choice}**.`, flags: MessageFlags.Ephemeral });
    return;
  }

  const run = { stopped: false };
  frameRuns.set(channelId, run);
  await interaction.reply({
    content: `Posting ${batches.length} messages of frames. \`/fotogramas stop:true\` to stop.`,
    flags: MessageFlags.Ephemeral,
  });
  console.log(`[memebot] fotogramas: ${batches.length} messages to #${interaction.channel.name ?? channelId}`);

  let sent = 0;
  try {
    for (const batch of batches) {
      if (run.stopped) break;
      await interaction.channel.send({
        content: batch.first ? `**${batch.video}** — ${batch.total} frames` : undefined,
        files: batch.files.map((f) => new AttachmentBuilder(f, { name: path.basename(f) })),
      });
      sent++;
    }
  } finally {
    frameRuns.delete(channelId);
    const summary = `${run.stopped ? 'Stopped' : 'Done'}: ${sent}/${batches.length} messages posted.`;
    console.log(`[memebot] fotogramas ${summary}`);
    // The interaction token lasts 15 minutes; a long run outlives it.
    await interaction.editReply({ content: summary }).catch(() => {});
  }
}

/* Health endpoint.
 *
 * Only starts if PORT is set, which Render does for a Web Service and does
 * not for a Background Worker. So the same code runs unchanged on both:
 * as a Worker it is a pure bot, as a Web Service it also answers pings and
 * therefore stays awake on the free tier. */
if (process.env.PORT) {
  const { createServer } = await import('node:http');
  createServer((req, res) => {
    const ready = client.isReady();
    res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: ready,
      memes: library.size,
      uptime: Math.round(process.uptime()),
    }));
  }).listen(process.env.PORT, () => {
    console.log(`[memebot] health endpoint on :${process.env.PORT}`);
    startKeepAlive();
  });
}

/* Keep-alive.
 *
 * Render's free Web Service tier spins the instance down after 15 minutes
 * with no inbound HTTP request. A Discord bot receives none — it holds an
 * outbound websocket — so left alone it sleeps within the hour, every hour.
 *
 * Calling our own public URL counts as inbound traffic through Render's
 * router, so the timer below keeps the instance up on its own, with no
 * external pinger to configure or forget about.
 *
 * Two things this does NOT do. It cannot wake a service that has already
 * slept — a sleeping instance runs no timers — so if the process dies, only
 * a real visitor or a redeploy brings it back. And it burns instance hours
 * continuously: Render's free allowance is 750 per month and an always-on
 * service uses about 730, so this is one free service, not several.
 *
 * RENDER_EXTERNAL_URL is set automatically on a Render Web Service and is
 * absent on a Background Worker and on your laptop, so this only runs where
 * it is actually needed. */
const KEEPALIVE_MINUTES = Number(process.env.KEEPALIVE_MINUTES) || 10;

function startKeepAlive() {
  const url = process.env.RENDER_EXTERNAL_URL;
  if (!url) return;

  console.log(`[memebot] keep-alive pinging ${url} every ${KEEPALIVE_MINUTES} min`);

  setInterval(async () => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) console.warn(`[memebot] keep-alive got ${res.status}`);
    } catch (err) {
      // A failed ping is not fatal: the next one is ten minutes away and the
      // bot's own gateway connection is unaffected either way.
      console.warn('[memebot] keep-alive failed:', err.message);
    }
  }, KEEPALIVE_MINUTES * 60 * 1000);
}

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('[memebot] DISCORD_TOKEN is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

client.login(token);
