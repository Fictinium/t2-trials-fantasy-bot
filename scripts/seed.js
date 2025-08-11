import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Team from '../models/Team.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';

dotenv.config();

const mongoUri = process.env.MONGO_URI;

async function seedDatabase() {
  await mongoose.connect(mongoUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  console.log('Connected to DB');

  // Dev reset
  await Team.deleteMany({});
  await T2TrialsPlayer.deleteMany({});

  // 1) Create teams
  const teamDocs = await Team.insertMany([
    { name: 'T2', players: [] },
    { name: 'TGC', players: [] },
  ]);
  console.log(`Inserted ${teamDocs.length} teams`);

  // Map for quick lookup
  const teamByName = new Map(teamDocs.map(t => [t.name, t]));

  // 2) Create players (must include required fields per schema)
  const playerSeed = [
    { name: 'Fict', team: teamByName.get('T2')._id, cost: 20, performance: [] },
    { name: 'Nici', team: teamByName.get('T2')._id, cost: 20, performance: [] },
    { name: 'Nick', team: teamByName.get('TGC')._id, cost: 20, performance: [] },
  ];

  // If you keep the compound unique index (name+team), duplicates will be rejected here
  const playerDocs = await T2TrialsPlayer.insertMany(playerSeed, { ordered: true });
  console.log(`Inserted ${playerDocs.length} league players`);

  // 3) Link players back to their teams (Team.players = [T2TrialsPlayer ids])
  const teamPlayers = new Map(); // teamId -> [playerIds]
  for (const p of playerDocs) {
    const teamId = p.team.toString();
    if (!teamPlayers.has(teamId)) teamPlayers.set(teamId, []);
    teamPlayers.get(teamId).push(p._id);
  }

  // 4) Bulk update teams with player IDs
  const ops = [];
  for (const [teamId, playerIds] of teamPlayers.entries()) {
    ops.push({
      updateOne: {
        filter: { _id: teamId },
        update: { $set: { players: playerIds } },
      }
    });
  }
  if (ops.length) await Team.bulkWrite(ops);
  console.log('Linked players to their teams');

  // 5) (Optional) sanity check
  const populated = await Team.find().populate('players').lean();
  console.log('Teams with players:', populated.map(t => ({
    name: t.name,
    players: t.players.map(p => p.name),
  })));

  await mongoose.disconnect();
  console.log('Seed complete. Disconnected.');
}

seedDatabase().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});
