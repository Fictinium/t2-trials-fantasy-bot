import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import getActiveSeason from '../utils/getActiveSeason.js';
import { calculateScoresForWeek } from '../services/scoring.js';
import { isAuthorizedForCommand } from '../utils/commandAuth.js';
import FantasyConfig from '../models/FantasyConfig.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';

function isClosedForScoring(cfg) {
  const scoringMode = cfg?.scoringMode ?? 'LEGACY_PHASE';
  if (scoringMode === 'WEEKLY_SNAPSHOT') {
    return (cfg?.weeklyTransferPhase ?? 'OPEN') === 'LOCKED';
  }

  const phase = cfg?.phase ?? 'PRESEASON';
  return phase === 'SWISS' || phase === 'PLAYOFFS_LOCKED' || phase === 'SEASON_ENDED';
}

async function hasImportedDataForWeek(seasonId, week) {
  const exists = await T2TrialsPlayer.exists({
    season: seasonId,
    performance: { $elemMatch: { week: Number(week) } }
  });
  return !!exists;
}

export default {
  data: new SlashCommandBuilder()
    .setName('calculatescores')
    .setDescription('Admin: calculate scores for a given week (or all up to that week)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption(opt =>
      opt.setName('week').setDescription('Week number to calculate').setMinValue(1).setRequired(true)
    )
    .addBooleanOption(opt =>
      opt.setName('all').setDescription('Calculate all weeks up to this one').setRequired(false)
    )
    .addBooleanOption(opt =>
      opt.setName('force').setDescription('Force recalculation even for already processed weeks').setRequired(false)
    ),

  async execute(interaction) {
    // allow Guild admins, OWNER_IDS, or roles listed in AUTHORIZATION_ROLE_IDS
    const allowed = await isAuthorizedForCommand(interaction, { allowedRoleEnvVar: 'AUTHORIZATION_ROLE_IDS', allowGuildAdmins: true });
    if (!allowed) {
      return interaction.reply({ content: '❌ You do not have permission to run this command.', flags: 64 });
    }

    const season = await getActiveSeason();
    if (!season) {
      return interaction.reply({ content: '❌ No active season set.', flags: 64 });
    }

    let cfg = await FantasyConfig.findOne({ season: season._id });
    if (!cfg) {
      cfg = await FantasyConfig.create({
        season: season._id,
        seasonName: season.name
      });
    }

    if (!isClosedForScoring(cfg)) {
      const scoringMode = cfg?.scoringMode ?? 'LEGACY_PHASE';
      if (scoringMode === 'WEEKLY_SNAPSHOT') {
        return interaction.reply({
          content: '❌ Cannot calculate scores while transfers are OPEN in WEEKLY_SNAPSHOT mode. Lock transfers first (`/setphase LOCKED`).',
          flags: 64
        });
      }
      return interaction.reply({
        content: `❌ Cannot calculate scores while legacy phase is **${cfg?.phase ?? 'PRESEASON'}**. Use a closed phase (SWISS, PLAYOFFS_LOCKED, or SEASON_ENDED).`,
        flags: 64
      });
    }

    const week = interaction.options.getInteger('week', true);
    const all = interaction.options.getBoolean('all') ?? false;
    const force = interaction.options.getBoolean('force') ?? false;
    if (!week || week < 1) {
      return interaction.reply({ content: 'Provide a valid week >= 1', flags: 64 });
    }

    const scoringMode = cfg?.scoringMode ?? 'LEGACY_PHASE';
    cfg.scoreCalculation = cfg.scoreCalculation || {};
    cfg.scoreCalculation.processedWeeksByMode = cfg.scoreCalculation.processedWeeksByMode || {
      LEGACY_PHASE: [],
      WEEKLY_SNAPSHOT: []
    };

    const modeKey = scoringMode === 'WEEKLY_SNAPSHOT' ? 'WEEKLY_SNAPSHOT' : 'LEGACY_PHASE';
    const processedWeeks = new Set((cfg.scoreCalculation.processedWeeksByMode?.[modeKey] || []).map(Number));
    const requestedWeeks = all
      ? Array.from({ length: week }, (_, i) => i + 1)
      : [week];

    const weeksToRun = force
      ? requestedWeeks
      : requestedWeeks.filter(w => !processedWeeks.has(Number(w)));

    if (!weeksToRun.length) {
      return interaction.reply({
        content: `ℹ️ Nothing to calculate. All requested week(s) are already processed for mode **${scoringMode}**. Use "/calculatescores week:${week}${all ? ' all:true' : ''} force:true" to override.`,
        flags: 64
      });
    }

    await interaction.reply({
      content:
        `Calculating scores for season=${season.name} mode=${scoringMode} weeks ${weeksToRun[0]}-${weeksToRun[weeksToRun.length - 1]}...` +
        `${force ? ' (force mode)' : ''}`,
      flags: 64
    });

    let totalUpdated = 0;
    const newlyProcessed = [];

    for (const w of weeksToRun) {
      const updated = await calculateScoresForWeek(season._id, w);
      totalUpdated += updated || 0;

      const weekHasData = await hasImportedDataForWeek(season._id, w);
      if (weekHasData || (updated || 0) > 0) {
        processedWeeks.add(Number(w));
        newlyProcessed.push(Number(w));
      }
    }

    cfg.scoreCalculation.processedWeeksByMode[modeKey] = [...processedWeeks].sort((a, b) => a - b);
    await cfg.save();

    const skippedWeeks = requestedWeeks.filter(w => !weeksToRun.includes(w));
    const processedLabel = newlyProcessed.length
      ? newlyProcessed.join(', ')
      : 'none (no week data detected)';

    return interaction.followUp({
      content:
        `Done — updated **${totalUpdated}** player-week entries.\n` +
        `• Mode: **${scoringMode}**\n` +
        `• Weeks run: **${weeksToRun.join(', ')}**\n` +
        `• Weeks marked as processed: **${processedLabel}**\n` +
        `• Weeks skipped (already processed): **${skippedWeeks.length ? skippedWeeks.join(', ') : 'none'}**`,
      flags: 64
    });
  }
}