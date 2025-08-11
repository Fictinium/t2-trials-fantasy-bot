import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import isRegistered from '../utils/checkRegistration.js';
import FantasyPlayer from '../models/FantasyPlayer.js';

export default {
  data: new SlashCommandBuilder()
    .setName('myscore')
    .setDescription('View your fantasy points (overall or for a specific week)')
    .addIntegerOption(opt =>
      opt.setName('week')
        .setDescription('Show score for a specific week (1-based)')
        .setMinValue(1)
        .setRequired(false)
    )
    .addBooleanOption(opt =>
      opt.setName('ephemeral')
        .setDescription('Show only to you')
        .setRequired(false)
    ),

  async execute(interaction) {
    const discordId = interaction.user.id;
    const week = interaction.options.getInteger('week') ?? null;
    const ephemeral = interaction.options.getBoolean('ephemeral') ?? false;

    // Gate: must be registered
    const registered = await isRegistered(discordId);
    if (!registered) {
      return interaction.reply({
        content: '⚠️ You must register using `/joinleague` before using this command.',
        ephemeral: true
      });
    }

    // Load player doc
    const user = await FantasyPlayer.findOne(
      { discordId },
      { username: 1, weeklyPoints: 1, totalPoints: 1 }
    ).lean();

    if (!user) {
      return interaction.reply({
        content: '❗ Could not find your fantasy profile. Try `/joinleague` again.',
        ephemeral: true
      });
    }

    const displayName = user.username || interaction.user.username;
    const weekly = Array.isArray(user.weeklyPoints) ? user.weeklyPoints : [];
    const storedTotal = Number.isFinite(user.totalPoints) ? user.totalPoints : 0;

    // Option A: specific week view
    if (week) {
      const idx = week - 1;
      const points = Number.isFinite(weekly[idx]) ? weekly[idx] : 0;

      const embed = new EmbedBuilder()
        .setTitle(`${displayName} — Week ${week}`)
        .setDescription(`**Week ${week} points:** ${points}`)
        .setFooter({ text: `Total points: ${storedTotal}` });

      return interaction.reply({ embeds: [embed], ephemeral });
    }

    // Option B: overall breakdown
    if (!weekly.length) {
      const embed = new EmbedBuilder()
        .setTitle(`${displayName} — Scores`)
        .setDescription('No weekly scores yet. An admin needs to run `/calculatescores` after matches are recorded.')
        .setFooter({ text: `Total points: ${storedTotal}` });

      return interaction.reply({ embeds: [embed], ephemeral });
    }

    // Build lines like: "Week 1 — 10 pts"
    const lines = weekly.map((v, i) => `Week ${i + 1} — ${Number.isFinite(v) ? v : 0} pts`);
    const embed = new EmbedBuilder()
      .setTitle(`${displayName} — Scores`)
      .setDescription(lines.join('\n'))
      .setFooter({ text: `Total points: ${storedTotal}` });

    return interaction.reply({ embeds: [embed], ephemeral });
  }
};
