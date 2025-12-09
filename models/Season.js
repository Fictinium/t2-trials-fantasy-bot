import mongoose from 'mongoose';

const seasonSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  maxTeamSize: { type: Number, default: 7 },
  isActive: { type: Boolean, default: false },

  // optional metadata
  startDate: { type: Date },
  endDate: { type: Date }
}, { timestamps: true });

export default mongoose.model('Season', seasonSchema);