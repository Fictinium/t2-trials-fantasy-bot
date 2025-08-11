import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import mongoose from 'mongoose';
import Team from '../models/Team.js';
import Match from '../models/Match.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';

export default {
  data: new SlashCommandBuilder()
    .setName('addmatch')
    .setDescription('Admin: record a match and player results')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild) // admin-ish
    .addIntegerOption(opt =>
      opt.setName('week').setDescription('Week number').setMinValue(1).setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('team_a').setDescription('Team A name').setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('team_b').setDescription('Team B name').setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('results_json')
        .setDescription('JSON array of { player, wins, losses }')
        .setRequired(true)
    ),

  async execute(interaction) {
    // Basic guild/admin guard (DefaultMemberPermissions helps but double check here)
    if (!interaction.inGuild() ||
        !interaction.memberPermissions?.has('ManageGuild')) {
      return interaction.reply({ content: '❌ Admins only.', ephemeral: true });
    }

    const week = interaction.options.getInteger('week', true);
    const teamAName = interaction.options.getString('team_a', true);
    const teamBName = interaction.options.getString('team_b', true);
    const resultsJSON = interaction.options.getString('results_json', true);

    // Parse results
    let results;
    try {
      results = JSON.parse(resultsJSON);
      if (!Array.isArray(results)) throw new Error('results_json must be an array');
    } catch (e) {
      return interaction.reply({
        content: `❌ Invalid JSON in results_json. Example:\n\`[{"player":"Fict","wins":2,"losses":1}]\``,
        ephemeral: true
      });
    }

    // Load Teams
    const [teamA, teamB] = await Promise.all([
      Team.findOne({ name: teamAName }),
      Team.findOne({ name: teamBName })
    ]);

    if (!teamA || !teamB) {
      return interaction.reply({
        content: `❌ Unknown team(s): A="${teamAName}" B="${teamBName}".`,
        ephemeral: true
      });
    }

    // Prevent duplicate match per week per pair
    const existing = await Match.findOne({ week, teamA: teamA._id, teamB: teamB._id });
    if (existing) {
      return interaction.reply({
        content: `❌ Match for week ${week} between ${teamAName} vs ${teamBName} already exists.`,
        ephemeral: true
      });
    }

    // Validate players and build playersResults
    const playersResults = [];
    for (const row of results) {
      const playerName = String(row.player ?? '').trim();
      const wins = Number(row.wins ?? 0);
      const losses = Number(row.losses ?? 0);
      if (!playerName || Number.isNaN(wins) || Number.isNaN(losses)) {
        return interaction.reply({
          content: `❌ Invalid row in results_json: ${JSON.stringify(row)}`,
          ephemeral: true
        });
      }

      // Player must belong to either team A or team B
      const playerDoc = await T2TrialsPlayer.findOne({
        name: { $regex: `^${playerName}$`, $options: 'i' },
        team: { $in: [teamA._id, teamB._id] }
      });

      if (!playerDoc) {
        return interaction.reply({
          content: `❌ Player "${playerName}" not found on ${teamAName} or ${teamBName}.`,
          ephemeral: true
        });
      }

      playersResults.push({
        player: playerDoc._id,
        wins: Math.max(0, wins),
        losses: Math.max(0, losses),
      });
    }

    // Start a transaction so Match + Player performance updates stay in sync (optional but good to have)
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      // Create the Match
      const match = await Match.create([{
        week,
        teamA: teamA._id,
        teamB: teamB._id,
        rounds: [], // can be extended later
        winner: 'None',
        playersResults
      }], { session });

      // Update each player’s performance for the given week (upsert-like behavior)
      for (const pr of playersResults) {
        await T2TrialsPlayer.updateOne(
          { _id: pr.player, 'performance.week': week },
          { $set: { 'performance.$.wins': pr.wins, 'performance.$.losses': pr.losses } },
          { session }
        );

        // If no entry existed, push a new one
        await T2TrialsPlayer.updateOne(
          { _id: pr.player, 'performance.week': { $ne: week } },
          { $push: { performance: { week, wins: pr.wins, losses: pr.losses } } },
          { session }
        );
      }

      await session.commitTransaction();
      session.endSession();

      return interaction.reply({
        content: `✅ Match recorded: **${teamAName} vs ${teamBName} (Week ${week})** with ${playersResults.length} player results.`,
        ephemeral: true
      });
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      console.error(err);
      return interaction.reply({
        content: '❗ Error while saving match/results.',
        ephemeral: true
      });
    }
  }
};
