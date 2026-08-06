# 🌌 NPCatcher · 万物皆可收集

> 为每一个与你擦肩而过的灵魂，留一张永恒的卡牌。

A purely-local, zero-backend web app for collecting the people you meet. Upload a photo + a few details, get a beautiful flip-card with a stylized portrait on the front and the real photo + your story on the back. Everything lives in your browser.

![preview](https://h6cz7chj8d0bv.space.mcode.cn/)

---

## ✨ Features

- 📸 **Upload a photo + story** → instant flip-card
- 🎨 **5 collage styles** (magazine / street / torn / newspaper / y2k) with real person-outline extraction
- 🎨 **Pick your card color** (gold / silver / purple / blue / auto)
- 🔍 **Click card → focus mode** with blurred background + zoom-in
- 🔊 **Romantic procedural SFX** (Web Audio API, no audio files)
- 🌌 **Cosmic multiverse video backgrounds** on every modal
- 🗺️ **Interactive world map** with country→city drill-down
- 👤 **Multi-account** (per-user data isolation)
- 💾 **Data safety net**: IndexedDB + localStorage mirror + JSON export/import + sync code
- ⚠️ **First-visit backup onboarding** + auto-remind after 3 saves

---

## 🚀 Run locally

```bash
cd npc-collector
python3 -m http.server 8000
# or
./start.sh
```

Open <http://localhost:8000/>. No build step, no dependencies.

---

## 🌐 Deploy to GitHub Pages (free, permanent)

This site is 100% static HTML/CSS/JS. GitHub Pages is the cheapest forever-home.

### 1. Create a GitHub repo

Go to <https://github.com/new>:
- **Name**: `npc-collector` (or anything you like)
- **Public** (required for free GitHub Pages)
- Do NOT initialize with README / .gitignore (we have them)

### 2. Push this folder

```bash
cd npc-collector
git init                                   # only first time
git add .
git commit -m "🎉 Initial commit"
git branch -M main
git remote add origin https://github.com/<YOUR_USERNAME>/npc-collector.git
git push -u origin main
```

If you use SSH:
```bash
git remote add origin git@github.com:<YOUR_USERNAME>/npc-collector.git
```

### 3. Enable GitHub Pages

Repo → **Settings** → **Pages**:
- **Source**: `Deploy from a branch`
- **Branch**: `main` / `(root)`
- Click **Save**

Wait ~30s, then your site is live at:
**`https://<YOUR_USERNAME>.github.io/npc-collector/`**

### 4. (Optional) Custom domain

In the same Pages settings, add your domain (e.g. `npc.example.com`) and follow the DNS instructions. GitHub will auto-issue a Let's Encrypt cert.

---

## 💾 Data storage — read this first

**All your data lives in your browser only.** The site has no backend.

- ✅ **Safe from**: server downtime, company shutdown, account bans
- ⚠️ **At risk from**:
  - Clearing browser cache / cookies / site data
  - Switching browsers (Chrome → Safari)
  - Switching computers / OS reinstall
  - Using private/incognito mode
  - The deployment link going 404

**Built-in protection:**
- Backup status badge on the toolbar (`未备份` vs `刚刚已备份`)
- First-visit onboarding explaining the above
- Auto-reminder after 3 unsaved cards
- JSON export (full backup, ~3-10 MB)
- Sync code (base64 of compressed data, copy-paste between devices)

**Recommended habit:** every couple of weeks, click `数据` → `导出 JSON` and save the file to iCloud / 微信收藏 / email draft. If you ever lose the data, click `导入 JSON` to restore.

---

## 📁 Project structure

```
npc-collector/
├── index.html              # Page structure + all modals
├── styles.css              # Mindloop-inspired dark monochrome + starfield
├── script.js               # All logic: storage, cards, collage, SFX, focus mode
├── assets/
│   ├── world-map.svg       # Interactive map (950×620 Wikipedia SVG)
│   ├── style-reference.jpg # Reference photo
│   └── sample-*.png        # Sample card art
├── start.sh                # Convenience local-server script
└── README.md
```

---

## 🛠️ Tech stack

- **Vanilla JS** (no framework, no build step)
- **Canvas API** for collage generation
- **Web Audio API** for procedural SFX
- **IndexedDB** + **localStorage** for persistence
- **Pinterest CDN** for multiverse video backgrounds (cached client-side)

No npm, no webpack, no React. Just open `index.html` and it works.

---

## 📜 License

MIT — fork, modify, deploy wherever you want.
