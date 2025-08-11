import { SlashCommandBuilder } from 'discord.js';
import FantasyPlayer from '../models/FantasyPlayer.js';

export default {
  data: new SlashCommandBuilder()
    .setName('joinleague')
    .setDescription('Join the T2 Trials Fantasy League'),
    
  async execute(interaction) {
    const existing = await FantasyPlayer.findOne({ discordId: interaction.user.id });

    if (existing) {
      return interaction.reply({
        content: '❌ You are already registered in the fantasy league!',
        ephemeral: true
      });
    }

    const newFantasyPlayer = new FantasyPlayer({
      discordId: interaction.user.id,
      username: interaction.user.username,
      weeklyPoints: [],
      totalPoints: 0,
      wallet: 85
    });

    await newFantasyPlayer.save();

    return interaction.reply({
      content: '✅ You have been successfully registered to the fantasy league!',
      ephemeral: true
    });
  }
};