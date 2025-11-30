import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getActiveSeason } from '../utils/getActiveSeason.js';
import FantasyPlayer from '../models/FantasyPlayer.js';
import isRegistered from '../utils/checkRegistration.js';

const MAX_TEAM_SIZE = 5; // keep in sync with the pick command

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
      .lean();

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
      return `**${i + 1}.** ${p.name}${teamName}`;
    });

    const embed = new EmbedBuilder()
      .setTitle(`${fantasyPlayer.username || targetUser.username}’s Fantasy Team`)
      .setDescription(lines.join('\n'))
      .setFooter({
        text: `Players: ${roster.length}/${MAX_TEAM_SIZE} • Total points: ${fantasyPlayer.totalPoints ?? 0}`
      });

    return interaction.reply({ embeds: [embed], flags: ephemeral ? 64 : undefined });
  }
};
