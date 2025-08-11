import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';
import Team from '../models/Team.js';

export default {
  data: new SlashCommandBuilder()
    .setName('playerstats')
    .setDescription('Show a T2 Trials league player’s stats')
    .addStringOption(opt =>
      opt.setName('player')
        .setDescription('Player name')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('team')
        .setDescription('(Optional) Team name to disambiguate')
        .setRequired(false)
    )
    .addIntegerOption(opt =>
      opt.setName('week')
        .setDescription('Specific week (1-based)')
        .setMinValue(1)
        .setRequired(false)
    )
    .addBooleanOption(opt =>
      opt.setName('ephemeral')
        .setDescription('Show only to you')
        .setRequired(false)
    ),

  async execute(interaction) {
    const name = interaction.options.getString('player', true);
    const teamName = interaction.options.getString('team') || null;
    const week = interaction.options.getInteger('week') || null;
    const ephemeral = interaction.options.getBoolean('ephemeral') ?? false;

    // Find by name (+ optional team filter)
    const nameFilter = { name: { $regex: `^${name}$`, $options: 'i' } };
    let teamFilter = {};
    if (teamName) {
      const teamDoc = await Team.findOne({ name: { $regex: `^${teamName}$`, $options: 'i' } });
      if (!teamDoc) {
        return interaction.reply({ content: `❌ Team "${teamName}" not found.`, ephemeral: true });
      }
      teamFilter = { team: teamDoc._id };
    }

    const player = await T2TrialsPlayer.findOne({ ...nameFilter, ...teamFilter })
      .populate('team', 'name')
      .lean();

    if (!player) {
      return interaction.reply({
        content: `❌ Player **${name}**${teamName ? ` in team **${teamName}**` : ''} not found.`,
        ephemeral: true
      });
    }

    // Compute aggregates
    const perf = Array.isArray(player.performance) ? player.performance : [];
    let wins = 0, losses = 0, desc = '';

    if (week) {
      const entry = perf.find(e => e.week === week);
      wins = entry?.wins || 0;
      losses = entry?.losses || 0;
      desc = `**Week ${week}** — Wins: **${wins}**, Losses: **${losses}**`;
    } else {
      wins = perf.reduce((a, e) => a + (e.wins || 0), 0);
      losses = perf.reduce((a, e) => a + (e.losses || 0), 0);
      desc = `**Overall** — Wins: **${wins}**, Losses: **${losses}**`;
    }

    const embed = new EmbedBuilder()
      .setTitle(`${player.name}${player.team?.name ? ` — ${player.team.name}` : ''}`)
      .setDescription(desc)
      .addFields(
        ...(week ? [] : [{
          name: 'Weekly breakdown',
          value: perf.length
            ? perf
                .sort((a, b) => a.week - b.week)
                .map(e => `Week ${e.week}: ${e.wins}-${e.losses}`).join('\n')
            : 'No matches recorded yet.'
        }])
      );

    return interaction.reply({ embeds: [embed], ephemeral });
  }
};
