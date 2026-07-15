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
const NOTEPAD_PATH = path.resolve(__dirname, '../player_costs.txt');
const DRY_RUN = process.argv.includes('--dry-run');

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
  if (!players.length) {
    console.log(`No players parsed from ${NOTEPAD_PATH}.`);
    await mongoose.disconnect();
    return;
  }

  let createdCount = 0;
  let updatedCostCount = 0;
  let skippedCount = 0;
  let createdTeams = 0;

  const teamCache = new Map();
  const getTeamDoc = async (teamName) => {
    const key = teamName.toLowerCase();
    if (teamCache.has(key)) return teamCache.get(key);

    let teamDoc = await Team.findOne({ name: teamName, season: season._id });
    if (!teamDoc) {
      if (!DRY_RUN) {
        teamDoc = await Team.create({ name: teamName, season: season._id, players: [] });
      } else {
        teamDoc = { _id: null, name: teamName, players: [] };
      }
      createdTeams++;
      console.log(`${DRY_RUN ? '[DRY] ' : ''}Created missing team: ${teamName}`);
    }

    teamCache.set(key, teamDoc);
    return teamDoc;
  };

  for (const { name, teamName, cost } of players) {
    const teamDoc = await getTeamDoc(teamName);

    // Check if player already exists in this season/team
    const existing = await T2TrialsPlayer.findOne({ name, team: teamDoc._id, season: season._id });
    if (existing) {
      if (Number(existing.cost) !== Number(cost)) {
        if (!DRY_RUN) {
          existing.cost = cost;
          await existing.save();
        }
        updatedCostCount++;
        console.log(`${DRY_RUN ? '[DRY] ' : ''}Updated cost for '${name}' in '${teamName}' to ${cost}.`);
      } else {
        skippedCount++;
      }

      // Ensure team.players includes the player
      if (teamDoc._id) {
        const hasInTeam = Array.isArray(teamDoc.players)
          && teamDoc.players.some(id => String(id) === String(existing._id));
        if (!hasInTeam && !DRY_RUN) {
          await Team.updateOne({ _id: teamDoc._id }, { $addToSet: { players: existing._id } });
        }
      }
      continue;
    }

    // Create the player
    let newPlayer = null;
    if (!DRY_RUN) {
      newPlayer = await T2TrialsPlayer.create({
        name,
        team: teamDoc._id,
        cost,
        performance: [],
        season: season._id
      });

      await Team.updateOne({ _id: teamDoc._id }, { $addToSet: { players: newPlayer._id } });
    }

    createdCount++;
    console.log(`${DRY_RUN ? '[DRY] ' : ''}Created missing player '${name}' in team '${teamName}' (cost: ${cost}).`);
  }

  console.log(
    `${DRY_RUN ? '[DRY] ' : ''}Summary:\n` +
    `• Source file: ${NOTEPAD_PATH}\n` +
    `• Season: ${season.name}\n` +
    `• Teams created: ${createdTeams}\n` +
    `• Players created: ${createdCount}\n` +
    `• Costs updated: ${updatedCostCount}\n` +
    `• Unchanged/skipped: ${skippedCount}`
  );

  await mongoose.disconnect();
  console.log(`${DRY_RUN ? '[DRY] ' : ''}Done adding missing players.`);
}

main().catch(e => { console.error(e); process.exit(1); });
