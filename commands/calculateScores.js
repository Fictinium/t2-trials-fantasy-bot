import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import getActiveSeason from '../utils/getActiveSeason.js';
import FantasyPlayer from '../models/FantasyPlayer.js';

const WIN_POINTS = 10; // +10 per win
const BONUS_ROUND_3_WINS = 15; // +15 if round is exactly 3-0 (per round)
const BONUS_WEEK_ALL_ROUNDS_POSITIVE = 5; // +5 if positive winrate in all rounds this week (must have at least one round)
const BONUS_STREAK_3W_ALL_ROUNDS_POSITIVE = 40; // +40 if positive winrate in all rounds for 3 consecutive weeks
const BONUS_STREAK_3W_PERFECT_SWEEP = 100; // +100 if perfect 3-0 in all rounds for 3 consecutive weeks

export default {
  data: new SlashCommandBuilder()
    .setName('calculatescores')
    .setDescription('Admin: calculate fantasy scores for a week')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption(opt =>
      opt.setName('week').setDescription('Week number to calculate').setMinValue(1).setRequired(true)
    ),

  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: '❌ Admins only.', flags: 64 });
    }

    const season = await getActiveSeason();
    if (!season) {
      return interaction.reply({ content: '❌ No active season set.', flags: 64 });
    }
    const week = interaction.options.getInteger('week', true);

    // Load EVERY fantasy player with their roster (players include `performance`)
    const fantasyPlayers = await FantasyPlayer.find({ season: season._id })
      .populate({ path: 'team', match: { season: season._id }, select: 'name performance' })
      .lean(); // lean is fine here since we only write back via updateOne below (optional)

    if (!fantasyPlayers.length) {
      return interaction.reply({ content: 'ℹ️ No fantasy players found.', flags: 64 });
    }

    let updated = 0;

    // If you prefer fewer DB writes, you can collect updates and bulkWrite afterward.
    for (const fp of fantasyPlayers) {
      const roster = Array.isArray(fp.team) ? fp.team : [];
      let weekPoints = 0;

      // FIX: compute per roster player (T2TrialsPlayer doc), not the FantasyPlayer doc
      for (const player of roster) {
        weekPoints += computePlayerWeekPoints(player, week);
      }

      // Ensure weeklyPoints array is long enough
      const weekly = Array.isArray(fp.weeklyPoints) ? [...fp.weeklyPoints] : [];
      const idx = week - 1;
      while (weekly.length < idx) weekly.push(0);
      weekly[idx] = weekPoints;

      const total = weekly.reduce((sum, v) => sum + (v || 0), 0);

      await FantasyPlayer.updateOne(
        { _id: fp._id },
        { $set: { weeklyPoints: weekly, totalPoints: total } }
      );

      updated++;
    }

    return interaction.reply({
      content: `✅ Calculated scores for week ${week}. Updated ${updated} fantasy players.`,
      flags: 64
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

  // +15 if round is exactly 3-0 (per round)
  for (const r of rounds) {
    if ((r?.wins || 0) === 3) {
      pts += BONUS_ROUND_3_WINS;
    }
  }

  // +5 if positive winrate in all rounds this week (must have at least one round)
  if (rounds.length > 0 && rounds.every(r => (r?.wins || 0) > (r?.losses || 0))) {
    pts += BONUS_WEEK_ALL_ROUNDS_POSITIVE;
  }

  // Streak bonuses over 3 consecutive weeks
  const w1 = getWeekPerf(playerDoc, week);
  const w2 = getWeekPerf(playerDoc, week - 1);
  const w3 = getWeekPerf(playerDoc, week - 2);

  if (w1 && w2 && w3) {
    const allPositive3Weeks =
      hasAllRoundsPositive(w1) && hasAllRoundsPositive(w2) && hasAllRoundsPositive(w3);

    if (allPositive3Weeks) {
      pts += BONUS_STREAK_3W_ALL_ROUNDS_POSITIVE;
    }

    const allPerfect3Weeks =
      isPerfectSweep(w1) && isPerfectSweep(w2) && isPerfectSweep(w3);

    if (allPerfect3Weeks) {
      pts += BONUS_STREAK_3W_PERFECT_SWEEP;
    }
  }

  return pts;
}

// Helpers

function getWeekPerf(playerDoc, week) {
  if (!week || week < 1) return null;
  const arr = Array.isArray(playerDoc?.performance) ? playerDoc.performance : [];
  return arr.find(e => e.week === week) || null;
}

function hasAllRoundsPositive(weekPerf) {
  const rounds = Array.isArray(weekPerf?.rounds) ? weekPerf.rounds : [];
  return rounds.length > 0 && rounds.every(r => (r?.wins || 0) > (r?.losses || 0));
}

function isPerfectSweep(weekPerf) {
  const rounds = Array.isArray(weekPerf?.rounds) ? weekPerf.rounds : [];
  // require at least one duel per round to count
  return rounds.length > 0 && rounds.every(r => (r?.duels || 0) > 0 && (r?.wins || 0) === (r?.duels || 0));
}