
import mongoose from 'mongoose';
import FantasyPlayer from '../models/FantasyPlayer.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';
import Season from '../models/Season.js';
import dotenv from 'dotenv';
dotenv.config();

async function showTeamWithSeasons(discordName) {
  await mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });


  // Find all FantasyPlayer docs for this username or discordId
  const allFP = await FantasyPlayer.find({
    $or: [
      { username: { $regex: `^${discordName}$`, $options: 'i' } },
      { discordId: discordName }
    ]
  }).populate({
    path: 'season',
    select: 'name _id'
  });

  if (!allFP.length) {
    console.log(`No fantasy player found for username: ${discordName}`);
    await mongoose.disconnect();
    return;
  }

  // Print all found FantasyPlayer docs and their season info
  console.log(`Found ${allFP.length} fantasy player profiles for ${discordName}:`);
  allFP.forEach(fp => {
    console.log(`- Season: ${fp.season?.name || fp.season} (ID: ${fp.season?._id || fp.season})`);
  });

  // Find the current (active) season
  const activeSeason = await Season.findOne({ isActive: true });
  if (!activeSeason) {
    console.log('No active season found.');
    await mongoose.disconnect();
    return;
  }

  // Find the FantasyPlayer for the active season
  const fp = allFP.find(fp => String(fp.season?._id || fp.season) === String(activeSeason._id));
  if (!fp) {
    console.log(`No fantasy player profile found for active season (${activeSeason.name}).`);
    await mongoose.disconnect();
    return;
  }

  // Populate team for the active season profile
  await fp.populate({
    path: 'team',
    select: 'name season',
    populate: { path: 'season', select: 'name' }
  });

  console.log(`\nFantasy team for ${discordName} in active season (${activeSeason.name}):`);
  if (!fp.team.length) {
    console.log('  (Team is empty)');
  } else {
    fp.team.forEach(player => {
      const seasonId = player.season?._id || player.season;
      const seasonName = player.season?.name || '(unknown)';
      console.log(`- ${player.name} (seasonId: ${seasonId}, seasonName: ${seasonName})`);
    });
  }

  await mongoose.disconnect();
}

// ES module compatible entrypoint
if (process.argv[1] && process.argv[1].endsWith('showTeamWithSeasons.js')) {
  const name = process.argv[2];
  if (!name) {
    console.error('Usage: node scripts/showTeamWithSeasons.js "Discord Name"');
    process.exit(1);
  }
  showTeamWithSeasons(name);
}
