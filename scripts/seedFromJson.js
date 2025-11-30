import { getActiveSeason } from '../utils/getActiveSeason.js';
import fs from 'fs/promises';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Team from '../models/Team.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';

dotenv.config();

const filePath = process.argv[2]; // e.g., node scripts/seedFromJson.js ./data/seed.json
if (!filePath) {
  console.error('Usage: node scripts/seedFromJson.js <path-to-json>');
  process.exit(1);
}

const mongoUri = process.env.MONGO_URI;

async function main() {
  await mongoose.connect(mongoUri);
  console.log('Connected to DB');

  const raw = await fs.readFile(filePath, 'utf-8');
  const payload = JSON.parse(raw);

  if (!Array.isArray(payload)) {
    throw new Error('❌ Expected JSON root to be an array of players.');
  }

  const season = await getActiveSeason();
  if (!season) {
    return interaction.reply({ content: '❌ No active season set.', flags: 64 });
  }

  // Clear old data
  await Team.deleteMany({season: season._id});
  await T2TrialsPlayer.deleteMany({season: season._id});

  // 1) Collect unique teams
  const teamMap = new Map();
  for (const p of payload) {
    if (!p.team_name) {
      console.warn(`⚠️ Player "${p.name}" has no team_name`);
      continue;
    }
    if (!teamMap.has(p.team_name)) {
      teamMap.set(p.team_name, { name: p.team_name, players: [] });
    }
  }

  const createdTeams = await Team.insertMany([...teamMap.values()]);
  const byName = new Map(createdTeams.map(t => [t.name, t]));

  // 2) Insert players
  const playerDocs = [];
  for (const p of payload) {
    const teamDoc = byName.get(p.team_name);
    if (!teamDoc) {
      console.warn(`⚠️ Skipping player "${p.name}" — unknown team "${p.team_name}"`);
      continue;
    }
    const playerDoc = await T2TrialsPlayer.create({
      name: p.name,
      season: season._id,
      team: teamDoc._id,
      cost: Number(p.fantasy_points) || 0,
      performance: [],
      externalId: Number(p.id) || undefined // optional, helps future matching
    });
    playerDocs.push(playerDoc);
    teamDoc.players.push(playerDoc._id);
  }

  // 3) Update teams with player IDs
  for (const team of createdTeams) {
    await Team.updateOne(
      { _id: team._id },
      { $set: { players: team.players } }
    );
  }

  console.log(`✅ Seed complete: ${createdTeams.length} teams, ${playerDocs.length} players`);
  await mongoose.disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});