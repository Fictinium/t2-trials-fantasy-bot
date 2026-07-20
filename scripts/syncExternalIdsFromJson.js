import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

import '../models/modelsIndex.js';
import getActiveSeason from '../utils/getActiveSeason.js';
import { escapeRegex } from '../utils/escapeRegex.js';
import Team from '../models/Team.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';

dotenv.config();

function readArg(flag, fallback = null) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function parsePlayersJson(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.players)) return raw.players;
    if (Array.isArray(raw.data)) return raw.data;
    if (Array.isArray(raw.payload)) return raw.payload;
    if (Array.isArray(raw.stats)) return raw.stats;
  }
  throw new Error('Invalid players JSON root.');
}

async function main() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGO_URI (or MONGODB_URI) is not set.');

  const jsonPath = path.resolve(process.cwd(), readArg('--json', '.\\players.json'));
  const apply = hasFlag('--apply');

  if (!fs.existsSync(jsonPath)) throw new Error(`JSON file not found: ${jsonPath}`);

  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const rows = parsePlayersJson(raw);

  await mongoose.connect(mongoUri);

  try {
    const season = await getActiveSeason();
    if (!season) throw new Error('No active season set.');

    const dbPlayers = await T2TrialsPlayer.find({ season: season._id })
      .populate('team', 'name')
      .select('_id name team externalId')
      .lean();

    const byExternalId = new Map(
      dbPlayers
        .filter(p => Number.isFinite(Number(p.externalId)))
        .map(p => [Number(p.externalId), p])
    );

    const teamCache = new Map();
    const intendedAssignments = [];
    const missing = [];
    const ambiguous = [];
    const skippedNullTeam = [];

    for (const row of rows) {
      const desiredId = Number(row?.id);
      const teamName = String(row?.team_name ?? '').trim();
      const playerName = String(row?.name ?? '').trim();

      if (!Number.isFinite(desiredId) || !playerName) continue;
      if (!teamName) {
        skippedNullTeam.push({ id: desiredId, name: playerName });
        continue;
      }

      let team = teamCache.get(teamName.toLowerCase());
      if (team === undefined) {
        team = await Team.findOne({
          season: season._id,
          name: { $regex: `^${escapeRegex(teamName)}$`, $options: 'i' }
        }).select('_id name').lean();
        teamCache.set(teamName.toLowerCase(), team || null);
      }

      if (!team) {
        missing.push({ reason: 'team', id: desiredId, name: playerName, team: teamName });
        continue;
      }

      const candidates = await T2TrialsPlayer.find({
        season: season._id,
        team: team._id,
        name: { $regex: `^${escapeRegex(playerName)}$`, $options: 'i' }
      }).select('_id name externalId').lean();

      if (candidates.length === 0) {
        missing.push({ reason: 'player', id: desiredId, name: playerName, team: team.name });
        continue;
      }
      if (candidates.length > 1) {
        ambiguous.push({ id: desiredId, name: playerName, team: team.name, count: candidates.length });
        continue;
      }

      const target = candidates[0];
      const currentOwner = byExternalId.get(desiredId) || null;
      intendedAssignments.push({
        desiredId,
        jsonName: playerName,
        jsonTeam: team.name,
        targetPlayerId: String(target._id),
        targetCurrentExternalId: Number.isFinite(Number(target.externalId)) ? Number(target.externalId) : null,
        currentOwnerPlayerId: currentOwner ? String(currentOwner._id) : null,
        currentOwnerName: currentOwner?.name || null,
        currentOwnerTeam: currentOwner?.team?.name || null
      });
    }

    const changes = intendedAssignments.filter(a => a.targetCurrentExternalId !== a.desiredId);
    const conflicts = changes.filter(a => a.currentOwnerPlayerId && a.currentOwnerPlayerId !== a.targetPlayerId);

    const report = {
      season: season.name,
      jsonRows: rows.length,
      intendedAssignments: intendedAssignments.length,
      changesNeeded: changes.length,
      conflictsToReassign: conflicts.length,
      missingCount: missing.length,
      ambiguousCount: ambiguous.length,
      skippedNullTeamCount: skippedNullTeam.length,
      sampleMissing: missing.slice(0, 20),
      sampleConflicts: conflicts.slice(0, 20),
      sampleSkippedNullTeam: skippedNullTeam.slice(0, 20)
    };

    console.log(JSON.stringify(report, null, 2));

    if (!apply) {
      console.log('\nDry run only. Re-run with --apply to write externalIds.');
      return;
    }

    const idsToFree = [...new Set(conflicts.map(c => c.desiredId))];
    if (idsToFree.length) {
      await T2TrialsPlayer.updateMany(
        { season: season._id, externalId: { $in: idsToFree } },
        { $set: { externalId: null } }
      );
    }

    let updated = 0;
    for (const change of changes) {
      const res = await T2TrialsPlayer.updateOne(
        { _id: change.targetPlayerId, season: season._id },
        { $set: { externalId: change.desiredId } }
      );
      if (res.modifiedCount > 0) updated++;
    }

    console.log(`\nApplied externalId updates: ${updated}`);
    console.log(`Conflicts cleared first: ${idsToFree.length}`);
    console.log(`Missing rows left untouched: ${missing.length}`);
    console.log(`Null-team rows left untouched: ${skippedNullTeam.length}`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
