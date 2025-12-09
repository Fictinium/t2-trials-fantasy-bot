import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import getActiveSeason from '../utils/getActiveSeason.js';
import FantasyPlayer from '../models/FantasyPlayer.js';
import { isAuthorizedForCommand } from '../utils/commandAuth.js';

export default {
  data: new SlashCommandBuilder()
    .setName('setwallet')
    .setDescription('Admin: set a fantasy player’s wallet for the active season')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('Fantasy player to update')
        .setRequired(true)
    )
    .addIntegerOption(opt =>
      opt.setName('amount')
        .setDescription('Wallet amount to set')
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

    const user = interaction.options.getUser('user', true);
    const amount = interaction.options.getInteger('amount', true);

    const fp = await FantasyPlayer.findOne({ discordId: user.id, season: season._id });
    if (!fp) {
      return interaction.reply({ content: `❌ Fantasy player not found for ${user.username} in season ${season.name}.`, flags: 64 });
    }

    fp.wallet = amount;
    await fp.save();

    return interaction.reply({
      content: `✅ Wallet for **${user.username}** in season **${season.name}** set to **${amount}**.`,
      flags: 64
    });
  }
};