const axios = require('axios');

const BASE_URL = 'https://api.sansekai.my.id/api/melolo';

async function getForYou() {
    const res = await axios.get(`${BASE_URL}/foryou`, { timeout: 15000 });
    return res.data;
}

async function getDetail(bookId) {
    const res = await axios.get(`${BASE_URL}/detail`, { params: { bookId }, timeout: 15000 });
    return res.data;
}

async function getStream(videoId) {
    const res = await axios.get(`${BASE_URL}/stream`, { params: { videoId }, timeout: 15000 });
    return res.data;
}

function parseForYouItems(raw) {
    const cellData = raw?.data?.cell?.cell_data || [];
    const books = cellData.flatMap(c => c.books || []);
    return books.map(b => ({
        _source: 'melolo',
        key: String(b.book_id || ''),
        title: b.book_name || '',
        cover: b.thumb_url || '',
        desc: b.abstract || b.sub_abstract || '',
        tags: [],
        episodes: b.serial_count || b.last_chapter_index || null
    })).filter(b => b.key);
}

function parseDetail(raw) {
    const vd = raw?.data?.video_data || {};
    const episodes = (vd.video_list || []).map((ep, i) => ({
        vid: String(ep.vid || ''),
        index: ep.vid_index || (i + 1),
        title: ep.title || `Episode ${i + 1}`,
        cover: ep.episode_cover || ep.cover || null,
        duration: ep.duration || null,
        locked: !!ep.disable_play
    }));
    return {
        title: vd.series_title || '',
        cover: vd.series_cover || '',
        desc: vd.series_intro || '',
        episodeCount: vd.episode_cnt || episodes.length,
        episodes
    };
}

function parseVideoQualities(streamData) {
    const vm = JSON.parse(streamData.video_model || '{}');
    const videoList = vm.video_list || {};
    const qualities = [];

    for (const [, v] of Object.entries(videoList)) {
        try {
            const url = Buffer.from(v.main_url, 'base64').toString('utf8');
            qualities.push({
                definition: v.definition || '',
                width: v.vwidth || 0,
                height: v.vheight || 0,
                bitrate: v.bitrate || 0,
                size: v.size || 0,
                duration: vm.video_duration || null,
                url
            });
        } catch (_) {}
    }

    qualities.sort((a, b) => a.bitrate - b.bitrate);
    const topUrl = streamData.main_url || streamData.backup_url || '';
    const topDuration = vm.video_duration || null;
    return { qualities, topUrl, duration: topDuration };
}

module.exports = { getForYou, getDetail, getStream, parseForYouItems, parseDetail, parseVideoQualities };
