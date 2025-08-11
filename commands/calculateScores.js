import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import FantasyPlayer from '../models/FantasyPlayer.js';

const WIN_POINTS = 10;
const BONUS_ROUND_3_WINS = 15; // +15 if a round is exactly 3-0
const BONUS_WEEK_ALL_ROUNDS_POSITIVE = 5;
const BONUS_STREAK_3W_ALL_ROUNDS_POSITIVE = 40;
const BONUS_STREAK_3W_PERFECT_SWEEP = 100;

export default {
  data: new SlashCommandBuilder()
    .setName('calculatescores')
    .setDescription('Admin: calculate fantasy scores for a week')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption(opt =>
      opt.setName('week').setDescription('Week number to calculate').setMinValue(1).setRequired(true)
    ),

  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.memberPermissions?.has('ManageGuild')) {
      return interaction.reply({ content: '❌ Admins only.', ephemeral: true });
    }

    const week = interaction.options.getInteger('week', true);

    // Load EVERY fantasy player with their roster
    const fantasyPlayers = await FantasyPlayer.find().populate({ path: 'team', select: 'name performance' }).exec();
    if (!fantasyPlayers.length) {
      return interaction.reply({ content: 'ℹ️ No fantasy players found.', ephemeral: true });
    }

    let updated = 0;

    for (const fantasyPlayer of fantasyPlayers) {
      const roster = Array.isArray(fantasyPlayer.team) ? fantasyPlayer.team : [];
      let weekPoints = 0;

      for (const p of roster) {
        weekPoints += computePlayerWeekPoints(fantasyPlayer, week);
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

function computePlayerWeekPoints(playerDoc, week) {
  const perfW = getWeekPerf(playerDoc, week);
  if (!perfW) return 0;

  let pts = 0;
  const rounds = Array.isArray(perfW.rounds) ? perfW.rounds : [];

  // Base win points
  pts += (perfW.wins || 0) * WIN_POINTS;

  // +15 if round is exactly 3-0
  for (const r of rounds) {
    if ((r?.wins || 0) === 3) {
      pts += BONUS_ROUND_3_WINS;
    }
  }

  // +5 if positive winrate in all rounds this week
  const allPositive = rounds.every(r => (r?.wins || 0) > (r?.losses || 0));
  if (allPositive) pts += BONUS_WEEK_ALL_ROUNDS_POSITIVE;

  // Streak bonuses
  const w1 = getWeekPerf(playerDoc, week);
  const w2 = getWeekPerf(playerDoc, week - 1);
  const w3 = getWeekPerf(playerDoc, week - 2);

  if (w1 && w2 && w3) {
    const allPositive3Weeks = [w1, w2, w3].every(w =>
      w.rounds.every(r => (r?.wins || 0) > (r?.losses || 0))
    );
    if (allPositive3Weeks) {
      pts += BONUS_STREAK_3W_ALL_ROUNDS_POSITIVE;
    }

    const allPerfect3Weeks = [w1, w2, w3].every(w =>
      w.rounds.every(r => (r?.wins || 0) === (r?.duels || 0))
    );
    if (allPerfect3Weeks) {
      pts += BONUS_STREAK_3W_PERFECT_SWEEP;
    }
  }

  return pts;
}

function getWeekPerf(playerDoc, week) {
  if (!week || week < 1) return null;
  const arr = Array.isArray(playerDoc?.performance) ? playerDoc.performance : [];
  return arr.find(e => e.week === week) || null;
}