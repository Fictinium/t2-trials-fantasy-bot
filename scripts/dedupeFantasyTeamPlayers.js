import mongoose from 'mongoose';
import FantasyPlayer from '../models/FantasyPlayer.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';
import Season from '../models/Season.js';
import Team from '../models/Team.js';
import dotenv from 'dotenv';
dotenv.config();

async function dedupeFantasyTeamPlayers() {
  await mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

  const activeSeason = await Season.findOne({ isActive: true });
  if (!activeSeason) {
    console.log('No active season found.');
    await mongoose.disconnect();
    return;
  }

  const allFP = await FantasyPlayer.find({ season: activeSeason._id })
    .populate({
      path: 'team',
      populate: { path: 'team', model: 'Team', select: 'name' }
    });

  let deduped = 0;
  for (const fp of allFP) {
    const roster = Array.isArray(fp.team) ? fp.team : [];
    const nameMap = {};
    for (const p of roster) {
      if (!p || !p.name) continue;
      if (!nameMap[p.name]) nameMap[p.name] = [];
      nameMap[p.name].push(p);
    }
    const dups = Object.entries(nameMap).filter(([name, arr]) => arr.length > 1);
    if (dups.length) {
      let newTeam = roster.slice();
      for (const [name, arr] of dups) {
        // Store the object ID of the first duplicate
        const keepId = arr[0]._id;
        // Remove all instances of this player name from the team
        newTeam = newTeam.filter(p => !(p && p.name === name));
        // Add back a single reference to the correct player object
        newTeam.push(keepId);
        deduped++;
        console.log(`Deduped '${name}' for fantasy player ${fp.username || fp.discordId}`);
      }
      // Save the deduped team (as array of ObjectIds)
      fp.team = newTeam.map(p => (typeof p === 'object' && p._id) ? p._id : p);
      await fp.save();
    }
  }
  console.log(`\nDeduplication complete. Fixed ${deduped} duplicate entries.`);
  await mongoose.disconnect();
}

if (process.argv[1] && process.argv[1].endsWith('dedupeFantasyTeamPlayers.js')) {
  dedupeFantasyTeamPlayers();
}
