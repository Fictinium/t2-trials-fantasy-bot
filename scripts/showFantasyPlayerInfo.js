import mongoose from 'mongoose';
import '../models/modelsIndex.js';
import FantasyPlayer from '../models/FantasyPlayer.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';
import getActiveSeason from '../utils/getActiveSeason.js';
import dotenv from 'dotenv';
dotenv.config();

async function showFantasyPlayerInfo(usernameOrId) {
  try {
    await mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log('Connected to the database.');

    const season = await getActiveSeason();
    if (!season) {
      console.error('❌ No active season set.');
      return;
    }
    console.log(`Active season: ${season.name}`);

    // Try by username first, then discordId
    let fp = await FantasyPlayer.findOne({ username: usernameOrId, season: season._id }).populate('team');
    if (!fp) {
      fp = await FantasyPlayer.findOne({ discordId: usernameOrId, season: season._id }).populate('team');
    }
    if (!fp) {
      console.log('No fantasy player found for this username or Discord ID.');
      return;
    }
    console.log('--- FantasyPlayer Info ---');
    console.log(`Username: ${fp.username}`);
    console.log(`Discord ID: ${fp.discordId}`);
    console.log(`Wallet: ${fp.wallet}`);
    console.log(`Total Points: ${fp.totalPoints}`);
    console.log(`Weekly Points: ${JSON.stringify(fp.weeklyPoints)}`);
    console.log(`Team size: ${Array.isArray(fp.team) ? fp.team.length : 0}`);
    if (Array.isArray(fp.team) && fp.team.length > 0) {
      for (const p of fp.team) {
        const canonical = await T2TrialsPlayer.findById(p._id);
        console.log('---');
        console.log(`Name: ${p.name}`);
        console.log(`ID: ${p._id}`);
        console.log(`Cost (in team): ${p.cost}`);
        if (canonical) {
          console.log(`Canonical cost: ${canonical.cost}`);
          console.log(`Team: ${canonical.team}`);
          console.log(`Season: ${canonical.season}`);
        } else {
          console.log('(No canonical T2TrialsPlayer found for this ID)');
        }
      }
    }
    console.log('-------------------------');
  } catch (err) {
    console.error('❌ Error showing fantasy player info:', err);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from the database.');
  }
}

// Usage: node scripts/showFantasyPlayerInfo.js <usernameOrDiscordId>
const usernameOrId = process.argv[2];
if (!usernameOrId) {
  console.error('Usage: node scripts/showFantasyPlayerInfo.js <usernameOrDiscordId>');
  process.exit(1);
}
showFantasyPlayerInfo(usernameOrId);
