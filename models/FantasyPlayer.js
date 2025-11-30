import mongoose from 'mongoose';

const fantasyPlayerSchema = new mongoose.Schema({
  discordId: { type: String, required: true, unique: true, index: true },
  username: { type: String, default: null },
  team: [{ type: mongoose.Schema.Types.ObjectId, ref: 'T2TrialsPlayer', default: [] }],
  weeklyPoints: { type: [Number], default: [] },
  totalPoints: { type: Number, default: 0, min: 0 },
  wallet: { type: Number, default: 85, min: 0 },
  season: { type: mongoose.Schema.Types.ObjectId, ref: 'Season', required: true, index: true },
  // snapshots for phase boundaries
  swissLockSnapshot: [{ type: mongoose.Schema.Types.ObjectId, ref: 'T2TrialsPlayer', default: [] }],
  playoffSnapshot: [{ type: mongoose.Schema.Types.ObjectId, ref: 'T2TrialsPlayer', default: [] }]
}, { timestamps: true, strict: true });

export default mongoose.model('FantasyPlayer', fantasyPlayerSchema);