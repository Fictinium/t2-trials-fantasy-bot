import mongoose from 'mongoose';

const performanceSchema = new mongoose.Schema({
  week: { type: Number, required: true, min: 1 },
  wins: { type: Number, default: 0, min: 0 },
  losses: { type: Number, default: 0, min: 0 }
}, { _id: false });

const t2TrialsPlayerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  team: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
  cost: { type: Number, required: true, min: 0 },
  performance: { type: [performanceSchema], default: [] }
}, { timestamps: true, strict: true });

// Compound uniqueness constraint for repeated names accross teams:
t2TrialsPlayerSchema.index({ name: 1, team: 1 }, { unique: true });

export default mongoose.model('T2TrialsPlayer', t2TrialsPlayerSchema);