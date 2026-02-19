// Script: scripts/fixPlayersWithSameNameWrongTeam.js
// Purpose: For each player name in the notepad, ensure only the correct team (per notepad) exists for S2. If a player with the same name exists on the wrong team:
// - Move any fantasy team references to the correct player ID
// - Delete the wrong player
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

// Parse notepad for authoritative player and team data
function parseNotepad() {
  const notepad = fs.readFileSync(NOTEPAD_PATH, 'utf-8');
  const playerToTeam = new Map(); // name (lowercase) -> team name
  let currentTeam = null;
  for (const line of notepad.split(/\r?\n/)) {
    const teamMatch = line.match(/^(.+?):$/); // Team line: 'TeamName:'
    if (teamMatch) {
      currentTeam = teamMatch[1].trim();
      continue;
    }
    const playerMatch = line.match(/^(.+?)\s*-\s*(\d+)/);
    if (playerMatch && currentTeam) {
      playerToTeam.set(playerMatch[1].trim().toLowerCase(), currentTeam);
    }
  }
  return playerToTeam;
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  const playerToTeam = parseNotepad();

  for (const [playerNameLower, correctTeamName] of playerToTeam.entries()) {
    // Find all real players with this name
    const realPlayers = await T2TrialsPlayer.find({ name: new RegExp(`^${playerNameLower}$`, 'i') }).populate('team');
    if (realPlayers.length <= 1) continue; // No duplicates
    // Find the correct player (on the correct team)
    const correctPlayer = realPlayers.find(p => p.team && p.team.name === correctTeamName);
    if (!correctPlayer) {
      console.warn(`⚠️ No player '${playerNameLower}' found on correct team '${correctTeamName}'. Manual review needed.`);
      continue;
    }
    // For all other players with this name (wrong team):
    for (const wrongPlayer of realPlayers) {
      if (wrongPlayer._id.equals(correctPlayer._id)) continue;
      // Move all fantasy team references to correctPlayer
      const updated = await FantasyPlayer.updateMany(
        { team: wrongPlayer._id },
        { $set: { "team.$[elem]": correctPlayer._id } },
        { arrayFilters: [{ "elem": wrongPlayer._id }] }
      );
      // Delete the wrong player
      await T2TrialsPlayer.deleteOne({ _id: wrongPlayer._id });
      console.log(`Moved fantasy references and deleted player '${wrongPlayer.name}' (ID: ${wrongPlayer._id}) from team '${wrongPlayer.team?.name || wrongPlayer.team}' (should be '${correctTeamName}').`);
    }
  }
  await mongoose.disconnect();
  console.log('Done fixing players with same name on wrong team.');
}

main().catch(e => { console.error(e); process.exit(1); });
