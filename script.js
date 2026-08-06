/* =========================================
   万物皆可收集 · NPC 收集器
   v18 · Account + 持久化加固
========================================= */

const DB_NAME = "npc-collector";
const DB_STORE = "images";
const META_STORE = "npcs";
const DB_VERSION = 3;
const META_KEY = "npc:list";
const LS_CURRENT_USER = "npcatcher:currentUser";
const LS_USERS = "npcatcher:users";

/* ---------- 当前用户（账号） ---------- */
function getCurrentUser() {
  try { return localStorage.getItem(LS_CURRENT_USER) || "default"; }
  catch { return "default"; }
}
function setCurrentUser(name) {
  const u = (name || "default").trim() || "default";
  try {
    localStorage.setItem(LS_CURRENT_USER, u);
    // 把用户名加入已知用户列表
    const known = JSON.parse(localStorage.getItem(LS_USERS) || "[]");
    if (!known.includes(u)) {
      known.push(u);
      localStorage.setItem(LS_USERS, JSON.stringify(known));
    }
  } catch {}
  return u;
}
function listKnownUsers() {
  try {
    const arr = JSON.parse(localStorage.getItem(LS_USERS) || "[]");
    // 兜底：当前用户如果在 IDB 中有数据但不在 known 里，也加进来
    const cur = getCurrentUser();
    if (cur && !arr.includes(cur)) arr.push(cur);
    return arr;
  } catch { return []; }
}
function perUserKey(base) {
  // default 用户保留原 key，向后兼容 v17 及之前的数据
  const u = getCurrentUser();
  if (u === "default") return base;
  return u + "::" + base;
}

/* ---------- IndexedDB helpers ---------- */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
      // v3: 升级时不强删,保留老数据(老 META_KEY = "npc:list" 仍是 default 用户的)
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function dbPut(key, blob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function dbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readonly");
    const req = tx.objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
async function dbDelete(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ---------- localStorage 备份（仅元数据） ---------- */
function lsMetaKey() { return "npcatcher:" + getCurrentUser() + ":meta"; }
function lsMirrorSave(list) {
  try {
    // 去掉 blob 引用,只保存元数据
    const metaOnly = list.map(it => ({ ...it }));
    localStorage.setItem(lsMetaKey(), JSON.stringify({ ts: Date.now(), list: metaOnly }));
  } catch (e) {
    console.warn("localStorage mirror failed (quota?)", e);
  }
}
function lsMirrorLoad() {
  try {
    const raw = localStorage.getItem(lsMetaKey());
    if (!raw) return null;
    const { ts, list } = JSON.parse(raw);
    return { ts, list: list || [] };
  } catch { return null; }
}

/* ---------- 元数据（IDB 优先，localStorage 兜底） ---------- */
function loadMeta() {
  return window.__npcCache || [];
}
async function loadMetaAsync() {
  // 1) 先从 IDB 读
  let idbList = null;
  try {
    const db = await openDB();
    idbList = await new Promise((resolve) => {
      const tx = db.transaction(META_STORE, "readonly");
      const req = tx.objectStore(META_STORE).get(perUserKey(META_KEY));
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (e) { console.warn("IDB read failed", e); }
  // 2) 读 localStorage 兜底
  const ls = lsMirrorLoad();
  // 3) 选更新的那份
  let chosen = idbList;
  if (idbList && ls) {
    // 比时间戳（localStorage 存了 ts）
    if ((ls.ts || 0) > Date.now() - 1000) {
      // 两条都有：用 IDB 的（数据更全，blob 引用在里面）
      chosen = idbList;
    } else {
      chosen = idbList;
    }
  } else if (!idbList && ls) {
    chosen = ls.list;
    // 回滚到 IDB 里
    saveMeta(chosen, /*silentIfEmpty*/ true);
  }
  window.__npcCache = chosen || [];
  return window.__npcCache;
}
async function saveMeta(list, silentIfEmpty = false) {
  window.__npcCache = list;
  // localStorage 镜像（最可靠的兜底）
  lsMirrorSave(list);
  // IDB 写入
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, "readwrite");
      tx.objectStore(META_STORE).put(list, perUserKey(META_KEY));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn("IDB save failed, but localStorage mirror OK", e);
  }
  // 触发存储健康事件
  document.dispatchEvent(new CustomEvent("npc:saved", { detail: { count: list.length, ts: Date.now() } }));
}
function genId() { return "npc_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

/* ---------- 城市坐标表 ---------- */
const CITIES = [
  // 中国
  { name: "北京", country: "中国", lat: 39.9042, lng: 116.4074 },
  { name: "上海", country: "中国", lat: 31.2304, lng: 121.4737 },
  { name: "广州", country: "中国", lat: 23.1291, lng: 113.2644 },
  { name: "深圳", country: "中国", lat: 22.5431, lng: 114.0579 },
  { name: "成都", country: "中国", lat: 30.5728, lng: 104.0668 },
  { name: "杭州", country: "中国", lat: 30.2741, lng: 120.1551 },
  { name: "西安", country: "中国", lat: 34.3416, lng: 108.9398 },
  { name: "重庆", country: "中国", lat: 29.4316, lng: 106.9123 },
  { name: "南京", country: "中国", lat: 32.0603, lng: 118.7969 },
  { name: "苏州", country: "中国", lat: 31.2989, lng: 120.5853 },
  { name: "武汉", country: "中国", lat: 30.5928, lng: 114.3055 },
  { name: "长沙", country: "中国", lat: 28.2282, lng: 112.9388 },
  { name: "厦门", country: "中国", lat: 24.4798, lng: 118.0894 },
  { name: "青岛", country: "中国", lat: 36.0671, lng: 120.3826 },
  { name: "哈尔滨", country: "中国", lat: 45.8038, lng: 126.5340 },
  { name: "香港", country: "中国", lat: 22.3193, lng: 114.1694 },
  { name: "澳门", country: "中国", lat: 22.1987, lng: 113.5439 },
  { name: "台北", country: "中国", lat: 25.0330, lng: 121.5654 },
  { name: "大理", country: "中国", lat: 25.6065, lng: 100.2675 },
  { name: "丽江", country: "中国", lat: 26.8721, lng: 100.2330 },
  // 亚洲
  { name: "东京", country: "日本", lat: 35.6762, lng: 139.6503 },
  { name: "京都", country: "日本", lat: 35.0116, lng: 135.7681 },
  { name: "大阪", country: "日本", lat: 34.6937, lng: 135.5023 },
  { name: "首尔", country: "韩国", lat: 37.5665, lng: 126.9780 },
  { name: "曼谷", country: "泰国", lat: 13.7563, lng: 100.5018 },
  { name: "清迈", country: "泰国", lat: 18.7883, lng: 98.9853 },
  { name: "新加坡", country: "新加坡", lat: 1.3521, lng: 103.8198 },
  { name: "巴厘岛", country: "印度尼西亚", lat: -8.3405, lng: 115.0920 },
  { name: "吉隆坡", country: "马来西亚", lat: 3.1390, lng: 101.6869 },
  { name: "马尼拉", country: "菲律宾", lat: 14.5995, lng: 120.9842 },
  { name: "孟买", country: "印度", lat: 19.0760, lng: 72.8777 },
  { name: "新德里", country: "印度", lat: 28.6139, lng: 77.2090 },
  { name: "迪拜", country: "阿联酋", lat: 25.2048, lng: 55.2708 },
  { name: "伊斯坦布尔", country: "土耳其", lat: 41.0082, lng: 28.9784 },
  { name: "耶路撒冷", country: "以色列", lat: 31.7683, lng: 35.2137 },
  // 欧洲
  { name: "伦敦", country: "英国", lat: 51.5074, lng: -0.1278 },
  { name: "爱丁堡", country: "英国", lat: 55.9533, lng: -3.1883 },
  { name: "巴黎", country: "法国", lat: 48.8566, lng: 2.3522 },
  { name: "柏林", country: "德国", lat: 52.5200, lng: 13.4050 },
  { name: "慕尼黑", country: "德国", lat: 48.1351, lng: 11.5820 },
  { name: "罗马", country: "意大利", lat: 41.9028, lng: 12.4964 },
  { name: "威尼斯", country: "意大利", lat: 45.4408, lng: 12.3155 },
  { name: "佛罗伦萨", country: "意大利", lat: 43.7696, lng: 11.2558 },
  { name: "米兰", country: "意大利", lat: 45.4642, lng: 9.1900 },
  { name: "巴塞罗那", country: "西班牙", lat: 41.3851, lng: 2.1734 },
  { name: "马德里", country: "西班牙", lat: 40.4168, lng: -3.7038 },
  { name: "里斯本", country: "葡萄牙", lat: 38.7223, lng: -9.1393 },
  { name: "阿姆斯特丹", country: "荷兰", lat: 52.3676, lng: 4.9041 },
  { name: "维也纳", country: "奥地利", lat: 48.2082, lng: 16.3738 },
  { name: "布拉格", country: "捷克", lat: 50.0755, lng: 14.4378 },
  { name: "雅典", country: "希腊", lat: 37.9838, lng: 23.7275 },
  { name: "圣彼得堡", country: "俄罗斯", lat: 59.9311, lng: 30.3609 },
  { name: "莫斯科", country: "俄罗斯", lat: 55.7558, lng: 37.6173 },
  { name: "哥本哈根", country: "丹麦", lat: 55.6761, lng: 12.5683 },
  { name: "斯德哥尔摩", country: "瑞典", lat: 59.3293, lng: 18.0686 },
  { name: "冰岛", country: "冰岛", lat: 64.1466, lng: -21.9426 },
  { name: "苏黎世", country: "瑞士", lat: 47.3769, lng: 8.5417 },
  { name: "日内瓦", country: "瑞士", lat: 46.2044, lng: 6.1432 },
  // 美洲
  { name: "纽约", country: "美国", lat: 40.7128, lng: -74.0060 },
  { name: "洛杉矶", country: "美国", lat: 34.0522, lng: -118.2437 },
  { name: "旧金山", country: "美国", lat: 37.7749, lng: -122.4194 },
  { name: "芝加哥", country: "美国", lat: 41.8781, lng: -87.6298 },
  { name: "西雅图", country: "美国", lat: 47.6062, lng: -122.3321 },
  { name: "迈阿密", country: "美国", lat: 25.7617, lng: -80.1918 },
  { name: "波士顿", country: "美国", lat: 42.3601, lng: -71.0589 },
  { name: "华盛顿", country: "美国", lat: 38.9072, lng: -77.0369 },
  { name: "拉斯维加斯", country: "美国", lat: 36.1699, lng: -115.1398 },
  { name: "多伦多", country: "加拿大", lat: 43.6532, lng: -79.3832 },
  { name: "温哥华", country: "加拿大", lat: 49.2827, lng: -123.1207 },
  { name: "蒙特利尔", country: "加拿大", lat: 45.5017, lng: -73.5673 },
  { name: "墨西哥城", country: "墨西哥", lat: 19.4326, lng: -99.1332 },
  { name: "哈瓦那", country: "古巴", lat: 23.1136, lng: -82.3666 },
  { name: "里约热内卢", country: "巴西", lat: -22.9068, lng: -43.1729 },
  { name: "圣保罗", country: "巴西", lat: -23.5505, lng: -46.6333 },
  { name: "布宜诺斯艾利斯", country: "阿根廷", lat: -34.6037, lng: -58.3816 },
  // 大洋洲
  { name: "悉尼", country: "澳大利亚", lat: -33.8688, lng: 151.2093 },
  { name: "墨尔本", country: "澳大利亚", lat: -37.8136, lng: 144.9631 },
  { name: "布里斯班", country: "澳大利亚", lat: -27.4698, lng: 153.0251 },
  { name: "奥克兰", country: "新西兰", lat: -36.8485, lng: 174.7633 },
  // 非洲
  { name: "开罗", country: "埃及", lat: 30.0444, lng: 31.2357 },
  { name: "开普敦", country: "南非", lat: -33.9249, lng: 18.4241 },
  { name: "约翰内斯堡", country: "南非", lat: -26.2041, lng: 28.0473 },
  { name: "马拉喀什", country: "摩洛哥", lat: 31.6295, lng: -7.9811 },
  { name: "内罗毕", country: "肯尼亚", lat: -1.2921, lng: 36.8219 },
];

// 城市名 → 坐标的快速查询（含别名匹配）
const CITY_LOOKUP = new Map();
CITIES.forEach(c => {
  CITY_LOOKUP.set(c.name, c);
  // 也存拼音/英文名（如果城市有别名）
  if (c.aliases) c.aliases.forEach(a => CITY_LOOKUP.set(a, c));
});

// 额外别名（让用户输入"京都"或"Kyoto"都能找到）
const ALIASES = {
  "京都": "京都",
  "Kyoto": "京都",
  "香港": "香港",
  "Hong Kong": "香港",
  "HK": "香港",
  "台北": "台北",
  "Taipei": "台北",
  "东京": "东京",
  "Tokyo": "东京",
  "首尔": "首尔",
  "Seoul": "首尔",
  "曼谷": "曼谷",
  "Bangkok": "曼谷",
  "新加坡": "新加坡",
  "Singapore": "新加坡",
  "巴厘": "巴厘岛",
  "Bali": "巴厘岛",
  "伦敦": "伦敦",
  "London": "伦敦",
  "巴黎": "巴黎",
  "Paris": "巴黎",
  "柏林": "柏林",
  "Berlin": "柏林",
  "罗马": "罗马",
  "Rome": "Rome",
  "纽约": "纽约",
  "New York": "纽约",
  "NYC": "纽约",
  "洛杉矶": "洛杉矶",
  "LA": "洛杉矶",
  "Los Angeles": "洛杉矶",
  "旧金山": "旧金山",
  "San Francisco": "旧金山",
  "SF": "旧金山",
  "东京": "东京",
  "上海": "上海",
  "Shanghai": "上海",
  "北京": "北京",
  "Beijing": "北京",
  "Peking": "北京",
  "广州": "广州",
  "Guangzhou": "广州",
  "Canton": "广州",
  "深圳": "深圳",
  "Shenzhen": "深圳",
  "成都": "成都",
  "Chengdu": "成都",
  "杭州": "杭州",
  "Hangzhou": "杭州",
  "西安": "西安",
  "Xi'an": "西安",
  "重庆": "重庆",
  "Chongqing": "重庆",
  "迪拜": "迪拜",
  "Dubai": "迪拜",
  "伊斯坦布尔": "伊斯坦布尔",
  "Istanbul": "伊斯坦布尔",
};
Object.entries(ALIASES).forEach(([alias, realName]) => {
  const city = CITIES.find(c => c.name === realName);
  if (city && !CITY_LOOKUP.has(alias)) CITY_LOOKUP.set(alias, city);
});

function findCity(query) {
  if (!query) return null;
  const q = query.trim();
  if (CITY_LOOKUP.has(q)) return CITY_LOOKUP.get(q);
  // 模糊匹配：在 CITIES 里搜包含 q 的
  const found = CITIES.find(c => c.name.includes(q) || q.includes(c.name));
  return found || null;
}

// 投影：lat/lng → SVG 坐标 (950x620，匹配 wikipedia 底图)
function projectToMap(lat, lng) {
  const x = (lng + 180) / 360 * 950;
  const y = (90 - lat) / 180 * 620;
  return { x, y };
}

// 反投影：屏幕点击 → SVG 坐标 → lat/lng
function svgPointToLatLng(svgX, svgY) {
  const lng = svgX / 950 * 360 - 180;
  const lat = 90 - svgY / 620 * 180;
  return { lat, lng };
}

// 给定 lat/lng，找出包含它的国家（用于地图点击钻取）
function findCountryAt(lat, lng) {
  // 优先匹配用户已收集的国家
  const collected = loadMeta().map(it => it.coords?.country).filter(Boolean);
  const unique = Array.from(new Set(collected));
  for (const c of unique) {
    if (latLngInCountry(lat, lng, c)) return c;
  }
  // fallback：匹配 COUNTRY_BOUNDS 里任意一个
  for (const [name, b] of Object.entries(COUNTRY_BOUNDS)) {
    if (latLngInCountry(lat, lng, name)) return name;
  }
  return null;
}
function latLngInCountry(lat, lng, countryName) {
  const b = COUNTRY_BOUNDS[countryName];
  if (!b) return false;
  return lat >= b.lat[0] && lat <= b.lat[1] && lng >= b.lng[0] && lng <= b.lng[1];
}

// 已知国家/地区 → 大致经纬度边界（用作钻取时的 viewBox）
// 用作 fallback；当某国家只有 1 个 NPC 时也用这个
const COUNTRY_BOUNDS = {
  "中国":       { lat: [18, 54],   lng: [73, 135]  },
  "日本":       { lat: [30, 46],   lng: [128, 146] },
  "韩国":       { lat: [33, 39],   lng: [124, 132] },
  "泰国":       { lat: [5, 21],    lng: [97, 106]  },
  "新加坡":     { lat: [1, 2],     lng: [103, 105] },
  "印度尼西亚": { lat: [-11, 6],   lng: [95, 141]  },
  "马来西亚":   { lat: [1, 7],     lng: [100, 119] },
  "菲律宾":     { lat: [5, 21],    lng: [117, 127] },
  "印度":       { lat: [8, 36],    lng: [68, 97]   },
  "阿联酋":     { lat: [22, 27],   lng: [51, 57]   },
  "土耳其":     { lat: [36, 42],   lng: [26, 45]   },
  "以色列":     { lat: [29, 34],   lng: [34, 36]   },
  "英国":       { lat: [50, 59],   lng: [-8, 2]    },
  "法国":       { lat: [42, 51],   lng: [-5, 9]    },
  "德国":       { lat: [47, 55],   lng: [5, 16]    },
  "意大利":     { lat: [36, 47],   lng: [6, 19]    },
  "西班牙":     { lat: [36, 44],   lng: [-9, 4]    },
  "葡萄牙":     { lat: [37, 42],   lng: [-10, -6]  },
  "荷兰":       { lat: [50, 54],   lng: [3, 8]     },
  "奥地利":     { lat: [46, 49],   lng: [9, 17]    },
  "捷克":       { lat: [48, 51],   lng: [12, 19]   },
  "希腊":       { lat: [35, 42],   lng: [19, 27]   },
  "俄罗斯":     { lat: [41, 70],   lng: [27, 180]  },
  "丹麦":       { lat: [54, 58],   lng: [8, 13]    },
  "瑞典":       { lat: [55, 69],   lng: [10, 24]   },
  "冰岛":       { lat: [63, 67],   lng: [-25, -13] },
  "瑞士":       { lat: [45, 48],   lng: [5, 11]    },
  "美国":       { lat: [24, 50],   lng: [-125, -66]},
  "加拿大":     { lat: [42, 84],   lng: [-141, -52]},
  "墨西哥":     { lat: [14, 33],   lng: [-118, -86]},
  "古巴":       { lat: [20, 23],   lng: [-85, -74] },
  "巴西":       { lat: [-34, 5],   lng: [-74, -34] },
  "阿根廷":     { lat: [-55, -21], lng: [-74, -53] },
  "澳大利亚":   { lat: [-44, -10], lng: [112, 154] },
  "新西兰":     { lat: [-47, -34], lng: [166, 179] },
  "埃及":       { lat: [22, 32],   lng: [25, 36]   },
  "南非":       { lat: [-35, -22], lng: [16, 33]   },
  "摩洛哥":     { lat: [28, 36],   lng: [-13, -1]  },
  "肯尼亚":     { lat: [-5, 5],    lng: [34, 42]   },
};

// 把 lat/lng 范围 → SVG viewBox（含 padding）
function boundsToViewBox(b, padRatio = 0.35) {
  const [latMin, latMax] = b.lat;
  const [lngMin, lngMax] = b.lng;
  // 转 SVG 坐标
  const xMin = (lngMin + 180) / 360 * 950;
  const xMax = (lngMax + 180) / 360 * 950;
  const yMin = (90 - latMax) / 180 * 620;
  const yMax = (90 - latMin) / 180 * 620;
  // 加 padding（按比例）
  const w0 = xMax - xMin;
  const h0 = yMax - yMin;
  const padX = Math.max(w0 * padRatio, 30);
  const padY = Math.max(h0 * padRatio, 30);
  return {
    x: Math.max(0, xMin - padX),
    y: Math.max(0, yMin - padY),
    w: w0 + padX * 2,
    h: h0 + padY * 2,
  };
}

// 国家 → emoji 旗（部分）
const COUNTRY_FLAGS = {
  "中国": "🇨🇳", "日本": "🇯🇵", "韩国": "🇰🇷", "泰国": "🇹🇭",
  "新加坡": "🇸🇬", "印度尼西亚": "🇮🇩", "马来西亚": "🇲🇾", "菲律宾": "🇵🇭",
  "印度": "🇮🇳", "阿联酋": "🇦🇪", "土耳其": "🇹🇷", "以色列": "🇮🇱",
  "英国": "🇬🇧", "法国": "🇫🇷", "德国": "🇩🇪", "意大利": "🇮🇹",
  "西班牙": "🇪🇸", "葡萄牙": "🇵🇹", "荷兰": "🇳🇱", "奥地利": "🇦🇹",
  "捷克": "🇨🇿", "希腊": "🇬🇷", "俄罗斯": "🇷🇺", "丹麦": "🇩🇰",
  "瑞典": "🇸🇪", "冰岛": "🇮🇸", "瑞士": "🇨🇭",
  "美国": "🇺🇸", "加拿大": "🇨🇦", "墨西哥": "🇲🇽", "古巴": "🇨🇺",
  "巴西": "🇧🇷", "阿根廷": "🇦🇷",
  "澳大利亚": "🇦🇺", "新西兰": "🇳🇿",
  "埃及": "🇪🇬", "南非": "🇿🇦", "摩洛哥": "🇲🇦", "肯尼亚": "🇰🇪",
};

/* ---------- DOM ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const gallery = $("#gallery");
const emptyState = $("#empty-state");
const modal = $("#modal");
const loading = $("#loading");
const lightbox = $("#lightbox");
const lightboxImg = $("#lightbox-img");
const uploadBox = $("#upload-box");
const fileInput = $("#file-input");
const uploadPreview = $("#upload-preview");
const uploadPlaceholder = $("#upload-placeholder");
const form = $("#npc-form");
const heroSection = $(".hero-section");
const mapContainer = $("#map-container");
const mapMarkers = $("#map-markers");
const mapEmpty = $("#map-empty");
const mapPopup = $("#map-popup");

let pendingPhoto = null;
let pendingCartoon = null;
let currentStyle = "3d-character";  // 固定风格：3D 角色
let currentBaseColor = "auto";  // "auto" | "#d4af37" | "#c0c0c0" | "#9d4edd" | "#4cc9f0"
let editId = null;
let referencePalette = null;  // 缓存的参考图调色板
let faceLandmarker = null;
let faceLandmarkerLoading = null;

/* ---------- 风格映射（仅 Mavis 升级用）---------- */
const STYLE_PROMPTS = {
  "3d-character": {
    label: "🎨 紫粉 3D 角色卡牌",
    prompt: "Create a stylized 3D character portrait matching this reference: white/silver hair, dark horns, red-toned skin, blue eyes, black outfit, soft cinematic rim light, Pixar-meets-fantasy aesthetic, half-body shot, painterly dark purple background, highly detailed, sharp features."
  },
};

/* ---------- 视频自动轮播（2 个 Fauvist 油画视频，每次随机选一个） ---------- */
let activeVideo = Math.floor(Math.random() * 2);
const VIDEO_INTERVAL = 9000;

function setActiveVideo(index) {
  const videos = document.querySelectorAll(".hero-video");
  videos.forEach((v, i) => v.classList.toggle("is-active", i === index));
  activeVideo = index;
}
setActiveVideo(activeVideo);

setInterval(() => {
  activeVideo = (activeVideo + 1) % 2;
  setActiveVideo(activeVideo);
}, VIDEO_INTERVAL);

/* ---------- 移动菜单 ---------- */
const navBurger = $("#nav-burger");
const mobileMenu = $("#mobile-menu");
navBurger?.addEventListener("click", () => {
  const isOpen = navBurger.classList.toggle("is-open");
  if (isOpen) {
    mobileMenu.hidden = false;
    requestAnimationFrame(() => mobileMenu.classList.add("is-open"));
  } else closeMobileMenu();
});
function closeMobileMenu() {
  navBurger.classList.remove("is-open");
  mobileMenu.classList.remove("is-open");
  setTimeout(() => { mobileMenu.hidden = true; }, 300);
}
mobileMenu?.addEventListener("click", (e) => {
  if (e.target.hasAttribute("data-mm-close")) closeMobileMenu();
});

/* ---------- Hero CTA → 滚动到主区 ---------- */
$("#hero-start")?.addEventListener("click", () => {
  const content = $(".content-section");
  if (content) content.scrollIntoView({ behavior: "smooth", block: "start" });
});

/* ---------- 上传 ---------- */
function setupUpload(box, input, onFile) {
  function handleFile(file) {
    if (!file || !file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    onFile(file, url);
  }
  box.addEventListener("click", () => input.click());
  box.addEventListener("dragover", (e) => { e.preventDefault(); box.classList.add("is-drag"); });
  box.addEventListener("dragleave", () => box.classList.remove("is-drag"));
  box.addEventListener("drop", (e) => {
    e.preventDefault(); box.classList.remove("is-drag");
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  });
  input.addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f) handleFile(f);
  });
}

function setUploadPreview(boxEl, previewEl, placeholderEl, url) {
  previewEl.src = url;
  previewEl.hidden = false;
  placeholderEl.style.display = "none";
  boxEl.classList.add("has-image");
}

setupUpload(uploadBox, fileInput, async (file, url) => {
  pendingPhoto = { blob: file, url };
  setUploadPreview(uploadBox, uploadPreview, uploadPlaceholder, url);
  if (copyBtn) copyBtn.disabled = false;
  // 自动跑 3D 角色风格化（不需要等用户点）
  runCollage(file);
});

const cartoonBox = $("#cartoon-box");
const cartoonInput = $("#cartoon-input");
const cartoonPreview = $("#cartoon-preview");
const cartoonPlaceholder = $("#cartoon-placeholder");

/* ---------- 卡牌底色选择 ---------- */
const colorPicker = $("#color-picker");
if (colorPicker) {
  colorPicker.addEventListener("click", async (e) => {
    const sw = e.target.closest(".color-swatch");
    if (!sw) return;
    if (sw.dataset.color === currentBaseColor) return; // 同一个颜色不重复跑
    colorPicker.querySelectorAll(".color-swatch").forEach(s => s.classList.remove("is-active"));
    sw.classList.add("is-active");
    currentBaseColor = sw.dataset.color || "auto";
    SFX.S.click();
    // 如果已经上传了照片，立即用新颜色重新生成
    if (pendingPhoto && pendingPhoto.blob) {
      runCollage(pendingPhoto.blob);
    }
  });
}
function setColorPickerValue(c) {
  if (!colorPicker) return;
  const v = c || "auto";
  colorPicker.querySelectorAll(".color-swatch").forEach(s => {
    s.classList.toggle("is-active", s.dataset.color === v);
  });
  currentBaseColor = v;
}

setupUpload(cartoonBox, cartoonInput, (file, url) => {
  pendingCartoon = { blob: file, url };
  setUploadPreview(cartoonBox, cartoonPreview, cartoonPlaceholder, url);
});

/* ---------- 拼贴艺术: 换一换 + 风格选择 pills ---------- */
const retryBtn = document.getElementById("btn-retry-ai");
retryBtn?.addEventListener("click", () => {
  if (pendingPhoto && pendingPhoto.blob) {
    retryBtn.disabled = true;
    const oldText = retryBtn.textContent;
    retryBtn.textContent = "🎲 生成中…";
    runCollage(pendingPhoto.blob).finally(() => {
      retryBtn.disabled = false;
      retryBtn.textContent = oldText;
    });
  }
});

document.querySelectorAll(".style-pill").forEach(pill => {
  pill.addEventListener("click", () => {
    if (!pendingPhoto || !pendingPhoto.blob) return;
    const cat = pill.dataset.cat;
    const variants = VARIANT_CATS[cat] || ALL_VARIANTS;
    const v = variants[Math.floor(Math.random() * variants.length)];
    document.querySelectorAll(".style-pill").forEach(p => p.classList.remove("is-active"));
    pill.classList.add("is-active");
    runCollage(pendingPhoto.blob, v);
  });
});

$("#btn-use-photo-as-cartoon")?.addEventListener("click", () => {
  if (!pendingPhoto) { alert("请先上传一张实拍图。"); return; }
  pendingCartoon = { blob: pendingPhoto.blob, url: pendingPhoto.url };
  setUploadPreview(cartoonBox, cartoonPreview, cartoonPlaceholder, pendingPhoto.url);
  // 隐藏本地风格化预览（因为用户选了用实拍图）
  if (stylePreview) stylePreview.hidden = true;
  if (styleHint) styleHint.textContent = "已用实拍图作正面";
});

/* ---------- 本地风格化（Canvas 真实图像处理）---------- */

// === 基础工具函数 ===
function getLuminance(r, g, b) { return 0.299 * r + 0.587 * g + 0.114 * b; }

// Sobel 边缘检测 → 返回每像素的边缘强度 (0-255)
function sobelEdges(imgData) {
  const w = imgData.width, h = imgData.height;
  const src = imgData.data;
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      const tl = getLuminance(src[i-4-w*4], src[i-3-w*4], src[i-2-w*4]);
      const t  = getLuminance(src[i-3-w*4], src[i-2-w*4], src[i-1-w*4]); // 像素 (x, y-1)
      // 用更直接的 8 邻居采样
      const iTL = ((y-1) * w + (x-1)) * 4;
      const iT  = ((y-1) * w + x) * 4;
      const iTR = ((y-1) * w + (x+1)) * 4;
      const iL  = (y * w + (x-1)) * 4;
      const iR  = (y * w + (x+1)) * 4;
      const iBL = ((y+1) * w + (x-1)) * 4;
      const iB  = ((y+1) * w + x) * 4;
      const iBR = ((y+1) * w + (x+1)) * 4;
      const pxTL = getLuminance(src[iTL], src[iTL+1], src[iTL+2]);
      const pxT  = getLuminance(src[iT], src[iT+1], src[iT+2]);
      const pxTR = getLuminance(src[iTR], src[iTR+1], src[iTR+2]);
      const pxL  = getLuminance(src[iL], src[iL+1], src[iL+2]);
      const pxR  = getLuminance(src[iR], src[iR+1], src[iR+2]);
      const pxBL = getLuminance(src[iBL], src[iBL+1], src[iBL+2]);
      const pxB  = getLuminance(src[iB], src[iB+1], src[iB+2]);
      const pxBR = getLuminance(src[iBR], src[iBR+1], src[iBR+2]);
      const gx = (pxTR + 2*pxR + pxBR) - (pxTL + 2*pxL + pxBL);
      const gy = (pxBL + 2*pxB + pxBR) - (pxTL + 2*pxT + pxTR);
      out[y * w + x] = Math.min(255, Math.sqrt(gx*gx + gy*gy));
    }
  }
  return out;
}

