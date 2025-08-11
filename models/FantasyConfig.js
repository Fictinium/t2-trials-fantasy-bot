import mongoose from 'mongoose';

const fantasyConfigSchema = new mongoose.Schema({
  seasonName: { type: String, default: 'S1' },
  phase: { type: String, enum: ['PRESEASON', 'SWISS', 'PLAYOFFS_OPEN', 'PLAYOFFS_LOCKED', 'SEASON_ENDED'], default: 'PRESEASON' },

  // how many swaps are allowed in PLAYOFFS (replacements vs snapshot)
  playoffSwapLimit: { type: Number, default: 2, min: 0 },

  // optional: keep track of current week
  currentWeek: { type: Number, default: 1, min: 1 }

  // Optional: if you ever want to auto-lock by time, you can use these later:
  // transferWindowOpenAt: { type: Date },
  // transferWindowCloseAt: { type: Date }
}, { timestamps: true, strict: true });

export default mongoose.model('FantasyConfig', fantasyConfigSchema);
