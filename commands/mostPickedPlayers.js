import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import getActiveSeason from '../utils/getActiveSeason.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';
import FantasyPlayer from '../models/FantasyPlayer.js';
import FantasyConfig from '../models/FantasyConfig.js';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

function isLegacyOpenPhase(phase) {
  return phase === 'PRESEASON' || phase === 'PLAYOFFS_OPEN';
}

function toPlainCounts(maybeMapLike) {
  if (!maybeMapLike) return {};
  if (maybeMapLike instanceof Map) {
    return Object.fromEntries(maybeMapLike.entries());
  }
  if (typeof maybeMapLike.toObject === 'function') {
    return maybeMapLike.toObject();
  }
  return { ...maybeMapLike };
}

function mergeCounts(base, extra) {
  const out = { ...base };
  for (const [playerId, count] of Object.entries(extra || {})) {
    const n = Number(count || 0);
    if (!n) continue;
    out[playerId] = Number(out[playerId] || 0) + n;
  }
  return out;
}

function hashCounts(counts) {
  return Object.entries(counts || {})
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([id, c]) => `${id}:${Number(c || 0)}`)
    .join('|');
}

function extractPendingSnapshot(cfg) {
  const pending = cfg?.legacyPickStats?.pendingClosedSnapshot;
  if (!pending) {
    return { phase: null, counts: {}, teamHash: null };
  }
  return {
    phase: pending.phase ?? null,
    counts: toPlainCounts(pending.counts),
    teamHash: pending.teamHash ?? null
  };
}

function applyPendingSnapshot(cfg, { phase, counts, teamHash }) {
  cfg.legacyPickStats = cfg.legacyPickStats || {};
  cfg.legacyPickStats.pendingClosedSnapshot = {
    phase: phase ?? null,
    counts: counts || {},
    teamHash: teamHash ?? null,
    capturedAt: new Date()
  };
}

function clearPendingSnapshot(cfg) {
  applyPendingSnapshot(cfg, { phase: null, counts: {}, teamHash: null });
}

function snapshotCountsToPlain(snapshot) {
  return toPlainCounts(snapshot?.counts);
}

function sumWeeklySnapshots(snapshots, { excludeWeek = null } = {}) {
  let total = {};
  for (const snap of (snapshots || [])) {
    const week = Number(snap?.week || 0);
    if (excludeWeek !== null && week === Number(excludeWeek)) continue;
    total = mergeCounts(total, snapshotCountsToPlain(snap));
  }
  return total;
}

async function buildLiveCountsByPlayerId(seasonId) {
  const fantasyTeams = await FantasyPlayer.find({ season: seasonId }, { team: 1 }).lean();
  const liveCounts = {};

  for (const fp of fantasyTeams) {
    const uniqueTeamPlayerIds = [...new Set((fp?.team || []).map(id => String(id)))];
    for (const playerId of uniqueTeamPlayerIds) {
      liveCounts[playerId] = Number(liveCounts[playerId] || 0) + 1;
    }
  }

  return liveCounts;
}