// 颜色量化（posterize）: 把颜色数减少到 levels
function posterize(imgData, levels) {
  const data = imgData.data;
  const step = 255 / (levels - 1);
  for (let i = 0; i < data.length; i += 4) {
    data[i]   = Math.round(data[i]   / step) * step;
    data[i+1] = Math.round(data[i+1] / step) * step;
    data[i+2] = Math.round(data[i+2] / step) * step;
  }
  return imgData;
}

// Box blur (fast) — 用于预处理
function boxBlur(imgData, radius) {
  const w = imgData.width, h = imgData.height;
  const src = new Uint8ClampedArray(imgData.data);
  const dst = imgData.data;
  // 水平 + 垂直 两遍
  const tmp = new Uint8ClampedArray(src.length);
  // 水平
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r=0, g=0, b=0, a=0, n=0;
      for (let kx = -radius; kx <= radius; kx++) {
        const sx = Math.min(w-1, Math.max(0, x + kx));
        const si = (y * w + sx) * 4;
        r += src[si]; g += src[si+1]; b += src[si+2]; a += src[si+3];
        n++;
      }
      const di = (y * w + x) * 4;
      tmp[di] = r/n; tmp[di+1] = g/n; tmp[di+2] = b/n; tmp[di+3] = a/n;
    }
  }
  // 垂直
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r=0, g=0, b=0, a=0, n=0;
      for (let ky = -radius; ky <= radius; ky++) {
        const sy = Math.min(h-1, Math.max(0, y + ky));
        const si = (sy * w + x) * 4;
        r += tmp[si]; g += tmp[si+1]; b += tmp[si+2]; a += tmp[si+3];
        n++;
      }
      const di = (y * w + x) * 4;
      dst[di] = r/n; dst[di+1] = g/n; dst[di+2] = b/n; dst[di+3] = a/n;
    }
  }
  return imgData;
}

// 边缘叠加：在边缘处画黑线
function drawEdges(imgData, edges, threshold, darkness = 200) {
  const w = imgData.width, h = imgData.height;
  const data = imgData.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const e = edges[y * w + x];
      if (e > threshold) {
        const i = (y * w + x) * 4;
        const factor = Math.min(1, (e - threshold) / 50) * (darkness / 255);
        data[i]   = data[i]   * (1 - factor);
        data[i+1] = data[i+1] * (1 - factor);
        data[i+2] = data[i+2] * (1 - factor);
      }
    }
  }
  return imgData;
}

// Unsharp Mask — 增强局部对比度，模拟 3D 立体感
function unsharpMask(imgData, amount = 1.5, radius = 2) {
  const w = imgData.width, h = imgData.height;
  const src = new Uint8ClampedArray(imgData.data);
  const blurred = new Uint8ClampedArray(src.length);
  // 简单 box blur 出模糊图
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r=0, g=0, b=0, n=0;
      for (let ky = -radius; ky <= radius; ky++) {
        for (let kx = -radius; kx <= radius; kx++) {
          const sy = Math.min(h-1, Math.max(0, y + ky));
          const sx = Math.min(w-1, Math.max(0, x + kx));
          const si = (sy * w + sx) * 4;
          r += src[si]; g += src[si+1]; b += src[si+2]; n++;
        }
      }
      const di = (y * w + x) * 4;
      blurred[di] = r/n; blurred[di+1] = g/n; blurred[di+2] = b/n; blurred[di+3] = src[di+3];
    }
  }
  // 增强
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i]   = Math.min(255, Math.max(0, src[i]   + (src[i]   - blurred[i])   * amount));
    data[i+1] = Math.min(255, Math.max(0, src[i+1] + (src[i+1] - blurred[i+1]) * amount));
    data[i+2] = Math.min(255, Math.max(0, src[i+2] + (src[i+2] - blurred[i+2]) * amount));
  }
  return imgData;
}

// 整体 duotone（双色调）— 把图像按亮度映射到两种颜色
function duotone(imgData, darkColor, lightColor) {
  const w = imgData.width, h = imgData.height;
  const data = imgData.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const lum = getLuminance(data[i], data[i+1], data[i+2]) / 255;
      data[i]   = darkColor[0] * (1 - lum) + lightColor[0] * lum;
      data[i+1] = darkColor[1] * (1 - lum) + lightColor[1] * lum;
      data[i+2] = darkColor[2] * (1 - lum) + lightColor[2] * lum;
    }
  }
  return imgData;
}

// Cell shading (赛璐璐动画风格): 把亮度量化到 N 级，高光/暗部用单独颜色
function cellShade(imgData, lightColor, midColor, shadowColor, threshold1 = 0.5, threshold2 = 0.25) {
  const w = imgData.width, h = imgData.height;
  const data = imgData.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const lum = getLuminance(data[i], data[i+1], data[i+2]) / 255;
      let target;
      if (lum > threshold1) target = lightColor;
      else if (lum > threshold2) target = midColor;
      else target = shadowColor;
      // 用原色相 × target
      const origMax = Math.max(data[i], data[i+1], data[i+2]) || 1;
      const ratio = (data[i] + data[i+1] + data[i+2]) / (3 * origMax) || 0.5;
      const tintR = target[0] / 255;
      const tintG = target[1] / 255;
      const tintB = target[2] / 255;
      data[i]   = Math.min(255, data[i]   * tintR / Math.max(tintR, 0.4));
      data[i+1] = Math.min(255, data[i+1] * tintG / Math.max(tintG, 0.4));
      data[i+2] = Math.min(255, data[i+2] * tintB / Math.max(tintB, 0.4));
    }
  }
  return imgData;
}

// 饱和度调整
function adjustSaturation(imgData, amount) {
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const lum = getLuminance(data[i], data[i+1], data[i+2]);
    data[i]   = Math.min(255, Math.max(0, lum + (data[i]   - lum) * amount));
    data[i+1] = Math.min(255, Math.max(0, lum + (data[i+1] - lum) * amount));
    data[i+2] = Math.min(255, Math.max(0, lum + (data[i+2] - lum) * amount));
  }
  return imgData;
}

