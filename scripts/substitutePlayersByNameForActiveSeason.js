import mongoose from 'mongoose';
import FantasyPlayer from '../models/FantasyPlayer.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';
import Season from '../models/Season.js';
import dotenv from 'dotenv';
dotenv.config();

async function substitutePlayersByNameForActiveSeason() {
  await mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

  const activeSeason = await Season.findOne({ isActive: true });
  if (!activeSeason) {
    console.log('No active season found.');
    await mongoose.disconnect();
    return;
  }

  const allFP = await FantasyPlayer.find({ season: activeSeason._id }).populate({
    path: 'team',
    select: 'name season _id',
    populate: { path: 'season', select: 'name' }
  });

  let subs = 0;
  let logs = [];

  for (const fp of allFP) {
    let updated = false;
    for (let i = 0; i < fp.team.length; i++) {
      const player = fp.team[i];
      if (!player.season || String(player.season) === String(activeSeason._id)) continue;
      // Player is from wrong season
      const playerName = player.name;
      if (!playerName) {
        logs.push(`[WARN] Player at index ${i} in team of ${fp.username || fp.discordId} has no name, cannot match.`);
        continue;
      }
      // Find correct T2TrialsPlayer for active season by name
      const match = await T2TrialsPlayer.findOne({ name: { $regex: `^${playerName}$`, $options: 'i' }, season: activeSeason._id });
      if (!match) {
        logs.push(`[WARN] No matching T2TrialsPlayer for name '${playerName}' in active season (${activeSeason.name}) for player in team of ${fp.username || fp.discordId}.`);
        continue;
      }
      // Substitute the player object in the team array
      fp.team[i] = match._id;
      updated = true;
      subs++;
      logs.push(`[INFO] Substituted player '${playerName}' in team of ${fp.username || fp.discordId} with S2 object.`);
    }
    if (updated) {
      await fp.save();
    }
  }

  console.log(`\nSubstitutions applied: ${subs}`);
  if (logs.length) {
    console.log('Logs:');
    logs.forEach(l => console.log(l));
  }

  await mongoose.disconnect();
}

if (process.argv[1] && process.argv[1].endsWith('substitutePlayersByNameForActiveSeason.js')) {
  substitutePlayersByNameForActiveSeason();
}
