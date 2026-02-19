// Script: scripts/fixRealPlayersForFantasyTeams.js
// Purpose: Ensure every real player referenced in fantasy teams matches the notepad (name, cost, team)
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
  const teamMap = new Map(); // teamName -> { name, players: [{ name, cost }] }
  let currentTeam = null;
  for (const line of notepad.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const teamMatch = line.match(/^(.+?):$/); // Team line: 'TeamName:'
    if (teamMatch) {
      currentTeam = teamMatch[1].trim();
      teamMap.set(currentTeam, { name: currentTeam, players: [] });
      continue;
    }
    // Player line: 'PlayerName - Cost'
    const playerMatch = line.match(/^(.+?)\s*-\s*(\d+)/);
    if (playerMatch && currentTeam) {
      teamMap.get(currentTeam).players.push({
        name: playerMatch[1].trim(),
        cost: Number(playerMatch[2])
      });
    }
  }
  return teamMap;
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  const teamMap = parseNotepad();

  // Get all fantasy player teams (array of player IDs)
  const fantasyPlayers = await FantasyPlayer.find({}, 'team').lean();
  const referencedPlayerIds = new Set();
  for (const fp of fantasyPlayers) {
    for (const pid of fp.team) referencedPlayerIds.add(pid.toString());
  }

  // For each referenced player ID, update their name, cost, and team to match notepad
  for (const pid of referencedPlayerIds) {
    const realPlayer = await T2TrialsPlayer.findById(pid);
    if (!realPlayer) {
      console.warn(`⚠️ Fantasy team references missing real player ID: ${pid}`);
      continue;
    }
    let found = false;
    for (const [teamName, teamObj] of teamMap.entries()) {
      for (const p of teamObj.players) {
        if (p.name.toLowerCase() === realPlayer.name.toLowerCase()) {
          // Find or create correct team
          let teamDoc = await Team.findOne({ name: teamName });
          if (!teamDoc) {
            teamDoc = await Team.create({ name: teamName, players: [] });
            console.log(`Created missing team: ${teamName}`);
          }
          // Check for duplicate (same name, same team, different _id)
          const duplicate = await T2TrialsPlayer.findOne({ name: p.name, team: teamDoc._id, _id: { $ne: realPlayer._id } });
          if (duplicate) {
            // Merge: reassign all fantasy team references to realPlayer, then delete duplicate
            await FantasyPlayer.updateMany(
              { team: duplicate._id },
              { $set: { "team.$[elem]": realPlayer._id } },
              { arrayFilters: [{ "elem": duplicate._id }] }
            );
            await T2TrialsPlayer.deleteOne({ _id: duplicate._id });
            console.log(`Merged duplicate player '${p.name}' in team '${teamName}' (kept ID: ${realPlayer._id}, deleted ID: ${duplicate._id})`);
          }
          // Update real player info
          realPlayer.name = p.name;
          realPlayer.cost = p.cost;
          realPlayer.team = teamDoc._id;
          await realPlayer.save();
          found = true;
          break;
        }
      }
      if (found) break;
    }
    if (!found) {
      console.warn(`⚠️ Could not match real player '${realPlayer.name}' (ID: ${pid}) to notepad. Manual review needed.`);
    }
  }

  console.log('Done fixing real players for fantasy teams.');
  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
