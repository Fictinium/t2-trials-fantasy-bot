import mongoose from 'mongoose';

const roundPerformanceSchema = new mongoose.Schema({
  roundNumber: { type: Number, required: true, min: 1, max: 3 },
  wins: { type: Number, default: 0, min: 0 },
  losses: { type: Number, default: 0, min: 0 },
  duels: { type: Number, default: 0, min: 0 }
}, { _id: false });

const performanceSchema = new mongoose.Schema({
  week: { type: Number, required: true, min: 1 },
  wins: { type: Number, default: 0, min: 0 },  // total across all rounds
  losses: { type: Number, default: 0, min: 0 },
  rounds: { type: [roundPerformanceSchema], default: [] } // per-round breakdown
}, { _id: false });

const t2TrialsPlayerSchema = new mongoose.Schema({
  externalId: { type: Number, index: true, unique: true, sparse: true }, // website ID
  name: { type: String, required: true },
  team: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
  cost: { type: Number, required: true, min: 0 },
  season: { type: mongoose.Schema.Types.ObjectId, ref: 'Season', required: true, index: true },
  performance: { type: [performanceSchema], default: [] }
}, { timestamps: true, strict: true });

// Compound uniqueness constraint for repeated names across teams:
t2TrialsPlayerSchema.index({ name: 1, team: 1 }, { unique: true });

export default mongoose.model('T2TrialsPlayer', t2TrialsPlayerSchema);