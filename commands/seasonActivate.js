import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { isAuthorizedForCommand } from '../utils/commandAuth.js';
import Season from '../models/Season.js';
import FantasyConfig from '../models/FantasyConfig.js';

export default {
  data: new SlashCommandBuilder()
    .setName('seasonactivate')
    .setDescription('Admin: set a season as the active one')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o =>
      o.setName('name')
       .setDescription('Season name, e.g. S1, S2, Winter2025')
       .setRequired(true)
    ),

  async execute(interaction) {
    // allow Guild admins, OWNER_IDS, or roles listed in AUTHORIZATION_ROLE_IDS
    const allowed = await isAuthorizedForCommand(interaction, { allowedRoleEnvVar: 'AUTHORIZATION_ROLE_IDS', allowGuildAdmins: true });
    if (!allowed) {
      return interaction.reply({ content: '❌ You do not have permission to run this command.', flags: 64 });
    }

    await interaction.deferReply({ flags: 64 });
    const name = interaction.options.getString('name');

    const season = await Season.findOne({ name });
    if (!season) {
      return interaction.editReply(`❌ Season **${name}** does not exist.`);
    }

    // Deactivate all
    await Season.updateMany({}, { isActive: false });

    // Activate selected
    season.isActive = true;
    await season.save();

    // Ensure config exists
    let cfg = await FantasyConfig.findOne({ season: season._id });
    if (!cfg) {
      cfg = await FantasyConfig.create({
        seasonName: name,
        season: season._id,
        phase: 'PRESEASON',
        currentWeek: 1,
        playoffSwapLimit: 2
      });
    }

    return interaction.editReply(
      `✅ Activated season **${name}**.\n` +
      `• Phase: **${cfg.phase}**\n` +
      `• Current week: **${cfg.currentWeek}**`
    );
  }
};