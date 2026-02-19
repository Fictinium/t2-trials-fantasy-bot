// Script: addMissingExternalIds.js
// Adds a unique externalId to any T2TrialsPlayer missing one.
import mongoose from 'mongoose';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  // Use MONGO_URI for consistency with the rest of the project
  await mongoose.connect(process.env.MONGO_URI);
  const players = await T2TrialsPlayer.find({ $or: [ { externalId: { $exists: false } }, { externalId: null } ] });
  if (!players.length) {
    console.log('✅ All players already have externalId.');
    await mongoose.disconnect();
    return;
  }

  // Gather all used externalIds (as strings)
  const used = new Set((await T2TrialsPlayer.find({}, 'externalId')).map(p => String(p.externalId)));
  let nextId = 100000; // Start from a high number to avoid collision with any legacy IDs

  for (const player of players) {
    // Find next unused ID
    while (used.has(String(nextId))) nextId++;
    player.externalId = String(nextId);
    used.add(String(nextId));
    await player.save();
    console.log(`Assigned externalId ${nextId} to player ${player.name} (${player._id})`);
    nextId++;
  }

  console.log('✅ Done assigning externalIds.');
  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