export default {
  data: new SlashCommandBuilder()
    .setName('mostpickedplayers')
    .setDescription('Show the most-picked players in fantasy teams')
    .addIntegerOption(opt =>
      opt.setName('limit')
        .setDescription(`How many entries to show (max ${MAX_LIMIT})`)
        .setMinValue(3)
        .setMaxValue(MAX_LIMIT)
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
    const limit = interaction.options.getInteger('limit') ?? DEFAULT_LIMIT;
    const ephemeral = interaction.options.getBoolean('ephemeral') ?? false;

    // Fetch all players for display metadata
    const players = await T2TrialsPlayer.find({ season: season._id })
      .populate('team', 'name') // Populate team name
      .lean();

    if (!players.length) {
      return interaction.reply({ content: 'ℹ️ No players found for this season.', flags: 64 });
    }

    const liveCounts = await buildLiveCountsByPlayerId(season._id);

    let displayCounts = liveCounts;
    let cfg = await FantasyConfig.findOne({ season: season._id });
    if (!cfg) {
      cfg = await FantasyConfig.create({
        season: season._id,
        seasonName: season.name,
        phase: 'PRESEASON',
        scoringMode: 'LEGACY_PHASE',
        weeklyTransferPhase: 'OPEN',
        currentWeek: 1,
        playoffSwapLimit: 3,
        maxWallet: 110
      });
    }

    const scoringMode = cfg.scoringMode ?? 'LEGACY_PHASE';
    if (scoringMode === 'LEGACY_PHASE') {
      cfg.legacyPickStats = cfg.legacyPickStats || {};

      const cumulative = toPlainCounts(cfg.legacyPickStats.cumulativeCounts);
      const pending = extractPendingSnapshot(cfg);
      const phase = cfg.phase ?? 'PRESEASON';
      const open = isLegacyOpenPhase(phase);

      let changed = false;

      if (open) {
        const hasPending = Object.keys(pending.counts).length > 0;
        if (hasPending) {
          cfg.legacyPickStats.cumulativeCounts = mergeCounts(cumulative, pending.counts);
          clearPendingSnapshot(cfg);
          changed = true;
        }

        const mergedBase = changed
          ? toPlainCounts(cfg.legacyPickStats.cumulativeCounts)
          : cumulative;
        displayCounts = mergeCounts(mergedBase, liveCounts);
      } else {
        const currentHash = hashCounts(liveCounts);
        if (pending.teamHash !== currentHash || pending.phase !== phase) {
          applyPendingSnapshot(cfg, { phase, counts: liveCounts, teamHash: currentHash });
          changed = true;
        }

        const snapshotCounts = changed
          ? toPlainCounts(cfg.legacyPickStats.pendingClosedSnapshot?.counts)
          : pending.counts;
        displayCounts = mergeCounts(cumulative, snapshotCounts);
      }

      if (changed) {
        await cfg.save();
      }
    } else if (scoringMode === 'WEEKLY_SNAPSHOT') {
      const currentWeek = Number(cfg.currentWeek) || 1;
      const weeklyTransferPhase = cfg.weeklyTransferPhase ?? 'OPEN';

      cfg.weeklyPickStats = cfg.weeklyPickStats || {};
      cfg.weeklyPickStats.weekSnapshots = Array.isArray(cfg.weeklyPickStats.weekSnapshots)
        ? cfg.weeklyPickStats.weekSnapshots
        : [];

      const snapshots = cfg.weeklyPickStats.weekSnapshots;
      const currentHash = hashCounts(liveCounts);
      let changed = false;

      if (weeklyTransferPhase === 'LOCKED') {
        const idx = snapshots.findIndex(s => Number(s?.week) === currentWeek);
        if (idx >= 0) {
          const prevHash = snapshots[idx]?.teamHash ?? null;
          if (prevHash !== currentHash) {
            snapshots[idx].counts = liveCounts;
            snapshots[idx].teamHash = currentHash;
            snapshots[idx].capturedAt = new Date();
            changed = true;
          }
        } else {
          snapshots.push({
            week: currentWeek,
            counts: liveCounts,
            teamHash: currentHash,
            capturedAt: new Date()
          });
          changed = true;
        }

        displayCounts = sumWeeklySnapshots(snapshots);
      } else {
        const historical = sumWeeklySnapshots(snapshots, { excludeWeek: currentWeek });
        displayCounts = mergeCounts(historical, liveCounts);
      }

      if (changed) {
        await cfg.save();
      }
    }

    // Count how many fantasy teams each player is in
    const playerCounts = players.map(p => ({
        name: p.name,
        team: p.team?.name || 'Unknown Team',
        count: Number(displayCounts[String(p._id)] || 0)
    }));

    // Sort players by count (descending) and then by name
    playerCounts.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name);
    });

    // Limit the output
    const topPlayers = playerCounts.slice(0, Math.min(limit, MAX_LIMIT));

    // Render the leaderboard
    const lines = topPlayers.map((p, i) => {
      const rank = i + 1;
      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
      return `${medal} **${p.name}** (${p.team}) — ${p.count} picks`;
    });

    const embed = new EmbedBuilder()
      .setTitle(`Most-Picked Players in Fantasy Teams (${season.name})`)
      .setDescription(lines.join('\n') || 'No results.')
      .setFooter({ text: `Showing top ${topPlayers.length} players` });

    return interaction.reply({ embeds: [embed], flags: ephemeral ? 64 : undefined });
  }
};