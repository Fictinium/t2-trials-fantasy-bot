// commands/setWallet.js
import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import FantasyPlayer from '../models/FantasyPlayer.js';

export default {
  data: new SlashCommandBuilder()
    .setName('setwallet')
    .setDescription('Admin: set wallet amounts')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sc =>
      sc.setName('user')
        .setDescription('Set a single user’s wallet')
        .addUserOption(o => o.setName('user').setDescription('User to update').setRequired(true))
        .addIntegerOption(o => o.setName('amount').setDescription('New wallet amount').setMinValue(0).setRequired(true))
    )
    .addSubcommand(sc =>
      sc.setName('all')
        .setDescription('Set wallet for ALL fantasy users')
        .addIntegerOption(o => o.setName('amount').setDescription('New wallet amount for everyone').setMinValue(0).setRequired(true))
    ),

  async execute(interaction) {
    try {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: '❌ Admins only.', flags: 64 });
      }

      const sub = interaction.options.getSubcommand();

      if (sub === 'user') {
        const user = interaction.options.getUser('user', true);
        const amount = interaction.options.getInteger('amount', true);

        const doc = await FantasyPlayer.findOneAndUpdate(
          { discordId: user.id },
          { $set: { wallet: amount } },
          { new: true }
        );

        if (!doc) {
          return interaction.reply({ content: `❌ ${user.username} isn’t registered.`, flags: 64 });
        }

        return interaction.reply({
          content: `✅ Set **${user.username}**’s wallet to **${doc.wallet}**.`,
          flags: 64
        });
      }

      if (sub === 'all') {
        const amount = interaction.options.getInteger('amount', true);
        const res = await FantasyPlayer.updateMany({}, { $set: { wallet: amount } });

        // res.modifiedCount is usually available; fall back to acknowledged count
        const modified = typeof res.modifiedCount === 'number' ? res.modifiedCount : undefined;

        return interaction.reply({
          content: `✅ Set wallet to **${amount}** for **${modified ?? 'all'}** users.`,
          flags: 64
        });
      }

    } catch (err) {
      console.error(err);
      const payload = { content: '❗ Failed to set wallet(s).', flags: 64 };
      try {
        if (interaction.deferred)       await interaction.editReply(payload);
        else if (!interaction.replied)  await interaction.reply(payload);
        else                            await interaction.followUp(payload);
      } catch {}
    }
  }
};