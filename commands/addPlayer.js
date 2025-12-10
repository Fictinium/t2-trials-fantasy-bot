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
        .setAutocomplete(true)
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
    )
    .addBooleanOption(opt =>
      opt.setName('substitution')
        .setDescription('Substitute an existing player (true/false)')
        .setRequired(true)
    ),

  async execute(interaction) {
    // Authorization check
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
    const substitution = interaction.options.getBoolean('substitution', true);

    // Find the team
    const team = await Team.findOne({ name: teamName, season: season._id });
    if (!team) {
      return interaction.reply({ content: `❌ Team **${teamName}** not found in season **${season.name}**.`, flags: 64 });
    }

    if (substitution) {
      // Substitution logic
      const existingPlayers = await T2TrialsPlayer.find({ name, season: season._id });

      if (!existingPlayers.length) {
        return interaction.reply({ content: `❌ No existing players found with the name **${name}** in season **${season.name}**.`, flags: 64 });
      }

      // Filter players by matching fields
      const matchingPlayers = existingPlayers.filter(player => {
        let matchCount = 0;
        if (player.team?.toString() === team._id.toString()) matchCount++;
        if (player.cost === cost) matchCount++;
        return matchCount === 2; // Exactly 2 fields must match
      });

      if (matchingPlayers.length === 0) {
        return interaction.reply({ content: `❌ No players found with exactly 2 matching fields. Ensure the name, team, and cost are correct.`, flags: 64 });
      }

      if (matchingPlayers.length > 1) {
        return interaction.reply({ content: `⚠️ Multiple players found with 2 matching fields. Please refine your criteria.`, flags: 64 });
      }

      // Perform substitution
      const playerToUpdate = matchingPlayers[0];
      if (playerToUpdate.team?.toString() !== team._id.toString()) {
        playerToUpdate.team = team._id;
      }
      playerToUpdate.cost = cost;
      await playerToUpdate.save();

      return interaction.reply({
        content: `✅ Substituted player **${playerToUpdate.name}** in team **${team.name}** with updated cost: ${cost}.`,
        flags: 64
      });
    } else {
      // Add new player logic
      const existingPlayer = await T2TrialsPlayer.findOne({ name, team: team._id, season: season._id });
      if (existingPlayer) {
        return interaction.reply({ content: `❌ Player **${name}** already exists in team **${team.name}** for season **${season.name}**.`, flags: 64 });
      }

      const newPlayer = await T2TrialsPlayer.create({
        name,
        season: season._id,
        team: team._id,
        cost: cost
      });

      // Add player to team if not already present
      if (!team.players.map(id => id.toString()).includes(newPlayer._id.toString())) {
        team.players.push(newPlayer._id);
        await team.save();
      }

      return interaction.reply({
        content: `✅ Player **${newPlayer.name}** added to team **${team.name}** (cost: ${cost}).`,
        flags: 64
      });
    }
  },
  
  async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused(); // Get the current input
    const season = await getActiveSeason();
    if (!season) return interaction.respond([]);

    // Fetch players whose names match the input
    const players = await T2TrialsPlayer.find({ season: season._id, name: { $regex: new RegExp(focusedValue, 'i') } })
      .limit(25) // Discord allows up to 25 suggestions
      .lean();

    const suggestions = players.map(player => ({
      name: `${player.name} (${player.team?.name || 'Unknown Team'})`,
      value: player.name
    }));

    return interaction.respond(suggestions);
  }
};