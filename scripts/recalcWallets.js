import mongoose from 'mongoose';
import '../models/modelsIndex.js';
import FantasyPlayer from '../models/FantasyPlayer.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';
import getActiveSeason from '../utils/getActiveSeason.js';
import dotenv from 'dotenv';
dotenv.config();

const DEFAULT_WALLET = 110;

async function recalcWallets() {
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

    let updatedCount = 0;
    for (const fp of fantasyPlayers) {
      let wallet = DEFAULT_WALLET;
      if (Array.isArray(fp.team) && fp.team.length > 0) {
        const playerIds = fp.team.map(p => p._id);
        const players = await T2TrialsPlayer.find({ _id: { $in: playerIds } }, 'cost');
        const totalCost = players.reduce((sum, p) => sum + (p.cost || 0), 0);
        wallet -= totalCost;
      }
      if (fp.wallet !== wallet) {
        fp.wallet = wallet;
        await fp.save();
        updatedCount++;
        console.log(`Updated wallet for ${fp.username || fp.discordId}: ${wallet}`);
      }
    }
    console.log(`✅ Updated wallet for ${updatedCount} fantasy players.`);
  } catch (err) {
    console.error('❌ Error recalculating wallets:', err);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from the database.');
  }
}

recalcWallets();
