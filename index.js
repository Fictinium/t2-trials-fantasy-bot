import './keepalive.js';
import './models/modelsIndex.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { Client, Collection, Events, REST, Routes } from 'discord.js';
import { startWeeklyJob } from './jobs/weeklyImport.js';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const client = new Client({ intents: [] });
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

startWeeklyJob();
console.log('📅 Weekly import job scheduled');

const token = process.env.TOKEN;

//---------------------------------------------------------------------------------------------------------------------------------------------------------------------

client.once(Events.ClientReady, async c => {
    console.log(`Logged in as ${c.user.username}`)

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
    console.log(interaction);

    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) {
        console.warn(`Unknown command: ${interaction.commandName}`);
        return;
    }

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        await interaction.reply({ content: 'There was an error executing this command!', ephemeral: true });
    }
});

client.login(token);