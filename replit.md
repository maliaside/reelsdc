# Discord Bot - FreeReels

Bot Discord yang mengambil konten dari API Sansekai (FreeReels) dengan slash commands. Video episode langsung diunduh dan dikirim sebagai file mp4 ke Discord.

## Struktur Project

```
index.js                  # Entry point - Discord bot + web server
src/
  api/
    freereels.js          # Wrapper untuk API Sansekai FreeReels
  commands/
    freereels.js          # Slash command /freereels
  video.js                # Download HLS episode ke mp4 via ffmpeg
  webserver.js            # Express server port 5000 (health check)
  player.html             # Fallback web player (hls.js)
  deploy-commands.js      # Daftarkan slash commands ke Discord
package.json
```

## Slash Commands

| Command | Deskripsi |
|---------|-----------|
| `/freereels foryou [offset]` | Daftar drama For You (dengan navigasi + tombol detail) |
| `/freereels homepage` | Drama dari halaman utama FreeReels |
| `/freereels anime` | Daftar anime FreeReels |
| `/freereels cari <judul>` | Cari drama berdasarkan kata kunci (filter lokal dari foryou) |
| `/freereels detail <key>` | Detail drama berdasarkan KEY |

## Alur Menonton

1. `/freereels foryou` → kartu drama + tombol **📋 Detail & Tonton**
2. Klik tombol → detail drama + dropdown pilih episode
3. Pilih episode → bot download mp4 via ffmpeg (~10-30 detik) → kirim langsung di Discord
4. Video langsung bisa diputar di Discord (Dubbing Indonesia, rata-rata ~3-5MB per episode)

## API

Menggunakan https://api.sansekai.my.id/api dengan endpoint:
- `/freereels/foryou`
- `/freereels/homepage`
- `/freereels/animepage`
- `/freereels/search` (broken di sisi API, diganti filter lokal)
- `/freereels/detailAndAllEpisode`

Video: HLS stream dari mydramawave.com, diunduh via ffmpeg dengan header Referer yang benar.

## Environment Variables / Secrets

- `DISCORD_BOT_TOKEN` - Token bot dari Discord Developer Portal
- `DISCORD_APPLICATION_ID` - Application ID dari Discord Developer Portal

## Menjalankan

```bash
node index.js                 # Jalankan bot + web server
node src/deploy-commands.js   # Daftarkan ulang slash commands
```

## Stack

- Node.js 20
- discord.js v14
- express (port 5000)
- axios
- ffmpeg (system dependency)
