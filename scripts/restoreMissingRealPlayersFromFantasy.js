// Script: scripts/restoreMissingRealPlayersFromFantasy.js
// Purpose: For any player ID referenced in a fantasy team that does not exist in T2TrialsPlayer, create a new real player with that ID, name, and team from the fantasy team data. Also deletes real players not in the notepad.
import mongoose from 'mongoose';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';
import FantasyPlayer from '../models/FantasyPlayer.js';
import Team from '../models/Team.js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const NOTEPAD_PATH = path.resolve(__dirname, '../player scores.txt');

// Parse notepad for authoritative player names
function parseNotepad() {
  const notepad = fs.readFileSync(NOTEPAD_PATH, 'utf-8');
  const validNames = new Set();
  for (const line of notepad.split(/\r?\n/)) {
    const playerMatch = line.match(/^(.+?)\s*-\s*(\d+)/);
    if (playerMatch) {
      validNames.add(playerMatch[1].trim().toLowerCase());
    }
  }
  return validNames;
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  const validNames = parseNotepad();

  // 1. Restore missing real players from fantasy teams
  const allRealPlayers = await T2TrialsPlayer.find({}, '_id').lean();
  const realPlayerIds = new Set(allRealPlayers.map(p => p._id.toString()));
  const fantasyPlayers = await FantasyPlayer.find().populate({
    path: 'team',
    populate: { path: 'team', model: 'Team', select: 'name' }
  }).lean();
  let createdCount = 0;
  for (const fp of fantasyPlayers) {
    for (const player of fp.team) {
      const pid = player?._id?.toString() || player?.toString();
      if (!pid || realPlayerIds.has(pid)) continue;
      // Get name and team from fantasy team data
      const name = player?.name || 'Unknown';
      const teamName = player?.team?.name || 'Unknown Team';
      // Find or create the team
      let teamDoc = await Team.findOne({ name: teamName });
      if (!teamDoc) {
        teamDoc = await Team.create({ name: teamName, players: [] });
        console.log(`Created missing team: ${teamName}`);
      }
      // Create the real player
      await T2TrialsPlayer.create({
        _id: pid,
        name,
        team: teamDoc._id,
        cost: 0, // Set to 0, can be updated later if needed
        performance: [],
        season: teamDoc.season || undefined
      });
      createdCount++;
      realPlayerIds.add(pid);
      console.log(`Restored missing real player '${name}' (ID: ${pid}) in team '${teamName}'.`);
    }
  }
  console.log(`Restored ${createdCount} missing real players from fantasy teams.`);

  // 2. Delete real players not in the notepad
  const allPlayers = await T2TrialsPlayer.find();
  let deletedCount = 0;
  for (const player of allPlayers) {
    if (!validNames.has(player.name.toLowerCase())) {
      await T2TrialsPlayer.deleteOne({ _id: player._id });
      deletedCount++;
      console.log(`Deleted real player '${player.name}' (ID: ${player._id}) not in notepad.`);
    }
  }
  console.log(`Deleted ${deletedCount} real players not in notepad.`);

  await mongoose.disconnect();
  console.log('Cleanup and restore complete.');
}

main().catch(e => { console.error(e); process.exit(1); });
