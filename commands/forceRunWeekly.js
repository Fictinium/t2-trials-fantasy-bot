import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { runWeeklyImportOnce } from '../jobs/weeklyImport.js';

export default {
  data: new SlashCommandBuilder()
    .setName('forcerunweekly')
    .setDescription('Run the weekly import + scoring immediately (DEV ONLY)'),
  async execute(interaction) {
    await interaction.reply({ content: 'Running weekly job (full recalculation)…', flags: 64 });
    const res = await runWeeklyImportOnce({ fullRecalc: true, advancePointer: false });
    return interaction.followUp({
      content: `Done:\n${JSON.stringify(res, null, 2)}`,
      flags: 64
    });
  }
}