const {
    SlashCommandBuilder, EmbedBuilder, ActionRowBuilder,
    ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder, AttachmentBuilder
} = require('discord.js');

const frApi = require('../api/freereels');
const rsApi = require('../api/reelshort');
const mlApi = require('../api/melolo');
const nsApi = require('../api/netshort');
const { downloadFreeReelsEpisode, downloadReelShortEpisode, downloadMeloloEpisode, downloadNetShortEpisode, headCheckSize, cleanup } = require('../video');
const { getPlayerUrl, getDirectPlayerUrl, getMeloloPlayerUrl, getNsPlayerUrl, getMbPlayerUrl } = require('../webserver');
const { trackCommand } = require('../stats');
const mbApi = require('../api/moviebox');

// ─── Item normalizers ─────────────────────────────────────────────────────────

function normalizeFr(i) {
    return { _source: 'freereels', key: i.key, title: i.title || i.name || '', cover: i.cover || i.book_pic || null, desc: i.desc || i.description || '', tags: i.content_tags || i.tag || [], episodes: i.episode_count || null };
}
function normalizeRs(i) {
    return { _source: 'reelshort', key: i.bookId || i.book_id || '', title: i.title || i.book_title || '', cover: i.cover || i.book_pic || null, desc: i.description || i.special_desc || '', tags: Array.isArray(i.tag) ? i.tag : [], episodes: i.chapterCount || i.chapter_count || null };
}

function frExtract(data) {
    if (!data) return [];
    const inner = data.data || data;
    const items = inner.items || inner.list || inner.drama || inner.anime || (Array.isArray(inner) ? inner : []);
    return items.filter(i => i.key && i.key !== '' && i.item_type !== 'card').map(normalizeFr);
}
function rsExtract(data) {
    if (!data) return [];
    const d = data.data || data;
    const items = Array.isArray(d.lists) ? d.lists : Array.isArray(d.results) ? d.results : [];
    return items.filter(i => i.bookId || i.book_id).map(normalizeRs);
}
function mbExtract(data) {
    return mbApi.parseItems(data).map(i => ({
        _source: 'moviebox',
        key: i.key,
        title: i.title,
        cover: i.cover,
        desc: [
            i.genre,
            i.country ? `🌍 ${i.country}` : '',
            i.imdb ? `⭐ IMDB ${i.imdb}` : '',
            i.desc,
        ].filter(Boolean).join(' · ').slice(0, 400),
        tags: [],
        episodes: null,
    }));
}

// ─── List embed builders ──────────────────────────────────────────────────────

const COLORS = { freereels: 0x5865F2, reelshort: 0xEB459E, melolo: 0xFF6B35, moviebox: 0xFFC107, netshort: 0x00C9A7 };
const LABELS = { freereels: '🎭 FreeReels', reelshort: '🎬 ReelShort', melolo: '🎥 Melolo', moviebox: '🎬 MovieBox', netshort: '📱 NetShort' };

function buildListEmbed(item, idx, total, listTitle) {
    const tags = Array.isArray(item.tags) ? item.tags.map(t => typeof t === 'string' ? t : t?.name || '').filter(Boolean) : [];
    const embed = new EmbedBuilder()
        .setColor(COLORS[item._source] || 0x99AAB5)
        .setTitle((item.title || 'Unknown').slice(0, 256))
        .setAuthor({ name: listTitle })
        .setFooter({ text: `${LABELS[item._source]} • ${idx + 1}/${total}` })
        .setTimestamp();
    if (item.cover) embed.setImage(item.cover);
    if (item.desc) embed.setDescription(item.desc.length > 350 ? item.desc.slice(0, 347) + '...' : item.desc);
    if (tags.length > 0) embed.addFields({ name: '🏷️ Tag', value: tags.slice(0, 5).join(', '), inline: true });
    if (item.episodes) embed.addFields({ name: '📺 Episode', value: String(item.episodes), inline: true });
    return embed;
}

