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
    ),

  async execute(interaction) {
    // allow Guild admins, OWNER_IDS, or roles listed in AUTHORIZATION_ROLE_IDS
    const allowed = await isAuthorizedForCommand(interaction, { allowedRoleEnvVar: 'AUTHORIZATION_ROLE_IDS', allowGuildAdmins: true });
    if (!allowed) {
      return interaction.reply({ content: '❌ You do not have permission to run this command.', flags: 64 });
    }

    await interaction.deferReply({ flags: 64 });

    const name = interaction.options.getString('name');

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
      phase: 'PRESEASON',
      currentWeek: 1,
      playoffSwapLimit: 2
    });

    // 5. Duplicate existing fantasy users into the new season
    const previousPlayers = await FantasyPlayer.find().lean();
    let createdCount = 0;

    for (const fp of previousPlayers) {
      await FantasyPlayer.create({
        discordId: fp.discordId,
        username: fp.username,
        season: newSeason._id,
        team: [],
        weeklyPoints: [],
        totalPoints: 0
      });
      createdCount++;
    }

    // Done
    return interaction.editReply(
      `✅ **New season created successfully!**\n` +
      `• Season: **${name}**\n` +
      `• FantasyConfig created (week=1, phase=PRESEASON)\n` +
      `• Duplicated **${createdCount}** fantasy users\n\n` +
      `The system is now ready for:\n` +
      `• Player import for the new season\n` +
      `• Weekly score calculation\n` +
      `• User team building`
    );
  }
};