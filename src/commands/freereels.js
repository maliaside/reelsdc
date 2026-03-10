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

function extractItems(data) {
    if (!data) return [];
    const inner = data.data || data;
    return inner.items || inner.list || inner.drama || inner.anime || inner.result || (Array.isArray(inner) ? inner : []);
}

function buildListEmbed(item, index, total, title) {
    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle((item.title || item.name || 'Unknown Title').slice(0, 256))
        .setAuthor({ name: title })
        .setFooter({ text: `FreeReels • ${index + 1}/${total}` })
        .setTimestamp();

    if (item.cover || item.image || item.thumbnail) {
        embed.setImage(item.cover || item.image || item.thumbnail);
    }
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
    const views = item.view_count;
    if (views) {
        embed.addFields({ name: '👁️ Ditonton', value: Number(views).toLocaleString('id-ID'), inline: true });
    }
    return embed;
}

function buildDetailEmbed(info) {
    const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle((info.name || info.title || 'Unknown').slice(0, 256))
        .setAuthor({ name: '📋 Detail Drama' });

    if (info.cover) embed.setImage(info.cover);
    if (info.desc) {
        embed.setDescription(info.desc.length > 400 ? info.desc.slice(0, 397) + '...' : info.desc);
    }
    const tags = info.content_tags || info.tag;
    if (Array.isArray(tags) && tags.length > 0) {
        embed.addFields({ name: '🏷️ Tag', value: tags.filter(Boolean).join(', ') || '-', inline: true });
    }
    if (info.episode_count) {
        embed.addFields({ name: '📺 Total Episode', value: String(info.episode_count), inline: true });
    }
    if (info.follow_count) {
        embed.addFields({ name: '❤️ Pengikut', value: Number(info.follow_count).toLocaleString('id-ID'), inline: true });
    }
    const statusMap = { 1: 'Sedang Tayang', 2: 'Tamat', 3: 'Segera' };
    if (info.finish_status) {
        embed.addFields({ name: '📡 Status', value: statusMap[info.finish_status] || '-', inline: true });
    }
    if (info.free !== undefined) {
        embed.addFields({ name: '💰 Akses', value: info.free ? '✅ Gratis' : '🔒 VIP', inline: true });
    }
    embed.setFooter({ text: 'Pilih episode dari menu di bawah untuk menonton' });
    return embed;
}

function buildEpisodeEmbed(ep, epNum, info) {
    const embed = new EmbedBuilder()
        .setColor(0xFEE75C)
        .setTitle(`Episode ${epNum} - ${info.name || info.title}`.slice(0, 256))
        .setAuthor({ name: '🎬 Link Tonton' });

    if (ep.cover) embed.setThumbnail(ep.cover);

    const videoUrl = ep.external_audio_h264_m3u8 || ep.external_audio_h265_m3u8 || ep.m3u8_url || ep.video_url;
    const sub = (ep.subtitle_list || []).find(s => s.language === 'id-ID');
    const subEn = (ep.subtitle_list || []).find(s => s.language === 'en-US');

    if (videoUrl) {
        embed.addFields({ name: '🎬 Video (Dubbing Indo)', value: `[Klik untuk Tonton / Salin ke VLC](${videoUrl})`, inline: false });
    }
    if (sub) {
        embed.addFields({ name: '📝 Subtitle Indonesia', value: `[Download .SRT](${sub.subtitle}) | [Download .VTT](${sub.vtt})`, inline: false });
    } else if (subEn) {
        embed.addFields({ name: '📝 Subtitle (English)', value: `[Download .SRT](${subEn.subtitle}) | [Download .VTT](${subEn.vtt})`, inline: false });
    }

    if (!videoUrl) {
        embed.setDescription('❌ Link video tidak tersedia untuk episode ini.');
    }

    embed.setFooter({ text: 'Buka link di browser atau salin ke VLC Media Player untuk menonton' });
    return embed;
}

