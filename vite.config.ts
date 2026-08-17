import { resolve } from "path";
import { defineConfig } from "vite";

export default defineConfig({
    base: "./",
    server: {
        open: "/playground/home.html",
    },
    build: {
        outDir: "dist",
        rollupOptions: {
            input: {
                home: resolve(__dirname, "playground/home.html"),
                menu: resolve(__dirname, "playground/menu.html"),
                chat: resolve(__dirname, "playground/chat.html"),
            },
        },
    },
    plugins: [
        {
            // DeepSeek API 代理：转发 /api/chat 到 api.deepseek.com（避免 CORS）
            // 预览版 key 由浏览器传入；生产环境应服务端持有
            name: "deepseek-proxy",
            apply: "serve" as const,
            configureServer(server) {
                server.middlewares.use("/api/chat", async (req, res) => {
                    const chunks: Buffer[] = [];

                    for await (const chunk of req) chunks.push(Buffer.from(chunk));

                    const { key, model, messages, max_tokens } = JSON.parse(
                        Buffer.concat(chunks).toString("utf8"),
                    );

                    const resp = await fetch("https://api.deepseek.com/chat/completions", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${key}`,
                        },
                        body: JSON.stringify({
                            model: model || "deepseek-v4-flash",
                            messages,
                            stream: false,
                            thinking: { type: "disabled" },
                            max_tokens: max_tokens || 8192,
                        }),
                    });

                    const data = await resp.text();

                    res.setHeader("Content-Type", "application/json");
                    res.end(data);
                });
            },
        },
    ],
});
