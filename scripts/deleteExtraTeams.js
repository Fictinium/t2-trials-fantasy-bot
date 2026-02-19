// Script: scripts/deleteExtraTeams.js
// Purpose: Delete extra teams (and their players) from S2 DB by team ID
import mongoose from 'mongoose';
import Team from '../models/Team.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';
import dotenv from 'dotenv';
dotenv.config();

// Paste the list of extra team IDs here:
const EXTRA_TEAM_IDS = [
  '689947771560dd7b2ce7a30a',
  '689947771560dd7b2ce7a30b',
  '689a34cf14fe1c2dc6ac95d8',
  '689a34cf14fe1c2dc6ac95ea',
  '689a34cf14fe1c2dc6ac95ef',
  '689a34d014fe1c2dc6ac95f9',
  '689a34d014fe1c2dc6ac9611',
  '689a34d014fe1c2dc6ac961b',
  '689a34d014fe1c2dc6ac963c',
  '689a34d014fe1c2dc6ac964a',
  '689a34d114fe1c2dc6ac964f',
  '689a34d114fe1c2dc6ac9657',
  '689a34d114fe1c2dc6ac9671',
  '689a34d114fe1c2dc6ac9676',
  '689a34d114fe1c2dc6ac9680',
  '689a34d114fe1c2dc6ac9688',
  '689a34d114fe1c2dc6ac9690',
  '689a34d114fe1c2dc6ac969b',
  '689a34d214fe1c2dc6ac96a0',
  '689a34d214fe1c2dc6ac96ab',
  '689a34d214fe1c2dc6ac96b0',
  '689a34d214fe1c2dc6ac96df',
  '689a34d314fe1c2dc6ac9701',
  '689a34d614fe1c2dc6ac983e',
  '69384fb58ca29cd2e0bc3c6c',
  '694030816f52f420c8d77199',
  '694030826f52f420c8d771b1',
  '694030826f52f420c8d771c7',
  '694030826f52f420c8d771d5',
  '694030836f52f420c8d771f7',
  '694030836f52f420c8d77203',
  '694030846f52f420c8d77239',
  '694030846f52f420c8d77247',
  '694030846f52f420c8d77253',
  '694030846f52f420c8d7725b',
  '694030866f52f420c8d772ad',
  '694030866f52f420c8d772b5',
  '694030866f52f420c8d772bd',
  '694030876f52f420c8d772db',
  '694030876f52f420c8d772ed',
  '694030876f52f420c8d77301',
  '694030886f52f420c8d77321',
  '694030896f52f420c8d77371',
  '6940308b6f52f420c8d773e7',
  '6940308c6f52f420c8d7741f',
  '694030956f52f420c8d77687'
];

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  for (const teamId of EXTRA_TEAM_IDS) {
    // Delete all players in this team
    const deletedPlayers = await T2TrialsPlayer.deleteMany({ team: teamId });
    // Delete the team itself
    const deletedTeam = await Team.deleteOne({ _id: teamId });
    console.log(`Deleted team ${teamId} (players: ${deletedPlayers.deletedCount}, team: ${deletedTeam.deletedCount})`);
  }
  await mongoose.disconnect();
  console.log('Done deleting extra teams and their players.');
}

main().catch(e => { console.error(e); process.exit(1); });
