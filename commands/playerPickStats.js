import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import getActiveSeason from '../utils/getActiveSeason.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';

export default {
  data: new SlashCommandBuilder()
    .setName('playerpickstats')
    .setDescription('Check how often a specific player has been picked in fantasy teams')
    .addStringOption(opt =>
      opt.setName('name')
        .setDescription('Name of the player to check')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('team')
        .setDescription('Team name (optional, for disambiguation)')
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
    const query = { name, season: season._id };
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
  }/*,
  
  async autocomplete(interaction) {
    try {
      const focusedValue = interaction.options.getFocused(); // Get the current input
      console.log('Focused value:', focusedValue); // Debugging

      const season = await getActiveSeason();
      if (!season) {
        console.error('No active season found.');
        return interaction.respond([]); // Return empty response if no season is active
      }

      // Fetch players whose names match the input
      const players = await T2TrialsPlayer.find({ season: season._id, name: { $regex: new RegExp(focusedValue, 'i') } })
        .limit(25) // Discord allows up to 25 suggestions
        .lean();

      console.log('Players found:', players); // Debugging

      // Format suggestions
      const suggestions = players.map(player => ({
        name: `${player.name} (${player.team?.name || 'Unknown Team'})`,
        value: player.name
      }));

      console.log('Suggestions:', suggestions); // Debugging

      return interaction.respond(suggestions);
    } catch (err) {
      console.error('Error in autocomplete:', err); // Log errors
      return interaction.respond([]); // Return empty response on error
    }
  }*/
};