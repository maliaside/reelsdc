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
const frApi = require('../api/freereels');
const rsApi = require('../api/reelshort');
const { downloadFreeReelsEpisode, downloadReelShortEpisode, cleanup } = require('../video');

// ─── FreeReels helpers ────────────────────────────────────────────────────────

function frExtractItems(data) {
    if (!data) return [];
    const inner = data.data || data;
    const items = inner.items || inner.list || inner.drama || inner.anime || inner.result || (Array.isArray(inner) ? inner : []);
    return items.filter(i => i.key && i.key !== '' && i.item_type !== 'card').map(i => ({ ...i, _source: 'freereels' }));
}

// ─── ReelShort helpers ────────────────────────────────────────────────────────

function rsExtractItems(data) {
    if (!data) return [];
    const d = data.data || data;
    const items = Array.isArray(d.lists) ? d.lists : Array.isArray(d.results) ? d.results : [];
    return items.map(i => ({ ...i, _source: 'reelshort' }));
}

// ─── Unified list UI ─────────────────────────────────────────────────────────

function buildUnifiedEmbed(item, index, total, title) {
    const isFR = item._source === 'freereels';
    const embed = new EmbedBuilder()
        .setColor(isFR ? 0x5865F2 : 0xEB459E)
        .setTitle((item.title || item.name || item.book_title || 'Unknown').slice(0, 256))
        .setAuthor({ name: title })
        .setFooter({ text: `${isFR ? 'FreeReels 🎭' : 'ReelShort 🎬'} • ${index + 1}/${total}` })
        .setTimestamp();

    const cover = item.cover || item.book_pic;
    if (cover) embed.setImage(cover);
    const desc = item.desc || item.description || item.special_desc;
    if (desc) embed.setDescription(desc.length > 350 ? desc.slice(0, 347) + '...' : desc);

    const tags = item.content_tags || item.tag || item.tag_list || item.book_genre || [];
    const tagArr = Array.isArray(tags) ? tags.map(t => typeof t === 'string' ? t : t.name || t).filter(Boolean) : [];
    if (tagArr.length > 0) embed.addFields({ name: '🏷️ Tag', value: tagArr.slice(0, 5).join(', '), inline: true });
    const epCount = item.episode_count || item.chapterCount || item.chapter_count;
    if (epCount) embed.addFields({ name: '📺 Episode', value: String(epCount), inline: true });
    embed.addFields({ name: '🌐 Platform', value: isFR ? 'FreeReels' : 'ReelShort', inline: true });
    return embed;
}

function getItemId(item) {
    if (item._source === 'freereels') return item.key || '';
    return item.bookId || item.book_id || '';
}

