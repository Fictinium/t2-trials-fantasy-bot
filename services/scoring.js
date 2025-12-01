import { getActiveSeason } from '../utils/getActiveSeason.js';
import FantasyPlayer from '../models/FantasyPlayer.js';

const WIN_POINTS = 10;
const BONUS_ROUND_3_WINS = 15;
const BONUS_WEEK_ALL_ROUNDS_POSITIVE = 5;
const BONUS_STREAK_3W_ALL_ROUNDS_POSITIVE = 40;
const BONUS_STREAK_3W_PERFECT_SWEEP = 100;

export async function calculateScoresForWeek(week) {
  const season = await getActiveSeason();
  if (!season) throw new Error('No active season');

  const fps = await FantasyPlayer.find({season: season._id})
    .populate({ path: 'team', match: { season: season._id }, select: 'performance' })
    .exec();

  let updated = 0;
  for (const fp of fps) {
    const roster = Array.isArray(fp.team) ? fp.team : [];
    let weekPoints = 0;

    for (const p of roster) weekPoints += computePlayerWeekPoints(p, week);

    if (!Array.isArray(fp.weeklyPoints)) fp.weeklyPoints = [];
    const idx = week - 1;
    while (fp.weeklyPoints.length <= idx) fp.weeklyPoints.push(0); // <= so index exists
    fp.weeklyPoints[idx] = weekPoints;

    fp.totalPoints = fp.weeklyPoints.reduce((s, v) => s + (v || 0), 0);

    await fp.save();
    updated++;
  }
  return updated;
}

function computePlayerWeekPoints(playerDoc, week) {
  const perfW = getWeekPerf(playerDoc, week);
  if (!perfW) return 0;

  let pts = 0;
  const rounds = Array.isArray(perfW.rounds) ? perfW.rounds : [];

  pts += (perfW.wins || 0) * WIN_POINTS;

  for (const r of rounds) {
    if ((r?.wins || 0) === 3) pts += BONUS_ROUND_3_WINS;
  }

  // only if there was at least one round
  if (rounds.length > 0 && rounds.every(r => (r?.wins || 0) > (r?.losses || 0))) {
    pts += BONUS_WEEK_ALL_ROUNDS_POSITIVE;
  }

  const w1 = perfW;
  const w2 = getWeekPerf(playerDoc, week - 1);
  const w3 = getWeekPerf(playerDoc, week - 2);

  if (w2 && w3) {
    const allPositive3 = hasAllRoundsPositive(w1) && hasAllRoundsPositive(w2) && hasAllRoundsPositive(w3);
    if (allPositive3) pts += BONUS_STREAK_3W_ALL_ROUNDS_POSITIVE;

    const allPerfect3 = isPerfectSweep(w1) && isPerfectSweep(w2) && isPerfectSweep(w3);
    if (allPerfect3) pts += BONUS_STREAK_3W_PERFECT_SWEEP;
  }

  return pts;
}

function getWeekPerf(playerDoc, week) {
  if (!week || week < 1) return null;
  const arr = Array.isArray(playerDoc?.performance) ? playerDoc.performance : [];
  return arr.find(e => e.week === week) || null;
}

function hasAllRoundsPositive(w) {
  const rounds = Array.isArray(w?.rounds) ? w.rounds : [];
  return rounds.length > 0 && rounds.every(r => (r?.wins || 0) > (r?.losses || 0));
}
function isPerfectSweep(w) {
  const rounds = Array.isArray(w?.rounds) ? w.rounds : [];
  return rounds.length > 0 && rounds.every(r => (r?.duels || 0) > 0 && (r?.wins || 0) === (r?.duels || 0));
}