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
const { getPlayerUrl, getDirectPlayerUrl } = require('../webserver');

// ─── Item normalizers ─────────────────────────────────────────────────────────

function normalizeFrItem(i) {
    return {
        _source: 'freereels',
        key: i.key,
        title: i.title || i.name || '',
        cover: i.cover || i.book_pic || null,
        desc: i.desc || i.description || '',
        tags: i.content_tags || i.tag || [],
        episodes: i.episode_count || null
    };
}

function normalizeRsItem(i) {
    return {
        _source: 'reelshort',
        key: i.bookId || i.book_id || '',
        title: i.title || i.book_title || '',
        cover: i.cover || i.book_pic || null,
        desc: i.description || i.special_desc || '',
        tags: Array.isArray(i.tag) ? i.tag : [],
        episodes: i.chapterCount || i.chapter_count || null
    };
}

function frExtractItems(data) {
    if (!data) return [];
    const inner = data.data || data;
    const items = inner.items || inner.list || inner.drama || inner.anime || (Array.isArray(inner) ? inner : []);
    return items.filter(i => i.key && i.key !== '' && i.item_type !== 'card').map(normalizeFrItem);
}

function rsExtractItems(data) {
    if (!data) return [];
    const d = data.data || data;
    const items = Array.isArray(d.lists) ? d.lists : Array.isArray(d.results) ? d.results : [];
    return items.filter(i => i.bookId || i.book_id).map(normalizeRsItem);
}

// ─── Embed builders ───────────────────────────────────────────────────────────

function buildListEmbed(item, index, total, listTitle) {
    const isFR = item._source === 'freereels';
    const tagArr = Array.isArray(item.tags) ? item.tags.map(t => typeof t === 'string' ? t : t?.name || '').filter(Boolean) : [];

    const embed = new EmbedBuilder()
        .setColor(isFR ? 0x5865F2 : 0xEB459E)
        .setTitle(item.title.slice(0, 256) || 'Unknown')
        .setAuthor({ name: listTitle })
        .setFooter({ text: `${isFR ? '🎭 FreeReels' : '🎬 ReelShort'} • ${index + 1}/${total}` })
        .setTimestamp();

    if (item.cover) embed.setImage(item.cover);
    if (item.desc) embed.setDescription(item.desc.length > 350 ? item.desc.slice(0, 347) + '...' : item.desc);
    if (tagArr.length > 0) embed.addFields({ name: '🏷️ Tag', value: tagArr.slice(0, 5).join(', '), inline: true });
    if (item.episodes) embed.addFields({ name: '📺 Episode', value: String(item.episodes), inline: true });

    return embed;
}

