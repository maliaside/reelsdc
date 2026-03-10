const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder
} = require('discord.js');
const api = require('../api/freereels');
const { getPlayerUrl } = require('../webserver');

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
    if (Array.isArray(tags) && tags.length > 0) {
        embed.addFields({ name: '🏷️ Tag', value: tags.join(', '), inline: true });
    }
    if (item.episode_count) {
        embed.addFields({ name: '📺 Episode', value: String(item.episode_count), inline: true });
    }
    if (item.view_count) {
        embed.addFields({ name: '👁️ Ditonton', value: Number(item.view_count).toLocaleString('id-ID'), inline: true });
    }
    return embed;
}

function buildDetailEmbed(info) {
    const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle((info.name || info.title || 'Unknown').slice(0, 256))
        .setAuthor({ name: '📋 Detail Drama' })
        .setFooter({ text: 'Pilih episode dari dropdown untuk menonton' });

    if (info.cover) embed.setImage(info.cover);
    if (info.desc) {
        embed.setDescription(info.desc.length > 400 ? info.desc.slice(0, 397) + '...' : info.desc);
    }
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
                .setDescription('Klik untuk mendapatkan link tonton')
                .setValue(`${start + i}`)
        );
    }
    const rows = [new ActionRowBuilder().addComponents(select)];

    const navBtns = [];
    if (page > 0) {
        navBtns.push(
            new ButtonBuilder()
                .setCustomId(`${customId}_epprev_${page}`)
                .setLabel('◀ Episode Sebelumnya')
                .setStyle(ButtonStyle.Secondary)
        );
    }
    if (start + pageSize < episodes.length) {
        navBtns.push(
            new ButtonBuilder()
                .setCustomId(`${customId}_epnext_${page}`)
                .setLabel('Episode Selanjutnya ▶')
                .setStyle(ButtonStyle.Secondary)
        );
    }
    if (navBtns.length > 0) rows.push(new ActionRowBuilder().addComponents(navBtns));

    return rows;
}

function buildListButtons(index, total, key, customId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${customId}_prev_${index}`)
            .setLabel('◀')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(index === 0),
        new ButtonBuilder()
            .setCustomId(`${customId}_next_${index}`)
            .setLabel('▶')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(index === total - 1),
        new ButtonBuilder()
            .setCustomId(`${customId}_detail_${key}`)
            .setLabel('📋 Detail & Tonton')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(!key)
    );
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
                const ep = episodes[epIndex];
                const videoUrl = ep.external_audio_h264_m3u8 || ep.external_audio_h265_m3u8 || ep.m3u8_url;

                if (!videoUrl) {
                    return c.reply({ content: '❌ Link video tidak tersedia untuk episode ini.', flags: 64 });
                }

                const playerUrl = getPlayerUrl(videoUrl, info.name || info.title, epIndex + 1);
                const epEmbed = new EmbedBuilder()
                    .setColor(0xFEE75C)
                    .setTitle(`🎬 Episode ${epIndex + 1} - ${(info.name || info.title || '').slice(0, 200)}`)
                    .setDescription(`**[▶ Klik di sini untuk Tonton (Dubbing Indo)](${playerUrl})**\n\nLink akan membuka video player di browser dengan dubbing Indonesia.`)
                    .setThumbnail(ep.cover || info.cover || null)
                    .setFooter({ text: 'FreeReels · Dubbing Indonesia' });

                await c.reply({ embeds: [epEmbed], flags: 64 });

            } else if (c.customId.includes('_epnext_')) {
                currentPage++;
                const newRows = buildEpisodeSelectMenu(episodes, currentPage, customId);
                await c.update({ embeds: [detailEmbed], components: newRows });

            } else if (c.customId.includes('_epprev_')) {
                currentPage--;
                const newRows = buildEpisodeSelectMenu(episodes, currentPage, customId);
                await c.update({ embeds: [detailEmbed], components: newRows });
            }
        });

        collector.on('end', () => {
            btnInteraction.editReply({ components: [] }).catch(() => {});
        });

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

    collector.on('end', () => {
        interaction.editReply({ components: [] }).catch(() => {});
    });
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
                    .setDescription('Cari drama dari semua daftar (filter lokal)')
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

                await interaction.editReply({ content: `🔍 Mencari **"${judul}"** dari semua daftar...` });

                const [foryouData, homepageData, animeData] = await Promise.all([
                    api.getForYou(0),
                    api.getHomepage(),
                    api.getAnimePage()
                ]);

                const allItems = [
                    ...extractItems(foryouData),
                    ...extractItems(homepageData),
                    ...extractItems(animeData)
                ];

                const seen = new Set();
                const unique = allItems.filter(i => {
                    if (seen.has(i.key)) return false;
                    seen.add(i.key);
                    return true;
                });

                items = unique.filter(i =>
                    (i.title || i.name || '').toLowerCase().includes(judul) ||
                    (i.desc || '').toLowerCase().includes(judul) ||
                    (i.content_tags || []).some(t => t.toLowerCase().includes(judul))
                );
                title = `FreeReels - Cari: "${judul}"`;

                if (items.length === 0) {
                    return interaction.editReply({
                        content: `❌ Tidak ada drama ditemukan untuk kata kunci **"${judul}"**.\n\nCoba gunakan kata kunci yang lebih umum, atau browsing langsung dengan:\n• \`/freereels foryou\`\n• \`/freereels homepage\``
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
                        const ep = episodes[epIndex];
                        const videoUrl = ep.external_audio_h264_m3u8 || ep.external_audio_h265_m3u8 || ep.m3u8_url;
                        if (!videoUrl) return c.reply({ content: '❌ Link video tidak tersedia.', flags: 64 });

                        const playerUrl = getPlayerUrl(videoUrl, info.name || info.title, epIndex + 1);
                        const epEmbed = new EmbedBuilder()
                            .setColor(0xFEE75C)
                            .setTitle(`🎬 Episode ${epIndex + 1} - ${(info.name || '').slice(0, 200)}`)
                            .setDescription(`**[▶ Klik di sini untuk Tonton (Dubbing Indo)](${playerUrl})**`)
                            .setThumbnail(ep.cover || info.cover || null)
                            .setFooter({ text: 'FreeReels · Dubbing Indonesia' });
                        await c.reply({ embeds: [epEmbed], flags: 64 });
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

            if (!items.length) {
                return interaction.editReply({ content: '❌ Tidak ada data yang ditemukan.' });
            }

            await showList(interaction, items, title);

        } catch (err) {
            console.error(`[freereels/${sub}]`, err.message);
            await interaction.editReply({ content: `❌ Terjadi kesalahan: **${err.message}**` });
        }
    }
};
