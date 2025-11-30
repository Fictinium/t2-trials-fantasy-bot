import Season from '../models/Season.js';

export default async function getActiveSeason() {
  return Season.findOne({ isActive: true });
}