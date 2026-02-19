import mongoose from 'mongoose';
import '../models/modelsIndex.js';
import FantasyPlayer from '../models/FantasyPlayer.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';
import getActiveSeason from '../utils/getActiveSeason.js';
import dotenv from 'dotenv';
dotenv.config();

async function showFantasyTeamDetails(discordId) {
  try {
    await mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log('Connected to the database.');

    const season = await getActiveSeason();
    if (!season) {
      console.error('❌ No active season set.');
      return;
    }
    console.log(`Active season: ${season.name}`);

    const fp = await FantasyPlayer.findOne({ discordId, season: season._id }).populate('team');
    if (!fp) {
      console.log('No fantasy player found for this user.');
      return;
    }
    console.log(`Fantasy team for ${fp.username || fp.discordId}:`);
    if (!Array.isArray(fp.team) || fp.team.length === 0) {
      console.log('  (Empty team)');
      return;
    }
    for (const p of fp.team) {
      // Try to fetch the canonical T2TrialsPlayer for full details
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
    console.log('---');
    console.log(`Wallet: ${fp.wallet}`);
  } catch (err) {
    console.error('❌ Error showing fantasy team details:', err);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from the database.');
  }
}

// Usage: node scripts/showFantasyTeamDetails.js <usernameOrId>
const usernameOrId = process.argv[2];
if (!usernameOrId) {
  console.error('Usage: node scripts/showFantasyTeamDetails.js <usernameOrDiscordId>');
  process.exit(1);
}

async function findAndShow() {
  await mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  const season = await getActiveSeason();
  if (!season) {
    console.error('❌ No active season set.');
    process.exit(1);
  }
  // Try by username first
  let fp = await FantasyPlayer.findOne({ username: usernameOrId, season: season._id });
  if (!fp) {
    // Try by discordId
    fp = await FantasyPlayer.findOne({ discordId: usernameOrId, season: season._id });
  }
  if (!fp) {
    console.error('No fantasy player found for this username or Discord ID.');
    process.exit(1);
  }
  await mongoose.disconnect();
  await showFantasyTeamDetails(fp.discordId);
}
findAndShow();
