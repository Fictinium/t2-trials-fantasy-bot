import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { isAuthorizedForCommand } from '../utils/commandAuth.js';
import getActiveSeason from '../utils/getActiveSeason.js';
import Season from '../models/Season.js';
import FantasyPlayer from '../models/FantasyPlayer.js';

export default {
  data: new SlashCommandBuilder()
    .setName('increaseteamsize')
    .setDescription('Admin: increase max team size for the active season')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption(opt =>
      opt.setName('size')
        .setDescription('New max team size (must be greater than current)')
        .setMinValue(1)
        .setRequired(true)
    ),

  async execute(interaction) {
    const allowed = await isAuthorizedForCommand(interaction, { allowedRoleEnvVar: 'AUTHORIZATION_ROLE_IDS', allowGuildAdmins: true });
    if (!allowed) {
      return interaction.reply({ content: '❌ You do not have permission to run this command.', flags: 64 });
    }

    const activeSeason = await getActiveSeason();
    if (!activeSeason) {
      return interaction.reply({ content: '❌ No active season set.', flags: 64 });
    }

    const season = await Season.findById(activeSeason._id);
    if (!season) {
      return interaction.reply({ content: '❌ Active season record could not be loaded.', flags: 64 });
    }

    const nextSize = interaction.options.getInteger('size', true);
    const currentSize = Number.isFinite(season.maxTeamSize) ? season.maxTeamSize : 7;

    if (nextSize <= currentSize) {
      return interaction.reply({
        content: `❌ New max team size must be greater than current size (**${currentSize}**).`,
        flags: 64
      });
    }

    season.maxTeamSize = nextSize;
    await season.save();

    const playerCount = await FantasyPlayer.countDocuments({ season: season._id });

    return interaction.reply({
      content:
        `✅ Increased max team size for season **${season.name}**\n` +
        `• Previous max: **${currentSize}**\n` +
        `• New max: **${nextSize}**\n` +
        `• Applies immediately to all **${playerCount}** fantasy players in this season`,
      flags: 64
    });
  }
};
