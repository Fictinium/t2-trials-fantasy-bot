import mongoose from 'mongoose';
import '../models/modelsIndex.js';
import FantasyPlayer from '../models/FantasyPlayer.js';
import getActiveSeason from '../utils/getActiveSeason.js';
import dotenv from 'dotenv';
dotenv.config();

async function reAddPlayersById() {
  try {
    await mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log('Connected to the database.');

    const season = await getActiveSeason();
    if (!season) {
      console.error('❌ No active season set.');
      return;
    }
    console.log(`Active season: ${season.name}`);

    const fantasyPlayers = await FantasyPlayer.find({ season: season._id }).populate('team');
    if (!fantasyPlayers.length) {
      console.log('No fantasy players found for the active season.');
      return;
    }
    console.log(`Found ${fantasyPlayers.length} fantasy players.`);

    let fixedCount = 0;
    for (const fp of fantasyPlayers) {
      if (!Array.isArray(fp.team) || fp.team.length === 0) continue;
      const ids = fp.team.map(p => p._id);
      // Remove all players, then re-add by ID (de-corrupts any copies)
      fp.team = [];
      for (const id of ids) {
        fp.team.push(id);
      }
      await fp.save();
      fixedCount++;
      console.log(`Re-added players by ID for ${fp.username || fp.discordId}`);
    }
    console.log(`✅ Re-added players by ID for ${fixedCount} fantasy teams.`);
  } catch (err) {
    console.error('❌ Error re-adding players by ID:', err);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from the database.');
  }
}

reAddPlayersById();