function buildListButtons(index, total, item, customId) {
    const detailId = item._source === 'freereels'
        ? `${customId}_frdet_${item.key}`
        : `${customId}_rsdet_${item.key}`;

    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${customId}_prev_${index}`).setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(index === 0),
        new ButtonBuilder().setCustomId(`${customId}_next_${index}`).setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(index === total - 1),
        new ButtonBuilder().setCustomId(detailId).setLabel('📋 Detail & Tonton').setStyle(ButtonStyle.Primary).setDisabled(!item.key)
    );
}

// ─── Episode select menus ─────────────────────────────────────────────────────

function buildEpisodeSelect(episodes, page, customId, prefix) {
    const pageSize = 25;
    const start = page * pageSize;
    const slice = episodes.slice(start, start + pageSize);

    const select = new StringSelectMenuBuilder()
        .setCustomId(`${customId}_${prefix}ep_${page}`)
        .setPlaceholder(`🎬 Pilih Episode (${start + 1}–${start + slice.length} dari ${episodes.length})`);

    for (let i = 0; i < slice.length; i++) {
        const ep = slice[i];
        select.addOptions(new StringSelectMenuOptionBuilder()
            .setLabel(ep.label || `Episode ${start + i + 1}`)
            .setDescription(ep.locked ? '🔒 Terkunci' : 'Klik untuk tonton di Discord')
            .setValue(`${start + i}`));
    }

    const rows = [new ActionRowBuilder().addComponents(select)];
    const nav = [];
    if (page > 0) nav.push(new ButtonBuilder().setCustomId(`${customId}_${prefix}prev_${page}`).setLabel('◀ Sebelumnya').setStyle(ButtonStyle.Secondary));
    if (start + pageSize < episodes.length) nav.push(new ButtonBuilder().setCustomId(`${customId}_${prefix}next_${page}`).setLabel('Selanjutnya ▶').setStyle(ButtonStyle.Secondary));
    if (nav.length > 0) rows.push(new ActionRowBuilder().addComponents(nav));
    return rows;
}

// ─── Stream link fallback ─────────────────────────────────────────────────────

async function sendStreamLink(interaction, streamUrl, title, epNum, platform) {
    const playerUrl = platform === 'freereels'
        ? getPlayerUrl(streamUrl, title, epNum)
        : getDirectPlayerUrl(streamUrl, title, epNum);

    const embed = new EmbedBuilder()
        .setColor(0xFEA800)
        .setTitle(`🔗 Episode ${epNum} - ${title.slice(0, 200)}`)
        .setDescription(`File terlalu besar untuk dikirim langsung di Discord.\n\n**[▶ Klik untuk tonton di browser](${playerUrl})**`)
        .setFooter({ text: 'Link streaming · Hanya kamu yang bisa melihat ini' });

    await interaction.editReply({ content: null, embeds: [embed] });
}

// ─── FreeReels episode handler ────────────────────────────────────────────────

async function handleFrEpisode(interaction, ep, epNum, info) {
    const videoUrl = ep.external_audio_h264_m3u8 || ep.external_audio_h265_m3u8 || ep.m3u8_url;
    if (!videoUrl) return interaction.editReply({ content: '❌ Link video tidak tersedia.' });

    const idSub = (ep.subtitle_list || []).find(s => s.language === 'id-ID');
    const subtitleUrl = idSub?.subtitle || null;
    const title = info.name || info.title || 'Drama';
    const note = subtitleUrl ? 'dengan subtitle Indonesia' : 'tanpa subtitle';

    await interaction.editReply({ content: `⏳ Mengunduh **Episode ${epNum}** - ${title} (${note})... 20–60 detik` });

    let filePath = null;
    try {
        const result = await downloadFreeReelsEpisode(videoUrl, subtitleUrl, ep.duration || null);
        filePath = result.filePath;
        const sizeMB = (result.sizeBytes / 1024 / 1024).toFixed(1);
        const attachment = new AttachmentBuilder(filePath, {
            name: `fr_ep${epNum}_${title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 28)}.mp4`
        });
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(`🎬 Episode ${epNum} - ${title.slice(0, 200)}`)
            .setDescription(subtitleUrl ? 'Subtitle Indonesia ter-embed · Langsung putar di Discord ↓' : 'Audio Mandarin · Langsung putar di Discord ↓')
            .setThumbnail(ep.cover || info.cover || null)
            .setFooter({ text: `FreeReels · ${sizeMB} MB · Hanya kamu yang bisa melihat ini` });
        await interaction.editReply({ content: null, embeds: [embed], files: [attachment] });
    } catch (err) {
        if (err.streamFallback && err.streamUrl) {
            console.log('[drama] FR stream fallback for ep', epNum);
            await sendStreamLink(interaction, err.streamUrl, title, epNum, 'freereels');
        } else {
            console.error('[drama/frEp]', err.message);
            await interaction.editReply({ content: `❌ Gagal: **${err.message}**`, embeds: [], files: [] }).catch(() => {});
        }
    } finally {
        if (filePath) cleanup(filePath);
    }
}

async function showFrDetail(interaction, key, userId) {
    await interaction.deferReply({ flags: 64 });
    try {
        const data = await frApi.getDetail(key);
        const info = data?.data?.info;
        if (!info) return interaction.editReply({ content: '❌ Detail tidak ditemukan.' });

        const rawEps = info.episode_list || [];
        const episodes = rawEps.map((ep, i) => ({ ...ep, label: `Episode ${i + 1}`, locked: false, _idx: i }));

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle((info.name || info.title || '').slice(0, 256))
            .setAuthor({ name: '📋 FreeReels · Detail Drama' })
            .setFooter({ text: 'Pilih episode dari dropdown · Hanya kamu yang melihat ini' });
        if (info.cover) embed.setImage(info.cover);
        if (info.desc) embed.setDescription(info.desc.slice(0, 400));
        if (info.episode_count) embed.addFields({ name: '📺 Total Episode', value: String(info.episode_count), inline: true });
        if (info.finish_status) embed.addFields({ name: '📡 Status', value: info.finish_status === 2 ? '✅ Tamat' : 'Sedang Tayang', inline: true });

        const customId = `frdet_${key}_${interaction.id}`;
        const rows = episodes.length > 0 ? buildEpisodeSelect(episodes, 0, customId, 'fr') : [];
        await interaction.editReply({ embeds: [embed], components: rows });
        if (episodes.length === 0) return;

        const msg = await interaction.fetchReply();
        let page = 0;
        const collector = msg.createMessageComponentCollector({ time: 300_000 });
        collector.on('collect', async c => {
            if (c.user.id !== userId) return c.reply({ content: '⛔ Kamu tidak bisa memilih episode ini.', flags: 64 });
            if (c.customId.includes('_frep_')) {
                const ep = episodes[parseInt(c.values[0])];
                await c.deferReply({ flags: 64 });
                await handleFrEpisode(c, rawEps[ep._idx], ep._idx + 1, info);
            } else if (c.customId.includes('_frnext_')) {
                page++;
                await c.update({ embeds: [embed], components: buildEpisodeSelect(episodes, page, customId, 'fr') });
            } else if (c.customId.includes('_frprev_')) {
                page--;
                await c.update({ embeds: [embed], components: buildEpisodeSelect(episodes, page, customId, 'fr') });
            }
        });
        collector.on('end', () => interaction.editReply({ components: [] }).catch(() => {}));
    } catch (err) {
        console.error('[drama/frDetail]', err.message);
        interaction.editReply({ content: `❌ Gagal: ${err.message}` }).catch(() => {});
    }
}

// ─── ReelShort episode handler ────────────────────────────────────────────────

async function handleRsEpisode(interaction, bookId, chapter, dramaTitle) {
    if (chapter.locked) return interaction.editReply({ content: '🔒 Episode ini terkunci (berbayar).' });

    const epNum = chapter.serialNumber;
    await interaction.editReply({ content: `⏳ Mengunduh **Episode ${epNum}** - ${dramaTitle}... 10–40 detik` });

    let filePath = null;
    try {
        const rawVid = await rsApi.getEpisodeVideo(bookId, epNum);
        const videoData = rawVid?.videoList ? rawVid : (rawVid?.data || rawVid);
        if (videoData.isLocked) return interaction.editReply({ content: '🔒 Episode ini terkunci.' });

        const videoList = videoData.videoList || [];
        const h264 = videoList.filter(v => v.encode === 'H264').sort((a, b) => a.quality - b.quality);
        const chosen = h264[0] || videoList.sort((a, b) => a.quality - b.quality)[0];
        if (!chosen) return interaction.editReply({ content: '❌ Link video tidak tersedia.' });

        const result = await downloadReelShortEpisode(chosen.url);
        filePath = result.filePath;
        const sizeMB = (result.sizeBytes / 1024 / 1024).toFixed(1);
        const attachment = new AttachmentBuilder(filePath, {
            name: `rs_ep${epNum}_${dramaTitle.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 28)}.mp4`
        });
        const embed = new EmbedBuilder()
            .setColor(0xEB459E)
            .setTitle(`🎬 Episode ${epNum} - ${dramaTitle.slice(0, 200)}`)
            .setDescription('ReelShort · Langsung putar di Discord di bawah ini ↓')
            .setFooter({ text: `ReelShort · ${sizeMB} MB · ${chosen.quality}p · Hanya kamu yang melihat ini` });
        await interaction.editReply({ content: null, embeds: [embed], files: [attachment] });
    } catch (err) {
        if (err.streamFallback && err.streamUrl) {
            console.log('[drama] RS stream fallback ep', epNum);
            await sendStreamLink(interaction, err.streamUrl, dramaTitle, epNum, 'reelshort');
        } else {
            console.error('[drama/rsEp]', err.message);
            await interaction.editReply({ content: `❌ Gagal: **${err.message}**`, embeds: [], files: [] }).catch(() => {});
        }
    } finally {
        if (filePath) cleanup(filePath);
    }
}

async function showRsDetail(interaction, bookId, userId) {
    await interaction.deferReply({ flags: 64 });
    try {
        const raw = await rsApi.getDetail(bookId);
        const data = (raw?.bookId || raw?.title) ? raw : (raw?.data || raw);
        if (!data?.bookId && !data?.title) return interaction.editReply({ content: '❌ Detail tidak ditemukan.' });

        const rawChapters = (data.chapters || []).filter(c => c.serialNumber > 0);
        const episodes = rawChapters.map((ch, i) => ({ ...ch, label: ch.title || `Episode ${ch.serialNumber}`, locked: !!ch.isLocked, _idx: i }));

        const embed = new EmbedBuilder()
            .setColor(0xEB459E)
            .setTitle((data.title || '').slice(0, 256))
            .setAuthor({ name: '📋 ReelShort · Detail Drama' })
            .setFooter({ text: 'Pilih episode dari dropdown · Hanya kamu yang melihat ini' });
        if (data.cover) embed.setImage(data.cover);
        if (data.description) embed.setDescription(data.description.slice(0, 400));
        if (data.totalEpisodes) embed.addFields({ name: '📺 Total Episode', value: String(data.totalEpisodes), inline: true });

        const customId = `rsdet_${bookId}_${interaction.id}`;
        const rows = episodes.length > 0 ? buildEpisodeSelect(episodes, 0, customId, 'rs') : [];
        await interaction.editReply({ embeds: [embed], components: rows });
        if (episodes.length === 0) return;

        const msg = await interaction.fetchReply();
        let page = 0;
        const collector = msg.createMessageComponentCollector({ time: 300_000 });
        collector.on('collect', async c => {
            if (c.user.id !== userId) return c.reply({ content: '⛔ Kamu tidak bisa memilih episode ini.', flags: 64 });
            if (c.customId.includes('_rsep_')) {
                const ep = episodes[parseInt(c.values[0])];
                await c.deferReply({ flags: 64 });
                await handleRsEpisode(c, bookId, rawChapters[ep._idx], data.title);
            } else if (c.customId.includes('_rsnext_')) {
                page++;
                await c.update({ embeds: [embed], components: buildEpisodeSelect(episodes, page, customId, 'rs') });
            } else if (c.customId.includes('_rsprev_')) {
                page--;
                await c.update({ embeds: [embed], components: buildEpisodeSelect(episodes, page, customId, 'rs') });
            }
        });
        collector.on('end', () => interaction.editReply({ components: [] }).catch(() => {}));
    } catch (err) {
        console.error('[drama/rsDetail]', err.message);
        interaction.editReply({ content: `❌ Gagal: ${err.message}` }).catch(() => {});
    }
}

// ─── Public list view ─────────────────────────────────────────────────────────

async function showList(interaction, items, listTitle) {
    if (items.length === 0) return interaction.editReply({ content: '❌ Tidak ada drama ditemukan.' });

    let index = 0;
    const customId = `drama_${interaction.id}`;
    const userId = interaction.user.id;

    const embed = buildListEmbed(items[0], 0, items.length, listTitle);
    const row = buildListButtons(0, items.length, items[0], customId);
    const msg = await interaction.editReply({ embeds: [embed], components: [row] });

    const collector = msg.createMessageComponentCollector({ time: 180_000 });
    collector.on('collect', async btn => {
        if (btn.user.id !== userId) {
            return btn.reply({ content: '⛔ Hanya pengguna yang menjalankan perintah ini yang bisa navigasi.', flags: 64 });
        }

        if (btn.customId.includes('_frdet_')) {
            const key = btn.customId.split('_frdet_')[1];
            await showFrDetail(btn, key, userId);
            return;
        }
        if (btn.customId.includes('_rsdet_')) {
            const key = btn.customId.split('_rsdet_')[1];
            await showRsDetail(btn, key, userId);
            return;
        }

        if (btn.customId.includes('_next_')) index = Math.min(index + 1, items.length - 1);
        else if (btn.customId.includes('_prev_')) index = Math.max(index - 1, 0);

        await btn.update({
            embeds: [buildListEmbed(items[index], index, items.length, listTitle)],
            components: [buildListButtons(index, items.length, items[index], customId)]
        });
    });
    collector.on('end', () => interaction.editReply({ components: [] }).catch(() => {}));
}

// ─── Command ──────────────────────────────────────────────────────────────────

module.exports = {
    data: [
        new SlashCommandBuilder()
            .setName('drama')
            .setDescription('Cari dan tonton drama FreeReels + ReelShort')
            .addSubcommand(sub =>
                sub.setName('cari')
                    .setDescription('Cari drama di FreeReels + ReelShort sekaligus')
                    .addStringOption(opt =>
                        opt.setName('judul').setDescription('Judul atau kata kunci drama').setRequired(true)))
            .addSubcommand(sub =>
                sub.setName('foryou')
                    .setDescription('Browse drama For You dari FreeReels')
                    .addIntegerOption(opt =>
                        opt.setName('offset').setDescription('Offset halaman (default: 0)').setMinValue(0)))
            .addSubcommand(sub =>
                sub.setName('reelshort')
                    .setDescription('Browse drama For You dari ReelShort')
                    .addIntegerOption(opt =>
                        opt.setName('offset').setDescription('Offset halaman (default: 0)').setMinValue(0)))
    ],

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();

        // All browse commands use PUBLIC reply (no flags) — ephemeral only for video/stream
        await interaction.deferReply();

        try {
            if (sub === 'cari') {
                const judul = interaction.options.getString('judul');
                await interaction.editReply({ content: `🔍 Mencari **"${judul}"** di FreeReels + ReelShort...` });

                const allItems = [];
                const seen = new Set();

                // ReelShort: real search API (fast, accurate)
                try {
                    const rsData = await rsApi.search(judul, 1);
                    for (const item of rsExtractItems(rsData)) {
                        if (!seen.has(item.key)) { seen.add(item.key); allItems.push(item); }
                    }
                } catch (e) { console.warn('[drama/cari] RS error:', e.message); }

                // FreeReels: filter across local data
                try {
                    const [homeData, animeData] = await Promise.all([
                        frApi.getHomepage().catch(() => null),
                        frApi.getAnimePage().catch(() => null)
                    ]);
                    for (const d of [homeData, animeData]) {
                        for (const i of frExtractItems(d)) {
                            if (!seen.has(i.key)) { seen.add(i.key); allItems.push(i); }
                        }
                    }
                    for (const offset of [0, 20, 40, 60, 80, 100, 120, 140, 160]) {
                        try {
                            const d = await frApi.getForYou(offset);
                            const pageItems = frExtractItems(d);
                            if (pageItems.length === 0) break;
                            for (const i of pageItems) {
                                if (!seen.has(i.key)) { seen.add(i.key); allItems.push(i); }
                            }
                        } catch { break; }
                    }
                } catch (e) { console.warn('[drama/cari] FR error:', e.message); }

                const kw = judul.toLowerCase();
                const matched = allItems.filter(i => {
                    const text = [i.title, i.desc, ...(Array.isArray(i.tags) ? i.tags.map(t => typeof t === 'string' ? t : t?.name || '') : [])]
                        .filter(Boolean).join(' ').toLowerCase();
                    return text.includes(kw);
                });

                if (matched.length === 0) {
                    const frCount = allItems.filter(i => i._source === 'freereels').length;
                    const rsCount = allItems.filter(i => i._source === 'reelshort').length;
                    return interaction.editReply({
                        content: `❌ **"${judul}"** tidak ditemukan.\n_(Dicari dari ${rsCount} drama ReelShort + ${frCount} drama FreeReels)_`
                    });
                }

                const rsFound = matched.filter(i => i._source === 'reelshort').length;
                const frFound = matched.filter(i => i._source === 'freereels').length;
                await interaction.editReply({ content: `✅ Ditemukan **${matched.length} drama** (${rsFound} ReelShort, ${frFound} FreeReels) — gunakan ◀ ▶ untuk navigasi` });
                await showList(interaction, matched, `Cari: "${judul}"`);

            } else if (sub === 'foryou') {
                const offset = interaction.options.getInteger('offset') || 0;
                const data = await frApi.getForYou(offset);
                const items = frExtractItems(data);
                if (!items.length) return interaction.editReply({ content: '❌ Tidak ada data.' });
                await showList(interaction, items, `FreeReels · For You (offset ${offset})`);

            } else if (sub === 'reelshort') {
                const offset = interaction.options.getInteger('offset') || 0;
                const data = await rsApi.getForYou(offset);
                const items = rsExtractItems(data);
                if (!items.length) return interaction.editReply({ content: '❌ Tidak ada data.' });
                await showList(interaction, items, `ReelShort · For You (offset ${offset})`);
            }

        } catch (err) {
            console.error('[drama] Error:', err.message);
            await interaction.editReply({ content: `❌ Terjadi kesalahan: **${err.message}**` }).catch(() => {});
        }
    }
};
