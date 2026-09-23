/**
 * commands.js — slash command definitions, shared by deploy-commands.js and
 * by the bot itself, which re-registers them on startup.
 */

import { SlashCommandBuilder } from 'discord.js';

const meme = new SlashCommandBuilder()
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

export const commands = [meme].map((c) => c.toJSON());
