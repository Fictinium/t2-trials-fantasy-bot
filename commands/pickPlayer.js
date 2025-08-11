import { SlashCommandBuilder } from 'discord.js';
import { canModifyTeam } from '../utils/transferGuard.js';
import { escapeRegex } from '../utils/escapeRegex.js';
import isRegistered from '../utils/checkRegistration.js';
import FantasyPlayer from '../models/FantasyPlayer.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';
import Team from '../models/Team.js';

const MAX_TEAM_SIZE = 5; // keep in sync with /myteam etc.

export default {
  data: new SlashCommandBuilder()
    .setName('pickplayer')
    .setDescription('Pick a T2 Trials league player for your fantasy team')
    .addStringOption(opt =>
      opt.setName('player')
        .setDescription('Player name of who you want to pick')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('team')
        .setDescription('Team name (only if duplicate player names exist)')
        .setRequired(false)
    ),

  async execute(interaction) {
    try {
      const discordId = interaction.user.id;
      const playerName = interaction.options.getString('player', true);
      const teamName = interaction.options.getString('team') || null;

      // 1) Must be registered
      if (!await isRegistered(discordId)) {
        return interaction.reply({ content: '⚠️ You must register using `/joinleague` before picking players.', flags: 64 });
      }

      // 2) Resolve (optional) team for disambiguation
      let teamDoc = null;
      if (teamName) {
        teamDoc = await Team.findOne({ name: { $regex: `^${escapeRegex(teamName)}$`, $options: 'i' } }).lean();
        if (!teamDoc) {
          return interaction.reply({ content: `❌ Team "${teamName}" not found.`, flags: 64 });
        }
      }

      // 3) Find the league player (exact, case-insensitive)
      let leaguePlayer;
      if (teamDoc) {
        leaguePlayer = await T2TrialsPlayer.findOne({
          name: { $regex: `^${escapeRegex(playerName)}$`, $options: 'i' },
          team: teamDoc._id,
        }).lean();

        if (!leaguePlayer) {
          return interaction.reply({
            content: `❌ Player **${playerName}** in team **${teamDoc.name}** not found.`,
            flags: 64
          });
        }
      } else {
        const matches = await T2TrialsPlayer.find({
          name: { $regex: `^${escapeRegex(playerName)}$`, $options: 'i' }
        }).populate('team', 'name').lean();

        if (matches.length === 0) {
          return interaction.reply({ content: `❌ No league player found named **${playerName}**.`, flags: 64 });
        }
        if (matches.length > 1) {
          const list = matches.map(m => `• ${m.name} — *${m.team?.name ?? 'Unknown team'}*`).join('\n');
          return interaction.reply({
            content: `⚠️ Multiple players named **${playerName}**.\nPlease specify the team using \`/pickplayer player:${playerName} team:<Team>\`.\n\n${list}`,
            flags: 64
          });
        }
        leaguePlayer = matches[0];
      }

      // 4) Sanity: cost
      const cost = Number(leaguePlayer.cost ?? 0);
      if (!Number.isFinite(cost) || cost < 0) {
        return interaction.reply({
          content: `❗ **${leaguePlayer.name}** has an invalid cost configured. Ask an admin to fix this.`,
          flags: 64
        });
      }

      // 5) Load current team & wallet (and updatedAt for optimistic concurrency)
      const fp = await FantasyPlayer.findOne(
        { discordId },
        { team: 1, wallet: 1, updatedAt: 1 }
      ).lean();

      if (!fp) {
        return interaction.reply({ content: '❗ Could not load your fantasy profile.', flags: 64 });
      }

      const currentTeam = Array.isArray(fp.team) ? fp.team.map(id => id.toString()) : [];
      const proposed = [...new Set([...currentTeam, leaguePlayer._id.toString()])];

      // 6) Phase/limit guard
      const check = await canModifyTeam(discordId, proposed);
      if (!check.allowed) {
        let msg = '⛔ Team changes are locked.';
        if (check.reason === 'SWISS_LOCKED') msg = '⛔ Team changes are locked during the swiss period.';
        else if (check.reason === 'PLAYOFFS_LOCKED') msg = '⛔ Team changes are currently locked for playoffs.';
        else if (check.reason === 'PLAYOFFS_LIMIT') msg = `⛔ Playoff swap limit reached. You have used **${check.swapsUsed}/${check.limit}** allowed swaps.`;
        return interaction.reply({ content: msg, flags: 64 });
      }

      // 7) Atomic update: no dupes, cap size, budget ok, and doc unchanged since read
      const updated = await FantasyPlayer.findOneAndUpdate(
        {
          discordId,
          team: { $ne: leaguePlayer._id },
          wallet: { $gte: cost },
          $expr: { $lt: [{ $size: '$team' }, MAX_TEAM_SIZE] },
          updatedAt: fp.updatedAt, // optimistic concurrency guard
        },
        {
          $addToSet: { team: leaguePlayer._id },
          $inc: { wallet: -cost },
        },
        { new: true }
      );

      if (!updated) {
        // Re-check to give a helpful reason
        const latest = await FantasyPlayer.findOne({ discordId }, { team: 1, wallet: 1 }).lean();

        if (latest?.team?.some(id => id.toString() === leaguePlayer._id.toString())) {
          return interaction.reply({ content: `❌ You already have **${leaguePlayer.name}** on your team.`, flags: 64 });
        }
        if ((latest?.team?.length ?? 0) >= MAX_TEAM_SIZE) {
          return interaction.reply({ content: `❌ You cannot have more than ${MAX_TEAM_SIZE} players.`, flags: 64 });
        }
        if ((latest?.wallet ?? 0) < cost) {
          return interaction.reply({
            content: `❌ Not enough budget. **${leaguePlayer.name}** costs **${cost}**, you have **${latest?.wallet ?? 0}**.`,
            flags: 64
          });
        }
        return interaction.reply({ content: '⚠️ Your team changed while processing. Please try again.', flags: 64 });
      }

      return interaction.reply({
        content: `✅ You have successfully added **${leaguePlayer.name}** to your fantasy team!`,
        flags: 64
      });
    } catch (err) {
      console.error(err);
      const payload = { content: '❗ An error occurred while picking that player.', flags: 64 };
      try {
        if (interaction.deferred)       await interaction.editReply(payload);
        else if (!interaction.replied)  await interaction.reply(payload);
        else                            await interaction.followUp(payload);
      } catch {}
    }
  }
};