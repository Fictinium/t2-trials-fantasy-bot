import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';
import getActiveSeason from '../utils/getActiveSeason.js';
import T2TrialsPlayer from '../models/T2TrialsPlayer.js';
import Team from '../models/Team.js';
import { escapeRegex } from '../utils/escapeRegex.js';

const PAGE_SIZE = 20;

export default {
  data: new SlashCommandBuilder()
    .setName('playersbycost')
    .setDescription('List all T2 Trials players sorted by cost (highest first)')
    .addStringOption(opt =>
      opt.setName('team')
        .setDescription('Optional team filter')
        .setAutocomplete(true)
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
      return interaction.reply({ content: 'No active season set.', flags: 64 });
    }

    const teamName = interaction.options.getString('team') || null;
    const ephemeral = interaction.options.getBoolean('ephemeral') ?? false;

    let teamFilter = null;
    if (teamName) {
      const teamDoc = await Team.findOne({
        season: season._id,
        name: { $regex: `^${escapeRegex(teamName)}$`, $options: 'i' }
      })
        .select('_id name')
        .lean();

      if (!teamDoc) {
        return interaction.reply({ content: `Team "${teamName}" not found.`, flags: 64 });
      }
      teamFilter = teamDoc;
    }

    const query = { season: season._id, hiddenFromFantasy: { $ne: true } };
    if (teamFilter?._id) query.team = teamFilter._id;

    const players = await T2TrialsPlayer.find(query)
      .select('name cost team')
      .populate('team', 'name')
      .sort({ cost: -1, name: 1 })
      .lean();

    if (!players.length) {
      return interaction.reply({
        content: teamFilter
          ? `No players found for team **${teamFilter.name}** in the active season.`
          : 'No players found for the active season.',
        flags: 64
      });
    }

    const totalPages = Math.max(1, Math.ceil(players.length / PAGE_SIZE));
    let page = 0;

    const buildEmbed = (pageIndex) => {
      const start = pageIndex * PAGE_SIZE;
      const end = Math.min(start + PAGE_SIZE, players.length);
      const slice = players.slice(start, end);

      const lines = slice.map((p, i) => {
        const rank = start + i + 1;
        const teamName = p.team?.name || 'Unknown Team';
        const cost = Number.isFinite(p.cost) ? p.cost : 0;
        return `${rank}. ${p.name} (${teamName}) - ${cost}`;
      });

      return new EmbedBuilder()
        .setTitle(teamFilter ? `${season.name} ${teamFilter.name} Players by Cost` : `${season.name} Players by Cost`)
        .setDescription(lines.join('\n'))
        .setFooter({ text: `Page ${pageIndex + 1} of ${totalPages} | Players ${start + 1}-${end} of ${players.length}` });
    };

    const buildRows = (pageIndex) => {
      const prev = new ButtonBuilder()
        .setCustomId(`pbc_prev_${interaction.id}`)
        .setLabel('Prev')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(pageIndex === 0);

      const next = new ButtonBuilder()
        .setCustomId(`pbc_next_${interaction.id}`)
        .setLabel('Next')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(pageIndex >= totalPages - 1);

      return [new ActionRowBuilder().addComponents(prev, next)];
    };

    const message = await interaction.reply({
      embeds: [buildEmbed(page)],
      components: buildRows(page),
      flags: ephemeral ? 64 : undefined,
      fetchReply: true
    });

    const filter = i =>
      i.user.id === interaction.user.id &&
      (i.customId === `pbc_prev_${interaction.id}` || i.customId === `pbc_next_${interaction.id}`);

    const collector = message.createMessageComponentCollector({
      filter,
      time: 5 * 60 * 1000
    });

    collector.on('collect', async i => {
      try {
        if (i.customId === `pbc_prev_${interaction.id}` && page > 0) page--;
        if (i.customId === `pbc_next_${interaction.id}` && page < totalPages - 1) page++;

        await i.update({
          embeds: [buildEmbed(page)],
          components: buildRows(page)
        });
      } catch (err) {
        console.error(err);
        try { await i.deferUpdate(); } catch {}
      }
    });

    collector.on('end', async () => {
      try {
        await message.edit({ components: [] });
      } catch {}
    });
  },

  async autocomplete(interaction) {
    try {
      const focused = interaction.options.getFocused(true);
      if (focused?.name !== 'team') {
        return interaction.respond([]);
      }

      const focusedValue = focused?.value || '';
      const season = await getActiveSeason();
      if (!season) {
        return interaction.respond([]);
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
    } catch (err) {
      console.error(err);
      return interaction.respond([]);
    }
  }
};
