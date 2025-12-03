import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import getActiveSeason from '../utils/getActiveSeason.js';
import { calculateScoresForWeek } from '../services/scoring.js';
import { isAuthorizedForCommand } from '../utils/commandAuth.js';

export default {
  data: new SlashCommandBuilder()
    .setName('calculatescores')
    .setDescription('Admin: recalculate scores for a given week')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption(opt =>
      opt.setName('week').setDescription('Week number to recalculate').setMinValue(1).setRequired(true)
    ),

  async execute(interaction) {
    // allow Guild admins, OWNER_IDS, or roles listed in AUTHORIZATION_ROLE_IDS
    const allowed = await isAuthorizedForCommand(interaction, { allowedRoleEnvVar: 'AUTHORIZATION_ROLE_IDS', allowGuildAdmins: true });
    if (!allowed) {
      return interaction.reply({ content: '❌ You do not have permission to run this command.', flags: 64 });
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