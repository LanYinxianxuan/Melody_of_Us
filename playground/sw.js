// Melody AI Service Worker v5：全部网络优先（确保获取最新版本）
const CACHE = "melody-ai-v5";

self.addEventListener("install", (e) => {
    self.skipWaiting();
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

    // 全部走网络优先：先请求网络，失败才用缓存
    e.respondWith(
        fetch(req)
            .then((res) => {
                // 更新缓存
                const clone = res.clone();
                caches.open(CACHE).then((c) => c.put(req, clone));
                return res;
            })
            .catch(() => caches.match(req)),
    );
});
