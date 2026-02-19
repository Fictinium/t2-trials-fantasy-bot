// Usage: node scripts/inspectPlayerPerf.js <playerName>
// Prints the performance array for the given player in the active season
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

// Ensure all models are registered
import '../models/modelsIndex.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';
import getActiveSeason from '../utils/getActiveSeason.js';

async function main() {
  const playerName = process.argv[2];
  if (!playerName) {
    console.error('Usage: node scripts/inspectPlayerPerf.js <playerName>');
    process.exit(1);
  }
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('MONGO_URI not set in environment.');
    process.exit(1);
  }
  await mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true });
  const season = await getActiveSeason();
  if (!season) {
    console.error('No active season found.');
    process.exit(1);
  }
  const player = await T2TrialsPlayer.findOne({ name: playerName, season: season._id }).populate('team');
  if (!player) {
    console.error('Player not found:', playerName);
    process.exit(1);
  }
  console.log(`Performance for ${player.name} (${player.team?.name || 'No Team'}):`);
  for (const week of player.performance) {
    console.log(`\nWeek ${week.week}: Wins=${week.wins}, Losses=${week.losses}`);
    if (Array.isArray(week.sets)) {
      for (const set of week.sets) {
        console.log(`  Set ${set.setNumber}:`);
        if (Array.isArray(set.rounds)) {
          for (const round of set.rounds) {
            const games = (round.games || []).map(g => {
              return `(${g.playerA} vs ${g.playerB}, winner: ${g.winner})`;
            }).join(' | ');
            console.log(`    Round ${round.roundNumber}: ${games}`);
          }
        }
      }
    }
  }
  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
