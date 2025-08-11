import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { escapeRegex } from '../utils/escapeRegex.js';
import Team from '../models/Team.js';

export default {
  data: new SlashCommandBuilder()
    .setName('teamstats')
    .setDescription('Show a T2 Trials team roster and aggregate stats')
    .addStringOption(opt =>
      opt.setName('team')
        .setDescription('Team name')
        .setRequired(true)
    )
    .addIntegerOption(opt =>
      opt.setName('week')
        .setDescription('Specific week (1-based)')
        .setMinValue(1)
    )
    .addBooleanOption(opt =>
      opt.setName('ephemeral')
        .setDescription('Show only to you')
    ),

  async execute(interaction) {
    const teamName = interaction.options.getString('team', true);
    const week = interaction.options.getInteger('week') || null;
    const ephemeral = interaction.options.getBoolean('ephemeral') ?? false;

    const team = await Team.findOne({ name: { $regex: `^${escapeRegex(teamName)}$`, $options: 'i' } })
      .populate({ path: 'players', select: 'name performance', options: { sort: { name: 1 } } })
      .lean();

    if (!team) {
      return interaction.reply({ content: `❌ Team **${teamName}** not found.`, flags: 64 });
    }

    const players = Array.isArray(team.players) ? team.players : [];

    // Aggregate wins/losses
    let totalWins = 0, totalLosses = 0;
    const rows = players.map(p => {
      const perf = Array.isArray(p.performance) ? p.performance : [];
      if (week) {
        const entry = perf.find(e => e.week === week);
        const w = entry?.wins || 0;
        const l = entry?.losses || 0;
        totalWins += w; totalLosses += l;
        return `• ${p.name}: ${w}-${l}`;
      } else {
        const w = perf.reduce((a, e) => a + (e.wins || 0), 0);
        const l = perf.reduce((a, e) => a + (e.losses || 0), 0);
        totalWins += w; totalLosses += l;
        return `• ${p.name}: ${w}-${l}`;
      }
    });

    const title = week ? `${team.name} — Week ${week}` : `${team.name} — Overall`;
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(rows.length ? rows.join('\n') : 'No players recorded.')
      .setFooter({ text: `Team total: ${totalWins}-${totalLosses}` });

    return interaction.reply({ embeds: [embed], flags: ephemeral ? 64 : undefined });
  }
};
