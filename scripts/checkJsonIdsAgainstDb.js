// Script: scripts/checkJsonIdsAgainstDb.js
// Purpose: Compare player IDs in a stats JSON file against MongoDB T2TrialsPlayer.externalId
// for a target season (active season by default), and report correspondence/mismatches.
//
// Usage:
//   node .\scripts\checkJsonIdsAgainstDb.js
//   node .\scripts\checkJsonIdsAgainstDb.js --file .\players.json
//   node .\scripts\checkJsonIdsAgainstDb.js --season S3
//   node .\scripts\checkJsonIdsAgainstDb.js --file .\players.json --season S3 --samples 30

import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

import '../models/modelsIndex.js';
import getActiveSeason from '../utils/getActiveSeason.js';
import { escapeRegex } from '../utils/escapeRegex.js';
import { normalizeStatsPayload } from '../services/importer.js';
import Season from '../models/Season.js';
import Team from '../models/Team.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';

dotenv.config();

function readArg(flag, defaultValue = null) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return defaultValue;
  return process.argv[idx + 1] ?? defaultValue;
}

function toInt(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

async function resolveSeason(seasonArg) {
  if (!seasonArg) return getActiveSeason();

  const exact = await Season.findOne({
    name: { $regex: `^${escapeRegex(seasonArg)}$`, $options: 'i' }
  });
  if (exact) return exact;

  return null;
}

async function main() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('MONGO_URI (or MONGODB_URI) is not set.');
    process.exit(1);
  }

  const fileArg = readArg('--file', 'players.json');
  const seasonArg = readArg('--season', null);
  const samples = toInt(readArg('--samples', '20'), 20);

  const filePath = path.resolve(process.cwd(), fileArg);
  if (!fs.existsSync(filePath)) {
    console.error(`JSON file not found: ${filePath}`);
    process.exit(1);
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error(`Failed to parse JSON file: ${err.message}`);
    process.exit(1);
  }

  let parsed;
  try {
    parsed = normalizeStatsPayload(raw);
  } catch (err) {
    console.error(`Unsupported JSON shape: ${err.message}`);
    process.exit(1);
  }

  const playersArray = parsed.playersArray;
  if (!Array.isArray(playersArray) || playersArray.length === 0) {
    console.error('No players found in JSON payload.');
    process.exit(1);
  }

  await mongoose.connect(mongoUri);

  try {
    const season = await resolveSeason(seasonArg);
    if (!season) {
      console.error(seasonArg
        ? `Season not found: ${seasonArg}`
        : 'No active season set.');
      process.exit(1);
    }

    const jsonById = new Map();
    let invalidJsonId = 0;

    for (const row of playersArray) {
      const id = Number(row?.id);
      if (!Number.isFinite(id)) {
        invalidJsonId++;
        continue;
      }
      if (!jsonById.has(id)) jsonById.set(id, row);
    }

    const jsonIds = [...jsonById.keys()];

    const dbPlayers = await T2TrialsPlayer.find({
      season: season._id,
      externalId: { $in: jsonIds }
    })
      .populate('team', 'name')
      .select('externalId name team')
      .lean();

    const dbByExternalId = new Map(
      dbPlayers.map(p => [Number(p.externalId), p])
    );

    const missingInDb = [];
    const mismatchNameOrTeam = [];

    for (const [id, row] of jsonById.entries()) {
      const dbp = dbByExternalId.get(id);
      if (!dbp) {
        missingInDb.push({
          id,
          jsonName: row?.name ?? null,
          jsonTeam: row?.team_name ?? null
        });
        continue;
      }

      const jsonName = String(row?.name ?? '').trim().toLowerCase();
      const dbName = String(dbp?.name ?? '').trim().toLowerCase();
      const jsonTeam = String(row?.team_name ?? '').trim().toLowerCase();
      const dbTeam = String(dbp?.team?.name ?? '').trim().toLowerCase();

      const nameMismatch = jsonName && dbName && jsonName !== dbName;
      const teamMismatch = jsonTeam && dbTeam && jsonTeam !== dbTeam;

      if (nameMismatch || teamMismatch) {
        mismatchNameOrTeam.push({
          id,
          jsonName: row?.name ?? null,
          dbName: dbp?.name ?? null,
          jsonTeam: row?.team_name ?? null,
          dbTeam: dbp?.team?.name ?? null
        });
      }
    }

    const dbIdsInSeason = await T2TrialsPlayer.find(
      { season: season._id },
      { externalId: 1 }
    ).lean();

    const dbExternalIdSet = new Set(
      dbIdsInSeason
        .map(p => Number(p.externalId))
        .filter(Number.isFinite)
    );

    const extraDbExternalIds = [...dbExternalIdSet]
      .filter(id => !jsonById.has(id));

    let nameTeamMatches = 0;
    let missingTeamByNameCheck = 0;
    let missingPlayerByNameTeam = 0;

    for (const row of playersArray) {
      const teamName = String(row?.team_name ?? '').trim();
      const playerName = String(row?.name ?? '').trim();
      if (!teamName || !playerName) continue;

      const team = await Team.findOne({
        season: season._id,
        name: { $regex: `^${escapeRegex(teamName)}$`, $options: 'i' }
      }).select('_id').lean();

      if (!team) {
        missingTeamByNameCheck++;
        continue;
      }

      const pl = await T2TrialsPlayer.findOne({
        season: season._id,
        team: team._id,
        name: { $regex: `^${escapeRegex(playerName)}$`, $options: 'i' }
      }).select('_id').lean();

      if (pl) nameTeamMatches++;
      else missingPlayerByNameTeam++;
    }

    const report = {
      season: {
        id: String(season._id),
        name: season.name
      },
      file: {
        path: filePath,
        totalRows: playersArray.length,
        uniqueNumericIds: jsonIds.length,
        invalidJsonId
      },
      byExternalId: {
        matched: jsonIds.length - missingInDb.length,
        missingInDb: missingInDb.length,
        mismatchNameOrTeam: mismatchNameOrTeam.length,
        extraDbExternalIdsNotInJson: extraDbExternalIds.length
      },
      byNameTeamFallback: {
        nameTeamMatches,
        missingTeam: missingTeamByNameCheck,
        missingPlayerByNameTeam
      },
      samples: {
        missingInDb: missingInDb.slice(0, samples),
        mismatchNameOrTeam: mismatchNameOrTeam.slice(0, samples),
        extraDbExternalIds: extraDbExternalIds.slice(0, samples)
      }
    };

    console.log(JSON.stringify(report, null, 2));

    const hasBlockingMismatch = missingInDb.length > 0 || mismatchNameOrTeam.length > 0;
    process.exitCode = hasBlockingMismatch ? 2 : 0;
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
