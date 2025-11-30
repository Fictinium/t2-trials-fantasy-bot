import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';
import { getActiveSeason } from '../utils/getActiveSeason.js';
import Team from '../models/Team.js';

const PAGE_SIZE = 25;

export default {
  data: new SlashCommandBuilder()
    .setName('playersbook')
    .setDescription('Browse all T2 Trials players and their costs, team by team')
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
    const ephemeral = interaction.options.getBoolean('ephemeral') ?? false;

    // Load teams + players (name + cost only)
    const teams = await Team.find({season: season._id})
      .sort({ name: 1 })
      .populate({ path: 'players', select: 'name cost', options: { sort: { cost: -1, name: 1 } } })
      .lean();

    if (!teams.length) {
      return interaction.reply({ content: 'No teams found.', flags: 64 });
    }

    // Build quick lookup for select menu
    const options = teams.slice(0, 25).map((t, i) => ({
      label: t.name,
      value: String(i) // store index as value
    }));

    let index = 0;

    const buildEmbed = (i) => {
      const t = teams[i];
      const lines = (t.players || []).map(p => `• **${p.name}** — ${p.cost}`);
      return new EmbedBuilder()
        .setTitle(`${t.name} — Players & Costs`)
        .setDescription(lines.length ? lines.join('\n') : '_No players_')
        .setFooter({ text: `Team ${i + 1} of ${teams.length}` });
    };

    const buildRows = (i) => {
      const totalPages = Math.ceil(teams.length / PAGE_SIZE);
      const page = Math.floor(i / PAGE_SIZE);
      const start = page * PAGE_SIZE;
      const end = Math.min(start + PAGE_SIZE, teams.length);

      // Only show options for the current page; values store the ABSOLUTE team index
      const menuOptions = teams.slice(start, end).map((t, absIdx) => {
        const globalIdx = start + absIdx;
        return {
          label: t.name,
          value: String(globalIdx),
          default: globalIdx === i,
        };
      });

      const select = new StringSelectMenuBuilder()
        .setCustomId(`pb_sel_${interaction.id}`)
        .setPlaceholder(`Select a team — Page ${page + 1}/${totalPages}`)
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(menuOptions);

      const prevPage = new ButtonBuilder()
        .setCustomId(`pb_page_prev_${interaction.id}`)
        .setLabel('« Page')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0);

      const prev = new ButtonBuilder()
        .setCustomId(`pb_prev_${interaction.id}`)
        .setLabel('Prev')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(i === 0);

      const next = new ButtonBuilder()
        .setCustomId(`pb_next_${interaction.id}`)
        .setLabel('Next')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(i === teams.length - 1);

      const nextPage = new ButtonBuilder()
        .setCustomId(`pb_page_next_${interaction.id}`)
        .setLabel('Page »')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1);

      return [
        new ActionRowBuilder().addComponents(select),
        new ActionRowBuilder().addComponents(prevPage, prev, next, nextPage)
      ];
    };

    const message = await interaction.reply({
      embeds: [buildEmbed(index)],
      components: buildRows(index),
      flags: ephemeral ? 64 : undefined,
      fetchReply: true
    });

    const filter = (i) =>
      i.user.id === interaction.user.id &&
      (
        i.customId === `pb_sel_${interaction.id}` ||
        i.customId === `pb_prev_${interaction.id}` ||
        i.customId === `pb_next_${interaction.id}` ||
        i.customId === `pb_page_prev_${interaction.id}` ||
        i.customId === `pb_page_next_${interaction.id}`
      );

    // Collect only from the user who invoked, for 5 minutes
    const collector = message.createMessageComponentCollector({
      filter,
      time: 5 * 60 * 1000
    });

    collector.on('collect', async (i) => {
      try {
        if (i.isStringSelectMenu()) {
          index = Math.min(Math.max(Number(i.values[0]) || 0, 0), teams.length - 1);
        } else if (i.isButton()) {
          if (i.customId === `pb_prev_${interaction.id}` && index > 0) index--;
          if (i.customId === `pb_next_${interaction.id}` && index < teams.length - 1) index++;
          if (i.customId === `pb_page_prev_${interaction.id}`) {
            const page = Math.floor(index / PAGE_SIZE);
            if (page > 0) index = (page - 1) * PAGE_SIZE; // first item of previous page
          }
          if (i.customId === `pb_page_next_${interaction.id}`) {
            const page = Math.floor(index / PAGE_SIZE);
            const nextStart = (page + 1) * PAGE_SIZE;
            if (nextStart < teams.length) index = nextStart; // first item of next page
          }
        }

        await i.update({
          embeds: [buildEmbed(index)],
          components: buildRows(index)
        });
      } catch (err) {
        console.error(err);
        try { await i.deferUpdate(); } catch {}
      }
    });

    collector.on('end', async () => {
      try {
        await message.edit({ components: [] }); // disable controls when time’s up
      } catch {}
    });
  }
};
