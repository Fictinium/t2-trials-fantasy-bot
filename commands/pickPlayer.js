import { SlashCommandBuilder } from 'discord.js';
import { canModifyTeam } from '../utils/transferGuard.js';
import { escapeRegex } from '../utils/escapeRegex.js';
import getActiveSeason from '../utils/getActiveSeason.js';
import isRegistered from '../utils/checkRegistration.js';
import FantasyPlayer from '../models/FantasyPlayer.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';
import Team from '../models/Team.js';
import FantasyConfig from '../models/FantasyConfig.js';

async function upsertWeeklyLineupSnapshot(discordId, seasonId) {
  const cfg = await FantasyConfig.findOne({ season: seasonId }, { scoringMode: 1, currentWeek: 1 }).lean();
  if ((cfg?.scoringMode ?? 'LEGACY_PHASE') !== 'WEEKLY_SNAPSHOT') return;

  const week = Number(cfg?.currentWeek) || 1;
  const fp = await FantasyPlayer.findOne({ discordId, season: seasonId }, { team: 1, weeklyLineups: 1 });
  if (!fp) return;

  const idx = (fp.weeklyLineups || []).findIndex(w => Number(w?.week) === week);
  const currentTeamIds = Array.isArray(fp.team) ? fp.team.map(p => p?._id ?? p) : [];
  if (idx >= 0) {
    fp.weeklyLineups[idx].team = currentTeamIds;
    fp.weeklyLineups[idx].lockedAt = new Date();
  } else {
    fp.weeklyLineups.push({ week, team: currentTeamIds, lockedAt: new Date() });
  }
  await fp.save();
}

export default {
  data: new SlashCommandBuilder()
    .setName('pickplayer')
    .setDescription('Pick a T2 Trials league player for your fantasy team')
    .addStringOption(opt =>
      opt.setName('player')
        .setDescription('Player name of who you want to pick')
        .setAutocomplete(true)
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('team')
        .setDescription('Team name (only if duplicate player names exist)')
        .setAutocomplete(true)
        .setRequired(false)
    ),

  async execute(interaction) {
    try {
      const season = await getActiveSeason();
      if (!season) {
        return interaction.reply({ content: '❌ No active season set.', flags: 64 });
      }
      const MAX_TEAM_SIZE = season?.maxTeamSize ?? 7; // keep in sync with pickPlayer
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
        teamDoc = await Team.findOne({ name: { $regex: `^${escapeRegex(teamName)}$`, $options: 'i' }, season: season._id }).lean();
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
          season: season._id
        }).lean();

        if (!leaguePlayer) {
          return interaction.reply({
            content: `❌ Player **${playerName}** in team **${teamDoc.name}** not found.`,
            flags: 64
          });
        }
      } else {
        const matches = await T2TrialsPlayer.find({
          name: { $regex: `^${escapeRegex(playerName)}$`, $options: 'i' },
          season: season._id
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
        { discordId, season: season._id },
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
        else if (check.reason === 'WEEK_LOCKED') msg = `⛔ Team changes are locked for week **${check.week}**.`;
        else if (check.reason === 'NO_ACTIVE_SEASON') msg = '❌ No active season set.';
        else if (check.reason === 'PLAYOFFS_LIMIT') {
          // Calculate swaps already made (excluding the attempted addition)
          const swapsMade = check.swapsUsed;
          msg = `⛔ Playoff swap limit reached. You have used **${swapsMade}/${check.limit}** allowed swaps.`;
        }
        return interaction.reply({ content: msg, flags: 64 });
      }

      // 7) Atomic update: no dupes, cap size, budget ok, and doc unchanged since read
      const updated = await FantasyPlayer.findOneAndUpdate(
        {
          discordId,
          season: season._id,
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

      if (updated) {
        // Update the fantasyTeams field in T2TrialsPlayer
        await T2TrialsPlayer.findByIdAndUpdate(
          leaguePlayer._id,
          { $addToSet: { fantasyTeams: fp._id } } // Add the fantasy player to the fantasyTeams array
        );

        await upsertWeeklyLineupSnapshot(discordId, season._id);
      }

      if (!updated) {
        // Re-check to give a helpful reason
        const latest = await FantasyPlayer.findOne({ discordId, season: season._id }, { team: 1, wallet: 1 }).lean();

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
  },

  async autocomplete(interaction) {
    try {
      const focused = interaction.options.getFocused(true);
      const focusedValue = focused?.value || '';

      const season = await getActiveSeason();
      if (!season) {
        return interaction.respond([]);
      }

      if (focused?.name === 'player') {
        const teamName = interaction.options.getString('team') || null;
        let teamId = null;
        if (teamName) {
          const teamDoc = await Team.findOne({
            season: season._id,
            name: { $regex: `^${escapeRegex(teamName)}$`, $options: 'i' }
          }).select('_id').lean();
          teamId = teamDoc?._id ?? null;
        }

        const query = {
          season: season._id,
          name: { $regex: new RegExp(escapeRegex(focusedValue), 'i') }
        };
        if (teamId) query.team = teamId;

        const players = await T2TrialsPlayer.find(query)
          .select('name')
          .limit(100)
          .lean();

        const uniqueNames = [...new Set(players.map(p => p?.name).filter(Boolean))].slice(0, 25);
        const suggestions = uniqueNames.map(name => ({ name, value: name }));
        return interaction.respond(suggestions);
      }

      if (focused?.name === 'team') {
        const playerName = interaction.options.getString('player') || null;

        if (playerName) {
          const teamIds = await T2TrialsPlayer.distinct('team', {
            season: season._id,
            name: { $regex: `^${escapeRegex(playerName)}$`, $options: 'i' }
          });

          if (teamIds.length) {
            const teams = await Team.find({
              _id: { $in: teamIds },
              season: season._id,
              name: { $regex: new RegExp(escapeRegex(focusedValue), 'i') }
            })
              .select('name')
              .sort({ name: 1 })
              .limit(25)
              .lean();

            const suggestions = teams
              .map(t => t?.name)
              .filter(Boolean)
              .map(name => ({ name, value: name }));
            return interaction.respond(suggestions);
          }
        }

        const teams = await Team.find({
          season: season._id,
          name: { $regex: new RegExp(escapeRegex(focusedValue), 'i') }
        })
          .select('name')
          .sort({ name: 1 })
          .limit(25)
          .lean();

        const suggestions = teams
          .map(t => t?.name)
          .filter(Boolean)
          .map(name => ({ name, value: name }));
        return interaction.respond(suggestions);
      }

      return interaction.respond([]);
    } catch (err) {
      console.error('Error in pickPlayer autocomplete:', err);
      return interaction.respond([]);
    }
  }
};