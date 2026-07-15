import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { isAuthorizedForCommand } from '../utils/commandAuth.js';
import Season from '../models/Season.js';
import FantasyConfig from '../models/FantasyConfig.js';
import { escapeRegex } from '../utils/escapeRegex.js';

export default {
  data: new SlashCommandBuilder()
    .setName('seasonactivate')
    .setDescription('Admin: set a season as the active one')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o =>
      o.setName('name')
       .setDescription('Season name, e.g. S1, S2, Winter2025')
       .setAutocomplete(true)
       .setRequired(true)
    ),

  async execute(interaction) {
    // allow Guild admins, OWNER_IDS, or roles listed in AUTHORIZATION_ROLE_IDS
    const allowed = await isAuthorizedForCommand(interaction, { allowedRoleEnvVar: 'AUTHORIZATION_ROLE_IDS', allowGuildAdmins: true });
    if (!allowed) {
      return interaction.reply({ content: '❌ You do not have permission to run this command.', flags: 64 });
    }

    await interaction.deferReply({ flags: 64 });
    const name = interaction.options.getString('name');

    const season = await Season.findOne({ name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' } });
    if (!season) {
      return interaction.editReply(`❌ Season **${name}** does not exist.`);
    }

    const activeSeason = await Season.findOne({ isActive: true });
    const isAlreadyActive = activeSeason && String(activeSeason._id) === String(season._id);

    // Toggle behavior: selecting the currently active season deactivates it.
    if (isAlreadyActive) {
      await Season.updateOne({ _id: season._id }, { isActive: false });
      return interaction.editReply(
        `✅ Season **${name}** was already active, so it has now been **deactivated**.\n` +
        `• There is currently **no active season**.`
      );
    }

    // Deactivate all
    await Season.updateMany({}, { isActive: false });

    // Activate selected
    await Season.updateOne({ _id: season._id }, { isActive: true });

    // Ensure config exists
    let cfg = await FantasyConfig.findOne({ season: season._id });
    if (!cfg) {
      cfg = await FantasyConfig.create({
        seasonName: name,
        season: season._id,
        phase: 'PRESEASON',
        scoringMode: 'LEGACY_PHASE',
        weeklyTransferPhase: 'OPEN',
        currentWeek: 1,
        playoffSwapLimit: 3,
        maxWallet: 110
      });
    } else {
      let changed = false;
      if (!cfg.seasonName) { cfg.seasonName = season.name; changed = true; }
      if (!cfg.phase) { cfg.phase = 'PRESEASON'; changed = true; }
      if (!cfg.scoringMode) { cfg.scoringMode = 'LEGACY_PHASE'; changed = true; }
      if (!cfg.weeklyTransferPhase) { cfg.weeklyTransferPhase = 'OPEN'; changed = true; }
      if (!Number.isFinite(cfg.currentWeek) || cfg.currentWeek < 1) { cfg.currentWeek = 1; changed = true; }
      if (!Number.isFinite(cfg.playoffSwapLimit) || cfg.playoffSwapLimit < 0) { cfg.playoffSwapLimit = 3; changed = true; }
      if (!Number.isFinite(cfg.maxWallet) || cfg.maxWallet < 0) { cfg.maxWallet = 110; changed = true; }
      if (changed) await cfg.save();
    }

    return interaction.editReply(
      `✅ Activated season **${name}**.\n` +
      `• Phase: **${cfg.phase}**\n` +
      `• Current week: **${cfg.currentWeek}**`
    );
  },

  async autocomplete(interaction) {
    try {
      const focused = interaction.options.getFocused(true);
      if (focused?.name !== 'name') {
        return interaction.respond([]);
      }

      const focusedValue = focused?.value || '';
      const seasons = await Season.find({
        name: { $regex: new RegExp(escapeRegex(focusedValue), 'i') }
      })
        .select('name')
        .sort({ name: 1 })
        .limit(25)
        .lean();

      return interaction.respond(seasons.map(s => ({ name: s.name, value: s.name })));
    } catch (err) {
      console.error(err);
      return interaction.respond([]);
    }
  }
};