const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    AttachmentBuilder
} = require('discord.js');
const api = require('../api/reelshort');
const { downloadReelShortEpisode, cleanup } = require('../video');

function buildListEmbed(item, index, total, title) {
    const embed = new EmbedBuilder()
        .setColor(0xEB459E)
        .setTitle((item.title || item.book_title || 'Unknown Title').slice(0, 256))
        .setAuthor({ name: title })
        .setFooter({ text: `ReelShort • ${index + 1}/${total}` })
        .setTimestamp();

    const cover = item.cover || item.book_pic;
    if (cover) embed.setImage(cover);
    const desc = item.description || item.special_desc;
    if (desc) embed.setDescription(desc.length > 350 ? desc.slice(0, 347) + '...' : desc);

    const tags = item.tag || item.tag_list || item.book_genre || [];
    const tagArr = Array.isArray(tags) ? tags.map(t => typeof t === 'string' ? t : t.name || t).filter(Boolean) : [];
    if (tagArr.length > 0) embed.addFields({ name: '🏷️ Tag', value: tagArr.slice(0, 5).join(', '), inline: true });
    if (item.chapterCount || item.chapter_count) embed.addFields({ name: '📺 Episode', value: String(item.chapterCount || item.chapter_count), inline: true });
    if (item.collect_count) embed.addFields({ name: '❤️ Pengikut', value: Number(item.collect_count).toLocaleString('id-ID'), inline: true });

    return embed;
}

function buildDetailEmbed(info) {
    const embed = new EmbedBuilder()
        .setColor(0xEB459E)
        .setTitle((info.title || 'Unknown').slice(0, 256))
        .setAuthor({ name: '📋 Detail Drama · ReelShort' })
        .setFooter({ text: 'Pilih episode dari dropdown untuk menonton' });

    if (info.cover) embed.setImage(info.cover);
    if (info.description) embed.setDescription(info.description.length > 400 ? info.description.slice(0, 397) + '...' : info.description);
    if (info.totalEpisodes) embed.addFields({ name: '📺 Total Episode', value: String(info.totalEpisodes), inline: true });
    return embed;
}

function buildEpisodeSelectMenu(chapters, page, customId) {
    const pageSize = 25;
    const start = page * pageSize;
    const slice = chapters.slice(start, start + pageSize);

    const select = new StringSelectMenuBuilder()
        .setCustomId(`${customId}_rsep_${page}`)
        .setPlaceholder(`🎬 Pilih Episode (${start + 1}–${start + slice.length} dari ${chapters.length})`);

    for (let i = 0; i < slice.length; i++) {
        const ch = slice[i];
        select.addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel(ch.title || `Episode ${start + i + 1}`)
                .setDescription(ch.isLocked ? '🔒 Terkunci' : 'Klik untuk langsung tonton di Discord')
                .setValue(`${start + i}`)
        );
    }
    const rows = [new ActionRowBuilder().addComponents(select)];
    const navBtns = [];
    if (page > 0) navBtns.push(
        new ButtonBuilder().setCustomId(`${customId}_rsepprev_${page}`).setLabel('◀ Episode Sebelumnya').setStyle(ButtonStyle.Secondary)
    );
    if (start + pageSize < chapters.length) navBtns.push(
        new ButtonBuilder().setCustomId(`${customId}_rsepnext_${page}`).setLabel('Episode Selanjutnya ▶').setStyle(ButtonStyle.Secondary)
    );
    if (navBtns.length > 0) rows.push(new ActionRowBuilder().addComponents(navBtns));
    return rows;
}

