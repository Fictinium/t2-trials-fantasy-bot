import FantasyPlayer from '../models/FantasyPlayer.js';

export default async function isRegistered(discordId) {
  return FantasyPlayer.findOne({ discordId });
}