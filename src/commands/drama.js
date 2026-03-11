const {
    SlashCommandBuilder, EmbedBuilder, ActionRowBuilder,
    ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder, AttachmentBuilder
} = require('discord.js');

const frApi = require('../api/freereels');
const rsApi = require('../api/reelshort');
const mlApi = require('../api/melolo');
const { downloadFreeReelsEpisode, downloadReelShortEpisode, downloadMeloloEpisode, cleanup } = require('../video');
const { getPlayerUrl, getDirectPlayerUrl, getMeloloPlayerUrl, getMbPlayerUrl } = require('../webserver');
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

const COLORS = { freereels: 0x5865F2, reelshort: 0xEB459E, melolo: 0xFF6B35, moviebox: 0xFFC107 };
const LABELS = { freereels: '🎭 FreeReels', reelshort: '🎬 ReelShort', melolo: '🎥 Melolo', moviebox: '🎬 MovieBox' };

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
            .setLabel((ep.label || `Episode ${start + i + 1}`).slice(0, 100))
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
    // c is already deferred (deferReply flags:64). Show quality buttons.
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
            console.error('[qualityCollect]', err.message);
            await c.editReply({ content: `❌ Terjadi kesalahan: ${err.message}`, components: [] }).catch(() => {});
        }
    });
    qCol.on('end', (col, reason) => {
        if (reason === 'time' && col.size === 0) {
            c.editReply({ content: '⏱️ Waktu habis. Pilih episode lagi.', components: [] }).catch(() => {});
        }
    });
}

// ─── Stream link sender ───────────────────────────────────────────────────────

async function sendStreamLink(q, streamUrl, title, epNum, platform) {
    let playerUrl;
    if (platform === 'freereels') playerUrl = getPlayerUrl(streamUrl, title, epNum);
    else if (platform === 'reelshort') playerUrl = getDirectPlayerUrl(streamUrl, title, epNum);
    else playerUrl = getMeloloPlayerUrl(streamUrl, title, epNum);

    const embed = new EmbedBuilder()
        .setColor(0xFEA800)
        .setTitle(`🔗 Episode ${epNum} — ${title.slice(0, 200)}`)
        .setDescription(`File terlalu besar atau kualitas terlalu tinggi untuk Discord.\n\n**[▶ Klik untuk tonton di browser](${playerUrl})**\n\nLink streaming kualitas penuh tanpa kompresi.`)
        .setFooter({ text: `${LABELS[platform] || platform} · Streaming · Hanya kamu yang bisa melihat ini` });
    await q.editReply({ content: null, embeds: [embed] });
    trackCommand({ platform, user: q.user?.username || 'unknown', action: `Ep ${epNum}`, title, result: 'stream' });
}

// ─── Video file sender ────────────────────────────────────────────────────────

