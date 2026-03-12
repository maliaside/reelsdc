const client = require('./client');

const BASE_URL = 'https://api.sansekai.my.id/api/netshort';

async function getForYou() {
    const res = await client.get(`${BASE_URL}/foryou`);
    return res.data;
}

async function search(query) {
    const res = await client.get(`${BASE_URL}/search`, { params: { query } });
    return res.data;
}

async function getAllEpisodes(shortPlayId) {
    const res = await client.get(`${BASE_URL}/allepisode`, { params: { shortPlayId } });
    return res.data;
}

function _fixCover(url) {
    if (!url) return null;
    if (url.includes('.webp') || url.includes('.heic')) {
        return `https://wsrv.nl/?url=${encodeURIComponent(url)}&output=jpg&w=600&q=85`;
    }
    return url;
}

function parseForYouItems(raw) {
    const items = raw?.contentInfos || [];
    return items.map(i => ({
        _source: 'netshort',
        key: i.shortPlayId || i.shortPlayLibraryId || '',
        title: i.shortPlayName || '',
        cover: _fixCover(i.shortPlayCover),
        desc: '',
        tags: i.labelArray || [],
        episodes: null,
        popularity: i.heatScoreShow || null,
    })).filter(i => i.key);
}

function parseSearchItems(raw) {
    const results = raw?.searchCodeSearchResult || raw?.simpleSearchResult || [];
    return results.map(i => ({
        _source: 'netshort',
        key: i.shortPlayId || i.shortPlayLibraryId || '',
        title: (i.shortPlayName || '').replace(/<\/?em>/g, ''),
        cover: _fixCover(i.shortPlayCover),
        desc: i.shotIntroduce || '',
        tags: i.labelNameList || [],
        episodes: null,
        popularity: i.formatHeatScore || i.heatScore || null,
        actors: (i.actorList || []).slice(0, 3).map(a => a.name).filter(Boolean),
    })).filter(i => i.key);
}

function parseAllEpisodes(raw) {
    if (!raw) return null;
    const payPoint = raw.payPoint || 0;
    const episodes = (raw.shortPlayEpisodeInfos || []).map((ep, i) => ({
        episodeId: ep.episodeId || '',
        episodeNo: ep.episodeNo || (i + 1),
        label: `EPISODE ${ep.episodeNo || (i + 1)}`,
        cover: _fixCover(ep.episodeCover),
        playVoucher: ep.playVoucher || '',
        locked: payPoint > 0 && (ep.episodeNo || (i + 1)) > payPoint,
    }));
    return {
        title: raw.shortPlayName || '',
        cover: _fixCover(raw.shortPlayCover),
        desc: raw.shotIntroduce || '',
        totalEpisode: raw.totalEpisode || episodes.length,
        isFinish: raw.isFinish === 1,
        freeEpisodes: payPoint,
        episodes,
    };
}

function getPlayerUrl(shortPlayId) {
    return `https://netshort.com/id/drama/${encodeURIComponent(shortPlayId)}`;
}

module.exports = { getForYou, search, getAllEpisodes, parseForYouItems, parseSearchItems, parseAllEpisodes, getPlayerUrl };
