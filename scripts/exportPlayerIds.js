import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import getActiveSeason from '../utils/getActiveSeason.js';
import Team from '../models/Team.js';
import dotenv from 'dotenv';
import '../models/modelsIndex.js';

dotenv.config();

async function main() {
  await mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  const season = await getActiveSeason();
  if (!season) {
    console.error('No active season found.');
    process.exit(1);
  }

  // Get all teams for the active season, populate players
  const teams = await Team.find({ season: season._id }).populate('players');


  // Set to avoid duplicate lines
  const linesSet = new Set();

  for (const team of teams) {
    for (const player of team.players) {
      if (!player.externalId) continue;
      // Always export both formats
      linesSet.add(`${player.name}: ${player.externalId}`);
      linesSet.add(`${player.name} (${team.name}): ${player.externalId}`);
    }
  }

  // Build output lines
  const lines = Array.from(linesSet);

  // Write to file
  const outPath = path.join(process.cwd(), 'player_ids.txt');
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  console.log(`Exported ${lines.length} player IDs to player_ids.txt`);
  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