async function localStylize(photoBlob, style) {
  if (!photoBlob) return null;
  const url = URL.createObjectURL(photoBlob);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    // 输出尺寸：长边 500（够快，视觉也够）
    const maxSide = 500;
    const ratio = Math.min(1, maxSide / Math.max(img.width, img.height));
    const w = Math.round(img.width * ratio);
    const h = Math.round(img.height * ratio);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    // 1. 画原图
    ctx.drawImage(img, 0, 0, w, h);
    const imgData = ctx.getImageData(0, 0, w, h);

    // 2. 各种风格真实处理
    if (style === "cute") {
      // 1) 轻度 box blur 保留边缘
      boxBlur(imgData, 1);
      // 2) 提亮 + 颜色量化
      adjustSaturation(imgData, 1.3);
      posterize(imgData, 10);
      // 3) 边缘检测 + 细描边
      const edges = sobelEdges(ctx.getImageData(0, 0, w, h));
      drawEdges(imgData, edges, 60, 100);
      // 4) 紫粉 duotone
      duotone(imgData, [180, 130, 220], [255, 220, 240]);
    } else if (style === "3d") {
      // 1) Unsharp mask → 3D 立体感
      unsharpMask(imgData, 1.8, 3);
      // 2) 提亮 + 高饱和
      adjustSaturation(imgData, 1.25);
      // 3) 颜色量化（保留细节）
      posterize(imgData, 16);
      // 4) 紫色调
      duotone(imgData, [80, 50, 140], [200, 180, 240]);
    } else if (style === "q") {
      // 1) 强颜色量化
      posterize(imgData, 6);
      // 2) 边缘检测 + 粗描边
      const edges = sobelEdges(ctx.getImageData(0, 0, w, h));
      drawEdges(imgData, edges, 40, 220);
      // 3) 高饱和
      adjustSaturation(imgData, 1.5);
    } else if (style === "illustration") {
      // 1) 强 box blur → 柔化
      boxBlur(imgData, 2);
      // 2) Unsharp mask 找边缘
      unsharpMask(imgData, 0.8, 2);
      // 3) 提亮
      adjustSaturation(imgData, 1.2);
      // 4) 暖色 duotone
      duotone(imgData, [180, 120, 100], [255, 230, 200]);
    } else if (style === "anime") {
      // 1) 提亮 + 高对比
      adjustSaturation(imgData, 1.3);
      // 2) 颜色量化（保留 8 级）
      posterize(imgData, 8);
      // 3) 强边缘检测 + 细描边
      const edges = sobelEdges(ctx.getImageData(0, 0, w, h));
      drawEdges(imgData, edges, 50, 180);
    }

    // 3. 写回
    ctx.putImageData(imgData, 0, 0);
    return await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.9));
  } finally {
    URL.revokeObjectURL(url);
  }
}

const stylePreview = $("#style-preview");
const stylePreviewImg = $("#style-preview-img");
const styleHint = $("#style-hint");
const style3dStatus = $("#style-3d-status");

/* ---------- 3D 角色风格化（基于参考图 + 真实图像处理）---------- */

// 提取参考图的主色调（用作颜色迁移）
async function loadReferencePalette() {
  if (referencePalette) return referencePalette;
  try {
    const resp = await fetch("./assets/style-reference.jpg");
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    URL.revokeObjectURL(url);
    const canvas = document.createElement("canvas");
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, 64, 64);
    const data = ctx.getImageData(0, 0, 64, 64).data;
    // 简单 K-means 找 3 个主色
    const palette = kmeansPalette(data, 4);
    referencePalette = palette;
    return palette;
  } catch (e) {
    console.warn("参考图加载失败", e);
    // fallback palette (紫粉 3D 调)
    referencePalette = [
      [255, 220, 230],  // 浅粉 (皮肤高光)
      [220, 130, 160],  // 粉红 (皮肤中调)
      [120, 70, 110],   // 深紫 (阴影)
      [40, 30, 60],     // 暗紫 (背景)
    ];
    return referencePalette;
  }
}

// 简单 K-means 找 N 个主色
function kmeansPalette(rgbaData, k = 4, iter = 8) {
  // 随机选 k 个像素作为初始中心
  const points = [];
  const total = rgbaData.length / 4;
  for (let i = 0; i < 200; i++) {
    const idx = Math.floor(Math.random() * total) * 4;
    points.push([rgbaData[idx], rgbaData[idx+1], rgbaData[idx+2]]);
  }
  let centers = [];
  for (let i = 0; i < k; i++) {
    centers.push(points[Math.floor(Math.random() * points.length)].slice());
  }
  for (let it = 0; it < iter; it++) {
    const clusters = Array.from({ length: k }, () => []);
    for (const p of points) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = (p[0]-centers[c][0])**2 + (p[1]-centers[c][1])**2 + (p[2]-centers[c][2])**2;
        if (d < bestD) { bestD = d; best = c; }
      }
      clusters[best].push(p);
    }
    for (let c = 0; c < k; c++) {
      if (clusters[c].length > 0) {
        centers[c] = [
          clusters[c].reduce((s, p) => s + p[0], 0) / clusters[c].length,
          clusters[c].reduce((s, p) => s + p[1], 0) / clusters[c].length,
          clusters[c].reduce((s, p) => s + p[2], 0) / clusters[c].length,
        ];
      }
    }
  }
  // 按亮度排序（亮 → 暗）
  centers.sort((a, b) => (b[0]+b[1]+b[2]) - (a[0]+a[1]+a[2]));
  return centers;
}

// 颜色迁移：按原图亮度映射到参考图主色
function transferColorByLuminance(imgData, palette) {
  const data = imgData.data;
  // palette: [[r,g,b], ...] 排序从亮到暗
  for (let i = 0; i < data.length; i += 4) {
    const lum = getLuminance(data[i], data[i+1], data[i+2]) / 255;
    // 把 lum 映射到 palette 的位置
    const t = lum * (palette.length - 1);
    const idx = Math.floor(t);
    const frac = t - idx;
    const c1 = palette[Math.min(idx, palette.length - 1)];
    const c2 = palette[Math.min(idx + 1, palette.length - 1)];
    // 保留原图色相，仅按亮度梯度替换调色
    const origMax = Math.max(data[i], data[i+1], data[i+2]) || 1;
    const origR = data[i] / origMax;
    const origG = data[i+1] / origMax;
    const origB = data[i+2] / origMax;
    const targR = c1[0] * (1 - frac) + c2[0] * frac;
    const targG = c1[1] * (1 - frac) + c2[1] * frac;
    const targB = c1[2] * (1 - frac) + c2[2] * frac;
    const targAvg = (targR + targG + targB) / 3;
    const targNorm = targAvg > 0 ? 255 / targAvg * 0.7 : 1;
    // 混合：70% 调色板颜色 + 30% 原图色相
    data[i]   = Math.min(255, Math.max(0, (targR * targNorm * 0.7 + origR * 80)));
    data[i+1] = Math.min(255, Math.max(0, (targG * targNorm * 0.7 + origG * 80)));
    data[i+2] = Math.min(255, Math.max(0, (targB * targNorm * 0.7 + origB * 80)));
  }
  return imgData;
}

// 3D 立体感：用 Sobel 算"法线"，再打方向光
function apply3DShading(imgData) {
  const w = imgData.width, h = imgData.height;
  const src = imgData.data;
  const out = new Uint8ClampedArray(src.length);
  // 灯光方向：左上偏前
  const lightDir = { x: -0.5, y: -0.7, z: 0.6 };
  const len = Math.sqrt(lightDir.x**2 + lightDir.y**2 + lightDir.z**2);
  lightDir.x /= len; lightDir.y /= len; lightDir.z /= len;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      // Sobel 算 luminance 梯度
      const l00 = getLuminance(src[i-4-w*4], src[i-3-w*4], src[i-2-w*4]);
      const l01 = getLuminance(src[i-w*4], src[i+1-w*4], src[i+2-w*4]);
      const l02 = getLuminance(src[i+4-w*4], src[i+5-w*4], src[i+6-w*4]);
      const l10 = getLuminance(src[i-4], src[i-3], src[i-2]);
      const l12 = getLuminance(src[i+4], src[i+5], src[i+6]);
      const l20 = getLuminance(src[i-4+w*4], src[i-3+w*4], src[i-2+w*4]);
      const l21 = getLuminance(src[i+w*4], src[i+1+w*4], src[i+2+w*4]);
      const l22 = getLuminance(src[i+4+w*4], src[i+5+w*4], src[i+6+w*4]);
      const gx = (l02 + 2*l12 + l22) - (l00 + 2*l10 + l20);
      const gy = (l20 + 2*l21 + l22) - (l00 + 2*l01 + l02);
      // 法线 = (-gx, -gy, scale)
      const scale = 4;
      const nx = -gx / 255 * scale;
      const ny = -gy / 255 * scale;
      const nz = 1;
      const nlen = Math.sqrt(nx*nx + ny*ny + nz*nz);
      // Lambertian
      let diffuse = (nx*lightDir.x + ny*lightDir.y + nz*lightDir.z) / nlen;
      diffuse = Math.max(0, Math.min(1, diffuse * 0.7 + 0.4));
      // 应用
      out[i]   = src[i]   * diffuse;
      out[i+1] = src[i+1] * diffuse;
      out[i+2] = src[i+2] * diffuse;
      out[i+3] = src[i+3];
    }
  }
  // 边界拷贝
  for (let x = 0; x < w; x++) {
    out[x*4] = src[x*4]; out[x*4+1] = src[x*4+1]; out[x*4+2] = src[x*4+2]; out[x*4+3] = src[x*4+3];
    out[((h-1)*w + x)*4] = src[((h-1)*w + x)*4];
    out[((h-1)*w + x)*4+1] = src[((h-1)*w + x)*4+1];
    out[((h-1)*w + x)*4+2] = src[((h-1)*w + x)*4+2];
    out[((h-1)*w + x)*4+3] = src[((h-1)*w + x)*4+3];
  }
  for (let y = 0; y < h; y++) {
    out[(y*w)*4] = src[(y*w)*4]; out[(y*w)*4+1] = src[(y*w)*4+1]; out[(y*w)*4+2] = src[(y*w)*4+2]; out[(y*w)*4+3] = src[(y*w)*4+3];
    out[(y*w+w-1)*4] = src[(y*w+w-1)*4]; out[(y*w+w-1)*4+1] = src[(y*w+w-1)*4+1]; out[(y*w+w-1)*4+2] = src[(y*w+w-1)*4+2]; out[(y*w+w-1)*4+3] = src[(y*w+w-1)*4+3];
  }
  imgData.data.set(out);
  return imgData;
}

/* ============================================================
   拼贴艺术生成器 (本地 · 1-2 秒)
   流程: 椭圆 mask 抠出人物 → 灰度 + 半色调网点 → 拼贴元素
   风格: street(街头涂鸦) / press(印刷复古) / minimal(极简构成)
   变体: 每次 seed 不同 → 元素位置/颜色不同
   ============================================================ */

const COLLAGE_W = 600, COLLAGE_H = 800;
const W = COLLAGE_W, H = COLLAGE_H;  // 别名(供辅助函数使用)

// Mulberry32 - 轻量随机数(可控 seed)
function mulberry32(seed) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// 加载图片到 canvas
async function loadImageToCanvas(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// 应用椭圆 mask (中心偏上, 覆盖脸+肩+胸)
// === 人物前景提取（纯算法，无 AI）===
// 思路：缩小 → 中心色采样 → 颜色距离阈值 → 最大连通区域 → 填洞 → 形态学闭运算 → 缩放回原尺寸
async function extractPersonMask(srcCanvas, w, h) {
  const SCALE = 0.4;
  const sw = Math.max(100, Math.round(w * SCALE));
  const sh = Math.max(100, Math.round(h * SCALE));

  // 1. 缩小到 sw x sh
  const small = document.createElement("canvas");
  small.width = sw; small.height = sh;
  const sctx = small.getContext("2d");
  sctx.drawImage(srcCanvas, 0, 0, sw, sh);
  const data = sctx.getImageData(0, 0, sw, sh).data;

  // 2. 中心区域颜色采样（脸/胸口）→ 主色
  const cx = sw * 0.5, cy = sh * 0.4;
  const sampleR = Math.min(sw, sh) * 0.12;
  const samples = [];
  for (let dy = -sampleR; dy <= sampleR; dy += 2) {
    for (let dx = -sampleR; dx <= sampleR; dx += 2) {
      const px = Math.round(cx + dx), py = Math.round(cy + dy);
      if (px < 0 || py < 0 || px >= sw || py >= sh) continue;
      const i = (py * sw + px) * 4;
      samples.push((data[i] << 16) | (data[i+1] << 8) | data[i+2]);
    }
  }
  samples.sort((a, b) => a - b);
  const mid = samples[Math.floor(samples.length / 2)];
  const mr = (mid >> 16) & 0xff, mg = (mid >> 8) & 0xff, mb = mid & 0xff;

  // 3. 每个像素到主体色的平方距离
  const dist = new Float32Array(sw * sh);
  for (let i = 0; i < sw * sh; i++) {
    const r = data[i*4], g = data[i*4+1], b = data[i*4+2];
    const dr = r - mr, dg = g - mg, db = b - mb;
    dist[i] = dr*dr + dg*dg + db*db;
  }

  // 4. 自适应阈值（放宽一点，保留更多主体像素）
  let sum = 0;
  for (let i = 0; i < sw*sh; i++) sum += dist[i];
  const mean = sum / (sw*sh);
  const thresh = mean * 1.5;

  // 5. 二值化
  const binary = new Uint8Array(sw * sh);
  for (let i = 0; i < sw*sh; i++) {
    binary[i] = dist[i] < thresh ? 1 : 0;
  }

  // 6. 8-连通 BFS 找最大连通区域
  const visited = new Uint8Array(sw * sh);
  let largest = new Uint8Array(sw * sh);
  let largestSize = 0;

  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = y * sw + x;
      if (!binary[i] || visited[i]) continue;
      const comp = new Uint8Array(sw * sh);
      const stack = [i];
      let size = 0;
      while (stack.length) {
        const j = stack.pop();
        if (visited[j]) continue;
        visited[j] = 1;
        comp[j] = 1;
        size++;
        const x2 = j % sw, y2 = Math.floor(j / sw);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x2 + dx, ny = y2 + dy;
            if (nx < 0 || ny < 0 || nx >= sw || ny >= sh) continue;
            const ni = ny * sw + nx;
            if (binary[ni] && !visited[ni]) stack.push(ni);
          }
        }
      }
      if (size > largestSize) { largestSize = size; largest = comp; }
    }
  }
  if (largestSize === 0) {
    // fallback: 全白（极端情况）
    largest = new Uint8Array(sw * sh).fill(1);
  }

  // 7. 填洞（bounding box 内 flood-fill from boundary → 未到达的 = 洞，填回去）
  let minX = sw, minY = sh, maxX = -1, maxY = -1;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      if (largest[y * sw + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX >= 0) {
    const reachable = new Uint8Array(sw * sh);
    const stack = [];
    // bbox 边界上"非主体"像素 = 起点
    for (let x = minX; x <= maxX; x++) {
      if (!largest[minY * sw + x]) { stack.push(minY * sw + x); reachable[minY * sw + x] = 1; }
      if (!largest[maxY * sw + x]) { stack.push(maxY * sw + x); reachable[maxY * sw + x] = 1; }
    }
    for (let y = minY; y <= maxY; y++) {
      if (!largest[y * sw + minX]) { stack.push(y * sw + minX); reachable[y * sw + minX] = 1; }
      if (!largest[y * sw + maxX]) { stack.push(y * sw + maxX); reachable[y * sw + maxX] = 1; }
    }
    while (stack.length) {
      const i = stack.pop();
      const x = i % sw, y = Math.floor(i / sw);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < minX || ny < minY || nx > maxX || ny > maxY) continue;
          const ni = ny * sw + nx;
          if (largest[ni] || reachable[ni]) continue;
          reachable[ni] = 1;
          stack.push(ni);
        }
      }
    }
    // 填洞
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const i = y * sw + x;
        if (!largest[i] && !reachable[i]) largest[i] = 1;
      }
    }
  }

  // 8. 形态学闭运算（dilate → erode 平滑）
  const dilate = (a) => {
    const out = new Uint8Array(sw * sh);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        let any = 0;
        for (let dy = -1; dy <= 1 && !any; dy++) {
          for (let dx = -1; dx <= 1 && !any; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= sw || ny >= sh) continue;
            if (a[ny * sw + nx]) any = 1;
          }
        }
        out[y * sw + x] = any;
      }
    }
    return out;
  };
  const erode = (a) => {
    const out = new Uint8Array(sw * sh);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        let all = 1;
        for (let dy = -1; dy <= 1 && all; dy++) {
          for (let dx = -1; dx <= 1 && all; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= sw || ny >= sh) continue;
            if (!a[ny * sw + nx]) all = 0;
          }
        }
        out[y * sw + x] = all;
      }
    }
    return out;
  };
  let closed = largest;
  for (let i = 0; i < 2; i++) closed = dilate(closed);
  for (let i = 0; i < 2; i++) closed = erode(closed);

  // 9. 缩放回 w x h（双线性插值，平滑边缘）
  const mask = document.createElement("canvas");
  mask.width = w; mask.height = h;
  const mctx = mask.getContext("2d");
  const id = mctx.createImageData(w, h);
  const fx = sw / w, fy = sh / h;
  for (let y = 0; y < h; y++) {
    const sy = y * fy;
    const y0 = Math.min(sh - 1, Math.floor(sy));
    const y1 = Math.min(sh - 1, y0 + 1);
    const wy = sy - y0;
    for (let x = 0; x < w; x++) {
      const sx = x * fx;
      const x0 = Math.min(sw - 1, Math.floor(sx));
      const x1 = Math.min(sw - 1, x0 + 1);
      const wx = sx - x0;
      const v00 = closed[y0 * sw + x0];
      const v10 = closed[y0 * sw + x1];
      const v01 = closed[y1 * sw + x0];
      const v11 = closed[y1 * sw + x1];
      const top = v00 * (1 - wx) + v10 * wx;
      const bot = v01 * (1 - wx) + v11 * wx;
      const v = top * (1 - wy) + bot * wy;
      const di = (y * w + x) * 4;
      id.data[di+3] = Math.round(v * 255);
    }
  }
  mctx.putImageData(id, 0, 0);
  return mask;
}

// 把 mask 画到 ctx（仅显示 mask 内区域）
function applyMask(ctx, mask, w, h) {
  const mctx = mask.getContext("2d");
  const mdata = mctx.getImageData(0, 0, w, h).data;
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    if (mdata[i+3] < 128) d[i+3] = 0;
  }
  ctx.putImageData(id, 0, 0);
}

// 从 mask 提取 1-像素宽的轮廓
function maskToOutline(mask, w, h) {
  const mctx = mask.getContext("2d");
  const mdata = mctx.getImageData(0, 0, w, h).data;
  const outline = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (mdata[i*4+3] > 128) {
        // 4-方向邻居中至少 1 个在 mask 外
        if (mdata[((y-1)*w + x)*4+3] < 128 ||
            mdata[((y+1)*w + x)*4+3] < 128 ||
            mdata[(y*w + x-1)*4+3] < 128 ||
            mdata[(y*w + x+1)*4+3] < 128) {
          outline[i] = 1;
        }
      }
    }
  }
  return outline;
}

