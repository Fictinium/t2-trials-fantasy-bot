import mongoose from 'mongoose';
import FantasyPlayer from '../models/FantasyPlayer.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';
import getActiveSeason from '../utils/getActiveSeason.js';
import dotenv from 'dotenv';
dotenv.config();

async function updateWallets() {
  try {
    // Connect to the database
    await mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

    console.log('Connected to the database.');

    // Get the active season
    const season = await getActiveSeason();
    if (!season) {
      console.error('❌ No active season set.');
      return;
    }

    console.log(`Active season: ${season.name}`);

    // Find all fantasy players for the active season
    const fantasyPlayers = await FantasyPlayer.find({ season: season._id }).populate('team');

    if (!fantasyPlayers.length) {
      console.log('No fantasy players found for the active season.');
      return;
    }

    console.log(`Found ${fantasyPlayers.length} fantasy players.`);

    // Update each fantasy player's wallet
    for (const fp of fantasyPlayers) {
      let wallet = 110; // Reset wallet to the default value

      // Deduct the costs of the players already picked
      if (Array.isArray(fp.team) && fp.team.length > 0) {
        const playerCosts = await T2TrialsPlayer.find({ _id: { $in: fp.team } }, 'cost');
        const totalCost = playerCosts.reduce((sum, player) => sum + (player.cost || 0), 0);
        wallet -= totalCost;
      }

      // Update the wallet value in the database
      fp.wallet = wallet;
      await fp.save();

      console.log(`Updated wallet for ${fp.username || fp.discordId}: ${wallet}`);
    }

    console.log('✅ Wallets updated successfully.');
  } catch (err) {
    console.error('❌ Error updating wallets:', err);
  } finally {
    // Disconnect from the database
    await mongoose.disconnect();
    console.log('Disconnected from the database.');
  }
}

// Run the script
updateWallets();