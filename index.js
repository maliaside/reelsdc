require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const freereelsCmd = require('./src/commands/freereels');

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

client.commands = new Collection();
for (const cmd of freereelsCmd.data) {
    client.commands.set(cmd.name, freereelsCmd);
}

client.once('ready', () => {
    console.log(`Bot online sebagai ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction);
    } catch (err) {
        console.error(`Error menjalankan ${interaction.commandName}:`, err);
        const reply = { content: 'Terjadi kesalahan saat menjalankan perintah.', ephemeral: true };
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(reply).catch(() => {});
        } else {
            await interaction.reply(reply).catch(() => {});
        }
    }
});

client.login(process.env.DISCORD_BOT_TOKEN);
