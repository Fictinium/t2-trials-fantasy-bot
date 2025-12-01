import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import Season from '../models/Season.js';
import FantasyConfig from '../models/FantasyConfig.js';

export default {
  data: new SlashCommandBuilder()
    .setName('seasoninfo')
    .setDescription('Show information about the active season'),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'This command can only be used in servers.', flags: 64 });
    }

    await interaction.deferReply({ flags: 64 });

    const season = await Season.findOne({ isActive: true }).lean();
    if (!season) {
      return interaction.editReply('❌ No active season.');
    }

    const cfg = await FantasyConfig.findOne({ season: season._id }).lean();

    return interaction.editReply(
      `📘 **Active Season Information**\n\n` +
      `**Name:** ${season.name}\n` +
      `**Created:** <t:${Math.floor(new Date(season.createdAt).getTime() / 1000)}:R>\n\n` +
      `**FantasyConfig:**\n` +
      `• Phase: **${cfg?.phase ?? 'N/A'}**\n` +
      `• Current Week: **${cfg?.currentWeek ?? 'N/A'}**\n` +
      `• Playoff Swap Limit: **${cfg?.playoffSwapLimit ?? 'N/A'}**\n`
    );
  }
};