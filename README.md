<p align="center">
  <img src="public/icon-256x256.png" alt="VideoScroll Logo" width="120" style="border-radius: 28px; box-shadow: 0 8px 24px rgba(0,0,0,0.18);" />
</p>

<h1 align="center">VideoScroll 📱✨</h1>
<p align="center">
  <b>مجتمع فيديو خاص بدعوات فقط، بأسلوب تيك توك، يُستضاف على جهازك في المنزل</b><br>
  <b>A private, invite-only, TikTok-style video community — hosted on your own PC</b>
</p>

<p align="center">
  <a href="https://osos3lom.github.io/videoscroll/" target="_blank"><img src="https://img.shields.io/badge/Live%20Demo-Visit%20Site-blue?style=for-the-badge&logo=google-chrome&logoColor=white" alt="Live Demo" /></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Vite-8-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/React-19.2-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React 19" />
  <img src="https://img.shields.io/badge/Go-backend-00ADD8?style=for-the-badge&logo=go&logoColor=white" alt="Go" />
  <img src="https://img.shields.io/badge/FFmpeg-pipeline-007808?style=for-the-badge&logo=ffmpeg&logoColor=white" alt="FFmpeg" />
</p>

<p align="center">
  <a href="docs/self-hosting.md"><b>📘 Self-hosting guide</b></a> •
  <a href="#-باللغة-العربية"><b>العربية</b></a> •
  <a href="#-in-english"><b>English</b></a> •
  <a href="#-لقطات-الشاشة--screenshots"><b>Screenshots</b></a>
</p>

---

## 📸 لقطات الشاشة / Screenshots

<table align="center" width="100%">
  <tr>
    <td align="center" width="25%" valign="top">
      <b>🎬 تغذية الفيديو (الرئيسية)<br>Main Video Feed</b><br/><br/>
      <img src="public/screenshots/feed.png" alt="Video Feed" width="100%"/>
    </td>
    <td align="center" width="25%" valign="top">
      <b>❤️ التفاعل والإعجابات<br>Likes & Interaction</b><br/><br/>
      <img src="public/screenshots/feed_active.png" alt="Likes and Actions" width="100%"/>
    </td>
    <td align="center" width="25%" valign="top">
      <b>🔖 المحفوظات وخيارات الرفع<br>Saved & Upload Options</b><br/><br/>
      <img src="public/screenshots/saved.png" alt="Saved & Uploads" width="100%"/>
    </td>
    <td align="center" width="25%" valign="top">
      <b>👤 الملف الشخصي<br>Profile</b><br/><br/>
      <img src="public/screenshots/profile.png" alt="Profile" width="100%"/>
    </td>
  </tr>
</table>

---

<div id="-باللغة-العربية" dir="rtl" align="right">

# 🇸🇦 باللغة العربية

## 💡 عن المشروع
**VideoScroll** مجتمع فيديو خاص لا يدخله إلا من يملك دعوة. الواجهة منشورة على GitHub Pages، أما الفيديوهات وواجهة البرمجة فتعمل على جهاز قديم في منزلك (4 أنوية، ذاكرة 4 جيجابايت، قرص صلب 1 تيرابايت) عبر اتصال الألياف.

## 🌟 أبرز المميزات
* **🔒 خاص بالكامل:** كل طلب وكل بايت فيديو يتطلب تسجيل الدخول، والانضمام يتم عبر روابط دعوة لمرة واحدة.
* **👥 أدوار:** مالك، ورافع فيديو، ومشاهد. تغيير الدور أو تعطيل الحساب يُنهي جلساته فوراً على كل الأجهزة.
* **🎞️ الفيديو كما هو:** لا تصغير للدقة ولا إعادة ترميز للمقاطع المتوافقة. يُعاد تغليف الملف فقط عند الحاجة لتشغيل أسرع.
* **📤 رفع قابل للاستئناف:** الرفع على أجزاء بحجم 8 ميجابايت، ويستكمل من حيث توقف إذا انقطع الاتصال.
* **⚡ تشغيل فوري:** يحمّل التطبيق أول ثوانٍ من الفيديوهات التالية مسبقاً في IndexedDB، ويقدمها Service Worker عند التمرير.
* **🪶 خفيف:** ملف تنفيذي واحد بلغة Go، بلا قاعدة بيانات أو خدمات إضافية.

## 🚀 البدء
راجع **[دليل الاستضافة الذاتية](docs/self-hosting.md)** (بالإنجليزية) للخطوات الكاملة: فحص الشبكة، والتثبيت، وHTTPS، ودعوة الأعضاء.

