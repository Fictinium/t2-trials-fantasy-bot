import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import getActiveSeason from '../utils/getActiveSeason.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

export default {
  data: new SlashCommandBuilder()
    .setName('mostpickedplayers')
    .setDescription('Show the most-picked players in fantasy teams')
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
    const limit = interaction.options.getInteger('limit') ?? DEFAULT_LIMIT;
    const ephemeral = interaction.options.getBoolean('ephemeral') ?? false;

    // Fetch all players and count how many fantasy teams they are in
    const players = await T2TrialsPlayer.find({ season: season._id })
      .populate('team', 'name') // Populate team name
      .lean();

    if (!players.length) {
      return interaction.reply({ content: 'ℹ️ No players found for this season.', flags: 64 });
    }

    // Count how many fantasy teams each player is in
    const playerCounts = players.map(p => ({
        name: p.name,
        team: p.team?.name || 'Unknown Team',
        count: Array.isArray(p.fantasyTeams) ? p.fantasyTeams.length : 0
    }));

    // Sort players by count (descending) and then by name
    playerCounts.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name);
    });

    // Limit the output
    const topPlayers = playerCounts.slice(0, Math.min(limit, MAX_LIMIT));

    // Render the leaderboard
    const lines = topPlayers.map((p, i) => {
      const rank = i + 1;
      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
      return `${medal} **${p.name}** (${p.team}) — ${p.count} picks`;
    });

    const embed = new EmbedBuilder()
      .setTitle(`Most-Picked Players in Fantasy Teams (${season.name})`)
      .setDescription(lines.join('\n') || 'No results.')
      .setFooter({ text: `Showing top ${topPlayers.length} players` });

    return interaction.reply({ embeds: [embed], flags: ephemeral ? 64 : undefined });
  }
};