import { SlashCommandBuilder } from 'discord.js';
import Season from '../models/Season.js';

export default {
  data: new SlashCommandBuilder()
    .setName('setseason')
    .setDescription('Set the active season')
    .addStringOption(opt =>
      opt.setName('name')
        .setDescription('Season name, e.g. S1, S2')
        .setRequired(true)
    ),

  async execute(interaction) {
    const name = interaction.options.getString('name');

    const season = await Season.findOne({ name });
    if (!season) {
      return interaction.reply({ content: `Season "${name}" not found.`, ephemeral: true });
    }

    await Season.updateMany({}, { $set: { isActive: false } });
    season.isActive = true;
    await season.save();

    return interaction.reply({ content: `Active season set to **${name}**.`, ephemeral: true });
  }
}