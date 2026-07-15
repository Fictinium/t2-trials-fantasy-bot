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
    .setName('removeplayer')
    .setDescription('Remove a T2 Trials league player from your fantasy team')
    .addStringOption(opt =>
      opt.setName('player')
        .setDescription('Name of the player who you want to remove')
        .setAutocomplete(true)
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('team')
        .setDescription('(Optional) Team name to disambiguate if multiple players share the same name')
        .setAutocomplete(true)
        .setRequired(false)
    ),

  async execute(interaction) {
    try {
      const season = await getActiveSeason();
      if (!season) {
        return interaction.reply({ content: '❌ No active season set.', flags: 64 });
      }
      const discordId = interaction.user.id;
      const inputName = interaction.options.getString('player', true);
      const inputTeam = interaction.options.getString('team') || null;

      // 1) Must be registered
      if (!await isRegistered(discordId)) {
        return interaction.reply({ content: '⚠️ You must register using `/joinleague` before using this command.', flags: 64 });
      }

      // 2) Resolve optional team for disambiguation
      let teamDoc = null;
      if (inputTeam) {
        teamDoc = await Team.findOne({ name: { $regex: `^${escapeRegex(inputTeam)}$`, $options: 'i' }, season: season._id }).lean();
        if (!teamDoc) {
          return interaction.reply({ content: `❌ Team "${inputTeam}" not found.`, flags: 64 });
        }
      }

      // 3) Find the target league player by exact name (case-insensitive)
      let leaguePlayer = null;
      if (teamDoc) {
        leaguePlayer = await T2TrialsPlayer.findOne({
          name: { $regex: `^${escapeRegex(inputName)}$`, $options: 'i' },
          team: teamDoc._id,
          season: season._id
        }).lean();

        if (!leaguePlayer) {
          return interaction.reply({
            content: `❌ No league player found for **${inputName}** in team **${teamDoc.name}**.`,
            flags: 64
          });
        }
      } else {
        const matches = await T2TrialsPlayer.find({
          name: { $regex: `^${escapeRegex(inputName)}$`, $options: 'i' },
          season: season._id
        }).populate('team', 'name').lean();

        if (!matches.length) {
          return interaction.reply({ content: `❌ No league player found for **${inputName}**.`, flags: 64 });
        }
        if (matches.length > 1) {
          const list = matches.map(m => `• ${m.name} — *${m.team?.name ?? 'Unknown team'}*`).join('\n');
          return interaction.reply({
            content: `⚠️ Multiple players named **${inputName}**.\nPlease specify the team using \`/removeplayer player:${inputName} team:<Team>\`.\n\n${list}`,
            flags: 64
          });
        }
        leaguePlayer = matches[0];
      }

      const cost = Number(leaguePlayer.cost ?? 0);

      // 4) Load current fantasy player (to build proposed roster + concurrency token)
      const fp = await FantasyPlayer.findOne(
        { discordId, season: season._id },
        { team: 1, wallet: 1, updatedAt: 1 }
      ).lean();

      if (!fp) {
        return interaction.reply({ content: '❗ Could not load your fantasy profile.', flags: 64 });
      }

      const lpIdStr = leaguePlayer._id.toString();
      const currentTeam = Array.isArray(fp.team) ? fp.team.map(x => x.toString()) : [];
      if (!currentTeam.includes(lpIdStr)) {
        return interaction.reply({ content: `❌ **${leaguePlayer.name}** is not in your fantasy team.`, flags: 64 });
      }

      // 5) Phase/limit guard — simulate the removal
      const proposed = currentTeam.filter(id => id !== lpIdStr);
      const check = await canModifyTeam(discordId, proposed);
      if (!check.allowed) {
        let msg = '⛔ Team changes are locked.';
        if (check.reason === 'SWISS_LOCKED') msg = '⛔ Team changes are locked during the swiss period.';
        else if (check.reason === 'PLAYOFFS_LOCKED') msg = '⛔ Team changes are currently locked for playoffs.';
        else if (check.reason === 'WEEK_LOCKED') msg = `⛔ Team changes are locked for week **${check.week}**.`;
        else if (check.reason === 'NO_ACTIVE_SEASON') msg = '❌ No active season set.';
        else if (check.reason === 'PLAYOFFS_LIMIT') msg = `⛔ Playoff swap limit reached. You have used **${check.swapsUsed}/${check.limit}** allowed swaps.`;
        return interaction.reply({ content: msg, flags: 64 });
      }

      // 6) Atomic remove + refund (optimistic concurrency on updatedAt)
      const updated = await FantasyPlayer.findOneAndUpdate(
        {
          discordId,
          season: season._id,
          team: leaguePlayer._id,          // must currently include this player
          updatedAt: fp.updatedAt          // prevents racing with other updates
        },
        {
          $pull: { team: leaguePlayer._id },
          ...(Number.isFinite(cost) && cost >= 0 ? { $inc: { wallet: cost } } : {}),
        },
        { new: true }
      );

      if (updated) {
        // Update the fantasyTeams field in T2TrialsPlayer
        await T2TrialsPlayer.findByIdAndUpdate(
          leaguePlayer._id,
          { $pull: { fantasyTeams: fp._id } } // Remove the fantasy player from the fantasyTeams array
        );

        await upsertWeeklyLineupSnapshot(discordId, season._id);
      }

      if (!updated) {
        // Re-check to give a friendly reason
        const latest = await FantasyPlayer.findOne({ discordId, season: season._id }, { team: 1 }).lean();
        if (!latest?.team?.some(id => id.toString() === lpIdStr)) {
          return interaction.reply({ content: `❌ **${leaguePlayer.name}** is not in your fantasy team.`, flags: 64 });
        }
        return interaction.reply({ content: '⚠️ Your team changed while processing. Please try again.', flags: 64 });
      }

      return interaction.reply({ content: `✅ Removed **${leaguePlayer.name}** from your fantasy team.`, flags: 64 });
    } catch (err) {
      console.error(err);
      const payload = { content: '❗ An error occurred while removing that player.', flags: 64 };
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
        return interaction.respond(uniqueNames.map(name => ({ name, value: name })));
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

            return interaction.respond(teams.map(t => ({ name: t.name, value: t.name })));
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

        return interaction.respond(teams.map(t => ({ name: t.name, value: t.name })));
      }

      return interaction.respond([]);
    } catch (err) {
      console.error(err);
      return interaction.respond([]);
    }
  }
};

