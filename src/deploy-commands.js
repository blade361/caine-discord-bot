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

try {
  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: [command.toJSON()] },
  );
  console.log(`[deploy] /meme registered to guild ${GUILD_ID}`);
} catch (err) {
  console.error('[deploy] failed:', err.message);
  process.exit(1);
}
