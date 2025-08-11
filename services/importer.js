import Team from '../models/Team.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export async function importStatsArray(playersArray) {
  if (!Array.isArray(playersArray)) throw new Error('Expected array root');

  let createdPlayers = 0;
  let updatedPlayers = 0;
  let teamsCreated = 0;
  let skipped = 0;
  let notFound = 0;

  for (const p of playersArray) {
    const playerIdNum = Number(p?.id);
    const playerName = String(p?.name ?? '').trim();
    const teamNameRaw = p?.team_name ? String(p.team_name).trim() : null;
    const fantasyCost = Math.max(0, Number(p?.fantasy_points ?? 0));
    const weeks = Array.isArray(p?.weeks) ? p.weeks : [];

    if (!playerName) { skipped++; continue; }
    if (!teamNameRaw) { notFound++; continue; }

    // Case-insensitive exact team match (create if missing)
    let teamDoc = await Team.findOne({ name: { $regex: `^${escapeRegex(teamNameRaw)}$`, $options: 'i' } });
    if (!teamDoc) {
      teamDoc = await Team.create({ name: teamNameRaw, players: [] });
      teamsCreated++;
    }

    // Find player (prefer externalId, else name+team)
    let dbPlayer = null;
    if (Number.isFinite(playerIdNum)) dbPlayer = await T2TrialsPlayer.findOne({ externalId: playerIdNum });
    if (!dbPlayer) {
      dbPlayer = await T2TrialsPlayer.findOne({
        name: { $regex: `^${escapeRegex(playerName)}$`, $options: 'i' },
        team: teamDoc._id
      });
    }

    // Build per-week performance (ignore games with winner_id == null)
    const perfByWeek = new Map();
    for (const w of weeks) {
      const weekNum = Number(w?.week_number);
      const games = Array.isArray(w?.games) ? w.games : [];
      if (!weekNum) continue;

      const byRound = new Map();
      for (const g of games) {
        const rn = Number(g?.round);
        if (![1,2,3].includes(rn)) continue;
        if (g?.winner_id == null) continue;           // <-- ignore unfinished
        if (!byRound.has(rn)) byRound.set(rn, { wins: 0, losses: 0, duels: 0 });
        const rec = byRound.get(rn);
        rec.duels += 1;
        if (Number(g.winner_id) === playerIdNum) rec.wins++; else rec.losses++;
      }

      const rounds = [...byRound.entries()]
        .sort((a,b) => a[0]-b[0])
        .map(([roundNumber, r]) => ({ roundNumber, wins: r.wins, losses: r.losses, duels: r.duels }));

      const totalWins = rounds.reduce((a, r) => a + r.wins, 0);
      const totalLosses = rounds.reduce((a, r) => a + r.losses, 0);

      perfByWeek.set(weekNum, { week: weekNum, wins: totalWins, losses: totalLosses, rounds });
    }

    if (!dbPlayer) {
      // Create even if performance is empty — we still want the player seeded
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

    // Update existing
    let anyChange = false;

    if (String(dbPlayer.team) !== String(teamDoc._id)) {
      await Team.updateOne({ _id: dbPlayer.team }, { $pull: { players: dbPlayer._id } });
      await Team.updateOne({ _id: teamDoc._id }, { $addToSet: { players: dbPlayer._id } });
      dbPlayer.team = teamDoc._id;
      anyChange = true;
    }

    for (const entry of perfByWeek.values()) {
      const idx = dbPlayer.performance.findIndex(e => e.week === entry.week);
      if (idx >= 0) dbPlayer.performance[idx] = entry;
      else dbPlayer.performance.push(entry);
      anyChange = true;
    }

    if (Number.isFinite(fantasyCost) && dbPlayer.cost !== fantasyCost) {
      dbPlayer.cost = fantasyCost;
      anyChange = true;
    }

    if (Number.isFinite(playerIdNum) && !dbPlayer.externalId) {
      dbPlayer.externalId = playerIdNum;
      anyChange = true;
    }

    if (anyChange) {
      dbPlayer.performance.sort((a,b) => a.week - b.week);
      await dbPlayer.save();
      updatedPlayers++;          // <-- fixed counter
    } else {
      skipped++;
    }
  }

  return { createdPlayers, updatedPlayers, teamsCreated, skipped, notFound };
}

export async function importStatsFromUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed ${res.status}`);
  const data = await res.json();
  return importStatsArray(data);
}