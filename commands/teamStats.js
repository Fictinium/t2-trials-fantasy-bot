import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { escapeRegex } from '../utils/escapeRegex.js';
import { computePointsForPerfSimple, totalPointsForPlayer } from '../services/scoring.js';
import getActiveSeason from '../utils/getActiveSeason.js';
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
    const season = await getActiveSeason();
    if (!season) {
      return interaction.reply({ content: '❌ No active season set.', flags: 64 });
    }
    const teamName = interaction.options.getString('team', true);
    const week = interaction.options.getInteger('week') || null;
    const ephemeral = interaction.options.getBoolean('ephemeral') ?? false;

    const team = await Team.findOne({ name: { $regex: `^${escapeRegex(teamName)}$`, $options: 'i' }, season: season._id })
      .populate({ path: 'players', select: 'name performance', options: { sort: { name: 1 } } })
      .lean();

    if (!team) {
      return interaction.reply({ content: `❌ Team **${teamName}** not found.`, flags: 64 });
    }

    const players = Array.isArray(team.players) ? team.players : [];


    // Aggregate wins/losses and points per player (new sets/rounds/games logic)
    let totalWins = 0, totalLosses = 0;
    let totalPoints = 0;
    function buildBreakdown(entry, player) {
      if (!entry || !Array.isArray(entry.sets)) return '';
      return entry.sets.map((set, si) => {
        const setLabel = `Set ${si + 1}`;
        const rounds = (set.rounds || []).map((round, ri) => {
          const games = (round.games || []).map((game, gi) => {
            let winner;
            if (game.winner === 'A') winner = String(game.playerA) === String(player._id) ? 'W' : 'L';
            else if (game.winner === 'B') winner = String(game.playerB) === String(player._id) ? 'W' : 'L';
            else winner = '-';
            return `G${gi + 1}:${winner}`;
          }).join(' ');
          return `  Round ${ri + 1}: ${games}`;
        }).join('\n');
        return `${setLabel}:\n${rounds}`;
      }).join('\n');
    }
    const rows = players.map(p => {
      const perf = Array.isArray(p.performance) ? p.performance : [];
      if (week) {
        const entry = perf.find(e => e.week === week);
        const w = entry?.wins || 0;
        const l = entry?.losses || 0;
        const pts = computePointsFromPerf(entry, p, week);
        totalWins += w; totalLosses += l;
        totalPoints += pts;
        const breakdown = buildBreakdown(entry, p);
        return `• ${p.name}: ${w}-${l} (${pts} pts)${breakdown ? `\n${breakdown}` : ''}`;
      } else {
        const w = perf.reduce((a, e) => a + (e.wins || 0), 0);
        const l = perf.reduce((a, e) => a + (e.losses || 0), 0);
        const pts = totalPointsForPlayer(p);
        totalWins += w; totalLosses += l;
        totalPoints += pts;
        // Optionally, show overall breakdown per player (not per set/week)
        return `• ${p.name}: ${w}-${l} (${pts} pts)`;
      }
    });

    const seasonName = season?.name || String(season?._id || '');
    const title = week ? `${team.name} — ${seasonName} Week ${week}` : `${team.name} — ${seasonName} Overall`;
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(rows.length ? rows.join('\n') : 'No players recorded.')
      .setFooter({ text: `Team total: ${totalWins}-${totalLosses} • Points: ${totalPoints}` });

    return interaction.reply({ embeds: [embed], flags: ephemeral ? 64 : undefined });
  }
};
