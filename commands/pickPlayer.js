import { SlashCommandBuilder } from 'discord.js';
import { canModifyTeam } from '../utils/transferGuard.js';
import isRegistered from '../utils/checkRegistration.js';
import FantasyPlayer from '../models/FantasyPlayer.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';

const MAX_TEAM_SIZE = 5; // change this if needed

export default {
  data: new SlashCommandBuilder()
    .setName('pickplayer')
    .setDescription('Pick a T2 Trials league player for your fantasy team')
    .addStringOption(option =>
      option
        .setName('player')
        .setDescription('The name of the league player you want to pick')
        .setRequired(true)
    ),

  async execute(interaction) {
    const discordId = interaction.user.id;
    const playerName = interaction.options.getString('player');

    // 1) Check if the user is registered
    const registered = await isRegistered(discordId);
    if (!registered) {
      return interaction.reply({
        content: '⚠️ You must register using `/joinleague` before picking players.',
        ephemeral: true
      });
    }

    // 2) Load fantasy player (we need team + wallet)
    const fantasyPlayer = await FantasyPlayer.findOne({ discordId });
    if (!fantasyPlayer) {
      return interaction.reply({ content: '❗ Could not load your fantasy profile.', ephemeral: true });
    }
    if (!Array.isArray(fantasyPlayer.team)) fantasyPlayer.team = [];
    if (typeof fantasyPlayer.wallet !== 'number') fantasyPlayer.wallet = 85; // safety

    // 3) Find league player (case-insensitive exact)
    const leaguePlayer = await T2TrialsPlayer.findOne({
      name: { $regex: `^${inputName}$`, $options: 'i' }
    });
    if (!leaguePlayer) {
      return interaction.reply({ content: `❌ No league player found named **${inputName}**.`, ephemeral: true });
    }

    // 4) Duplicate check
    const lpId = leaguePlayer._id.toString();
    if (fantasyPlayer.team.some(id => id.toString() === lpId)) {
      return interaction.reply({
        content: `❌ You already have **${leaguePlayer.name}** on your team.`,
        ephemeral: true
      });
    }

    // 5) Team size cap
    if (fantasyPlayer.team.length >= MAX_TEAM_SIZE) {
      return interaction.reply({
        content: `❌ You cannot have more than ${MAX_TEAM_SIZE} players.`,
        ephemeral: true
      });
    }

    // 6) Budget check
    const cost = Number(leaguePlayer.cost ?? 0);
    if (!Number.isFinite(cost) || cost < 0) {
      return interaction.reply({
        content: `❗ **${leaguePlayer.name}** has an invalid cost configured. Ask an admin to fix this.`,
        ephemeral: true
      });
    }
    if (fantasyPlayer.wallet < cost) {
      return interaction.reply({
        content: `❌ Not enough budget. **${leaguePlayer.name}** costs **${cost}**, you have **${fantasyPlayer.wallet}**.`,
        ephemeral: true
      });
    }

    // 7) Check for transfer authorization
    // Build proposed roster (simulate the add)
    const proposed = [...user.team.map(String), leaguePlayer._id.toString()];

    // Guard
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

    // 8) Apply changes
    fantasyPlayer.team.push(leaguePlayer._id);
    fantasyPlayer.wallet -= cost;
    await fantasyPlayer.save();

    return interaction.reply({
      content: `✅ You have successfully added **${leaguePlayer.name}** to your fantasy team!`,
      ephemeral: true
    });
  }
};
