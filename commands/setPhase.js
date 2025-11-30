import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { getActiveSeason } from '../utils/getActiveSeason.js';
import FantasyConfig from '../models/FantasyConfig.js';
import FantasyPlayer from '../models/FantasyPlayer.js';

export default {
  data: new SlashCommandBuilder()
    .setName('setphase')
    .setDescription('Admin: set season phase and take snapshots as needed')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(opt =>
      opt.setName('phase')
        .setDescription('Target phase')
        .addChoices(
          { name: 'PRESEASON', value: 'PRESEASON' },
          { name: 'SWISS', value: 'SWISS' },
          { name: 'PLAYOFFS_OPEN', value: 'PLAYOFFS_OPEN' },
          { name: 'PLAYOFFS_LOCKED', value: 'PLAYOFFS_LOCKED' },
          { name: 'SEASON_ENDED', value: 'SEASON_ENDED' }
        )
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: '❌ Admins only.', flags: 64 });
    }

    const season = await getActiveSeason();
    if (!season) {
      return interaction.reply({ content: '❌ No active season set.', flags: 64 });
    }
    const phase = interaction.options.getString('phase', true);

    let cfg = await FantasyConfig.findOne({season: season._id});
    if (!cfg) cfg = await FantasyConfig.create({});
    const prev = cfg.phase;

    // Update phase
    cfg.phase = phase;
    await cfg.save();

    // Snapshots on transitions
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
    // No snapshots for PLAYOFFS_LOCKED or SEASON_ENDED

    return interaction.reply({
      content: `✅ Phase changed: **${prev} → ${phase}**${(phase === 'SWISS' || phase === 'PLAYOFFS_OPEN') ? ' (snapshots updated)' : ''}`,
      ephemeral: true
    });
  }
};
