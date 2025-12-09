import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import getActiveSeason from '../utils/getActiveSeason.js';
import { isAuthorizedForCommand } from '../utils/commandAuth.js';
import Team from '../models/Team.js';

export default {
  data: new SlashCommandBuilder()
    .setName('createteam')
    .setDescription('Admin: manually create a new T2 Trials team')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(opt =>
      opt.setName('name')
        .setDescription('Team name')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('shortcode')
        .setDescription('Team shortcode (3-4 chars, e.g. RNT)')
        .setRequired(false)
    ),

  async execute(interaction) {
    // authorization check
    const allowed = await isAuthorizedForCommand(interaction, { allowedRoleEnvVar: 'AUTHORIZATION_ROLE_IDS', allowGuildAdmins: true });
    if (!allowed) {
      return interaction.reply({ content: '❌ You do not have permission to run this command.', flags: 64 });
    }

    const season = await getActiveSeason();
    if (!season) {
      return interaction.reply({ content: '❌ No active season set.', flags: 64 });
    }

    const name = interaction.options.getString('name', true).trim();
    const shortcode = (interaction.options.getString('shortcode') || '').trim().toUpperCase() || null;

    // Validate name uniqueness per season
    const existing = await Team.findOne({ name, season: season._id });
    if (existing) {
      return interaction.reply({ content: `❌ Team **${name}** already exists in season **${season.name}**.`, flags: 64 });
    }

    try {
      const newTeam = await Team.create({
        name,
        shortcode,
        season: season._id,
        players: []
      });

      return interaction.reply({
        content: `✅ Team **${newTeam.name}**${shortcode ? ` (${shortcode})` : ''} created successfully in season **${season.name}**.`,
        flags: 64
      });
    } catch (err) {
      console.error('[createTeam]', err);
      return interaction.reply({ content: `❌ Error creating team: ${err.message || err}`, flags: 64 });
    }
  }
};