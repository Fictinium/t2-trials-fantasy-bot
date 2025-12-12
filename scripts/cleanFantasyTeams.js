import mongoose from 'mongoose';
import FantasyPlayer from '../models/FantasyPlayer.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';
import dotenv from 'dotenv';
dotenv.config();

async function cleanFantasyTeams() {
  await mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  const allPlayers = await T2TrialsPlayer.find({}, '_id').lean();
  const validIds = new Set(allPlayers.map(p => p._id.toString()));

  const fantasyPlayers = await FantasyPlayer.find();
  for (const fp of fantasyPlayers) {
    const cleanedTeam = (fp.team || []).filter(id => validIds.has(id.toString()));
    if (cleanedTeam.length !== (fp.team || []).length) {
      fp.team = cleanedTeam;
      await fp.save();
      console.log(`Cleaned team for fantasy player ${fp.username || fp.discordId}`);
    }
  }
  await mongoose.disconnect();
  console.log('Done cleaning fantasy teams.');
}

cleanFantasyTeams();