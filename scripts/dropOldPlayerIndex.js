// Script to drop the old {name, team} index and verify new indexes for T2TrialsPlayer
// Usage: node scripts/dropOldPlayerIndex.js

import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/test';
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const collection = db.collection('t2trialsplayers');

  try {
    // Drop the old index
    await collection.dropIndex({ name: 1, team: 1 });
    console.log('Dropped old {name, team} index.');
  } catch (err) {
    if (err.codeName === 'IndexNotFound') {
      console.log('Old index not found, nothing to drop.');
    } else {
      console.error('Error dropping index:', err);
    }
  }

  // List all indexes
  const indexes = await collection.indexes();
  console.log('Current indexes:');
  indexes.forEach(idx => console.log(idx));

  await mongoose.disconnect();
  console.log('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
