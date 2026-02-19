import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { escapeRegex } from '../utils/escapeRegex.js';
import { isAuthorizedForCommand } from '../utils/commandAuth.js';
import getActiveSeason from '../utils/getActiveSeason.js';
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
    // allow Guild admins, OWNER_IDS, or roles listed in AUTHORIZATION_ROLE_IDS
    const allowed = await isAuthorizedForCommand(interaction, { allowedRoleEnvVar: 'AUTHORIZATION_ROLE_IDS', allowGuildAdmins: true });
    if (!allowed) {
      return interaction.reply({ content: '❌ You do not have permission to run this command.', flags: 64 });
    }

    const season = await getActiveSeason();
    if (!season) {
      return interaction.reply({ content: '❌ No active season set.', flags: 64 });
    }

    const file = interaction.options.getAttachment('file', true);
    await interaction.deferReply({ flags: 64 });

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

    let updatedPlayers = 0, createdPlayers = 0, skipped = 0, notFoundNoTeam = 0, teamCreated = 0;

    for (const p of payload) {
      const playerIdNum   = Number(p?.id);
      const fantasyCost   = Math.max(0, Number(p?.fantasy_points ?? 0));
      const weeks         = Array.isArray(p?.weeks) ? p.weeks : [];

      // Lookup player by externalId
      let dbPlayer = null;
      if (Number.isFinite(playerIdNum)) {
        dbPlayer = await T2TrialsPlayer.findOne({ externalId: playerIdNum, season: season._id }).populate('team');
      }
      if (!dbPlayer) { skipped++; continue; }

      // Use player's name and team from DB
      const playerNameRaw = dbPlayer.name;
      const teamDoc = dbPlayer.team;
      if (!playerNameRaw || !teamDoc) { notFoundNoTeam++; continue; }

      // 3) Build performance map (ignore null winners)
      const perfByWeek = new Map();
      for (const w of weeks) {
        const weekNum = Number(w?.week_number);
        const games = Array.isArray(w?.games) ? w.games : [];
        if (!weekNum) continue;

        // Build sets/rounds/games structure
        const setsMap = new Map(); // setNumber -> Map(roundNumber -> [games])
        for (const g of games) {
          const setNumber = Number(g?.set) || 1;
          const roundNumber = Number(g?.round) || 1;
          if (!setsMap.has(setNumber)) setsMap.set(setNumber, new Map());
          const roundsMap = setsMap.get(setNumber);
          if (!roundsMap.has(roundNumber)) roundsMap.set(roundNumber, []);
          roundsMap.get(roundNumber).push({
            playerId: playerIdNum,
            opponentId: Number(g?.opponent_id),
            winnerId: Number(g?.winner_id),
            set: setNumber,
            round: roundNumber
          });
        }

        // Compose sets/rounds/games array
        const sets = [];
        let totalWins = 0, totalLosses = 0;
        for (const [setNumber, roundsMap] of setsMap.entries()) {
          const rounds = [];
          for (const [roundNumber, gamesArr] of roundsMap.entries()) {
            const games = gamesArr.map(g => {
              let winner = 'None';
              if (g.winnerId === g.playerId) winner = 'A';
              else if (g.winnerId === g.opponentId) winner = 'B';
              // Count wins/losses for this player
              if (winner === 'A') totalWins++;
              else if (winner === 'B') totalLosses++;
              return {
                playerA: g.playerId,
                playerB: g.opponentId,
                winner,
                set: g.set,
                round: g.round
              };
            });
            rounds.push({ roundNumber, games });
          }
          sets.push({ setNumber, rounds });
        }

        perfByWeek.set(weekNum, {
          week: weekNum,
          wins: totalWins,
          losses: totalLosses,
          sets
        });
      }

      // 4) Create or update
      if (!dbPlayer) {
        // CREATE even if performance is empty — players still need to exist for browsing & picking
        dbPlayer = await T2TrialsPlayer.create({
          externalId: Number.isFinite(playerIdNum) ? playerIdNum : undefined,
          name: playerNameRaw,
          team: teamDoc._id,
          cost: fantasyCost,
          performance: [...perfByWeek.values()].sort((a, b) => a.week - b.week),
          season: season._id
        });

        // Link into Team
        await Team.updateOne({ _id: teamDoc._id }, { $addToSet: { players: dbPlayer._id } });
        createdPlayers++;
        continue;
      }

      // UPDATE existing
      let anyChange = false;

      // Move to correct team if changed
      if (String(dbPlayer.team) !== String(teamDoc._id)) {
        await Team.updateOne({ _id: dbPlayer.team }, { $pull: { players: dbPlayer._id } });
        await Team.updateOne({ _id: teamDoc._id }, { $addToSet: { players: dbPlayer._id } });
        dbPlayer.team = teamDoc._id;
        anyChange = true;
      }

      // Upsert weekly entries
      for (const entry of perfByWeek.values()) {
        const idx = dbPlayer.performance.findIndex(e => e.week === entry.week);
        if (idx >= 0) dbPlayer.performance[idx] = entry;
        else dbPlayer.performance.push(entry);
        anyChange = true;
      }

      // Cost refresh
      if (Number.isFinite(fantasyCost) && dbPlayer.cost !== fantasyCost) {
        dbPlayer.cost = fantasyCost;
        anyChange = true;
      }

      // Backfill externalId
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
      `✅ Import complete.\n` +
      `• Created players: **${createdPlayers}**\n` +
      `• Updated players: **${updatedPlayers}**\n` +
      `• Teams created: **${teamCreated}**\n` +
      `• Skipped: **${skipped}**\n` +
      `• Not found / no team: **${notFoundNoTeam}**`
    );
  }
};