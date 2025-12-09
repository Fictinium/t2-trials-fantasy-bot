import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import getActiveSeason from '../utils/getActiveSeason.js';
import { isAuthorizedForCommand } from '../utils/commandAuth.js';
import Team from '../models/Team.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';

export default {
  data: new SlashCommandBuilder()
    .setName('addplayer')
    .setDescription('Admin: manually create or add a player to a team')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(opt =>
      opt.setName('name')
        .setDescription('Player name')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('team')
        .setDescription('Team name to add the player to')
        .setRequired(true)
    )
    .addIntegerOption(opt =>
      opt.setName('cost')
        .setDescription('Fantasy league cost for this player')
        .setMinValue(0)
        .setRequired(true)
    ),

  async execute(interaction) {
    // authorization check
    const allowed = await isAuthorizedForCommand(interaction, { allowedRoleEnvVar: 'AUTHORIZATION_ROLE_IDS', allowGuildAdmins: true });
    if (!allowed) {
      return interaction.reply({ content: '❌ You do not have permission to run this command.', flags: 64 });
    }

    const season = await getActiveSeason();
    if (!season) {
      return interaction.reply({ content: '❌ No active season set.', flags: 64 });
    }

    const name = interaction.options.getString('name', true).trim();
    const teamName = interaction.options.getString('team', true).trim();
    const cost = interaction.options.getInteger('cost', true);

    // Find the team
    const team = await Team.findOne({ name: teamName, season: season._id });
    if (!team) {
      return interaction.reply({ content: `❌ Team **${teamName}** not found in season **${season.name}**.`, flags: 64 });
    }

    // Check if player already exists for this season
    let player = await T2TrialsPlayer.findOne({ name, season: season._id });

    if (player) {
      // If already in team, just update cost if needed
      if (player.team?.toString() !== team._id.toString()) {
        player.team = team._id;
      }
      player.cost = cost;
      await player.save();
    } else {
      // Create new player
      player = await T2TrialsPlayer.create({
        name,
        season: season._id,
        team: team._id,
        cost: cost
      });
    }

    // Add player to team if not already present
    if (!team.players.map(id => id.toString()).includes(player._id.toString())) {
      team.players.push(player._id);
      await team.save();
    }

    return interaction.reply({
      content: `✅ Player **${player.name}** added to team **${team.name}** (cost: ${cost}).`,
      flags: 64
    });
  }
};