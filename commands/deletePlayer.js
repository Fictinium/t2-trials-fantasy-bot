import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import getActiveSeason from '../utils/getActiveSeason.js';
import { isAuthorizedForCommand } from '../utils/commandAuth.js';
import Team from '../models/Team.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';
import FantasyPlayer from '../models/FantasyPlayer.js'; // <-- Add this import

export default {
  data: new SlashCommandBuilder()
    .setName('deleteplayer')
    .setDescription('Admin: delete a player from a T2 Trials team')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(opt =>
      opt.setName('name')
        .setDescription('Name of the player to delete')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('team')
        .setDescription('Team name the player belongs to')
        .setRequired(true)
    ),

  async execute(interaction) {
    // Authorization check
    const allowed = await isAuthorizedForCommand(interaction, { allowedRoleEnvVar: 'AUTHORIZATION_ROLE_IDS', allowGuildAdmins: true });
    if (!allowed) {
      return interaction.reply({ content: '❌ You do not have permission to run this command.', ephemeral: true });
    }

    const season = await getActiveSeason();
    if (!season) {
      return interaction.reply({ content: '❌ No active season set.', ephemeral: true });
    }

    const name = interaction.options.getString('name', true).trim();
    const teamName = interaction.options.getString('team', true).trim();

    // Find the team
    const team = await Team.findOne({ name: teamName, season: season._id });
    if (!team) {
      return interaction.reply({ content: `❌ Team **${teamName}** not found in season **${season.name}**.`, ephemeral: true });
    }

    // Find the player in the team
    const player = await T2TrialsPlayer.findOne({ name, team: team._id, season: season._id });
    if (!player) {
      return interaction.reply({ content: `❌ Player **${name}** not found in team **${team.name}** for season **${season.name}**.`, ephemeral: true });
    }

    try {
      // Remove the player from the team
      await T2TrialsPlayer.deleteOne({ _id: player._id });

      // Remove the player reference from the team's players array
      team.players = team.players.filter(p => p.toString() !== player._id.toString());
      await team.save();

      // Remove the player reference from all fantasy teams
      await FantasyPlayer.updateMany(
        { season: season._id },
        { $pull: { team: player._id } }
      );

      return interaction.reply({
        content: `✅ Player **${name}** has been deleted from team **${team.name}** and removed from all fantasy teams.`,
        ephemeral: true
      });
    } catch (err) {
      console.error(err);
      return interaction.reply({ content: `❌ An error occurred while deleting the player: ${err.message}`, ephemeral: true });
    }
  }
};