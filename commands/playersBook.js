import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType
} from 'discord.js';
import Team from '../models/Team.js';

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
    const ephemeral = interaction.options.getBoolean('ephemeral') ?? false;

    // Load teams + players (name + cost only)
    const teams = await Team.find()
      .sort({ name: 1 })
      .populate({ path: 'players', select: 'name cost', options: { sort: { cost: -1, name: 1 } } })
      .lean();

    if (!teams.length) {
      return interaction.reply({ content: 'No teams found.', ephemeral: true });
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
      const select = new StringSelectMenuBuilder()
        .setCustomId(`pb_sel_${interaction.id}`)
        .setPlaceholder('Select a team')
        .addOptions(options)
        .setMinValues(1)
        .setMaxValues(1)
        .setDefaultValues([String(i)]); // highlight current

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

      return [
        new ActionRowBuilder().addComponents(select),
        new ActionRowBuilder().addComponents(prev, next)
      ];
    };

    const message = await interaction.reply({
      embeds: [buildEmbed(index)],
      components: buildRows(index),
      ephemeral
    });

    // Collect only from the user who invoked, for 5 minutes
    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.ActionRow, // workaround: we’ll filter inside
      time: 5 * 60 * 1000
    });

    collector.on('collect', async (i) => {
      if (i.user.id !== interaction.user.id) {
        return i.reply({ content: 'This menu is not for you.', ephemeral: true });
      }

      try {
        if (i.isStringSelectMenu() && i.customId === `pb_sel_${interaction.id}`) {
          index = Number(i.values[0]) || 0;
        } else if (i.isButton()) {
          if (i.customId === `pb_prev_${interaction.id}` && index > 0) index--;
          if (i.customId === `pb_next_${interaction.id}` && index < teams.length - 1) index++;
        } else {
          return i.deferUpdate(); // ignore other components
        }

        await i.update({
          embeds: [buildEmbed(index)],
          components: buildRows(index)
        });
      } catch (err) {
        console.error(err);
      }
    });

    collector.on('end', async () => {
      try {
        await message.edit({ components: [] }); // disable controls when time’s up
      } catch {}
    });
  }
};
