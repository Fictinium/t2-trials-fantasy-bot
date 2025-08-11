import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import Team from '../models/Team.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';

export default {
  data: new SlashCommandBuilder()
    .setName('importstatsjson')
    .setDescription('Admin: import per-player weekly stats JSON (updates rounds & totals)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addAttachmentOption(o =>
      o.setName('file')
       .setDescription('JSON file exported from the T2 Trials website')
       .setRequired(true)
    ),

  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.memberPermissions?.has('ManageGuild')) {
      return interaction.reply({ content: '❌ Admins only.', ephemeral: true });
    }

    const file = interaction.options.getAttachment('file', true);
    await interaction.deferReply({ ephemeral: true });

    // Fetch & parse
    let payload;
    try {
      const res = await fetch(file.url);
      const text = await res.text();
      payload = JSON.parse(text);
      if (!Array.isArray(payload)) throw new Error('Root must be an array of players.');
    } catch (e) {
      return interaction.editReply(`❌ Invalid JSON: ${e.message}`);
    }

    let updatedPlayers = 0, createdPlayers = 0, skipped = 0, notFound = 0, teamCreated = 0;

    for (const p of payload) {
      const playerIdNum = Number(p?.id);
      const playerName = String(p?.name ?? '').trim();
      const fantasyCost = Math.max(0, Number(p?.fantasy_points ?? 0));
      const teamNameRaw   = p?.team_name ? String(p.team_name).trim() : null;
      const weeks = Array.isArray(p?.weeks) ? p.weeks : [];

      if (!playerName || !weeks.length) { skipped++; continue; }
      if (!teamNameRaw) {
        notFound++;
        console.warn(`No team_name for player "${playerName}" – skipping`);
        continue;
      }

      // 1) Ensure Team exists
      let teamDoc = await Team.findOne({ name: teamNameRaw });
      if (!teamDoc) {
        teamDoc = await Team.create({ name: teamNameRaw, players: [] });
        teamCreated++;
      }

      // 2) Find player (prefer externalId, else name+team)
      let dbPlayer = null;
      if (Number.isFinite(playerIdNum)) {
        dbPlayer = await T2TrialsPlayer.findOne({ externalId: playerIdNum });
      }
      if (!dbPlayer) {
        dbPlayer = await T2TrialsPlayer.findOne({
            name: { $regex: `^${escapeRegex(playerName)}$`, $options: 'i' },
            team: teamDoc._id
        });
      }
      if (!dbPlayer) { notFound++; continue; }

      // Build a map of week -> {wins, losses, rounds[]}
      const perfByWeek = new Map();

      for (const w of weeks) {
        const weekNum = Number(w?.week_number);
        const games = Array.isArray(w?.games) ? w.games : [];
        if (!weekNum || !games.length) continue;

        // Group by round
        const byRound = new Map(); // roundNumber -> { wins, losses, duels }
        for (const g of games) {
          const roundNumber = Number(g?.round);
          if (![1,2,3].includes(roundNumber)) continue;
          if (!byRound.has(roundNumber)) byRound.set(roundNumber, { wins: 0, losses: 0, duels: 0 });

          const r = byRound.get(roundNumber);
          r.duels += 1;
          const win = Number(g?.winner_id) === playerIdNum;
          if (win) r.wins += 1; else r.losses += 1;
        }

        // Compose rounds array sorted by round
        const rounds = [...byRound.entries()]
          .sort((a,b) => a[0]-b[0])
          .map(([roundNumber, r]) => ({ roundNumber, wins: r.wins, losses: r.losses, duels: r.duels }));

        const totalWins = rounds.reduce((a, r) => a + r.wins, 0);
        const totalLosses = rounds.reduce((a, r) => a + r.losses, 0);

        perfByWeek.set(weekNum, { week: weekNum, wins: totalWins, losses: totalLosses, rounds });
      }

      if (!dbPlayer) {
        // 3A) Create new player (first-time import)
        dbPlayer = await T2TrialsPlayer.create({
          externalId: Number.isFinite(playerIdNum) ? playerIdNum : undefined,
          name: playerName,
          team: teamDoc._id,
          cost: fantasyCost,
          performance: [...perfByWeek.values()].sort((a, b) => a.week - b.week)
        });
        // Link into Team
        await Team.updateOne({ _id: teamDoc._id }, { $addToSet: { players: dbPlayer._id } });
        createdPlayers++;
        continue;
      }

      // 3B) Update existing player
      let anyChange = false;

      // attach/move to correct team if changed
      if (String(dbPlayer.team) !== String(teamDoc._id)) {
        // remove from old team list
        await Team.updateOne({ _id: dbPlayer.team }, { $pull: { players: dbPlayer._id } });
        // add to new team list
        await Team.updateOne({ _id: teamDoc._id }, { $addToSet: { players: dbPlayer._id } });
        dbPlayer.team = teamDoc._id;
        anyChange = true;
      }

      // upsert weekly entries
      for (const entry of perfByWeek.values()) {
        const idx = dbPlayer.performance.findIndex(e => e.week === entry.week);
        if (idx >= 0) dbPlayer.performance[idx] = entry;
        else dbPlayer.performance.push(entry);
        anyChange = true;
      }

      // set/refresh cost
      if (Number.isFinite(fantasyCost) && dbPlayer.cost !== fantasyCost) {
        dbPlayer.cost = fantasyCost;
        anyChange = true;
      }

      // backfill externalId
      if (Number.isFinite(playerIdNum) && !dbPlayer.externalId) {
        dbPlayer.externalId = playerIdNum;
        anyChange = true;
      }

      if (anyChange) {
        dbPlayer.performance.sort((a, b) => a.week - b.week);
        await dbPlayer.save();
        updatedPlayers++;
      } else {
        skipped++;
      }
    }

    return interaction.editReply(
      `✅ Import complete.\n• Created players: **${createdPlayers}**\n• Updated players: **${updatedPlayers}**\n• Teams created: **${teamCreated}**\n• Skipped: **${skipped}**\n• Not found / no team: **${notFound}**`
    );
  }
};

// small helper
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}