async function sendVideoFile(q, filePath, sizeBytes, title, epNum, platform, quality) {
    const sizeMB = (sizeBytes / 1024 / 1024).toFixed(1);
    const attachment = new AttachmentBuilder(filePath, {
        name: `${platform}_ep${epNum}_${title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 25)}.mp4`
    });
    const embed = new EmbedBuilder()
        .setColor(COLORS[platform] || 0x99AAB5)
        .setTitle(`🎬 Episode ${epNum} — ${title.slice(0, 200)}`)
        .setDescription(`Kualitas: **${quality}** · Langsung putar di Discord ↓`)
        .setFooter({ text: `${LABELS[platform]} · ${sizeMB} MB · Hanya kamu yang melihat ini` });
    await q.editReply({ content: null, embeds: [embed], files: [attachment] });
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
        const episodes = rawEps.map((ep, i) => ({ ...ep, label: `Episode ${i + 1}`, locked: false, _idx: i }));

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

        const msg = await interaction.fetchReply();
        let page = 0;
        const col = msg.createMessageComponentCollector({ time: 300_000 });
        col.on('collect', async c => {
            try {
                if (c.user.id !== userId) return c.reply({ content: '⛔ Hanya kamu yang bisa memilih.', flags: 64 });
                if (c.isStringSelectMenu()) {
                    const ep = episodes[parseInt(c.values[0])];
                    if (!ep) return;
                    if (ep.locked) return c.reply({ content: '🔒 Episode ini terkunci.', flags: 64 });

                    const rawEp = rawEps[ep._idx];
                    const videoUrl = rawEp.external_audio_h264_m3u8 || rawEp.external_audio_h265_m3u8 || rawEp.m3u8_url;
                    const idSub = (rawEp.subtitle_list || []).find(s => s.language === 'id-ID');
                    const subUrl = idSub?.subtitle || null;
                    const epLabel = `${ep.label} — ${info.name || info.title || ''}`;
                    const epNum = ep._idx + 1;
                    const title = info.name || info.title || 'Drama';

                    if (!videoUrl) return c.reply({ content: '❌ Link video tidak tersedia.', flags: 64 });
                    await c.deferReply({ flags: 64 });

                    await showQualityPicker(c, userId, epLabel, async (q, quality) => {
                        if (quality === 'stream') {
                            return sendStreamLink(q, videoUrl, title, epNum, 'freereels');
                        }
                        await q.editReply({ content: `⏳ Mengunduh Episode ${epNum} (${quality})... 20–90 detik` });
                        let filePath = null;
                        try {
                            const res = await downloadFreeReelsEpisode(videoUrl, subUrl, rawEp.duration || null, quality);
                            filePath = res.filePath;
                            await sendVideoFile(q, filePath, res.sizeBytes, title, epNum, 'freereels', quality);
                        } catch (err) {
                            if (err.streamFallback && err.streamUrl) return sendStreamLink(q, err.streamUrl, title, epNum, 'freereels');
                            await q.editReply({ content: `❌ Gagal: ${err.message}`, files: [] }).catch(() => {});
                        } finally { if (filePath) cleanup(filePath); }
                    });
                } else if (c.isButton()) {
                    if (c.customId.includes('_nav_next_')) { page++; await c.update({ embeds: [embed], components: buildEpisodeSelect(episodes, page, `${cid}_sel`, `${cid}_nav`) }); }
                    else if (c.customId.includes('_nav_prev_')) { page--; await c.update({ embeds: [embed], components: buildEpisodeSelect(episodes, page, `${cid}_sel`, `${cid}_nav`) }); }
                }
            } catch (err) {
                console.error('[frDetail collect]', err.message);
            }
        });
        col.on('end', () => interaction.editReply({ components: [] }).catch(() => {}));
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
        const episodes = rawChapters.map((ch, i) => ({ ...ch, label: ch.title || `Episode ${ch.serialNumber}`, locked: !!ch.isLocked, _idx: i }));
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

        const msg = await interaction.fetchReply();
        let page = 0;
        const col = msg.createMessageComponentCollector({ time: 300_000 });
        col.on('collect', async c => {
            try {
                if (c.user.id !== userId) return c.reply({ content: '⛔ Hanya kamu yang bisa memilih.', flags: 64 });
                if (c.isStringSelectMenu()) {
                    const ep = episodes[parseInt(c.values[0])];
                    if (!ep) return;
                    if (ep.locked) return c.reply({ content: '🔒 Episode ini terkunci.', flags: 64 });

                    const chapter = rawChapters[ep._idx];
                    const epNum = chapter.serialNumber;
                    const epLabel = `${ep.label} — ${title}`;
                    await c.deferReply({ flags: 64 });

                    await showQualityPicker(c, userId, epLabel, async (q, quality) => {
                        if (quality === 'stream') {
                            // Need video URL first for stream link
                            await q.editReply({ content: '⏳ Mengambil link streaming...' });
                            try {
                                const rawVid = await rsApi.getEpisodeVideo(bookId, epNum);
                                const vd = rawVid?.videoList ? rawVid : (rawVid?.data || rawVid);
                                const vl = vd.videoList || [];
                                const best = vl.sort((a, b) => b.quality - a.quality)[0];
                                if (!best) return q.editReply({ content: '❌ Link video tidak tersedia.' });
                                return sendStreamLink(q, best.url, title, epNum, 'reelshort');
                            } catch (err) { return q.editReply({ content: `❌ Gagal: ${err.message}` }); }
                        }

                        await q.editReply({ content: `⏳ Mengunduh Episode ${epNum} (${quality})... 10–60 detik` });
                        let filePath = null;
                        try {
                            const rawVid = await rsApi.getEpisodeVideo(bookId, epNum);
                            const vd = rawVid?.videoList ? rawVid : (rawVid?.data || rawVid);
                            if (vd.isLocked) return q.editReply({ content: '🔒 Episode ini terkunci.' });

                            const vl = vd.videoList || [];
                            // Pick quality stream: 360p wants lowest, 720p wants highest
                            const h264 = vl.filter(v => v.encode === 'H264').sort((a, b) => a.quality - b.quality);
                            const all = vl.sort((a, b) => a.quality - b.quality);
                            let chosen;
                            if (quality === '720p') {
                                const sorted = (h264.length ? h264 : all);
                                chosen = sorted[sorted.length - 1]; // highest quality
                            } else {
                                chosen = (h264.length ? h264 : all)[0]; // lowest (360p)
                            }
                            if (!chosen) return q.editReply({ content: '❌ Link video tidak tersedia.' });

                            const res = await downloadReelShortEpisode(chosen.url, quality);
                            filePath = res.filePath;
                            await sendVideoFile(q, filePath, res.sizeBytes, title, epNum, 'reelshort', quality);
                        } catch (err) {
                            if (err.streamFallback && err.streamUrl) return sendStreamLink(q, err.streamUrl, title, epNum, 'reelshort');
                            await q.editReply({ content: `❌ Gagal: ${err.message}`, files: [] }).catch(() => {});
                        } finally { if (filePath) cleanup(filePath); }
                    });
                } else if (c.isButton()) {
                    if (c.customId.includes('_nav_next_')) { page++; await c.update({ embeds: [embed], components: buildEpisodeSelect(episodes, page, `${cid}_sel`, `${cid}_nav`) }); }
                    else if (c.customId.includes('_nav_prev_')) { page--; await c.update({ embeds: [embed], components: buildEpisodeSelect(episodes, page, `${cid}_sel`, `${cid}_nav`) }); }
                }
            } catch (err) {
                console.error('[rsDetail collect]', err.message);
            }
        });
        col.on('end', () => interaction.editReply({ components: [] }).catch(() => {}));
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

        const episodes = detail.episodes.map((ep, i) => ({ ...ep, label: ep.title || `Episode ${ep.index}`, locked: ep.locked, _idx: i }));
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

        const msg = await interaction.fetchReply();
        let page = 0;
        const col = msg.createMessageComponentCollector({ time: 300_000 });
        col.on('collect', async c => {
            try {
                if (c.user.id !== userId) return c.reply({ content: '⛔ Hanya kamu yang bisa memilih.', flags: 64 });
                if (c.isStringSelectMenu()) {
                    const ep = episodes[parseInt(c.values[0])];
                    if (!ep) return;
                    if (ep.locked) return c.reply({ content: '🔒 Episode ini terkunci.', flags: 64 });

                    const rawEp = detail.episodes[ep._idx];
                    const epLabel = `${ep.label} — ${title}`;
                    const epNum = rawEp.index;
                    await c.deferReply({ flags: 64 });

                    await showQualityPicker(c, userId, epLabel, async (q, quality) => {
                        await q.editReply({ content: '⏳ Mengambil link video...' });
                        let filePath = null;
                        try {
                            const streamRaw = await mlApi.getStream(rawEp.vid);
                            const { qualities, topUrl, duration } = mlApi.parseVideoQualities(streamRaw.data || streamRaw);
                            const dur = rawEp.duration || duration;

                            if (quality === 'stream') {
                                const streamUrl = topUrl || (qualities[qualities.length - 1]?.url || '');
                                if (!streamUrl) return q.editReply({ content: '❌ URL streaming tidak tersedia.' });
                                return sendStreamLink(q, streamUrl, title, epNum, 'melolo');
                            }

                            // Pick appropriate quality video
                            let chosen;
                            if (quality === '720p') {
                                chosen = qualities.find(v => v.definition === '720p' || v.height >= 720) || qualities[qualities.length - 1];
                            } else {
                                chosen = qualities.find(v => v.definition === '360p' || v.definition === '240p' || v.height <= 480) || qualities[0];
                            }
                            if (!chosen) return q.editReply({ content: '❌ URL video tidak tersedia.' });

                            await q.editReply({ content: `⏳ Mengunduh Episode ${epNum} (${quality})... 20–90 detik` });
                            const res = await downloadMeloloEpisode(chosen.url, dur, quality);
                            filePath = res.filePath;
                            await sendVideoFile(q, filePath, res.sizeBytes, title, epNum, 'melolo', quality);
                        } catch (err) {
                            if (err.streamFallback && err.streamUrl) return sendStreamLink(q, err.streamUrl, title, epNum, 'melolo');
                            await q.editReply({ content: `❌ Gagal: ${err.message}`, files: [] }).catch(() => {});
                        } finally { if (filePath) cleanup(filePath); }
                    });
                } else if (c.isButton()) {
                    if (c.customId.includes('_nav_next_')) { page++; await c.update({ embeds: [embed], components: buildEpisodeSelect(episodes, page, `${cid}_sel`, `${cid}_nav`) }); }
                    else if (c.customId.includes('_nav_prev_')) { page--; await c.update({ embeds: [embed], components: buildEpisodeSelect(episodes, page, `${cid}_sel`, `${cid}_nav`) }); }
                }
            } catch (err) {
                console.error('[mlDetail collect]', err.message);
            }
        });
        col.on('end', () => interaction.editReply({ components: [] }).catch(() => {}));
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

        // ── Helpers ──────────────────────────────────────────────────────────────
        function buildQualityRow() {
            return new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('mbq_360').setLabel('📱 360p').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('mbq_480').setLabel('📺 480p').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('mbq_1080').setLabel('🖥️ 1080p').setStyle(ButtonStyle.Success),
            );
        }

        async function streamEpisode(q, season, epNum) {
            const targetQ = parseInt(q.customId.replace('mbq_', ''));
            const playerUrl = getMbPlayerUrl(subjectId, targetQ, title, season, epNum);
            const epLine = isSeries && season != null ? `\n📺 Season ${season} · Episode ${epNum}` : '';
            const resEmbed = new EmbedBuilder()
                .setColor(COLORS.moviebox)
                .setTitle(`🔗 ${title.slice(0, 200)}`)
                .setDescription(`**[▶ Tonton di browser](${playerUrl})**${epLine}\nKualitas: **${targetQ}p** · Streaming langsung di browser.`)
                .setFooter({ text: 'MovieBox · Streaming · Hanya kamu yang bisa lihat ini' });
            await q.editReply({ content: null, embeds: [resEmbed], components: [] });
            trackCommand({ platform: 'moviebox', user: q.user?.username || 'unknown', action: isSeries ? `S${season}E${epNum} ${targetQ}p` : `Tonton ${targetQ}p`, title, result: 'stream' });
        }

        // ── Movie flow ────────────────────────────────────────────────────────────
        if (!isSeries) {
            await interaction.editReply({ embeds: [embed], components: [buildQualityRow()] });
            const msg = await interaction.fetchReply();
            const qcol = msg.createMessageComponentCollector({ time: 120_000 });
            qcol.on('collect', async q => {
                try {
                    if (q.user.id !== userId) return q.reply({ content: '⛔ Bukan giliranmu.', flags: 64 });
                    await q.deferUpdate();
                    await streamEpisode(q, null, null);
                } catch (err) {
                    console.error('[mb/quality]', err.message);
                    await q.editReply({ content: `❌ Gagal: ${err.message}`, embeds: [], components: [] }).catch(() => {});
                }
            });
            qcol.on('end', () => interaction.editReply({ components: [] }).catch(() => {}));
            return;
        }

        // ── Series flow: season → episode → quality ───────────────────────────────
        let currentSe = seasons[0].se;
        let epPage = 0;
        const PAGE_SIZE = 20;

        async function renderEpisodePicker(target) {
            const season = seasons.find(s => s.se === currentSe) || seasons[0];
            // fallback: pakai allEp (comma-separated) kalau maxEp kosong
            let maxEp = parseInt(season.maxEp) || 0;
            if (!maxEp && season.allEp) maxEp = season.allEp.split(',').filter(Boolean).length;
            if (!maxEp) maxEp = 1; // minimal 1 episode supaya tidak crash

            const start = epPage * PAGE_SIZE + 1;
            const end = Math.min(start + PAGE_SIZE - 1, maxEp);

            const options = [];
            for (let ep = start; ep <= end; ep++) {
                options.push(new StringSelectMenuOptionBuilder().setLabel(`Episode ${ep}`).setValue(`${ep}`));
            }

            // Discord tidak boleh dropdown kosong
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
                } else if (btn.customId === 'mbep') {
                    const epNum = parseInt(btn.values[0]);
                    col.stop('epSelected');
                    await btn.editReply({
                        content: `📺 **${title}** · Season ${currentSe} · Episode ${epNum} — pilih kualitas:`,
                        embeds: [], components: [buildQualityRow()]
                    });
                    const qMsg = await interaction.fetchReply();
                    const qcol = qMsg.createMessageComponentCollector({ time: 60_000, max: 1 });
                    qcol.on('collect', async q => {
                        try {
                            if (q.user.id !== userId) return q.reply({ content: '⛔ Bukan giliranmu.', flags: 64 });
                            await q.deferUpdate();
                            await streamEpisode(q, currentSe, epNum);
                        } catch (err) {
                            console.error('[mb/quality]', err.message);
                            await q.editReply({ content: `❌ Gagal: ${err.message}`, embeds: [], components: [] }).catch(() => {});
                        }
                    });
                    qcol.on('end', () => interaction.editReply({ components: [] }).catch(() => {}));
                }
            } catch (err) {
                console.error('[mb/series]', err.message);
            }
        });
        col.on('end', (_, reason) => {
            if (reason !== 'epSelected') interaction.editReply({ components: [] }).catch(() => {});
        });
    } catch (err) {
        console.error('[mb/detail]', err.message);
        interaction.editReply({ content: `❌ Gagal: ${err.message}` }).catch(() => {});
    }
}

