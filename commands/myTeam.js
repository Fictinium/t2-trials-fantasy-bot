import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { totalPointsForPlayer } from '../services/scoring.js';
import getActiveSeason from '../utils/getActiveSeason.js';
import isRegistered from '../utils/checkRegistration.js';
import FantasyPlayer from '../models/FantasyPlayer.js';

export default {
  data: new SlashCommandBuilder()
    .setName('myteam')
    .setDescription('View your fantasy team'),

  async execute(interaction) {
    try {
      const season = await getActiveSeason();
      if (!season) {
        return interaction.reply({ content: '❌ No active season set.', flags: 64 });
      }
      const MAX_TEAM_SIZE = season?.maxTeamSize ?? 7; // keep in sync with pickPlayer
      const discordId = interaction.user.id;

      // 1) Must be registered
      const registered = await isRegistered(discordId);
      if (!registered) {
        return interaction.reply({
          content: '⚠️ You must register using `/joinleague` before using this command.',
          flags: 64
        });
      }

      // 2) Load fantasy player with populated players and each player's real team
      const fantasyPlayer = await FantasyPlayer.findOne({ discordId, season: season._id })
        .populate({
          path: 'team',
          populate: [
            { path: 'team', model: 'Team' },
          ],
          select: 'name team performance cost',
        })
        .lean();

      if (!fantasyPlayer) {
        return interaction.reply({
          content: '❗ Could not find your fantasy profile. Try `/joinleague` again.',
          flags: 64
        });
      }

      const roster = Array.isArray(fantasyPlayer.team) ? fantasyPlayer.team : [];

      if (!roster.length) {
        return interaction.reply({
          content: '📝 Your fantasy team is empty. Use `/pickplayer` to add someone!',
          flags: 64
        });
      }

      // 3) Build a nice embed
      const displayName = fantasyPlayer.username || interaction.user.username;
      const lines = roster.map((p, i) => {
        const teamName = p.team?.name ? ` — *${p.team.name}*` : '';
        const playerPts = totalPointsForPlayer(p); // <- reused helper
        const playerName = p.name || p.username || String(p._id).slice(0, 8);
        return `**${i + 1}.** ${playerName}${teamName} — ${playerPts} pts`;
      });

      // Dynamically sum total points from current roster
      const totalPoints = roster.reduce((sum, p) => sum + totalPointsForPlayer(p), 0);
      const wallet = fantasyPlayer.wallet ?? 0;
      const embed = new EmbedBuilder()
        .setTitle(`${displayName}'s Fantasy Team`)
        .setDescription(lines.join('\n'))
        .setFooter({
          text: `Players: ${roster.length}/${MAX_TEAM_SIZE} • Total points: ${totalPoints} • Wallet: ${wallet}`
        });

      return interaction.reply({ embeds: [embed]});
    } catch (err) {
      console.error(err);
      const payload = { content: '❗ Something went wrong while fetching your team.', flags: 64 };
      try {
        if (interaction.deferred)       await interaction.editReply(payload);
        else if (!interaction.replied)  await interaction.reply(payload);
        else                            await interaction.followUp(payload);
      } catch {}
    }
  }
};
