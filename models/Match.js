import mongoose from 'mongoose';

const roundSchema = new mongoose.Schema({
  roundNumber: { type: Number, required: true, min: 1 },
  type: { type: String, enum: ['best-of-9', 'best-of-3'], required: true },
  teamAWins: { type: Number, default: 0, min: 0, max: 5 },
  teamBWins: { type: Number, default: 0, min: 0, max: 5 },
  winner: { type: String, enum: ['A', 'B', 'None'], default: 'None' },
}, { _id: false });

const playerResultSchema = new mongoose.Schema({
  player: { type: mongoose.Schema.Types.ObjectId, ref: 'T2TrialsPlayer', required: true },
  wins: { type: Number, default: 0, min: 0, max: 7 },
  losses: { type: Number, default: 0, min: 0, max: 7 },
}, { _id: false });

const matchSchema = new mongoose.Schema({
  week: { type: Number, required: true, min: 1, index: true },
  teamA: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
  teamB: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
  rounds: { type: [roundSchema], default: [] },
  winner: { type: String, enum: ['A', 'B', 'None'], default: 'None' }, // overall match winner
  playersResults: { type: [playerResultSchema], default: [] },
}, { timestamps: true, strict: true });

// Example: one match per week per pair of teams
matchSchema.index({ week: 1, teamA: 1, teamB: 1 }, { unique: true });

export default mongoose.model('Match', matchSchema);