function buildListButtons(index, total, bookId, customId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${customId}_prev_${index}`).setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(index === 0),
        new ButtonBuilder().setCustomId(`${customId}_next_${index}`).setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(index === total - 1),
        new ButtonBuilder().setCustomId(`${customId}_rsdetail_${bookId}`).setLabel('📋 Detail & Tonton').setStyle(ButtonStyle.Primary).setDisabled(!bookId)
    );
}

async function sendReelShortEpisode(interaction, bookId, chapter, epNum, dramaTitle) {
    if (chapter.isLocked) {
        return interaction.editReply({ content: '🔒 Episode ini terkunci (berbayar). Tidak bisa diputar.' });
    }

    const statusMsg = { content: `⏳ Mengunduh **Episode ${epNum}** - ${dramaTitle}... mungkin 10-30 detik`, flags: 64 };
    await interaction.deferReply({ flags: 64 });
    await interaction.editReply(statusMsg);

    let filePath = null;
    try {
        const videoData = await api.getEpisodeVideo(bookId, epNum);
        if (videoData.isLocked) {
            return interaction.editReply({ content: '🔒 Episode ini terkunci (berbayar). Tidak bisa diputar.' });
        }
        const videoList = videoData.videoList || [];
        const h264Videos = videoList.filter(v => v.encode === 'H264');
        const sorted = h264Videos.sort((a, b) => a.quality - b.quality);
        const chosen = sorted[0] || videoList[0];
        if (!chosen) return interaction.editReply({ content: '❌ Link video tidak tersedia untuk episode ini.' });

        console.log('[reelshort] Downloading ep', epNum, 'quality:', chosen.quality, 'encode:', chosen.encode);
        const result = await downloadReelShortEpisode(chosen.url);
        filePath = result.filePath;
        const sizeMB = (result.sizeBytes / 1024 / 1024).toFixed(1);

        const attachment = new AttachmentBuilder(filePath, {
            name: `reelshort_ep${epNum}_${dramaTitle.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30)}.mp4`
        });

        const embed = new EmbedBuilder()
            .setColor(0xEB459E)
            .setTitle(`🎬 Episode ${epNum} - ${dramaTitle.slice(0, 200)}`)
            .setDescription('ReelShort · Langsung putar di Discord di bawah ini ↓')
            .setFooter({ text: `ReelShort · ${sizeMB} MB · ${chosen.quality}p` });

        await interaction.editReply({ content: null, embeds: [embed], files: [attachment] });

    } catch (err) {
        console.error('[sendReelShortEpisode]', err.message);
        await interaction.editReply({ content: `❌ Gagal mengunduh video: **${err.message}**`, embeds: [], files: [] }).catch(() => {});
    } finally {
        if (filePath) cleanup(filePath);
    }
}

async function handleDetailOpen(btnInteraction, bookId) {
    await btnInteraction.deferReply({ flags: 64 });
    try {
        const data = await api.getDetail(bookId);
        if (!data?.bookId) return btnInteraction.editReply({ content: '❌ Detail tidak ditemukan.' });

        const chapters = (data.chapters || []).filter(c => c.serialNumber > 0);
        const detailEmbed = buildDetailEmbed(data);
        const customId = `rsdet_${bookId}_${btnInteraction.id}`;
        const episodeRows = chapters.length > 0 ? buildEpisodeSelectMenu(chapters, 0, customId) : [];

        await btnInteraction.editReply({ embeds: [detailEmbed], components: episodeRows });
        if (chapters.length === 0) return;

        const msg = await btnInteraction.fetchReply();
        let currentPage = 0;

        const collector = msg.createMessageComponentCollector({ time: 300_000 });
        collector.on('collect', async c => {
            if (c.user.id !== btnInteraction.user.id) {
                return c.reply({ content: 'Hanya kamu yang bisa memilih episode ini.', flags: 64 });
            }
            if (c.customId.includes('_rsep_')) {
                const idx = parseInt(c.values[0]);
                const chapter = chapters[idx];
                const epNum = chapter.serialNumber;
                await sendReelShortEpisode(c, bookId, chapter, epNum, data.title);
            } else if (c.customId.includes('_rsepnext_')) {
                currentPage++;
                await c.update({ embeds: [detailEmbed], components: buildEpisodeSelectMenu(chapters, currentPage, customId) });
            } else if (c.customId.includes('_rsepprev_')) {
                currentPage--;
                await c.update({ embeds: [detailEmbed], components: buildEpisodeSelectMenu(chapters, currentPage, customId) });
            }
        });
        collector.on('end', () => { btnInteraction.editReply({ components: [] }).catch(() => {}); });
    } catch (err) {
        console.error('[rs handleDetailOpen]', err.message);
        btnInteraction.editReply({ content: `❌ Gagal mengambil detail: ${err.message}` }).catch(() => {});
    }
}

function extractItems(data) {
    if (!data) return [];
    const d = data.data || data;
    if (Array.isArray(d.lists)) return d.lists;
    if (Array.isArray(d.results)) return d.results;
    if (Array.isArray(d)) return d;
    return [];
}

function getBookId(item) {
    return item.bookId || item.book_id || '';
}

async function showList(interaction, items, title) {
    if (items.length === 0) {
        return interaction.editReply({ content: '❌ Tidak ada drama ditemukan.' });
    }
    let index = 0;
    const customId = `rslist_${interaction.id}`;
    const getKey = (i) => getBookId(items[i]);

    const embed = buildListEmbed(items[index], index, items.length, title);
    const row = buildListButtons(index, items.length, getKey(index), customId);
    const msg = await interaction.editReply({ embeds: [embed], components: [row] });

    const collector = msg.createMessageComponentCollector({ time: 120_000 });
    collector.on('collect', async btn => {
        if (btn.user.id !== interaction.user.id) {
            return btn.reply({ content: 'Hanya pengguna yang menjalankan perintah ini yang bisa navigasi.', flags: 64 });
        }
        if (btn.customId.includes('_rsdetail_')) {
            const bookId = btn.customId.split('_rsdetail_')[1];
            await handleDetailOpen(btn, bookId);
            return;
        }
        if (btn.customId.includes('_next_')) index = Math.min(index + 1, items.length - 1);
        else if (btn.customId.includes('_prev_')) index = Math.max(index - 1, 0);

        const newEmbed = buildListEmbed(items[index], index, items.length, title);
        const newRow = buildListButtons(index, items.length, getKey(index), customId);
        await btn.update({ embeds: [newEmbed], components: [newRow] });
    });
    collector.on('end', () => { interaction.editReply({ components: [] }).catch(() => {}); });
}

module.exports = {
    data: [
        new SlashCommandBuilder()
            .setName('reelshort')
            .setDescription('Tampilkan drama dari ReelShort')
            .addSubcommand(sub =>
                sub.setName('foryou')
                    .setDescription('Daftar drama For You dari ReelShort')
                    .addIntegerOption(opt =>
                        opt.setName('offset').setDescription('Offset pagination (default: 0)').setMinValue(0)))
            .addSubcommand(sub =>
                sub.setName('homepage')
                    .setDescription('Drama dari halaman utama ReelShort'))
            .addSubcommand(sub =>
                sub.setName('cari')
                    .setDescription('Cari drama di ReelShort')
                    .addStringOption(opt =>
                        opt.setName('judul').setDescription('Judul atau kata kunci drama').setRequired(true)))
            .addSubcommand(sub =>
                sub.setName('detail')
                    .setDescription('Lihat detail dan tonton drama ReelShort')
                    .addStringOption(opt =>
                        opt.setName('bookid').setDescription('Book ID drama ReelShort').setRequired(true)))
    ],

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        await interaction.deferReply({ flags: 64 });

        try {
            let items = [];
            let title = '';

            if (sub === 'foryou') {
                const offset = interaction.options.getInteger('offset') || 0;
                const data = await api.getForYou(offset);
                items = extractItems(data);
                title = `ReelShort - Untukmu (offset ${offset})`;

            } else if (sub === 'homepage') {
                const data = await api.getHomepage();
                items = extractItems(data);
                title = 'ReelShort - Beranda';

            } else if (sub === 'cari') {
                const judul = interaction.options.getString('judul');
                await interaction.editReply({ content: `🔍 Mencari **"${judul}"** di ReelShort...` });
                const data = await api.search(judul, 1);
                items = extractItems(data);
                title = `ReelShort - Cari: "${judul}"`;

                if (items.length === 0) {
                    return interaction.editReply({ content: `❌ Drama **"${judul}"** tidak ditemukan di ReelShort.` });
                }

            } else if (sub === 'detail') {
                const bookId = interaction.options.getString('bookid');
                const data = await api.getDetail(bookId);
                if (!data?.bookId) return interaction.editReply({ content: '❌ Detail tidak ditemukan.' });

                const chapters = (data.chapters || []).filter(c => c.serialNumber > 0);
                const detailEmbed = buildDetailEmbed(data);
                const customId = `rsdet_${bookId}_${interaction.id}`;
                const episodeRows = chapters.length > 0 ? buildEpisodeSelectMenu(chapters, 0, customId) : [];

                await interaction.editReply({ embeds: [detailEmbed], components: episodeRows });
                if (chapters.length === 0) return;

                const msg = await interaction.fetchReply();
                let currentPage = 0;

                const collector = msg.createMessageComponentCollector({ time: 300_000 });
                collector.on('collect', async c => {
                    if (c.user.id !== interaction.user.id) {
                        return c.reply({ content: 'Hanya kamu yang bisa memilih episode ini.', flags: 64 });
                    }
                    if (c.customId.includes('_rsep_')) {
                        const idx = parseInt(c.values[0]);
                        const chapter = chapters[idx];
                        const epNum = chapter.serialNumber;
                        await sendReelShortEpisode(c, bookId, chapter, epNum, data.title);
                    } else if (c.customId.includes('_rsepnext_')) {
                        currentPage++;
                        await c.update({ embeds: [detailEmbed], components: buildEpisodeSelectMenu(chapters, currentPage, customId) });
                    } else if (c.customId.includes('_rsepprev_')) {
                        currentPage--;
                        await c.update({ embeds: [detailEmbed], components: buildEpisodeSelectMenu(chapters, currentPage, customId) });
                    }
                });
                collector.on('end', () => { interaction.editReply({ components: [] }).catch(() => {}); });
                return;
            }

            if (!items.length) return interaction.editReply({ content: '❌ Tidak ada data yang ditemukan.' });
            await showList(interaction, items, title);

        } catch (err) {
            console.error(`[reelshort] Error:`, err.message);
            await interaction.editReply({ content: `❌ Terjadi kesalahan: **${err.message}**` });
        }
    }
};
