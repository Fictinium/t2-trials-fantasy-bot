import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { isAuthorizedForCommand } from '../utils/commandAuth.js';
import Season from '../models/Season.js';
import FantasyConfig from '../models/FantasyConfig.js';
import FantasyPlayer from '../models/FantasyPlayer.js';

export default {
  data: new SlashCommandBuilder()
    .setName('newseason')
    .setDescription('Admin: create a new fantasy season')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o =>
      o.setName('name')
       .setDescription('Season name, e.g. S2, Winter2025, etc')
       .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName('walletmax')
       .setDescription('Optional max wallet baseline for this new season')
       .setMinValue(0)
       .setRequired(false)
    ),

  async execute(interaction) {
    // allow Guild admins, OWNER_IDS, or roles listed in AUTHORIZATION_ROLE_IDS
    const allowed = await isAuthorizedForCommand(interaction, { allowedRoleEnvVar: 'AUTHORIZATION_ROLE_IDS', allowGuildAdmins: true });
    if (!allowed) {
      return interaction.reply({ content: '❌ You do not have permission to run this command.', flags: 64 });
    }

    await interaction.deferReply({ flags: 64 });

    const name = interaction.options.getString('name');
    const walletMaxOption = interaction.options.getInteger('walletmax');
    const cfgWalletDefaultRaw = FantasyConfig.schema.path('maxWallet')?.defaultValue;
    const cfgWalletDefault = Number.isFinite(cfgWalletDefaultRaw)
      ? cfgWalletDefaultRaw
      : 110;

    // Capture the season we are cloning from before we deactivate anything.
    const sourceSeason = await Season.findOne({ isActive: true }).lean();
    const sourceCfg = sourceSeason
      ? await FantasyConfig.findOne({ season: sourceSeason._id }, { maxWallet: 1 }).lean()
      : null;
    const sourceMaxWallet = Number.isFinite(sourceCfg?.maxWallet) ? sourceCfg.maxWallet : cfgWalletDefault;
    const targetMaxWallet = Number.isFinite(walletMaxOption) ? walletMaxOption : sourceMaxWallet;

    // 1. Check if a season with that name already exists
    const existing = await Season.findOne({ name });
    if (existing) {
      return interaction.editReply(`❌ Season **${name}** already exists.`);
    }

    // 2. Deactivate all seasons
    await Season.updateMany({}, { isActive: false });

    // 3. Create new season
    const newSeason = await Season.create({
      name,
      isActive: true
    });

    // 4. Create FantasyConfig for the new season
    const cfg = await FantasyConfig.create({
      seasonName: name,
      season: newSeason._id,
      maxWallet: targetMaxWallet
    });

    // 5. Duplicate existing fantasy users into the new season
    const previousPlayers = sourceSeason
      ? await FantasyPlayer.find({ season: sourceSeason._id }).lean()
      : [];

    const uniquePlayers = new Map();
    for (const fp of previousPlayers) {
      if (!fp?.discordId || uniquePlayers.has(fp.discordId)) continue;
      uniquePlayers.set(fp.discordId, fp);
    }

    let createdCount = 0;
    const walletDelta = targetMaxWallet - sourceMaxWallet;

    for (const fp of uniquePlayers.values()) {
      const baseWallet = Number.isFinite(fp.wallet) ? fp.wallet : sourceMaxWallet;
      const adjustedWallet = Math.max(0, baseWallet + walletDelta);

      await FantasyPlayer.create({
        discordId: fp.discordId,
        username: fp.username,
        season: newSeason._id,
        team: [],
        weeklyLineups: [],
        weeklyPoints: [],
        totalPoints: 0,
        wallet: adjustedWallet,
        swissLockSnapshot: [],
        playoffSnapshot: []
      });
      createdCount++;
    }

    // Done
    return interaction.editReply(
      `✅ **New season created successfully!**\n` +
      `• Season: **${name}**\n` +
      `• Max wallet: **${targetMaxWallet}**${walletDelta !== 0 ? ` (delta vs previous: ${walletDelta > 0 ? '+' : ''}${walletDelta})` : ''}\n` +
      `• FantasyConfig created (week=1, phase=PRESEASON)\n` +
      `• Duplicated **${createdCount}** fantasy users\n\n` +
      `The system is now ready for:\n` +
      `• Player import for the new season\n` +
      `• Weekly score calculation\n` +
      `• User team building`
    );
  }
};