function buildUnifiedButtons(index, total, item, customId) {
    const id = getItemId(item);
    const detailCustomId = item._source === 'freereels'
        ? `${customId}_frdetail_${id}`
        : `${customId}_rsdetail_${id}`;

    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${customId}_prev_${index}`).setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(index === 0),
        new ButtonBuilder().setCustomId(`${customId}_next_${index}`).setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(index === total - 1),
        new ButtonBuilder().setCustomId(detailCustomId).setLabel('📋 Detail & Tonton').setStyle(ButtonStyle.Primary).setDisabled(!id)
    );
}

// ─── FreeReels episode flow ───────────────────────────────────────────────────

function buildFrEpisodeSelect(episodes, page, customId) {
    const pageSize = 25;
    const start = page * pageSize;
    const slice = episodes.slice(start, start + pageSize);
    const select = new StringSelectMenuBuilder()
        .setCustomId(`${customId}_frep_${page}`)
        .setPlaceholder(`🎬 Pilih Episode (${start + 1}–${start + slice.length})`);
    for (let i = 0; i < slice.length; i++) {
        select.addOptions(new StringSelectMenuOptionBuilder()
            .setLabel(`Episode ${start + i + 1}`)
            .setDescription('Klik untuk langsung tonton di Discord')
            .setValue(`${start + i}`));
    }
    const rows = [new ActionRowBuilder().addComponents(select)];
    const nav = [];
    if (page > 0) nav.push(new ButtonBuilder().setCustomId(`${customId}_frepprev_${page}`).setLabel('◀ Sebelumnya').setStyle(ButtonStyle.Secondary));
    if (start + pageSize < episodes.length) nav.push(new ButtonBuilder().setCustomId(`${customId}_frepnext_${page}`).setLabel('Selanjutnya ▶').setStyle(ButtonStyle.Secondary));
    if (nav.length > 0) rows.push(new ActionRowBuilder().addComponents(nav));
    return rows;
}

async function sendFrEpisode(interaction, ep, epNum, info) {
    const videoUrl = ep.external_audio_h264_m3u8 || ep.external_audio_h265_m3u8 || ep.m3u8_url;
    if (!videoUrl) return interaction.editReply({ content: '❌ Link video tidak tersedia.' });

    const idSub = (ep.subtitle_list || []).find(s => s.language === 'id-ID');
    const subtitleUrl = idSub?.subtitle || null;
    const title = info.name || info.title || 'Drama';
    const note = subtitleUrl ? 'dengan subtitle Indonesia' : 'tanpa subtitle';

    await interaction.deferReply({ flags: 64 });
    await interaction.editReply({ content: `⏳ Mengunduh **Episode ${epNum}** - ${title} (${note})... mungkin 20-60 detik`, flags: 64 });

    let filePath = null;
    try {
        const result = await downloadFreeReelsEpisode(videoUrl, subtitleUrl, ep.duration || null);
        filePath = result.filePath;
        const sizeMB = (result.sizeBytes / 1024 / 1024).toFixed(1);
        const attachment = new AttachmentBuilder(filePath, {
            name: `fr_ep${epNum}_${title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30)}.mp4`
        });
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(`🎬 Episode ${epNum} - ${title.slice(0, 200)}`)
            .setDescription(subtitleUrl ? 'Subtitle Indonesia ter-embed · Langsung putar di Discord ↓' : 'Audio Mandarin · Langsung putar di Discord ↓')
            .setThumbnail(ep.cover || info.cover || null)
            .setFooter({ text: `FreeReels · ${sizeMB} MB` });
        await interaction.editReply({ content: null, embeds: [embed], files: [attachment] });
    } catch (err) {
        console.error('[cari/frEpisode]', err.message);
        await interaction.editReply({ content: `❌ Gagal mengunduh: **${err.message}**`, embeds: [], files: [] }).catch(() => {});
    } finally {
        if (filePath) cleanup(filePath);
    }
}

async function handleFrDetail(btnInteraction, key) {
    await btnInteraction.deferReply({ flags: 64 });
    try {
        const data = await frApi.getDetail(key);
        const info = data?.data?.info;
        if (!info) return btnInteraction.editReply({ content: '❌ Detail tidak ditemukan.' });
        const episodes = info.episode_list || [];
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle((info.name || info.title || '').slice(0, 256))
            .setAuthor({ name: '📋 Detail Drama · FreeReels' })
            .setFooter({ text: 'Pilih episode dari dropdown untuk menonton' });
        if (info.cover) embed.setImage(info.cover);
        if (info.desc) embed.setDescription(info.desc.slice(0, 400));
        if (info.episode_count) embed.addFields({ name: '📺 Total Episode', value: String(info.episode_count), inline: true });

        const customId = `frdet_${key}_${btnInteraction.id}`;
        const episodeRows = episodes.length > 0 ? buildFrEpisodeSelect(episodes, 0, customId) : [];
        await btnInteraction.editReply({ embeds: [embed], components: episodeRows });
        if (episodes.length === 0) return;

        const msg = await btnInteraction.fetchReply();
        let currentPage = 0;
        const collector = msg.createMessageComponentCollector({ time: 300_000 });
        collector.on('collect', async c => {
            if (c.user.id !== btnInteraction.user.id) return c.reply({ content: 'Bukan kamu yang pakai ini.', flags: 64 });
            if (c.customId.includes('_frep_')) {
                const idx = parseInt(c.values[0]);
                await sendFrEpisode(c, episodes[idx], idx + 1, info);
            } else if (c.customId.includes('_frepnext_')) {
                currentPage++;
                await c.update({ embeds: [embed], components: buildFrEpisodeSelect(episodes, currentPage, customId) });
            } else if (c.customId.includes('_frepprev_')) {
                currentPage--;
                await c.update({ embeds: [embed], components: buildFrEpisodeSelect(episodes, currentPage, customId) });
            }
        });
        collector.on('end', () => { btnInteraction.editReply({ components: [] }).catch(() => {}); });
    } catch (err) {
        console.error('[cari/frDetail]', err.message);
        btnInteraction.editReply({ content: `❌ Gagal: ${err.message}` }).catch(() => {});
    }
}

// ─── ReelShort episode flow ───────────────────────────────────────────────────

function buildRsEpisodeSelect(chapters, page, customId) {
    const pageSize = 25;
    const start = page * pageSize;
    const slice = chapters.slice(start, start + pageSize);
    const select = new StringSelectMenuBuilder()
        .setCustomId(`${customId}_rsep_${page}`)
        .setPlaceholder(`🎬 Pilih Episode (${start + 1}–${start + slice.length})`);
    for (let i = 0; i < slice.length; i++) {
        const ch = slice[i];
        select.addOptions(new StringSelectMenuOptionBuilder()
            .setLabel(ch.title || `Episode ${start + i + 1}`)
            .setDescription(ch.isLocked ? '🔒 Terkunci' : 'Klik untuk langsung tonton di Discord')
            .setValue(`${start + i}`));
    }
    const rows = [new ActionRowBuilder().addComponents(select)];
    const nav = [];
    if (page > 0) nav.push(new ButtonBuilder().setCustomId(`${customId}_rsepprev_${page}`).setLabel('◀ Sebelumnya').setStyle(ButtonStyle.Secondary));
    if (start + pageSize < chapters.length) nav.push(new ButtonBuilder().setCustomId(`${customId}_rsepnext_${page}`).setLabel('Selanjutnya ▶').setStyle(ButtonStyle.Secondary));
    if (nav.length > 0) rows.push(new ActionRowBuilder().addComponents(nav));
    return rows;
}

async function sendRsEpisode(interaction, bookId, chapter, epNum, dramaTitle) {
    if (chapter.isLocked) return interaction.editReply({ content: '🔒 Episode ini terkunci (berbayar).' });

    await interaction.deferReply({ flags: 64 });
    await interaction.editReply({ content: `⏳ Mengunduh **Episode ${epNum}** - ${dramaTitle}... mungkin 10-30 detik`, flags: 64 });

    let filePath = null;
    try {
        const videoData = await rsApi.getEpisodeVideo(bookId, epNum);
        if (videoData.isLocked) return interaction.editReply({ content: '🔒 Episode ini terkunci.' });
        const videoList = videoData.videoList || [];
        const h264 = videoList.filter(v => v.encode === 'H264').sort((a, b) => a.quality - b.quality);
        const chosen = h264[0] || videoList.sort((a, b) => a.quality - b.quality)[0];
        if (!chosen) return interaction.editReply({ content: '❌ Link video tidak tersedia.' });

        const result = await downloadReelShortEpisode(chosen.url);
        filePath = result.filePath;
        const sizeMB = (result.sizeBytes / 1024 / 1024).toFixed(1);
        const attachment = new AttachmentBuilder(filePath, {
            name: `rs_ep${epNum}_${dramaTitle.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30)}.mp4`
        });
        const embed = new EmbedBuilder()
            .setColor(0xEB459E)
            .setTitle(`🎬 Episode ${epNum} - ${dramaTitle.slice(0, 200)}`)
            .setDescription('ReelShort · Langsung putar di Discord di bawah ini ↓')
            .setFooter({ text: `ReelShort · ${sizeMB} MB · ${chosen.quality}p` });
        await interaction.editReply({ content: null, embeds: [embed], files: [attachment] });
    } catch (err) {
        console.error('[cari/rsEpisode]', err.message);
        await interaction.editReply({ content: `❌ Gagal mengunduh: **${err.message}**`, embeds: [], files: [] }).catch(() => {});
    } finally {
        if (filePath) cleanup(filePath);
    }
}

async function handleRsDetail(btnInteraction, bookId) {
    await btnInteraction.deferReply({ flags: 64 });
    try {
        const data = await rsApi.getDetail(bookId);
        if (!data?.bookId) return btnInteraction.editReply({ content: '❌ Detail tidak ditemukan.' });
        const chapters = (data.chapters || []).filter(c => c.serialNumber > 0);
        const embed = new EmbedBuilder()
            .setColor(0xEB459E)
            .setTitle((data.title || '').slice(0, 256))
            .setAuthor({ name: '📋 Detail Drama · ReelShort' })
            .setFooter({ text: 'Pilih episode dari dropdown untuk menonton' });
        if (data.cover) embed.setImage(data.cover);
        if (data.description) embed.setDescription(data.description.slice(0, 400));
        if (data.totalEpisodes) embed.addFields({ name: '📺 Total Episode', value: String(data.totalEpisodes), inline: true });

        const customId = `rsdet_${bookId}_${btnInteraction.id}`;
        const episodeRows = chapters.length > 0 ? buildRsEpisodeSelect(chapters, 0, customId) : [];
        await btnInteraction.editReply({ embeds: [embed], components: episodeRows });
        if (chapters.length === 0) return;

        const msg = await btnInteraction.fetchReply();
        let currentPage = 0;
        const collector = msg.createMessageComponentCollector({ time: 300_000 });
        collector.on('collect', async c => {
            if (c.user.id !== btnInteraction.user.id) return c.reply({ content: 'Bukan kamu yang pakai ini.', flags: 64 });
            if (c.customId.includes('_rsep_')) {
                const idx = parseInt(c.values[0]);
                const chapter = chapters[idx];
                await sendRsEpisode(c, bookId, chapter, chapter.serialNumber, data.title);
            } else if (c.customId.includes('_rsepnext_')) {
                currentPage++;
                await c.update({ embeds: [embed], components: buildRsEpisodeSelect(chapters, currentPage, customId) });
            } else if (c.customId.includes('_rsepprev_')) {
                currentPage--;
                await c.update({ embeds: [embed], components: buildRsEpisodeSelect(chapters, currentPage, customId) });
            }
        });
        collector.on('end', () => { btnInteraction.editReply({ components: [] }).catch(() => {}); });
    } catch (err) {
        console.error('[cari/rsDetail]', err.message);
        btnInteraction.editReply({ content: `❌ Gagal: ${err.message}` }).catch(() => {});
    }
}

// ─── Combined showList ────────────────────────────────────────────────────────

async function showList(interaction, items, title) {
    if (items.length === 0) return interaction.editReply({ content: '❌ Tidak ada drama ditemukan.' });
    let index = 0;
    const customId = `cari_${interaction.id}`;

    const embed = buildUnifiedEmbed(items[index], index, items.length, title);
    const row = buildUnifiedButtons(index, items.length, items[index], customId);
    const msg = await interaction.editReply({ embeds: [embed], components: [row] });

    const collector = msg.createMessageComponentCollector({ time: 120_000 });
    collector.on('collect', async btn => {
        if (btn.user.id !== interaction.user.id) {
            return btn.reply({ content: 'Hanya pengguna yang menjalankan perintah ini yang bisa navigasi.', flags: 64 });
        }
        if (btn.customId.includes('_frdetail_')) {
            const key = btn.customId.split('_frdetail_')[1];
            await handleFrDetail(btn, key);
            return;
        }
        if (btn.customId.includes('_rsdetail_')) {
            const bookId = btn.customId.split('_rsdetail_')[1];
            await handleRsDetail(btn, bookId);
            return;
        }
        if (btn.customId.includes('_next_')) index = Math.min(index + 1, items.length - 1);
        else if (btn.customId.includes('_prev_')) index = Math.max(index - 1, 0);

        const newEmbed = buildUnifiedEmbed(items[index], index, items.length, title);
        const newRow = buildUnifiedButtons(index, items.length, items[index], customId);
        await btn.update({ embeds: [newEmbed], components: [newRow] });
    });
    collector.on('end', () => { interaction.editReply({ components: [] }).catch(() => {}); });
}

// ─── Command ──────────────────────────────────────────────────────────────────

module.exports = {
    data: [
        new SlashCommandBuilder()
            .setName('cari')
            .setDescription('Cari drama di FreeReels + ReelShort sekaligus')
            .addStringOption(opt =>
                opt.setName('judul').setDescription('Judul atau kata kunci drama').setRequired(true))
    ],

    async execute(interaction) {
        const judul = interaction.options.getString('judul');
        await interaction.deferReply({ flags: 64 });
        await interaction.editReply({ content: `🔍 Mencari **"${judul}"** di FreeReels + ReelShort...` });

        const allItems = [];
        const seen = new Set();

        // Search ReelShort (search endpoint works great)
        try {
            const rsData = await rsApi.search(judul, 1);
            for (const item of rsExtractItems(rsData)) {
                const id = item.bookId || item.book_id;
                if (id && !seen.has('rs_' + id)) { seen.add('rs_' + id); allItems.push(item); }
            }
        } catch (e) { console.warn('[cari] ReelShort search error:', e.message); }

        // Search FreeReels across multiple offsets
        try {
            const [homepageData, animeData] = await Promise.all([
                frApi.getHomepage().catch(() => null),
                frApi.getAnimePage().catch(() => null)
            ]);
            for (const d of [homepageData, animeData]) {
                for (const i of frExtractItems(d || {})) {
                    if (!seen.has('fr_' + i.key)) { seen.add('fr_' + i.key); allItems.push(i); }
                }
            }
            for (const offset of [0, 20, 40, 60, 80, 100, 120, 140, 160]) {
                try {
                    const d = await frApi.getForYou(offset);
                    const pageItems = frExtractItems(d);
                    if (pageItems.length === 0) break;
                    for (const i of pageItems) {
                        if (!seen.has('fr_' + i.key)) { seen.add('fr_' + i.key); allItems.push(i); }
                    }
                } catch (e) {
                    await new Promise(r => setTimeout(r, 1000));
                    break;
                }
            }
        } catch (e) { console.warn('[cari] FreeReels search error:', e.message); }

        const keyword = judul.toLowerCase();
        const matched = allItems.filter(i => {
            const text = [i.title, i.name, i.book_title, i.desc, i.description, i.special_desc, ...(i.content_tags || []), ...(i.tag || [])]
                .filter(Boolean).join(' ').toLowerCase();
            return text.includes(keyword);
        });

        if (matched.length === 0) {
            const frCount = allItems.filter(i => i._source === 'freereels').length;
            const rsCount = allItems.filter(i => i._source === 'reelshort').length;
            return interaction.editReply({
                content: `❌ **"${judul}"** tidak ditemukan.\n\n_(Dicari dari ${rsCount} drama ReelShort + ${frCount} drama FreeReels)_`
            });
        }

        const frCount = matched.filter(i => i._source === 'freereels').length;
        const rsCount = matched.filter(i => i._source === 'reelshort').length;
        await interaction.editReply({ content: `✅ Ditemukan **${matched.length} drama** (${rsCount} ReelShort, ${frCount} FreeReels)` });
        await showList(interaction, matched, `Cari: "${judul}"`);
    }
};
