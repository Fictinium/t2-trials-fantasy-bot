// Script: scripts/cleanupFantasyAndRealPlayers.js
// Purpose: 1) Remove fantasy team references to missing real players; 2) Delete real players not in the notepad
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

  // 1. Remove fantasy team references to missing real players
  const allRealPlayers = await T2TrialsPlayer.find({}, '_id').lean();
  const validPlayerIds = new Set(allRealPlayers.map(p => p._id.toString()));
  const fantasyPlayers = await FantasyPlayer.find();
  let cleanedCount = 0;
  for (const fp of fantasyPlayers) {
    const original = fp.team.map(id => id.toString());
    const cleaned = original.filter(id => validPlayerIds.has(id));
    if (cleaned.length !== original.length) {
      fp.team = cleaned;
      await fp.save();
      cleanedCount++;
      console.log(`Cleaned team for fantasy player ${fp.username || fp.discordId}`);
    }
  }
  console.log(`Cleaned ${cleanedCount} fantasy teams.`);

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
  console.log('Cleanup complete.');
}

main().catch(e => { console.error(e); process.exit(1); });
