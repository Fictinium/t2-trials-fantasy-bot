import './keepalive.js';
import './models/modelsIndex.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { Client, Collection, Events, REST, Routes, GatewayIntentBits, Partials } from 'discord.js';
import { startWeeklyJob } from './jobs/weeklyImport.js';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import os from 'os';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.GuildMember, Partials.Channel]
});
client.commands = new Collection();

// Load commands dynamically
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js') && !file.startsWith('.'));

const commandsArray = [];

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);

  // Convert to file:// URL for ESM dynamic import
  const fileUrl = pathToFileURL(filePath).href;

  try {
    const { default: command } = await import(fileUrl);

    if (!command?.data?.name || typeof command.execute !== 'function') {
      console.warn(`Skipped "${file}" - missing data.name or execute()`);
      continue;
    }

    client.commands.set(command.data.name, command);
    commandsArray.push(command.data.toJSON()); // for API registration
    console.log(`Loaded command: ${command.data.name}`);

  } catch (err) {
    console.error(`Error loading command file "${file}":`, err);
  }
}

// Connect to MongoDB
const mongoUri = process.env.MONGO_URI;

mongoose.connect(mongoUri, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('Connected to MongoDB')).catch((error) => {console.error('MongoDB connection error:', error)});

//startWeeklyJob();
//console.log('📅 Weekly import job scheduled');

const token = process.env.TOKEN;

//---------------------------------------------------------------------------------------------------------------------------------------------------------------------

client.once(Events.ClientReady, async c => {
  console.log(`Logged in as ${c.user.username}`)

  console.log(`[READY] ${c.user.tag} on ${os.hostname()} (pid ${process.pid})`);
  c.user.setPresence({ activities: [{ name: 'DEV' }], status: 'online' });

  const rest = new REST({ version: '10' }).setToken(token);

  try {
    console.log(`Registering ${commandsArray.length} application commands...`);
    await rest.put(
        Routes.applicationCommands(c.user.id), // Global commands
        { body: commandsArray }
    );
    console.log('Successfully registered application commands.');
  } catch (error) {
    console.error('Error registering commands:', error);
  }
});

client.on(Events.InteractionCreate, async interaction => {
  console.log('Interaction:', {
    id: interaction.id,
    type: interaction.type,
    commandName: interaction.commandName,
    customId: interaction.customId,
  });

  // Slash commands
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(error);
      const payload = { content: 'There was an error executing this command!', flags: 64 }; // 64 = Ephemeral

      try {
        if (interaction.deferred) {
          await interaction.editReply(payload);
        } else if (!interaction.replied) {
          await interaction.reply(payload);
        } else {
          await interaction.followUp(payload);
        }
      } catch (e) {
        console.error('Failed to send error notice:', e);
      }
    }
    return;
  }

  // String/role/user select menus & buttons
  if (interaction.isStringSelectMenu() || interaction.isButton()) {
    try {
      // Route to your component handler or the command module that created them
      // e.g., playersBook handles its own customIds:
      const customId = interaction.customId;
      // dispatch based on customId
    } catch (error) {
      console.error(error);
      const payload = { content: 'There was an error handling that action.', flags: 64 };
      try {
        if (interaction.deferred) await interaction.editReply(payload);
        else if (!interaction.replied) await interaction.reply(payload);
        else await interaction.followUp(payload);
      } catch {}
    }
  }
});

await client.login(token);