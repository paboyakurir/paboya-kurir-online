# PABOYA KURIR — Render Ready

Paket ini menjalankan **Pelanggan + Kurir + Admin + API + PostgreSQL + Socket.IO** dari satu service Render.

## URL setelah deploy
- `/` — menu utama
- `/pelanggan/` — aplikasi pelanggan
- `/kurir/` — aplikasi kurir
- `/admin/` — dashboard admin
- `/api/health` — cek server

## Tarif
- Rp3.500/km
- JASTIP Rp2.000/titik
- WhatsApp admin: 0821 9088 5988

## Deploy paling mudah dari HP Android
1. Buat akun GitHub dan Render.
2. Buat repository baru di GitHub, misalnya `paboya-kurir`.
3. Upload seluruh isi folder paket ini ke repository (bukan file ZIP-nya).
4. Di Render pilih **New → Blueprint** dan hubungkan repository.
5. Render membaca `render.yaml`, membuat Web Service + PostgreSQL.
6. Saat diminta `GOOGLE_MAPS_API_KEY`, masukkan API key Google Maps Anda.
7. Klik deploy. Tunggu sampai status **Live**.
8. Buka URL Render, misalnya `https://paboya-kurir.onrender.com`.

## Cara mendapatkan ADMIN_KEY
Render → service `paboya-kurir` → **Environment** → cari `ADMIN_KEY` → Reveal/Copy. Masukkan kunci itu di `/admin/`.

## Google Maps
Di Google Cloud buat project → aktifkan billing → aktifkan **Routes API**. Jika ingin Places/Maps JavaScript juga, aktifkan API yang diperlukan. Buat API key dan masukkan ke Environment Render sebagai `GOOGLE_MAPS_API_KEY`.

## Catatan
Versi ini memakai guest login untuk pelanggan/kurir (nama + nomor). Untuk produksi lebih lanjut disarankan OTP WhatsApp/SMS, pembatasan API key Google, pembayaran, audit log, dan domain sendiri.
