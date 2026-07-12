import mongoose from 'mongoose';

const fantasyConfigSchema = new mongoose.Schema({
  seasonName: { type: String, default: 'S1' },
  phase: { type: String, enum: ['PRESEASON', 'SWISS', 'PLAYOFFS_OPEN', 'PLAYOFFS_LOCKED', 'SEASON_ENDED'], default: 'PRESEASON' },
  scoringMode: { type: String, enum: ['LEGACY_PHASE', 'WEEKLY_SNAPSHOT'], default: 'LEGACY_PHASE' },
  weeklyTransferPhase: { type: String, enum: ['OPEN', 'LOCKED'], default: 'OPEN' },
  season: { type: mongoose.Schema.Types.ObjectId, ref: 'Season', required: true, index: true },

  // how many swaps are allowed in PLAYOFFS (replacements vs snapshot)
  playoffSwapLimit: { type: Number, default: 3, min: 0 },

  // optional: keep track of current week
  currentWeek: { type: Number, default: 1, min: 1 },

  // max wallet baseline for this season (used for joins and season-wide wallet cap changes)
  maxWallet: { type: Number, default: 110, min: 0 },

  // legacy mode pick history used by /mostpickedplayers
  legacyPickStats: {
    cumulativeCounts: { type: Map, of: Number, default: {} },
    pendingClosedSnapshot: {
      phase: { type: String, default: null },
      counts: { type: Map, of: Number, default: {} },
      teamHash: { type: String, default: null },
      capturedAt: { type: Date, default: null }
    }
  },

  // weekly mode pick history used by /mostpickedplayers
  weeklyPickStats: {
    weekSnapshots: [{
      week: { type: Number, required: true, min: 1 },
      counts: { type: Map, of: Number, default: {} },
      teamHash: { type: String, default: null },
      capturedAt: { type: Date, default: null }
    }]
  }

  // Optional: if you ever want to auto-lock by time, you can use these later:
  // transferWindowOpenAt: { type: Date },
  // transferWindowCloseAt: { type: Date }
}, { timestamps: true, strict: true });

export default mongoose.model('FantasyConfig', fantasyConfigSchema);