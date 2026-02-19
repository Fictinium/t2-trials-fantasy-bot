// Script to list all Gimlet players in the database, showing team and season references
// Usage: node scripts/listGimlet.js

import mongoose from 'mongoose';
import Team from '../models/Team.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';
import Season from '../models/Season.js';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/test';
  await mongoose.connect(uri);

  const gimlets = await T2TrialsPlayer.find({ name: 'Gimlet' });
  if (!gimlets.length) {
    console.log('No Gimlet players found in the database.');
  } else {
    for (const p of gimlets) {
      const team = await Team.findById(p.team);
      const season = await Season.findById(p.season);
      console.log(`Gimlet _id: ${p._id}`);
      console.log(`  Team: ${team ? team.name : p.team}`);
      console.log(`  Season: ${season ? season.name : p.season}`);
      console.log(`  Cost: ${p.cost}`);
      console.log('---');
    }
  }
  await mongoose.disconnect();
  console.log('List complete.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
