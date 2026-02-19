// Script: scripts/fixTeamPlayersArrays.js
// Purpose: For each team in the active season, set its players array to all T2TrialsPlayer IDs for that team and season.
import mongoose from 'mongoose';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';
import Team from '../models/Team.js';
import dotenv from 'dotenv';
import getActiveSeason from '../utils/getActiveSeason.js';
dotenv.config();

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  const season = await getActiveSeason();
  if (!season) {
    console.error('No active season set. Aborting.');
    process.exit(1);
  }
  const teams = await Team.find({ season: season._id });
  let updatedCount = 0;
  for (const team of teams) {
    const players = await T2TrialsPlayer.find({ team: team._id, season: season._id }, '_id');
    team.players = players.map(p => p._id);
    await team.save();
    updatedCount++;
    console.log(`Updated team '${team.name}' with ${team.players.length} players.`);
  }
  console.log(`Updated ${updatedCount} teams' players arrays.`);
  await mongoose.disconnect();
  console.log('Done fixing team player lists.');
}

main().catch(e => { console.error(e); process.exit(1); });
