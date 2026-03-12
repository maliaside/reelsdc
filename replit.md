# NGEDRACIN Bot — Discord Bot 24/7

Bot Discord 24/7 untuk menonton drama/film dari 5 platform: FreeReels, ReelShort, Melolo, MovieBox, dan NetShort. Satu command `/drama` dengan subcommand. Video <8MB dikirim langsung ke Discord; lebih besar → browser stream link.

## Struktur Project

```
index.js                    # Entry point: Discord client + keepalive interval
src/
  api/
    client.js               # axios tanpa proxy; rate limiter 1s antar sansekai calls; auto-retry 429
    freereels.js            # Wrapper API FreeReels (foryou, homepage, animepage, detail)
    reelshort.js            # Wrapper API ReelShort (foryou, search, detail, episode)
    melolo.js               # Wrapper API Melolo (forYou, search, detail, stream)
    netshort.js             # Wrapper API NetShort (forYou, search → link ke netshort.com)
    moviebox.js             # Wrapper API MovieBox (trending, search, detail, sources)
  commands/
    drama.js                # Satu-satunya slash command: /drama
  stats.js                  # In-memory stats tracker (uptime, counts per platform, activity)
  video.js                  # Download + encode video via ffmpeg (HLS → mp4)
  webserver.js              # Express server port 5000 + 3000 (health check)
  player.html               # Web player fallback (hls.js + MP4)
  dashboard.html            # Monitoring dashboard (auto-refresh 10 detik)
  deploy-commands.js        # Daftarkan slash commands ke Discord
package.json
```

## Slash Commands

| Command | Deskripsi |
|---------|-----------|
| `/drama cari <judul>` | Cari drama di semua platform sekaligus |
| `/drama foryou [offset]` | FreeReels For You |
| `/drama reelshort [offset]` | ReelShort For You |
| `/drama melolo` | Melolo For You |
| `/drama moviebox [page]` | MovieBox Trending |
| `/drama netshort` | NetShort For You |

## Alur Menonton

1. User pakai `/drama cari <judul>` → pencarian paralel di semua 5 platform
2. Jika ada hasil dari Dracin (FreeReels, ReelShort, Melolo, NetShort) DAN MovieBox → tombol kategori: 📱 Dracin / 🎬 Movie/Serial
3. Exact title match diurutkan paling atas
4. Klik **📋 Detail & Tonton** → detail + dropdown pilih episode
5. Pilih episode → quality picker: 📱 360p Discord / 📺 720p Discord / 🌐 Browser
6. Bot encode + kirim mp4 ke Discord (ephemeral), atau beri stream link jika >8MB / episode >150s
7. NetShort: link langsung ke netshort.com (tanpa download/stream endpoint)

## Platform Details

### FreeReels
- Video: HLS (fMP4/CMAF) dari mydramawave.com; butuh Referer/Origin header
- Audio Mandarin + subtitle Indonesia (SRT, diburn via ffmpeg libass)
- Encode: scale=360p, target bitrate = ~7MB / durasi
- Durasi > 150s → stream fallback otomatis

### ReelShort
- Video: HLS (TS segments); tidak butuh auth headers
- Audio embedded dalam TS
- Kualitas: 360p / 720p / streaming
- Durasi > 150s → stream fallback otomatis

### Melolo
- Video: MP4 langsung dari TikTok CDN (CORS terbuka)
- Cover HEIC dikonversi via wsrv.nl proxy → JPEG
- Jika source < 8MB → kirim LANGSUNG tanpa encode (kualitas asli, super cepat)
- Jika source > 8MB dan dur <= 150s → re-encode ke target bitrate
- Jika dur > 150s → stream fallback otomatis

### NetShort
- API: sansekai.my.id/api/netshort (foryou + search saja, tanpa detail/stream endpoint)
- Playback: link langsung ke netshort.com/id/drama/{libraryId}
- Cover webp dikonversi via wsrv.nl → JPEG
- Termasuk kategori "Dracin" di pencarian

### MovieBox
- Video: MP4 dari bcdnxw.hakunaymatata.com (CDN blocks server IP, OK dari browser user)
- `/resolve/mb` endpoint: fetch fresh CDN URL dari sansekai, kembalikan ke player di browser user
- Player di browser user stream langsung dari CDN

## Video Compression Logic

```
MAX_ENCODE_DUR = 150s (lebih panjang → stream fallback langsung)
MAX_BYTES = 8MB (Discord limit)
targetBitrate(dur, quality) = min(7MB*8/dur - 64kbps_audio, max_quality)
encodeTimeout(dur) = max(dur * 4, 90) seconds
```

## Web Routes

| Route | Deskripsi |
|-------|-----------|
| `/dashboard` | Monitoring dashboard (uptime, stats, aktivitas) |
| `/api/stats` | JSON stats API untuk dashboard |
| `/api/bot/status` | Bot status (online/offline, guild count, dll) |
| `/player` | Web player (HLS + MP4) |
| `/proxy/m3u8` | M3U8 proxy (FreeReels, dengan auth headers) |
| `/proxy/seg` | Segment proxy (FreeReels) |
| `/proxy/direct` | M3U8 proxy (ReelShort, tanpa auth) |
| `/proxy/dirseg` | Segment proxy (ReelShort) |
| `/resolve/mb` | Resolve fresh MovieBox CDN URL |
| `/health` | Health check |

## Deployment

- Target: **VM** (always-on 24/7)
- Port 5000: web server utama
- Port 3000: Replit deployment health check (first localPort in `.replit`)
- Keepalive: `setInterval(() => {}, 30000)` di index.js untuk cegah process exit
- **JANGAN deploy sebelum semua platform diverifikasi bekerja**

## Environment Variables

- `DISCORD_BOT_TOKEN` — Token bot Discord
- `DISCORD_APPLICATION_ID` — Application ID Discord
- `SESSION_SECRET` — Session secret (web)
- `BOT_BASE_URL` — (opsional) Override base URL untuk player/proxy links

## Stack

- Node.js 20
- discord.js v14
- express (port 5000 + 3000)
- axios (tanpa proxy, direct access ke sansekai.my.id)
- ffmpeg dengan libass (system package)
