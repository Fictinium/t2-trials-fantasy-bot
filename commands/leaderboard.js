import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import getActiveSeason from '../utils/getActiveSeason.js';
import FantasyPlayer from '../models/FantasyPlayer.js';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

export default {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show the T2 Trials fantasy leaderboard (overall or for a specific week)')
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

    // Pull all fantasy players; we only need username + points arrays
    const fantasyPlayers = await FantasyPlayer.find({season: season._id}, { username: 1, discordId: 1, weeklyPoints: 1, totalPoints: 1 }).lean();

    if (!fantasyPlayers.length) {
      return interaction.reply({ content: 'ℹ️ No fantasy players yet.', flags: 64 });
    }

    // Build a list with the score we want to sort by
    const rows = fantasyPlayers.map(p => {
      const name = p.username || `User ${p.discordId}`;
      let score = p.totalPoints || 0;

      if (week) {
        const idx = week - 1;
        const w = Array.isArray(p.weeklyPoints) ? p.weeklyPoints[idx] : 0;
        score = Number.isFinite(w) ? w : 0;
      }

      return {
        discordId: p.discordId,
        name,
        total: p.totalPoints || 0,
        weeklyPoints: p.weeklyPoints || [],
        score,
      };
    });

    // Sort: primary by requested score desc, secondary by total desc (for week view), then name
    rows.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (week && b.total !== a.total) return b.total - a.total;
      return a.name.localeCompare(b.name);
    });

    // Limit output
    const top = rows.slice(0, Math.min(limit, MAX_LIMIT));

    // Find caller rank (nice UX)
    const callerId = interaction.user.id;
    const callerRank = rows.findIndex(r => r.discordId === callerId) + 1; // 1-based; 0 means not found

    // Render lines
    const lines = top.map((r, i) => {
      const rank = i + 1;
      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
      const right = week ? `${r.score} pts (total ${r.total})` : `${r.score} pts`;
      return `${medal} **${r.name}** — ${right}`;
    });

    const title = week ? `Week ${week} Leaderboard` : 'Overall Leaderboard';
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(lines.join('\n') || 'No results.')
      .setFooter({ text: callerRank ? `Your rank: #${callerRank}` : 'You are not on the board yet' });

    return interaction.reply({ embeds: [embed], flags: ephemeral ? 64 : undefined });
  }
};
