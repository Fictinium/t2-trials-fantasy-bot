// Script: scripts/findExtraTeams.js
// Purpose: Identify extra teams in the S2 database that are not present in the authoritative notepad
import mongoose from 'mongoose';
import Team from '../models/Team.js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const NOTEPAD_PATH = path.resolve(__dirname, '../player scores.txt');

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  const allTeams = await Team.find().lean();
  const dbTeamNames = new Set(allTeams.map(t => t.name.trim()));

  // Parse notepad for team names
  const notepad = fs.readFileSync(NOTEPAD_PATH, 'utf-8');
  const notepadTeamNames = new Set();
  for (const line of notepad.split(/\r?\n/)) {
    const match = line.match(/^(.+?):/); // Team name before colon
    if (match) notepadTeamNames.add(match[1].trim());
  }

  // Find extra teams in DB
  const extraTeams = allTeams.filter(t => !notepadTeamNames.has(t.name.trim()));
  if (extraTeams.length === 0) {
    console.log('No extra teams found.');
  } else {
    console.log('Extra teams in S2 DB (not in notepad):');
    for (const t of extraTeams) {
      console.log(`- ${t.name} (ID: ${t._id})`);
    }
  }
  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
