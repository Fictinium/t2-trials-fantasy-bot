import mongoose from 'mongoose';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';
import Season from '../models/Season.js';
import dotenv from 'dotenv';
dotenv.config();

async function listAllPlayerCosts() {
  await mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

  const allPlayers = await T2TrialsPlayer.find({}).populate('season', 'name');
  if (!allPlayers.length) {
    console.log('No T2TrialsPlayer entries found.');
    await mongoose.disconnect();
    return;
  }

  console.log('All T2TrialsPlayer costs:');
  allPlayers.forEach(p => {
    const seasonName = p.season?.name || p.season || '(unknown)';
    console.log(`- ${p.name} (season: ${seasonName}, id: ${p._id}): cost = ${p.cost}`);
  });

  await mongoose.disconnect();
}

if (process.argv[1] && process.argv[1].endsWith('listAllPlayerCosts.js')) {
  listAllPlayerCosts();
}
