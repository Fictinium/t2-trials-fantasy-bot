import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
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
        .setRequired(false)
    ),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('user', true);
    const ephemeral = interaction.options.getBoolean('ephemeral') ?? false;

    const registered = await isRegistered(targetUser.id);
    if (!registered) {
      return interaction.reply({
        content: `⚠️ ${targetUser.username} is not registered in the fantasy league.`,
        ephemeral: true
      });
    }

    const fantasyPlayer = await FantasyPlayer.findOne({ discordId: targetUser.id })
      .populate('team') // team is array of T2TrialsPlayer docs
      .lean();

    const roster = fantasyPlayer?.team ?? [];
    if (!roster.length) {
      return interaction.reply({
        content: `📝 ${targetUser.username} has an empty fantasy team.`,
        ephemeral
      });
    }

    // Build roster lines
    const lines = roster.map((p, i) => `**${i + 1}.** ${p.name}${p.team ? ` — *${p.team}*` : ''}`);

    const embed = new EmbedBuilder()
      .setTitle(`${fantasyPlayer.username || targetUser.username}’s Fantasy Team`)
      .setDescription(lines.join('\n'))
      .setFooter({
        text: `Players: ${roster.length}/${MAX_TEAM_SIZE} • Total points: ${fantasyPlayer.totalPoints ?? 0}`
      });

    return interaction.reply({ embeds: [embed], ephemeral });
  }
};
