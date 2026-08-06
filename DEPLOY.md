# 🚀 部署指南

3 分钟把网站上线，三种方式选一个。

---

## 方式 1：GitHub Pages（免费 + 永久 + 自定义域名）

### Step 1：解压 zip
```bash
unzip npc-collector.zip
cd npc-collector
```

### Step 2：创建 GitHub repo
1. 打开 <https://github.com/new>
2. 填名字：`npc-collector`
3. 选 **Public**（免费 Pages 必须）
4. **什么都不要勾**（不要 README / .gitignore / License，我们自己有）
5. 点 **Create repository**

### Step 3：上传代码
复制 GitHub 给你那行命令，**但要把分支名改成 `main`**，类似这样：

```bash
git init
git add .
git commit -m "🎉 Initial commit"
git branch -M main
git remote add origin https://github.com/<你的用户名>/npc-collector.git
git push -u origin main
```

> 提示：第一次 push 会让你登录 GitHub。用户是 GitHub 用户名，密码用 **Personal Access Token**（不是账号密码）：
> 1. 去 <https://github.com/settings/tokens> 生成一个，选 `repo` 权限
> 2. 复制 token 粘到终端当密码用

### Step 4：开启 Pages
1. 进你的 repo → **Settings** → 左边点 **Pages**
2. Source 选 **Deploy from a branch**
3. Branch 选 `main` / `(root)`
4. 点 **Save**

等 30 秒～1 分钟，访问：
```
https://<你的用户名>.github.io/npc-collector/
```

看到首页 = 部署成功 🎉

### Step 5（可选）：用自己的域名
在 Pages 设置里填你的域名（如 `npc.example.com`），按提示去你的 DNS 服务商加 CNAME 记录即可。GitHub 自动签发 HTTPS 证书。

---

## 方式 2：本地电脑跑（最简单）

```bash
unzip npc-collector.zip
cd npc-collector
python3 -m http.server 8000
# 或 ./start.sh
```

打开 <http://localhost:8000/>

只在这台电脑和这个浏览器用，无法分享给别人。

---

## 方式 3：Vercel / Netlify（拖拽即部署）

### Vercel
1. 去 <https://vercel.com/new> 用 GitHub 登录
2. 点 **Import Git Repository** → 选你的 `npc-collector` repo
3. **Framework Preset** 选 `Other`
4. 点 **Deploy** → 30 秒拿到 `xxx.vercel.app` 链接

### Netlify
1. 去 <https://app.netlify.com/drop>
2. **直接把解压出来的 `npc-collector` 文件夹拖进去**（不需要 git）
3. 30 秒拿到 `xxx.netlify.app` 链接

---

## 🔄 以后更新代码

```bash
cd npc-collector
# 改完代码后：
git add .
git commit -m "描述你改了什么"
git push
# Vercel / Netlify / GitHub Pages 会自动重新部署
```

Vercel/Netlify 还支持**预览环境**：每个 PR 自动生成独立链接。

---

## 🐛 部署后遇到问题？

| 症状 | 原因 | 解法 |
|------|------|------|
| 打开是空白 | 路径错了 | Pages 设置里 Branch 必须是 `main` / root |
| 卡牌没显示 | 浏览器太老 | 用 Chrome / Safari / Edge 最新版 |
| 声音不响 | 没点过页面 | 浏览器规定必须先点一下页面才能放声（自动） |
| 看到旧版本 | 缓存 | `Ctrl+Shift+R` 强刷 |
| 数据没保存 | 用了无痕模式 | 改用普通模式 |

---

## 📦 这个项目里的文件

```
npc-collector.zip
├── index.html              ← 入口
├── styles.css              ← 样式
├── script.js               ← 全部逻辑（2800+ 行）
├── README.md               ← 项目说明
├── DEPLOY.md               ← 你正在看的
├── .gitignore
├── start.sh                ← 本地启动脚本
└── assets/
    ├── world-map.svg       ← 地图（97 KB）
    ├── style-reference.jpg ← 参考图
    └── sample-*.png        ← 示例图（不需要可以删）
```

整个项目就这 11 个文件，3.3M。**没有任何后端**、**没有任何 npm 依赖**。