// 把轮廓像素画到 ctx（粗化：1-像素宽 → 2-像素宽）
function drawOutline(ctx, outline, w, h, color) {
  const tmp = document.createElement("canvas");
  tmp.width = w; tmp.height = h;
  const tctx = tmp.getContext("2d");
  const id = tctx.createImageData(w, h);
  const r = parseInt(color.slice(1,3), 16);
  const g = parseInt(color.slice(3,5), 16);
  const b = parseInt(color.slice(5,7), 16);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (outline[y * w + x]) {
        // 2x2 块加粗
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx >= w || ny >= h) continue;
            const di = (ny * w + nx) * 4;
            id.data[di] = r; id.data[di+1] = g; id.data[di+2] = b; id.data[di+3] = 255;
          }
        }
      }
    }
  }
  tctx.putImageData(id, 0, 0);
  ctx.drawImage(tmp, 0, 0);
}

// 灰度化 + 对比度增强
function grayscaleBoost(ctx, w, h, lift = 100, mult = 1.4) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    let lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    lum = (lum - lift) * mult + lift;
    lum = Math.max(0, Math.min(255, lum));
    d[i] = d[i + 1] = d[i + 2] = lum;
  }
  ctx.putImageData(img, 0, 0);
}

// 半色调网点 - 只在 alpha > 50 的区域画点
function halftoneDots(ctx, w, h, dotSize = 2) {
  const img = ctx.getImageData(0, 0, w, h).data;
  const maxR = dotSize * 0.85; // 限制最大点大小，避免暗部糊死
  for (let y = 0; y < h; y += dotSize * 2) {
    for (let x = 0; x < w; x += dotSize * 2) {
      const i = (y * w + x) * 4;
      if (img[i + 3] < 50) continue;
      const lum = 0.299 * img[i] + 0.587 * img[i + 1] + 0.114 * img[i + 2];
      const r = Math.min((1 - lum / 255) * dotSize * 1.1, maxR);
      if (r > 0.4) {
        ctx.fillStyle = "#1a1a1a";
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function drawStar(ctx, cx, cy, r, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = (i * 72 - 90) * Math.PI / 180;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    const a2 = ((i * 72) + 36 - 90) * Math.PI / 180;
    ctx.lineTo(cx + Math.cos(a2) * r * 0.4, cy + Math.sin(a2) * r * 0.4);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// === 拼贴元素库 ===
function drawPaperNoise(ctx, w, h, count = 5000, alpha = 0.05) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * alpha})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }
}

function drawTornEdge(ctx, w, h, count = 60, color = "#f0e6d0") {
  for (let i = 0; i < count; i++) {
    if (Math.random() > 0.5) {
      ctx.fillStyle = color;
      ctx.fillRect(20 + Math.random() * (w - 40), 30 + Math.random() * (h - 60), 4, 4);
    }
  }
}

function drawCloud(ctx, x, y, w, h, color) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.bezierCurveTo(x, y + h * 0.3, x + w * 0.2, y, x + w * 0.5, y + h * 0.2);
  ctx.bezierCurveTo(x + w * 0.8, y, x + w, y + h * 0.3, x + w, y + h);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = color;
  ctx.fillRect(x - 10, y - 10, w + 20, h + 20);
  for (let i = 0; i < w * h * 0.005; i++) {
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.3})`;
    ctx.fillRect(x + Math.random() * w, y + Math.random() * h, 1, 1);
  }
  ctx.restore();
}

function drawGreekPattern(ctx, x, y, w, h, bg, fg, size = 18) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = fg;
  for (let yy = y; yy < y + h; yy += size) {
    for (let xx = x; xx < x + w; xx += size) {
      ctx.fillRect(xx, yy, size * 0.7, 2);
      ctx.fillRect(xx, yy, 2, size * 0.7);
    }
  }
  ctx.restore();
}

function drawDotGrid(ctx, x, y, w, h, color, size = 4, gap = 14) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = color;
  for (let yy = y; yy < y + h; yy += gap) {
    for (let xx = x; xx < x + w; xx += gap) {
      const off = ((yy - y) / gap) % 2 === 0 ? gap / 2 : 0;
      ctx.beginPath();
      ctx.arc(xx + off, yy, size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawNewspaperLines(ctx, x, y, w, h, color = "#1a1a1a") {
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(-0.08);
  ctx.fillStyle = color;
  const density = 12;
  for (let i = -Math.floor(h / density); i < h / density; i++) {
    ctx.fillRect(-w / 2, i * density, w, 1);
  }
  ctx.restore();
}

function drawSpiral(ctx, x, y, maxR = 80, color = "#1a1a1a") {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let t = 0; t < Math.PI * 6; t += 0.1) {
    const r = t * 5;
    const px = Math.cos(t) * r;
    const py = Math.sin(t) * r;
    if (t === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
    if (r > maxR) break;
  }
  ctx.stroke();
  ctx.restore();
}

function drawStripes(ctx, x, y, w, h, bg, gap = 5) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#000";
  for (let i = y; i < y + h; i += gap) ctx.fillRect(x, i, w, 1);
  ctx.restore();
}

function drawTriangle(ctx, x, y, w, h, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w / 2, y + h);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawRainbowDots(ctx, x, y, count = 20, size = 5) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = `hsl(${i * 20}, 70%, 55%)`;
    ctx.beginPath();
    ctx.arc(x + i * 18, y, size / 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

// === 主拼贴生成 ===
// style: 'street' | 'press' | 'minimal'
async function makeCollage(blob, style = "street", seed = Date.now() % 100000, forcedColor = "auto") {
  // === v2: 20+ 变体 + K-means 抽色 + 用户图 patch ===
  return await makeCollageV2(blob, style, seed, forcedColor);
}

// K-means 抽 4 主色 (从用户图)
async function extractPalette(blob, k = 4) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const c = document.createElement("canvas");
    c.width = 100; c.height = 100;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0, 100, 100);
    const data = ctx.getImageData(0, 0, 100, 100).data;
    const pixels = [];
    for (let i = 0; i < data.length; i += 4) {
      pixels.push([data[i], data[i+1], data[i+2]]);
    }
    // 简单 k-means
    let centers = [];
    for (let i = 0; i < k; i++) centers.push(pixels[Math.floor(Math.random() * pixels.length)]);
    for (let it = 0; it < 6; it++) {
      const groups = Array(k).fill().map(() => []);
      for (const p of pixels) {
        let minD = Infinity, minI = 0;
        for (let i = 0; i < k; i++) {
          const d = (p[0]-centers[i][0])**2 + (p[1]-centers[i][1])**2 + (p[2]-centers[i][2])**2;
          if (d < minD) { minD = d; minI = i; }
        }
        groups[minI].push(p);
      }
      for (let i = 0; i < k; i++) {
        if (groups[i].length > 0) {
          const a = [0, 0, 0];
          for (const p of groups[i]) { a[0]+=p[0]; a[1]+=p[1]; a[2]+=p[2]; }
          centers[i] = [a[0]/groups[i].length, a[1]/groups[i].length, a[2]/groups[i].length];
        }
      }
    }
    return centers.map(c => '#' + c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join(''));
  } finally {
    URL.revokeObjectURL(url);
  }
}

// 把图片加载为 Image
async function loadImageObj(blob) {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

// 准备半色调主体 (缓存)
const halftoneCache = new Map();
const personMaskCache = new Map();
const personOutlineCache = new Map();

async function getPersonMask(blob, W, H) {
  if (personMaskCache.has(blob)) return personMaskCache.get(blob);
  // 用同一张"偏移后"的图来提取 mask（保证 mask 跟实际绘制位置一致）
  const tmp = document.createElement("canvas");
  tmp.width = W; tmp.height = H;
  const tctx = tmp.getContext("2d");
  const img = await loadImageObj(blob);
  const scale = Math.max(W / img.width, H / img.height) * 1.15;
  const dw = img.width * scale, dh = img.height * scale;
  tctx.drawImage(img, (W - dw) / 2, (H - dh) / 2 - 30, dw, dh);
  const mask = await extractPersonMask(tmp, W, H);
  personMaskCache.set(blob, mask);
  return mask;
}

async function getPersonOutline(blob, W, H) {
  if (personOutlineCache.has(blob)) return personOutlineCache.get(blob);
  const mask = await getPersonMask(blob, W, H);
  const outline = maskToOutline(mask, W, H);
  personOutlineCache.set(blob, outline);
  return outline;
}

async function getHalftoneSubject(blob, W, H) {
  if (halftoneCache.has(blob)) return halftoneCache.get(blob);
  const subject = document.createElement("canvas");
  subject.width = W; subject.height = H;
  const sctx = subject.getContext("2d");
  const img = await loadImageObj(blob);
  const scale = Math.max(W / img.width, H / img.height) * 1.15;
  const dw = img.width * scale, dh = img.height * scale;
  sctx.drawImage(img, (W - dw) / 2, (H - dh) / 2 - 30, dw, dh);

  // 真实人物轮廓 mask
  const mask = await getPersonMask(blob, W, H);
  const mctx = mask.getContext("2d");
  const mdata = mctx.getImageData(0, 0, W, H).data;

  // 1. 在 mask 内填 paper 底色 + 记录每点亮度
  const id = sctx.getImageData(0, 0, W, H);
  const d = id.data;
  const lumArr = new Float32Array(W * H);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    if (mdata[i+3] < 200) {  // 硬边：alpha < 200 都当 outside
      d[i+3] = 0;
      continue;
    }
    const lum = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
    lumArr[j] = lum;
    // 底色 = 米白 #f5ecd0（比底图的浅色更亮，对比明显）
    d[i] = 245; d[i+1] = 236; d[i+2] = 208;
    d[i+3] = 255;
  }
  sctx.putImageData(id, 0, 0);

  // 2. halftone：按原图亮度在 paper 底上画黑点
  // 暗部点大（接近满），亮部点小（接近 0）
  // 用 mask alpha 显式判断（不用 lumArr === 0，因为 mask 外的 lumArr 默认 0）
  const dotSize = 2;
  sctx.fillStyle = "#1a1a1a";
  for (let y = 0; y < H; y += dotSize * 2) {
    for (let x = 0; x < W; x += dotSize * 2) {
      const mi = (y * W + x) * 4;
      if (mdata[mi+3] < 200) continue;  // 硬边 mask
      const j = y * W + x;
      const lum = lumArr[j];
      const r = (1 - lum / 255) * dotSize * 1.15;
      if (r > 0.5) {
        sctx.beginPath();
        sctx.arc(x, y, Math.min(r, dotSize * 0.95), 0, Math.PI * 2);
        sctx.fill();
      }
    }
  }

  halftoneCache.set(blob, subject);
  return subject;
}

// === 风格：5 种主风格，对应 5 张参考图 ===
// 内部有颜色/装饰变化；保证"脸不挡" + "背景稳"

// 5 个主风格的中文标签
const VARIANT_LABELS = {
  magazine:  "🎨 杂志拼贴",
  street:    "📰 街头报纸",
  torn:      "✂️ 撕贴拼贴",
  newspaper: "📰 报纸头版",
  y2k:       "✦ Y2K 描边",
};
const ALL_VARIANTS = Object.keys(VARIANT_LABELS);
// 兼容老 click handler
const VARIANT_CATS = { __all__: ALL_VARIANTS };
let lastVariant = null;
function pickRandomVariant() {
  let v;
  do { v = ALL_VARIANTS[Math.floor(Math.random() * ALL_VARIANTS.length)]; }
  while (v === lastVariant && ALL_VARIANTS.length > 1);
  lastVariant = v;
  return v;
}

// === makeCollageV2 用的辅助函数 ===
function paperBase(ctx, color = "#f0e6d0") {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);
}
function drawBurst(ctx, cx, cy, r, color, count = 12) {
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.lineTo(cx + Math.cos(a + 0.15) * r * 0.5, cy + Math.sin(a + 0.15) * r * 0.5);
    ctx.closePath();
    ctx.fill();
  }
}
function drawHeart(ctx, cx, cy, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx, cy + r * 0.3);
  ctx.bezierCurveTo(cx, cy - r * 0.5, cx - r, cy - r * 0.5, cx - r, cy + r * 0.1);
  ctx.bezierCurveTo(cx - r, cy + r * 0.5, cx, cy + r * 0.8, cx, cy + r);
  ctx.bezierCurveTo(cx, cy + r * 0.8, cx + r, cy + r * 0.5, cx + r, cy + r * 0.1);
  ctx.bezierCurveTo(cx + r, cy - r * 0.5, cx, cy - r * 0.5, cx, cy + r * 0.3);
  ctx.closePath();
  ctx.fill();
}
function drawScribble(ctx, x, y, w, h, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  let cx = x, cy = y;
  ctx.moveTo(cx, cy);
  for (let i = 0; i < 8; i++) {
    cx = x + Math.random() * w;
    cy = y + Math.random() * h;
    ctx.lineTo(cx, cy);
  }
  ctx.stroke();
}
function drawTape(ctx, x, y, w, h, color, rotation = 0) {
  ctx.save();
  ctx.translate(x + w/2, y + h/2);
  ctx.rotate(rotation);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.7;
  ctx.fillRect(-w/2, -h/2, w, h);
  ctx.restore();
}
function drawTornRect(ctx, x, y, w, h, color, edges = 8) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < edges; i++) {
    const px = x + (i/edges) * w + (Math.random()-0.5)*6;
    const py = y + (Math.random()-0.5)*4;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  for (let i = 0; i < edges; i++) ctx.lineTo(x + w + (Math.random()-0.5)*4, y + (i/edges) * h + (Math.random()-0.5)*6);
  for (let i = 0; i < edges; i++) ctx.lineTo(x + w - (i/edges) * w + (Math.random()-0.5)*6, y + h + (Math.random()-0.5)*4);
  for (let i = 0; i < edges; i++) ctx.lineTo(x + (Math.random()-0.5)*4, y + h - (i/edges) * h + (Math.random()-0.5)*6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
function drawSpiral(ctx, x, y, maxR, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let t = 0; t < Math.PI * 4; t += 0.1) {
    const r = (t / (Math.PI * 4)) * maxR;
    ctx.lineTo(x + Math.cos(t) * r, y + Math.sin(t) * r);
  }
  ctx.stroke();
}
function drawCloud(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  const cx = x + w/2, cy = y + h/2;
  ctx.beginPath();
  ctx.arc(cx - w*0.3, cy, h*0.35, 0, Math.PI*2);
  ctx.arc(cx - w*0.1, cy - h*0.2, h*0.4, 0, Math.PI*2);
  ctx.arc(cx + w*0.2, cy - h*0.1, h*0.35, 0, Math.PI*2);
  ctx.arc(cx + w*0.3, cy + h*0.05, h*0.3, 0, Math.PI*2);
  ctx.fill();
}
function drawGreek(ctx, x, y, w, h, bg, fg, size = 18) {
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = fg;
  ctx.lineWidth = 1.2;
  const step = size;
  for (let i = 0; i < w; i += step) {
    ctx.beginPath();
    ctx.moveTo(x + i, y);
    ctx.lineTo(x + i, y + h/2);
    ctx.lineTo(x + i + step/2, y + h/2);
    ctx.lineTo(x + i + step/2, y + h);
    ctx.stroke();
  }
}
function drawNewspaperLines(ctx, x, y, w, h, color, rot = -0.08) {
  ctx.save();
  ctx.translate(x + w/2, y + h/2);
  ctx.rotate(rot);
  ctx.fillStyle = color;
  const lw = w * 0.9;
  for (let i = -3; i <= 3; i++) {
    const lw2 = lw * (0.6 + Math.random() * 0.4);
    ctx.fillRect(-lw2/2, i * 4, lw2, 1.2);
  }
  ctx.restore();
}
function drawStripes(ctx, x, y, w, h, bg, gap = 7) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = bg;
  for (let yy = y - gap; yy < y + h; yy += gap * 2) {
    ctx.fillRect(x, yy, w, gap);
  }
  ctx.restore();
}
function drawDotGrid(ctx, x, y, w, h, color, size = 4, gap = 14) {
  ctx.fillStyle = color;
  for (let yy = y; yy < y + h; yy += gap) {
    for (let xx = x; xx < x + w; xx += gap) {
      ctx.beginPath();
      ctx.arc(xx, yy, size/2, 0, Math.PI*2);
      ctx.fill();
    }
  }
}
function drawCircle(ctx, x, y, r, color, stroke = null, strokeW = 1) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI*2);
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = strokeW;
    ctx.stroke();
  }
}
function drawTriangle(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + w/2, y);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
  ctx.fill();
}
function drawCircleText(ctx, cx, cy, r, text, color, fontSize = 16) {
  ctx.fillStyle = color;
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = "center";
  const text2 = text.toUpperCase();
  const total = text2.length;
  for (let i = 0; i < total; i++) {
    const a = (i / total) * Math.PI * 2 - Math.PI/2;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(a + Math.PI/2);
    ctx.fillText(text2[i], 0, 0);
    ctx.restore();
  }
  ctx.textAlign = "left";
}
function drawRainbowDots(ctx, x, y, count = 20, size = 5) {
  const colors = ["#ef4444","#f59e0b","#eab308","#22c55e","#06b6d4","#3b82f6","#a855f7","#ec4899"];
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[i % colors.length];
    ctx.beginPath();
    ctx.arc(x + (i % 5) * size * 2, y + Math.floor(i / 5) * size * 2, size/2, 0, Math.PI*2);
    ctx.fill();
  }
}

async function makeCollageV2(blob, style = null, seed = Date.now() % 100000, forcedColor = "auto") {
  const rng = mulberry32(seed);
  const rand = () => rng();
  const pick = arr => arr[Math.floor(rand() * arr.length)];
  const W = COLLAGE_W, H = COLLAGE_H;

  // 1. 抽主色（K-means 4 色，金属色族：gold / silver / purple / blue）
  let userPalette = null;
  try { userPalette = await extractPalette(blob, 4); } catch {}
  if (userPalette) userPalette = userPalette.map(c => c.toLowerCase());
  // 5 套金属色组合作为 4 色 palette（K-means 失败时随机用）
  const METAL_PALETTES = [
    // 金 + 银 + 紫 + 蓝
    ['#d4af37', '#c0c0c0', '#9d4edd', '#4cc9f0'],
    // 金 + 紫 + 蓝 + 银
    ['#f6d976', '#c77dff', '#90e0ef', '#e8e8e8'],
    // 银 + 紫 + 金 + 蓝
    ['#e8e8e8', '#9d4edd', '#d4af37', '#023e8a'],
    // 紫 + 金 + 蓝 + 银
    ['#9d4edd', '#f6d976', '#4cc9f0', '#c0c0c0'],
    // 蓝 + 金 + 银 + 紫
    ['#4cc9f0', '#d4af37', '#c0c0c0', '#9d4edd'],
  ];
  const P = userPalette || pick(METAL_PALETTES);
  // 把暗色（lum < 80）替换成金属色族里的亮色
  const METAL_BRIGHT = ['#d4af37', '#f6d976', '#c0c0c0', '#e8e8e8', '#c77dff', '#9d4edd', '#4cc9f0', '#90e0ef'];
  const lumOf = (hex) => {
    const h = hex.replace('#','');
    const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
    return 0.299*r + 0.587*g + 0.114*b;
  };
  for (let i = 0; i < P.length; i++) {
    if (lumOf(P[i]) < 80) P[i] = pick(METAL_BRIGHT);
  }

  // 卡牌底色：4 种金属色随机（金 / 银 / 紫 / 蓝）
  const METAL_BASE = [
    '#d4af37',  // 金
    '#c0c0c0',  // 银
    '#9d4edd',  // 紫
    '#4cc9f0',  // 蓝
  ];
  function pickBaseColor(forced) {
    // 如果用户强制指定颜色（来自表单的 color picker），直接用
    if (forced && typeof forced === 'string' && forced !== 'auto') {
      return forced;
    }
    // 80% 走金属族，20% 从 K-means 抽到的色里选（保照片色彩记忆）
    if (P && P.length >= 2 && rand() < 0.2) {
      const sat = (hex) => {
        const h = hex.replace('#','');
        const r = parseInt(h.slice(0,2),16)/255, g = parseInt(h.slice(2,4),16)/255, b = parseInt(h.slice(4,6),16)/255;
        const max = Math.max(r,g,b), min = Math.min(r,g,b);
        return max === 0 ? 0 : (max - min) / max;
      };
      const sorted = [...P].map(c => ({ c, sat: sat(c) })).sort((a, b) => b.sat - a.sat);
      const cand = sorted[0];
      if (sat(cand.c) >= 0.35) return cand.c;
    }
    return METAL_BASE[Math.floor(rand() * METAL_BASE.length)];
  }

  // 2. 准备主体
  const halftone = await getHalftoneSubject(blob, W, H);
  const userImg = await loadImageObj(blob);

  // 3. 画布
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");

  // 4. 选风格
  const variant = (style && VARIANT_LABELS[style]) ? style : pick(ALL_VARIANTS);

  // 5. 脸部安全区（600x800 画布）：x 175-425, y 175-450
  const FACE = { x1: 175, y1: 175, x2: 425, y2: 450 };
  const inFace = (x, y, w, h) => x < FACE.x2 && x + w > FACE.x1 && y < FACE.y2 && y + h > FACE.y1;

  // 把用户图作为碎片贴回画布
  const drawUserPatch = (x, y, w, h, shape = 'rect', rot = 0) => {
    ctx.save();
    ctx.translate(x + w/2, y + h/2);
    ctx.rotate(rot);
    if (shape === 'circle') {
      ctx.beginPath(); ctx.arc(0, 0, w/2, 0, Math.PI*2); ctx.clip();
      ctx.drawImage(userImg, -w/2, -h/2, w, h);
    } else if (shape === 'torn') {
      ctx.beginPath();
      const edges = 8;
      for (let i = 0; i < edges; i++) {
        const px = -w/2 + (i/edges)*w + (Math.random()-0.5)*8;
        const py = -h/2 + (Math.random()-0.5)*4;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      for (let i = 0; i < edges; i++) ctx.lineTo(w/2 + (Math.random()-0.5)*4, -h/2 + (i/edges)*h + (Math.random()-0.5)*8);
      for (let i = 0; i < edges; i++) ctx.lineTo(w/2 - (i/edges)*w + (Math.random()-0.5)*8, h/2 + (Math.random()-0.5)*4);
      for (let i = 0; i < edges; i++) ctx.lineTo(-w/2 + (Math.random()-0.5)*4, h/2 - (i/edges)*h + (Math.random()-0.5)*8);
      ctx.closePath(); ctx.clip();
      ctx.drawImage(userImg, -w/2, -h/2, w, h);
    } else {
      ctx.drawImage(userImg, -w/2, -h/2, w, h);
    }
    ctx.restore();
  };

  // === 风格 1: 杂志 Memphis（ref 3）===
  if (variant === 'magazine') {
    paperBase(ctx, pickBaseColor(forcedColor));

    // 顶部"紫发"梯形 — 远高于脸部 (y1=175)
    const hairColor = P[0];
    ctx.fillStyle = hairColor;
    ctx.beginPath();
    ctx.moveTo(100, 50);
    ctx.lineTo(500, 40);
    ctx.lineTo(470, 200);
    ctx.lineTo(130, 210);
    ctx.closePath();
    ctx.fill();

    // 主体（半色调）
    ctx.drawImage(halftone, 0, 0);
    // 真实人物轮廓叠加
    const outline1 = await getPersonOutline(blob, W, H);
    drawOutline(ctx, outline1, W, H, '#1a1a1a');

    // 黄色大圆 — 脸右侧外 (x 470+)
    drawCircle(ctx, 515, 260, 55, P[1] || '#d4af37');
    // 第二个小圆
    drawCircle(ctx, 540, 480, 32, P[3] || '#90e0ef');

    // 紫唇（小椭圆 — 在脸下半部但小）
    ctx.fillStyle = P[0] || '#9d4edd';
    ctx.beginPath();
    ctx.ellipse(295, 560, 26, 7, 0, 0, Math.PI*2);
    ctx.fill();

    // 底部彩色腰带（Memphis 标志）
    ctx.fillStyle = P[1] || '#d4af37';
    ctx.fillRect(0, 700, W, 100);
    // 腰带上的白点（报纸印刷感）
    ctx.fillStyle = '#f0e6d0';
    for (let i = 0; i < 40; i++) {
      ctx.fillRect(rand()*W, 720 + rand()*40, 4, 3);
    }

    // 角部小装饰
    drawTornRect(ctx, 0, 0, 80, 50, P[2] || '#c77dff');
    drawTriangle(ctx, 500, 30, 60, 60, P[3] || '#4cc9f0');

    // 底部小字
    ctx.fillStyle = '#1a1a1a';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('— MEMPHIS DAILY —', 50, 745);
  }

  // === 风格 2: 街头报纸（ref 2）===
  else if (variant === 'street') {
    paperBase(ctx, pickBaseColor(forcedColor));

    // 左上角蓝/天云
    const cloudColor = P[1];
    drawCloud(ctx, -30, -20, 280, 180, cloudColor);

    // 主体
    ctx.drawImage(halftone, 0, 0);
    // 真实人物轮廓叠加
    const outline2 = await getPersonOutline(blob, W, H);
    drawOutline(ctx, outline2, W, H, '#1a1a1a');

    // 右侧蓝色竖条纹 (脸右侧外)
    drawStripes(ctx, 530, 50, 70, 400, P[1] || '#4cc9f0', 6);

    // 底部希腊回纹 strip
    drawGreek(ctx, 0, 750, W, 50, P[3] || '#c0c0c0', '#1a1a1a', 12);

    // 右下角橙色块
    drawTornRect(ctx, 460, 600, 140, 120, P[0] || '#d4af37');

    // 上方小星星
    drawStar(ctx, 50, 30, 16, P[0] || '#9d4edd');
    drawStar(ctx, 480, 30, 12, P[2] || '#d4af37');

    // 报纸感小字
    ctx.fillStyle = '#1a1a1a';
    ctx.font = 'italic 12px Georgia';
    ctx.fillText('— caught in a moment —', 50, 740);
  }

  // === 风格 3: 撕贴拼贴（ref 5）===
  else if (variant === 'torn') {
    paperBase(ctx, pickBaseColor(forcedColor));

    // 左上大三角
    const triColor = P[0];
    drawTriangle(ctx, 30, 60, 200, 200, triColor);

    // 主体
    ctx.drawImage(halftone, 0, 0);
    // 真实人物轮廓叠加
    const outline3 = await getPersonOutline(blob, W, H);
    drawOutline(ctx, outline3, W, H, '#1a1a1a');

    // 右侧蓝色云
    const cloudColor = pick([P[1], '#4cc9f0', '#90e0ef', '#90e0ef']);
    drawCloud(ctx, 470, 50, 180, 140, cloudColor);

    // 散落的小星星（避开脸区）
    for (let i = 0; i < 8; i++) {
      let sx, sy, tries = 0;
      do {
        sx = rand() * (W - 30) + 15;
        sy = rand() * (H - 30) + 15;
        tries++;
      } while (inFace(sx - 10, sy - 10, 20, 20) && tries < 8);
      drawStar(ctx, sx, sy, 8 + rand() * 14, P[2] || '#d4af37');
    }

    // 底部撕贴布料（用用户图作为小碎片）
    drawUserPatch(40, 690, 100, 100, 'torn', 0.1);
    drawUserPatch(180, 720, 80, 60, 'rect', -0.15);
    drawUserPatch(380, 700, 120, 80, 'torn', 0.2);
    drawUserPatch(490, 720, 80, 80, 'circle', 0.3);

    // 右上角 P[3] 圆点
    drawCircle(ctx, 540, 60, 28, P[3] || '#c0c0c0');

    drawTornEdge(ctx, W, H, 50);
  }

  // === 风格 4: 报纸头版（ref 1 - 彩色人物）===
  else if (variant === 'newspaper') {
    paperBase(ctx, pickBaseColor(forcedColor));

    // 顶部大字
    ctx.fillStyle = '#1a1a1a';
    ctx.textAlign = 'center';
    ctx.font = 'bold 64px "Times New Roman", serif';
    const titles = ['NPC', 'EXTRA', 'CAUGHT!', 'SOULS', 'MEMORY', 'WANDERER'];
    ctx.fillText(pick(titles), W/2, 80);

    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('— WANDERING SOULS DAILY —', W/2, 110);

    // 主体 - 彩色（不半色调）
    ctx.drawImage(userImg, 0, 0, W, H);

    // 报纸印刷感的淡点阵（跳脸部）
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#1a1a1a';
    for (let i = 0; i < 80; i++) {
      const px = rand() * W, py = rand() * H;
      if (inFace(px, py, 3, 3)) continue;
      ctx.fillRect(px, py, 3, 3);
    }
    ctx.restore();

    // 左侧 P[0] 色块
    ctx.fillStyle = P[0];
    ctx.fillRect(0, 130, 45, 400);

    // 右侧 P[1] 色块
    ctx.fillStyle = P[1];
    ctx.fillRect(W - 45, 130, 45, 400);

    // 顶部右侧 P[2] 小方块
    ctx.fillStyle = P[2];
    ctx.fillRect(W - 80, 60, 60, 30);

    // 底部左侧 P[3] 小方块
    ctx.fillStyle = P[3];
    ctx.fillRect(20, H - 80, 30, 30);

    // 右侧对话泡
    const bubbleY = 200;
    ctx.fillStyle = '#fff8e0';
    drawTornRect(ctx, 380, bubbleY, 200, 100, '#fff8e0');
    ctx.fillStyle = '#1a1a1a';
    ctx.textAlign = 'left';
    ctx.font = 'italic 15px cursive';
    const quotes = ['I saw you there', 'we will meet again', 'stay wild', 'remember me'];
    ctx.fillText('"' + pick(quotes) + '"', 395, bubbleY + 35);
    ctx.font = '11px sans-serif';
    ctx.fillText('— a fellow wanderer', 395, bubbleY + 70);
    ctx.textAlign = 'center';

    // 底部小字
    ctx.fillStyle = '#1a1a1a';
    ctx.font = '12px sans-serif';
    ctx.fillText('Vol. ' + Math.floor(rand()*99) + ' · No. ' + Math.floor(rand()*99), W/2, 780);
  }

  // === 风格 5: Y2K 描边（ref 4 - 彩色人物）===
  else if (variant === 'y2k') {
    paperBase(ctx, pickBaseColor(forcedColor));

    // 主体 - 彩色
    ctx.drawImage(userImg, 0, 0, W, H);

    // 背景散落红/白小星星（跳脸部）
    for (let i = 0; i < 22; i++) {
      let sx, sy, tries = 0;
      do {
        sx = rand() * (W - 20) + 10;
        sy = rand() * (H - 20) + 10;
        tries++;
      } while (inFace(sx - 8, sy - 8, 16, 16) && tries < 8);
      const sz = 6 + rand() * 8;
      const c = rand() < 0.5 ? P[0] : '#ffffff';
      drawStar(ctx, sx, sy, sz, c);
    }

    // 整幅外描边（Y2K 标志）
    const outlineColor = P[1] || '#d4af37';
    ctx.save();
    ctx.strokeStyle = outlineColor;
    ctx.lineWidth = 12;
    ctx.lineJoin = 'round';
    ctx.strokeRect(30, 30, W - 60, H - 60);
    ctx.restore();

    // 边角小三角点缀
    drawTriangle(ctx, 30, 30, 40, 40, P[2] || '#c77dff');
    drawTriangle(ctx, W - 70, H - 70, 40, 40, P[3] || '#4cc9f0');

    // 底部署名
    ctx.fillStyle = '#1a1a1a';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('— NPC #' + Math.floor(rand() * 999) + ' —', W/2, 775);
    ctx.textAlign = 'left';
  }

  // 通用外框
  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  ctx.lineWidth = 1;
  ctx.strokeRect(4, 4, W - 8, H - 8);

  return await new Promise(res => canvas.toBlob(res, "image/jpeg", 0.92));
}

// 触发拼贴生成
async function runCollage(blob, style = null) {
  if (!blob) return;
  // 如果 style 明确指定,用之;否则随机选 20 个之一
  const chosenStyle = style || pickRandomVariant();
  currentCollageStyle = chosenStyle;

  if (style3dStatus) {
    style3dStatus.textContent = "🎨 正在生成拼贴艺术…";
    style3dStatus.className = "style-3d-status is-loading";
  }
  if (styleHint) {
    styleHint.textContent = "正在生成拼贴艺术 · 1-2 秒";
    styleHint.className = "style-hint is-loading";
  }

  try {
    const seed = Date.now() % 100000;
    const result = await makeCollage(blob, chosenStyle, seed, currentBaseColor);
    if (result) {
      pendingCartoon = { blob: result, url: URL.createObjectURL(result), isCollage: true };
      if (stylePreview && stylePreviewImg) {
        stylePreviewImg.src = pendingCartoon.url;
        stylePreview.hidden = false;
        const badge = document.getElementById("style-preview-badge");
        if (badge) {
          badge.textContent = VARIANT_LABELS[chosenStyle] || "🎨 拼贴";
        }
      }
      if (styleHint) {
        styleHint.textContent = "✓ 拼贴艺术已生成 · 全部本地处理，照片未上传";
        styleHint.className = "style-hint is-ready";
      }
      if (style3dStatus) {
        style3dStatus.textContent = "✓ 已生成 · 点击「换一换」可换变体";
        style3dStatus.className = "style-3d-status is-ready";
      }
      updateStylePillsUI(chosenStyle);
    }
  } catch (err) {
    console.error(err);
    if (styleHint) styleHint.textContent = "❌ 生成失败: " + err.message;
    if (style3dStatus) {
      style3dStatus.textContent = "❌ 生成失败";
      style3dStatus.className = "style-3d-status";
    }
  }
}

let currentCollageStyle = "street";

function updateStylePillsUI(active) {
  document.querySelectorAll(".style-pill").forEach(p => {
    p.classList.toggle("is-active", p.dataset.style === active);
  });
}
function populateCityList() {
  const dl = $("#city-list");
  if (!dl) return;
  dl.innerHTML = "";
  CITIES.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.name;
    opt.label = `${c.name} · ${c.country}`;
    dl.appendChild(opt);
  });
}
populateCityList();

/* ---------- 复制 prompt 消息 ---------- */
const copyBtn = $("#btn-copy-photo");
const copyHint = $("#copy-hint");

function buildMavisMessage() {
  const name = $("#f-name").value.trim() || "TA";
  const trait = $("#f-trait").value.trim() || "（用户没填特征，你可以根据图片自由发挥）";
  const styleInfo = STYLE_PROMPTS[currentStyle] || STYLE_PROMPTS.cute;
  return `请用 image_synthesize 把这张图转成「${styleInfo.label}」风格的角色卡牌肖像。

