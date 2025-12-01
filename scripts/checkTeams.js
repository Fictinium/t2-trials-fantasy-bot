import getActiveSeason from '../utils/getActiveSeason.js';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Team from '../models/Team.js';
import '../models/T2TrialsPlayer.js';

dotenv.config();

const mongoUri = process.env.MONGO_URI;

await mongoose.connect(mongoUri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const season = await getActiveSeason();
if (!season) {
  return interaction.reply({ content: '❌ No active season set.', flags: 64 });
}

const teams = await Team.find({season: season._id}).populate('players').lean();
console.log(JSON.stringify(teams, null, 2));

await mongoose.disconnect();