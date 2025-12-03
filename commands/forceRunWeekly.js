import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { runWeeklyImportOnce } from '../jobs/weeklyImport.js';
import { isAuthorizedForCommand } from '../utils/commandAuth.js';

export default {
  data: new SlashCommandBuilder()
    .setName('forcerunweekly')
    .setDescription('Run the weekly import + scoring immediately (DEV ONLY)'),
  async execute(interaction) {
    // allow Guild admins, OWNER_IDS, or roles listed in AUTHORIZATION_ROLE_IDS
    const allowed = await isAuthorizedForCommand(interaction, { allowedRoleEnvVar: 'AUTHORIZATION_ROLE_IDS', allowGuildAdmins: true });
    if (!allowed) {
      return interaction.reply({ content: '❌ You do not have permission to run this command.', flags: 64 });
    }

    await interaction.reply({ content: 'Running weekly job (full recalculation)…', flags: 64 });
    const res = await runWeeklyImportOnce({ fullRecalc: true, advancePointer: false });
    return interaction.followUp({
      content: `Done:\n${JSON.stringify(res, null, 2)}`,
      flags: 64
    });
  }
}