角色信息：
- 名字：${name}
- 性格 / 外貌：${trait}

要求：
- 输出 1:1 方形 PNG
- 半身像构图
- 风格：${styleInfo.prompt}

参考图见附件。完成后请把生成的图发给我。`;
}

copyBtn?.addEventListener("click", async () => {
  if (!pendingPhoto?.blob) return;
  const message = buildMavisMessage();
  try {
    await navigator.clipboard.writeText(message);
    copyBtn.classList.add("is-copied");
    copyBtn.innerHTML = '<span class="btn-icon">✓</span> 已复制消息';
    copyHint.textContent = "去 Mavis 对话贴上 + attach 上面的图";
    setTimeout(() => {
      copyBtn.classList.remove("is-copied");
      copyBtn.innerHTML = '<span class="btn-icon">📋</span> 复制完整消息';
      copyHint.textContent = "";
    }, 4000);
  } catch (err) { console.error(err); copyHint.textContent = "复制失败"; }
});

modal?.addEventListener("paste", (e) => {
  if (modal.hidden) return;
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      const blob = item.getAsFile();
      if (!blob) continue;
      if (pendingCartoon?.url) URL.revokeObjectURL(pendingCartoon.url);
      const url = URL.createObjectURL(blob);
      pendingCartoon = { blob, url };
      setUploadPreview(cartoonBox, cartoonPreview, cartoonPlaceholder, url);
      // 清掉本地风格化预览（被 AI 版本覆盖了）
      if (stylePreview) stylePreview.hidden = true;
      copyHint.textContent = "✨ 已贴入 Mavis 生成的图（覆盖本地风格化）";
      setTimeout(() => { copyHint.textContent = ""; }, 3000);
      e.preventDefault();
      return;
    }
  }
});

/* ---------- 模态框 ---------- */
function openModal() {
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  SFX.S.modalOpen();
}
function closeModal() {
  modal.hidden = true;
  document.body.style.overflow = "";
  resetForm();
  SFX.S.modalClose();
}
modal.addEventListener("click", (e) => { if (e.target.hasAttribute("data-close")) closeModal(); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!modal.hidden) closeModal();
    if (!lightbox.hidden) closeLightbox();
    if (!mapPopup.hidden) closeMapPopup();
  }
});

$("#btn-add").addEventListener("click", () => {
  editId = null;
  document.querySelector(".modal .modal-eyebrow").textContent = "— New Entry —";
  document.querySelector(".modal .modal-header h2").textContent = "记录一位新角色";
  openModal();
});

// 编辑现有 NPC：prefill form + 加载已存的图
async function openEditModal(item) {
  editId = item.id;
  // prefill 表单字段
  $("#f-name").value = item.name || "";
  $("#f-quote").value = item.quote || "";
  $("#f-when").value = item.when || "";
  $("#f-where").value = item.where || "";
  $("#f-trait").value = item.trait || "";
  $("#f-story").value = item.story || "";
  // 加载已存的实拍图
  if (item.photoKey) {
    const photoBlob = await dbGet(item.photoKey).catch(() => null);
    if (photoBlob) {
      if (pendingPhoto?.url) URL.revokeObjectURL(pendingPhoto.url);
      pendingPhoto = { blob: photoBlob, url: URL.createObjectURL(photoBlob) };
      setUploadPreview(uploadBox, uploadPreview, uploadPlaceholder, pendingPhoto.url);
    }
  }
  // 加载已存的拼贴/卡通
  if (item.cartoonKey) {
    const cartBlob = await dbGet(item.cartoonKey).catch(() => null);
    if (cartBlob) {
      if (pendingCartoon?.url) URL.revokeObjectURL(pendingCartoon.url);
      pendingCartoon = { blob: cartBlob, url: URL.createObjectURL(cartBlob), isCollage: true };
      setUploadPreview(cartoonBox, cartoonPreview, cartoonPlaceholder, pendingCartoon.url);
      if (stylePreview && stylePreviewImg) {
        stylePreviewImg.src = pendingCartoon.url;
        stylePreview.hidden = false;
        const badge = document.getElementById("style-preview-badge");
        if (badge) badge.textContent = VARIANT_LABELS[item.style] || "🎨 拼贴";
      }
    }
  } else if (pendingPhoto) {
    pendingCartoon = pendingPhoto;
  }
  // 改 modal 标题
  document.querySelector(".modal .modal-eyebrow").textContent = "— Edit —";
  document.querySelector(".modal .modal-header h2").textContent = "编辑这位 NPC";
  currentStyle = item.style || currentStyle;
  setColorPickerValue(item.baseColor || "auto");
  openModal();
}

$("#btn-clear").addEventListener("click", async () => {
  if (!confirm("确定要清空「" + getCurrentUser() + "」账户下的所有 NPC 吗？此操作不可恢复。")) return;
  const list = loadMeta();
  for (const item of list) {
    if (item.photoKey) await dbDelete(item.photoKey).catch(() => {});
    if (item.cartoonKey) await dbDelete(item.cartoonKey).catch(() => {});
  }
  saveMeta([]);
  // 重置备份状态：清空后需要重新备份
  localStorage.removeItem(`npcatcher:${getCurrentUser()}:lastBackup`);
  updateBackupIndicator();
  render();
});

/* ---------- v18: 用户 / 数据管理 ---------- */

// 用户 pill：显示当前用户
function refreshUserPill() {
  const pill = $("#user-pill-name");
  if (pill) pill.textContent = getCurrentUser();
}

// 弹窗：用户
const userPopup = $("#user-popup");
function openUserPopup() {
  renderUserList();
  userPopup.hidden = false;
  document.body.style.overflow = "hidden";
  SFX.S.modalOpen();
  setTimeout(() => $("#user-name-input").focus(), 50);
}
function closeUserPopup() {
  userPopup.hidden = true;
  document.body.style.overflow = "";
  SFX.S.modalClose();
}
function renderUserList() {
  const known = listKnownUsers();
  const cur = getCurrentUser();
  const list = $("#user-popup-list");
  // 保留 label
  const label = list.querySelector(".user-list-label");
  list.innerHTML = "";
  list.appendChild(label);
  if (known.length === 0) {
    const p = document.createElement("p");
    p.style.cssText = "font-size:12px;color:rgba(255,255,255,0.4);margin:6px 0 0;";
    p.textContent = "（还没有账户 — 在上面输入名字创建一个）";
    list.appendChild(p);
    return;
  }
  for (const u of known) {
    const row = document.createElement("div");
    row.className = "user-row" + (u === cur ? " is-current" : "");
    row.innerHTML = `<span class="user-row-name">${escapeHTML(u)}${u === cur ? " <span style='color:var(--metal-gold);font-size:11px;'>· 当前</span>" : ""}</span>
      <span class="user-row-meta">${u === cur ? "—" : "点击切换 →"}</span>`;
    row.addEventListener("click", () => {
      switchUser(u);
    });
    list.appendChild(row);
  }
}
async function switchUser(name) {
  const old = getCurrentUser();
  if (name === old) { closeUserPopup(); return; }
  setCurrentUser(name);
  // 重新加载新用户的数据
  await loadMetaAsync();
  refreshUserPill();
  render();
  closeUserPopup();
}
function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
$("#user-pill").addEventListener("click", openUserPopup);
document.querySelectorAll("[data-user-close]").forEach(el => el.addEventListener("click", closeUserPopup));
$("#user-create-btn").addEventListener("click", async () => {
  const name = $("#user-name-input").value.trim();
  if (!name) { alert("请输入账户名"); return; }
  await switchUser(name);
  $("#user-name-input").value = "";
});
$("#user-name-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); $("#user-create-btn").click(); }
});

// 弹窗：数据
const dataPopup = $("#data-popup");
function openDataPopup() {
  refreshDataStats();
  $("#data-popup-user-label").textContent = "当前账户：" + getCurrentUser();
  dataPopup.hidden = false;
  document.body.style.overflow = "hidden";
  SFX.S.modalOpen();
}
function closeDataPopup() {
  dataPopup.hidden = true;
  document.body.style.overflow = "";
  SFX.S.modalClose();
}
$("#btn-data").addEventListener("click", openDataPopup);
document.querySelectorAll("[data-data-close]").forEach(el => el.addEventListener("click", closeDataPopup));

// 存储健康
async function refreshDataStats() {
  const list = loadMeta();
  $("#stat-npc-count").textContent = list.length;
  // 计算 IDB 中所有 blob 的总大小（估算）
  let totalBytes = 0;
  try {
    const db = await openDB();
    const tx = db.transaction(DB_STORE, "readonly");
    const store = tx.objectStore(DB_STORE);
    const allKeys = await new Promise((res) => {
      const r = store.getAllKeys();
      r.onsuccess = () => res(r.result);
      r.onerror = () => res([]);
    });
    for (const k of allKeys) {
      const b = await dbGet(k).catch(() => null);
      if (b && b.size) totalBytes += b.size;
    }
  } catch {}
  const kb = totalBytes / 1024;
  $("#stat-storage-size").textContent = kb < 1024 ? `${kb.toFixed(0)} KB` : `${(kb/1024).toFixed(2)} MB`;
  const ls = lsMirrorLoad();
  if (ls && ls.ts) {
    const ago = Math.floor((Date.now() - ls.ts) / 1000);
    $("#stat-last-saved").textContent = ago < 60 ? `${ago} 秒前` : ago < 3600 ? `${Math.floor(ago/60)} 分钟前` : `${Math.floor(ago/3600)} 小时前`;
  } else {
    $("#stat-last-saved").textContent = "—";
  }
  // 上次备份时间
  const lastBackup = getLastBackupTs();
  if (lastBackup) {
    const ago = Math.floor((Date.now() - lastBackup) / 1000);
    const method = localStorage.getItem(`npcatcher:${getCurrentUser()}:lastBackupMethod`) || "export";
    const methodLabel = method === "sync" ? "同步码" : "JSON";
    let agoText;
    if (ago < 60) agoText = `${ago} 秒前`;
    else if (ago < 3600) agoText = `${Math.floor(ago/60)} 分钟前`;
    else if (ago < 86400) agoText = `${Math.floor(ago/3600)} 小时前`;
    else agoText = `${Math.floor(ago/86400)} 天前`;
    $("#stat-last-backup").textContent = `${agoText} (${methodLabel})`;
  } else {
    $("#stat-last-backup").textContent = "从未";
  }
  updateBackupIndicator();
  // 警告
  const msg = $("#data-storage-msg");
  if (kb > 50 * 1024) {
    msg.textContent = "⚠️ 数据较大（>50MB），浏览器可能会自动清理。建议定期用「导出 JSON」备份。";
    msg.className = "data-storage-msg is-warn";
  } else {
    msg.textContent = "✓ 数据同时保存在 IndexedDB 和 localStorage 两处，刷新/重启浏览器都不会丢。";
    msg.className = "data-storage-msg";
  }
}

// 存储健康事件：每次 saveMeta 触发
document.addEventListener("npc:saved", async () => {
  const el = $("#storage-health");
  if (!el) return;
  el.textContent = "✓ 已保存";
  el.className = "storage-health is-saved";
  setTimeout(() => {
    el.textContent = "";
    el.className = "storage-health";
  }, 2500);
  // 备份提醒：每累计 3 次保存但没备份过 → 弹一次性提示
  const list = loadMeta();
  const saveCount = parseInt(localStorage.getItem("npcatcher:saveCount") || "0", 10) + 1;
  localStorage.setItem("npcatcher:saveCount", String(saveCount));
  const lastBackup = getLastBackupTs();
  if (!lastBackup && saveCount >= 3 && !localStorage.getItem("npcatcher:backupNudged")) {
    localStorage.setItem("npcatcher:backupNudged", "1");
    setTimeout(() => {
      if (confirm(`你已经记录了 ${list.length} 位 NPC 🎉\n\n⚠️ 数据目前只存在你这个浏览器的本地，\n换个浏览器 / 清缓存 / 链接 404 都会丢。\n\n现在去「数据」里导出 JSON 备份吗？`)) {
        openDataPopup();
        setTimeout(() => $("#data-popup").scrollIntoView({ behavior: "smooth", block: "start" }), 200);
      }
    }, 800);
  }
});

/* ---------- 备份状态跟踪 ---------- */
function getLastBackupTs() {
  const u = getCurrentUser();
  return parseInt(localStorage.getItem(`npcatcher:${u}:lastBackup`) || "0", 10);
}
function markBackedUp(method = "export") {
  const u = getCurrentUser();
  localStorage.setItem(`npcatcher:${u}:lastBackup`, String(Date.now()));
  localStorage.setItem(`npcatcher:${u}:lastBackupMethod`, method);
  updateBackupIndicator();
  // 清除 nudge 标记
  localStorage.removeItem("npcatcher:backupNudged");
  localStorage.setItem("npcatcher:saveCount", "0");
}
function updateBackupIndicator() {
  const el = $("#backup-status");
  if (!el) return;
  const ts = getLastBackupTs();
  if (!ts) {
    el.textContent = "未备份";
    el.className = "backup-status is-warn";
    el.title = "数据只存在本地浏览器，建议定期导出 JSON 备份";
  } else {
    const ago = Math.floor((Date.now() - ts) / 1000);
    let text;
    if (ago < 60) text = "刚刚已备份";
    else if (ago < 3600) text = `${Math.floor(ago/60)} 分钟前已备份`;
    else if (ago < 86400) text = `${Math.floor(ago/3600)} 小时前已备份`;
    else text = `${Math.floor(ago/86400)} 天前已备份`;
    el.textContent = "✓ " + text;
    el.className = "backup-status is-ok";
    el.title = "点「数据」查看详情";
  }
}

/* ---------- 首次访问：数据安全说明 ---------- */
function maybeShowOnboarding() {
  const u = getCurrentUser();
  if (localStorage.getItem(`npcatcher:${u}:onboarded`)) return;
  // 首次访问（无论有没有数据）都弹一次
  setTimeout(() => showOnboarding(), 1500);
}
function showOnboarding() {
  const modal = $("#onboarding-modal");
  if (!modal) return;
  modal.hidden = false;
  SFX.S.notify();
}
function dismissOnboarding() {
  const u = getCurrentUser();
  localStorage.setItem(`npcatcher:${u}:onboarded`, "1");
  const modal = $("#onboarding-modal");
  if (modal) modal.hidden = true;
}
// Onboarding modal 事件
const onboardingModal = $("#onboarding-modal");
if (onboardingModal) {
  onboardingModal.addEventListener("click", (e) => {
    if (e.target.hasAttribute("data-onboard-close")) dismissOnboarding();
  });
  $("#btn-onboard-export")?.addEventListener("click", async () => {
    dismissOnboarding();
    SFX.S.click();
    const n = await exportAll();
    markBackedUp("export");
    alert(`✅ 已导出 ${n} 条 NPC。\n\n这份 JSON 文件已下载到你的电脑。\n建议把它存到云盘 / 微信收藏 / 邮箱草稿 — 多备份一份。`);
  });
}

// ===== 导出 JSON =====
async function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result.split(",")[1]);
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(blob);
  });
}
async function base64ToBlob(b64, type) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: type || "application/octet-stream" });
}
async function exportAll() {
  const list = loadMeta();
  const enriched = [];
  for (const it of list) {
    const o = { ...it };
    if (it.photoKey) {
      const b = await dbGet(it.photoKey).catch(() => null);
      if (b) { o.photo = { b64: await blobToBase64(b), type: b.type }; }
    }
    if (it.cartoonKey) {
      const b = await dbGet(it.cartoonKey).catch(() => null);
      if (b) { o.cartoon = { b64: await blobToBase64(b), type: b.type }; }
    }
    enriched.push(o);
  }
  const payload = {
    format: "npcatcher/v1",
    user: getCurrentUser(),
    exportedAt: new Date().toISOString(),
    npcs: enriched,
  };
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `npcatcher_${getCurrentUser()}_${Date.now()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return enriched.length;
}
$("#btn-export-json").addEventListener("click", async () => {
  const n = await exportAll();
  markBackedUp("export");
  alert(`已导出 ${n} 条 NPC 数据到 JSON 文件。\n\n✅ 这份文件已下载到你的电脑，存好它就是备份。`);
});

