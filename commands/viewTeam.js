import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { pointsForRealPlayerInFantasyTeam } from '../services/scoring.js';
import getActiveSeason from '../utils/getActiveSeason.js';
import FantasyPlayer from '../models/FantasyPlayer.js';
import isRegistered from '../utils/checkRegistration.js';
import FantasyConfig from '../models/FantasyConfig.js';

export default {
  data: new SlashCommandBuilder()
    .setName('viewteam')
    .setDescription('View another fantasy player’s team')
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('The fantasy player to view')
        .setRequired(true)
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
    const MAX_TEAM_SIZE = season?.maxTeamSize ?? 7; // keep in sync with pickPlayer
    const targetUser = interaction.options.getUser('user', true);
    const ephemeral = interaction.options.getBoolean('ephemeral') ?? false;

    if (!await isRegistered(targetUser.id)) {
      return interaction.reply({
        content: `⚠️ ${targetUser.username} is not registered in the fantasy league.`,
        flags: 64
      });
    }

    const fantasyPlayer = await FantasyPlayer.findOne({ discordId: targetUser.id, season: season._id })
      .populate({
        path: 'team',
        populate: { path: 'team', model: 'Team', select: 'name' }
      })
      .populate({ path: 'weeklyLineups.team', select: 'name team performance cost' })
      .lean();

    const cfg = await FantasyConfig.findOne({ season: season._id }, { scoringMode: 1 }).lean();
    const scoringMode = cfg?.scoringMode ?? 'LEGACY_PHASE';

    const roster = fantasyPlayer?.team ?? [];
    if (!roster.length) {
      return interaction.reply({
        content: `📝 ${targetUser.username} has an empty fantasy team.`,
        flags: ephemeral ? 64 : undefined
      });
    }

    // Build roster lines
    const lines = roster.map((p, i) => {
      const teamName = p.team?.name ? ` — *${p.team.name}*` : '';
      const playerPts = pointsForRealPlayerInFantasyTeam(p, fantasyPlayer, { scoringMode });
      return `**${i + 1}.** ${p.name}${teamName} — ${playerPts} pts`;
    });

    const totalPoints = Number.isFinite(fantasyPlayer.totalPoints) ? fantasyPlayer.totalPoints : 0;
    const wallet = fantasyPlayer.wallet ?? 0;

    const embed = new EmbedBuilder()
      .setTitle(`${fantasyPlayer.username || targetUser.username}’s Fantasy Team`)
      .setDescription(lines.join('\n'))
      .setFooter({
        text: `Players: ${roster.length}/${MAX_TEAM_SIZE} • Total points: ${totalPoints} • Wallet: ${wallet}`
      });

    return interaction.reply({ embeds: [embed], flags: ephemeral ? 64 : undefined });
  }
};