// Script: scripts/addMissingPlayersFromNotepad.js
// Purpose: For each player in the notepad, if not present in the database (by name+team), create them with the correct cost and team.
import mongoose from 'mongoose';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';
import Team from '../models/Team.js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import getActiveSeason from '../utils/getActiveSeason.js';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const NOTEPAD_PATH = path.resolve(__dirname, '../player scores.txt');

// Parse notepad for all players and their teams/costs
function parseNotepad() {
  const notepad = fs.readFileSync(NOTEPAD_PATH, 'utf-8');
  const players = []; // { name, teamName, cost }
  let currentTeam = null;
  for (const line of notepad.split(/\r?\n/)) {
    const teamMatch = line.match(/^(.+?):$/); // Team line: 'TeamName:'
    if (teamMatch) {
      currentTeam = teamMatch[1].trim();
      continue;
    }
    const playerMatch = line.match(/^(.+?)\s*-\s*(\d+)/);
    if (playerMatch && currentTeam) {
      players.push({
        name: playerMatch[1].trim(),
        teamName: currentTeam,
        cost: Number(playerMatch[2])
      });
    }
  }
  return players;
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  const players = parseNotepad();
  // Fetch the active season (required for team creation)
  const season = await getActiveSeason();
  if (!season) {
    console.error('No active season set. Aborting.');
    process.exit(1);
  }
  let createdCount = 0;
  for (const { name, teamName, cost } of players) {
    // Find or create the team for this season
    let teamDoc = await Team.findOne({ name: teamName, season: season._id });
    if (!teamDoc) {
      teamDoc = await Team.create({ name: teamName, season: season._id, players: [] });
      console.log(`Created missing team: ${teamName}`);
    }
    // Check if player already exists (by name+team)
    const exists = await T2TrialsPlayer.findOne({ name, team: teamDoc._id });
    if (exists) continue;
    // Create the player
    await T2TrialsPlayer.create({
      name,
      team: teamDoc._id,
      cost,
      performance: [],
      season: season._id
    });
    createdCount++;
    console.log(`Created missing player '${name}' in team '${teamName}' (cost: ${cost}).`);
  }
  console.log(`Created ${createdCount} missing players from notepad.`);
  await mongoose.disconnect();
  console.log('Done adding missing players.');
}

main().catch(e => { console.error(e); process.exit(1); });
