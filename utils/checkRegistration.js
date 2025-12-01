import getActiveSeason from '../utils/getActiveSeason.js';
import FantasyPlayer from '../models/FantasyPlayer.js';

export default async function isRegistered(discordId) {
  const season = await getActiveSeason();
  if (!season) return false;
  
  return !!(await FantasyPlayer.exists({ discordId, season: season._id }));
}