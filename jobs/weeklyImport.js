import cron from 'node-cron';
import FantasyConfig from '../models/FantasyConfig.js';
import { importStatsFromUrl } from '../services/importer.js';
import { calculateScoresForWeek } from '../services/scoring.js';

export function startWeeklyJob() {
  const expr = process.env.CRON_EXPR || '0 16 * * 1'; // default: Mon 16:00 UTC
  const tz = process.env.CRON_TZ || 'UTC';

  cron.schedule(expr, async () => {
    try {
      const url = process.env.STATS_URL;
      if (!url) return console.warn('[weeklyImport] STATS_URL not set');

      // ensure config exists
      let cfg = await FantasyConfig.findOne();
      if (!cfg) cfg = await FantasyConfig.create({});

      const week = cfg.currentWeek;
      console.log(`[weeklyImport] Running for week ${week} (${new Date().toISOString()})`);

      // 1) import stats (all players, all weeks present in file)
      const res = await importStatsFromUrl(url);
      console.log(`[weeklyImport] import:`, res);

      // 2) calculate this week's scores
      const updated = await calculateScoresForWeek(week);
      console.log(`[weeklyImport] calculated week ${week} for ${updated} fantasy players`);

      // 3) advance pointer to next week
      cfg.currentWeek = week + 1;
      await cfg.save();

    } catch (err) {
      console.error('[weeklyImport] error:', err);
    }
  }, { timezone: tz });
}