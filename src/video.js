const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');

const execFileAsync = promisify(execFile);
const MAX_SIZE_BYTES = 8 * 1024 * 1024;

const FREEREELS_HEADERS = {
    'Referer': 'https://m.mydramawave.com/',
    'Origin': 'https://m.mydramawave.com',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
};

const FREEREELS_FFMPEG_HEADERS = 'Referer: https://m.mydramawave.com/\r\nOrigin: https://m.mydramawave.com\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36\r\n';

// Calculate target video bitrate to fit within 7MB given duration (seconds)
// quality: '360p' | '720p'
// Returns null if the duration is too long to achieve minimum quality
function calcBitrate(durationSec, quality) {
    const TARGET_BYTES = 7 * 1024 * 1024;
    const AUDIO_KBPS = 64;
    const total = Math.floor((TARGET_BYTES * 8) / 1000 / Math.max(durationSec, 5)) - AUDIO_KBPS;
    const MIN = quality === '720p' ? 500 : 150;
    if (total < MIN) return null;
    return Math.min(total, quality === '720p' ? 1500 : 500);
}

function makeStreamFallback(url, msg = 'File terlalu besar untuk Discord.') {
    const err = new Error(msg);
    err.streamFallback = true;
    err.streamUrl = url;
    return err;
}

// ─── FreeReels ────────────────────────────────────────────────────────────────

async function parseFreeReelsMasterM3u8(masterUrl) {
    const res = await axios.get(masterUrl, { headers: FREEREELS_HEADERS, responseType: 'text' });
    const lines = res.data.split('\n');
    const base = masterUrl.replace(/\/[^/]+\.m3u8.*$/, '/');
    let audioUrl = null;
    const streams = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXT-X-MEDIA') && line.includes('TYPE=AUDIO')) {
            const m = line.match(/URI="([^"]+)"/);
            if (m) audioUrl = m[1].startsWith('http') ? m[1] : base + m[1];
        }
        if (line.startsWith('#EXT-X-STREAM-INF')) {
            const bw = parseInt((line.match(/BANDWIDTH=(\d+)/) || [])[1] || '0');
            const next = lines[i + 1]?.trim();
            if (next && !next.startsWith('#')) {
                streams.push({ bw, url: next.startsWith('http') ? next : base + next });
            }
        }
    }
    streams.sort((a, b) => a.bw - b.bw);
    return { videoUrl: streams[0]?.url || masterUrl, audioUrl };
}

async function downloadSubtitle(url) {
    if (!url) return null;
    try {
        const res = await axios.get(url, { responseType: 'text', timeout: 10000 });
        const p = path.join(os.tmpdir(), `fr_sub_${Date.now()}.srt`);
        fs.writeFileSync(p, res.data, 'utf8');
        return p;
    } catch { return null; }
}

async function getM3u8Duration(m3u8url, headers = {}) {
    try {
        const res = await axios.get(m3u8url, { headers, responseType: 'text', timeout: 10000 });
        let total = 0;
        for (const line of res.data.split('\n')) {
            if (line.startsWith('#EXTINF:')) {
                total += parseFloat(line.split(':')[1]?.split(',')?.[0] || '0');
            }
        }
        return total > 0 ? total : null;
    } catch { return null; }
}