</div>

---

<div id="-in-english" dir="ltr" align="left">

# 🇬🇧 In English

## 💡 About
**VideoScroll** is a private, invite-only video community. The frontend is
published on GitHub Pages. The videos and the API run on an old Linux PC at
home (4 cores, 4 GB RAM, 1 TB HDD) over a residential fibre line.

Without a configured server, the [live demo](https://osos3lom.github.io/videoscroll/)
plays three bundled clips with no sign-in.

## 🌟 Key Features
* **🔒 Private by default:** every API route and every video byte requires
  sign-in. People join through single-use invite links.
* **👥 Roles:** owner, uploader, viewer. Changing a role or disabling an account
  signs that person out everywhere, immediately.
* **🎞️ Videos kept as-is:** no downscaling, and compatible streams are never
  re-encoded. ffmpeg only fixes the container (faststart) when needed, and
  fully transcodes only codecs no browser can play.
* **📤 Resumable uploads:** 8 MiB chunks. A dropped connection or a closed tab
  resumes from the last byte.
* **⚡ Instant swipes:** the opening seconds of the next videos are prefetched
  into IndexedDB and served by a service worker. The cache is temporary,
  capped, and wiped on sign-out.
* **🪶 Lightweight:** one static Go binary with byte-range streaming via
  `sendfile`. No database, no Node.js on the server.

## 🛠️ Architecture

| Piece | Technology |
| :--- | :--- |
| Frontend | Vite 8, React 19, TypeScript, SWR, CSS Modules — hosted on GitHub Pages |
| Browser caching | IndexedDB chunk store + service worker |
| Backend | Go (stdlib `net/http`, argon2id, `os.Root`), single binary |
| Media pipeline | ffprobe + ffmpeg, one job at a time, persistent queue |
| Edge | Caddy (TLS) — or Tailscale / Cloudflare Tunnel behind CGNAT |

The full diagram and data flow are in [docs/self-hosting.md](docs/self-hosting.md#architecture).

## 🚀 Getting Started

**Deploying for real:** follow [docs/self-hosting.md](docs/self-hosting.md).
Start with the network check.

**Local development** (Node 20.19+, Go, ffmpeg on `PATH`):

```bash
npm install
cp .env.example .env.server     # set MEDIA_DIR=media, ALLOWED_ORIGINS=http://localhost:5173
npm run cli -- create-owner <username>
npm run cli -- import videos/clip1.mp4 videos/clip2.mp4 videos/clip3.mp4
npm run dev:server              # Go API on :3000
npm run dev                     # UI on :5173
```

</div>

---

## 📂 هيكل المشروع / Project Structure

```text
videoscroll/
├── index.html            # App shell
├── vite.config.mts       # Manifest, CSP, demo clips, service worker build
├── src/                  # React SPA (browser only)
│   ├── App.tsx           # Auth gate + routes
│   ├── routes/           # feed, likes, saved, profile, login, join, admin
│   ├── lib/              # apiUrl, session, uploader, mediaCache/
│   ├── sw/sw.ts          # Service worker: serves cached video ranges
│   └── hooks/            # useVideos, useSession, usePrefetch, …
├── server/               # Go backend (one binary)
│   ├── cmd/videoscroll/  # serve + owner CLI
│   └── internal/         # auth, users, media, probe, process, jobs, httpapi
├── deploy/               # Caddyfile, systemd unit, install.sh, DuckDNS timer
├── docs/self-hosting.md  # Setup & operations guide
└── videos/               # The three demo clips
```

## 📜 الأوامر المتاحة / Available Scripts

| الأمر / Command | الوصف / Description |
| :--- | :--- |
| `npm run dev` | واجهة Vite على المنفذ 5173 / Vite UI on port 5173 |
| `npm run dev:server` | خادم Go على المنفذ 3000 / Go API on port 3000 |
| `npm run cli -- <cmd>` | أوامر الإدارة / Owner CLI (`create-owner`, `invite`, `doctor`, …) |
| `npm run build:pages` | بناء الواجهة إلى dist/ / Build the Pages bundle |
| `npm run build:server:linux` | بناء الخادم للينكس / Static linux/amd64 binary |
| `npm run test:server` | اختبارات الخادم / Go vet + tests |
| `npm run typecheck` | التحقق من الأنواع / Typecheck |
| `npm run lint` | فحص الكود / ESLint |

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/osos3lom"><b>osos3lom</b></a>
</p>
