import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { escapeRegex } from '../utils/escapeRegex.js';
import { computePointsForPerfSimple, computePointsFromPerf } from '../services/scoring.js';
import getActiveSeason from '../utils/getActiveSeason.js';
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
    const season = await getActiveSeason();
    if (!season) {
      return interaction.reply({ content: '❌ No active season set.', flags: 64 });
    }
    const name = interaction.options.getString('player', true);
    const teamName = interaction.options.getString('team') || null;
    const week = interaction.options.getInteger('week') || null;
    const ephemeral = interaction.options.getBoolean('ephemeral') ?? false;

    // Find by name (+ optional team filter)
    const nameFilter = { name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' }, season: season._id };
    let teamFilter = {};
    if (teamName) {
      const teamDoc = await Team.findOne({ name: { $regex: `^${escapeRegex(teamName)}$`, $options: 'i' }, season: season._id });
      if (!teamDoc) {
        return interaction.reply({ content: `❌ Team "${teamName}" not found.`, flags: 64 });
      }
      teamFilter = { team: teamDoc._id };
    }

    const player = await T2TrialsPlayer.findOne({ ...nameFilter, ...teamFilter })
      .populate('team', 'name')
      .lean();

    if (!player) {
      return interaction.reply({
        content: `❌ Player **${name}**${teamName ? ` in team **${teamName}**` : ''} not found.`,
        flags: 64
      });
    }


    const perf = Array.isArray(player.performance) ? player.performance : [];
    let wins = 0, losses = 0, desc = '';


    // Helper to build set/round/game breakdown
    function buildBreakdown(entry) {
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


    let embed;
    if (week) {
      const entry = perf.find(e => e.week === week);
      wins = entry?.wins || 0;
      losses = entry?.losses || 0;
      const points = computePointsFromPerf(entry, player, week);
      desc = `**Week ${week}** — Wins: **${wins}**, Losses: **${losses}** — Points: **${points}**`;
      const breakdown = buildBreakdown(entry);
      if (breakdown) desc += `\n\n${breakdown}`;
      embed = new EmbedBuilder()
        .setTitle(`${player.name}${player.team?.name ? ` — ${player.team.name}` : ''}`)
        .setDescription(desc);
    } else {
      wins = perf.reduce((a, e) => a + (e.wins || 0), 0);
      losses = perf.reduce((a, e) => a + (e.losses || 0), 0);
      desc = `**Overall** — Wins: **${wins}**, Losses: **${losses}**`;
      embed = new EmbedBuilder()
        .setTitle(`${player.name}${player.team?.name ? ` — ${player.team.name}` : ''}`)
        .setDescription(desc)
        .addFields(
          perf.length
            ? [{
                name: 'Weekly breakdown',
                value: perf
                  .sort((a, b) => a.week - b.week)
                  .map(e => {
                    // Use computePointsForPerfSimple to support both old and new structures
                    const pts = computePointsForPerfSimple({ ...e, playerId: player._id });
                    const breakdown = buildBreakdown(e);
                    return `Week ${e.week}: ${e.wins}-${e.losses} (${pts} pts)${breakdown ? `\n${breakdown}` : ''}`;
                  }).join('\n')
              }]
            : [{ name: 'Weekly breakdown', value: 'No matches recorded yet.' }]
        );
    }

    return interaction.reply({ embeds: [embed], flags: ephemeral ? 64 : undefined });
  }/*,
    const embed = new EmbedBuilder()
      .setTitle(`${player.name}${player.team?.name ? ` \u2014 ${player.team.name}` : ''}`)
      .setDescription(desc)
      .addFields(
        ...(week ? [] : [{
          name: 'Weekly breakdown',
          value: perf.length
            ? perf
                .sort((a, b) => a.week - b.week)
                .map(e => {
                  const pts = computePointsFromPerf(e, player, e.week);
                  const breakdown = buildBreakdown(e);
                  return `Week ${e.week}: ${e.wins}-${e.losses} (${pts} pts)${breakdown ? `\n${breakdown}` : ''}`;
                }).join('\n')
            : 'No matches recorded yet.'
        }])
      );

    return interaction.reply({ embeds: [embed], flags: ephemeral ? 64 : undefined });
  }
  
  async autocomplete(interaction) {
    try {
      const focusedValue = interaction.options.getFocused(); // Get the current input
      console.log('Focused value:', focusedValue); // Debugging

      const season = await getActiveSeason();
      if (!season) {
        console.error('No active season found.');
        return interaction.respond([]); // Return empty response if no season is active
      }

      // Fetch players whose names match the input
      const players = await T2TrialsPlayer.find({ season: season._id, name: { $regex: new RegExp(focusedValue, 'i') } })
        .limit(25) // Discord allows up to 25 suggestions
        .lean();

      console.log('Players found:', players); // Debugging

      // Format suggestions
      const suggestions = players.map(player => ({
        name: `${player.name} (${player.team?.name || 'Unknown Team'})`,
        value: player.name
      }));

      console.log('Suggestions:', suggestions); // Debugging

      return interaction.respond(suggestions);
    } catch (err) {
      console.error('Error in autocomplete:', err); // Log errors
      return interaction.respond([]); // Return empty response on error
    }
  }*/
};
