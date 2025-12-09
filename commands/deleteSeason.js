import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { isAuthorizedForCommand } from '../utils/commandAuth.js';
import Season from '../models/Season.js';
import Team from '../models/Team.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';
import FantasyPlayer from '../models/FantasyPlayer.js';
import Match from '../models/Match.js';
import FantasyConfig from '../models/FantasyConfig.js';

export default {
  data: new SlashCommandBuilder()
    .setName('deleteseason')
    .setDescription('Admin: delete a season and all its associated data')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(opt =>
      opt.setName('name')
        .setDescription('Season name to delete (e.g., S1, Winter2025)')
        .setRequired(true)
    ),

  async execute(interaction) {
    // Authorization check
    const allowed = await isAuthorizedForCommand(interaction, { allowedRoleEnvVar: 'AUTHORIZATION_ROLE_IDS', allowGuildAdmins: true });
    if (!allowed) {
      return interaction.reply({ content: '❌ You do not have permission to run this command.', ephemeral: true });
    }

    const seasonName = interaction.options.getString('name', true).trim();

    // Find the season
    const season = await Season.findOne({ name: seasonName });
    if (!season) {
      return interaction.reply({ content: `❌ Season **${seasonName}** not found.`, ephemeral: true });
    }

    try {
      // Delete all associated data
      await Team.deleteMany({ season: season._id });
      await T2TrialsPlayer.deleteMany({ season: season._id });
      await FantasyPlayer.deleteMany({ season: season._id });
      await Match.deleteMany({ season: season._id });
      await FantasyConfig.deleteMany({ season: season._id });

      // Delete the season itself
      await season.deleteOne();

      return interaction.reply({
        content: `✅ Season **${seasonName}** and all associated data have been deleted.`,
        ephemeral: true
      });
    } catch (err) {
      console.error('[deleteSeason]', err);
      return interaction.reply({ content: `❌ Error deleting season: ${err.message || err}`, ephemeral: true });
    }
  }
};