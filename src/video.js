const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');

const execFileAsync = promisify(execFile);

// Discord bot limit: 8MB per attachment
const MAX_BYTES = 8 * 1024 * 1024;
// Max episode duration for re-encode attempt (longer = too slow on Replit)
const MAX_ENCODE_DUR = 150; // seconds

const FR_HEADERS = {
    'Referer': 'https://m.mydramawave.com/',
    'Origin':  'https://m.mydramawave.com',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
};
const FR_FFMPEG_HDR = 'Referer: https://m.mydramawave.com/\r\nOrigin: https://m.mydramawave.com\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36\r\n';

function streamFallback(url, msg) {
    const e = new Error(msg || 'File terlalu besar untuk Discord.');
    e.streamFallback = true; e.streamUrl = url;
    return e;
}

// Bitrate that fits 7MB for given duration
function targetBitrate(dur, quality) {
    const AUDIO = 64;
    const total = Math.floor((7 * 1024 * 1024 * 8) / 1000 / Math.max(dur, 5)) - AUDIO;
    const min = quality === '720p' ? 500 : 150;
    if (total < min) return null;
    return Math.min(total, quality === '720p' ? 1500 : 500);
}

// Encode timeout: 4× video duration, min 90s
function encodeTimeout(dur) {
    return Math.max(dur * 4, 90) * 1000;
}

function removeTmp(...files) {
    for (const f of files) { try { if (f) fs.unlinkSync(f); } catch (_) {} }
}

// ─── FreeReels (HLS) ──────────────────────────────────────────────────────────

async function parseFrMaster(masterUrl) {
    const res = await axios.get(masterUrl, { headers: FR_HEADERS, responseType: 'text', timeout: 15000 });
    const lines = res.data.split('\n');
    const base = masterUrl.replace(/\/[^/]+\.m3u8.*$/, '/');
    let audio = null;
    const streams = [];
    for (let i = 0; i < lines.length; i++) {
        const l = lines[i].trim();
        if (l.startsWith('#EXT-X-MEDIA') && l.includes('TYPE=AUDIO')) {
            const m = l.match(/URI="([^"]+)"/);
            if (m) audio = m[1].startsWith('http') ? m[1] : base + m[1];
        }
        if (l.startsWith('#EXT-X-STREAM-INF')) {
            const bw = parseInt((l.match(/BANDWIDTH=(\d+)/) || [])[1] || '0');
            const nx = lines[i + 1]?.trim();
            if (nx && !nx.startsWith('#')) streams.push({ bw, url: nx.startsWith('http') ? nx : base + nx });
        }
    }
    streams.sort((a, b) => a.bw - b.bw);
    return { videoUrl: streams[0]?.url || masterUrl, audioUrl: audio };
}

async function getM3u8Duration(url, headers = {}) {
    try {
        const res = await axios.get(url, { headers, responseType: 'text', timeout: 10000 });
        let t = 0;
        for (const l of res.data.split('\n')) {
            if (l.startsWith('#EXTINF:')) t += parseFloat(l.split(':')[1]?.split(',')?.[0] || '0');
        }
        return t > 0 ? t : null;
    } catch { return null; }
}

async function downloadSubtitle(url) {
    if (!url) return null;
    try {
        const res = await axios.get(url, { responseType: 'text', timeout: 10000 });
        const p = path.join(os.tmpdir(), `sub_${Date.now()}.srt`);
        fs.writeFileSync(p, res.data, 'utf8');
        return p;
    } catch { return null; }
}

