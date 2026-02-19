// migrateToSetsRoundsGames.js
// Migration script: Converts old Match and Player performance data to new sets/rounds/games model
// Usage: node scripts/migrateToSetsRoundsGames.js

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Match from '../models/Match.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';
import Team from '../models/Team.js';
import Season from '../models/Season.js';

// 1. Update all Match documents to have sets/rounds/games structure if missing
async function migrateMatches() {
  const matches = await Match.find({});
  let updated = 0;
  for (const match of matches) {
    // If already migrated, skip
    if (Array.isArray(match.sets) && match.sets.length > 0 && match.sets[0].rounds) continue;
    // If old format, try to convert (this is a placeholder, real logic depends on your old structure)
    // Example: if match.rounds exists, convert to sets/rounds/games
    if (Array.isArray(match.rounds)) {
      match.sets = [
        {
          setNumber: 1,
          rounds: match.rounds.map((r, i) => ({
            roundNumber: r.roundNumber || i + 1,
            games: (r.games || []).map((g, j) => ({
              gameNumber: g.gameNumber || j + 1,
              playerA: g.playerA,
              playerB: g.playerB,
              winner: g.winner || 'None',
            })),
            winner: r.winner || 'None',
          })),
          winner: match.winner || 'None',
        },
      ];
      delete match.rounds;
      await match.save();
      updated++;
    }
  }
  console.log(`Migrated ${updated} matches to sets/rounds/games structure.`);
}

// 2. Update all T2TrialsPlayer performance entries to optionally include sets/rounds/games
async function migratePlayerPerformance() {
  const players = await T2TrialsPlayer.find({});
  let updated = 0;
  for (const player of players) {
    let changed = false;
    for (const perf of player.performance) {
      // If already migrated, skip
      if (perf.sets) continue;
      // If old format, try to convert (placeholder logic)
      if (Array.isArray(perf.rounds)) {
        perf.sets = [
          {
            setNumber: 1,
            rounds: perf.rounds.map((r, i) => ({
              roundNumber: r.roundNumber || i + 1,
              games: [], // No game data in old format, leave empty or try to infer if possible
              winner: 'None',
            })),
            winner: 'None',
          },
        ];
        changed = true;
      }
    }
    if (changed) {
      await player.save();
      updated++;
    }
  }
  console.log(`Migrated ${updated} players' performance to sets/rounds/games structure.`);
}

// Load environment variables
dotenv.config();

const mongoUri = process.env.MONGO_URI;

async function main() {
  await mongoose.connect(mongoUri);
  await migrateMatches();
  await migratePlayerPerformance();
  await mongoose.disconnect();
  console.log('Migration complete.');
}


// For ES modules, just run main at the top level
main().catch(e => { console.error(e); process.exit(1); });