async function downloadFreeReelsEpisode(masterM3u8Url, subtitleUrl = null, durationSec = null, quality = '360p') {
    const { videoUrl, audioUrl } = await parseFreeReelsMasterM3u8(masterM3u8Url);
    const dur = durationSec || await getM3u8Duration(videoUrl, FREEREELS_HEADERS) || 120;
    const vidBitrate = calcBitrate(dur, quality);

    // If can't achieve minimum quality → stream fallback
    if (!vidBitrate) throw makeStreamFallback(masterM3u8Url, `Episode terlalu panjang untuk kualitas ${quality} di Discord.`);

    const maxBitrate = Math.floor(vidBitrate * 1.5);
    const tmpFile = path.join(os.tmpdir(), `fr_${Date.now()}.mp4`);
    let srtPath = null;

    console.log(`[video] FR ${quality} dur=${dur.toFixed(0)}s v=${vidBitrate}k`);
    srtPath = await downloadSubtitle(subtitleUrl);

    const scaleFilter = quality === '360p' ? 'scale=360:-2,' : '';

    let args;
    if (srtPath) {
        const esc = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');
        const subFilter = `${scaleFilter}subtitles=${esc}:force_style='FontName=Arial,FontSize=13,PrimaryColour=&Hffffff,OutlineColour=&H000000,BackColour=&H80000000,Bold=1,Outline=2,Shadow=1,Alignment=2'`;
        args = [
            '-y',
            '-allowed_extensions', 'ALL', '-headers', FREEREELS_FFMPEG_HEADERS, '-i', videoUrl,
            ...(audioUrl ? ['-allowed_extensions', 'ALL', '-headers', FREEREELS_FFMPEG_HEADERS, '-i', audioUrl] : []),
            '-map', '0:v:0', '-map', audioUrl ? '1:a:0' : '0:a:0',
            '-vf', subFilter,
            '-c:v', 'libx264', '-preset', 'ultrafast',
            '-b:v', `${vidBitrate}k`, '-maxrate', `${maxBitrate}k`, '-bufsize', `${maxBitrate * 2}k`,
            '-c:a', 'aac', '-b:a', '64k',
            '-movflags', '+faststart', tmpFile
        ];
    } else if (audioUrl) {
        args = [
            '-y',
            '-allowed_extensions', 'ALL', '-headers', FREEREELS_FFMPEG_HEADERS, '-i', videoUrl,
            '-allowed_extensions', 'ALL', '-headers', FREEREELS_FFMPEG_HEADERS, '-i', audioUrl,
            '-map', '0:v:0', '-map', '1:a:0',
            ...(quality === '360p' ? ['-vf', 'scale=360:-2'] : []),
            '-c:v', 'libx264', '-preset', 'ultrafast',
            '-b:v', `${vidBitrate}k`, '-maxrate', `${maxBitrate}k`, '-bufsize', `${maxBitrate * 2}k`,
            '-c:a', 'aac', '-b:a', '64k',
            '-movflags', '+faststart', tmpFile
        ];
    } else {
        args = [
            '-y', '-allowed_extensions', 'ALL', '-headers', FREEREELS_FFMPEG_HEADERS, '-i', videoUrl,
            ...(quality === '360p' ? ['-vf', 'scale=360:-2'] : []),
            '-c:v', 'libx264', '-preset', 'ultrafast',
            '-b:v', `${vidBitrate}k`, '-maxrate', `${maxBitrate}k`, '-bufsize', `${maxBitrate * 2}k`,
            '-c:a', 'aac', '-b:a', '64k',
            '-movflags', '+faststart', tmpFile
        ];
    }

    try {
        await execFileAsync('ffmpeg', args, { timeout: 210_000 });
    } finally {
        if (srtPath) try { fs.unlinkSync(srtPath); } catch (_) {}
    }

    const stat = fs.statSync(tmpFile);
    if (stat.size > MAX_SIZE_BYTES) {
        fs.unlinkSync(tmpFile);
        throw makeStreamFallback(masterM3u8Url, `File terlalu besar (${Math.round(stat.size / 1024 / 1024)}MB) untuk Discord.`);
    }
    return { filePath: tmpFile, sizeBytes: stat.size };
}

// ─── ReelShort ────────────────────────────────────────────────────────────────

