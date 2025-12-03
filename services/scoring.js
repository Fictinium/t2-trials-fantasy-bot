import FantasyPlayer from '../models/FantasyPlayer.js';

const WIN_POINTS = 10;
const BONUS_ROUND_3_WINS = 15;
const BONUS_WEEK_ALL_ROUNDS_POSITIVE = 5;
const BONUS_STREAK_3W_ALL_ROUNDS_POSITIVE = 40;
const BONUS_STREAK_3W_PERFECT_SWEEP = 100;

export async function calculateScoresForWeek(seasonId, week) {
  if (!seasonId) throw new Error('seasonId required');
  if (!week || typeof week !== 'number') throw new Error('week (number) required');

  // fetch fantasy players for the season with populated team/performance for season
  const fps = await FantasyPlayer.find({ season: seasonId })
    .populate({ path: 'team', match: { season: seasonId }, select: 'performance' })
    .exec();

  let modified = 0;

  for (const fp of fps) {
    // compute week points using your existing helper
    const weekPoints = computePlayerWeekPoints(fp, week);

    const idx = week - 1;
    while (fp.weeklyPoints.length <= idx) fp.weeklyPoints.push(0); // ensure index exists

    // overwrite idempotently; only save when value changed
    const prev = Number(fp.weeklyPoints[idx] || 0);
    if (prev !== weekPoints) {
      fp.weeklyPoints[idx] = weekPoints;
      fp.totalPoints = fp.weeklyPoints.reduce((s, v) => s + (v || 0), 0);
      await fp.save();
      modified++;
    }
  }

  return modified;
}

function computePlayerWeekPoints(playerDoc, week) {
  // 1) If the doc directly has performance (a T2TrialsPlayer), use it
  const perfW = getWeekPerf(playerDoc, week);
  if (perfW) {
    return computePointsFromPerf(perfW, playerDoc, week);
  }

  // 2) If this is a FantasyPlayer, try to aggregate its populated team members' performance
  const team = Array.isArray(playerDoc.team) ? playerDoc.team.filter(Boolean) : [];
  if (team.length === 0) return 0;

  // Build aggregated week performance across team members
  const aggr = { wins: 0, losses: 0, rounds: [] };
  for (const member of team) {
    const mPerf = getWeekPerf(member, week);
    if (!mPerf) continue;
    aggr.wins += (mPerf.wins || 0);
    aggr.losses += (mPerf.losses || 0);
    const rounds = Array.isArray(mPerf.rounds) ? mPerf.rounds : [];
    for (const r of rounds) {
      const rn = (r.roundNumber || 1) - 1;
      aggr.rounds[rn] = aggr.rounds[rn] || { roundNumber: (rn + 1), wins: 0, losses: 0, duels: 0 };
      aggr.rounds[rn].wins += (r.wins || 0);
      aggr.rounds[rn].losses += (r.losses || 0);
      aggr.rounds[rn].duels += (r.duels || 0);
    }
  }

  // convert any sparse rounds to proper array
  aggr.rounds = aggr.rounds.filter(Boolean);

  // For streak checks, create aggregated perf objects for previous weeks too
  const aggW1 = aggr;
  const aggW2 = aggregateTeamWeekPerf(playerDoc.team, week - 1);
  const aggW3 = aggregateTeamWeekPerf(playerDoc.team, week - 2);

  return computePointsFromPerf(aggW1, { rounds: aggW1.rounds }, week, aggW2, aggW3);
}

function getWeekPerf(playerDoc, week) {
  if (!week || week < 1) return null;
  const arr = Array.isArray(playerDoc?.performance) ? playerDoc.performance : [];
  return arr.find(e => e.week === week) || null;
}

function aggregateTeamWeekPerf(team, week) {
  if (!Array.isArray(team) || week < 1) return null;
  const aggr = { wins: 0, losses: 0, rounds: [] };
  for (const member of team) {
    const mPerf = getWeekPerf(member, week);
    if (!mPerf) continue;
    aggr.wins += (mPerf.wins || 0);
    aggr.losses += (mPerf.losses || 0);
    const rounds = Array.isArray(mPerf.rounds) ? mPerf.rounds : [];
    for (const r of rounds) {
      const rn = (r.roundNumber || 1) - 1;
      aggr.rounds[rn] = aggr.rounds[rn] || { roundNumber: (rn + 1), wins: 0, losses: 0, duels: 0 };
      aggr.rounds[rn].wins += (r.wins || 0);
      aggr.rounds[rn].losses += (r.losses || 0);
      aggr.rounds[rn].duels += (r.duels || 0);
    }
  }
  aggr.rounds = aggr.rounds.filter(Boolean);
  // If nothing found return null so callers treat it as no data
  return (aggr.wins || aggr.losses || aggr.rounds.length) ? aggr : null;
}

