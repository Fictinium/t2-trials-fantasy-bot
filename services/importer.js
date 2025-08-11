import Team from '../models/Team.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * Import the website JSON array (players) and upsert:
 * - Team (from team_name)
 * - Player (create or update; attach/move to team)
 * - Cost (fantasy_points)
 * - Weekly performance with per-round breakdown
 * - externalId (first time we see it)
 */
export async function importStatsArray(playersArray) {
  if (!Array.isArray(playersArray)) {
    throw new Error('Expected array root');
  }
  
  let createdPlayers = 0;
  let updatedPlayers = 0;
  let teamsCreated = 0;
  let skipped = 0;
  let notFound = 0;

  for (const p of playersArray) {
    const playerIdNum = Number(p?.id);
    const playerName = String(p?.name ?? '').trim();
    const teamName    = p?.team_name ? String(p.team_name).trim() : null;
    const fantasyCost = Math.max(0, Number(p?.fantasy_points ?? 0));
    const weeks = Array.isArray(p?.weeks) ? p.weeks : [];

    if (!playerName || !weeks.length) { skipped++; continue; }
    if (!teamName) { notFound++; continue; }

    // Ensure Team exists
    let teamDoc = await Team.findOne({ name: teamName });
    if (!teamDoc) {
      teamDoc = await Team.create({ name: teamName, players: [] });
      teamsCreated++;
    }

    // Prefer match by externalId; fallback to (name + team)
    let dbPlayer = null;
    if (Number.isFinite(playerIdNum)) {
      dbPlayer = await T2TrialsPlayer.findOne({ externalId: playerIdNum });
    }
    if (!dbPlayer) {
      dbPlayer = await T2TrialsPlayer.findOne({
        name: { $regex: `^${escapeRegex(playerName)}$`, $options: 'i' },
        team: teamDoc._id
      });
    }

    // Build per-week entry with per-round details
    const perfByWeek = new Map();
    for (const w of weeks) {
      const weekNum = Number(w?.week_number);
      const games = Array.isArray(w?.games) ? w.games : [];
      if (!weekNum || !games.length) continue;

      const byRound = new Map(); // round -> {wins, losses, duels}
      for (const g of games) {
        const rn = Number(g?.round);
        if (![1,2,3].includes(rn)) continue;
        if (!byRound.has(rn)) byRound.set(rn, { wins: 0, losses: 0, duels: 0 });
        const rec = byRound.get(rn);
        rec.duels += 1;
        const win = Number(g?.winner_id) === playerIdNum;
        if (win) rec.wins++; else rec.losses++;
      }

      const rounds = [...byRound.entries()]
        .sort((a,b) => a[0]-b[0])
        .map(([roundNumber, r]) => ({ roundNumber, wins: r.wins, losses: r.losses, duels: r.duels }));

      const totalWins = rounds.reduce((a, r) => a + r.wins, 0);
      const totalLosses = rounds.reduce((a, r) => a + r.losses, 0);

      perfByWeek.set(weekNum, { week: weekNum, wins: totalWins, losses: totalLosses, rounds });
    }

    if (!dbPlayer) {
      // Create player first time we see them
      dbPlayer = await T2TrialsPlayer.create({
        externalId: Number.isFinite(playerIdNum) ? playerIdNum : undefined,
        name: playerName,
        team: teamDoc._id,
        cost: fantasyCost,
        performance: [...perfByWeek.values()].sort((a,b) => a.week - b.week)
      });
      await Team.updateOne({ _id: teamDoc._id }, { $addToSet: { players: dbPlayer._id } });
      createdPlayers++;
      continue;
    }

    // Update existing player
    let anyChange = false;

    // Move to correct team if needed
    if (String(dbPlayer.team) !== String(teamDoc._id)) {
      await Team.updateOne({ _id: dbPlayer.team }, { $pull: { players: dbPlayer._id } });
      await Team.updateOne({ _id: teamDoc._id }, { $addToSet: { players: dbPlayer._id } });
      dbPlayer.team = teamDoc._id;
      anyChange = true;
    }

    // Upsert weekly entries
    for (const entry of perfByWeek.values()) {
      const idx = dbPlayer.performance.findIndex(e => e.week === entry.week);
      if (idx >= 0) dbPlayer.performance[idx] = entry;
      else dbPlayer.performance.push(entry);
      anyChange = true;
    }

    // Update cost
    if (Number.isFinite(fantasyCost) && dbPlayer.cost !== fantasyCost) {
      dbPlayer.cost = fantasyCost;
      anyChange = true;
    }

    // Backfill externalId once
    if (Number.isFinite(playerIdNum) && !dbPlayer.externalId) {
      dbPlayer.externalId = playerIdNum;
      anyChange = true;
    }

    if (anyChange) {
      dbPlayer.performance.sort((a,b) => a.week - b.week);
      await dbPlayer.save();
      updated++;
    } else {
      skipped++;
    }
  }

  return {
    createdPlayers,
    updatedPlayers,
    teamsCreated,
    skipped,
    notFound
  };
}

export async function importStatsFromUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed ${res.status}`);
  const text = await res.text();
  const data = JSON.parse(text);
  return importStatsArray(data);
}