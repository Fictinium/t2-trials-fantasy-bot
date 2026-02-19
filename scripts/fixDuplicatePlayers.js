// Usage: node scripts/fixDuplicatePlayers.js
// This script scans for duplicate T2TrialsPlayer docs (same name, same season),
// and for each duplicate, keeps the one with the earliest createdAt as the 'real' player for that season.
// It updates all references in FantasyPlayer.team arrays to point to the correct player,
// and repopulates the fantasyTeams array for all T2TrialsPlayers.
// After running, you should re-run your scoring scripts.

import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();
import '../models/modelsIndex.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';
import FantasyPlayer from '../models/FantasyPlayer.js';

async function main() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) throw new Error('MONGO_URI not set');
  await mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true });

  // 1. Find all duplicate players (same name, same season)
  const dups = await T2TrialsPlayer.aggregate([
    { $group: {
        _id: { name: "$name", season: "$season" },
        ids: { $push: "$_id" },
        count: { $sum: 1 },
        createdAts: { $push: "$createdAt" }
      }
    },
    { $match: { count: { $gt: 1 } } }
  ]);

  let fixed = 0;
  for (const dup of dups) {
    // Find the 'real' player (earliest createdAt)
    const players = await T2TrialsPlayer.find({ _id: { $in: dup.ids } });
    players.sort((a, b) => a.createdAt - b.createdAt);
    const real = players[0];
    const toRemove = players.slice(1);
    const toRemoveIds = toRemove.map(p => p._id);

    // Update all FantasyPlayer.team arrays to use the real player's _id
    await FantasyPlayer.updateMany(
      { team: { $in: toRemoveIds } },
      [{ $set: { team: {
        $map: {
          input: "$team",
          as: "pid",
          in: { $cond: [ { $in: ["$$pid", toRemoveIds] }, real._id, "$$pid" ] }
        }
      } } }]
    );

    // Remove the duplicate T2TrialsPlayers
    await T2TrialsPlayer.deleteMany({ _id: { $in: toRemoveIds } });
    fixed += toRemoveIds.length;
  }

  // 2. Repopulate fantasyTeams array for all T2TrialsPlayers
  const allPlayers = await T2TrialsPlayer.find();
  for (const player of allPlayers) {
    const fantasyTeams = await FantasyPlayer.find({ team: player._id }, '_id');
    player.fantasyTeams = fantasyTeams.map(f => f._id);
    await player.save();
  }

  console.log(`Fixed ${fixed} duplicate player docs and repopulated fantasyTeams arrays.`);
  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
