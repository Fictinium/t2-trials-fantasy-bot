import FantasyPlayer from '../models/FantasyPlayer.js';

const WIN_POINTS = 10;
const BONUS_SET_PERFECT_SWEEP = 15; // +15 per set that is a perfect sweep (player wins all rounds in the set, all rounds have 3 games, all won)
const BONUS_WEEK_ALL_SETS_POSITIVE = 5; // +5 if positive winrate in all sets this week
const BONUS_STREAK_3W_ALL_SETS_POSITIVE = 40; // +40 for 3-week streak of all sets positive
const BONUS_STREAK_3W_PERFECT_SWEEP = 100; // +100 for 3-week streak of perfect sweeps

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
    // Defensive: only process rounds if array and not empty
    const rounds = Array.isArray(mPerf.rounds) && mPerf.rounds.length > 0 ? mPerf.rounds : [];
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

  return computePointsFromPerf(aggW1, { rounds: aggr.rounds }, week, aggW2, aggW3);
}

export function getWeekPerf(playerDoc, week) {
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


// New: Compute points from sets/rounds/games hierarchy
export function computePointsFromPerf(perfW, docForRounds, week, prevAgg = null, prevAgg2 = null) {
  if (!perfW) return 0;
  let pts = 0;
  const sets = Array.isArray(perfW.sets) ? perfW.sets : [];

  // If sets/rounds/games are present, use them for base win points and bonuses
  if (sets.length > 0) {
    // base win points: sum all games won by the player in all sets/rounds/games
    let totalWins = 0, totalLosses = 0;
    for (const set of sets) {
      for (const round of (set.rounds || [])) {
        for (const game of (round.games || [])) {
          if (game.winner === 'A' && String(game.playerA) === String(perfW.playerId)) totalWins++;
          else if (game.winner === 'B' && String(game.playerB) === String(perfW.playerId)) totalWins++;
          else if (game.winner === 'A' && String(game.playerB) === String(perfW.playerId)) totalLosses++;
          else if (game.winner === 'B' && String(game.playerA) === String(perfW.playerId)) totalLosses++;
        }
      }
    }
    pts += totalWins * WIN_POINTS;

    // +15 per set that was a perfect sweep (player won all rounds in the set, and each round has 3 games, all won by the player)
    for (const set of sets) {
      let perfectSweep = true;
      for (const round of (set.rounds || [])) {
        if ((round.games || []).length !== 3) { perfectSweep = false; break; }
        for (const game of round.games) {
          if (!((game.winner === 'A' && String(game.playerA) === String(perfW.playerId)) || (game.winner === 'B' && String(game.playerB) === String(perfW.playerId)))) {
            perfectSweep = false; break;
          }
        }
        if (!perfectSweep) break;
      }
      if (perfectSweep && (set.rounds || []).length > 0) pts += BONUS_SET_PERFECT_SWEEP;
    }

    // +5 if positive winrate in all sets this week (must have at least 1 set)
    if (sets.every(set => {
      let wins = 0, losses = 0;
      for (const round of (set.rounds || [])) {
        for (const game of (round.games || [])) {
          if ((game.winner === 'A' && String(game.playerA) === String(perfW.playerId)) || (game.winner === 'B' && String(game.playerB) === String(perfW.playerId))) wins++;
          else if ((game.winner === 'A' && String(game.playerB) === String(perfW.playerId)) || (game.winner === 'B' && String(game.playerA) === String(perfW.playerId))) losses++;
        }
      }
      return wins > losses;
    })) {
      pts += BONUS_WEEK_ALL_SETS_POSITIVE;
    }
  } else {
    // If sets/rounds/games are missing, fall back to wins/losses for base points only
    pts += (perfW.wins || 0) * WIN_POINTS;
    // No bonuses possible
  }

  // streak bonuses (check aggregated/per-team results if provided)
  // (for now, keep as before, but you may want to update this to use sets)
  // ...

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
  // If new structure, use computePointsFromPerf
  if (Array.isArray(perfW.sets) && perfW.sets.length > 0) {
    // Try to infer playerId for correct win attribution
    let playerId = perfW.playerId;
    if (!playerId && perfW._id) playerId = perfW._id;
    const perfWithId = { ...perfW, playerId };
    return computePointsFromPerf(perfWithId, perfWithId, perfWithId.week);
  }
  // Old structure fallback
  let pts = 0;
  const rounds = Array.isArray(perfW.rounds) ? perfW.rounds : [];
  pts += (perfW.wins || 0) * WIN_POINTS;
  for (const r of rounds) {
    if ((r?.wins || 0) === 3) pts += BONUS_SET_PERFECT_SWEEP;
  }
  if (rounds.length > 0 && rounds.every(r => (r?.wins || 0) > (r?.losses || 0))) {
    pts += BONUS_WEEK_ALL_SETS_POSITIVE;
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
  for (const w of perf) total += computePointsForPerfSimple({ ...w, playerId: playerDoc._id });
  // per-player 3-week streak bonuses
  for (let i = 2; i < perf.length; i++) {
    const w1 = { ...perf[i], playerId: playerDoc._id };
    const w2 = { ...perf[i - 1], playerId: playerDoc._id };
    const w3 = { ...perf[i - 2], playerId: playerDoc._id };
    if (w1 && w2 && w3) {
      if (hasAllRoundsPositive(w1) && hasAllRoundsPositive(w2) && hasAllRoundsPositive(w3)) {
        total += BONUS_STREAK_3W_ALL_SETS_POSITIVE;
      }
      if (isPerfectSweep(w1) && isPerfectSweep(w2) && isPerfectSweep(w3)) {
        total += BONUS_STREAK_3W_PERFECT_SWEEP;
      }
    }
  }
  return total;
}