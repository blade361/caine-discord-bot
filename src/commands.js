/**
 * commands.js — slash command definitions, shared by deploy-commands.js and
 * by the bot itself, which re-registers them on startup.
 */

import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

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

// Posts thousands of images, so it is hidden from members who cannot manage
// messages. Server admins can change that under Integrations.
const fotogramas = new SlashCommandBuilder()
  .setName('fotogramas')
  .setDescription('Post every frame in the fotogramas folder, 10 per message')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addStringOption((opt) =>
    opt.setName('video')
      .setDescription('Which video (default: all)')
      .addChoices(
        { name: 'all', value: 'all' },
        { name: 'video1', value: 'video1' },
        { name: 'video2', value: 'video2' },
      ))
  .addIntegerOption((opt) =>
    opt.setName('from')
      .setDescription('Resume: start at this frame number of the first video')
      .setMinValue(1))
  .addBooleanOption((opt) =>
    opt.setName('stop')
      .setDescription('Stop a run that is in progress'));

export const commands = [meme, fotogramas].map((c) => c.toJSON());
