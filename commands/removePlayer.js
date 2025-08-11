import { SlashCommandBuilder } from 'discord.js';
import { canModifyTeam } from '../utils/transferGuard.js';
import isRegistered from '../utils/checkRegistration.js';
import FantasyPlayer from '../models/FantasyPlayer.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';

export default {
  data: new SlashCommandBuilder()
    .setName('removeplayer')
    .setDescription('Remove a T2 Trials league player from your fantasy team')
    .addStringOption(option =>
      option
        .setName('player')
        .setDescription('Name of the league player to remove')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('team')
        .setDescription('(Optional) The team of that player to disambiguate')
        .setRequired(false)
    ),

  async execute(interaction) {
    const discordId = interaction.user.id;
    const inputName = interaction.options.getString('player', true);
    const inputTeam = interaction.options.getString('team') || null;

    // 1) Gate: must be registered
    const registered = await isRegistered(discordId);
    if (!registered) {
      return interaction.reply({
        content: '⚠️ You must register using `/joinleague` before using this command.',
        ephemeral: true
      });
    }

    // 2) Load the fantasy player doc (we modify it)
    const fantasyPlayer = await FantasyPlayer.findOne({ discordId });
    if (!fantasyPlayer) {
      return interaction.reply({ content: '❗ Could not load your fantasy profile.', ephemeral: true });
    }
    if (!Array.isArray(fantasyPlayer.team)) fantasyPlayer.team = [];

    // 3) Find league player by name (and team if provided)
    const query = { name: { $regex: `^${inputName}$`, $options: 'i' } };
    if (inputTeam) {
      // If T2TrialsPlayer.team is ObjectId ref to Team, resolve by team name first:
      const teamDoc = await Team.findOne({ name: inputTeam });
      if (!teamDoc) return interaction.reply({ content: `❌ Team "${inputTeam}" not found.`, ephemeral: true });
      query.team = teamDoc._id;
    }

    const leaguePlayer = await T2TrialsPlayer.findOne(query).lean();
    if (!leaguePlayer) {
      return interaction.reply({
        content: `❌ No league player found for **${inputName}**${inputTeam ? ` in team **${inputTeam}**` : ''}.`,
        ephemeral: true
      });
    }

    // 4) Ensure the league player is in the fantasy player's roster
    const lpId = leaguePlayer._id.toString();
    const idx = fantasyPlayer.team.findIndex(id => id.toString() === lpId);
    if (idx === -1) {
      return interaction.reply({
        content: `❌ **${leaguePlayer.name}** is not in your fantasy team.`,
        ephemeral: true
      });
    }

    // 5) Check for transfer authorization
    const proposed = fantasyPlayer.team.filter(id => id.toString() !== lpId).map(String);

    const check = await canModifyTeam(discordId, proposed);
    if (!check.allowed) {
      if (check.reason === 'SWISS_LOCKED') {
        return interaction.reply({ content: '⛔ Team changes are locked during the swiss period.', ephemeral: true });
      }
      if (check.reason === 'PLAYOFFS_LOCKED') {
        return interaction.reply({ content: '⛔ Team changes are currently locked for playoffs.', ephemeral: true });
      }
      if (check.reason === 'PLAYOFFS_LIMIT') {
        return interaction.reply({
          content: `⛔ Playoff swap limit reached. You have used **${check.swapsUsed}/${check.limit}** allowed swaps.`,
          ephemeral: true
        });
      }
    }

    // 6) Remove and save
    const cost = Number(leaguePlayer.cost ?? 0);
    fantasyPlayer.team.splice(idx, 1);
    fantasyPlayer.wallet = (fantasyPlayer.wallet ?? 0) + (Number.isFinite(cost) ? cost : 0);
    await fantasyPlayer.save();

    return interaction.reply({
      content: `✅ Removed **${leaguePlayer.name}** from your fantasy team.`,
      ephemeral: true
    });
  }
};
