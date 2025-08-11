import cron from 'node-cron';
import FantasyConfig from '../models/FantasyConfig.js';
import { importStatsFromUrl } from '../services/importer.js';
import { calculateScoresForWeek } from '../services/scoring.js';

export function startWeeklyJob() {
  // Only run if explicitly enabled (avoid double-runs in dev/prod)
  if (process.env.JOBS_ENABLED !== '1') {
    console.log('[weeklyImport] skipped (JOBS_ENABLED != 1)');
    return;
  }

  // default: Monday 16:00 local Lisbon time. Adjust to taste.
  const expr = process.env.CRON_EXPR || '0 16 * * 1';
  const tz = process.env.CRON_TZ || 'Europe/Lisbon';

  cron.schedule(expr, async () => {
    try {
      const url = process.env.STATS_URL;
      if (!url) return console.warn('[weeklyImport] STATS_URL not set');

      let cfg = await FantasyConfig.findOne();
      if (!cfg) cfg = await FantasyConfig.create({});
      const week = cfg.currentWeek;

      console.log(`[weeklyImport] start week=${week} at ${new Date().toISOString()}`);

      // 1) import stats
      const importRes = await importStatsFromUrl(url);
      console.log('[weeklyImport] import result:', importRes);

      // 2) calculate this week's scores (fantasy users)
      const updated = await calculateScoresForWeek(week);
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