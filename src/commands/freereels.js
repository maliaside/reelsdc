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
const api = require('../api/freereels');
const { downloadEpisodeToFile, cleanup } = require('../video');

const DISCORD_MAX_BYTES = 24 * 1024 * 1024;

function extractItems(data) {
    if (!data) return [];
    const inner = data.data || data;
    const items = inner.items || inner.list || inner.drama || inner.anime || inner.result || (Array.isArray(inner) ? inner : []);
    return items.filter(i => i.key && i.key !== '');
}

function buildListEmbed(item, index, total, title) {
    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle((item.title || item.name || 'Unknown Title').slice(0, 256))
        .setAuthor({ name: title })
        .setFooter({ text: `FreeReels • ${index + 1}/${total}` })
        .setTimestamp();

    if (item.cover) embed.setImage(item.cover);
    if (item.desc || item.description) {
        const desc = item.desc || item.description;
        embed.setDescription(desc.length > 350 ? desc.slice(0, 347) + '...' : desc);
    }
    const tags = item.content_tags || item.genre;
    if (Array.isArray(tags) && tags.length > 0) embed.addFields({ name: '🏷️ Tag', value: tags.join(', '), inline: true });
    if (item.episode_count) embed.addFields({ name: '📺 Episode', value: String(item.episode_count), inline: true });
    if (item.view_count) embed.addFields({ name: '👁️ Ditonton', value: Number(item.view_count).toLocaleString('id-ID'), inline: true });
    return embed;
}

function buildDetailEmbed(info) {
    const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle((info.name || info.title || 'Unknown').slice(0, 256))
        .setAuthor({ name: '📋 Detail Drama' })
        .setFooter({ text: 'Pilih episode dari dropdown untuk menonton' });

    if (info.cover) embed.setImage(info.cover);
    if (info.desc) embed.setDescription(info.desc.length > 400 ? info.desc.slice(0, 397) + '...' : info.desc);

    const tags = [...(info.content_tags || []), ...(info.tag || [])].filter(Boolean);
    if (tags.length > 0) embed.addFields({ name: '🏷️ Tag', value: tags.join(', '), inline: true });
    if (info.episode_count) embed.addFields({ name: '📺 Total Episode', value: String(info.episode_count), inline: true });
    if (info.follow_count) embed.addFields({ name: '❤️ Pengikut', value: Number(info.follow_count).toLocaleString('id-ID'), inline: true });
    const statusMap = { 1: 'Sedang Tayang', 2: '✅ Tamat', 3: 'Segera' };
    if (info.finish_status) embed.addFields({ name: '📡 Status', value: statusMap[info.finish_status] || '-', inline: true });
    if (info.free !== undefined) embed.addFields({ name: '💰 Akses', value: info.free ? '✅ Gratis' : '🔒 VIP', inline: true });
    return embed;
}

function buildEpisodeSelectMenu(episodes, page, customId) {
    const pageSize = 25;
    const start = page * pageSize;
    const slice = episodes.slice(start, start + pageSize);

    const select = new StringSelectMenuBuilder()
        .setCustomId(`${customId}_ep_${page}`)
        .setPlaceholder(`🎬 Pilih Episode (${start + 1}–${start + slice.length} dari ${episodes.length})`);

    for (let i = 0; i < slice.length; i++) {
        select.addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel(`Episode ${start + i + 1}`)
                .setDescription('Klik untuk langsung tonton di Discord')
                .setValue(`${start + i}`)
        );
    }
    const rows = [new ActionRowBuilder().addComponents(select)];
    const navBtns = [];
    if (page > 0) navBtns.push(
        new ButtonBuilder().setCustomId(`${customId}_epprev_${page}`).setLabel('◀ Episode Sebelumnya').setStyle(ButtonStyle.Secondary)
    );
    if (start + pageSize < episodes.length) navBtns.push(
        new ButtonBuilder().setCustomId(`${customId}_epnext_${page}`).setLabel('Episode Selanjutnya ▶').setStyle(ButtonStyle.Secondary)
    );
    if (navBtns.length > 0) rows.push(new ActionRowBuilder().addComponents(navBtns));
    return rows;
}

