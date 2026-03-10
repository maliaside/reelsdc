# NGEDRACIN Bot — Discord Bot 24/7

Bot Discord 24/7 untuk menonton drama dari 3 platform: FreeReels, ReelShort, dan Melolo. Satu command `/drama` dengan subcommand. Video <8MB dikirim langsung ke Discord; lebih besar → stream link.

## Struktur Project

```
index.js                    # Entry point: Discord client + keepalive interval
src/
  api/
    freereels.js            # Wrapper API FreeReels (foryou, search, detail)
    reelshort.js            # Wrapper API ReelShort (foryou, search, detail, episode)
    melolo.js               # Wrapper API Melolo (forYou, search, detail, stream)
  commands/
    drama.js                # Satu-satunya slash command: /drama
  stats.js                  # In-memory stats tracker (uptime, counts, activity log)
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
| `/drama cari <judul>` | Cari drama di semua 3 platform sekaligus |
| `/drama foryou [offset]` | FreeReels For You |
| `/drama reelshort [offset]` | ReelShort For You |
| `/drama melolo` | Melolo For You |

## Alur Menonton

1. User pakai salah satu subcommand → daftar drama embed dengan tombol navigasi
2. Klik **📋 Detail & Tonton** → detail + dropdown pilih episode
3. Pilih episode → quality picker: 📱 360p Discord / 📺 720p Discord / 🌐 Browser
4. Bot encode + kirim mp4 ke Discord (ephemeral), atau beri stream link jika >8MB

## Platform Details

### FreeReels
- Video: HLS (fMP4/CMAF) dari mydramawave.com; butuh Referer/Origin header
- Audio Mandarin + subtitle Indonesia (SRT, diburn via ffmpeg libass)
- Encode: scale=360p, target <7MB

### ReelShort
- Video: HLS (TS segments); tidak butuh auth headers
- Audio embedded dalam TS
- Kualitas: 360p / 720p / streaming

### Melolo
- Video: MP4 langsung dari TikTok CDN (CORS terbuka)
- Cover HEIC dikonversi via wsrv.nl proxy → JPEG
- Pre-check source size (>50MB → langsung streaming)
- Encode: `-threads 1` untuk cegah OOM crash

## Web Routes

| Route | Deskripsi |
|-------|-----------|
| `/dashboard` | Monitoring dashboard (uptime, stats, aktivitas) |
| `/api/stats` | JSON stats API untuk dashboard |
| `/player` | Web player (HLS + MP4) |
| `/proxy/m3u8` | M3U8 proxy (FreeReels, dengan auth headers) |
| `/proxy/seg` | Segment proxy (FreeReels) |
| `/proxy/direct` | M3U8 proxy (ReelShort, tanpa auth) |
| `/proxy/dirseg` | Segment proxy (ReelShort) |
| `/health` | Health check |

## Deployment

- Target: **VM** (always-on 24/7)
- Port 5000: web server utama
- Port 3000: Replit deployment health check (first localPort in `.replit`)
- Keepalive: `setInterval(() => {}, 30000)` di index.js untuk cegah process exit

## Environment Variables

- `DISCORD_BOT_TOKEN` — Token bot Discord
- `DISCORD_APPLICATION_ID` — Application ID Discord
- `SESSION_SECRET` — Session secret (web)
- `BOT_BASE_URL` — (opsional) Override base URL untuk player/proxy links

## Stack

- Node.js 20
- discord.js v14
- express (port 5000 + 3000)
- axios
- ffmpeg dengan libass (system package)
