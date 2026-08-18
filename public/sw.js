// Melody AI Service Worker v4：网络优先 + 离线回退
// 版本号变更 → 浏览器检测到 SW 更新 → 重装并清旧缓存（修复 UI 不更新的根因）
// 路径用相对路径（兼容 GitHub Pages 子路径部署）
const CACHE = "melody-ai-v4";
const CORE = [
    "./home.html",
    "./menu.html",
    "./chat.html",
    "./manifest.webmanifest",
    "./icons/icon-192.png",
    "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
    e.waitUntil(
        caches
            .open(CACHE)
            .then((c) => c.addAll(CORE))
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener("activate", (e) => {
    e.waitUntil(
        caches
            .keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim()),
    );
});

self.addEventListener("fetch", (e) => {
    const req = e.request;
    if (req.method !== "GET" || !req.url.startsWith(self.location.origin)) return;

    // /api/chat 不缓存
    if (req.url.includes("/api/chat")) return;

    // HTML 页面：网络优先，失败回退缓存（避免旧版 HTML 卡缓存）
    if (req.mode === "navigate") {
        e.respondWith(
            fetch(req)
                .then((res) => {
                    const clone = res.clone();
                    caches.open(CACHE).then((c) => c.put(req, clone));
                    return res;
                })
                .catch(() =>
                    caches.match(req).then((hit) => hit || caches.match("./home.html")),
                ),
        );
        return;
    }

    // 静态资源：缓存优先，失败再走网络（离线可用 + 快速）
    e.respondWith(
        caches.match(req).then(
            (hit) =>
                hit ||
                fetch(req).then((res) => {
                    const clone = res.clone();
                    caches.open(CACHE).then((c) => c.put(req, clone));
                    return res;
                }),
        ),
    );
});
