// Script to sync Team.players array with all T2TrialsPlayer documents for the active season
// Usage: node scripts/syncTeamPlayers.js

import mongoose from 'mongoose';
import Team from '../models/Team.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';
import getActiveSeason from '../utils/getActiveSeason.js';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/test';
  await mongoose.connect(uri);
  const season = await getActiveSeason();
  if (!season) {
    console.error('No active season found.');
    process.exit(1);
  }
  const teams = await Team.find({ season: season._id });
  for (const team of teams) {
    // Find all players for this team and season
    const players = await T2TrialsPlayer.find({ team: team._id, season: season._id });
    const playerIds = players.map(p => p._id);
    // Update the team's players array
    team.players = playerIds;
    await team.save();
    console.log(`Synced team ${team.name}: ${playerIds.length} players.`);
  }
  await mongoose.disconnect();
  console.log('Sync complete.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
