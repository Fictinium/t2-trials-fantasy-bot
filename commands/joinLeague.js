import { SlashCommandBuilder } from 'discord.js';
import getActiveSeason from '../utils/getActiveSeason.js';
import FantasyPlayer from '../models/FantasyPlayer.js';

export default {
  data: new SlashCommandBuilder()
    .setName('joinleague')
    .setDescription('Join the T2 Trials Fantasy League'),
    
  async execute(interaction) {
    const season = await getActiveSeason();
    if (!season) {
      return interaction.reply({ content: '❌ No active season set.', flags: 64 });
    }

    const existing = await FantasyPlayer.findOne({ discordId: interaction.user.id, season: season._id });

    if (existing) {
      return interaction.reply({
        content: '❌ You are already registered in the fantasy league!',
        flags: 64
      });
    }

    const newFantasyPlayer = new FantasyPlayer({
      discordId: interaction.user.id,
      username: interaction.user.username,
      weeklyPoints: [],
      totalPoints: 0,
      season: season._id
    });

    await newFantasyPlayer.save();

    return interaction.reply({
      content: '✅ You have been successfully registered to the fantasy league!',
      flags: 64
    });
  }
};