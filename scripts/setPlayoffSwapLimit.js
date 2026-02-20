// Script to update playoffSwapLimit for the current season
// Usage: node scripts/setPlayoffSwapLimit.js <limit>

import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();
import FantasyConfig from '../models/FantasyConfig.js';
import Season from '../models/Season.js';

const MONGO_URI = process.env.MONGO_URI;
const limit = Number(process.argv[2] ?? 3);

async function main() {
  await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  const activeSeason = await Season.findOne({ isActive: true });
  if (!activeSeason) {
    console.error('No active season found.');
    process.exit(1);
  }
  const cfg = await FantasyConfig.findOne({ season: activeSeason._id });
  if (!cfg) {
    console.error('No FantasyConfig found for active season.');
    process.exit(1);
  }
  cfg.playoffSwapLimit = limit;
  await cfg.save();
  console.log(`playoffSwapLimit updated to ${limit} for season ${activeSeason.name}`);
  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
