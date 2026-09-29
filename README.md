# TimeShift 3D

Pengalaman dunia 3D realistis (Three.js) yang berubah mengikuti **waktu lokal** pengguna — pagi, siang, sunset, dan malam dalam **satu dunia 3D yang konsisten**, dengan transisi cinematic berbasis interpolasi.

## Struktur

```
timeshift-3d/
├── index.html
├── style.css
├── script.js
├── assets/
│   ├── models/
│   ├── textures/
│   └── audio/
└── README.md
```

## Fitur

- **Real-time clock** — jam lokal pengguna (HH:MM) dengan sapaan & periode (MORNING / DAY / SUNSET / NIGHT).
- **Mode waktu**: `AUTO TIME` (mengikuti jam asli) + preview manual MORNING / DAY / SUNSET / NIGHT.
- **Satu dunia 3D konsisten**: terrain prosedural (value-noise fbm), pegunungan dua-ridge (atmospheric perspective), danau, jalan setapak, pohon + semak instanced (sway angin via shader), batu, observatory modern dengan jendela emissive, lampu outdoor, awan yang bergerak, burung (siang), kunang-kunang (malam), bintang & bulan.
- **Transisi cinematic**: 12 keyframes lingkungan sepanjang 24 jam (posisi matahari, warna langit/fog/hemisphere, intensitas & warna cahaya, exposure, bintang, lampu, awan) diinterpolasi dengan smoothstep; jam environment di-damping mulus sehingga tidak ada pergantian scene yang tiba-tiba.
- **Kamera**: drag untuk melihat sekitar, scroll/pinch untuk zoom, cinematic drift halus saat idle.
- **Performa**: pixel ratio dibatasi, instancing, jumlah partikel menyesuaikan perangkat, adaptive quality (otomatis menurunkan shadow & pixel ratio jika FPS rendah), responsive.

## Menjalankan

Static-hosting friendly — tidak perlu build/backend:

```bash
# opsi 1: langsung buka index.html, atau
npx serve .
```

Deploy ke Vercel: drag-and-drop folder ini ke project static hosting mana pun.

## Catatan

- Three.js r128 dimuat dari CDN (cdnjs). Semua geometry, texture (canvas-generated), dan material bersifat prosedural — tidak ada dependensi asset eksternal.
- Prioritas visual: realistic lighting (ACES tone mapping, soft shadows, FogExp2) > atmosphere > UI minimal glassmorphism.
