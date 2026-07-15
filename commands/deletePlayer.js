import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import getActiveSeason from '../utils/getActiveSeason.js';
import { isAuthorizedForCommand } from '../utils/commandAuth.js';
import { escapeRegex } from '../utils/escapeRegex.js';
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
        .setAutocomplete(true)
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('team')
        .setDescription('Team name the player belongs to')
        .setAutocomplete(true)
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
    const team = await Team.findOne({
      name: { $regex: `^${escapeRegex(teamName)}$`, $options: 'i' },
      season: season._id
    });
    if (!team) {
      return interaction.reply({ content: `❌ Team **${teamName}** not found in season **${season.name}**.`, ephemeral: true });
    }

    // Find the player in the team
    const player = await T2TrialsPlayer.findOne({
      name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' },
      team: team._id,
      season: season._id
    });
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
  },

  async autocomplete(interaction) {
    try {
      const focused = interaction.options.getFocused(true);
      const focusedValue = focused?.value || '';

      const season = await getActiveSeason();
      if (!season) {
        return interaction.respond([]);
      }

      if (focused?.name === 'name') {
        const teamName = interaction.options.getString('team') || null;
        let teamId = null;
        if (teamName) {
          const teamDoc = await Team.findOne({
            season: season._id,
            name: { $regex: `^${escapeRegex(teamName)}$`, $options: 'i' }
          }).select('_id').lean();
          teamId = teamDoc?._id ?? null;
        }

        const query = {
          season: season._id,
          name: { $regex: new RegExp(escapeRegex(focusedValue), 'i') }
        };
        if (teamId) query.team = teamId;

        const players = await T2TrialsPlayer.find(query)
          .select('name')
          .limit(100)
          .lean();

        const uniqueNames = [...new Set(players.map(p => p?.name).filter(Boolean))].slice(0, 25);
        return interaction.respond(uniqueNames.map(playerName => ({ name: playerName, value: playerName })));
      }

      if (focused?.name === 'team') {
        const playerName = interaction.options.getString('name') || null;

        if (playerName) {
          const teamIds = await T2TrialsPlayer.distinct('team', {
            season: season._id,
            name: { $regex: `^${escapeRegex(playerName)}$`, $options: 'i' }
          });

          if (teamIds.length) {
            const teams = await Team.find({
              _id: { $in: teamIds },
              season: season._id,
              name: { $regex: new RegExp(escapeRegex(focusedValue), 'i') }
            })
              .select('name')
              .sort({ name: 1 })
              .limit(25)
              .lean();

            return interaction.respond(teams.map(t => ({ name: t.name, value: t.name })));
          }
        }

        const teams = await Team.find({
          season: season._id,
          name: { $regex: new RegExp(escapeRegex(focusedValue), 'i') }
        })
          .select('name')
          .sort({ name: 1 })
          .limit(25)
          .lean();

        return interaction.respond(teams.map(t => ({ name: t.name, value: t.name })));
      }

      return interaction.respond([]);
    } catch (err) {
      console.error(err);
      return interaction.respond([]);
    }
  }
};