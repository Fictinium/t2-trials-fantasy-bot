import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import getActiveSeason from '../utils/getActiveSeason.js';
import { calculateScoresForWeek } from '../services/scoring.js';

export default {
  data: new SlashCommandBuilder()
    .setName('calculatescores')
    .setDescription('Admin: recalculate scores for a given week')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption(opt =>
      opt.setName('week').setDescription('Week number to recalculate').setMinValue(1).setRequired(true)
    ),

  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: '❌ Admins only.', flags: 64 });
    }

    const season = await getActiveSeason();
    if (!season) {
      return interaction.reply({ content: '❌ No active season set.', flags: 64 });
    }
    const week = interaction.options.getInteger('week', true);
    if (!week || week < 1) {
      return interaction.reply({ content: 'Provide a valid week >= 1', flags: 64 });
    }

    await interaction.reply({ content: `Recalculating scores for season=${season.name} week=${week}...`, flags: 64 });
    const updated = await calculateScoresForWeek(season._id, week);
    return interaction.followUp({ content: `Done — updated ${updated} players`, flags: 64 });
  }
}