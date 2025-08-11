import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import Team from '../models/Team.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';
import Match from '../models/Match.js';

export default {
  data: new SlashCommandBuilder()
    .setName('buildmatchesfromstats')
    .setDescription('Admin: create Match docs from the website per-player JSON')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption(o => o.setName('week').setDescription('Week number').setMinValue(1).setRequired(true))
    .addAttachmentOption(o => o.setName('file').setDescription('Website JSON file').setRequired(true)),

  async execute(interaction) {
    if (!interaction.memberPermissions?.has('ManageGuild')) {
      return interaction.reply({ content: '❌ Admins only.', ephemeral: true });
    }

    const week = interaction.options.getInteger('week', true);
    const file = interaction.options.getAttachment('file', true);
    await interaction.deferReply({ ephemeral: true });

    // load JSON
    const res = await fetch(file.url);
    const payload = JSON.parse(await res.text());
    if (!Array.isArray(payload)) return interaction.editReply('❌ JSON root must be an array.');

    // 1) Resolve DB players for this payload and this week
    //    Also gather team ids they belong to.
    const resolved = [];
    for (const p of payload) {
      const name = String(p?.name ?? '').trim();
      if (!name) continue;
      const dbp = await T2TrialsPlayer.findOne({ name }, 'name team').lean(); // if names can collide, include team in export
      if (!dbp) continue;
      const weekObj = (Array.isArray(p.weeks) ? p.weeks : []).find(w => Number(w.week_number) === week);
      if (!weekObj) continue;

      const games = Array.isArray(weekObj.games) ? weekObj.games : [];
      resolved.push({ websiteId: Number(p.id), db: dbp, games });
    }

    // Expect 6 players total → two teams of 3
    const byTeam = new Map(); // teamId -> [resolved players]
    for (const r of resolved) {
      const key = String(r.db.team);
      if (!byTeam.has(key)) byTeam.set(key, []);
      byTeam.get(key).push(r);
    }
    if (byTeam.size !== 2) {
      return interaction.editReply(`❌ Expected exactly 2 teams in week ${week}, found ${byTeam.size}.`);
    }
    const [[teamAId, teamAPlayers], [teamBId, teamBPlayers]] = [...byTeam.entries()];
    const teamA = await Team.findById(teamAId);
    const teamB = await Team.findById(teamBId);

    // 2) Determine how many rounds happened (max round seen in games)
    const maxRound = Math.max(
      ...resolved.flatMap(r => r.games.map(g => Number(g.round) || 0))
    );
    const roundsCount = Math.min(Math.max(maxRound, 2), 3); // clamp 2..3

    // 3) Aggregate wins per round per team
    const roundAgg = []; // [{roundNumber, teamAWins, teamBWins, winner, type}]
    for (let rn = 1; rn <= roundsCount; rn++) {
      let aWins = 0, bWins = 0;
      for (const r of teamAPlayers) {
        for (const g of r.games) if (Number(g.round) === rn && Number(g.winner_id) === r.websiteId) aWins++;
      }
      for (const r of teamBPlayers) {
        for (const g of r.games) if (Number(g.round) === rn && Number(g.winner_id) === r.websiteId) bWins++;
      }
      const type = rn < 3 ? 'best-of-9' : 'best-of-3';
      const threshold = rn < 3 ? 5 : 2;
      const winner = (aWins >= threshold && aWins > bWins) ? 'A'
                   : (bWins >= threshold && bWins > aWins) ? 'B'
                   : 'None';
      roundAgg.push({ roundNumber: rn, type, teamAWins: aWins, teamBWins: bWins, winner });
    }

    // 4) Overall winner
    const aRounds = roundAgg.filter(r => r.winner === 'A').length;
    const bRounds = roundAgg.filter(r => r.winner === 'B').length;
    const matchWinner = aRounds > bRounds ? 'A' : aRounds < bRounds ? 'B' : 'None';

    // 5) PlayersResults totals (wins/losses in this week)
    const playersResults = [];
    for (const r of [...teamAPlayers, ...teamBPlayers]) {
      let wins = 0, losses = 0;
      for (const g of r.games) {
        if (Number(g.round) >= 1 && Number(g.round) <= roundsCount) {
          const win = Number(g.winner_id) === r.websiteId;
          if (win) wins++; else losses++;
        }
      }
      playersResults.push({ player: r.db._id, wins, losses });
    }

    // 6) Prevent duplicate match and create
    const existing = await Match.findOne({ week, teamA: teamA._id, teamB: teamB._id });
    if (existing) {
      return interaction.editReply(`❌ Match already exists for Week ${week}: ${teamA.name} vs ${teamB.name}`);
    }

    await Match.create([{
      week,
      teamA: teamA._id,
      teamB: teamB._id,
      rounds: roundAgg.map(r => ({
        roundNumber: r.roundNumber,
        type: r.type,
        teamAWins: r.teamAWins,
        teamBWins: r.teamBWins,
        winner: r.winner
      })),
      winner: matchWinner,
      playersResults
    }]);

    return interaction.editReply(`✅ Built match for Week ${week}: ${teamA.name} vs ${teamB.name}`);
  }
};