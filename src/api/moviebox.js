const axios = require('axios');

const BASE = 'https://api.sansekai.my.id/api/moviebox';
const RATE_MS = 4100;
let _last = 0;

async function api(path) {
    const wait = RATE_MS - (Date.now() - _last);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    _last = Date.now();
    const res = await axios.get(BASE + path, { timeout: 20000 });
    return res.data;
}

async function getTrending(page = 0) { return api(`/trending?page=${page}`); }
async function search(query, page = 1) { return api(`/search?query=${encodeURIComponent(query)}&page=${page}`); }
async function getDetail(subjectId) { return api(`/detail?subjectId=${subjectId}`); }
async function getSources(subjectId) { return api(`/sources?subjectId=${subjectId}`); }

function parseItems(data) {
    const raw = data?.items || data?.list || [];
    return raw.filter(i => i.subjectId).map(i => ({
        _source: 'moviebox',
        key: i.subjectId,
        title: i.title || '',
        cover: i.cover?.url || i.thumbnail || null,
        desc: i.description || '',
        genre: i.genre || '',
        country: i.countryName || '',
        imdb: i.imdbRatingValue || '',
        duration: i.duration || 0,
        subjectType: i.subjectType || 1,
        hasResource: i.hasResource !== false,
    }));
}

function parseSources(data) {
    return (data?.processedSources || [])
        .filter(s => s.directUrl && s.quality)
        .sort((a, b) => a.quality - b.quality)
        .map(s => ({
            quality: s.quality,
            url: s.directUrl,
            sizeMB: Math.round(parseInt(s.size || '0') / 1024 / 1024),
        }));
}

module.exports = { getTrending, search, getDetail, getSources, parseItems, parseSources };
