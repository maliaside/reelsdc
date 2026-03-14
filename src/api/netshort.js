const client = require('./client');

const BASE_URL = 'https://api.sansekai.my.id/api/netshort';
const LANG = { language: 'id' };

async function getForYou() {
    const res = await client.get(`${BASE_URL}/foryou`, { params: { ...LANG } });
    return res.data;
}

async function search(query) {
    const res = await client.get(`${BASE_URL}/search`, { params: { query, ...LANG } });
    return res.data;
}

async function getAllEpisodes(shortPlayId) {
    const res = await client.get(`${BASE_URL}/allepisode`, { params: { shortPlayId, ...LANG } });
    return res.data;
}

function _fixCover(url) {
    if (!url) return null;
    if (url.includes('.webp') || url.includes('.heic')) {
        return `https://wsrv.nl/?url=${encodeURIComponent(url)}&output=jpg&w=600&q=85`;
    }
    return url;
}

// Hapus karakter non-latin (China/Korea/Jepang)
function _isIndonesian(title) {
    if (!title) return false;
    return !/[\u3000-\u9FFF\uAC00-\uD7AF\u3040-\u30FF]/.test(title);
}

// Cek apakah judul adalah versi sulih suara (dubbed Indo)
function _isSulihSuara(title) {
    return /\(sulih suara\)/i.test(title);
}

// Ambil judul dasar (tanpa prefix sulih suara dan tag HTML)
function _baseTitle(title) {
    return title
        .replace(/<\/?em>/g, '')
        .replace(/\(sulih suara\)\s*/i, '')
        .trim()
        .toLowerCase();
}

// Jika ada versi sulih suara & versi original untuk judul yang sama,
// buang versi original — tampilkan hanya sulih suara.
// Jika tidak ada sulih suara, tampilkan original (kemungkinan konten asli Indo).
function _preferSulihSuara(items) {
    const sulihTitles = new Set(
        items.filter(i => _isSulihSuara(i.title)).map(i => _baseTitle(i.title))
    );
    return items.filter(i => {
        if (_isSulihSuara(i.title)) return true;        // selalu tampil
        return !sulihTitles.has(_baseTitle(i.title));   // original hanya jika tidak ada sulih suara
    });
}

function parseForYouItems(raw) {
    const items = raw?.contentInfos || [];
    const mapped = items
        .filter(i => _isIndonesian(i.shortPlayName))
        .map(i => ({
            _source: 'netshort',
            key: i.shortPlayId || i.shortPlayLibraryId || '',
            title: i.shortPlayName || '',
            cover: _fixCover(i.shortPlayCover),
            desc: '',
            tags: i.labelArray || [],
            episodes: null,
            popularity: i.heatScoreShow || null,
        })).filter(i => i.key);
    return _preferSulihSuara(mapped);
}

function parseSearchItems(raw) {
    const results = raw?.searchCodeSearchResult || raw?.simpleSearchResult || [];
    const mapped = results
        .filter(i => _isIndonesian(i.shortPlayName))
        .map(i => ({
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
    return _preferSulihSuara(mapped);
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
