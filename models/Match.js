import mongoose from 'mongoose';

// Each game is a single duel between two players
const gameSchema = new mongoose.Schema({
  gameNumber: { type: Number, required: true, min: 1, max: 3 },
  playerA: { type: mongoose.Schema.Types.ObjectId, ref: 'T2TrialsPlayer', required: true },
  playerB: { type: mongoose.Schema.Types.ObjectId, ref: 'T2TrialsPlayer', required: true },
  winner: { type: String, enum: ['A', 'B', 'None'], default: 'None' }
}, { _id: false });

// Each round is a group of 3 games
const roundSchema = new mongoose.Schema({
  roundNumber: { type: Number, required: true, min: 1 },
  games: { type: [gameSchema], default: [] },
  winner: { type: String, enum: ['A', 'B', 'None'], default: 'None' }
}, { _id: false });

// Each set is a group of rounds (usually 2-3 rounds per set)
const setSchema = new mongoose.Schema({
  setNumber: { type: Number, required: true, min: 1 },
  rounds: { type: [roundSchema], default: [] },
  winner: { type: String, enum: ['A', 'B', 'None'], default: 'None' }
}, { _id: false });

const playerResultSchema = new mongoose.Schema({
  player: { type: mongoose.Schema.Types.ObjectId, ref: 'T2TrialsPlayer', required: true },
  wins: { type: Number, default: 0, min: 0 },
  losses: { type: Number, default: 0, min: 0 }
}, { _id: false });

const matchSchema = new mongoose.Schema({
  week: { type: Number, required: true, min: 1, index: true },
  teamA: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
  teamB: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
  sets: { type: [setSchema], default: [] },
  winner: { type: String, enum: ['A', 'B', 'None'], default: 'None' }, // overall match winner
  playersResults: { type: [playerResultSchema], default: [] },
  season: { type: mongoose.Schema.Types.ObjectId, ref: 'Season', required: true, index: true }
}, { timestamps: true, strict: true });

// Example: one match per week per pair of teams
matchSchema.index({ week: 1, teamA: 1, teamB: 1 }, { unique: true });

export default mongoose.model('Match', matchSchema);