function buildNavRow(customId, idx, total, item) {
    const detailId = `${customId}_det_${item._source}_${item.key}`;
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${customId}_prev_${idx}`).setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(idx === 0),
        new ButtonBuilder().setCustomId(`${customId}_next_${idx}`).setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(idx === total - 1),
        new ButtonBuilder().setCustomId(detailId).setLabel('📋 Detail & Tonton').setStyle(ButtonStyle.Primary)
    );
}

// ─── Episode select dropdown ──────────────────────────────────────────────────

function buildEpisodeSelect(episodes, page, selectId, navId) {
    const PAGE_SIZE = 25;
    const start = page * PAGE_SIZE;
    const slice = episodes.slice(start, start + PAGE_SIZE);

    const select = new StringSelectMenuBuilder()
        .setCustomId(selectId)
        .setPlaceholder(`🎬 Pilih Episode (${start + 1}–${start + slice.length} dari ${episodes.length})`);

    slice.forEach((ep, i) => {
        select.addOptions(new StringSelectMenuOptionBuilder()
            .setLabel((ep.label || `EPISODE ${start + i + 1}`).slice(0, 100))
            .setDescription((ep.locked ? '🔒 Terkunci' : 'Klik untuk pilih kualitas & tonton').slice(0, 100))
            .setValue(String(start + i)));
    });

    const rows = [new ActionRowBuilder().addComponents(select)];
    const nav = [];
    if (page > 0) nav.push(new ButtonBuilder().setCustomId(`${navId}_prev_${page}`).setLabel('◀ Sebelumnya').setStyle(ButtonStyle.Secondary));
    if (start + PAGE_SIZE < episodes.length) nav.push(new ButtonBuilder().setCustomId(`${navId}_next_${page}`).setLabel('Selanjutnya ▶').setStyle(ButtonStyle.Secondary));
    if (nav.length) rows.push(new ActionRowBuilder().addComponents(nav));
    return rows;
}

// ─── Quality picker ───────────────────────────────────────────────────────────

function buildQualityRow(qCustomId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${qCustomId}_q360`).setLabel('📱 360p — Discord').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${qCustomId}_q720`).setLabel('📺 720p — Discord').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`${qCustomId}_qstream`).setLabel('🌐 Tonton di Browser').setStyle(ButtonStyle.Secondary)
    );
}

async function showQualityPicker(c, userId, epLabel, callback) {
    const qCustomId = `q_${c.id}_${Date.now()}`;
    await c.editReply({
        content: `🎬 **${epLabel}**\n\nPilih kualitas video:`,
        components: [buildQualityRow(qCustomId)]
    });
    const qMsg = await c.fetchReply();
    const qCol = qMsg.createMessageComponentCollector({ time: 60_000, max: 1 });

    qCol.on('collect', async q => {
        try {
            if (q.user.id !== userId) return q.reply({ content: '⛔ Bukan giliran kamu.', flags: 64 });
            const quality = q.customId.endsWith('_q360') ? '360p' : q.customId.endsWith('_q720') ? '720p' : 'stream';
            await q.update({ content: '⏳ Memproses...', components: [] });
            await callback(q, quality);
        } catch (err) {
            if (err.code === 10062 || err.code === 40060) return;
            console.error('[qualityCollect]', err.message);
            await c.editReply({ content: `❌ Terjadi kesalahan: ${err.message}`, components: [] }).catch(() => {});
        }
    });
    qCol.on('end', () => {});
}

// ─── Next episode button helper ───────────────────────────────────────────────

function buildNextEpRow(btnId, nextEpNum) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(btnId)
            .setLabel(`▶  EPISODE ${nextEpNum} Selanjutnya`)
            .setStyle(ButtonStyle.Success)
    );
}

async function attachNextEpBtn(interaction, nextEpNum, userId, onNext) {
    const btnId = `nxep_${nextEpNum}_${Date.now()}`;
    try {
        await interaction.editReply({ components: [buildNextEpRow(btnId, nextEpNum)] });
        const msg = await interaction.fetchReply();
        const col = msg.createMessageComponentCollector({
            filter: i => i.customId === btnId,
            time: 180_000, max: 1
        });
        col.on('collect', async btn => {
            try {
                if (btn.user.id !== userId) return btn.reply({ content: '⛔ Bukan giliran kamu.', flags: 64 });
                await btn.deferUpdate();
                await onNext(btn);
            } catch (err) {
                if (err.code === 10062 || err.code === 40060) return;
                console.error('[nextEpBtn]', err.message);
            }
        });
        col.on('end', () => {});
    } catch (err) {
        if (err.code === 10062 || err.code === 40060) return;
        console.error('[attachNextEpBtn]', err.message);
    }
}

// ─── Stream link sender ───────────────────────────────────────────────────────

async function sendStreamLink(q, streamUrl, title, epNum, platform, extraRows = []) {
    let playerUrl;
    if (platform === 'freereels') playerUrl = getPlayerUrl(streamUrl, title, epNum);
    else if (platform === 'reelshort') playerUrl = getDirectPlayerUrl(streamUrl, title, epNum);
    else if (platform === 'netshort') playerUrl = getNsPlayerUrl(streamUrl, title, epNum);
    else playerUrl = getMeloloPlayerUrl(streamUrl, title, epNum);

    const embed = new EmbedBuilder()
        .setColor(0xFEA800)
        .setTitle(`🔗 EPISODE ${epNum} — ${title.slice(0, 200)}`)
        .setDescription(`File terlalu besar atau kualitas terlalu tinggi untuk Discord.\n\n**[▶ Klik untuk tonton di browser](${playerUrl})**\n\nLink streaming kualitas penuh tanpa kompresi.`)
        .setFooter({ text: `${LABELS[platform] || platform} · Streaming · Hanya kamu yang bisa melihat ini` });
    await q.editReply({ content: null, embeds: [embed], components: extraRows });
    trackCommand({ platform, user: q.user?.username || 'unknown', action: `Ep ${epNum}`, title, result: 'stream' });
}

// ─── Video file sender ────────────────────────────────────────────────────────

async function sendVideoFile(q, filePath, sizeBytes, title, epNum, platform, quality, extraRows = []) {
    const sizeMB = (sizeBytes / 1024 / 1024).toFixed(1);
    const attachment = new AttachmentBuilder(filePath, {
        name: `${platform}_ep${epNum}_${title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 25)}.mp4`
    });
    const embed = new EmbedBuilder()
        .setColor(COLORS[platform] || 0x99AAB5)
        .setTitle(`🎬 EPISODE ${epNum} — ${title.slice(0, 200)}`)
        .setDescription(`Kualitas: **${quality}** · Langsung putar di Discord ↓`)
        .setFooter({ text: `${LABELS[platform]} · ${sizeMB} MB · Hanya kamu yang melihat ini` });
    await q.editReply({ content: null, embeds: [embed], files: [attachment], components: extraRows });
    trackCommand({ platform, user: q.user?.username || 'unknown', action: `Ep ${epNum} (${quality})`, title, result: 'download' });
}

// ─── FreeReels ────────────────────────────────────────────────────────────────

async function showFrDetail(interaction, key, userId) {
    await interaction.deferReply({ flags: 64 });
    try {
        const data = await frApi.getDetail(key);
        const info = data?.data?.info;
        if (!info) return interaction.editReply({ content: '❌ Detail tidak ditemukan.' });

        const rawEps = info.episode_list || [];
        const episodes = rawEps.map((ep, i) => ({ ...ep, label: `EPISODE ${i + 1}`, locked: false, _idx: i }));

        const embed = new EmbedBuilder()
            .setColor(COLORS.freereels)
            .setTitle((info.name || info.title || '').slice(0, 256))
            .setAuthor({ name: '📋 FreeReels · Detail Drama' })
            .setFooter({ text: 'Pilih episode lalu kualitas · Hanya kamu yang melihat ini' });
        if (info.cover) embed.setImage(info.cover);
        if (info.desc) embed.setDescription(info.desc.slice(0, 400));
        if (info.episode_count) embed.addFields({ name: '📺 Total Episode', value: String(info.episode_count), inline: true });
        if (info.finish_status) embed.addFields({ name: '📡 Status', value: info.finish_status === 2 ? '✅ Tamat' : 'Sedang Tayang', inline: true });

        const cid = `frdet_${key}_${interaction.id}`;
        const rows = episodes.length > 0 ? buildEpisodeSelect(episodes, 0, `${cid}_sel`, `${cid}_nav`) : [];
        await interaction.editReply({ embeds: [embed], components: rows });
        if (episodes.length === 0) return;

        const title = info.name || info.title || 'Drama';

        async function processFrEp(target, epIdx, quality) {
            const ep = episodes[epIdx];
            if (!ep) return;
            const rawEp = rawEps[ep._idx];
            const videoUrl = rawEp.external_audio_h264_m3u8 || rawEp.external_audio_h265_m3u8 || rawEp.m3u8_url;
            const idSub = (rawEp.subtitle_list || []).find(s => s.language === 'id-ID');
            const subUrl = idSub?.subtitle || null;
            const epNum = ep._idx + 1;
            const hasNext = epIdx + 1 < episodes.length;

            if (!videoUrl) return target.editReply({ content: '❌ Link video tidak tersedia.', components: [] });

            if (quality === 'stream') {
                await sendStreamLink(target, videoUrl, title, epNum, 'freereels');
                if (hasNext) await attachNextEpBtn(target, epIdx + 2, userId, btn => processFrEp(btn, epIdx + 1, quality));
                return;
            }

            await target.editReply({ content: `⏳ Mengunduh EPISODE ${epNum} (${quality})... 20–90 detik`, components: [] });
            let filePath = null;
            try {
                const res = await downloadFreeReelsEpisode(videoUrl, subUrl, rawEp.duration || null, quality);
                filePath = res.filePath;
                await sendVideoFile(target, filePath, res.sizeBytes, title, epNum, 'freereels', quality);
                if (hasNext) await attachNextEpBtn(target, epIdx + 2, userId, btn => processFrEp(btn, epIdx + 1, quality));
            } catch (err) {
                if (err.streamFallback && err.streamUrl) {
                    await sendStreamLink(target, err.streamUrl, title, epNum, 'freereels');
                    if (hasNext) await attachNextEpBtn(target, epIdx + 2, userId, btn => processFrEp(btn, epIdx + 1, quality));
                    return;
                }
                await target.editReply({ content: `❌ Gagal: ${err.message}`, files: [], components: [] }).catch(() => {});
            } finally { if (filePath) cleanup(filePath); }
        }

        const msg = await interaction.fetchReply();
        let page = 0;
        const col = msg.createMessageComponentCollector({ time: 300_000 });
        col.on('collect', async c => {
            try {
                if (c.user.id !== userId) return c.reply({ content: '⛔ Hanya kamu yang bisa memilih.', flags: 64 });
                if (c.isStringSelectMenu()) {
                    const epIdx = parseInt(c.values[0]);
                    const ep = episodes[epIdx];
                    if (!ep) return;
                    if (ep.locked) return c.reply({ content: '🔒 Episode ini terkunci.', flags: 64 });
                    await c.deferReply({ flags: 64 });
                    const epLabel = `${ep.label} — ${title}`;
                    await showQualityPicker(c, userId, epLabel, async (q, quality) => {
                        await processFrEp(q, epIdx, quality);
                    });
                } else if (c.isButton()) {
                    if (c.customId.includes('_nav_next_')) { page++; await c.update({ embeds: [embed], components: buildEpisodeSelect(episodes, page, `${cid}_sel`, `${cid}_nav`) }); }
                    else if (c.customId.includes('_nav_prev_')) { page--; await c.update({ embeds: [embed], components: buildEpisodeSelect(episodes, page, `${cid}_sel`, `${cid}_nav`) }); }
                }
            } catch (err) {
                if (err.code === 10062 || err.code === 40060) return;
                console.error('[frDetail collect]', err.message);
            }
        });
        col.on('end', () => {});
    } catch (err) {
        console.error('[frDetail]', err.message);
        interaction.editReply({ content: `❌ Gagal: ${err.message}` }).catch(() => {});
    }
}

// ─── ReelShort ────────────────────────────────────────────────────────────────

async function showRsDetail(interaction, bookId, userId) {
    await interaction.deferReply({ flags: 64 });
    try {
        const raw = await rsApi.getDetail(bookId);
        const data = (raw?.bookId || raw?.title) ? raw : (raw?.data || raw);
        if (!data?.bookId && !data?.title) return interaction.editReply({ content: '❌ Detail tidak ditemukan.' });

        const rawChapters = (data.chapters || []).filter(c => c.serialNumber > 0);
        const episodes = rawChapters.map((ch, i) => ({ ...ch, label: ch.title || `EPISODE ${ch.serialNumber}`, locked: !!ch.isLocked, _idx: i }));
        const title = data.title || '';

        const embed = new EmbedBuilder()
            .setColor(COLORS.reelshort)
            .setTitle(title.slice(0, 256))
            .setAuthor({ name: '📋 ReelShort · Detail Drama' })
            .setFooter({ text: 'Pilih episode lalu kualitas · Hanya kamu yang melihat ini' });
        if (data.cover) embed.setImage(data.cover);
        if (data.description) embed.setDescription(data.description.slice(0, 400));
        if (data.totalEpisodes) embed.addFields({ name: '📺 Total Episode', value: String(data.totalEpisodes), inline: true });

        const cid = `rsdet_${bookId}_${interaction.id}`;
        const rows = episodes.length > 0 ? buildEpisodeSelect(episodes, 0, `${cid}_sel`, `${cid}_nav`) : [];
        await interaction.editReply({ embeds: [embed], components: rows });
        if (episodes.length === 0) return;

        async function processRsEp(target, epIdx, quality) {
            const ep = episodes[epIdx];
            if (!ep) return;
            const chapter = rawChapters[ep._idx];
            const epNum = chapter.serialNumber;
            const hasNext = epIdx + 1 < episodes.length;

            if (quality === 'stream') {
                await target.editReply({ content: '⏳ Mengambil link streaming...', components: [] });
                try {
                    const rawVid = await rsApi.getEpisodeVideo(bookId, epNum);
                    const vd = rawVid?.videoList ? rawVid : (rawVid?.data || rawVid);
                    const vl = vd.videoList || [];
                    const best = vl.sort((a, b) => b.quality - a.quality)[0];
                    if (!best) return target.editReply({ content: '❌ Link video tidak tersedia.', components: [] });
                    await sendStreamLink(target, best.url, title, epNum, 'reelshort');
                    if (hasNext) await attachNextEpBtn(target, epIdx + 2, userId, btn => processRsEp(btn, epIdx + 1, quality));
                } catch (err) { return target.editReply({ content: `❌ Gagal: ${err.message}`, components: [] }); }
                return;
            }

            await target.editReply({ content: `⏳ Mengunduh EPISODE ${epNum} (${quality})... 10–60 detik`, components: [] });
            let filePath = null;
            try {
                const rawVid = await rsApi.getEpisodeVideo(bookId, epNum);
                const vd = rawVid?.videoList ? rawVid : (rawVid?.data || rawVid);
                if (vd.isLocked) return target.editReply({ content: '🔒 Episode ini terkunci.', components: [] });

                const vl = vd.videoList || [];
                const h264 = vl.filter(v => v.encode === 'H264').sort((a, b) => a.quality - b.quality);
                const all = vl.sort((a, b) => a.quality - b.quality);
                let chosen;
                if (quality === '720p') {
                    const sorted = (h264.length ? h264 : all);
                    chosen = sorted[sorted.length - 1];
                } else {
                    chosen = (h264.length ? h264 : all)[0];
                }
                if (!chosen) return target.editReply({ content: '❌ Link video tidak tersedia.', components: [] });

                const res = await downloadReelShortEpisode(chosen.url, quality);
                filePath = res.filePath;
                await sendVideoFile(target, filePath, res.sizeBytes, title, epNum, 'reelshort', quality);
                if (hasNext) await attachNextEpBtn(target, epIdx + 2, userId, btn => processRsEp(btn, epIdx + 1, quality));
            } catch (err) {
                if (err.streamFallback && err.streamUrl) {
                    await sendStreamLink(target, err.streamUrl, title, epNum, 'reelshort');
                    if (hasNext) await attachNextEpBtn(target, epIdx + 2, userId, btn => processRsEp(btn, epIdx + 1, quality));
                    return;
                }
                await target.editReply({ content: `❌ Gagal: ${err.message}`, files: [], components: [] }).catch(() => {});
            } finally { if (filePath) cleanup(filePath); }
        }

        const msg = await interaction.fetchReply();
        let page = 0;
        const col = msg.createMessageComponentCollector({ time: 300_000 });
        col.on('collect', async c => {
            try {
                if (c.user.id !== userId) return c.reply({ content: '⛔ Hanya kamu yang bisa memilih.', flags: 64 });
                if (c.isStringSelectMenu()) {
                    const epIdx = parseInt(c.values[0]);
                    const ep = episodes[epIdx];
                    if (!ep) return;
                    if (ep.locked) return c.reply({ content: '🔒 Episode ini terkunci.', flags: 64 });
                    await c.deferReply({ flags: 64 });
                    const epLabel = `${ep.label} — ${title}`;
                    await showQualityPicker(c, userId, epLabel, async (q, quality) => {
                        await processRsEp(q, epIdx, quality);
                    });
                } else if (c.isButton()) {
                    if (c.customId.includes('_nav_next_')) { page++; await c.update({ embeds: [embed], components: buildEpisodeSelect(episodes, page, `${cid}_sel`, `${cid}_nav`) }); }
                    else if (c.customId.includes('_nav_prev_')) { page--; await c.update({ embeds: [embed], components: buildEpisodeSelect(episodes, page, `${cid}_sel`, `${cid}_nav`) }); }
                }
            } catch (err) {
                if (err.code === 10062 || err.code === 40060) return;
                console.error('[rsDetail collect]', err.message);
            }
        });
        col.on('end', () => {});
    } catch (err) {
        console.error('[rsDetail]', err.message);
        interaction.editReply({ content: `❌ Gagal: ${err.message}` }).catch(() => {});
    }
}

// ─── Melolo ────────────────────────────────────────────────────────────────────

async function showMlDetail(interaction, bookId, userId) {
    await interaction.deferReply({ flags: 64 });
    try {
        const raw = await mlApi.getDetail(bookId);
        const detail = mlApi.parseDetail(raw);
        if (!detail.title) return interaction.editReply({ content: '❌ Detail tidak ditemukan.' });

        const episodes = detail.episodes.map((ep, i) => ({ ...ep, label: ep.title || `EPISODE ${ep.index}`, locked: ep.locked, _idx: i }));
        const title = detail.title;

        const embed = new EmbedBuilder()
            .setColor(COLORS.melolo)
            .setTitle(title.slice(0, 256))
            .setAuthor({ name: '📋 Melolo · Detail Drama' })
            .setFooter({ text: 'Pilih episode lalu kualitas · Hanya kamu yang melihat ini' });
        if (detail.cover) embed.setImage(detail.cover);
        if (detail.desc) embed.setDescription(detail.desc.slice(0, 400));
        if (detail.episodeCount) embed.addFields({ name: '📺 Total Episode', value: String(detail.episodeCount), inline: true });

        const cid = `mldet_${bookId}_${interaction.id}`;
        const rows = episodes.length > 0 ? buildEpisodeSelect(episodes, 0, `${cid}_sel`, `${cid}_nav`) : [];
        await interaction.editReply({ embeds: [embed], components: rows });
        if (episodes.length === 0) return;

        async function processMlEp(target, epIdx, quality) {
            const ep = episodes[epIdx];
            if (!ep) return;
            const rawEp = detail.episodes[ep._idx];
            const epNum = rawEp.index;
            const hasNext = epIdx + 1 < episodes.length;

            await target.editReply({ content: '⏳ Mengambil link video...', components: [] });
            let filePath = null;
            try {
                const streamRaw = await mlApi.getStream(rawEp.vid);
                const { qualities, topUrl, duration } = mlApi.parseVideoQualities(streamRaw.data || streamRaw);
                const dur = rawEp.duration || duration;

                if (quality === 'stream') {
                    const streamUrl = topUrl || (qualities[qualities.length - 1]?.url || '');
                    if (!streamUrl) return target.editReply({ content: '❌ URL streaming tidak tersedia.', components: [] });
                    await sendStreamLink(target, streamUrl, title, epNum, 'melolo');
                    if (hasNext) await attachNextEpBtn(target, epIdx + 2, userId, btn => processMlEp(btn, epIdx + 1, quality));
                    return;
                }

                let chosen;
                if (quality === '720p') {
                    chosen = qualities.find(v => v.definition === '720p' || v.height >= 720) || qualities[qualities.length - 1];
                } else {
                    chosen = qualities.find(v => v.definition === '360p' || v.definition === '240p' || v.height <= 480) || qualities[0];
                }
                if (!chosen) return target.editReply({ content: '❌ URL video tidak tersedia.', components: [] });

                await target.editReply({ content: `⏳ Mengunduh EPISODE ${epNum} (${quality})... 20–90 detik`, components: [] });
                const res = await downloadMeloloEpisode(chosen.url, dur, quality);
                filePath = res.filePath;
                await sendVideoFile(target, filePath, res.sizeBytes, title, epNum, 'melolo', quality);
                if (hasNext) await attachNextEpBtn(target, epIdx + 2, userId, btn => processMlEp(btn, epIdx + 1, quality));
            } catch (err) {
                if (err.streamFallback && err.streamUrl) {
                    await sendStreamLink(target, err.streamUrl, title, epNum, 'melolo');
                    if (hasNext) await attachNextEpBtn(target, epIdx + 2, userId, btn => processMlEp(btn, epIdx + 1, quality));
                    return;
                }
                await target.editReply({ content: `❌ Gagal: ${err.message}`, files: [], components: [] }).catch(() => {});
            } finally { if (filePath) cleanup(filePath); }
        }

        const msg = await interaction.fetchReply();
        let page = 0;
        const col = msg.createMessageComponentCollector({ time: 300_000 });
        col.on('collect', async c => {
            try {
                if (c.user.id !== userId) return c.reply({ content: '⛔ Hanya kamu yang bisa memilih.', flags: 64 });
                if (c.isStringSelectMenu()) {
                    const epIdx = parseInt(c.values[0]);
                    const ep = episodes[epIdx];
                    if (!ep) return;
                    if (ep.locked) return c.reply({ content: '🔒 Episode ini terkunci.', flags: 64 });
                    await c.deferReply({ flags: 64 });
                    const epLabel = `${ep.label} — ${title}`;
                    await showQualityPicker(c, userId, epLabel, async (q, quality) => {
                        await processMlEp(q, epIdx, quality);
                    });
                } else if (c.isButton()) {
                    if (c.customId.includes('_nav_next_')) { page++; await c.update({ embeds: [embed], components: buildEpisodeSelect(episodes, page, `${cid}_sel`, `${cid}_nav`) }); }
                    else if (c.customId.includes('_nav_prev_')) { page--; await c.update({ embeds: [embed], components: buildEpisodeSelect(episodes, page, `${cid}_sel`, `${cid}_nav`) }); }
                }
            } catch (err) {
                if (err.code === 10062 || err.code === 40060) return;
                console.error('[mlDetail collect]', err.message);
            }
        });
        col.on('end', () => {});
    } catch (err) {
        console.error('[mlDetail]', err.message);
        interaction.editReply({ content: `❌ Gagal: ${err.message}` }).catch(() => {});
    }
}

// ─── MovieBox ─────────────────────────────────────────────────────────────────

async function showMbDetail(interaction, subjectId, userId) {
    await interaction.deferReply({ flags: 64 });
    try {
        const detail = await mbApi.getDetail(subjectId);
        const subject = detail?.subject;
        if (!subject) return interaction.editReply({ content: '❌ Detail tidak ditemukan.' });

        const title = subject.title || 'Unknown';
        const cover = subject.cover?.url || subject.thumbnail;
        const genre = subject.genre || '';
        const country = subject.countryName || '';
        const imdb = subject.imdbRatingValue || '';
        const desc = subject.description || detail.metadata?.description || '';
        const duration = subject.duration > 0 ? `${Math.round(subject.duration / 60)} menit` : null;
        const stars = (detail.stars || []).slice(0, 4).map(s => s.name).filter(Boolean).join(', ');
        const seasons = detail.resource?.seasons || [];
        const isSeries = seasons.length > 0;

        const embed = new EmbedBuilder()
            .setColor(COLORS.moviebox)
            .setTitle(title.slice(0, 256))
            .setAuthor({ name: isSeries ? '📺 MovieBox — Series' : '🎬 MovieBox — Film' })
            .setFooter({ text: 'MovieBox · Hanya kamu yang melihat ini' })
            .setTimestamp();

        if (cover) embed.setImage(cover);
        if (desc) embed.setDescription(desc.slice(0, 400));

        const fields = [];
        if (genre) fields.push({ name: '🎭 Genre', value: genre, inline: true });
        if (country) fields.push({ name: '🌍 Negara', value: country, inline: true });
        if (imdb) fields.push({ name: '⭐ IMDB', value: imdb, inline: true });
        if (isSeries) {
            const epInfo = seasons.map(s => `S${s.se}: ${s.maxEp} ep`).join(' · ');
            fields.push({ name: '📺 Episode', value: epInfo, inline: true });
        } else if (duration) {
            fields.push({ name: '⏱️ Durasi', value: duration, inline: true });
        }
        if (stars) fields.push({ name: '👥 Pemain', value: stars, inline: false });
        if (fields.length) embed.addFields(fields);

        async function streamEpisode(target, season, epNum) {
            const playerUrl = getMbPlayerUrl(subjectId, null, title, season, epNum);
            const epLine = isSeries && season != null ? `\n📺 Season ${season} · EPISODE ${epNum}` : '';
            const resEmbed = new EmbedBuilder()
                .setColor(COLORS.moviebox)
                .setTitle(`🔗 ${title.slice(0, 200)}`)
                .setDescription(`**[▶ Tonton di MovieBox](${playerUrl})**${epLine}\nDibuka di MovieBox Web Player.`)
                .setFooter({ text: 'MovieBox · Hanya kamu yang bisa lihat ini' });
            await target.editReply({ content: null, embeds: [resEmbed], components: [] });
            trackCommand({ platform: 'moviebox', user: target.user?.username || 'unknown', action: isSeries ? `S${season}E${epNum}` : 'Tonton', title, result: 'stream' });
        }

        // ── Movie flow ────────────────────────────────────────────────────────────
        if (!isSeries) {
            const watchRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('mbq_watch').setLabel('▶ Tonton Sekarang').setStyle(ButtonStyle.Success)
            );
            await interaction.editReply({ embeds: [embed], components: [watchRow] });
            const msg = await interaction.fetchReply();
            const qcol = msg.createMessageComponentCollector({ time: 120_000 });
            qcol.on('collect', async q => {
                try {
                    if (q.user.id !== userId) return q.reply({ content: '⛔ Bukan giliranmu.', flags: 64 });
                    await q.deferUpdate();
                    await streamEpisode(q, null, null);
                } catch (err) {
                    if (err.code === 10062 || err.code === 40060) return;
                    console.error('[mb/watch]', err.message);
                }
            });
            qcol.on('end', () => {});
            return;
        }

        // ── Series flow ───────────────────────────────────────────────────────────
        let currentSe = seasons[0].se;
        let epPage = 0;
        const PAGE_SIZE = 20;

        async function renderEpisodePicker(target) {
            const season = seasons.find(s => s.se === currentSe) || seasons[0];
            let maxEp = parseInt(season.maxEp) || 0;
            if (!maxEp && season.allEp) maxEp = season.allEp.split(',').filter(Boolean).length;
            if (!maxEp) maxEp = 1;

            const start = epPage * PAGE_SIZE + 1;
            const end = Math.min(start + PAGE_SIZE - 1, maxEp);

            const options = [];
            for (let ep = start; ep <= end; ep++) {
                options.push(new StringSelectMenuOptionBuilder().setLabel(`EPISODE ${ep}`).setValue(`${ep}`));
            }

            if (!options.length) {
                return target.editReply({ content: '❌ Data episode tidak tersedia untuk season ini.', embeds: [], components: [] });
            }

            const rows = [
                new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('mbep')
                        .setPlaceholder(`📺 S${currentSe} · Pilih episode (${start}–${end} dari ${maxEp})`)
                        .addOptions(options)
                )
            ];

            const navBtns = [];
            if (seasons.length > 1) {
                for (const s of seasons.slice(0, 4)) {
                    navBtns.push(new ButtonBuilder()
                        .setCustomId(`mbse_${s.se}`)
                        .setLabel(`S${s.se}`)
                        .setStyle(s.se === currentSe ? ButtonStyle.Primary : ButtonStyle.Secondary));
                }
            }
            if (epPage > 0) navBtns.push(new ButtonBuilder().setCustomId('mbprev').setLabel('◀').setStyle(ButtonStyle.Secondary));
            if (end < maxEp) navBtns.push(new ButtonBuilder().setCustomId('mbnext').setLabel('▶').setStyle(ButtonStyle.Secondary));
            if (navBtns.length) rows.push(new ActionRowBuilder().addComponents(navBtns));

            await target.editReply({ embeds: [embed], components: rows });
        }

        async function streamEpWithNext(target, season, epNum, maxEp) {
            await streamEpisode(target, season, epNum);
            if (epNum < maxEp) {
                await attachNextEpBtn(target, epNum + 1, userId, btn => streamEpWithNext(btn, season, epNum + 1, maxEp));
            }
        }

        await renderEpisodePicker(interaction);
        const msg = await interaction.fetchReply();
        const col = msg.createMessageComponentCollector({ time: 300_000 });

        col.on('collect', async btn => {
            try {
                if (btn.user.id !== userId) return btn.reply({ content: '⛔ Bukan giliranmu.', flags: 64 });
                await btn.deferUpdate();

                if (btn.customId.startsWith('mbse_')) {
                    currentSe = parseInt(btn.customId.replace('mbse_', ''));
                    epPage = 0;
                    await renderEpisodePicker(btn);
                } else if (btn.customId === 'mbprev') {
                    epPage = Math.max(0, epPage - 1);
                    await renderEpisodePicker(btn);
                } else if (btn.customId === 'mbnext') {
                    epPage++;
                    await renderEpisodePicker(btn);
                } else if (btn.isStringSelectMenu?.() || btn.customId === 'mbep') {
                    const epNum = parseInt(btn.values[0]);
                    const season = seasons.find(s => s.se === currentSe) || seasons[0];
                    let maxEp = parseInt(season.maxEp) || 0;
                    if (!maxEp && season.allEp) maxEp = season.allEp.split(',').filter(Boolean).length;
                    col.stop('epSelected');
                    await streamEpWithNext(btn, currentSe, epNum, maxEp);
                }
            } catch (err) {
                if (err.code === 10062 || err.code === 40060) return;
                console.error('[mb/series]', err.message);
            }
        });
        col.on('end', () => {});
    } catch (err) {
        console.error('[mb/detail]', err.message);
        interaction.editReply({ content: `❌ Gagal: ${err.message}` }).catch(() => {});
    }
}

// ─── NetShort ──────────────────────────────────────────────────────────────────

async function showNsDetail(interaction, shortPlayId, userId) {
    await interaction.deferReply({ flags: 64 });
    try {
        const raw = await nsApi.getAllEpisodes(shortPlayId);
        const detail = nsApi.parseAllEpisodes(raw);
        if (!detail || !detail.title) return interaction.editReply({ content: '❌ Detail tidak ditemukan.' });

        const episodes = detail.episodes.map((ep, i) => ({ ...ep, label: ep.label, _idx: i }));
        const title = detail.title;

        const embed = new EmbedBuilder()
            .setColor(COLORS.netshort)
            .setTitle(title.slice(0, 256))
            .setAuthor({ name: '📱 NetShort · Detail Drama' })
            .setFooter({ text: `Pilih episode · Hanya kamu yang melihat ini${detail.freeEpisodes ? ` · ${detail.freeEpisodes} ep gratis` : ''}` });
        if (detail.cover) embed.setImage(detail.cover);
        if (detail.desc) embed.setDescription(detail.desc.slice(0, 400));
        if (detail.totalEpisode) embed.addFields({ name: '📺 Total Episode', value: String(detail.totalEpisode), inline: true });
        if (detail.isFinish !== undefined) embed.addFields({ name: '📌 Status', value: detail.isFinish ? 'Tamat' : 'On-Going', inline: true });

        const cid = `nsdet_${shortPlayId}_${interaction.id}`;
        const rows = episodes.length > 0 ? buildEpisodeSelect(episodes, 0, `${cid}_sel`, `${cid}_nav`) : [];
        await interaction.editReply({ embeds: [embed], components: rows });
        if (episodes.length === 0) return;

        async function processNsEp(target, epIdx) {
            const ep = episodes[epIdx];
            if (!ep) return;
            const epNum = ep.episodeNo;
            const hasNext = epIdx + 1 < episodes.length;
            const mp4Url = ep.playVoucher;

            if (!mp4Url) return target.editReply({ content: '❌ URL video tidak tersedia.', components: [] });

            await target.editReply({ content: `⏳ Memeriksa EPISODE ${epNum}...`, components: [] });

            // HEAD check dulu — kalau sudah > 8MB, langsung beri link stream tanpa download
            const knownSize = await headCheckSize(mp4Url);
            const MAX_DISCORD = 8 * 1024 * 1024;
            if (knownSize !== null && knownSize > MAX_DISCORD) {
                await sendStreamLink(target, mp4Url, title, epNum, 'netshort');
                if (hasNext) await attachNextEpBtn(target, epIdx + 2, userId, btn => processNsEp(btn, epIdx + 1));
                return;
            }

            // Ukuran oke atau tidak diketahui — coba download langsung ke Discord
            let filePath = null;
            try {
                await target.editReply({ content: `⏳ Mengunduh EPISODE ${epNum}...`, components: [] });
                const res = await downloadNetShortEpisode(mp4Url);
                filePath = res.filePath;
                await sendVideoFile(target, filePath, res.sizeBytes, title, epNum, 'netshort', 'original');
                if (hasNext) await attachNextEpBtn(target, epIdx + 2, userId, btn => processNsEp(btn, epIdx + 1));
            } catch (err) {
                if (err.streamFallback && err.streamUrl) {
                    await sendStreamLink(target, err.streamUrl, title, epNum, 'netshort');
                    if (hasNext) await attachNextEpBtn(target, epIdx + 2, userId, btn => processNsEp(btn, epIdx + 1));
                    return;
                }
                await target.editReply({ content: `❌ Gagal: ${err.message}`, files: [], components: [] }).catch(() => {});
            } finally { if (filePath) cleanup(filePath); }
        }

        const msg = await interaction.fetchReply();
        let page = 0;
        const col = msg.createMessageComponentCollector({ time: 300_000 });
        col.on('collect', async c => {
            try {
                if (c.user.id !== userId) return c.reply({ content: '⛔ Hanya kamu yang bisa memilih.', flags: 64 });
                if (c.isStringSelectMenu()) {
                    const epIdx = parseInt(c.values[0]);
                    const ep = episodes[epIdx];
                    if (!ep) return;
                    if (ep.locked) return c.reply({ content: '🔒 Episode ini terkunci (berbayar).', flags: 64 });
                    await c.deferReply({ flags: 64 });
                    await processNsEp(c, epIdx);
                } else if (c.isButton()) {
                    if (c.customId.includes('_nav_next_')) { page++; await c.update({ embeds: [embed], components: buildEpisodeSelect(episodes, page, `${cid}_sel`, `${cid}_nav`) }); }
                    else if (c.customId.includes('_nav_prev_')) { page--; await c.update({ embeds: [embed], components: buildEpisodeSelect(episodes, page, `${cid}_sel`, `${cid}_nav`) }); }
                }
            } catch (err) {
                if (err.code === 10062 || err.code === 40060) return;
                console.error('[nsDetail collect]', err.message);
            }
        });
        col.on('end', () => {});
        trackCommand({ platform: 'netshort', user: interaction.user?.username || 'unknown', action: 'Detail', title, result: 'ok' });
    } catch (err) {
        console.error('[nsDetail]', err.message);
        interaction.editReply({ content: `❌ Gagal: ${err.message}` }).catch(() => {});
    }
}

// ─── Public list view ─────────────────────────────────────────────────────────

async function showList(interaction, items, listTitle, userId, useFollowUp = false) {
    if (items.length === 0) return;
    let idx = 0;
    const cid = `list_${interaction.id}_${useFollowUp ? 'fu' : 'ed'}`;
    const payload = { embeds: [buildListEmbed(items[0], 0, items.length, listTitle)], components: [buildNavRow(cid, 0, items.length, items[0])] };

    let msg;
    if (useFollowUp) {
        msg = await interaction.followUp({ ...payload, flags: 64 });
    } else {
        await interaction.editReply(payload);
        msg = await interaction.fetchReply();
    }

    const col = msg.createMessageComponentCollector({ time: 180_000 });
    col.on('collect', async btn => {
        try {
            if (btn.user.id !== userId) return btn.reply({ content: '⛔ Hanya pengguna yang menjalankan perintah ini yang bisa navigasi.', flags: 64 });

            if (btn.customId.includes('_det_')) {
                const parts = btn.customId.split('_det_')[1].split('_');
                const platform = parts[0];
                const key = parts.slice(1).join('_');
                if (platform === 'freereels') return showFrDetail(btn, key, userId);
                if (platform === 'reelshort') return showRsDetail(btn, key, userId);
                if (platform === 'melolo') return showMlDetail(btn, key, userId);
                if (platform === 'moviebox') return showMbDetail(btn, key, userId);
                if (platform === 'netshort') return showNsDetail(btn, key, userId);
                return;
            }

            if (btn.customId.includes('_next_')) idx = Math.min(idx + 1, items.length - 1);
            else if (btn.customId.includes('_prev_')) idx = Math.max(idx - 1, 0);

            await btn.update({ embeds: [buildListEmbed(items[idx], idx, items.length, listTitle)], components: [buildNavRow(cid, idx, items.length, items[idx])] });
        } catch (err) {
            if (err.code === 10062 || err.code === 40060) return;
            console.error('[listCollect]', err.message);
        }
    });
    col.on('end', () => {});
}

// ─── Command ──────────────────────────────────────────────────────────────────

module.exports = {
    data: [
        new SlashCommandBuilder()
            .setName('drama')
            .setDescription('Cari dan tonton drama + film dari FreeReels, ReelShort, Melolo, MovieBox & NetShort')
            .addSubcommand(sub =>
                sub.setName('cari')
                    .setDescription('Cari drama/film di semua platform sekaligus')
                    .addStringOption(opt =>
                        opt.setName('judul').setDescription('Judul atau kata kunci').setRequired(true)))
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
            .addSubcommand(sub =>
                sub.setName('melolo')
                    .setDescription('Browse drama For You dari Melolo'))
            .addSubcommand(sub =>
                sub.setName('moviebox')
                    .setDescription('Browse film & series trending dari MovieBox')
                    .addIntegerOption(opt =>
                        opt.setName('page').setDescription('Halaman (default: 0)').setMinValue(0)))
            .addSubcommand(sub =>
                sub.setName('netshort')
                    .setDescription('Browse drama For You dari NetShort'))
    ],

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const userId = interaction.user.id;

        await interaction.deferReply();

        try {
            if (sub === 'cari') {
                const judul = interaction.options.getString('judul');
                await interaction.editReply({ content: `🔍 Mencari **${judul}** di semua platform...` });

                // Dracin = ReelShort + Melolo + NetShort + FreeReels
                // Movie  = MovieBox
                const dracin = [];
                const movie  = [];
                const seen   = new Set();

                const [rsRes, mlRes, nsRes, mbRes, frRes] = await Promise.allSettled([
                    rsApi.search(judul, 1).catch(() => null),
                    mlApi.search(judul).catch(() => null),
                    nsApi.search(judul).catch(() => null),
                    mbApi.search(judul).catch(() => null),
                    // FreeReels search API tidak mengembalikan item — filter dari foryou+homepage
                    (async () => {
                        const kw = judul.toLowerCase();
                        const qWords = kw.split(/\s+/).filter(w => w.length > 2);
                        const [homeData, fyData] = await Promise.all([
                            frApi.getHomepage().catch(() => null),
                            frApi.getForyou(0).catch(() => null),
                        ]);
                        return [...frExtract(homeData), ...frExtract(fyData)]
                            .filter(i => {
                                const t = i.title.toLowerCase();
                                return t.includes(kw) || qWords.some(w => t.includes(w));
                            });
                    })().catch(() => []),
                ]);

                if (rsRes.status === 'fulfilled' && rsRes.value) {
                    for (const item of rsExtract(rsRes.value)) {
                        const k = `rs_${item.key}`;
                        if (!seen.has(k)) { seen.add(k); dracin.push(item); }
                    }
                }
                if (mlRes.status === 'fulfilled' && mlRes.value) {
                    for (const item of mlApi.parseSearchItems(mlRes.value)) {
                        const k = `ml_${item.key}`;
                        if (!seen.has(k)) { seen.add(k); dracin.push(item); }
                    }
                }
                if (nsRes.status === 'fulfilled' && nsRes.value) {
                    for (const item of nsApi.parseSearchItems(nsRes.value)) {
                        const k = `ns_${item.key}`;
                        if (!seen.has(k)) { seen.add(k); dracin.push(item); }
                    }
                }
                if (frRes.status === 'fulfilled' && Array.isArray(frRes.value)) {
                    for (const item of frRes.value) {
                        const k = `fr_${item.key}`;
                        if (!seen.has(k)) { seen.add(k); dracin.push(item); }
                    }
                }
                if (mbRes.status === 'fulfilled' && mbRes.value) {
                    for (const item of mbExtract(mbRes.value)) {
                        const k = `mb_${item.key}`;
                        if (!seen.has(k)) { seen.add(k); movie.push(item); }
                    }
                }

                // Relevansi berdasarkan overlap kata — berlaku untuk SEMUA platform
                function relevanceScore(title, query) {
                    const t = title.toLowerCase();
                    const q = query.toLowerCase();
                    if (t === q) return 100;
                    if (t.startsWith(q)) return 90;
                    if (t.includes(q)) return 80;
                    const qWords = q.split(/\s+/).filter(w => w.length > 1);
                    if (!qWords.length) return 0;
                    const matched = qWords.filter(w => t.includes(w)).length;
                    return Math.round((matched / qWords.length) * 70);
                }
                function sortByRelevance(items) {
                    return items
                        .map(i => ({ ...i, _score: relevanceScore(i.title, judul) }))
                        .sort((a, b) => b._score - a._score);
                }

                const sortedDracin = sortByRelevance(dracin);
                const sortedMovie  = sortByRelevance(movie);
                const total = sortedDracin.length + sortedMovie.length;

                if (total === 0) {
                    return interaction.editReply({ content: `❌ Tidak ada hasil untuk **${judul}**.` });
                }

                // Kalau hanya satu rak yang ada hasil, langsung tampilkan tanpa tombol
                if (sortedDracin.length === 0)
                    return showList(interaction, sortedMovie, `🎬 Movie & Drama Serial · "${judul}"`, userId);
                if (sortedMovie.length === 0)
                    return showList(interaction, sortedDracin, `🀄 Dracin · "${judul}"`, userId);

                // Dua rak ada hasil — tampilkan tombol pilihan
                const catId = `cat_${interaction.id}_${Date.now()}`;
                const catRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`${catId}_dracin`).setLabel(`🀄 Dracin (${sortedDracin.length})`).setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId(`${catId}_movie`).setLabel(`🎬 Movie & Drama Serial (${sortedMovie.length})`).setStyle(ButtonStyle.Secondary)
                );
                await interaction.editReply({
                    content: `✅ Ditemukan **${total} hasil** untuk **"${judul}"** — pilih rak:`,
                    components: [catRow]
                });
                const catMsg = await interaction.fetchReply();
                const catCol = catMsg.createMessageComponentCollector({ time: 120_000 });
                catCol.on('collect', async btn => {
                    try {
                        if (btn.user.id !== userId) return btn.reply({ content: '⛔ Bukan giliran kamu.', flags: 64 });
                        await btn.deferUpdate();
                        if (btn.customId.endsWith('_dracin'))
                            await showList(interaction, sortedDracin, `🀄 Dracin · "${judul}"`, userId);
                        else if (btn.customId.endsWith('_movie'))
                            await showList(interaction, sortedMovie, `🎬 Movie & Drama Serial · "${judul}"`, userId);
                    } catch (err) {
                        if (err.code === 10062 || err.code === 40060) return;
                        console.error('[cari/cat]', err.message);
                    }
                });
                catCol.on('end', (_, reason) => {
                    if (reason === 'time') interaction.editReply({ components: [] }).catch(() => {});
                });
                return;
            }

            if (sub === 'foryou') {
                const offset = interaction.options.getInteger('offset') || 0;
                await interaction.editReply({ content: '⏳ Memuat drama FreeReels...' });
                const data = await frApi.getForyou(offset);
                const items = frExtract(data);
                if (items.length === 0) return interaction.editReply({ content: '❌ Tidak ada drama ditemukan.' });
                return showList(interaction, items, `🎭 FreeReels · For You (offset ${offset})`, userId);
            }

            if (sub === 'reelshort') {
                const offset = interaction.options.getInteger('offset') || 0;
                await interaction.editReply({ content: '⏳ Memuat drama ReelShort...' });
                const data = await rsApi.getForyou(offset);
                const items = rsExtract(data);
                if (items.length === 0) return interaction.editReply({ content: '❌ Tidak ada drama ditemukan.' });
                return showList(interaction, items, `🎬 ReelShort · For You (offset ${offset})`, userId);
            }

            if (sub === 'melolo') {
                await interaction.editReply({ content: '⏳ Memuat drama Melolo...' });
                const data = await mlApi.getForYou();
                const items = mlApi.parseForYouItems(data);
                if (items.length === 0) return interaction.editReply({ content: '❌ Tidak ada drama ditemukan.' });
                return showList(interaction, items, '🎥 Melolo · For You', userId);
            }

            if (sub === 'moviebox') {
                const page = interaction.options.getInteger('page') || 0;
                await interaction.editReply({ content: '⏳ Memuat film & series MovieBox...' });
                const data = await mbApi.getTrending(page);
                const items = mbExtract(data);
                if (items.length === 0) return interaction.editReply({ content: '❌ Tidak ada konten ditemukan.' });
                return showList(interaction, items, `🎬 MovieBox · Trending (halaman ${page})`, userId);
            }

            if (sub === 'netshort') {
                await interaction.editReply({ content: '⏳ Memuat drama NetShort...' });
                const data = await nsApi.getForYou();
                const items = nsApi.parseForYouItems(data);
                if (items.length === 0) return interaction.editReply({ content: '❌ Tidak ada drama ditemukan.' });
                return showList(interaction, items, '📱 NetShort · For You', userId);
            }
        } catch (err) {
            console.error('[interactionCreate] drama:', err.message);
            if (err.code === 10062 || err.code === 40060) return;
            interaction.editReply({ content: `❌ Error: ${err.message}` }).catch(() => {});
        }
    }
};