// ===== 导入 JSON =====
$("#btn-import-json").addEventListener("click", () => $("#import-file-input").click());
$("#import-file-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!confirm("导入会覆盖当前账户「" + getCurrentUser() + "」的全部数据，确定吗？\n（建议先点「导出 JSON」备份）")) {
    e.target.value = "";
    return;
  }
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data.format || data.format !== "npcatcher/v1") throw new Error("文件格式不匹配 (npcatcher/v1)");
    // 清空当前用户
    const oldList = loadMeta();
    for (const it of oldList) {
      if (it.photoKey) await dbDelete(it.photoKey).catch(() => {});
      if (it.cartoonKey) await dbDelete(it.cartoonKey).catch(() => {});
    }
    // 写入新的
    const newList = [];
    for (const it of (data.npcs || [])) {
      const o = { ...it };
      delete o.photo; delete o.cartoon;
      if (it.photo) {
        const blob = await base64ToBlob(it.photo.b64, it.photo.type);
        await dbPut(it.photoKey, blob);
      }
      if (it.cartoon) {
        const blob = await base64ToBlob(it.cartoon.b64, it.cartoon.type);
        await dbPut(it.cartoonKey, blob);
      }
      newList.push(o);
    }
    saveMeta(newList);
    render();
    alert(`✓ 已导入 ${newList.length} 条 NPC 数据。`);
    refreshDataStats();
  } catch (err) {
    alert("导入失败：" + err.message);
  }
  e.target.value = "";
});

// ===== 同步码（base64 编码 JSON，不压缩以保证可靠性）=====
// 用 Unicode-safe 的 base64 编码
function strToBase64(str) {
  // 先把字符串转成 UTF-8 字节再 base64
  const utf8 = unescape(encodeURIComponent(str));
  return btoa(utf8);
}
function base64ToStr(b64) {
  const bin = atob(b64);
  return decodeURIComponent(escape(bin));
}

async function buildSyncCode() {
  const list = loadMeta();
  // 同步码不包含 photo blob（太大），只包含元数据 + cartoon（已拼贴好的小图）
  const compact = [];
  for (const it of list) {
    const o = {
      id: it.id, name: it.name, quote: it.quote, when: it.when, where: it.where,
      city: it.city, coords: it.coords, trait: it.trait, story: it.story,
      style: it.style, baseColor: it.baseColor, createdAt: it.createdAt,
      photoKey: it.photoKey, cartoonKey: it.cartoonKey,
    };
    if (it.cartoonKey) {
      const b = await dbGet(it.cartoonKey).catch(() => null);
      if (b) {
        // cartoon 缩到 600x800 JPEG q=0.7 以减小尺寸
        const dataUrl = await new Promise((res) => {
          const url = URL.createObjectURL(b);
          const img = new Image();
          img.onload = () => {
            const c = document.createElement("canvas");
            const max = 600;
            const s = Math.min(1, max / Math.max(img.width, img.height));
            c.width = Math.round(img.width * s);
            c.height = Math.round(img.height * s);
            c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
            c.toBlob((nb) => {
              const fr = new FileReader();
              fr.onload = () => res(fr.result);
              fr.readAsDataURL(nb);
              URL.revokeObjectURL(url);
            }, "image/jpeg", 0.7);
          };
          img.src = url;
        });
        o.cartoon = dataUrl;
      }
    }
    compact.push(o);
  }
  const payload = {
    format: "npcatcher-sync/v1",
    user: getCurrentUser(),
    ts: Date.now(),
    npcs: compact,
  };
  const json = JSON.stringify(payload);
  const code = "NPCSYNC1:" + strToBase64(json);
  return { code, count: compact.length, len: code.length };
}

$("#btn-gen-sync-code").addEventListener("click", async () => {
  const hint = $("#sync-code-hint");
  hint.textContent = "正在打包数据…";
  hint.className = "sync-code-hint";
  try {
    const { code, count, len } = await buildSyncCode();
    $("#sync-code-area").hidden = false;
    $("#sync-code-text").value = code;
    hint.textContent = `✓ 已生成 ${count} 条 NPC 的同步码，长度 ${(len/1024).toFixed(1)} KB。复制后到另一台设备点「导入这段同步码」即可还原。`;
    hint.className = "sync-code-hint is-ok";
    markBackedUp("sync");
  } catch (e) {
    hint.textContent = "生成失败：" + e.message;
    hint.className = "sync-code-hint is-error";
  }
});
$("#btn-show-sync-input").addEventListener("click", () => {
  $("#sync-code-area").hidden = false;
  $("#sync-code-text").value = "";
  $("#sync-code-text").focus();
  $("#sync-code-hint").textContent = "把另一台设备上的同步码粘贴到上面文本框，然后点「导入这段同步码」。";
  $("#sync-code-hint").className = "sync-code-hint";
});
$("#btn-copy-sync-code").addEventListener("click", async () => {
  const t = $("#sync-code-text").value;
  if (!t) return;
  try { await navigator.clipboard.writeText(t); alert("已复制到剪贴板"); }
  catch { alert("复制失败，请手动选中复制"); }
});
$("#btn-apply-sync-code").addEventListener("click", async () => {
  const code = $("#sync-code-text").value.trim();
  if (!code) { alert("请先粘贴同步码"); return; }
  if (!code.startsWith("NPCSYNC1:")) { alert("同步码格式不对（应以 NPCSYNC1: 开头）"); return; }
  if (!confirm("导入同步码会覆盖当前账户「" + getCurrentUser() + "」的数据，确定吗？")) return;
  const hint = $("#sync-code-hint");
  hint.textContent = "正在解析…";
  hint.className = "sync-code-hint";
  try {
    const json = base64ToStr(code.slice("NPCSYNC1:".length));
    const data = JSON.parse(json);
    if (data.format !== "npcatcher-sync/v1") throw new Error("格式不匹配");
    // 清空当前
    const oldList = loadMeta();
    for (const it of oldList) {
      if (it.photoKey) await dbDelete(it.photoKey).catch(() => {});
      if (it.cartoonKey) await dbDelete(it.cartoonKey).catch(() => {});
    }
    // 写入
    const newList = [];
    for (const it of (data.npcs || [])) {
      const o = { ...it };
      delete o.cartoon;
      if (it.cartoon && typeof it.cartoon === "string") {
        // dataURL → blob
        const r = await fetch(it.cartoon);
        const blob = await r.blob();
        await dbPut(it.cartoonKey, blob);
      }
      newList.push(o);
    }
    saveMeta(newList);
    render();
    hint.textContent = `✓ 已从同步码导入 ${newList.length} 条 NPC。`;
    hint.className = "sync-code-hint is-ok";
  } catch (e) {
    hint.textContent = "导入失败：" + e.message;
    hint.className = "sync-code-hint is-error";
  }
});

