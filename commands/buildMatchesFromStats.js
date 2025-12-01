import { SlashCommandBuilder, PermissionFlagsBits, ButtonStyle } from 'discord.js';
import { escapeRegex } from '../utils/escapeRegex.js';
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
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: '❌ Admins only.', flags: 64 });
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

    // build quick lookup by externalId
    const byExtId = new Map();
    const teamMap = new Map(); // extId -> 'A' | 'B'
    for (const p of await T2TrialsPlayer.find(
      { team: { $in: [teamA._id, teamB._id] }, season: season._id },
      { externalId: 1, team: 1, name: 1 }
    ).lean()) {
      if (Number.isFinite(p.externalId)) {
        byExtId.set(Number(p.externalId), p);
        teamMap.set(Number(p.externalId), String(p.team) === String(teamA._id) ? 'A' : 'B');
      }
    }

    // collect games for this week for just these two teams’ players
    const gamesByPlayerExt = new Map(); // extId -> [{ round, winner_id }]
    for (const row of payload) {
      const ext = Number(row?.id);
      if (!Number.isFinite(ext) || !byExtId.has(ext)) continue;

      const weekObj = (Array.isArray(row.weeks) ? row.weeks : []).find(w => Number(w.week_number) === week);
      if (!weekObj) continue;

      const games = Array.isArray(weekObj.games) ? weekObj.games : [];
      const filtered = games
        .map(g => ({ round: Number(g?.round), winner_id: g?.winner_id }))
        .filter(g => [1, 2, 3].includes(g.round));

      gamesByPlayerExt.set(ext, filtered);
    }

    // count per-round team wins (ignore null winners)
    const countWins = (teamLetter, rn) => {
      let wins = 0;
      for (const [extId, games] of gamesByPlayerExt.entries()) {
        if (teamMap.get(extId) !== teamLetter) continue;
        for (const g of games) {
          if (g.round !== rn) continue;
          if (g.winner_id == null) continue; // ignore unfinished/unknown
          if (Number(g.winner_id) === extId) wins++;
        }
      }
      return wins;
    };

    // determine how many rounds appeared
    const maxRound =
      Math.max(0, ...[...gamesByPlayerExt.values()].flatMap(gs => gs.map(g => g.round || 0)));
    const roundsCount = Math.min(Math.max(maxRound, 2), 3); // clamp to 2..3

    const rounds = [];
    for (let rn = 1; rn <= roundsCount; rn++) {
      const a = countWins('A', rn);
      const b = countWins('B', rn);
      const type = rn < 3 ? 'best-of-9' : 'best-of-3';
      const threshold = rn < 3 ? 5 : 2;
      const winner = (a >= threshold && a > b) ? 'A' : (b >= threshold && b > a) ? 'B' : 'None';
      rounds.push({ roundNumber: rn, type, teamAWins: a, teamBWins: b, winner });
    }

    const aRounds = rounds.filter(r => r.winner === 'A').length;
    const bRounds = rounds.filter(r => r.winner === 'B').length;
    const matchWinner = aRounds > bRounds ? 'A' : aRounds < bRounds ? 'B' : 'None';

    // per-player W/L for this week (ignore null winners)
    const playersResults = [];
    for (const [extId, games] of gamesByPlayerExt.entries()) {
      const dbp = byExtId.get(extId);
      let wins = 0, losses = 0;
      for (const g of games) {
        if (g.winner_id == null) continue;
        if (Number(g.winner_id) === extId) wins++;
        else losses++;
      }
      playersResults.push({ player: dbp._id, wins, losses });
    }

    await Match.create([{
      week,
      teamA: tLow._id,
      teamB: tHigh._id,
      rounds,
      winner: matchWinner,
      playersResults
    }]);

    return interaction.editReply(`✅ Built match for Week ${week}: ${tLow.name} vs ${tHigh.name}`);
  }
};