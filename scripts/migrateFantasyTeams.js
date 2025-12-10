import mongoose from 'mongoose';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';
import FantasyPlayer from '../models/FantasyPlayer.js';
import dotenv from 'dotenv';
dotenv.config();

async function migrateFantasyTeams() {
  try {
    // Connect to the database
    await mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log('Connected to the database.');

    // Fetch all fantasy players
    const fantasyPlayers = await FantasyPlayer.find().populate('team');
    console.log(`Found ${fantasyPlayers.length} fantasy players.`);

    // Create a map to track which fantasy players picked each T2TrialsPlayer
    const playerPickMap = new Map();

    for (const fp of fantasyPlayers) {
      for (const player of fp.team) {
        if (!playerPickMap.has(player._id.toString())) {
          playerPickMap.set(player._id.toString(), []);
        }
        playerPickMap.get(player._id.toString()).push(fp._id); // Add the FantasyPlayer ID to the list
      }
    }

    console.log(`Mapped picks for ${playerPickMap.size} players.`);

    // Update each T2TrialsPlayer with the correct fantasyTeams field
    for (const [playerId, fantasyTeamIds] of playerPickMap.entries()) {
      await T2TrialsPlayer.findByIdAndUpdate(
        playerId,
        { fantasyTeams: fantasyTeamIds },
        { new: true }
      );
      console.log(`Updated player ${playerId} with ${fantasyTeamIds.length} picks.`);
    }

    console.log('Migration completed successfully.');
  } catch (err) {
    console.error('❌ Error during migration:', err);
  } finally {
    // Disconnect from the database
    await mongoose.disconnect();
    console.log('Disconnected from the database.');
  }
}

migrateFantasyTeams();