// ===== 危险区 =====
$("#btn-clear-current-user").addEventListener("click", async () => {
  if (!confirm("确认清空「" + getCurrentUser() + "」账户下的所有 NPC？")) return;
  const list = loadMeta();
  for (const it of list) {
    if (it.photoKey) await dbDelete(it.photoKey).catch(() => {});
    if (it.cartoonKey) await dbDelete(it.cartoonKey).catch(() => {});
  }
  saveMeta([]);
  render();
  refreshDataStats();
});
$("#btn-wipe-all").addEventListener("click", async () => {
  if (!confirm("⚠️ 确认清空所有账户的所有数据？\n（IDB 中所有 blob + localStorage 中所有 metadata）")) return;
  if (!confirm("真的真的要清空？这个操作没法恢复。")) return;
  try {
    const db = await openDB();
    await new Promise((res, rej) => {
      const tx = db.transaction([DB_STORE, META_STORE], "readwrite");
      tx.objectStore(DB_STORE).clear();
      tx.objectStore(META_STORE).clear();
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch {}
  try {
    // 清空所有 npcatcher:* localStorage key
    const toDel = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("npcatcher:")) toDel.push(k);
    }
    toDel.forEach(k => localStorage.removeItem(k));
  } catch {}
  await loadMetaAsync();
  render();
  refreshDataStats();
  alert("已清空所有数据。");
});

function resetForm() {
  form.reset();
  pendingPhoto = null;
  pendingCartoon = null;
  uploadPreview.hidden = true;
  uploadPreview.src = "";
  uploadPlaceholder.style.display = "";
  uploadBox.classList.remove("has-image");
  cartoonPreview.hidden = true;
  cartoonPreview.src = "";
  cartoonPlaceholder.style.display = "";
  cartoonBox.classList.remove("has-image");
  if (copyBtn) copyBtn.disabled = true;
  if (copyHint) copyHint.textContent = "";
  if (fileInput) fileInput.value = "";
  if (cartoonInput) cartoonInput.value = "";
  // 重置 modal 标题回 "New Entry"
  document.querySelector(".modal .modal-eyebrow").textContent = "— New Entry —";
  document.querySelector(".modal .modal-header h2").textContent = "记录一位新角色";
  // 重试/换一换按钮文字重置
  if (style3dStatus) {
    style3dStatus.textContent = "未加载 · 上传照片后自动跑";
    style3dStatus.className = "style-3d-status";
  }

  if (stylePreview) {
    stylePreview.hidden = true;
    if (stylePreviewImg) stylePreviewImg.src = "";
  }
  if (styleHint) styleHint.textContent = "上传照片后自动用拼贴艺术处理 · 浏览器本地完成，不上传任何数据";
  if (style3dStatus) {
    style3dStatus.textContent = "未加载 · 上传照片后自动跑";
    style3dStatus.className = "style-3d-status";
  }
  currentStyle = null;
  // 重置底色选择为 auto
  currentBaseColor = "auto";
  if (colorPicker) {
    colorPicker.querySelectorAll(".color-swatch").forEach(s => {
      s.classList.toggle("is-active", s.dataset.color === "auto");
    });
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!pendingPhoto) { alert("请先上传一张人物实拍图。"); return; }
  const cityRaw = $("#f-where").value.trim();
  const cityMatch = findCity(cityRaw);
  const data = {
    id: editId || genId(),
    name: $("#f-name").value.trim(),
    quote: $("#f-quote").value.trim(),
    when: $("#f-when").value.trim(),
    where: cityRaw,
    city: cityMatch ? cityMatch.name : null,
    coords: cityMatch ? { lat: cityMatch.lat, lng: cityMatch.lng, country: cityMatch.country } : null,
    trait: $("#f-trait").value.trim(),
    story: $("#f-story").value.trim(),
    style: currentStyle,
    baseColor: currentBaseColor,
    createdAt: editId ? (loadMeta().find(x => x.id === editId)?.createdAt || Date.now()) : Date.now(),
  };
  if (!data.name) { alert("请填写 TA 的名字。"); return; }
  if (!data.where) { alert("请填写相遇城市（可以从下拉里选）。"); return; }
  showLoading(true);
  SFX.S.magic();
  try {
    let list = loadMeta();
    const photoKey = "photo_" + data.id;
    const cartoonKey = "cartoon_" + data.id;
    await dbPut(photoKey, pendingPhoto.blob);
    if (pendingCartoon && pendingCartoon.blob !== pendingPhoto.blob) {
      await dbPut(cartoonKey, pendingCartoon.blob);
    }
    data.photoKey = photoKey;
    data.cartoonKey = (pendingCartoon && pendingCartoon.blob !== pendingPhoto.blob) ? cartoonKey : null;
    if (editId) list = list.map(x => x.id === editId ? data : x);
    else list.unshift(data);
    saveMeta(list);
    SFX.S.success();
    closeModal();
    render();
  } catch (err) {
    console.error(err);
    SFX.S.error();
    alert("保存失败：" + err.message);
  } finally {
    showLoading(false);
  }
});

function showLoading(show) {
  loading.hidden = !show;
  if (show) document.body.style.overflow = "hidden";
  else document.body.style.overflow = (modal.hidden && mapPopup.hidden) ? "" : "hidden";
}

/* ---------- 时间解析：把 "when" 字段转成时间戳 ---------- */
// 支持格式：2025.01.15 / 2025-01-15 / 2025/01/15 / 2025年1月 / "3 days ago" / "上周三"...
// 解析失败时回退 0
function parseMeetTime(when) {
  if (!when) return 0;
  const s = String(when).trim();
  if (!s) return 0;
  // 1) 标准日期格式
  const m1 = s.match(/(\d{4})[.\-/年](\d{1,2})[.\-/月](\d{1,2})/);
  if (m1) {
    const y = +m1[1], mo = +m2(m1[2]) - 1, d = +m3(m1[3]);
    const dt = new Date(y, mo, d);
    if (!isNaN(dt.getTime())) return dt.getTime();
  }
  // 2) 只有年-月
  const m2m = s.match(/(\d{4})[.\-/年](\d{1,2})/);
  if (m2m) {
    const dt = new Date(+m2m[1], +m2m[2] - 1, 1);
    if (!isNaN(dt.getTime())) return dt.getTime();
  }
  // 3) Date 通用解析（兜底，能认 "Jan 15 2025" / ISO 等）
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) return dt.getTime();
  return 0;
}
function m2(x) { return x; } // 留作 hook
function m3(x) { return x; }

/* ---------- 渲染卡牌 ---------- */
async function render() {
  const list = loadMeta();
  // 按相遇时间升序：最早的相遇在左/最上
  // 解析 "when" 字段，无法解析时回退 createdAt
  const sortKey = (it) => {
    const t = parseMeetTime(it.when);
    return t > 0 ? t : (it.createdAt || 0);
  };
  list.sort((a, b) => sortKey(a) - sortKey(b));
  Array.from(gallery.children).forEach(c => { if (c.id !== "empty-state") c.remove(); });

  $("#stat-souls").textContent = `${list.length} 个灵魂`;
  $("#stat-meets").textContent = `${list.length} 次相遇`;

  if (list.length === 0) {
    emptyState.style.display = "";
  } else {
    emptyState.style.display = "none";
  }

  const tpl = $("#card-tpl");
  for (const item of list) {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.dataset.id = item.id;

    node.querySelector(".card-name").textContent = item.name;
    node.querySelector(".card-quote").textContent = item.quote || "—";
    node.querySelector(".meet-when").textContent = item.when || "—";
    node.querySelector(".meet-where").textContent = item.where || "—";

    const portraitKey = item.cartoonKey || item.photoKey;
    const portraitImg = node.querySelector(".card-portrait-img");
    const cardArt = node.querySelector(".card-art");
    if (portraitKey) {
      const portraitBlob = await dbGet(portraitKey).catch(() => null);
      if (portraitBlob) {
        const url = URL.createObjectURL(portraitBlob);
        portraitImg.src = url;
        node.querySelector(".card-ribbon").textContent = item.cartoonKey ? "✨ Portrait" : "📷 Snapshot";
        // 没卡通版时给照片加 Y2K 滤镜
        if (!item.cartoonKey) cardArt.classList.add("no-cartoon");
      }
    }

    node.querySelector(".back-name").textContent = item.name;
    node.querySelector(".back-meta").textContent = [item.when, item.where].filter(Boolean).join(" · ") || "—";
    node.querySelector(".back-trait").textContent = item.trait || "—";
    node.querySelector(".back-story").textContent = item.story || "（暂无故事）";

    const photoBlob = item.photoKey ? await dbGet(item.photoKey).catch(() => null) : null;
    const photoEl = node.querySelector(".back-photo");
    const photoImg = node.querySelector(".back-photo-img");
    if (photoBlob) {
      const url = URL.createObjectURL(photoBlob);
      photoImg.src = url;
      photoEl.style.cursor = "zoom-in";
      photoEl.addEventListener("click", (e) => { e.stopPropagation(); openLightbox(url); });
    }

    const card = node.querySelector(".card");
    card.addEventListener("click", (e) => {
      if (e.target.closest(".card-actions")) return;
      if (e.target.closest(".back-photo")) return;
      // 点击卡牌进入聚焦模式（同时显示背面 = 照片+故事）
      openCardFocus(item);
    });
    node.querySelector(".card-btn.flip").addEventListener("click", (e) => {
      e.stopPropagation();
      openCardFocus(item);
    });
    node.querySelector(".card-btn.edit").addEventListener("click", (e) => {
      e.stopPropagation();
      openEditModal(item);
    });
    node.querySelector(".card-btn.delete").addEventListener("click", async () => {
      if (!confirm(`确定要删除「${item.name}」吗？`)) return;
      let newList = loadMeta().filter(x => x.id !== item.id);
      saveMeta(newList);
      if (item.photoKey) await dbDelete(item.photoKey).catch(() => {});
      if (item.cartoonKey) await dbDelete(item.cartoonKey).catch(() => {});
      render();
    });

    gallery.appendChild(node);
  }

  // 渲染地图
  renderMap(list);
}

/* ---------- 世界地图 ---------- */
let currentCountry = "__world__"; // 当前钻取的国家（"__world__" = 全球）
let countryPillsBuilt = false;

function renderMap(list) {
  if (!mapMarkers) return;
  mapMarkers.innerHTML = "";
  // 按坐标分组
  const byCity = new Map();
  list.forEach(item => {
    if (item.coords) {
      const key = `${item.coords.lat},${item.coords.lng}`;
      if (!byCity.has(key)) byCity.set(key, { coords: item.coords, name: item.city || item.where, country: item.coords.country, items: [] });
      byCity.get(key).items.push(item);
    }
  });
  if (byCity.size === 0) {
    mapEmpty.classList.remove("hidden");
    return;
  }
  mapEmpty.classList.add("hidden");

  // 收集有 NPC 的国家
  const countries = new Set();
  byCity.forEach(g => { if (g.country) countries.add(g.country); });

  // 渲染国家选择条
  renderCountryPills(countries, byCity);

  // 过滤：只显示当前国家的城市
  const toShow = currentCountry === "__world__"
    ? Array.from(byCity.values())
    : Array.from(byCity.values()).filter(g => g.country === currentCountry);

  // 给 close 的城市错开标签方向（上下交替）
  const labelOffsets = toShow.map(() => ({ y: -14, countY: 20 }));
  if (toShow.length > 1) {
    // 按 y 排序，相邻的交替
    const indexed = toShow.map((g, i) => ({ ...g, _i: i, _y: projectToMap(g.coords.lat, g.coords.lng).y, _x: projectToMap(g.coords.lat, g.coords.lng).x }));
    indexed.sort((a, b) => a._y - b._y);
    for (let i = 0; i < indexed.length; i++) {
      const cur = indexed[i];
      const prev = indexed[i - 1];
      const next = indexed[i + 1];
      // 如果和上一个或下一个很近，反转方向
      if (prev && Math.abs(cur._y - prev._y) < 30) {
        labelOffsets[cur._i] = { y: cur._x < prev._x ? -14 : 14, countY: cur._x < prev._x ? 20 : 20 };
        labelOffsets[prev._i] = { y: prev._x < cur._x ? -14 : 14, countY: 20 };
      }
    }
  }

  toShow.forEach((group, i) => {
    const { x, y } = projectToMap(group.coords.lat, group.coords.lng);
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", "marker");
    g.setAttribute("transform", `translate(${x}, ${y})`);
    g.setAttribute("data-city", group.name);
    g.setAttribute("data-country", group.country || "");
    g.setAttribute("data-count", group.items.length);
    g.style.cursor = "pointer";
    const isZoomed = currentCountry !== "__world__";
    const starSize = isZoomed ? 2 : 1;
    const labelY = labelOffsets[i]?.y ?? -14;
    const countY = labelOffsets[i]?.countY ?? 20;
    g.innerHTML = `
      <circle class="marker-pulse" r="${isZoomed ? 10 : 8}" />
      <path class="marker-star" transform="scale(${starSize})" d="M 0 -5 L 1.5 -1.5 L 5 -1.5 L 2.2 0.8 L 3 4.5 L 0 2.5 L -3 4.5 L -2.2 0.8 L -5 -1.5 L -1.5 -1.5 Z" />
      ${isZoomed ? `
        <text class="marker-label" x="0" y="${labelY}" text-anchor="middle">${escapeHtml(group.name)}</text>
        <text class="marker-count" x="0" y="${countY}" text-anchor="middle">${group.items.length} 个灵魂</text>
      ` : ""}
    `;
    g.addEventListener("click", () => openMapPopup(group));
    mapMarkers.appendChild(g);
  });
}

/* ---------- 国家选择条 ---------- */
function renderCountryPills(countries, byCity) {
  const wrap = $("#map-countries");
  if (!wrap) return;
  // 第一次构建：插入所有已知国家（收集过的可点，没收集过的灰显）
  if (!countryPillsBuilt) {
    const allCountries = Object.keys(COUNTRY_BOUNDS);
    // 已收集的优先
    const collected = Array.from(countries);
    const uncollected = allCountries.filter(c => !countries.has(c));
    const ordered = [...collected, ...uncollected];
    ordered.forEach(c => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "country-pill";
      btn.dataset.country = c;
      const flag = COUNTRY_FLAGS[c] || "🏳";
      const count = byCity ? (Array.from(byCity.values()).filter(g => g.country === c).reduce((s, g) => s + g.items.length, 0)) : 0;
      btn.innerHTML = `<span class="cp-flag">${flag}</span> ${escapeHtml(c)}${count > 0 ? ` <span class="cp-count">${count}</span>` : ""}`;
      if (count === 0) btn.classList.add("is-empty");
      btn.addEventListener("click", () => onCountryPillClick(c, btn));
      wrap.appendChild(btn);
    });
    countryPillsBuilt = true;
  } else {
    // 更新 count 和 active 状态
    wrap.querySelectorAll(".country-pill").forEach(p => {
      const c = p.dataset.country;
      if (c === "__world__") return;
      const count = Array.from(byCity.values()).filter(g => g.country === c).reduce((s, g) => s + g.items.length, 0);
      const flag = COUNTRY_FLAGS[c] || "🏳";
      const countHtml = count > 0 ? ` <span class="cp-count">${count}</span>` : "";
      p.innerHTML = `<span class="cp-flag">${flag}</span> ${escapeHtml(c)}${countHtml}`;
      p.classList.toggle("is-empty", count === 0);
    });
  }
  // 高亮 active
  wrap.querySelectorAll(".country-pill").forEach(p => {
    p.classList.toggle("is-active", p.dataset.country === currentCountry);
  });

  // 给「全球」按钮绑定事件（HTML 里的没绑）
  const worldPill = wrap.querySelector('.country-pill[data-country="__world__"]');
  if (worldPill && !worldPill.dataset.bound) {
    worldPill.dataset.bound = "1";
    worldPill.addEventListener("click", () => onCountryPillClick("__world__", worldPill));
  }
}

function onCountryPillClick(country, btn) {
  if (country !== "__world__") {
    const isEmpty = btn.classList.contains("is-empty");
    if (isEmpty) {
      // 没收集过该国 → 抖动提示
      btn.animate(
        [{ transform: "translateX(0)" }, { transform: "translateX(-4px)" }, { transform: "translateX(4px)" }, { transform: "translateX(0)" }],
        { duration: 300 }
      );
      return;
    }
  }
  currentCountry = country;
  // 重新渲染标记
  renderMap(loadMeta());
  // 动画 viewBox
  const svg = $("#world-map");
  const back = $("#back-to-world");
  const hint = $("#map-zoom-hint");
  if (country === "__world__") {
    back.hidden = true;
    hint.hidden = true;
    svg.classList.remove("is-zoomed");
    animateViewBox(svg, currentVb, { x: 0, y: 0, w: 950, h: 620 }, 600);
  } else {
    back.hidden = false;
    hint.hidden = false;
    hint.querySelector("#zoom-hint-text").textContent = `已钻入 ${country} · 点击星星查看该城市的灵魂`;
    svg.classList.add("is-zoomed");
    // 用国家/地区标准边界钻取（确保整个国家可见，不会因 NPC 太集中而过度放大）
    const bounds = COUNTRY_BOUNDS[country];
    const target = boundsToViewBox(bounds, 0.25);
    animateViewBox(svg, currentVb, target, 800);
  }
  // 滚动 active pill 到可视区
  btn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
}

function animateViewBox(svg, from, to, duration = 600) {
  const start = performance.now();
  isAnimating = true;
  function step(now) {
    const t = Math.min(1, (now - start) / duration);
    // easeInOutCubic
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const vb = {
      x: from.x + (to.x - from.x) * e,
      y: from.y + (to.y - from.y) * e,
      w: from.w + (to.w - from.w) * e,
      h: from.h + (to.h - from.h) * e,
    };
    svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    currentVb = vb;
    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      isAnimating = false;
    }
  }
  requestAnimationFrame(step);
}