// ─── Public list view ─────────────────────────────────────────────────────────

async function showList(interaction, items, listTitle, userId) {
    if (items.length === 0) return interaction.editReply({ content: '❌ Tidak ada drama ditemukan.' });
    let idx = 0;
    const cid = `list_${interaction.id}`;

    const msg = await interaction.editReply({ embeds: [buildListEmbed(items[0], 0, items.length, listTitle)], components: [buildNavRow(cid, 0, items.length, items[0])] });

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
                return;
            }

            if (btn.customId.includes('_next_')) idx = Math.min(idx + 1, items.length - 1);
            else if (btn.customId.includes('_prev_')) idx = Math.max(idx - 1, 0);

            await btn.update({ embeds: [buildListEmbed(items[idx], idx, items.length, listTitle)], components: [buildNavRow(cid, idx, items.length, items[idx])] });
        } catch (err) {
            console.error('[listCollect]', err.message);
        }
    });
    col.on('end', () => interaction.editReply({ components: [] }).catch(() => {}));
}

// ─── Command ──────────────────────────────────────────────────────────────────

module.exports = {
    data: [
        new SlashCommandBuilder()
            .setName('drama')
            .setDescription('Cari dan tonton drama + film dari FreeReels, ReelShort, Melolo & MovieBox')
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
    ],

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const userId = interaction.user.id;

        await interaction.deferReply();

        try {
            if (sub === 'cari') {
                const judul = interaction.options.getString('judul');
                await interaction.editReply({ content: `OK <@${userId}>, aku cari **${judul}**...` });

                const allItems = [];
                const seen = new Set();

                // ReelShort — real search API
                try {
                    const rsData = await rsApi.search(judul, 1);
                    for (const item of rsExtract(rsData)) {
                        if (!seen.has(item.key)) { seen.add(item.key); allItems.push(item); }
                    }
                } catch (e) { console.warn('[drama/cari] RS:', e.message); }

                // Melolo — real search API
                try {
                    const mlData = await mlApi.search(judul);
                    for (const item of mlApi.parseSearchItems(mlData)) {
                        if (!seen.has(item.key)) { seen.add(item.key); allItems.push(item); }
                    }
                } catch (e) { console.warn('[drama/cari] ML:', e.message); }

                // MovieBox — real search API
                try {
                    const mbData = await mbApi.search(judul);
                    for (const item of mbExtract(mbData)) {
                        if (!seen.has(item.key)) { seen.add(item.key); allItems.push(item); }
                    }
                } catch (e) { console.warn('[drama/cari] MB:', e.message); }

                // FreeReels — filter from browse results
                try {
                    const [homeData, animeData] = await Promise.all([
                        frApi.getHomepage().catch(() => null),
                        frApi.getAnimePage().catch(() => null)
                    ]);
                    for (const d of [homeData, animeData]) {
                        for (const i of frExtract(d)) {
                            if (!seen.has(i.key)) { seen.add(i.key); allItems.push(i); }
                        }
                    }
                    for (const offset of [0, 20, 40, 60, 80, 100, 120, 140, 160]) {
                        try {
                            const d = await frApi.getForYou(offset);
                            const items = frExtract(d);
                            if (!items.length) break;
                            for (const i of items) { if (!seen.has(i.key)) { seen.add(i.key); allItems.push(i); } }
                        } catch { break; }
                    }
                } catch (e) { console.warn('[drama/cari] FR:', e.message); }

                const kw = judul.toLowerCase();
                // RS, Melolo, MovieBox results are search-matched; FR needs keyword filter
                const matched = allItems.filter(i => {
                    if (i._source === 'reelshort' || i._source === 'melolo' || i._source === 'moviebox') return true;
                    const t = [i.title, i.desc, ...(Array.isArray(i.tags) ? i.tags.map(t => typeof t === 'string' ? t : t?.name || '') : [])].filter(Boolean).join(' ').toLowerCase();
                    return t.includes(kw);
                });

                if (matched.length === 0) {
                    return interaction.editReply({ content: `❌ Tidak ketemu **"${judul}"**, coba kata kunci lain.` });
                }

                // Sort by title relevance: exact > starts with > contains > other
                function titleScore(item) {
                    const t = item.title.toLowerCase();
                    if (t === kw) return 3;
                    if (t.startsWith(kw)) return 2;
                    if (t.includes(kw)) return 1;
                    return 0;
                }
                matched.sort((a, b) => titleScore(b) - titleScore(a));

                await interaction.editReply({ content: `OK <@${userId}>, ketemu **${matched.length} drama** untuk **${judul}** ↓` });
                await showList(interaction, matched, `Cari: "${judul}"`, userId);
                trackCommand({ user: interaction.user.username, action: 'cari', title: judul, result: 'ok' });

            } else if (sub === 'foryou') {
                const offset = interaction.options.getInteger('offset') || 0;
                const data = await frApi.getForYou(offset);
                const items = frExtract(data);
                if (!items.length) return interaction.editReply({ content: '❌ Tidak ada data.' });
                await showList(interaction, items, `FreeReels · For You (offset ${offset})`, userId);
                trackCommand({ platform: 'freereels', user: interaction.user.username, action: 'foryou', result: 'ok' });

            } else if (sub === 'reelshort') {
                const offset = interaction.options.getInteger('offset') || 0;
                const data = await rsApi.getForYou(offset);
                const items = rsExtract(data);
                if (!items.length) return interaction.editReply({ content: '❌ Tidak ada data.' });
                await showList(interaction, items, `ReelShort · For You (offset ${offset})`, userId);
                trackCommand({ platform: 'reelshort', user: interaction.user.username, action: 'foryou', result: 'ok' });

            } else if (sub === 'melolo') {
                const data = await mlApi.getForYou();
                const items = mlApi.parseForYouItems(data);
                if (!items.length) return interaction.editReply({ content: '❌ Tidak ada data dari Melolo.' });
                await showList(interaction, items, 'Melolo · For You', userId);
                trackCommand({ platform: 'melolo', user: interaction.user.username, action: 'foryou', result: 'ok' });

            } else if (sub === 'moviebox') {
                const page = interaction.options.getInteger('page') || 0;
                const data = await mbApi.getTrending(page);
                const items = mbExtract(data);
                if (!items.length) return interaction.editReply({ content: '❌ Tidak ada data dari MovieBox.' });
                await showList(interaction, items, `MovieBox · Trending (hal. ${page})`, userId);
                trackCommand({ platform: 'moviebox', user: interaction.user.username, action: 'trending', result: 'ok' });
            }
        } catch (err) {
            console.error('[drama]', err.message);
            trackCommand({ user: interaction.user?.username || 'unknown', action: sub || 'unknown', result: 'error' });
            await interaction.editReply({ content: `❌ Terjadi kesalahan: **${err.message}**` }).catch(() => {});
        }
    }
};
