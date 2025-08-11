import mongoose from 'mongoose';

const teamSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, index: true },
  players: [{ type: mongoose.Schema.Types.ObjectId, ref: 'T2TrialsPlayer', default: [] }],
}, { timestamps: true, strict: true });

export default mongoose.model('Team', teamSchema);