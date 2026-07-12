import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { isAuthorizedForCommand } from '../utils/commandAuth.js';
import getActiveSeason from '../utils/getActiveSeason.js';
import FantasyConfig from '../models/FantasyConfig.js';
import FantasyPlayer from '../models/FantasyPlayer.js';

export default {
  data: new SlashCommandBuilder()
    .setName('setwalletmax')
    .setDescription('Admin: set season wallet cap and apply delta to all fantasy players in active season')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption(opt =>
      opt.setName('amount')
        .setDescription('New wallet cap (must be >= current cap)')
        .setMinValue(0)
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

    const nextMax = interaction.options.getInteger('amount', true);

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

    const currentMax = Number.isFinite(cfg.maxWallet) ? cfg.maxWallet : 110;
    if (nextMax < currentMax) {
      return interaction.reply({
        content: `❌ New wallet cap must be >= current cap (**${currentMax}**).`,
        flags: 64
      });
    }

    const delta = nextMax - currentMax;
    if (delta === 0) {
      return interaction.reply({
        content: `ℹ️ Wallet cap is already **${currentMax}**. No changes were applied.`,
        flags: 64
      });
    }

    cfg.maxWallet = nextMax;
    await cfg.save();

    const result = await FantasyPlayer.updateMany(
      { season: season._id },
      { $inc: { wallet: delta } }
    );

    return interaction.reply({
      content:
        `✅ Updated wallet cap for season **${season.name}**\n` +
        `• Previous cap: **${currentMax}**\n` +
        `• New cap: **${nextMax}**\n` +
        `• Delta applied to each fantasy wallet: **+${delta}**\n` +
        `• Fantasy players updated: **${result.modifiedCount ?? 0}**`,
      flags: 64
    });
  }
};
