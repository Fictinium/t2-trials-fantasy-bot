import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { isAuthorizedForCommand } from '../utils/commandAuth.js';
import getActiveSeason from '../utils/getActiveSeason.js';
import FantasyConfig from '../models/FantasyConfig.js';
import FantasyPlayer from '../models/FantasyPlayer.js';

export default {
  data: new SlashCommandBuilder()
    .setName('setphase')
    .setDescription('Admin: set phase (legacy) or weekly transfer phase (weekly snapshot mode)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(opt =>
      opt.setName('phase')
        .setDescription('Legacy phase, or OPEN/LOCKED for weekly snapshot mode')
        .addChoices(
          { name: 'PRESEASON', value: 'PRESEASON' },
          { name: 'SWISS', value: 'SWISS' },
          { name: 'PLAYOFFS_OPEN', value: 'PLAYOFFS_OPEN' },
          { name: 'PLAYOFFS_LOCKED', value: 'PLAYOFFS_LOCKED' },
          { name: 'SEASON_ENDED', value: 'SEASON_ENDED' },
          { name: 'OPEN (weekly transfers)', value: 'OPEN' },
          { name: 'LOCKED (weekly transfers)', value: 'LOCKED' }
        )
        .setRequired(true)
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
    const phase = interaction.options.getString('phase', true);

    let cfg = await FantasyConfig.findOne({season: season._id});
    if (!cfg) {
      cfg = await FantasyConfig.create({
        season: season._id,
        seasonName: season.name,
        scoringMode: 'LEGACY_PHASE',
        weeklyTransferPhase: 'OPEN'
      });
    }

    const scoringMode = cfg.scoringMode ?? 'LEGACY_PHASE';
    const isWeeklyPhase = phase === 'OPEN' || phase === 'LOCKED';

    if (scoringMode === 'WEEKLY_SNAPSHOT') {
      if (!isWeeklyPhase) {
        return interaction.reply({
          content: '❌ In WEEKLY_SNAPSHOT mode, use `OPEN` or `LOCKED` with `/setphase`.',
          flags: 64
        });
      }

      const prev = cfg.weeklyTransferPhase ?? 'OPEN';
      cfg.weeklyTransferPhase = phase;
      await cfg.save();

      return interaction.reply({
        content: `✅ Weekly transfer phase changed: **${prev} → ${phase}** (mode: **${scoringMode}**)`,
        flags: 64
      });
    }

    if (isWeeklyPhase) {
      return interaction.reply({
        content: '❌ OPEN/LOCKED is only valid when scoring mode is WEEKLY_SNAPSHOT.',
        flags: 64
      });
    }

    const prev = cfg.phase;

    // Legacy phase update
    cfg.phase = phase;
    await cfg.save();

    // Snapshots on transitions (legacy mode)
    if (phase === 'SWISS') {
      // snapshot every user's current team -> swissLockSnapshot
      await FantasyPlayer.updateMany({season: season._id}, [
        { $set: { swissLockSnapshot: '$team' } } // uses aggregation pipeline update (MongoDB 4.2+)
      ]);
    } else if (phase === 'PLAYOFFS_OPEN') {
      // snapshot every user's current team -> playoffSnapshot
      await FantasyPlayer.updateMany({season: season._id}, [
        { $set: { playoffSnapshot: '$team' } }
      ]);
    }

    return interaction.reply({
      content: `✅ Phase changed: **${prev} → ${phase}**${(phase === 'SWISS' || phase === 'PLAYOFFS_OPEN') ? ' (snapshots updated)' : ''}`,
      ephemeral: true
    });
  }
};
