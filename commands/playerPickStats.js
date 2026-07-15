import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import getActiveSeason from '../utils/getActiveSeason.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';
import Team from '../models/Team.js';
import { escapeRegex } from '../utils/escapeRegex.js';

export default {
  data: new SlashCommandBuilder()
    .setName('playerpickstats')
    .setDescription('Check how often a specific player has been picked in fantasy teams')
    .addStringOption(opt =>
      opt.setName('name')
        .setDescription('Name of the player to check')
        .setAutocomplete(true)
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('team')
        .setDescription('Team name (optional, for disambiguation)')
        .setAutocomplete(true)
        .setRequired(false)
    )
    .addBooleanOption(opt =>
      opt.setName('ephemeral')
        .setDescription('Show only to you')
        .setRequired(false)
    ),

  async execute(interaction) {
    const season = await getActiveSeason();
    if (!season) {
      return interaction.reply({ content: '❌ No active season set.', flags: 64 });
    }
    const name = interaction.options.getString('name', true).trim();
    const teamName = interaction.options.getString('team')?.trim() || null;
    const ephemeral = interaction.options.getBoolean('ephemeral') ?? false;

    // Find the player
    const query = {
      name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' },
      season: season._id
    };
    let players = await T2TrialsPlayer.find(query).populate('team', 'name').lean();

    if (teamName) {
      players = players.filter(p => p.team && p.team.name.toLowerCase() === teamName.toLowerCase());
    }

    if (players.length === 0) {
      return interaction.reply({ content: `❌ Player **${name}**${teamName ? ` in team **${teamName}**` : ''} not found in season **${season.name}**.`, flags: 64 });
    }

    if (players.length > 1) {
      // Ambiguous, ask user to specify team
      const teams = players.map(p => p.team?.name || 'Unknown Team').join(', ');
      return interaction.reply({ content: `⚠️ Multiple players named **${name}** found in these teams: ${teams}. Please specify the team.`, flags: 64 });
    }

    const player = players[0];
    if (!player) {
      return interaction.reply({ content: `❌ Player **${name}** not found in season **${season.name}**.`, flags: 64 });
    }

    // Count how many fantasy teams the player is in
    const pickCount = Array.isArray(player.fantasyTeams) ? player.fantasyTeams.length : 0;

    const embed = new EmbedBuilder()
      .setTitle(`Pick Stats for ${player.name}`)
      .setDescription(`**Team:** ${player.team?.name || 'Unknown Team'}\n**Picked in:** ${pickCount} fantasy teams`)
      .setFooter({ text: `Season: ${season.name}` });

    return interaction.reply({ embeds: [embed], flags: ephemeral ? 64 : undefined });
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