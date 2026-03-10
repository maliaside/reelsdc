require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const { startWebServer } = require('./src/webserver');
const dramaCmd = require('./src/commands/drama');
const { trackCommand } = require('./src/stats');

process.on('unhandledRejection', (reason) => {
    console.error('[UnhandledRejection]', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
    console.error('[UncaughtException]', err.message, err.stack);
});

// Keep event loop alive 24/7
setInterval(() => {}, 30_000);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.commands = new Collection();
for (const cmd of dramaCmd.data) {
    client.commands.set(cmd.name, dramaCmd);
}

client.once('clientReady', () => {
    console.log(`Bot online sebagai ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction);
    } catch (err) {
        console.error(`[interactionCreate] ${interaction.commandName}:`, err.message);
        const reply = { content: 'Terjadi kesalahan saat menjalankan perintah.', flags: 64 };
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(reply).catch(() => {});
        } else {
            await interaction.reply(reply).catch(() => {});
        }
    }
});

startWebServer();
client.login(process.env.DISCORD_BOT_TOKEN);
