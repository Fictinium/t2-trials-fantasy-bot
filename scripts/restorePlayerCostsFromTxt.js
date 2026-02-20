// Script to restore player costs from player scores.txt
// Usage: node scripts/restorePlayerCostsFromTxt.js
// Reads player scores.txt and updates T2TrialsPlayer costs in the database

import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';
import Team from '../models/Team.js';
import dotenv from 'dotenv';
dotenv.config();

const SCORES_PATH = path.resolve('player scores.txt');
const MONGO_URI = process.env.MONGO_URI;

async function main() {
  await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  const lines = fs.readFileSync(SCORES_PATH, 'utf-8').split(/\r?\n/);
  let currentTeam = null;
  let updated = 0, notFound = 0;
  // Get active season
  const Season = (await import('../models/Season.js')).default;
  const activeSeason = await Season.findOne({ isActive: true });
  if (!activeSeason) {
    console.error('No active season found.');
    process.exit(1);
  }
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Team name: ends with :
    if (/^[^:]+:$/.test(trimmed)) {
      currentTeam = trimmed.replace(/:$/, '').trim();
      continue;
    }
    // Player line: Name - Cost
    const match = trimmed.match(/^(.+?)\s*-\s*(\d+)$/);
    if (match && currentTeam) {
      const playerName = match[1].trim();
      const cost = Number(match[2]);
      // Try to find player(s) by name only (case-insensitive, trimmed, active season only)
      const playerDocsByName = await T2TrialsPlayer.find({ name: { $regex: `^${playerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }, season: activeSeason._id });
      if (playerDocsByName.length === 1) {
        // Only one player with this name, update regardless of team
        const playerDoc = playerDocsByName[0];
        playerDoc.cost = cost;
        await playerDoc.save();
        updated++;
        console.log(`Updated: ${playerName} (team: ${currentTeam}, matched by name only) -> ${cost}`);
        continue;
      } else if (playerDocsByName.length > 1) {
        // Multiple players with this name, try to match by team (active season only)
        let teamDoc = await Team.findOne({ name: { $regex: `^${currentTeam.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }, season: activeSeason._id });
        if (!teamDoc) {
          // Try fuzzy/partial match if not found
          const teamDocs = await Team.find({ name: { $regex: currentTeam.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' }, season: activeSeason._id });
          if (teamDocs.length === 1) {
            teamDoc = teamDocs[0];
          } else {
            console.warn(`Team not found: ${currentTeam}`);
            notFound++;
            continue;
          }
        }
        // Find player with matching team id
        const playerDoc = playerDocsByName.find(p => p.team.toString() === teamDoc._id.toString());
        if (playerDoc) {
          playerDoc.cost = cost;
          await playerDoc.save();
          updated++;
          console.log(`Updated: ${playerName} (${currentTeam}) -> ${cost}`);
          continue;
        } else {
          console.warn(`Player not found: ${playerName} (team: ${currentTeam}) [multiple players with this name, no matching team]`);
          notFound++;
          continue;
        }
      } else {
        // No player found by name
        console.warn(`Player not found: ${playerName} (team: ${currentTeam}) [no player with this name]`);
        notFound++;
        continue;
      }
    }
  }
  console.log(`Done. Updated: ${updated}, Not found: ${notFound}`);
  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
