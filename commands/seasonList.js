import { SlashCommandBuilder } from 'discord.js';
import Season from '../models/Season.js';

export default {
  data: new SlashCommandBuilder()
    .setName('seasonlist')
    .setDescription('List all fantasy seasons'),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'This command can only be used in servers.', flags: 64 });
    }

    await interaction.deferReply({ flags: 64 });

    const seasons = await Season.find().sort({ createdAt: 1 }).lean();
    if (!seasons.length) {
      return interaction.editReply('No seasons exist.');
    }

    const lines = seasons.map(s =>
      `${s.isActive ? '🟢' : '⚪'} **${s.name}** — created <t:${Math.floor(new Date(s.createdAt).getTime() / 1000)}:R>`
    );

    return interaction.editReply(lines.join('\n'));
  }
};