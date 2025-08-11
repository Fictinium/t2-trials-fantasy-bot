import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import FantasyPlayer from '../models/FantasyPlayer.js';

const WIN_POINTS = 1; // <-- change later when you define real scoring

export default {
  data: new SlashCommandBuilder()
    .setName('calculatescores')
    .setDescription('Admin: calculate fantasy scores for a week')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption(opt =>
      opt.setName('week').setDescription('Week number to calculate').setMinValue(1).setRequired(true)
    ),

  async execute(interaction) {
    if (!interaction.inGuild() ||
        !interaction.memberPermissions?.has('ManageGuild')) {
      return interaction.reply({ content: '❌ Admins only.', ephemeral: true });
    }

    const week = interaction.options.getInteger('week', true);

    // Load EVERY fantasy player with their roster
    const fantasyPlayers = await FantasyPlayer.find().populate('team').exec();
    if (!fantasyPlayers.length) {
      return interaction.reply({ content: 'ℹ️ No fantasy players found.', ephemeral: true });
    }

    let updated = 0;

    for (const fantasyPlayer of fantasyPlayers) {
      const roster = Array.isArray(fantasyPlayer.team) ? fantasyPlayer.team : [];
      let weekPoints = 0;

      for (const p of roster) {
        // Find performance entry for this week
        const performance = (p.performance || []).find(e => e.week === week);
        if (!performance) continue;

        // Simple scoring: wins * WIN_POINTS
        weekPoints += (performance.wins || 0) * WIN_POINTS;
      }

      // Ensure weeklyPoints array is long enough
      if (!Array.isArray(fantasyPlayer.weeklyPoints)) fantasyPlayer.weeklyPoints = [];
      const idx = week - 1;
      // pad array with zeros if necessary
      while (fantasyPlayer.weeklyPoints.length < idx) fantasyPlayer.weeklyPoints.push(0);
      fantasyPlayer.weeklyPoints[idx] = weekPoints;

      // Recompute total
      fantasyPlayer.totalPoints = fantasyPlayer.weeklyPoints.reduce((sum, v) => sum + (v || 0), 0);

      await fantasyPlayer.save();
      updated++;
    }

    return interaction.reply({
      content: `✅ Calculated scores for week ${week}. Updated ${updated} fantasy players.`,
      ephemeral: true
    });
  }
};
