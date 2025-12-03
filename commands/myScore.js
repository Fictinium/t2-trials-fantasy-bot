import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { computePointsForPerfSimple, totalPointsForPlayer } from '../services/scoring.js';
import getActiveSeason from '../utils/getActiveSeason.js';
import isRegistered from '../utils/checkRegistration.js';
import FantasyPlayer from '../models/FantasyPlayer.js';

export default {
  data: new SlashCommandBuilder()
    .setName('myscore')
    .setDescription('View your fantasy points (overall or for a specific week)')
    .addIntegerOption(opt =>
      opt.setName('week')
        .setDescription('Show score for a specific week (1-based)')
        .setMinValue(1)
        .setRequired(false)
    )
    .addBooleanOption(opt =>
      opt.setName('ephemeral')
        .setDescription('Show only to you')
        .setRequired(false)
    ),

  async execute(interaction) {
    const season = await getActiveSeason();
    if (!season) {
      return interaction.reply({ content: '❌ No active season set.', flags: 64 });
    }
    const discordId = interaction.user.id;
    const week = interaction.options.getInteger('week') ?? null;
    const ephemeral = interaction.options.getBoolean('ephemeral') ?? false;

    // Gate: must be registered
    const registered = await isRegistered(discordId);
    if (!registered) {
      return interaction.reply({
        content: '⚠️ You must register using `/joinleague` before using this command.',
        flags: 64
      });
    }

    // Load player doc and populate team (so we can show contributors). Use stored weeklyPoints for totals.
    const user = await FantasyPlayer.findOne(
      { discordId, season: season._id },
      { username: 1, weeklyPoints: 1, totalPoints: 1, team: 1 }
    ).populate({ path: 'team', match: { season: season._id }, select: 'name username performance' })
    .lean();

    if (!user) {
      return interaction.reply({
        content: '❗ Could not find your fantasy profile. Try `/joinleague` again.',
        flags: 64
      });
    }

    const displayName = user.username || interaction.user.username;
    const weekly = Array.isArray(user.weeklyPoints) ? user.weeklyPoints : [];
    const storedTotal = Number.isFinite(user.totalPoints) ? user.totalPoints : 0;
    const team = Array.isArray(user.team) ? user.team : [];

    // Option A: specific week view -> show stored points + detailed contributor breakdown below
    if (week) {
      const idx = week - 1;
      const points = Number.isFinite(weekly[idx]) ? weekly[idx] : 0;

      const memberLines = [];
      let membersSum = 0;
      for (const member of team) {
        const mPerf = getWeekPerf(member, week);
        const mPts = computePointsForPerfSimple(mPerf);
        membersSum += mPts;
        const mName = member.name || member.username || String(member._id).slice(0, 8);
        memberLines.push(`• ${mName} → ${mPts} pts`);
      }

      if (memberLines.length === 0) memberLines.push('No player stats found for this week.');

      const embed = new EmbedBuilder()
        .setTitle(`${displayName} — Week ${week}`)
        .setDescription(`**Week ${week} points:** ${points}\n\n**Breakdown by player:**\n${memberLines.join('\n')}`)
        .setFooter({ text: `Total points: ${storedTotal}` });

      return interaction.reply({ embeds: [embed], flags: ephemeral ? 64 : undefined });
    }

    // Option B: overall breakdown -> use stored weeklyPoints for efficiency; include inline per-week contributor summary (computed only for this user's team)
    if (!weekly.length) {
      const embed = new EmbedBuilder()
        .setTitle(`${displayName} — Scores`)
        .setDescription('No weekly scores yet. An admin needs to run `/calculatescores` after matches are recorded.')
        .setFooter({ text: `Total points: ${storedTotal}` });

      return interaction.reply({ embeds: [embed], flags: ephemeral ? 64 : undefined });
    }

    // Build lines like: "Week 1 — 10 pts"
    const lines = [];
    for (let i = 0; i < weekly.length; i++) {
      const wk = i + 1;
      const pts = Number.isFinite(weekly[i]) ? weekly[i] : 0;

      // compute per-member simple contributions for inline summary (lightweight, per-team only)
      const parts = [];
      for (const member of team) {
        const mPerf = getWeekPerf(member, wk);
        const mPts = computePointsForPerfSimple(mPerf);
        if (mPts > 0) {
          const mName = member.name || member.username || String(member._id).slice(0, 8);
          parts.push(`${mName} → ${mPts}`);
        }
      }
      const inline = parts.length ? ` (${parts.join('; ')})` : '';
      lines.push(`Week ${wk} — ${pts} pts${inline}`);
    }

    const embed = new EmbedBuilder()
      .setTitle(`${displayName} — Scores`)
      .setDescription(lines.join('\n'))
      .setFooter({ text: `Total points: ${storedTotal}` });

    return interaction.reply({ embeds: [embed], flags: ephemeral ? 64 : undefined });
  }
};
