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
  .setDescription('Post every frame of video2, 10 per message')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addIntegerOption((opt) =>
    opt.setName('from')
      .setDescription('Resume: start at this frame number')
      .setMinValue(1))
  .addBooleanOption((opt) =>
    opt.setName('stop')
      .setDescription('Stop a run that is in progress'));

// Opens a room in one of the games: the private admin link goes only to whoever
// ran it, the join link is posted for everyone.
const game = new SlashCommandBuilder()
  .setName('game')
  .setDescription('Open a game room: you get the admin link, everyone gets the join link')
  .addStringOption((opt) =>
    opt.setName('game')
      .setDescription('Which game')
      .setRequired(true)
      .addChoices(
        { name: "Hazbin Hold'em (poker)", value: 'poker' },
        { name: 'Hazbin 8-Ball (pool tournament)', value: 'pool' },
        { name: "Lucifer's Gallows (hangman)", value: 'hangman' },
        { name: "Alastor's Duck Hunt", value: 'duckhunt' },
      ));

export const commands = [meme, fotogramas, game].map((c) => c.toJSON());