async function downloadReelShortEpisode(m3u8Url, quality = '360p') {
    const dur = await getM3u8Duration(m3u8Url) || 120;
    const vidBitrate = calcBitrate(dur, quality);
    const tmpFile = path.join(os.tmpdir(), `rs_${Date.now()}.mp4`);

    console.log(`[video] RS ${quality} dur=${dur.toFixed(0)}s v=${vidBitrate || 'STREAM'}k`);

    if (!vidBitrate) throw makeStreamFallback(m3u8Url, `Episode terlalu panjang untuk kualitas ${quality} di Discord.`);

    const maxBitrate = Math.floor(vidBitrate * 1.5);

    const args = [
        '-y', '-allowed_extensions', 'ALL', '-i', m3u8Url,
        ...(quality === '360p' ? ['-vf', 'scale=360:-2'] : []),
        '-c:v', 'libx264', '-preset', 'ultrafast',
        '-b:v', `${vidBitrate}k`, '-maxrate', `${maxBitrate}k`, '-bufsize', `${maxBitrate * 2}k`,
        '-c:a', 'aac', '-b:a', '64k',
        '-movflags', '+faststart', tmpFile
    ];

    try {
        await execFileAsync('ffmpeg', args, { timeout: 210_000 });
    } catch (err) {
        try { fs.unlinkSync(tmpFile); } catch (_) {}
        // If ffmpeg fails, fallback to stream
        const ferr = makeStreamFallback(m3u8Url, 'Gagal encode video. Coba streaming di browser.');
        throw ferr;
    }

    const stat = fs.statSync(tmpFile);
    if (stat.size > MAX_SIZE_BYTES) {
        fs.unlinkSync(tmpFile);
        throw makeStreamFallback(m3u8Url, `File terlalu besar (${Math.round(stat.size / 1024 / 1024)}MB) untuk Discord.`);
    }
    return { filePath: tmpFile, sizeBytes: stat.size };
}

// ─── Melolo ───────────────────────────────────────────────────────────────────

async function getRemoteFileSize(url) {
    try {
        const res = await axios.head(url, { timeout: 8000 });
        return parseInt(res.headers['content-length'] || '0');
    } catch { return 0; }
}

async function downloadMeloloEpisode(mp4Url, durationSec = null, quality = '360p') {
    const dur = durationSec || 120;
    const vidBitrate = calcBitrate(dur, quality);
    const tmpFile = path.join(os.tmpdir(), `ml_${Date.now()}.mp4`);

    console.log(`[video] ML ${quality} dur=${dur.toFixed(0)}s v=${vidBitrate || 'STREAM'}k`);

    if (!vidBitrate) throw makeStreamFallback(mp4Url, `Episode terlalu panjang untuk kualitas ${quality} di Discord.`);

    // Pre-check source file size — if too large, streaming is safer
    const sourceSize = await getRemoteFileSize(mp4Url);
    if (sourceSize > 50 * 1024 * 1024) {
        console.log(`[video] ML source too large (${Math.round(sourceSize/1024/1024)}MB), streaming`);
        throw makeStreamFallback(mp4Url, 'File sumber terlalu besar, gunakan streaming browser.');
    }

    const maxBitrate = Math.floor(vidBitrate * 1.5);

    const args = [
        '-y', '-threads', '1', '-i', mp4Url,
        ...(quality === '360p' ? ['-vf', 'scale=360:-2'] : []),
        '-c:v', 'libx264', '-preset', 'ultrafast',
        '-b:v', `${vidBitrate}k`, '-maxrate', `${maxBitrate}k`, '-bufsize', `${maxBitrate * 2}k`,
        '-c:a', 'aac', '-b:a', '64k', '-threads', '1',
        '-movflags', '+faststart', tmpFile
    ];

    try {
        await execFileAsync('ffmpeg', args, { timeout: 210_000 });
    } catch (err) {
        try { fs.unlinkSync(tmpFile); } catch (_) {}
        console.error('[video] ML ffmpeg error:', err.message?.slice(0, 100));
        throw makeStreamFallback(mp4Url, 'Gagal encode video. Coba streaming di browser.');
    }

    const stat = fs.statSync(tmpFile);
    if (stat.size > MAX_SIZE_BYTES) {
        fs.unlinkSync(tmpFile);
        throw makeStreamFallback(mp4Url, `File terlalu besar (${Math.round(stat.size / 1024 / 1024)}MB) untuk Discord.`);
    }
    return { filePath: tmpFile, sizeBytes: stat.size };
}

function cleanup(filePath) {
    try { fs.unlinkSync(filePath); } catch (_) {}
}

module.exports = {
    downloadFreeReelsEpisode,
    downloadReelShortEpisode,
    downloadMeloloEpisode,
    cleanup
};