function buildListButtons(index, total, key, customId) {
    const row = new ActionRowBuilder().addComponents(
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
    return row;
}

function buildEpisodeSelectMenu(episodes, page, customId) {
    const pageSize = 25;
    const start = page * pageSize;
    const slice = episodes.slice(start, start + pageSize);

    const select = new StringSelectMenuBuilder()
        .setCustomId(`${customId}_ep_select_${page}`)
        .setPlaceholder(`Pilih Episode (${start + 1}–${start + slice.length} dari ${episodes.length})`);

    for (let i = 0; i < slice.length; i++) {
        select.addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel(`Ep ${start + i + 1}`)
                .setDescription((slice[i].name || '').slice(0, 100) || `Episode ${start + i + 1}`)
                .setValue(`${start + i}`)
        );
    }
    const row = new ActionRowBuilder().addComponents(select);

    const navBtns = [];
    if (page > 0) {
        navBtns.push(
            new ButtonBuilder()
                .setCustomId(`${customId}_ep_prev_${page}`)
                .setLabel('◀ Episode Sebelumnya')
                .setStyle(ButtonStyle.Secondary)
        );
    }
    if (start + pageSize < episodes.length) {
        navBtns.push(
            new ButtonBuilder()
                .setCustomId(`${customId}_ep_next_${page}`)
                .setLabel('Episode Selanjutnya ▶')
                .setStyle(ButtonStyle.Secondary)
        );
    }

    const rows = [row];
    if (navBtns.length > 0) {
        rows.push(new ActionRowBuilder().addComponents(navBtns));
    }
    return rows;
}

async function showDetail(interaction, key, isButton = false) {
    try {
        const data = await api.getDetail(key);
        const info = data?.data?.info || data?.data || data;

        if (!info || !info.name) {
            const msg = 'Detail drama tidak ditemukan.';
            return isButton
                ? interaction.reply({ content: msg, ephemeral: true })
                : interaction.editReply({ content: msg });
        }

        const episodes = info.episode_list || [];
        const embed = buildDetailEmbed(info);
        const customId = `det_${key}_${interaction.id}`;
        const episodeMenuRows = episodes.length > 0
            ? buildEpisodeSelectMenu(episodes, 0, customId)
            : [];

        const components = [...episodeMenuRows];
        const replyOpts = { embeds: [embed], components, ephemeral: isButton };

        const msg = isButton
            ? await interaction.reply(replyOpts)
            : await interaction.editReply(replyOpts);

        if (episodes.length === 0) return;

        const fetched = isButton ? await interaction.fetchReply() : msg;
        const collector = fetched.createMessageComponentCollector({ time: 180_000 });

        let currentPage = 0;

        collector.on('collect', async btn => {
            if (btn.user.id !== interaction.user.id) {
                return btn.reply({ content: 'Hanya pengguna yang membuka detail ini yang bisa memilih episode.', ephemeral: true });
            }

            if (btn.customId.includes('_ep_select_')) {
                const epIndex = parseInt(btn.values[0]);
                const ep = episodes[epIndex];
                const epEmbed = buildEpisodeEmbed(ep, epIndex + 1, info);
                await btn.reply({ embeds: [epEmbed], ephemeral: true });

            } else if (btn.customId.includes('_ep_next_')) {
                currentPage++;
                const newRows = buildEpisodeSelectMenu(episodes, currentPage, customId);
                await btn.update({ embeds: [embed], components: newRows });

            } else if (btn.customId.includes('_ep_prev_')) {
                currentPage--;
                const newRows = buildEpisodeSelectMenu(episodes, currentPage, customId);
                await btn.update({ embeds: [embed], components: newRows });
            }
        });

        collector.on('end', () => {
            if (isButton) {
                interaction.editReply({ components: [] }).catch(() => {});
            }
        });

    } catch (err) {
        console.error('[showDetail] Error:', err.message);
        const msg = `Gagal mengambil detail: **${err.message}**`;
        isButton
            ? interaction.reply({ content: msg, ephemeral: true }).catch(() => {})
            : interaction.editReply({ content: msg }).catch(() => {});
    }
}

