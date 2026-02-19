import mongoose from 'mongoose';
import FantasyPlayer from '../models/FantasyPlayer.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';
import Season from '../models/Season.js';
import Team from '../models/Team.js';
import dotenv from 'dotenv';
dotenv.config();

async function findFantasyTeamsWithDuplicateNamesDetailed() {
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

  let found = false;
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
      found = true;
      console.log(`\nFantasy team for ${fp.username || fp.discordId}:`);
      for (const [name, arr] of dups) {
        console.log(`  Duplicate: ${name}`);
        arr.forEach((player, idx) => {
          const teamName = player.team?.name || '(unknown)';
          const seasonId = player.season || '(no season)';
          const playerId = player._id;
          const cost = player.cost;
          const perfLen = Array.isArray(player.performance) ? player.performance.length : 0;
          const perfStr = Array.isArray(player.performance) ? JSON.stringify(player.performance) : 'N/A';
          const objStr = JSON.stringify(player, null, 2);
          console.log(`    [${idx + 1}] Team: ${teamName}, Season: ${seasonId}, ID: ${playerId}, Cost: ${cost}, PerfLen: ${perfLen}`);
          console.log(`      Performance: ${perfStr}`);
          // Uncomment below to see full object details
          // console.log(`      Full object: ${objStr}`);
        });
      }
    }
  }
  if (!found) {
    console.log('No fantasy teams with duplicate player names found.');
  }
  await mongoose.disconnect();
}

if (process.argv[1] && process.argv[1].endsWith('findFantasyTeamsWithDuplicateNamesDetailed.js')) {
  findFantasyTeamsWithDuplicateNamesDetailed();
}
