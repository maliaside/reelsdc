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

async function parseFreeReelsMasterM3u8(masterUrl) {
    const res = await axios.get(masterUrl, { headers: FREEREELS_HEADERS, responseType: 'text' });
    const lines = res.data.split('\n');
    const baseUrl = masterUrl.replace(/\/[^/]+\.m3u8.*$/, '/');

    let audioRelUrl = null;
    const videoStreams = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXT-X-MEDIA') && line.includes('TYPE=AUDIO')) {
            const uriMatch = line.match(/URI="([^"]+)"/);
            if (uriMatch) audioRelUrl = uriMatch[1];
        }
        if (line.startsWith('#EXT-X-STREAM-INF')) {
            const bwMatch = line.match(/BANDWIDTH=(\d+)/);
            const urlLine = lines[i + 1]?.trim();
            if (urlLine && !urlLine.startsWith('#')) {
                videoStreams.push({
                    bandwidth: parseInt(bwMatch?.[1] || '0'),
                    url: urlLine.startsWith('http') ? urlLine : baseUrl + urlLine
                });
            }
        }
    }

    videoStreams.sort((a, b) => a.bandwidth - b.bandwidth);
    const lowestVideoUrl = videoStreams[0]?.url || masterUrl;
    const audioUrl = audioRelUrl
        ? (audioRelUrl.startsWith('http') ? audioRelUrl : baseUrl + audioRelUrl)
        : null;

    return { lowestVideoUrl, audioUrl };
}

async function downloadSubtitle(subtitleUrl) {
    if (!subtitleUrl) return null;
    try {
        const res = await axios.get(subtitleUrl, { responseType: 'text', timeout: 10000 });
        const srtPath = path.join(os.tmpdir(), `fr_sub_${Date.now()}.srt`);
        fs.writeFileSync(srtPath, res.data, 'utf8');
        console.log('[video] Subtitle saved:', srtPath);
        return srtPath;
    } catch (err) {
        console.warn('[video] Subtitle download failed:', err.message);
        return null;
    }
}

function calcVideoBitrate(durationSec) {
    const targetBytes = 7.5 * 1024 * 1024;
    const totalKbps = Math.floor((targetBytes * 8) / 1000 / Math.max(durationSec, 30));
    const audioBitrate = 64;
    return Math.max(200, totalKbps - audioBitrate);
}

async function downloadFreeReelsEpisode(masterM3u8Url, subtitleUrl = null, durationSec = null) {
    const { lowestVideoUrl, audioUrl } = await parseFreeReelsMasterM3u8(masterM3u8Url);
    const tmpFile = path.join(os.tmpdir(), `fr_${Date.now()}.mp4`);
    let srtPath = null;

    console.log('[video] FreeReels video:', lowestVideoUrl.substring(0, 80));
    console.log('[video] FreeReels audio:', audioUrl?.substring(0, 80) || 'none');

    srtPath = await downloadSubtitle(subtitleUrl);

    let ffmpegArgs;

    if (srtPath) {
        const escapedSrt = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');
        const vidBitrate = durationSec ? calcVideoBitrate(durationSec) : 320;
        const maxBitrate = Math.floor(vidBitrate * 1.5);
        console.log('[video] Bitrate target:', vidBitrate, 'kbps (duration:', durationSec, 's)');

        const videoInput = [
            '-allowed_extensions', 'ALL',
            '-headers', FREEREELS_FFMPEG_HEADERS,
            '-i', lowestVideoUrl
        ];
        const audioInput = audioUrl ? [
            '-allowed_extensions', 'ALL',
            '-headers', FREEREELS_FFMPEG_HEADERS,
            '-i', audioUrl
        ] : [];

        ffmpegArgs = [
            '-y',
            ...videoInput,
            ...audioInput,
            '-map', '0:v:0',
            '-map', audioUrl ? '1:a:0' : '0:a:0',
            '-vf', `subtitles=${escapedSrt}:force_style='FontName=Arial,FontSize=13,PrimaryColour=&Hffffff,OutlineColour=&H000000,BackColour=&H80000000,Bold=1,Outline=2,Shadow=1,Alignment=2'`,
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-b:v', `${vidBitrate}k`,
            '-maxrate', `${maxBitrate}k`,
            '-bufsize', `${maxBitrate * 2}k`,
            '-c:a', 'aac',
            '-b:a', '64k',
            '-movflags', '+faststart',
            tmpFile
        ];
    } else if (audioUrl) {
        ffmpegArgs = [
            '-y',
            '-allowed_extensions', 'ALL',
            '-headers', FREEREELS_FFMPEG_HEADERS,
            '-i', lowestVideoUrl,
            '-allowed_extensions', 'ALL',
            '-headers', FREEREELS_FFMPEG_HEADERS,
            '-i', audioUrl,
            '-map', '0:v:0',
            '-map', '1:a:0',
            '-c', 'copy',
            '-movflags', '+faststart',
            tmpFile
        ];
    } else {
        ffmpegArgs = [
            '-y',
            '-allowed_extensions', 'ALL',
            '-headers', FREEREELS_FFMPEG_HEADERS,
            '-i', lowestVideoUrl,
            '-c', 'copy',
            '-movflags', '+faststart',
            tmpFile
        ];
    }

    try {
        await execFileAsync('ffmpeg', ffmpegArgs, { timeout: 180_000 });
    } finally {
        if (srtPath) { try { fs.unlinkSync(srtPath); } catch (_) {} }
    }

    const stat = fs.statSync(tmpFile);
    if (stat.size > MAX_SIZE_BYTES) {
        fs.unlinkSync(tmpFile);
        throw new Error(`File terlalu besar (${Math.round(stat.size / 1024 / 1024)}MB). Melebihi batas Discord 8MB.`);
    }

    return { filePath: tmpFile, sizeBytes: stat.size };
}

async function downloadReelShortEpisode(m3u8Url) {
    const tmpFile = path.join(os.tmpdir(), `rs_${Date.now()}.mp4`);
    console.log('[video] ReelShort m3u8:', m3u8Url.substring(0, 80));

    const ffmpegArgs = [
        '-y',
        '-allowed_extensions', 'ALL',
        '-i', m3u8Url,
        '-c', 'copy',
        '-movflags', '+faststart',
        tmpFile
    ];

    await execFileAsync('ffmpeg', ffmpegArgs, { timeout: 120_000 });

    const stat = fs.statSync(tmpFile);
    if (stat.size > MAX_SIZE_BYTES) {
        fs.unlinkSync(tmpFile);
        throw new Error(`File terlalu besar (${Math.round(stat.size / 1024 / 1024)}MB). Melebihi batas Discord 8MB.`);
    }

    return { filePath: tmpFile, sizeBytes: stat.size };
}

function cleanup(filePath) {
    try { fs.unlinkSync(filePath); } catch (_) {}
}

module.exports = { downloadFreeReelsEpisode, downloadReelShortEpisode, cleanup };