function openMapPopup(group) {
  $("#map-popup-city").textContent = group.name;
  $("#map-popup-count").textContent = `${group.items.length} 个灵魂在这里与你擦肩`;
  const list = $("#map-popup-list");
  list.innerHTML = "";
  group.items.forEach(async item => {
    const div = document.createElement("div");
    div.className = "popup-npc";
    div.innerHTML = `
      <div class="popup-npc-avatar" id="pop-av-${item.id}"></div>
      <div class="popup-npc-info">
        <p class="popup-npc-name">${escapeHtml(item.name)}</p>
        <p class="popup-npc-when">${escapeHtml(item.when || "—")}${item.coords?.country ? " · " + escapeHtml(item.coords.country) : ""}</p>
      </div>
    `;
    div.addEventListener("click", () => {
      closeMapPopup();
      // 滚动到该 NPC 卡牌
      setTimeout(() => {
        const card = document.querySelector(`.card-wrap[data-id="${item.id}"]`);
        if (card) {
          card.scrollIntoView({ behavior: "smooth", block: "center" });
          card.querySelector(".card")?.classList.add("is-flipped");
        }
      }, 300);
    });
    list.appendChild(div);
    // 加载头像
    const blob = await dbGet(item.photoKey || item.cartoonKey).catch(() => null);
    if (blob) {
      const av = document.getElementById(`pop-av-${item.id}`);
      if (av) av.style.backgroundImage = `url(${URL.createObjectURL(blob)})`;
    }
  });
  mapPopup.hidden = false;
  document.body.style.overflow = "hidden";
  SFX.S.modalOpen();
}

function closeMapPopup() {
  mapPopup.hidden = true;
  document.body.style.overflow = "";
  SFX.S.modalClose();
}
mapPopup?.addEventListener("click", (e) => {
  if (e.target.hasAttribute("data-popup-close")) closeMapPopup();
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- 地图拖动 / 缩放 ---------- */
let currentVb = { x: 0, y: 0, w: 950, h: 620 };
let isAnimating = false;
let didDrag = false; // 区分 click vs drag
let mouseDownPt = null;
(function setupMapInteractions() {
  if (!mapContainer) return;
  const svg = $("#world-map");
  let isDragging = false;
  let startPt = null;
  let startVb = null;

  function updateVb() {
    if (isAnimating) return; // 动画过程中不直接覆写
    svg.setAttribute("viewBox", `${currentVb.x} ${currentVb.y} ${currentVb.w} ${currentVb.h}`);
  }

  mapContainer.addEventListener("mousedown", (e) => {
    if (e.target.closest(".marker")) return;
    if (e.target.closest(".back-to-world")) return;
    if (isAnimating) return;
    isDragging = true;
    didDrag = false;
    mouseDownPt = { x: e.clientX, y: e.clientY };
    mapContainer.classList.add("is-dragging");
    startPt = { x: e.clientX, y: e.clientY };
    startVb = { ...currentVb };
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    if (mouseDownPt) {
      const dx = e.clientX - mouseDownPt.x;
      const dy = e.clientY - mouseDownPt.y;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) didDrag = true;
    }
    const rect = mapContainer.getBoundingClientRect();
    const scaleX = startVb.w / rect.width;
    const scaleY = startVb.h / rect.height;
    const dx = (e.clientX - startPt.x) * scaleX;
    const dy = (e.clientY - startPt.y) * scaleY;
    currentVb.x = startVb.x - dx;
    currentVb.y = startVb.y - dy;
    updateVb();
  });
  window.addEventListener("mouseup", (e) => {
    if (!isDragging) {
      isDragging = false;
      mapContainer.classList.remove("is-dragging");
      return;
    }
    isDragging = false;
    mapContainer.classList.remove("is-dragging");

    // 没有拖动 → 当作 click
    if (!didDrag && mouseDownPt) {
      const rect = mapContainer.getBoundingClientRect();
      const scaleX = currentVb.w / rect.width;
      const scaleY = currentVb.h / rect.height;
      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      const svgX = currentVb.x + localX * scaleX;
      const svgY = currentVb.y + localY * scaleY;
      const { lat, lng } = svgPointToLatLng(svgX, svgY);
      const country = findCountryAt(lat, lng);
      if (country) {
        // 找到 country pill 触发 zoom
        const pill = document.querySelector(`.country-pill[data-country="${country}"]`);
        if (pill) onCountryPillClick(country, pill);
        return;
      }
      // 没找到国家 → 尝试 zoom out 回全球（如果在 zoomed 状态）
      if (currentCountry !== "__world__") {
        const worldPill = document.querySelector('.country-pill[data-country="__world__"]');
        if (worldPill) onCountryPillClick("__world__", worldPill);
      }
    }
  });

  mapContainer.addEventListener("wheel", (e) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.15 : 0.87;
    const rect = mapContainer.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    const newW = Math.max(200, Math.min(3000, currentVb.w * factor));
    const newH = Math.max(150, Math.min(2000, currentVb.h * factor));
    currentVb.x += (currentVb.w - newW) * px;
    currentVb.y += (currentVb.h - newH) * py;
    currentVb.w = newW;
    currentVb.h = newH;
    updateVb();
  }, { passive: false });

  // 返回全球按钮
  document.getElementById("back-to-world")?.addEventListener("click", () => {
    currentCountry = "__world__";
    renderMap(loadMeta());
    const hint = $("#map-zoom-hint");
    const back = $("#back-to-world");
    back.hidden = true;
    if (hint) hint.hidden = true;
    svg.classList.remove("is-zoomed");
    animateViewBox(svg, { ...currentVb }, { x: 0, y: 0, w: 950, h: 620 }, 600);
  });
})();

/* ---------- Lightbox ---------- */
function openLightbox(url) { lightboxImg.src = url; lightbox.hidden = false; document.body.style.overflow = "hidden"; SFX.S.notify(); }
function closeLightbox() { lightbox.hidden = true; lightboxImg.src = ""; document.body.style.overflow = ""; SFX.S.modalClose(); }

/* ---------- 卡牌聚焦模式 ---------- */
const cardFocus = $("#card-focus");
let cardFocusCurrentId = null;
async function openCardFocus(item) {
  if (!cardFocus) return;
  cardFocusCurrentId = item.id;
  // 填充字段
  $("#cf-name").textContent = item.name;
  $("#cf-quote").textContent = item.quote || "—";
  $("#cf-when").textContent = item.when || "—";
  $("#cf-where").textContent = item.where || "—";
  $("#cf-back-name").textContent = item.name;
  $("#cf-back-meta").textContent = [item.when, item.where].filter(Boolean).join(" · ") || "—";
  $("#cf-back-trait").textContent = item.trait || "—";
  $("#cf-back-story").textContent = item.story || "（暂无故事）";
  // 加载卡通版
  const portraitKey = item.cartoonKey || item.photoKey;
  const portraitImg = $("#cf-art .card-portrait-img");
  if (portraitKey) {
    const b = await dbGet(portraitKey).catch(() => null);
    if (b) {
      const url = URL.createObjectURL(b);
      portraitImg.src = url;
      $("#cf-art .card-ribbon").textContent = item.cartoonKey ? "✨ Portrait" : "📷 Snapshot";
    }
  }
  // 加载实拍图
  const photoImg = $("#cf-photo .back-photo-img");
  if (item.photoKey) {
    const b = await dbGet(item.photoKey).catch(() => null);
    if (b) {
      const url = URL.createObjectURL(b);
      photoImg.src = url;
      $("#cf-photo").onclick = (e) => { e.stopPropagation(); openLightbox(url); };
      $("#cf-photo").style.cursor = "zoom-in";
    }
  }
  // 默认显示背面
  $("#card-focus-card").classList.remove("is-flipped");
  // 显示
  cardFocus.hidden = false;
  document.body.style.overflow = "hidden";
  SFX.S.focus();
}
function closeCardFocus() {
  if (!cardFocus) return;
  cardFocus.hidden = true;
  document.body.style.overflow = "";
  cardFocusCurrentId = null;
  SFX.S.modalClose();
}
// 关闭
cardFocus?.addEventListener("click", (e) => {
  if (e.target.hasAttribute("data-cf-close")) closeCardFocus();
});
// 翻面：点击卡牌本身
$("#card-focus-card")?.addEventListener("click", (e) => {
  if (e.target.closest("#cf-photo")) return; // 实拍图点击不翻面
  $("#card-focus-card").classList.toggle("is-flipped");
  SFX.S.flip();
});
// ESC 关闭
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !cardFocus.hidden) closeCardFocus();
});
lightbox?.addEventListener("click", (e) => { if (e.target.hasAttribute("data-lb-close")) closeLightbox(); });

/* ============================================================
   SFX 音效系统 — 浪漫版（Web Audio API 程序化生成）
   风格：sine wave、slower envelope、chorus、reverb-like delay
============================================================ */
const SFX = (() => {
  const LS_MUTE = "npcatcher:soundMuted";
  let ctx = null;
  let masterGain = null;
  let reverbBus = null;  // 混响总线
  let muted = localStorage.getItem(LS_MUTE) === "1";
  const MASTER_VOL = 0.42;  // 大声一点（原 0.18）

  function ensureCtx() {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      masterGain = ctx.createGain();
      masterGain.gain.value = muted ? 0 : MASTER_VOL;
      masterGain.connect(ctx.destination);
      // 混响总线：3 个延迟 tap 模拟短混响
      reverbBus = ctx.createGain();
      reverbBus.gain.value = 0.35;
      reverbBus.connect(masterGain);
      [0.08, 0.16, 0.27].forEach((d, i) => {
        const delay = ctx.createDelay(1);
        delay.delayTime.value = d;
        const fb = ctx.createGain();
        fb.gain.value = 0.35 - i * 0.08;
        delay.connect(fb).connect(delay);  // 反馈
        delay.connect(reverbBus);
        // 暴露一个连接点
        reverbBus._taps = reverbBus._taps || [];
        reverbBus._taps.push(delay);
      });
    } catch { ctx = null; }
    return ctx;
  }
  function resume() {
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
  }
  function setMuted(m) {
    muted = m;
    localStorage.setItem(LS_MUTE, m ? "1" : "0");
    if (masterGain) masterGain.gain.setTargetAtTime(m ? 0 : MASTER_VOL, ctx.currentTime, 0.01);
  }
  function isMuted() { return muted; }

  // 包络：更慢、更柔和（slower attack、longer decay）
  function envelope(gain, t0, attack, decay, peak = 1) {
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }
  // 浪漫单音：sine + 轻微 detune 模拟合唱
  function chordTone(freq, dur, vol = 1, delay = 0, withReverb = true) {
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    // 主音
    const o1 = ctx.createOscillator();
    o1.type = "sine";
    o1.frequency.value = freq;
    // 合唱：轻微失谐的副本
    const o2 = ctx.createOscillator();
    o2.type = "sine";
    o2.frequency.value = freq * 1.0035;  // +0.35% 失谐
    // 第三个八度泛音让音色更丰富
    const o3 = ctx.createOscillator();
    o3.type = "sine";
    o3.frequency.value = freq * 2;
    const g = ctx.createGain();
    envelope(g, t0, 0.02, dur, vol);
    o1.connect(g);
    o2.connect(g);
    const o3g = ctx.createGain();
    o3g.gain.value = 0.18;
    o3.connect(o3g).connect(g);
    g.connect(masterGain);
    // 同时送一份到混响
    if (withReverb && reverbBus && reverbBus._taps) {
      const send = ctx.createGain();
      send.gain.value = 0.5;
      g.connect(send);
      reverbBus._taps.forEach(t => send.connect(t));
    }
    o1.start(t0); o2.start(t0); o3.start(t0);
    o1.stop(t0 + dur + 0.1); o2.stop(t0 + dur + 0.1); o3.stop(t0 + dur + 0.1);
  }
  // 浪漫滑音
  function chordSweep(f1, f2, dur, vol = 1, delay = 0) {
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const o1 = ctx.createOscillator();
    o1.type = "sine";
    o1.frequency.setValueAtTime(f1, t0);
    o1.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t0 + dur);
    const o2 = ctx.createOscillator();
    o2.type = "sine";
    o2.frequency.setValueAtTime(f1 * 1.004, t0);
    o2.frequency.exponentialRampToValueAtTime(Math.max(20, f2 * 1.003), t0 + dur);
    const g = ctx.createGain();
    envelope(g, t0, 0.04, dur, vol);
    o1.connect(g); o2.connect(g);
    g.connect(masterGain);
    if (reverbBus && reverbBus._taps) {
      const send = ctx.createGain();
      send.gain.value = 0.5;
      g.connect(send);
      reverbBus._taps.forEach(t => send.connect(t));
    }
    o1.start(t0); o2.start(t0);
    o1.stop(t0 + dur + 0.1); o2.stop(t0 + dur + 0.1);
  }

  // === 各种 SFX（浪漫风）===
  const S = {
    // 悬停：钢琴般的轻触
    hover() {
      if (muted) return;
      chordTone(1320, 0.08, 0.4);  // E6 短促
    },
    // 点击：水晶钢琴
    click() {
      if (muted) return;
      chordTone(1568, 0.12, 0.6);  // G6
      chordTone(2093, 0.18, 0.3, 0.04);  // C7 泛音
    },
    // 卡片翻转：升 C 大调琶音（C-E-G）
    flip() {
      if (muted) return;
      chordTone(523, 0.20, 0.5);       // C5
      chordTone(659, 0.20, 0.5, 0.04);  // E5
      chordTone(784, 0.25, 0.5, 0.08);  // G5
    },
    // 模态打开：缓慢的上升音
    modalOpen() {
      if (muted) return;
      chordSweep(330, 880, 0.4, 0.5);
      chordTone(1760, 0.2, 0.3, 0.15);  // 高音点缀
    },
    // 模态关闭：缓慢下降
    modalClose() {
      if (muted) return;
      chordSweep(880, 330, 0.35, 0.4);
    },
    // 成功：明亮 4 音和弦
    success() {
      if (muted) return;
      chordTone(523, 0.25, 0.5);       // C5
      chordTone(659, 0.25, 0.5, 0.07); // E5
      chordTone(784, 0.25, 0.5, 0.14); // G5
      chordTone(1047, 0.4, 0.55, 0.21); // C6 延长
    },
    // 错误/删除：缓慢下沉
    error() {
      if (!ctx) return;
      chordSweep(440, 110, 0.4, 0.45);
    },
    // 通知：双音（小三度 → 大三度）
    notify() {
      if (muted) return;
      chordTone(880, 0.12, 0.45);  // A5
      chordTone(1109, 0.18, 0.45, 0.06);  // C#6
    },
    // 拖动 / 滑动
    sweep: (f1 = 400, f2 = 1200) => {
      if (muted) return;
      chordSweep(f1, f2, 0.2, 0.3);
    },
    // 魔法/生成中
    magic() {
      if (muted) return;
      chordSweep(220, 1320, 0.6, 0.45);
      chordTone(1760, 0.3, 0.3, 0.25);
    },
    // 选项卡切换
    tick() {
      if (muted) return;
      chordTone(1568, 0.05, 0.45);  // G6
    },
    // 聚焦模式开启：特殊的小调起音
    focus() {
      if (muted) return;
      chordTone(392, 0.3, 0.5);       // G4
      chordTone(523, 0.3, 0.5, 0.05);  // C5
      chordTone(659, 0.4, 0.55, 0.10); // E5
    },
  };

  return { S, ensureCtx, resume, setMuted, isMuted };
})();

/* ---------- 视频背景注入到所有 .cosmic 面板 ---------- */
const COSMIC_VIDEO_URL = "https://v1.pinimg.com/videos/iht/720p/35/eb/37/35eb37558785e62bd8c8aa2891dc7d39.mp4";
function injectCosmicVideos() {
  document.querySelectorAll(".cosmic").forEach((panel) => {
    if (panel.querySelector(".cosmic-video")) return; // 防止重复
    const v = document.createElement("video");
    v.className = "cosmic-video";
    v.src = COSMIC_VIDEO_URL;
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.autoplay = true;
    v.setAttribute("aria-hidden", "true");
    panel.prepend(v);
    // 兼容 Safari：尝试播放
    v.play().catch(() => { /* 用户没交互前可能自动播放失败，无所谓 */ });
  });
}

/* ---------- 全局点击/悬停绑定音效 ---------- */
function bindSFX() {
  // 第一次用户交互时解锁 AudioContext
  const unlock = () => {
    SFX.ensureCtx();
    SFX.resume();
    document.removeEventListener("click", unlock);
    document.removeEventListener("keydown", unlock);
    document.removeEventListener("touchstart", unlock);
  };
  document.addEventListener("click", unlock, { once: true });
  document.addEventListener("keydown", unlock, { once: true });
  document.addEventListener("touchstart", unlock, { once: true });

  // 委托点击
  document.addEventListener("click", (e) => {
    if (muted || !SFX.ensureCtx()) return;
    const t = e.target;
    if (t.closest(".btn-primary") || t.closest("#hero-start") || t.closest("#btn-generate")) {
      SFX.S.click();
    } else if (t.closest(".btn-ghost") || t.closest(".btn-data")) {
      SFX.S.click();
    } else if (t.closest(".card-btn.flip")) {
      SFX.S.flip();
    } else if (t.closest(".card-btn.edit")) {
      SFX.S.notify();
    } else if (t.closest(".card-btn.delete")) {
      SFX.S.error();
    } else if (t.closest(".user-row") || t.closest(".country-pill")) {
      SFX.S.tick();
    } else if (t.closest(".modal-close") || t.closest("[data-user-close]") || t.closest("[data-data-close]") || t.closest("[data-popup-close]") || t.closest("[data-lb-close]")) {
      SFX.S.modalClose();
    } else if (t.closest("#btn-add") || t.closest("#btn-data") || t.closest("#user-pill")) {
      SFX.S.modalOpen();
    } else if (t.closest(".marker")) {
      SFX.S.notify();
    }
  });

  // 悬停：按钮和卡牌
  document.addEventListener("mouseover", (e) => {
    if (muted) return;
    const t = e.target;
    if (t.closest(".btn-primary") || t.closest(".btn-ghost") || t.closest(".card-btn")) {
      SFX.S.hover();
    }
  });
}

// muted 状态引用
let muted = SFX.isMuted();

/* ---------- 静音开关 ---------- */
function refreshMuteBtn() {
  const btn = $("#btn-mute");
  if (!btn) return;
  btn.textContent = muted ? "🔇" : "🔊";
  btn.title = muted ? "已静音 · 点击恢复" : "音效开启 · 点击静音";
}
function toggleMute() {
  SFX.setMuted(!muted);
  muted = SFX.isMuted();
  refreshMuteBtn();
  if (!muted) SFX.S.tick();
}
$("#btn-mute")?.addEventListener("click", (e) => { e.stopPropagation(); toggleMute(); });

/* ---------- 启动 ---------- */
(async () => {
  // 从 IndexedDB 加载 NPC list
  await loadMetaAsync();
  // 把当前用户加进 known（如果有数据的话）
  if (window.__npcCache && window.__npcCache.length > 0) {
    setCurrentUser(getCurrentUser());
  } else {
    // 没有数据也注册 default 让用户能看到
    setCurrentUser(getCurrentUser());
  }
  refreshUserPill();
  updateBackupIndicator();
  // 注入宇宙视频背景
  injectCosmicVideos();
  // 绑定 SFX 音效
  bindSFX();
  refreshMuteBtn();
  render();
  // 首次访问时显示数据安全说明（每用户只弹一次）
  maybeShowOnboarding();
})();
