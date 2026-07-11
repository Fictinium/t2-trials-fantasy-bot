import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { isAuthorizedForCommand } from '../utils/commandAuth.js';
import getActiveSeason from '../utils/getActiveSeason.js';
import FantasyConfig from '../models/FantasyConfig.js';

const MODES = {
  LEGACY_PHASE: 'LEGACY_PHASE',
  WEEKLY_SNAPSHOT: 'WEEKLY_SNAPSHOT'
};

export default {
  data: new SlashCommandBuilder()
    .setName('setscoringmode')
    .setDescription('Admin: set scoring mode for the active season')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(opt =>
      opt.setName('mode')
        .setDescription('Scoring mode')
        .addChoices(
          { name: 'Legacy (phase locks)', value: MODES.LEGACY_PHASE },
          { name: 'Weekly Snapshot (manual OPEN/LOCKED via /setphase)', value: MODES.WEEKLY_SNAPSHOT }
        )
        .setRequired(true)
    ),

  async execute(interaction) {
    const allowed = await isAuthorizedForCommand(interaction, { allowedRoleEnvVar: 'AUTHORIZATION_ROLE_IDS', allowGuildAdmins: true });
    if (!allowed) {
      return interaction.reply({ content: '❌ You do not have permission to run this command.', flags: 64 });
    }

    const season = await getActiveSeason();
    if (!season) {
      return interaction.reply({ content: '❌ No active season set.', flags: 64 });
    }

    const mode = interaction.options.getString('mode', true);
    let cfg = await FantasyConfig.findOne({ season: season._id });
    if (!cfg) {
      cfg = await FantasyConfig.create({
        season: season._id,
        seasonName: season.name,
        phase: 'PRESEASON',
        weeklyTransferPhase: 'OPEN',
        currentWeek: 1,
        playoffSwapLimit: 2,
        scoringMode: mode
      });
    } else {
      cfg.scoringMode = mode;
      if (!cfg.weeklyTransferPhase) cfg.weeklyTransferPhase = 'OPEN';
      await cfg.save();
    }

    return interaction.reply({
      content:
        `✅ Scoring mode updated for season **${season.name}**\n` +
        `• Mode: **${cfg.scoringMode}**\n` +
        `• Weekly Transfer Phase: **${cfg.weeklyTransferPhase ?? 'OPEN'}**\n` +
        `• Current week: **${cfg.currentWeek}**`,
      flags: 64
    });
  }
};
