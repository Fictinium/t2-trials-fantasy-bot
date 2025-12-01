/* Read-only checks:
   - t2trialsplayers (externalId + season; allows null/empty externalId)
   - fantasyplayers (discordId + season)
   - teams (name + season)

   Usage (from project root):
     1) Ensure MONGO_URI is set in environment or .env
     2) node .\scripts\check-db-against-models.js
*/
try { await import('dotenv').then(m => m.config?.() ?? m.default?.config?.()); } catch (e) { /* optional */ }

import { MongoClient } from 'mongodb';

const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!uri) {
  console.error('Set MONGO_URI (or MONGODB_URI) in environment or add .env and re-run.');
  process.exit(1);
}

const CHECKS = [
  { col: 't2trialsplayers', keys: ['externalId', 'season'], allowNullExternalId: true },
  { col: 'fantasyplayers', keys: ['discordId', 'season'], allowNullExternalId: false },
  { col: 'teams', keys: ['name', 'season'], allowNullExternalId: false },
];

function makeGroupId(keys) {
  return keys.reduce((acc, k) => { acc[k] = `$${k}`; return acc; }, {});
}

function indexMatchesKey(indexKey, keys) {
  const indexFields = Object.keys(indexKey);
  if (indexFields.length !== keys.length) return false;
  return keys.every(k => indexKey[k] === 1);
}

async function findDuplicates(db, colName, keys, options = {}) {
  const col = db.collection(colName);
  const match = {};
  if (options.allowNullExternalId && keys.includes('externalId')) {
    match.externalId = { $exists: true, $type: 'string', $gt: '' };
  }
  const pipeline = [
    ...(Object.keys(match).length ? [{ $match: match }] : []),
    { $group: { _id: makeGroupId(keys), count: { $sum: 1 }, ids: { $push: '$_id' } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 50 }
  ];
  return col.aggregate(pipeline).toArray();
}

const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
try {
  await client.connect();
  const db = client.db();
  for (const check of CHECKS) {
    console.log(`\n=== Collection: ${check.col} ===`);
    const col = db.collection(check.col);
    let indexes = [];
    try {
      indexes = await col.indexes();
    } catch (e) {
      console.error('Failed to list indexes for', check.col, e.message);
      continue;
    }
    console.log('Indexes found (name / key / unique / partial):');
    indexes.forEach(i => console.log(`  - ${i.name} / ${JSON.stringify(i.key)} / unique:${!!i.unique} / partial:${i.partialFilterExpression ? JSON.stringify(i.partialFilterExpression) : false}`));

    const found = indexes.find(i => i.unique && indexMatchesKey(i.key, check.keys));
    if (found) {
      console.log('-> Matching unique index exists:', found.name, found.partialFilterExpression ? ' (partial)' : '');
    } else {
      console.warn('-> No matching unique index found for keys:', check.keys.join(', '));
    }

    const dups = await findDuplicates(db, check.col, check.keys, check);
    if (dups.length) {
      console.warn(`-> Duplicates found that would block a unique index for ${check.keys.join(', ')} (sample ${dups.length}):`);
      dups.forEach(d => console.warn('   ', JSON.stringify(d._id), 'count:', d.count, 'ids:', d.ids.slice(0,5)));
    } else {
      console.log('-> No duplicates found for keys:', check.keys.join(', '));
    }
  }
} catch (err) {
  console.error('Fatal error:', err.message || err);
} finally {
  await client.close();
}