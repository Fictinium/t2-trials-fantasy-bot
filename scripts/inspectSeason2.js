import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Season from '../models/Season.js';
import Team from '../models/Team.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';
import FantasyPlayer from '../models/FantasyPlayer.js';

// Load environment variables
dotenv.config();

const mongoUri = process.env.MONGO_URI;

async function main() {
  await mongoose.connect(mongoUri, {
    // useNewUrlParser and useUnifiedTopology are deprecated in Mongoose 6+
  });
  console.log('Connected to MongoDB');

  // Find active season (S2)
  const season = await Season.findOne({ isActive: true });
  if (!season) {
    console.error('No active season found.');
    process.exit(1);
  }
  console.log(`Active season: ${season.name} (${season._id})`);

  // Real Teams for S2
  const teams = await Team.find({ season: season._id });

  // Real Players for S2
  const realPlayers = await T2TrialsPlayer.find({ season: season._id });

  // Fantasy Teams for S2
  const fantasyPlayers = await FantasyPlayer.find({ season: season._id });

  // Prepare output object
  const output = {
    season: { _id: season._id, name: season.name },
    realTeams: teams.map(team => ({
      _id: team._id,
      name: team.name,
      players: team.players,
      performance: team.performance,
    })),
    realPlayers: realPlayers.map(player => ({
      _id: player._id,
      name: player.name,
      team: player.team,
      stats: player.stats,
    })),
    fantasyPlayers: fantasyPlayers.map(fp => ({
      _id: fp._id,
      discordId: fp.discordId,
      team: fp.team,
      weeklyPoints: fp.weeklyPoints,
    })),
  };

  // Write to file on Desktop
  const desktopPath = path.join(os.homedir(), 'Desktop', 'season2_inspect_output.json');
  fs.writeFileSync(desktopPath, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`Output written to ${desktopPath}`);

  await mongoose.disconnect();
  console.log('Disconnected from MongoDB');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