async function downloadFreeReelsEpisode(masterUrl, subtitleUrl = null, durationSec = null, quality = '360p') {
    const { videoUrl, audioUrl } = await parseFrMaster(masterUrl);
    const dur = durationSec || await getM3u8Duration(videoUrl, FR_HEADERS) || 120;

    if (dur > MAX_ENCODE_DUR) throw streamFallback(masterUrl, `Episode ${Math.round(dur)}s — terlalu panjang untuk Discord, gunakan streaming browser.`);

    const bps = targetBitrate(dur, quality);
    if (!bps) throw streamFallback(masterUrl, `Episode terlalu panjang untuk kualitas ${quality} di Discord.`);

    const maxBps = Math.floor(bps * 1.5);
    const out = path.join(os.tmpdir(), `fr_${Date.now()}.mp4`);
    let srt = null;

    console.log(`[video] FR ${quality} dur=${Math.round(dur)}s bps=${bps}k`);
    srt = await downloadSubtitle(subtitleUrl);

    let args;
    const scaleF = quality === '360p' ? 'scale=360:-2,' : '';
    if (srt) {
        const esc = srt.replace(/\\/g, '/').replace(/:/g, '\\:');
        const vf = `${scaleF}subtitles=${esc}:force_style='FontName=Arial,FontSize=13,PrimaryColour=&Hffffff,OutlineColour=&H000000,BackColour=&H80000000,Bold=1,Outline=2,Shadow=1,Alignment=2'`;
        args = ['-y', '-allowed_extensions', 'ALL', '-headers', FR_FFMPEG_HDR, '-i', videoUrl,
            ...(audioUrl ? ['-allowed_extensions', 'ALL', '-headers', FR_FFMPEG_HDR, '-i', audioUrl] : []),
            '-map', '0:v:0', '-map', audioUrl ? '1:a:0' : '0:a:0', '-vf', vf,
            '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', `${bps}k`, '-maxrate', `${maxBps}k`, '-bufsize', `${maxBps * 2}k`,
            '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', out];
    } else if (audioUrl) {
        args = ['-y', '-allowed_extensions', 'ALL', '-headers', FR_FFMPEG_HDR, '-i', videoUrl,
            '-allowed_extensions', 'ALL', '-headers', FR_FFMPEG_HDR, '-i', audioUrl,
            '-map', '0:v:0', '-map', '1:a:0',
            ...(quality === '360p' ? ['-vf', 'scale=360:-2'] : []),
            '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', `${bps}k`, '-maxrate', `${maxBps}k`, '-bufsize', `${maxBps * 2}k`,
            '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', out];
    } else {
        args = ['-y', '-allowed_extensions', 'ALL', '-headers', FR_FFMPEG_HDR, '-i', videoUrl,
            ...(quality === '360p' ? ['-vf', 'scale=360:-2'] : []),
            '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', `${bps}k`, '-maxrate', `${maxBps}k`, '-bufsize', `${maxBps * 2}k`,
            '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', out];
    }

    try {
        await execFileAsync('ffmpeg', args, { timeout: encodeTimeout(dur) });
    } catch (err) {
        removeTmp(out, srt);
        console.error('[video] FR ffmpeg:', err.message?.slice(0, 120));
        throw streamFallback(masterUrl, 'Gagal encode. Coba streaming di browser.');
    } finally {
        removeTmp(srt);
    }

    const size = fs.statSync(out).size;
    if (size > MAX_BYTES) { removeTmp(out); throw streamFallback(masterUrl, `File ${Math.round(size/1024/1024)}MB > 8MB.`); }
    return { filePath: out, sizeBytes: size };
}

// ─── ReelShort (HLS) ─────────────────────────────────────────────────────────

async function downloadReelShortEpisode(m3u8Url, quality = '360p') {
    const dur = await getM3u8Duration(m3u8Url) || 120;

    if (dur > MAX_ENCODE_DUR) throw streamFallback(m3u8Url, `Episode ${Math.round(dur)}s — terlalu panjang untuk Discord, gunakan streaming browser.`);

    const bps = targetBitrate(dur, quality);
    if (!bps) throw streamFallback(m3u8Url, `Episode terlalu panjang untuk kualitas ${quality} di Discord.`);

    const maxBps = Math.floor(bps * 1.5);
    const out = path.join(os.tmpdir(), `rs_${Date.now()}.mp4`);

    console.log(`[video] RS ${quality} dur=${Math.round(dur)}s bps=${bps}k`);

    const args = ['-y', '-allowed_extensions', 'ALL', '-i', m3u8Url,
        ...(quality === '360p' ? ['-vf', 'scale=360:-2'] : []),
        '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', `${bps}k`, '-maxrate', `${maxBps}k`, '-bufsize', `${maxBps * 2}k`,
        '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', out];

    try {
        await execFileAsync('ffmpeg', args, { timeout: encodeTimeout(dur) });
    } catch (err) {
        removeTmp(out);
        console.error('[video] RS ffmpeg:', err.message?.slice(0, 120));
        throw streamFallback(m3u8Url, 'Gagal encode. Coba streaming di browser.');
    }

    const size = fs.statSync(out).size;
    if (size > MAX_BYTES) { removeTmp(out); throw streamFallback(m3u8Url, `File ${Math.round(size/1024/1024)}MB > 8MB.`); }
    return { filePath: out, sizeBytes: size };
}