function computePointsFromPerf(perfW, docForRounds, week, prevAgg = null, prevAgg2 = null) {
  if (!perfW) return 0;
  let pts = 0;
  const rounds = Array.isArray(perfW.rounds) ? perfW.rounds : [];

  // base wins
  pts += (perfW.wins || 0) * WIN_POINTS;

  // +15 per round that was exactly 3-0
  for (const r of rounds) {
    if ((r?.wins || 0) === 3) pts += BONUS_ROUND_3_WINS;
  }

  // +5 if positive winrate in all rounds this week (must have at least 1 round)
  if (rounds.length > 0 && rounds.every(r => (r?.wins || 0) > (r?.losses || 0))) {
    pts += BONUS_WEEK_ALL_ROUNDS_POSITIVE;
  }

  // streak bonuses (check aggregated/per-team results if provided)
  const w1 = perfW;
  const w2 = prevAgg;
  const w3 = prevAgg2;
  if (w2 && w3) {
    if (hasAllRoundsPositive(w1) && hasAllRoundsPositive(w2) && hasAllRoundsPositive(w3)) {
      pts += BONUS_STREAK_3W_ALL_ROUNDS_POSITIVE;
    }
    if (isPerfectSweep(w1) && isPerfectSweep(w2) && isPerfectSweep(w3)) {
      pts += BONUS_STREAK_3W_PERFECT_SWEEP;
    }
  }
  return pts;
}

function hasAllRoundsPositive(w) {
  const rounds = Array.isArray(w?.rounds) ? w.rounds : [];
  return rounds.length > 0 && rounds.every(r => (r?.wins || 0) > (r?.losses || 0));
}

function isPerfectSweep(w) {
  const rounds = Array.isArray(w?.rounds) ? w.rounds : [];
  return rounds.length > 0 && rounds.every(r => (r?.duels || 0) > 0 && (r?.wins || 0) === (r?.duels || 0));
}




export function computePointsForPerfSimple(perfW) {
  if (!perfW) return 0;
  let pts = 0;
  const rounds = Array.isArray(perfW.rounds) ? perfW.rounds : [];
  pts += (perfW.wins || 0) * WIN_POINTS;
  for (const r of rounds) {
    if ((r?.wins || 0) === 3) pts += BONUS_ROUND_3_WINS;
  }
  if (rounds.length > 0 && rounds.every(r => (r?.wins || 0) > (r?.losses || 0))) {
    pts += BONUS_WEEK_ALL_ROUNDS_POSITIVE;
  }
  return pts;
}

/**
 * Compute total points for a single T2TrialsPlayer-like doc (sums per-week + per-player 3-week streak bonuses).
 * This is intended for showing how many points an individual real player has contributed so far.
 */
export function totalPointsForPlayer(playerDoc) {
  const perf = Array.isArray(playerDoc?.performance) ? playerDoc.performance.slice().sort((a,b)=>a.week - b.week) : [];
  if (!perf.length) return 0;
  let total = 0;
  // per-week base + bonuses (no cross-fantasy aggregation)
  for (const w of perf) total += computePointsForPerfSimple(w);
  // per-player 3-week streak bonuses
  for (let i = 2; i < perf.length; i++) {
    const w1 = perf[i];
    const w2 = perf[i - 1];
    const w3 = perf[i - 2];
    if (w1 && w2 && w3) {
      if (hasAllRoundsPositive(w1) && hasAllRoundsPositive(w2) && hasAllRoundsPositive(w3)) {
        total += BONUS_STREAK_3W_ALL_ROUNDS_POSITIVE;
      }
      if (isPerfectSweep(w1) && isPerfectSweep(w2) && isPerfectSweep(w3)) {
        total += BONUS_STREAK_3W_PERFECT_SWEEP;
      }
    }
  }
  return total;
}