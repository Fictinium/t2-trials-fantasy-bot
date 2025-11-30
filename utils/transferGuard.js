import { getActiveSeason } from '../utils/getActiveSeason.js';
import FantasyConfig from '../models/FantasyConfig.js';
import FantasyPlayer from '../models/FantasyPlayer.js';

export async function canModifyTeam(discordId, proposedTeamIds /* array of ObjectId|string */) {
  const season = await getActiveSeason();
  if (!season) {
    return interaction.reply({ content: '❌ No active season set.', flags: 64 });
  }

  const cfg = await FantasyConfig.findOne({season: season._id}).lean();
  const user = await FantasyPlayer.findOne({ discordId, season: season._id }, { playoffSnapshot: 1 }).lean();

  const phase = cfg?.phase ?? 'PRESEASON';
  if (phase === 'PRESEASON') return { allowed: true, reason: 'PRESEASON' };
  if (phase === 'SWISS')  return { allowed: false, reason: 'SWISS_LOCKED' };
  if (phase === 'PLAYOFFS_LOCKED' || phase === 'SEASON_ENDED') {
    return { allowed: false, reason: 'PLAYOFFS_LOCKED' };
  }

  // PLAYOFFS_OPEN:
  const limit = cfg?.playoffSwapLimit ?? 2;
  const snap = (user?.playoffSnapshot || []).map(String);
  const proposed = (proposedTeamIds || []).map(String);

  // Count swaps = how many snapshot players are missing in proposed
  let swaps = 0;
  for (const id of snap) {
    if (!proposed.includes(id)) swaps++;
  }

  // NOTE: with fixed team size, "swaps" equals the number of replacements.
  // e.g., replace 2 players -> 2 snapshot players missing -> swaps = 2.

  if (swaps <= limit) {
    return { allowed: true, reason: 'PLAYOFFS_OK', swapsUsed: swaps, limit };
  } else {
    return { allowed: false, reason: 'PLAYOFFS_LIMIT', swapsUsed: swaps, limit };
  }
}
