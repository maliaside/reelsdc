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

// ffmpeg timeout: max(dur * 5, 60) seconds — enough for ultrafast encode but not infinite
function ffmpegTimeout(durationSec) {
    return Math.min(Math.max(durationSec * 5, 60), 120) * 1000;
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
            '-y', '-allowed_extensions', 'ALL', '-headers', FREEREELS_FFMPEG_HEADERS, '-i', videoUrl,
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
            '-y', '-allowed_extensions', 'ALL', '-headers', FREEREELS_FFMPEG_HEADERS, '-i', videoUrl,
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
        await execFileAsync('ffmpeg', args, { timeout: ffmpegTimeout(dur) });
    } catch (err) {
        try { fs.unlinkSync(tmpFile); } catch (_) {}
        if (srtPath) try { fs.unlinkSync(srtPath); } catch (_) {}
        console.error('[video] FR ffmpeg error:', err.message?.slice(0, 80));
        throw makeStreamFallback(masterM3u8Url, 'Gagal encode video. Coba streaming di browser.');
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
        await execFileAsync('ffmpeg', args, { timeout: ffmpegTimeout(dur) });
    } catch (err) {
        try { fs.unlinkSync(tmpFile); } catch (_) {}
        console.error('[video] RS ffmpeg error:', err.message?.slice(0, 80));
        throw makeStreamFallback(m3u8Url, 'Gagal encode video. Coba streaming di browser.');
    }

    const stat = fs.statSync(tmpFile);
    if (stat.size > MAX_SIZE_BYTES) {
        fs.unlinkSync(tmpFile);
        throw makeStreamFallback(m3u8Url, `File terlalu besar (${Math.round(stat.size / 1024 / 1024)}MB) untuk Discord.`);
    }
    return { filePath: tmpFile, sizeBytes: stat.size };
}

// ─── Melolo ───────────────────────────────────────────────────────────────────

// Download file ke disk dengan timeout ketat + batas ukuran
// Jika lambat/gagal → throw streamFallback
async function downloadToFile(url, destPath, maxBytes, timeoutMs, streamFallbackUrl) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            try { fs.unlinkSync(destPath); } catch (_) {}
            reject(makeStreamFallback(streamFallbackUrl, 'Download terlalu lambat. Coba streaming di browser.'));
        }, timeoutMs);

        axios.get(url, {
            responseType: 'stream',
            timeout: timeoutMs,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 Chrome/120.0.6099.230 Mobile Safari/537.36',
                'Range': `bytes=0-${maxBytes - 1}`,
            }
        }).then(res => {
            const writer = fs.createWriteStream(destPath);
            let bytes = 0;

            res.data.on('data', chunk => {
                bytes += chunk.length;
                if (bytes > maxBytes) {
                    clearTimeout(timer);
                    res.data.destroy();
                    writer.destroy();
                    try { fs.unlinkSync(destPath); } catch (_) {}
                    reject(makeStreamFallback(streamFallbackUrl, 'File sumber terlalu besar untuk Discord.'));
                }
            });

            res.data.pipe(writer);

            writer.on('finish', () => {
                clearTimeout(timer);
                resolve(bytes);
            });
            writer.on('error', err => {
                clearTimeout(timer);
                try { fs.unlinkSync(destPath); } catch (_) {}
                reject(makeStreamFallback(streamFallbackUrl, 'Gagal download: ' + err.message));
            });
            res.data.on('error', err => {
                clearTimeout(timer);
                try { fs.unlinkSync(destPath); } catch (_) {}
                reject(makeStreamFallback(streamFallbackUrl, 'Gagal download stream: ' + err.message));
            });
        }).catch(err => {
            clearTimeout(timer);
            try { fs.unlinkSync(destPath); } catch (_) {}
            reject(makeStreamFallback(streamFallbackUrl, 'Gagal koneksi download: ' + (err.message?.slice(0, 60) || 'unknown')));
        });
    });
}

async function downloadMeloloEpisode(mp4Url, durationSec = null, quality = '360p') {
    const dur = durationSec || 120;
    const vidBitrate = calcBitrate(dur, quality);
    const srcFile = path.join(os.tmpdir(), `ml_src_${Date.now()}.mp4`);
    const outFile = path.join(os.tmpdir(), `ml_out_${Date.now()}.mp4`);

    console.log(`[video] ML ${quality} dur=${dur.toFixed(0)}s v=${vidBitrate || 'STREAM'}k`);

    if (!vidBitrate) throw makeStreamFallback(mp4Url, `Episode terlalu panjang untuk kualitas ${quality} di Discord.`);

    // Estimasi ukuran sumber: asumsi 2Mbps = 250KB/s → dur * 300KB, max 40MB
    const estSourceBytes = Math.min(dur * 300 * 1024, 40 * 1024 * 1024);
    // Timeout download: max(dur * 2, 30) detik — cukup untuk koneksi wajar
    const dlTimeout = Math.max(dur * 2, 30) * 1000;

    console.log(`[video] ML downloading src (timeout=${Math.round(dlTimeout/1000)}s)...`);

    // Step 1: Download file sumber ke disk
    try {
        const bytes = await downloadToFile(mp4Url, srcFile, estSourceBytes, dlTimeout, mp4Url);
        console.log(`[video] ML src downloaded: ${Math.round(bytes/1024)}KB`);
    } catch (err) {
        console.warn('[video] ML download failed:', err.message?.slice(0, 80));
        throw err; // already a streamFallback error
    }

    // Step 2: ffmpeg dari file lokal (cepat, tanpa network I/O)
    const maxBitrate = Math.floor(vidBitrate * 1.5);
    const args = [
        '-y', '-threads', '2', '-i', srcFile,
        ...(quality === '360p' ? ['-vf', 'scale=360:-2'] : []),
        '-c:v', 'libx264', '-preset', 'ultrafast',
        '-b:v', `${vidBitrate}k`, '-maxrate', `${maxBitrate}k`, '-bufsize', `${maxBitrate * 2}k`,
        '-c:a', 'aac', '-b:a', '64k',
        '-movflags', '+faststart', outFile
    ];

    try {
        await execFileAsync('ffmpeg', args, { timeout: ffmpegTimeout(dur) });
    } catch (err) {
        try { fs.unlinkSync(srcFile); } catch (_) {}
        try { fs.unlinkSync(outFile); } catch (_) {}
        console.error('[video] ML ffmpeg error:', err.message?.slice(0, 80));
        throw makeStreamFallback(mp4Url, 'Gagal encode video. Coba streaming di browser.');
    } finally {
        try { fs.unlinkSync(srcFile); } catch (_) {}
    }

    const stat = fs.statSync(outFile);
    if (stat.size > MAX_SIZE_BYTES) {
        fs.unlinkSync(outFile);
        throw makeStreamFallback(mp4Url, `File terlalu besar (${Math.round(stat.size / 1024 / 1024)}MB) untuk Discord.`);
    }
    return { filePath: outFile, sizeBytes: stat.size };
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
