/**
 * deploy-commands.js — registers the /meme slash command.
 *
 * Run once, and again whenever the command's shape changes. Registering to a
 * single guild (rather than globally) makes it appear instantly instead of
 * taking up to an hour.
 */

import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

const command = new SlashCommandBuilder()
  .setName('meme')
  .setDescription('Find a meme by describing it')
  .addStringOption((opt) =>
    opt.setName('description')
      .setDescription('What is the meme about? Use the words that are in it.')
      .setRequired(true))
  .addStringOption((opt) =>
    opt.setName('tone')
      .setDescription('Filter by tone (default: either)')
      .addChoices(
        { name: 'normal', value: 'normal' },
        { name: 'dark', value: 'dark' },
        { name: 'either', value: 'either' },
      ));

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
      { body: [command.toJSON()] },
    );
    console.log(`[deploy] /meme registered in ${guild}`);
  } catch (err) {
    // One bad id should not stop the rest: you want to see exactly which
    // server failed, not just the first error.
    failed++;
    console.error(`[deploy] failed in ${guild}: ${err.message}`);
  }
}

if (failed) process.exit(1);
console.log(`[deploy] done — ${guilds.length} server(s)`);
