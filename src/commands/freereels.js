const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const api = require('../api/freereels');

function buildDramaEmbed(item, index, total) {
    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(item.title || item.name || 'Unknown Title')
        .setFooter({ text: `FreeReels • ${index + 1}/${total}` })
        .setTimestamp();

    if (item.cover || item.image || item.thumbnail) {
        embed.setImage(item.cover || item.image || item.thumbnail);
    }
    if (item.description || item.desc || item.synopsis) {
        const desc = item.description || item.desc || item.synopsis;
        embed.setDescription(desc.length > 300 ? desc.slice(0, 297) + '...' : desc);
    }
    if (item.genre || item.genres) {
        const genres = Array.isArray(item.genre || item.genres)
            ? (item.genre || item.genres).join(', ')
            : (item.genre || item.genres);
        embed.addFields({ name: 'Genre', value: genres || '-', inline: true });
    }
    if (item.episode || item.totalEpisode || item.eps) {
        embed.addFields({ name: 'Episode', value: String(item.episode || item.totalEpisode || item.eps), inline: true });
    }
    if (item.status) {
        embed.addFields({ name: 'Status', value: String(item.status), inline: true });
    }
    if (item.rating || item.score) {
        embed.addFields({ name: 'Rating', value: String(item.rating || item.score), inline: true });
    }
    if (item.id || item.dramaId) {
        embed.addFields({ name: 'ID', value: String(item.id || item.dramaId), inline: true });
    }

    return embed;
}

function buildNavButtons(index, total, customId) {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${customId}_prev_${index}`)
            .setLabel('◀ Prev')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(index === 0),
        new ButtonBuilder()
            .setCustomId(`${customId}_next_${index}`)
            .setLabel('Next ▶')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(index === total - 1)
    );
    return row;
}

module.exports = {
    data: [
        new SlashCommandBuilder()
            .setName('freereels')
            .setDescription('Tampilkan drama dari FreeReels')
            .addSubcommand(sub =>
                sub.setName('foryou')
                    .setDescription('Daftar drama For You (Untukmu)')
                    .addIntegerOption(opt =>
                        opt.setName('page').setDescription('Nomor halaman (default: 1)').setMinValue(1)))
            .addSubcommand(sub =>
                sub.setName('homepage')
                    .setDescription('Drama dari halaman utama FreeReels'))
            .addSubcommand(sub =>
                sub.setName('anime')
                    .setDescription('Daftar anime di FreeReels')
                    .addIntegerOption(opt =>
                        opt.setName('page').setDescription('Nomor halaman (default: 1)').setMinValue(1)))
            .addSubcommand(sub =>
                sub.setName('cari')
                    .setDescription('Cari drama di FreeReels')
                    .addStringOption(opt =>
                        opt.setName('judul').setDescription('Judul drama yang ingin dicari').setRequired(true)))
            .addSubcommand(sub =>
                sub.setName('detail')
                    .setDescription('Detail drama berdasarkan ID')
                    .addStringOption(opt =>
                        opt.setName('id').setDescription('ID drama').setRequired(true))),
    ],

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        await interaction.deferReply();

        try {
            let data, items, title;

            if (sub === 'foryou') {
                const page = interaction.options.getInteger('page') || 1;
                data = await api.getForYou(page);
                items = data?.data || data?.result || data?.list || data?.drama || data?.items || [];
                title = `FreeReels - For You (Hal. ${page})`;
            } else if (sub === 'homepage') {
                data = await api.getHomepage();
                items = data?.data || data?.result || data?.list || data?.drama || data?.items || [];
                title = 'FreeReels - Homepage';
            } else if (sub === 'anime') {
                const page = interaction.options.getInteger('page') || 1;
                data = await api.getAnimePage(page);
                items = data?.data || data?.result || data?.list || data?.anime || data?.items || [];
                title = `FreeReels - Anime (Hal. ${page})`;
            } else if (sub === 'cari') {
                const judul = interaction.options.getString('judul');
                data = await api.search(judul);
                items = data?.data || data?.result || data?.list || data?.items || [];
                title = `FreeReels - Pencarian: "${judul}"`;
            } else if (sub === 'detail') {
                const id = interaction.options.getString('id');
                data = await api.getDetail(id);
                const item = data?.data || data?.result || data;
                if (!item || typeof item !== 'object') {
                    return interaction.editReply({ content: 'Data tidak ditemukan.' });
                }
                const embed = buildDramaEmbed(Array.isArray(item) ? item[0] : item, 0, 1);
                embed.setTitle(`Detail: ${embed.data.title}`);
                return interaction.editReply({ embeds: [embed] });
            }

            if (!Array.isArray(items) || items.length === 0) {
                return interaction.editReply({
                    content: `Tidak ada data yang ditemukan.\n\`\`\`json\n${JSON.stringify(data, null, 2).slice(0, 1000)}\n\`\`\``
                });
            }

            let index = 0;
            const customId = `fr_${sub}_${interaction.id}`;
            const embed = buildDramaEmbed(items[index], index, items.length);
            embed.setAuthor({ name: title });
            const row = buildNavButtons(index, items.length, customId);

            const msg = await interaction.editReply({ embeds: [embed], components: [row] });

            const collector = msg.createMessageComponentCollector({ time: 120_000 });
            collector.on('collect', async btn => {
                if (btn.user.id !== interaction.user.id) {
                    return btn.reply({ content: 'Hanya pengguna yang menjalankan perintah yang bisa navigasi.', ephemeral: true });
                }
                if (btn.customId.includes('_next_')) index = Math.min(index + 1, items.length - 1);
                if (btn.customId.includes('_prev_')) index = Math.max(index - 1, 0);

                const newEmbed = buildDramaEmbed(items[index], index, items.length);
                newEmbed.setAuthor({ name: title });
                const newRow = buildNavButtons(index, items.length, customId);
                await btn.update({ embeds: [newEmbed], components: [newRow] });
            });

            collector.on('end', () => {
                interaction.editReply({ components: [] }).catch(() => {});
            });

        } catch (err) {
            console.error(`[freereels/${sub}] Error:`, err.message);
            await interaction.editReply({
                content: `Terjadi kesalahan saat mengambil data: **${err.message}**`
            });
        }
    }
};
