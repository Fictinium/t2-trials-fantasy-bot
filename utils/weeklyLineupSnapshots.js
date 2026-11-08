import FantasyPlayer from '../models/FantasyPlayer.js';

export async function ensureWeeklyLineupSnapshots(seasonId, week) {
  if (!seasonId) throw new Error('seasonId required');
  if (!Number.isInteger(Number(week)) || Number(week) < 1) {
    throw new Error('week must be an integer >= 1');
  }

  const weekNumber = Number(week);
  const players = await FantasyPlayer.find({ season: seasonId })
    .select('team weeklyLineups')
    .lean();
  let created = 0;

  for (const player of players) {
    const hasSnapshot = (player.weeklyLineups || [])
      .some(snapshot => Number(snapshot?.week) === weekNumber);
    if (hasSnapshot) continue;

    const team = Array.isArray(player.team)
      ? player.team.map(member => member?._id ?? member)
      : [];
    const result = await FantasyPlayer.updateOne(
      {
        _id: player._id,
        season: seasonId,
        weeklyLineups: { $not: { $elemMatch: { week: weekNumber } } }
      },
      {
        $push: { weeklyLineups: { week: weekNumber, team, lockedAt: new Date() } }
      }
    );
    created += result.modifiedCount || 0;
  }

  const coverage = await getWeeklyLineupSnapshotCoverage(seasonId, weekNumber);
  return { ...coverage, created };
}

export async function getWeeklyLineupSnapshotCoverage(seasonId, week) {
  if (!seasonId) throw new Error('seasonId required');
  if (!Number.isInteger(Number(week)) || Number(week) < 1) {
    throw new Error('week must be an integer >= 1');
  }

  const weekNumber = Number(week);
  const players = await FantasyPlayer.find({ season: seasonId })
    .select('weeklyLineups')
    .lean();
  const snapshotCount = players.filter(player =>
    (player.weeklyLineups || []).some(snapshot =>
      Number(snapshot?.week) === weekNumber && Array.isArray(snapshot?.team)
    )
  ).length;

  return {
    total: players.length,
    snapshots: snapshotCount,
    missing: players.length - snapshotCount
  };
}
