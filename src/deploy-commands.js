require('dotenv').config();
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord.js');

const commands = [
    ...require('./commands/freereels').data,
    ...require('./commands/reelshort').data,
    ...require('./commands/cari').data
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

(async () => {
    try {
        console.log('Mendaftarkan slash commands...');
        await rest.put(
            Routes.applicationCommands(process.env.DISCORD_APPLICATION_ID),
            { body: commands }
        );
        console.log('Slash commands berhasil didaftarkan!');
    } catch (err) {
        console.error('Gagal mendaftarkan commands:', err);
        process.exit(1);
    }
})();
