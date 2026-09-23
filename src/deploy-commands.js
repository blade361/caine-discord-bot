/**
 * deploy-commands.js — registers the slash commands (see commands.js).
 * The bot also does this itself on startup, so this is only a manual fallback.
 *
 * Run once, and again whenever the command's shape changes. Registering to a
 * single guild (rather than globally) makes it appear instantly instead of
 * taking up to an hour.
 */

import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { commands } from './commands.js';

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

for (const [name, value] of Object.entries({ DISCORD_TOKEN, CLIENT_ID, GUILD_ID })) {
  if (!value) {
    console.error(`[deploy] ${name} is not set — check your .env`);
    process.exit(1);
  }
}

const rest = new REST().setToken(DISCORD_TOKEN);

// GUILD_ID accepts several servers separated by commas. Each one is
// registered separately, because a guild command belongs to that guild and
// nowhere else. Registering globally would be a single call but takes up to
// an hour to propagate, which is not worth it for a handful of servers.
const guilds = GUILD_ID.split(',').map((g) => g.trim()).filter(Boolean);

let failed = 0;
for (const guild of guilds) {
  try {
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, guild),
      { body: commands },
    );
    console.log(`[deploy] commands registered in ${guild}`);
  } catch (err) {
    // One bad id should not stop the rest: you want to see exactly which
    // server failed, not just the first error.
    failed++;
    console.error(`[deploy] failed in ${guild}: ${err.message}`);
  }
}

if (failed) process.exit(1);
console.log(`[deploy] done — ${guilds.length} server(s)`);