function buildListButtons(index, total, key, customId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${customId}_prev_${index}`).setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(index === 0),
        new ButtonBuilder().setCustomId(`${customId}_next_${index}`).setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(index === total - 1),
        new ButtonBuilder().setCustomId(`${customId}_detail_${key}`).setLabel('📋 Detail & Tonton').setStyle(ButtonStyle.Primary).setDisabled(!key)
    );
}

async function sendEpisodeVideo(interaction, ep, epNum, info, isFollowUp = false) {
    const videoUrl = ep.external_audio_h264_m3u8 || ep.external_audio_h265_m3u8 || ep.m3u8_url;
    if (!videoUrl) {
        const msg = { content: '❌ Link video tidak tersedia untuk episode ini.', flags: 64 };
        return isFollowUp ? interaction.followUp(msg) : interaction.reply(msg);
    }

    const idSub = (ep.subtitle_list || []).find(s => s.language === 'id-ID');
    const subtitleUrl = idSub?.subtitle || null;

    const title = info.name || info.title || 'Drama';
    const subNote = subtitleUrl ? 'dengan subtitle Indonesia' : 'tanpa subtitle';
    const statusMsg = { content: `⏳ Mengunduh **Episode ${epNum}** - ${title} (${subNote})... mungkin 20-60 detik`, flags: 64 };

    if (isFollowUp) {
        await interaction.reply(statusMsg);
    } else {
        await interaction.deferReply({ flags: 64 });
        await interaction.editReply(statusMsg);
    }

    let filePath = null;
    try {
        const result = await downloadEpisodeToFile(videoUrl, subtitleUrl);
        filePath = result.filePath;
        const sizeMB = (result.sizeBytes / 1024 / 1024).toFixed(1);

        const attachment = new AttachmentBuilder(filePath, {
            name: `freereels_ep${epNum}_${title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30)}.mp4`
        });

        const embed = new EmbedBuilder()
            .setColor(0xFEE75C)
            .setTitle(`🎬 Episode ${epNum} - ${title.slice(0, 200)}`)
            .setDescription(subtitleUrl
                ? 'Subtitle Indonesia ter-embed · Langsung putar di Discord di bawah ini ↓'
                : 'Audio Mandarin · Langsung putar di Discord di bawah ini ↓')
            .setThumbnail(ep.cover || info.cover || null)
            .setFooter({ text: `FreeReels · ${sizeMB} MB` });

        await interaction.editReply({ content: null, embeds: [embed], files: [attachment] });

    } catch (err) {
        console.error('[sendEpisodeVideo]', err.message);
        const errMsg = { content: `❌ Gagal mengunduh video: **${err.message}**`, embeds: [], files: [] };
        await interaction.editReply(errMsg).catch(() => {});
    } finally {
        if (filePath) cleanup(filePath);
    }
}

async function handleDetailOpen(btnInteraction, key) {
    await btnInteraction.deferReply({ flags: 64 });
    try {
        const data = await api.getDetail(key);
        const info = data?.data?.info;
        if (!info) return btnInteraction.editReply({ content: '❌ Detail tidak ditemukan.' });

        const episodes = info.episode_list || [];
        const detailEmbed = buildDetailEmbed(info);
        const customId = `det_${key}_${btnInteraction.id}`;
        const episodeRows = episodes.length > 0 ? buildEpisodeSelectMenu(episodes, 0, customId) : [];

        await btnInteraction.editReply({ embeds: [detailEmbed], components: episodeRows });
        if (episodes.length === 0) return;

        const msg = await btnInteraction.fetchReply();
        let currentPage = 0;

        const collector = msg.createMessageComponentCollector({ time: 300_000 });
        collector.on('collect', async c => {
            if (c.user.id !== btnInteraction.user.id) {
                return c.reply({ content: 'Hanya kamu yang bisa memilih episode ini.', flags: 64 });
            }
            if (c.customId.includes('_ep_')) {
                const epIndex = parseInt(c.values[0]);
                await sendEpisodeVideo(c, episodes[epIndex], epIndex + 1, info, false);
            } else if (c.customId.includes('_epnext_')) {
                currentPage++;
                await c.update({ embeds: [detailEmbed], components: buildEpisodeSelectMenu(episodes, currentPage, customId) });
            } else if (c.customId.includes('_epprev_')) {
                currentPage--;
                await c.update({ embeds: [detailEmbed], components: buildEpisodeSelectMenu(episodes, currentPage, customId) });
            }
        });
        collector.on('end', () => { btnInteraction.editReply({ components: [] }).catch(() => {}); });
    } catch (err) {
        console.error('[handleDetailOpen]', err.message);
        btnInteraction.editReply({ content: `❌ Gagal mengambil detail: ${err.message}` }).catch(() => {});
    }
}

async function showList(interaction, items, title) {
    let index = 0;
    const customId = `list_${interaction.id}`;
    const getKey = (i) => items[i]?.key || '';

    const embed = buildListEmbed(items[index], index, items.length, title);
    const row = buildListButtons(index, items.length, getKey(index), customId);
    const msg = await interaction.editReply({ embeds: [embed], components: [row] });

    const collector = msg.createMessageComponentCollector({ time: 120_000 });
    collector.on('collect', async btn => {
        if (btn.user.id !== interaction.user.id) {
            return btn.reply({ content: 'Hanya pengguna yang menjalankan perintah ini yang bisa navigasi.', flags: 64 });
        }
        if (btn.customId.includes('_detail_')) {
            const key = btn.customId.split('_detail_')[1];
            await handleDetailOpen(btn, key);
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
            .setName('freereels')
            .setDescription('Tampilkan drama dari FreeReels')
            .addSubcommand(sub =>
                sub.setName('foryou')
                    .setDescription('Daftar drama For You (Untukmu)')
                    .addIntegerOption(opt =>
                        opt.setName('offset').setDescription('Offset pagination (default: 0)').setMinValue(0)))
            .addSubcommand(sub =>
                sub.setName('homepage')
                    .setDescription('Drama dari halaman utama FreeReels'))
            .addSubcommand(sub =>
                sub.setName('anime')
                    .setDescription('Daftar anime di FreeReels'))
            .addSubcommand(sub =>
                sub.setName('cari')
                    .setDescription('Cari drama berdasarkan kata kunci')
                    .addStringOption(opt =>
                        opt.setName('judul').setDescription('Kata kunci judul drama').setRequired(true)))
            .addSubcommand(sub =>
                sub.setName('detail')
                    .setDescription('Detail drama berdasarkan KEY')
                    .addStringOption(opt =>
                        opt.setName('key').setDescription('KEY drama').setRequired(true))),
    ],

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        await interaction.deferReply();

        try {
            let items = [], title = '';

            if (sub === 'foryou') {
                const offset = interaction.options.getInteger('offset') || 0;
                const data = await api.getForYou(offset);
                items = extractItems(data);
                title = `FreeReels - For You (offset: ${offset})`;

            } else if (sub === 'homepage') {
                const data = await api.getHomepage();
                items = extractItems(data);
                title = 'FreeReels - Homepage';

            } else if (sub === 'anime') {
                const data = await api.getAnimePage();
                items = extractItems(data);
                title = 'FreeReels - Anime';

            } else if (sub === 'cari') {
                const judul = interaction.options.getString('judul').toLowerCase();
                await interaction.editReply({ content: `🔍 Mencari **"${judul}"** dari seluruh konten...` });

                const seen = new Set();
                const allItems = [];

                // Fetch homepage and animepage
                const [homepageData, animeData] = await Promise.all([
                    api.getHomepage().catch(() => null),
                    api.getAnimePage().catch(() => null)
                ]);
                for (const d of [homepageData, animeData]) {
                    for (const i of extractItems(d || {})) {
                        if (!seen.has(i.key)) { seen.add(i.key); allItems.push(i); }
                    }
                }

                // Fetch multiple foryou offsets sequentially to avoid rate limit
                for (const offset of [0, 20, 40, 60, 80, 100, 120, 140, 160]) {
                    try {
                        const d = await api.getForYou(offset);
                        const pageItems = extractItems(d);
                        if (pageItems.length === 0) break;
                        for (const i of pageItems) {
                            if (!seen.has(i.key)) { seen.add(i.key); allItems.push(i); }
                        }
                        // Early exit if found
                        const earlyFound = allItems.filter(i =>
                            (i.title || i.name || '').toLowerCase().includes(judul)
                        );
                        if (earlyFound.length >= 3) break;
                    } catch (e) {
                        console.warn('[cari] offset', offset, e.message);
                        await new Promise(r => setTimeout(r, 1000));
                    }
                }

                items = allItems.filter(i =>
                    (i.title || i.name || '').toLowerCase().includes(judul) ||
                    (i.desc || '').toLowerCase().includes(judul) ||
                    (i.content_tags || []).some(t => t.toLowerCase().includes(judul))
                );
                title = `FreeReels - Cari: "${judul}"`;

                if (items.length === 0) {
                    return interaction.editReply({
                        content: `❌ Drama **"${judul}"** tidak ditemukan (dicari dari ${allItems.length} drama).\n\nCoba browse manual:\n• \`/freereels foryou\`\n• \`/freereels homepage\`\n• \`/freereels anime\``
                    });
                }

            } else if (sub === 'detail') {
                const key = interaction.options.getString('key');
                const data = await api.getDetail(key);
                const info = data?.data?.info;
                if (!info) return interaction.editReply({ content: '❌ Detail tidak ditemukan.' });

                const episodes = info.episode_list || [];
                const detailEmbed = buildDetailEmbed(info);
                const customId = `det_${key}_${interaction.id}`;
                const episodeRows = episodes.length > 0 ? buildEpisodeSelectMenu(episodes, 0, customId) : [];

                const msg = await interaction.editReply({ embeds: [detailEmbed], components: episodeRows });
                if (episodes.length === 0) return;

                let currentPage = 0;
                const collector = msg.createMessageComponentCollector({ time: 300_000 });
                collector.on('collect', async c => {
                    if (c.user.id !== interaction.user.id) {
                        return c.reply({ content: 'Hanya kamu yang bisa memilih episode ini.', flags: 64 });
                    }
                    if (c.customId.includes('_ep_')) {
                        const epIndex = parseInt(c.values[0]);
                        await sendEpisodeVideo(c, episodes[epIndex], epIndex + 1, info, false);
                    } else if (c.customId.includes('_epnext_')) {
                        currentPage++;
                        await c.update({ embeds: [detailEmbed], components: buildEpisodeSelectMenu(episodes, currentPage, customId) });
                    } else if (c.customId.includes('_epprev_')) {
                        currentPage--;
                        await c.update({ embeds: [detailEmbed], components: buildEpisodeSelectMenu(episodes, currentPage, customId) });
                    }
                });
                collector.on('end', () => { interaction.editReply({ components: [] }).catch(() => {}); });
                return;
            }

            if (!items.length) return interaction.editReply({ content: '❌ Tidak ada data yang ditemukan.' });
            await showList(interaction, items, title);

        } catch (err) {
            console.error(`[freereels/${sub}]`, err.message);
            await interaction.editReply({ content: `❌ Terjadi kesalahan: **${err.message}**` });
        }
    }
};
