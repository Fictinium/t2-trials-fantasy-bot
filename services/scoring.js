import FantasyPlayer from '../models/FantasyPlayer.js';

const WIN_POINTS = 10;
const BONUS_ROUND_3_WINS = 15;
const BONUS_WEEK_ALL_ROUNDS_POSITIVE = 5;
const BONUS_STREAK_3W_ALL_ROUNDS_POSITIVE = 40;
const BONUS_STREAK_3W_PERFECT_SWEEP = 100;

export async function calculateScoresForWeek(week) {
  const fps = await FantasyPlayer.find()
    .populate({ path: 'team', select: 'performance' })
    .exec();

  let updated = 0;
  for (const fp of fps) {
    const roster = Array.isArray(fp.team) ? fp.team : [];
    let weekPoints = 0;

    for (const p of roster) weekPoints += computePlayerWeekPoints(p, week);

    if (!Array.isArray(fp.weeklyPoints)) fp.weeklyPoints = [];
    const idx = week - 1;
    while (fp.weeklyPoints.length < idx) fp.weeklyPoints.push(0);
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

  // base
  pts += (perfW.wins || 0) * WIN_POINTS;

  // +15 for a 3–0 round
  for (const r of rounds) {
    if ((r?.wins || 0) === 3) pts += BONUS_ROUND_3_WINS; // 3–0 round
  }

  // +5 if every round that week is positive
  const allPositive = rounds.every(r => (r?.wins || 0) > (r?.losses || 0));
  if (allPositive) pts += BONUS_WEEK_ALL_ROUNDS_POSITIVE;

  // Streaks across this week and previous two
  const w1 = getWeekPerf(playerDoc, week);
  const w2 = getWeekPerf(playerDoc, week - 1);
  const w3 = getWeekPerf(playerDoc, week - 2);

  if (w1 && w2 && w3) {
    const allPositive3 = [w1,w2,w3].every(w => w.rounds.every(r => (r?.wins || 0) > (r?.losses || 0)));
    if (allPositive3) pts += BONUS_STREAK_3W_ALL_ROUNDS_POSITIVE;

    const allPerfect3 = [w1,w2,w3].every(w => w.rounds.every(r => (r?.wins || 0) === (r?.duels || 0)));
    if (allPerfect3) pts += BONUS_STREAK_3W_PERFECT_SWEEP;
  }

  return pts;
}

function getWeekPerf(playerDoc, week) {
  if (!week || week < 1) return null;
  const arr = Array.isArray(playerDoc?.performance) ? playerDoc.performance : [];
  return arr.find(e => e.week === week) || null;
}