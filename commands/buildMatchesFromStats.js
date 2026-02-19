import { SlashCommandBuilder, PermissionFlagsBits, ButtonStyle } from 'discord.js';
import { escapeRegex } from '../utils/escapeRegex.js';
import { isAuthorizedForCommand } from '../utils/commandAuth.js';
import getActiveSeason from '../utils/getActiveSeason.js';
import Team from '../models/Team.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';
import Match from '../models/Match.js';

export default {
  data: new SlashCommandBuilder()
    .setName('buildmatchesfromstats')
    .setDescription('Admin: create ONE Match doc from the website per-player JSON for a given week & pair')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption(o => o.setName('week').setDescription('Week number').setMinValue(1).setRequired(true))
    .addStringOption(o => o.setName('team_a').setDescription('Team A name').setRequired(true))
    .addStringOption(o => o.setName('team_b').setDescription('Team B name').setRequired(true))
    .addAttachmentOption(o => o.setName('file').setDescription('Website JSON file').setRequired(true)),

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
    const week = interaction.options.getInteger('week', true);
    const teamAName = interaction.options.getString('team_a', true);
    const teamBName = interaction.options.getString('team_b', true);
    const file = interaction.options.getAttachment('file', true);

    await interaction.deferReply({ flags: 64 });

    // load JSON
    const res = await fetch(file.url);
    const payload = JSON.parse(await res.text());
    if (!Array.isArray(payload)) return interaction.editReply('❌ JSON root must be an array.');

    // resolve teams (case-insensitive exact)
    const [teamA, teamB] = await Promise.all([
      Team.findOne({ name: { $regex: `^${escapeRegex(teamAName)}$`, $options: 'i' }, season: season._id }),
      Team.findOne({ name: { $regex: `^${escapeRegex(teamBName)}$`, $options: 'i' }, season: season._id })
    ]);
    if (!teamA) return interaction.editReply(`❌ Team not found: ${teamAName}`);
    if (!teamB) return interaction.editReply(`❌ Team not found: ${teamBName}`);

    // canonical order for uniqueness
    const [tLow, tHigh] = String(teamA._id) < String(teamB._id) ? [teamA, teamB] : [teamB, teamA];

    // prevent duplicates (check both orders)
    const dupe = await Match.findOne({ week, teamA: tLow._id, teamB: tHigh._id, season: season._id });
    if (dupe) {
      return interaction.editReply(`❌ Match already exists for Week ${week}: ${tLow.name} vs ${tHigh.name}`);
    }

    // build quick lookup by externalId (treat as string for robustness)
    const byExtId = new Map();
    const teamMap = new Map(); // extId -> 'A' | 'B'
    for (const p of await T2TrialsPlayer.find(
      { team: { $in: [teamA._id, teamB._id] }, season: season._id },
      { externalId: 1, team: 1, name: 1 }
    ).lean()) {
      if (p.externalId !== undefined && p.externalId !== null) {
        const extIdStr = String(p.externalId);
        byExtId.set(extIdStr, p);
        teamMap.set(extIdStr, String(p.team) === String(teamA._id) ? 'A' : 'B');
      }
    }


    // --- New sets/rounds/games structure ---
    // 1. Collect all games for this week for both teams' players
    //    Each game must have: set, round, gameNumber, playerA, playerB, winner
    //    We'll build sets -> rounds -> games from this
    const allGames = [];
    for (const row of payload) {
      const ext = String(row?.id);
      if (!ext || !byExtId.has(ext)) continue;
      const weekObj = (Array.isArray(row.weeks) ? row.weeks : []).find(w => String(w.week_number) === String(week));
      if (!weekObj) continue;
      const games = Array.isArray(weekObj.games) ? weekObj.games : [];
      for (const g of games) {
        // Expect: set, round, gameNumber, opponent_id, winner_id
        const setNumber = Number(g?.set) || 1;
        const roundNumber = Number(g?.round) || 1;
        const gameNumber = Number(g?.gameNumber) || 1;
        const playerA = byExtId.get(ext)?._id;
        const playerB = byExtId.get(String(g?.opponent_id))?._id;
        if (!playerA || !playerB) continue;
        const winner = g?.winner_id == null ? 'None' : (String(g.winner_id) === ext ? 'A' : (String(g.winner_id) === String(g.opponent_id) ? 'B' : 'None'));
        allGames.push({ setNumber, roundNumber, gameNumber, playerA, playerB, winner });
      }
    }

    // 2. Group games into sets, rounds, games
    const setsMap = new Map(); // setNumber -> { rounds: Map }
    for (const game of allGames) {
      if (!setsMap.has(game.setNumber)) setsMap.set(game.setNumber, new Map());
      const roundsMap = setsMap.get(game.setNumber);
      if (!roundsMap.has(game.roundNumber)) roundsMap.set(game.roundNumber, []);
      roundsMap.get(game.roundNumber).push({
        gameNumber: game.gameNumber,
        playerA: game.playerA,
        playerB: game.playerB,
        winner: game.winner
      });
    }

    // 3. Build sets array for the Match model
    const sets = [];
    for (const [setNumber, roundsMap] of setsMap.entries()) {
      const rounds = [];
      for (const [roundNumber, gamesArr] of roundsMap.entries()) {
        // Determine round winner (majority of games)
        const aWins = gamesArr.filter(g => g.winner === 'A').length;
        const bWins = gamesArr.filter(g => g.winner === 'B').length;
        let roundWinner = 'None';
        if (aWins > bWins) roundWinner = 'A';
        else if (bWins > aWins) roundWinner = 'B';
        rounds.push({ roundNumber, games: gamesArr, winner: roundWinner });
      }
      // Determine set winner (majority of rounds)
      const aRounds = rounds.filter(r => r.winner === 'A').length;
      const bRounds = rounds.filter(r => r.winner === 'B').length;
      let setWinner = 'None';
      if (aRounds > bRounds) setWinner = 'A';
      else if (bRounds > aRounds) setWinner = 'B';
      sets.push({ setNumber, rounds, winner: setWinner });
    }

    // Determine match winner (majority of sets)
    const aSets = sets.filter(s => s.winner === 'A').length;
    const bSets = sets.filter(s => s.winner === 'B').length;
    let matchWinner = 'None';
    if (aSets > bSets) matchWinner = 'A';
    else if (bSets > aSets) matchWinner = 'B';

    // Per-player W/L for this week (count all games)
    const playerWinLoss = new Map(); // playerId -> { wins, losses }
    for (const game of allGames) {
      if (!playerWinLoss.has(String(game.playerA))) playerWinLoss.set(String(game.playerA), { wins: 0, losses: 0 });
      if (!playerWinLoss.has(String(game.playerB))) playerWinLoss.set(String(game.playerB), { wins: 0, losses: 0 });
      if (game.winner === 'A') {
        playerWinLoss.get(String(game.playerA)).wins++;
        playerWinLoss.get(String(game.playerB)).losses++;
      } else if (game.winner === 'B') {
        playerWinLoss.get(String(game.playerB)).wins++;
        playerWinLoss.get(String(game.playerA)).losses++;
      }
    }
    const playersResults = [];
    for (const [player, wl] of playerWinLoss.entries()) {
      playersResults.push({ player, wins: wl.wins, losses: wl.losses });
    }

    const match = await Match.create({
      week,
      teamA: tLow._id,
      teamB: tHigh._id,
      sets,
      winner: matchWinner,
      playersResults,
      season: season._id
    });

    // --- Update all affected real players' points after match entry ---
    const { totalPointsForPlayer, calculateScoresForWeek } = await import('../services/scoring.js');
    const playerIds = playersResults.map(pr => pr.player).filter(Boolean);
    const affectedPlayers = await T2TrialsPlayer.find({ _id: { $in: playerIds }, season: season._id });
    for (const player of affectedPlayers) {
      player.totalPoints = totalPointsForPlayer(player);
      await player.save();
    }

    // --- Recalculate all fantasy teams' scores for this week ---
    await calculateScoresForWeek(season._id, week);

    return interaction.editReply(`✅ Built match for Week ${week}: ${tLow.name} vs ${tHigh.name}. All player and fantasy team points recalculated.`);
  }
};