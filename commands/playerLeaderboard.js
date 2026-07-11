import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import getActiveSeason from '../utils/getActiveSeason.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';
import FantasyPlayer from '../models/FantasyPlayer.js';
import FantasyConfig from '../models/FantasyConfig.js';
import { totalPointsForPlayer, pointsForRealPlayerInFantasyTeam } from '../services/scoring.js';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

export default {
  data: new SlashCommandBuilder()
    .setName('playerleaderboard')
    .setDescription('Show the top T2 Trials players (wins/losses) for the current season')
    .addIntegerOption(opt =>
      opt.setName('week')
        .setDescription('Show standings for a specific week (1-based)')
        .setMinValue(1)
        .setRequired(false)
    )
    .addIntegerOption(opt =>
      opt.setName('limit')
        .setDescription(`How many entries to show (max ${MAX_LIMIT})`)
        .setMinValue(3)
        .setMaxValue(MAX_LIMIT)
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
    const week = interaction.options.getInteger('week') ?? null;
    const limit = interaction.options.getInteger('limit') ?? DEFAULT_LIMIT;
    const ephemeral = interaction.options.getBoolean('ephemeral') ?? false;

    const cfg = await FantasyConfig.findOne({ season: season._id }, { scoringMode: 1 }).lean();
    const scoringMode = cfg?.scoringMode ?? 'LEGACY_PHASE';

    // Query all T2TrialsPlayers for the current season
    const players = await T2TrialsPlayer.find({ season: season._id }, { name: 1, team: 1, performance: 1 }).populate('team').lean();
    if (!players.length) {
      return interaction.reply({ content: 'ℹ️ No T2 Trials players found.', flags: 64 });
    }

    const fantasyTeams = await FantasyPlayer.find({ season: season._id }, { team: 1, weeklyLineups: 1, weeklyPoints: 1 })
      .populate({ path: 'team', select: '_id' })
      .populate({ path: 'weeklyLineups.team', select: '_id' })
      .lean();

    const maxScoredWeek = fantasyTeams.reduce((m, f) => Math.max(m, Array.isArray(f?.weeklyPoints) ? f.weeklyPoints.length : 0), 0);

    // Calculate scores
    const rows = players.map(p => {
      let wins = 0, losses = 0, points = 0;
      if (week) {
        const perf = p.performance.find(w => w.week === week);
        wins = perf?.wins || 0;
        losses = perf?.losses || 0;
        if (scoringMode === 'WEEKLY_SNAPSHOT') {
          points = fantasyTeams.reduce((sum, fp) => sum + pointsForRealPlayerInFantasyTeam(p, fp, { scoringMode, week }), 0);
        } else {
          points = perf ? totalPointsForPlayer({ ...p, performance: [perf] }) : 0;
        }
      } else {
        wins = p.performance.reduce((sum, w) => sum + (w.wins || 0), 0);
        losses = p.performance.reduce((sum, w) => sum + (w.losses || 0), 0);
        if (scoringMode === 'WEEKLY_SNAPSHOT') {
          points = fantasyTeams.reduce((sum, fp) => sum + pointsForRealPlayerInFantasyTeam(p, fp, { scoringMode, upToWeek: maxScoredWeek }), 0);
        } else {
          points = totalPointsForPlayer(p);
        }
      }
      return {
        name: p.name,
        team: p.team?.name || 'Unknown',
        wins,
        losses,
        points,
        score: points,
      };
    });

    // Sort by wins desc, then losses asc, then name
    rows.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.losses !== b.losses) return a.losses - b.losses;
      return a.name.localeCompare(b.name);
    });

    // Limit output
    const top = rows.slice(0, Math.min(limit, MAX_LIMIT));

    // Render lines
    const lines = top.map((r, i) => {
      const rank = i + 1;
      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
      return `${medal} **${r.name}** (${r.team}) — ${r.points} pts | ${r.wins}W/${r.losses}L`;
    });

    const seasonName = season?.name || String(season?._id || '');
    const title = week ? `${seasonName} Week ${week} Player Leaderboard` : `Overall ${seasonName} Player Leaderboard`;
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(lines.join('\n') || 'No results.')
      .setFooter({ text: `Top ${top.length} players` });

    return interaction.reply({ embeds: [embed], flags: ephemeral ? 64 : undefined });
  }
};
