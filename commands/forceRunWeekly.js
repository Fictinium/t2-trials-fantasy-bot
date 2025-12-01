import { SlashCommandBuilder } from 'discord.js';
import { runWeeklyImportOnce } from '../jobs/weeklyImport.js';

export default {
  data: new SlashCommandBuilder()
    .setName('forcerunweekly')
    .setDescription('Run the weekly import + scoring immediately (DEV ONLY)'),
  async execute(interaction) {
    await interaction.reply({ content: 'Running weekly job…', ephemeral: true });
    const res = await runWeeklyImportOnce();
    return interaction.followUp({
      content: `Done:\n${JSON.stringify(res, null, 2)}`,
      ephemeral: true
    });
  }
}