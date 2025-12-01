import cron from 'node-cron';
import FantasyConfig from '../models/FantasyConfig.js';
import Team from '../models/Team.js';
import FantasyPlayer from '../models/FantasyPlayer.js';
import { importStatsFromUrl } from '../services/importer.js';
import { calculateScoresForWeek } from '../services/scoring.js';
import getActiveSeason from '../utils/getActiveSeason.js';

export function startWeeklyJob() {
  if (process.env.JOBS_ENABLED !== '1') {
    console.log('[weeklyImport] skipped (JOBS_ENABLED != 1)');
    return;
  }

  const expr = process.env.CRON_EXPR || '0 16 * * 1';
  const tz = process.env.CRON_TZ || 'Europe/Lisbon';

  cron.schedule(expr, async () => {
    try {
      // run weekly job and advance pointer for scheduled runs
      await runWeeklyImportOnce({ fullRecalc: false, advancePointer: true });
    } catch (err) {
      console.error('[weeklyImport] error:', err);
    }
  }, { timezone: tz });
}

export async function runWeeklyImportOnce({ fullRecalc = false, advancePointer = false } = {}) {
  const url = process.env.STATS_URL;
  if (!url) return { error: 'STATS_URL not set' };

  const season = await getActiveSeason();
  if (!season) return { error: 'No active season' };

  // find or create config for the active season
  let cfg = await FantasyConfig.findOne({ season: season._id });
  if (!cfg) {
    cfg = await FantasyConfig.create({
      season: season._id,
      seasonName: season.name,
      currentWeek: 1
    });
  }

  const week = cfg.currentWeek;
  console.log(`[manualImport] season=${season.name} fullRecalc=${fullRecalc} advancePointer=${advancePointer}`);

  // 1) import stats FOR THIS SEASON
  const importRes = await importStatsFromUrl(url, season._id);

  // 2) calculate scores
  if (fullRecalc) {
    // compute maximum week that actually has data (teams' performance arrays or fantasyPlayers' weeklyPoints)
    const teamAgg = await Team.aggregate([
      { $match: { season: season._id } },
      { $project: { perfSize: { $size: { $ifNull: ['$performance', []] } } } },
      { $group: { _id: null, maxPerfSize: { $max: '$perfSize' } } }
    ]);
    const maxFromTeams = teamAgg?.[0]?.maxPerfSize || 0;

    const fpAgg = await FantasyPlayer.aggregate([
      { $match: { season: season._id } },
      { $project: { wpSize: { $size: { $ifNull: ['$weeklyPoints', []] } } } },
      { $group: { _id: null, maxWpSize: { $max: '$wpSize' } } }
    ]);
    const maxFromFP = fpAgg?.[0]?.maxWpSize || 0;

    const toWeek = Math.max(1, maxFromTeams, maxFromFP);
    console.log(`[manualImport] fullRecalc determined toWeek=${toWeek} (teamMax=${maxFromTeams} fpMax=${maxFromFP} pointerWeek=${week})`);

    let totalUpdated = 0;
    for (let w = 1; w <= toWeek; w++) {
      const updated = await calculateScoresForWeek(season._id, w);
      console.log(`[manualImport] recalculated week ${w} updated ${updated}`);
      if (typeof updated === 'number') totalUpdated += updated;
    }

    if (advancePointer) {
      cfg.currentWeek = week + 1;
      await cfg.save();
    }
    return { importRes, recalculatedWeeks: toWeek, totalUpdated, season: season._id };
  }
}