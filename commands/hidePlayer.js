import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { isAuthorizedForCommand } from '../utils/commandAuth.js';
import getActiveSeason from '../utils/getActiveSeason.js';
import { escapeRegex } from '../utils/escapeRegex.js';
import Team from '../models/Team.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';

export default {
  data: new SlashCommandBuilder()
    .setName('hideplayer')
    .setDescription('Admin: hide or unhide a player from fantasy picking/team compositions')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(opt =>
      opt.setName('name')
        .setDescription('Player name')
        .setAutocomplete(true)
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('team')
        .setDescription('Team name')
        .setAutocomplete(true)
        .setRequired(true)
    )
    .addBooleanOption(opt =>
      opt.setName('hidden')
        .setDescription('true = hide from pick/composition, false = unhide')
        .setRequired(true)
    )
    .addIntegerOption(opt =>
      opt.setName('externalid')
        .setDescription('Optional extra safety check for the player externalId')
        .setRequired(false)
    ),

  async execute(interaction) {
    const allowed = await isAuthorizedForCommand(interaction, {
      allowedRoleEnvVar: 'AUTHORIZATION_ROLE_IDS',
      allowGuildAdmins: true
    });
    if (!allowed) {
      return interaction.reply({ content: '❌ You do not have permission to run this command.', flags: 64 });
    }

    const season = await getActiveSeason();
    if (!season) {
      return interaction.reply({ content: '❌ No active season set.', flags: 64 });
    }

    const name = interaction.options.getString('name', true).trim();
    const teamName = interaction.options.getString('team', true).trim();
    const hidden = interaction.options.getBoolean('hidden', true);
    const externalId = interaction.options.getInteger('externalid');

    const team = await Team.findOne({
      season: season._id,
      name: { $regex: `^${escapeRegex(teamName)}$`, $options: 'i' }
    }).lean();

    if (!team) {
      return interaction.reply({ content: `❌ Team **${teamName}** not found in season **${season.name}**.`, flags: 64 });
    }

    const query = {
      season: season._id,
      team: team._id,
      name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' }
    };

    if (Number.isFinite(externalId)) {
      query.externalId = Number(externalId);
    }

    const player = await T2TrialsPlayer.findOne(query);
    if (!player) {
      return interaction.reply({
        content: `❌ Player **${name}**${Number.isFinite(externalId) ? ` (externalId ${externalId})` : ''} not found in team **${team.name}** for season **${season.name}**.`,
        flags: 64
      });
    }

    if (Boolean(player.hiddenFromFantasy) === hidden) {
      return interaction.reply({
        content: `ℹ️ **${player.name}** is already ${hidden ? 'hidden' : 'visible'} for fantasy picking/compositions.`,
        flags: 64
      });
    }

    player.hiddenFromFantasy = hidden;
    await player.save();

    if (hidden) {
      await Team.updateOne(
        { _id: team._id },
        { $pull: { players: player._id } }
      );
    } else {
      await Team.updateOne(
        { _id: team._id },
        { $addToSet: { players: player._id } }
      );
    }

    return interaction.reply({
      content:
        `✅ **${player.name}** (${team.name}) is now **${hidden ? 'hidden' : 'visible'}** for fantasy picking/compositions.\n` +
        `• externalId: **${Number.isFinite(player.externalId) ? player.externalId : 'N/A'}**\n` +
        `• hiddenFromFantasy: **${hidden}**`,
      flags: 64
    });
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
