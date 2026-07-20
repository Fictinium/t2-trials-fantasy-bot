import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { isAuthorizedForCommand } from '../utils/commandAuth.js';
import getActiveSeason from '../utils/getActiveSeason.js';
import FantasyConfig from '../models/FantasyConfig.js';

export default {
  data: new SlashCommandBuilder()
    .setName('setweek')
    .setDescription('Admin: set the current week for the active season')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption(opt =>
      opt.setName('week')
        .setDescription('Week number to set as current')
        .setMinValue(1)
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

    const nextWeek = interaction.options.getInteger('week', true);

    let cfg = await FantasyConfig.findOne({ season: season._id });
    if (!cfg) {
      cfg = await FantasyConfig.create({
        season: season._id,
        seasonName: season.name,
        phase: 'PRESEASON',
        scoringMode: 'LEGACY_PHASE',
        weeklyTransferPhase: 'OPEN',
        currentWeek: 1,
        playoffSwapLimit: 3,
        maxWallet: 110
      });
    }

    const currentWeek = Number.isFinite(cfg.currentWeek) ? cfg.currentWeek : 1;
    if (currentWeek === nextWeek) {
      return interaction.reply({
        content: `ℹ️ Current week is already **${currentWeek}**. No changes were applied.`,
        flags: 64
      });
    }

    cfg.currentWeek = nextWeek;
    await cfg.save();

    return interaction.reply({
      content:
        `✅ Updated current week for season **${season.name}**\n` +
        `• Previous week: **${currentWeek}**\n` +
        `• New week: **${nextWeek}**\n` +
        `• Scoring mode: **${cfg.scoringMode ?? 'LEGACY_PHASE'}**`,
      flags: 64
    });
  }
};