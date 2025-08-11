import FantasyPlayer from '../models/FantasyPlayer.js';

export default async function isRegistered(discordId) {
  return !!(await FantasyPlayer.exists({ discordId }));
}