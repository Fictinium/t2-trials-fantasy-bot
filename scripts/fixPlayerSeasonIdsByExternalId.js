// Usage: node scripts/fixPlayerSeasonIdsByExternalId.js
// This script fixes season IDs for T2TrialsPlayer docs based on externalId.
// - If externalId < 10000, set season to S1
// - If externalId >= 10000, set season to S2
// Only applies to players with unique names (no duplicates with same name).
// Bonus: Also ensures S2 players (externalId >= 10000) have S2 season, S1 players (<10000) have S1 season.

import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();
import '../models/modelsIndex.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';
import Season from '../models/Season.js';

async function main() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) throw new Error('MONGO_URI not set');
  await mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true });

  // Get S1 and S2 season ObjectIds by creation order
  const seasons = await Season.find().sort({ createdAt: 1 });
  if (seasons.length < 2) throw new Error('Need at least two seasons in the database.');
  const s1Season = seasons[0]._id;
  const s2Season = seasons[seasons.length - 1]._id;
  console.log(`S1 season ObjectId: ${s1Season}`);
  console.log(`S2 season ObjectId: ${s2Season}`);

  // Find all players
  const allPlayers = await T2TrialsPlayer.find();

  // Build a map of name -> array of players
  const nameMap = {};
  for (const player of allPlayers) {
    if (!nameMap[player.name]) nameMap[player.name] = [];
    nameMap[player.name].push(player);
  }

  let updated = 0;
  for (const player of allPlayers) {
    // Only fix if this name is unique (no duplicates)
    if (nameMap[player.name].length > 1) continue;
    if (typeof player.externalId !== 'number') continue;
    let targetSeason = null;
    if (player.externalId < 100000) targetSeason = s1Season;
    else if (player.externalId >= 100000) targetSeason = s2Season;
    if (targetSeason && String(player.season) !== String(targetSeason)) {
      console.log(`Fixing season for player ${player.name} (${player._id}): ${player.season} -> ${targetSeason}`);
      player.season = targetSeason;
      await player.save();
      updated++;
    }
  }

  console.log(`Updated season ID for ${updated} player docs based on externalId.`);
  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