async function showList(interaction, items, title) {
    let index = 0;
    const customId = `list_${interaction.id}`;
    const getKey = (i) => items[i]?.key || items[i]?.id || '';

    const embed = buildListEmbed(items[index], index, items.length, title);
    const row = buildListButtons(index, items.length, getKey(index), customId);

    const msg = await interaction.editReply({ embeds: [embed], components: [row] });
    const collector = msg.createMessageComponentCollector({ time: 120_000 });

    collector.on('collect', async btn => {
        if (btn.user.id !== interaction.user.id) {
            return btn.reply({ content: 'Hanya pengguna yang menjalankan perintah yang bisa navigasi.', ephemeral: true });
        }

        if (btn.customId.includes('_detail_')) {
            const key = btn.customId.split('_detail_')[1];
            await btn.deferReply({ ephemeral: true });
            await btn.editReply({ content: '⏳ Mengambil detail drama...' });
            try {
                const data = await api.getDetail(key);
                const info = data?.data?.info || data?.data || data;
                if (!info || !info.name) {
                    return btn.editReply({ content: 'Detail tidak ditemukan.' });
                }
                const episodes = info.episode_list || [];
                const detailEmbed = buildDetailEmbed(info);
                const detCustomId = `det_${key}_${btn.id}`;
                const episodeMenuRows = episodes.length > 0
                    ? buildEpisodeSelectMenu(episodes, 0, detCustomId)
                    : [];

                await btn.editReply({ content: null, embeds: [detailEmbed], components: episodeMenuRows });

                const detMsg = await btn.fetchReply();
                let currentPage = 0;
                const detCollector = detMsg.createMessageComponentCollector({ time: 180_000 });

                detCollector.on('collect', async c => {
                    if (c.user.id !== btn.user.id) {
                        return c.reply({ content: 'Hanya kamu yang bisa memilih episode ini.', ephemeral: true });
                    }
                    if (c.customId.includes('_ep_select_')) {
                        const epIndex = parseInt(c.values[0]);
                        const ep = episodes[epIndex];
                        const epEmbed = buildEpisodeEmbed(ep, epIndex + 1, info);
                        await c.reply({ embeds: [epEmbed], ephemeral: true });
                    } else if (c.customId.includes('_ep_next_')) {
                        currentPage++;
                        const newRows = buildEpisodeSelectMenu(episodes, currentPage, detCustomId);
                        await c.update({ embeds: [detailEmbed], components: newRows });
                    } else if (c.customId.includes('_ep_prev_')) {
                        currentPage--;
                        const newRows = buildEpisodeSelectMenu(episodes, currentPage, detCustomId);
                        await c.update({ embeds: [detailEmbed], components: newRows });
                    }
                });

                detCollector.on('end', () => {
                    btn.editReply({ components: [] }).catch(() => {});
                });
            } catch (err) {
                console.error('[detail button] Error:', err.message);
                btn.editReply({ content: `Gagal mengambil detail: **${err.message}**` }).catch(() => {});
            }
            return;
        }

        if (btn.customId.includes('_next_')) index = Math.min(index + 1, items.length - 1);
        if (btn.customId.includes('_prev_')) index = Math.max(index - 1, 0);

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
                    .setDescription('Cari drama di FreeReels')
                    .addStringOption(opt =>
                        opt.setName('judul').setDescription('Judul drama yang ingin dicari').setRequired(true)))
            .addSubcommand(sub =>
                sub.setName('detail')
                    .setDescription('Detail drama berdasarkan KEY')
                    .addStringOption(opt =>
                        opt.setName('key').setDescription('KEY drama').setRequired(true))),
    ],

    showDetail,

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        await interaction.deferReply();

        try {
            let data, items, title;

            if (sub === 'foryou') {
                const offset = interaction.options.getInteger('offset') || 0;
                data = await api.getForYou(offset);
                items = extractItems(data);
                items = items.filter(i => i.key && i.key !== '' && i.item_type !== 'card');
                title = `FreeReels - For You (offset: ${offset})`;

            } else if (sub === 'homepage') {
                data = await api.getHomepage();
                items = extractItems(data);
                items = items.filter(i => i.key && i.key !== '');
                title = 'FreeReels - Homepage';

            } else if (sub === 'anime') {
                data = await api.getAnimePage();
                items = extractItems(data);
                items = items.filter(i => i.key && i.key !== '');
                title = 'FreeReels - Anime';

            } else if (sub === 'cari') {
                const judul = interaction.options.getString('judul');
                data = await api.search(judul);
                items = extractItems(data);
                items = items.filter(i => i.key && i.key !== '');
                title = `FreeReels - Cari: "${judul}"`;

            } else if (sub === 'detail') {
                const key = interaction.options.getString('key');
                return await showDetail(interaction, key, false);
            }

            if (!Array.isArray(items) || items.length === 0) {
                return interaction.editReply({
                    content: `Tidak ada data yang ditemukan.\n\`\`\`json\n${JSON.stringify(data, null, 2).slice(0, 800)}\n\`\`\``
                });
            }

            await showList(interaction, items, title);

        } catch (err) {
            console.error(`[freereels/${sub}] Error:`, err.message);
            await interaction.editReply({
                content: `Terjadi kesalahan: **${err.message}**`
            });
        }
    }
};
