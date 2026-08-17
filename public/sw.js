// Melody AI Service Worker：网络优先 + 离线回退（聊天需实时，网络优先；断网时回退缓存）
const CACHE = "melody-ai-v1";
const CORE = [
    "/playground/home.html",
    "/playground/menu.html",
    "/playground/chat.html",
    "/playground/assets/img/bg.jpg",
    "/playground/manifest.webmanifest",
    "/playground/icons/icon-192.png",
    "/playground/icons/icon-512.png",
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

    e.respondWith(
        fetch(req)
            .then((res) => {
                if (res && res.ok) {
                    const clone = res.clone();
                    caches.open(CACHE).then((c) => c.put(req, clone));
                }
                return res;
            })
            .catch(() =>
                caches.match(req).then((hit) => hit || caches.match("/playground/home.html")),
            ),
    );
});
