// Script to diagnose Gimlet's player document and linkage
// Usage: node scripts/checkGimlet.js

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

  // Find all teams for the active season
  const teams = await Team.find({ season: season._id });
  for (const team of teams) {
    // Find Gimlet in this team and season
    const gimlet = await T2TrialsPlayer.findOne({ name: 'Gimlet', team: team._id, season: season._id });
    if (gimlet) {
      console.log(`Found Gimlet in team '${team.name}' for season '${season.name}':`);
      console.log(`  Player _id: ${gimlet._id}`);
      console.log(`  Team players array includes Gimlet: ${team.players.map(id => id.toString()).includes(gimlet._id.toString())}`);
    }
  }
  await mongoose.disconnect();
  console.log('Check complete.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
