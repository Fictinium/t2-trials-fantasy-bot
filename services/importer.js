import getActiveSeason from '../utils/getActiveSeason.js';
import Season from '../models/Season.js';
import Team from '../models/Team.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export function normalizeStatsPayload(raw) {
  if (Array.isArray(raw)) {
    return { playersArray: raw, seasonNumber: null };
  }

  if (raw && typeof raw === 'object') {
    const seasonNumberRaw = Number(raw.season);
    const seasonNumber = Number.isFinite(seasonNumberRaw) ? seasonNumberRaw : null;

    const playersArray = Array.isArray(raw.players)
      ? raw.players
      : Array.isArray(raw.data)
        ? raw.data
        : Array.isArray(raw.payload)
          ? raw.payload
          : Array.isArray(raw.stats)
            ? raw.stats
            : null;

    if (playersArray) {
      return { playersArray, seasonNumber };
    }
  }

  throw new Error('Invalid JSON root. Expected an array, or an object with a players/data/payload/stats array.');
}

export async function resolveSeasonFromPayloadNumber(seasonNumber, fallbackSeason = null) {
  if (Number.isFinite(seasonNumber)) {
    const n = Number(seasonNumber);

    const directNameCandidates = [String(n), `S${n}`, `s${n}`, `Season ${n}`, `season ${n}`];
    let season = await Season.findOne({ name: { $in: directNameCandidates } });

    if (!season) {
      season = await Season.findOne({ name: { $regex: `(^|\\D)${n}$`, $options: 'i' } });
    }

    if (season) {
      return { season, usedFallback: false, seasonNumber: n };
    }
  }

  const active = fallbackSeason || await getActiveSeason();
  return { season: active, usedFallback: true, seasonNumber: Number.isFinite(seasonNumber) ? Number(seasonNumber) : null };
}

export async function importStatsArray(playersArray, seasonId = null) {
  if (!Array.isArray(playersArray)) throw new Error('Expected array root');

  const season = seasonId ? await Season.findById(seasonId) : await getActiveSeason();
  if (!season) throw new Error('No active season');

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
    let teamDoc = await Team.findOne({ name: { $regex: `^${escapeRegex(teamNameRaw)}$`, $options: 'i' }, season: season._id });
    if (!teamDoc) {
      teamDoc = await Team.create({ name: teamNameRaw, season: season._id, players: [] });
      teamsCreated++;
    }

    // Find player (prefer externalId, else name+team)
    let dbPlayer = null;
    if (Number.isFinite(playerIdNum)) dbPlayer = await T2TrialsPlayer.findOne({ externalId: playerIdNum, season: season._id });
    if (!dbPlayer) {
      dbPlayer = await T2TrialsPlayer.findOne({
        name: { $regex: `^${escapeRegex(playerName)}$`, $options: 'i' },
        season: season._id,
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
        season: season._id,
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

export async function importStatsFromUrl(url, fallbackSeasonId = null) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed ${res.status}`);
  const data = await res.json();

  const { playersArray, seasonNumber } = normalizeStatsPayload(data);
  const fallbackSeason = fallbackSeasonId ? await Season.findById(fallbackSeasonId) : await getActiveSeason();
  const { season, usedFallback } = await resolveSeasonFromPayloadNumber(seasonNumber, fallbackSeason);
  if (!season) throw new Error('No season available to import into');

  const importRes = await importStatsArray(playersArray, season._id);
  return {
    ...importRes,
    seasonId: season._id,
    seasonName: season.name,
    sourceSeasonNumber: seasonNumber,
    usedFallbackSeason: usedFallback
  };
}