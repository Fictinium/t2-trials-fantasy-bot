import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import getActiveSeason from '../utils/getActiveSeason.js';
import { isAuthorizedForCommand } from '../utils/commandAuth.js';
import { escapeRegex } from '../utils/escapeRegex.js';
import Team from '../models/Team.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';

export default {
  data: new SlashCommandBuilder()
    .setName('addplayer')
    .setDescription('Admin: manually create or add a player to a team')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(opt =>
      opt.setName('name')
        .setDescription('Player name (for add or substitution)')
        .setAutocomplete(true)
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('team')
        .setDescription('Team name to add the player to')
        .setAutocomplete(true)
        .setRequired(true)
    )
    .addIntegerOption(opt =>
      opt.setName('cost')
        .setDescription('Fantasy league cost for this player')
        .setMinValue(0)
        .setRequired(true)
    )
    // externalId will be assigned automatically
    .addBooleanOption(opt =>
      opt.setName('substitution')
        .setDescription('Substitute an existing player (true/false)')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('newname')
        .setDescription('New name for substitution (required only if changing name)')
        .setRequired(false)
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
    const newName = interaction.options.getString('newname', false)?.trim();

    // Find the team
    const team = await Team.findOne({
      name: { $regex: `^${escapeRegex(teamName)}$`, $options: 'i' },
      season: season._id
    });
    if (!team) {
      return interaction.reply({ content: `❌ Team **${teamName}** not found in season **${season.name}**.`, flags: 64 });
    }

    if (substitution) {
      // Fast path for cost correction: if player exists in this team/season, update cost directly.
      // This is resilient to problematic existing values (e.g. negative costs) and case differences.
      const directPlayer = await T2TrialsPlayer.findOne({
        name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' },
        team: team._id,
        season: season._id
      });

      if (directPlayer && Number(directPlayer.cost) !== Number(cost)) {
        directPlayer.cost = cost;
        await directPlayer.save();
        return interaction.reply({
          content: `✅ Updated player cost for **${directPlayer.name}** in **${team.name}**: **${directPlayer.cost}**.`,
          flags: 64
        });
      }

      // Substitution logic: allow changing any one of name, team, or cost, as long as the other two match
      // Try all three possible substitutions
      const candidates = await T2TrialsPlayer.find({ season: season._id });
      let playerToUpdate = null;
      let fieldToChange = null;

      // 1. Change cost (name and team match)
      playerToUpdate = candidates.find(p => p.name === name && p.team?.toString() === team._id.toString() && p.cost !== cost);
      if (playerToUpdate) fieldToChange = 'cost';

      // 2. Change team (name and cost match)
      if (!playerToUpdate) {
        playerToUpdate = candidates.find(p => p.name === name && p.cost === cost && p.team?.toString() !== team._id.toString());
        if (playerToUpdate) fieldToChange = 'team';
      }

      // 3. Change name (team and cost match)
      if (!playerToUpdate) {
        // If multiple players match team and cost, require newName input to specify which one to update
        const playersWithTeamAndCost = candidates.filter(p => p.team?.toString() === team._id.toString() && p.cost === cost);
        if (playersWithTeamAndCost.length > 1) {
          if (!newName) {
            return interaction.reply({ content: `❌ Multiple players found with team **${team.name}** and cost **${cost}**. Please specify the new name using the 'newname' option.`, flags: 64 });
          }
          playerToUpdate = playersWithTeamAndCost.find(p => p.name === name);
          if (playerToUpdate) fieldToChange = 'name';
        } else if (playersWithTeamAndCost.length === 1) {
          playerToUpdate = playersWithTeamAndCost[0];
          if (playerToUpdate.name !== name) {
            return interaction.reply({ content: `❌ The specified name does not match the player found for team **${team.name}** and cost **${cost}**.`, flags: 64 });
          }
          if (!newName) {
            return interaction.reply({ content: `❌ Please specify the new name using the 'newname' option.`, flags: 64 });
          }
          fieldToChange = 'name';
        }
      }

      if (!playerToUpdate) {
        return interaction.reply({ content: `❌ No player found where exactly one of name, team, or cost differs.`, flags: 64 });
      }

      // Perform the substitution
      if (fieldToChange === 'cost') {
        playerToUpdate.cost = cost;
      } else if (fieldToChange === 'team') {
        playerToUpdate.team = team._id;
      } else if (fieldToChange === 'name') {
        playerToUpdate.name = newName || name;
      }
      await playerToUpdate.save();

      return interaction.reply({
        content: `✅ Updated player: changed ${fieldToChange} for **${playerToUpdate.name}** (now team: **${team.name}**, cost: ${playerToUpdate.cost}).`,
        flags: 64
      });
    } else {
      // Add new player logic
      // Find the highest externalId in this season and increment
      const maxPlayer = await T2TrialsPlayer.find({ season: season._id })
        .sort({ externalId: -1 })
        .limit(1)
        .lean();
      let nextExternalId = 1;
      if (maxPlayer.length && typeof maxPlayer[0].externalId === 'number') {
        nextExternalId = maxPlayer[0].externalId + 1;
      }

      const existingPlayer = await T2TrialsPlayer.findOne({ name, team: team._id, season: season._id });
      if (existingPlayer) {
        return interaction.reply({ content: `❌ Player **${name}** already exists in team **${team.name}** for season **${season.name}**.`, flags: 64 });
      }

      const newPlayer = await T2TrialsPlayer.create({
        name,
        season: season._id,
        team: team._id,
        cost: cost,
        externalId: nextExternalId
      });

      // Add player to team if not already present
      if (!team.players.map(id => id.toString()).includes(newPlayer._id.toString())) {
        team.players.push(newPlayer._id);
        await team.save();
      }

      return interaction.reply({
        content: `✅ Player **${newPlayer.name}** (externalId: ${nextExternalId}) added to team **${team.name}** (cost: ${cost}).`,
        flags: 64
      });
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
        return interaction.respond(uniqueNames.map(name => ({ name, value: name })));
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