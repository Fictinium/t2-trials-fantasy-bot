import mongoose from 'mongoose';
import FantasyPlayer from '../models/FantasyPlayer.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';
import Season from '../models/Season.js';
import dotenv from 'dotenv';
dotenv.config();

async function fixFantasyTeamsPlayerSeasons() {
  await mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

  const activeSeason = await Season.findOne({ isActive: true });
  if (!activeSeason) {
    console.log('No active season found.');
    await mongoose.disconnect();
    return;
  }

  const allFP = await FantasyPlayer.find({ season: activeSeason._id }).populate({
    path: 'team',
    select: 'name season _id externalId',
    populate: { path: 'season', select: 'name' }
  });

  let fixes = 0;
  let logs = [];

  for (const fp of allFP) {
    let updated = false;
    for (let i = 0; i < fp.team.length; i++) {
      const player = fp.team[i];
      if (!player.season || String(player.season) === String(activeSeason._id)) continue;
      // Player is from wrong season
      const extId = player.externalId;
      if (!extId) {
        logs.push(`[WARN] Player ${player.name} in team of ${fp.username || fp.discordId} has no externalId, cannot match.`);
        continue;
      }
      // Find correct T2TrialsPlayer for active season
      const match = await T2TrialsPlayer.findOne({ externalId: extId, season: activeSeason._id });
      if (!match) {
        logs.push(`[WARN] No matching T2TrialsPlayer for externalId ${extId} in active season (${activeSeason.name}) for player ${player.name} in team of ${fp.username || fp.discordId}.`);
        continue;
      }
      // Copy all attributes from match to player in team
      const playerObj = fp.team[i];
      Object.keys(match.toObject()).forEach(key => {
        if (key === '_id') return; // Don't overwrite object ID
        playerObj[key] = match[key];
      });
      playerObj.season = match.season;
      updated = true;
      fixes++;
      logs.push(`[INFO] Fixed player ${player.name} in team of ${fp.username || fp.discordId} to use S2 data.`);
    }
    if (updated) {
      await fp.save();
    }
  }

  console.log(`\nFixes applied: ${fixes}`);
  if (logs.length) {
    console.log('Logs:');
    logs.forEach(l => console.log(l));
  }

  await mongoose.disconnect();
}

if (process.argv[1] && process.argv[1].endsWith('fixFantasyTeamsPlayerSeasons.js')) {
  fixFantasyTeamsPlayerSeasons();
}
