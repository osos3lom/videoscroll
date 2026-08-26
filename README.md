<p align="center">
  <img src="public/icon-256x256.png" alt="Local Video Scroller Logo" width="128" style="border-radius: 24px;" />
</p>

<div dir="rtl" align="right">

# مستعرض مقاطع الفيديو القصيرة (شبيه تيك توك / ريلز) - محلي بالكامل 📱

تطبيق ويب حديث ومتجاوب مستوحى من منصة تيك توك (TikTok) وإنستغرام ريلز (Instagram Reels)، مصمم للعمل **محلياً بالكامل (Offline/Local 100%)** دون الحاجة إلى أي اتصالات خارجية أو مفاتيح برمجية (API Keys). يتيح لك التطبيق تصفح مقاطع الفيديو الخاصة بك، وإبداء الإعجاب بها، وحفظها، ورفع مقاطع جديدة مباشرة من جهازك، مع دعم كامل لتطبيق الويب التقدمي (PWA) للعمل دون اتصال بالإنترنت.

---

### 🚀 المميزات الرئيسية:
- **تغذية ملء الشاشة مع التمرير العمودي (Vertical Scroll):** تجربة تصفح سلسة وسريعة لمقاطع الفيديو القصيرة تدعم السحب والتمرير.
- **تفاعل محلي بالكامل:** إمكانية تسجيل الإعجابات وحفظ مقاطع الفيديو المفضلة (Bookmarks) محلياً عبر قاعدة بيانات ملفات مبسطة (`data/social.json`).
- **رفع مقاطع الفيديو:** واجهة تفاعلية لرفع مقاطع الفيديو من الاستوديو، أو تصوير فيديو مباشر، أو اختيار ملف من جهازك وحفظه مباشرة في المجلد المحلي.
- **ملف شخصي متكامل:** يعرض إحصائيات منشئ المحتوى (عدد المقاطع، إجمالي الإعجابات، إجمالي المحفوظات) مع شبكة لعرض مقاطع الفيديو المرفوعة.
- **تطبيق ويب تقدمي (PWA) مدعوم بـ Serwist:** تثبيت التطبيق على الهواتف والأجهزة الذكية وتصفحه كأنه تطبيق محلي وسريع الاستجابة.
- **دعم ميزات بث الفيديو المتقدمة:** تشغيل الفيديوهات مع دعم البحث (Seeking) والتحميل التدريجي للملفات (HTTP Range Requests).

---

### 🛠️ التقنيات المستخدمة:
- **Next.js 16 (React 19)** - لإعداد واجهات المستخدم وتوجيه الصفحات والـ APIs المحلية.
- **TypeScript** - لضمان سلامة الأكواد والأنماط البرمجية.
- **Serwist/Next** - لتهيئة خدمات PWA وإدارة التخزين المؤقت المتقدم.
- **CSS Modules** - لتنسيق الواجهات بشكل أنيق ومتناسق ويدعم الهواتف.

---

### 💻 متطلبات التشغيل والبدء:

#### 1. استنساخ المشروع وتثبيت الحزم:
```bash
git clone <رابط-المستودع>
cd videoscroll
npm install
```

#### 2. إضافة مقاطع الفيديو الخاصة بك:
قم بنسخ أي مقاطع فيديو ترغب في عرضها (يفضل صيغة `.mp4` بترميز H.264 وصوت AAC لضمان التوافق مع المتصفحات) إلى المجلد التالي في جذر المشروع:
```
videos/
```
*ملاحظة: يمكنك تسمية الملفات بأرقام مثل (`01-video.mp4`, `02-video.mp4`) للتحكم في ترتيب ظهورها بالتغذية.*

#### 3. تشغيل خادم التطوير:
```bash
npm run dev
```
افتح الرابط التالي في المتصفح الخاص بك: [http://localhost:3000](http://localhost:3000)

</div>

---

<div dir="ltr" align="left">

# Local Short Video Scroll (TikTok / Reels Clone) - 100% Offline/Local 📱

A modern, responsive web application inspired by TikTok and Instagram Reels, designed to run **100% locally and offline**. It has zero external dependencies, no API keys required, and operates purely using your local disk storage. Browse your videos, like, bookmark, and upload new media directly from your device.

---

### 🚀 Key Features:
- **Vertical Fullscreen Video Feed:** A smooth, immersive vertical scrolling experience optimized for gesture/scroll swipe navigation.
- **100% Local Interaction:** Like and save/bookmark videos offline. All state is managed locally via a simplified JSON database (`data/social.json`).
- **Direct Local Uploads:** Upload media from your Photo Library, take a live video using your device camera, or select a file to save directly into the local `videos/` folder.
- **Creator Dashboard / Profile:** Displays real-time creator statistics (number of videos, total likes, and total saves) along with a grid of all uploaded local videos.
- **Progressive Web App (PWA) via Serwist:** Easily install the app on mobile and desktop platforms with offline caching support.
- **Advanced Streaming Support:** Smooth video playback using HTTP range requests to allow quick seeking and scrub-to-play.

---

### 🛠️ Tech Stack:
- **Next.js 16 (React 19)** - App layout, server APIs, and server-side rendering/routing.
- **TypeScript** - Type safety and structured patterns.
- **Serwist/Next** - PWA service worker and custom offline caching strategies.
- **CSS Modules** - Clean, scoped styling optimized for mobile viewports.

---

### 💻 Getting Started:

#### 1. Clone the repository and install dependencies:
```bash
git clone <repository-url>
cd videoscroll
npm install
```

#### 2. Drop your video clips:
Copy any video files you want to browse into the following folder at the root of the project:
```
videos/
```
*Tip: `.mp4` (H.264 + AAC) is highly recommended for cross-browser compatibility. You can prefix files with numbers (e.g., `01-clip.mp4`, `02-clip.mp4`) to control the feed order.*

#### 3. Run the development server:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser to start playing!

</div>

---

<h2 align="center">📸 لقطات الشاشة / Screenshots</h2>

<table align="center">
  <tr>
    <td align="center" width="24%" valign="top">
      <b>تغذية الفيديو (الرئيسية)<br>Main Video Feed</b><br/><br/>
      <img src="public/screenshots/feed.png" alt="Video Feed" width="100%"/>
    </td>
    <td align="center" width="24%" valign="top">
      <b>الإعجابات والتفاعل<br>Likes & Interaction</b><br/><br/>
      <img src="public/screenshots/feed_active.png" alt="Likes and Actions" width="100%"/>
    </td>
    <td align="center" width="24%" valign="top">
      <b>المحفوظات وخيارات الرفع<br>Saved & Upload Options</b><br/><br/>
      <img src="public/screenshots/saved.png" alt="Saved & Uploads" width="100%"/>
    </td>
    <td align="center" width="24%" valign="top">
      <b>الملف الشخصي للمنشئ<br>Creator Profile</b><br/><br/>
      <img src="public/screenshots/profile.png" alt="Creator Profile" width="100%"/>
    </td>
  </tr>
</table>
