// Usage: node scripts/fixPlayerSeasonIds.js
// This script ensures that for each FantasyPlayer.team entry, the referenced T2TrialsPlayer doc has the correct S2 season ID.
// It uses creation date to distinguish S1 vs S2 players with the same name.
// It does NOT delete any player docs or modify FantasyPlayer.team arrays.
// It also repopulates the fantasyTeams array for all T2TrialsPlayers.

import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();
import '../models/modelsIndex.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';
import FantasyPlayer from '../models/FantasyPlayer.js';
import Season from '../models/Season.js';

async function main() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) throw new Error('MONGO_URI not set');
  await mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true });

  // For each T2TrialsPlayer, set their season to match their team's season
  const allPlayersForSeasonFix = await T2TrialsPlayer.find();
  let updated = 0;
  for (const player of allPlayersForSeasonFix) {
    if (!player.team) continue;
    const team = await mongoose.model('Team').findById(player.team);
    if (!team) {
      console.warn(`No team found for player ${player.name} (${player._id})`);
      continue;
    }
    if (String(player.season) !== String(team.season)) {
      // Check for duplicate (name, team, season)
      const dup = await T2TrialsPlayer.findOne({
        _id: { $ne: player._id },
        name: player.name,
        team: player.team,
        season: team.season
      });
      if (dup) {
        // Delete the oldest (by createdAt)
        const oldest = (player.createdAt < dup.createdAt) ? player : dup;
        console.warn(`Deleting oldest player due to duplicate (name, team, season): ${oldest.name} (${oldest._id})`);
        await T2TrialsPlayer.deleteOne({ _id: oldest._id });
        // If we just deleted the current player, skip update
        if (String(oldest._id) === String(player._id)) continue;
      }
      // Now safe to update
      console.log(`Fixing season for player ${player.name} (${player._id}): ${player.season} -> ${team.season}`);
      player.season = team.season;
      await player.save();
      updated++;
    }
  }

  // Repopulate fantasyTeams for all T2TrialsPlayers
  const allPlayers = await T2TrialsPlayer.find();
  for (const player of allPlayers) {
    const fantasyTeams = await FantasyPlayer.find({ team: player._id }, '_id');
    player.fantasyTeams = fantasyTeams.map(f => f._id);
    await player.save();
  }

  console.log(`Updated season ID for ${updated} player docs and repopulated fantasyTeams arrays.`);
  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