// ─── Melolo (direct MP4 from TikTok CDN) ─────────────────────────────────────

async function downloadSource(url, destPath, maxBytes, timeoutMs) {
    return new Promise((resolve, reject) => {
        const kill = setTimeout(() => {
            removeTmp(destPath);
            reject(new Error('download_timeout'));
        }, timeoutMs);

        axios.get(url, {
            responseType: 'stream',
            timeout: timeoutMs + 5000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 Chrome/120.0.6099.230 Mobile Safari/537.36',
            }
        }).then(res => {
            const writer = fs.createWriteStream(destPath);
            let bytes = 0;
            res.data.on('data', chunk => {
                bytes += chunk.length;
                if (bytes > maxBytes) {
                    clearTimeout(kill); res.data.destroy(); writer.destroy(); removeTmp(destPath);
                    reject(new Error('source_too_large'));
                }
            });
            res.data.pipe(writer);
            writer.on('finish', () => { clearTimeout(kill); resolve(bytes); });
            writer.on('error', e => { clearTimeout(kill); removeTmp(destPath); reject(e); });
            res.data.on('error', e => { clearTimeout(kill); removeTmp(destPath); reject(e); });
        }).catch(e => { clearTimeout(kill); removeTmp(destPath); reject(e); });
    });
}

async function downloadMeloloEpisode(mp4Url, durationSec = null, quality = '360p') {
    const dur = durationSec || 120;
    const src = path.join(os.tmpdir(), `ml_src_${Date.now()}.mp4`);
    const out = path.join(os.tmpdir(), `ml_out_${Date.now()}.mp4`);

    console.log(`[video] ML ${quality} dur=${Math.round(dur)}s`);

    // Download source — limit 30MB, timeout = max(dur*2.5, 60)s
    const dlTimeout = Math.max(dur * 2.5, 60) * 1000;
    let srcBytes;
    try {
        srcBytes = await downloadSource(mp4Url, src, 30 * 1024 * 1024, dlTimeout);
        console.log(`[video] ML src downloaded ${Math.round(srcBytes / 1024)}KB`);
    } catch (e) {
        console.warn('[video] ML download failed:', e.message);
        throw streamFallback(mp4Url, e.message === 'source_too_large'
            ? 'Video terlalu besar (>30MB). Gunakan streaming browser.'
            : 'Download gagal/lambat. Coba streaming di browser.');
    }

    // Source already fits Discord → send directly (original quality, no encode!)
    if (srcBytes < MAX_BYTES) {
        console.log(`[video] ML src fits Discord (${Math.round(srcBytes/1024)}KB) — kirim langsung`);
        return { filePath: src, sizeBytes: srcBytes };
    }

    // Needs re-encoding — check if duration is short enough
    if (dur > MAX_ENCODE_DUR) {
        removeTmp(src);
        throw streamFallback(mp4Url, `Episode ${Math.round(dur)}s terlalu panjang untuk dikompresi. Gunakan streaming browser.`);
    }

    const bps = targetBitrate(dur, quality);
    if (!bps) { removeTmp(src); throw streamFallback(mp4Url, `Episode terlalu panjang untuk kualitas ${quality} di Discord.`); }

    const maxBps = Math.floor(bps * 1.5);
    const args = ['-y', '-threads', '2', '-i', src,
        ...(quality === '360p' ? ['-vf', 'scale=360:-2'] : []),
        '-c:v', 'libx264', '-preset', 'ultrafast',
        '-b:v', `${bps}k`, '-maxrate', `${maxBps}k`, '-bufsize', `${maxBps * 2}k`,
        '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', out];

    console.log(`[video] ML re-encoding bps=${bps}k`);
    try {
        await execFileAsync('ffmpeg', args, { timeout: encodeTimeout(dur) });
    } catch (err) {
        removeTmp(src, out);
        console.error('[video] ML ffmpeg:', err.message?.slice(0, 120));
        throw streamFallback(mp4Url, 'Gagal encode. Coba streaming di browser.');
    } finally {
        removeTmp(src);
    }

    const size = fs.statSync(out).size;
    if (size > MAX_BYTES) { removeTmp(out); throw streamFallback(mp4Url, `File ${Math.round(size/1024/1024)}MB > 8MB.`); }
    return { filePath: out, sizeBytes: size };
}

function cleanup(filePath) { removeTmp(filePath); }

module.exports = { downloadFreeReelsEpisode, downloadReelShortEpisode, downloadMeloloEpisode, cleanup };
