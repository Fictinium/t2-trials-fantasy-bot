import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import Season from '../models/Season.js';
import FantasyPlayer from '../models/FantasyPlayer.js';
import FantasyConfig from '../models/FantasyConfig.js';
import Team from '../models/Team.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';
import Match from '../models/Match.js';

async function run() {
  await mongoose.connect(process.env.MONGO_URI);

  console.log("Connected.");

  // Create Season 1
  let season = await Season.findOne({ name: 'S1' });
  if (!season) {
    season = await Season.create({ name: 'S1', isActive: true });
  }

  const seasonId = season._id;

  console.log("Assigning all existing records to Season 1...");

  await Promise.all([
    FantasyPlayer.updateMany({}, { season: seasonId }),
    FantasyConfig.updateMany({}, { season: seasonId }),
    Team.updateMany({}, { season: seasonId }),
    T2TrialsPlayer.updateMany({}, { season: seasonId }),
    Match.updateMany({}, { season: seasonId })
  ]);

  console.log("Migration completed!");
  process.exit(0);
}

run();