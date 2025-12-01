import cron from 'node-cron';
import FantasyConfig from '../models/FantasyConfig.js';
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
      const season = await getActiveSeason();
      if (!season) {
        console.warn('[weeklyImport] No active season. Skipping.');
        return;
      }

      const url = process.env.STATS_URL;
      if (!url) {
        console.warn('[weeklyImport] STATS_URL not set');
        return;
      }

      // Load or create season config
      let cfg = await FantasyConfig.findOne({ season: season._id });
      if (!cfg) {
        cfg = await FantasyConfig.create({
          season: season._id,
          seasonName: season.name,
          currentWeek: 1
        });
      }

      const week = cfg.currentWeek;

      console.log(`[weeklyImport] start season=${season.name} week=${week}`);

      // 1) import stats FOR THIS SEASON
      const importRes = await importStatsFromUrl(url, season._id);
      console.log('[weeklyImport] import result:', importRes);

      // 2) calculate scores FOR THIS SEASON AND WEEK
      const updated = await calculateScoresForWeek(season._id, week);
      console.log(`[weeklyImport] calculated week ${week} for ${updated} fantasy players`);

      // 3) advance pointer
      cfg.currentWeek = week + 1;
      await cfg.save();

      console.log('[weeklyImport] done');
    } catch (err) {
      console.error('[weeklyImport] error:', err);
    }
  }, { timezone: tz });
}