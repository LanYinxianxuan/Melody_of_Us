// tts.ts —— MiMo TTS VoiceClone 语音合成模块
// 使用小米 MiMo v2.5-tts-voiceclone API，支持音色克隆


import { currentSlot as activeSlot, slotKey, KEY_PREFIX } from "./storage";
import { joinUrl, postJson } from "./ai/client";
import {
    readVoiceData,
    writeVoice,
    deleteVoice,
    migrateVoiceFromLocalStorage,
    isIndexedDbAvailable,
    type WriteVoiceResult,
} from "./voice-store";

// TTS 配置存储键（前缀集中来自 storage.KEY_PREFIX，避免同一前缀在多处重复书写）
const TTS_VOICE_KEY_PREFIX = KEY_PREFIX.ttsVoice; // 每个槽位独立
const TTS_STYLE_KEY_PREFIX = KEY_PREFIX.ttsStyle;
const TTS_API_KEY_PREFIX = KEY_PREFIX.ttsApiKey; // TTS 专用 API Key
const TTS_LANG_KEY_PREFIX = KEY_PREFIX.ttsLang; // TTS 语言：zh / ja
const TTS_ENABLED_KEY_PREFIX = KEY_PREFIX.ttsEnabled;

/**
 * 【P0-13】页面槽位：统一取自 storage（URL 参数优先，模块加载时冻结）。
 *
 * 缺陷原貌：这里在**每次调用**时重新读 localStorage，而 storage.ts 的 currentSlot 是
 * 冻结值。两者不一致时（例如直接打开 `chat.html?slot=3`）TTS 音色会存到另一个槽位，
 * 与存档 / 角色卡 / API Key 全都对不上。
 * 现在统一用 storage 的冻结值，保证"这个页面 = 这一个槽位"。
 */
function currentSlot(): number {
    return activeSlot;
}

// 支持的语言
export type TtsLang = "zh" | "ja";
export const TTS_LANGS: Record<TtsLang, { name: string; flag: string }> = {
    zh: { name: "中文", flag: "🇨🇳" },
    ja: { name: "日本語", flag: "🇯🇵" },
};

/**
 * 【G6】TTS 访问器一律接受**显式 slot**（默认本页槽位）。
 *
 * 为什么必须带形参：菜单页可以在页面内切换要配置的槽位（点存档卡「API 设置」
 * → menu.ts 更新自己的 activeSlot 与 localStorage），而本模块的冻结值不会随之改变。
 * 若只依赖冻结默认值，菜单页会把音色 / 专用 Key / 风格 / 语言 / 开关读写到**错误的槽位**
 * （面板标题写着"存档 5"，实际写进了 *-1）。chat 页因为 URL 总带 ?slot=N，默认值即正确。
 */

/**
 * 旧版全局 TTS 开关键（无 `-{slot}` 后缀）。仅为一次性迁移而读取。
 */
const LEGACY_TTS_ENABLED_KEY = KEY_PREFIX.ttsEnabled;

function ttsEnabledKey(slot: number): string {
    return slotKey(TTS_ENABLED_KEY_PREFIX, slot);
}

/**
 * 一次性迁移：把旧的全局 TTS 开关复制到每个槽位，然后删除旧键。
 *
 * 为什么复制到所有槽位：旧语义下"开"就是全开，复制到所有槽位是保留用户原有意图、
 * 且不改变任何槽位行为的最小失真映射。（已单独设置过的槽位不覆盖。）
 * 删除旧键后，src 中不再存在对 `melai-tts-enabled` 的读取，避免长期留下孤儿键。
 *
 * 幂等：旧键不存在时直接返回。
 */
export function migrateTtsEnabledScope(slots: readonly number[]): { migrated: boolean; appliedTo: number[] } {
    let legacy: string | null = null;
    try {
        legacy = localStorage.getItem(LEGACY_TTS_ENABLED_KEY);
    } catch {
        return { migrated: false, appliedTo: [] };
    }
    if (legacy === null) return { migrated: false, appliedTo: [] };

    const appliedTo: number[] = [];
    for (const slot of slots) {
        const key = ttsEnabledKey(slot);
        try {
            if (localStorage.getItem(key) === null) {
                localStorage.setItem(key, legacy);
                appliedTo.push(slot);
            }
        } catch {
            /* 单个槽位写失败不影响其它槽位 */
        }
    }
    try {
        localStorage.removeItem(LEGACY_TTS_ENABLED_KEY);
    } catch {
        /* 删不掉就留着，下次再试 */
    }
    return { migrated: true, appliedTo };
}

/**
 * 读取某槽位的 TTS 开关（只读 per-slot 键）。
 * 旧全局键的兼容由 migrateTtsEnabledScope 一次性完成，**不做读时隐式复制** ——
 * 那会让"同一份偏好落在哪个槽位"取决于访问顺序，难以推理与测试。
 */
function readTtsEnabled(slot: number): boolean {
    try {
        return localStorage.getItem(ttsEnabledKey(slot)) === "true";
    } catch {
        return false;
    }
}

/** 本页槽位的开关缓存（chat 页使用） */
let ttsEnabled = readTtsEnabled(activeSlot);

export function isTtsEnabled(): boolean {
    return ttsEnabled;
}

/** 读取任意槽位的开关（菜单页配置其它槽位时使用） */
export function isTtsEnabledForSlot(slot: number): boolean {
    return readTtsEnabled(slot);
}

export function setTtsEnabled(enabled: boolean, slot: number = activeSlot) {
    if (slot === activeSlot) ttsEnabled = enabled; // 仅当改的是本页槽位才同步缓存
    try {
        localStorage.setItem(ttsEnabledKey(slot), String(enabled));
    } catch {
        /* 与既有行为一致：写失败不抛出 */
    }
}

// ============ 音色管理 ============

/**
 * 【P0-2 / G3】读取音色（**异步**）。
 *
 * 改为 Promise 的依据是调用点审计：全仓 5 个调用点里 4 个本来就在 async 上下文
 * （synthesizeSpeech / synthesizeSpeechStream / 试听 handler / 上传 handler），
 * 只有 loadTtsSettings 需要自身改 async。因此 async 的范围明显小于
 * "同步 API + 内存预热 + 首次加载竞态处理"那套方案。
 *
 * 存储介质：IndexedDB 优先；迁移尚未完成时由 voice-store 自动回退 localStorage。
 */
export async function getVoiceBase64(slot: number = currentSlot()): Promise<string | null> {
    return readVoiceData(slot);
}

/** 写入音色（异步；含与存档安全的 operation-scoped 联动） */
export async function setVoiceBase64(base64: string, slot: number = currentSlot()): Promise<WriteVoiceResult> {
    return writeVoice(base64, slot);
}

/** 清除音色（IDB 与 localStorage 两处都清，幂等） */
export async function clearVoice(slot: number = currentSlot()): Promise<void> {
    return deleteVoice(slot);
}

/** 【P0-2】把某槽位的音色从 localStorage 迁移到 IndexedDB（fail-safe，幂等） */
export async function migrateVoice(slot: number = currentSlot()) {
    return migrateVoiceFromLocalStorage(slot);
}

// 获取风格指令
export function getTtsStyle(slot: number = currentSlot()): string {
    return localStorage.getItem(slotKey(TTS_STYLE_KEY_PREFIX, slot)) ?? "";
}

// 保存风格指令
export function setTtsStyle(style: string, slot: number = currentSlot()) {
    localStorage.setItem(slotKey(TTS_STYLE_KEY_PREFIX, slot), style);
}

// 获取 TTS 专用 API Key
export function getTtsApiKey(slot: number = currentSlot()): string {
    return localStorage.getItem(slotKey(TTS_API_KEY_PREFIX, slot)) ?? "";
}

// 保存 TTS 专用 API Key
export function setTtsApiKey(key: string, slot: number = currentSlot()) {
    localStorage.setItem(slotKey(TTS_API_KEY_PREFIX, slot), key);
}

// 获取 TTS 语言
export function getTtsLang(slot: number = currentSlot()): TtsLang {
    const lang = localStorage.getItem(slotKey(TTS_LANG_KEY_PREFIX, slot));
    return lang === "ja" ? "ja" : "zh";
}

export function setTtsLang(lang: TtsLang, slot: number = currentSlot()) {
    localStorage.setItem(slotKey(TTS_LANG_KEY_PREFIX, slot), lang);
}

export function generateEmotionStyle(emotions: Record<string, number>): string {
    const styles: string[] = [];

    // 基础情绪
    if (emotions.joy > 60) styles.push("开心愉悦");
    if (emotions.sadness > 50) styles.push("低落难过");
    if (emotions.anger > 50) styles.push("生气压着火");
    if (emotions.fear > 45) styles.push("害怕紧张");
    if (emotions.surprise > 50) styles.push("惊讶");
    if (emotions.shyness > 55) styles.push("害羞脸红");
    if (emotions.embarrassment > 50) styles.push("尴尬不知所措");
    if (emotions.jealousy > 40) styles.push("吃醋酸溜溜");
    if (emotions.loneliness > 45) styles.push("孤单想念");
    if (emotions.anxiety > 50) styles.push("焦虑不安");
    if (emotions.anticipation > 55) styles.push("期待雀跃");

    // 状态
    if (emotions.fatigue > 55) styles.push("疲惫困倦");
    if (emotions.energy > 65) styles.push("元气满满");
    if (emotions.stress > 50) styles.push("压力大烦躁");
    if (emotions.nervousness > 55) styles.push("紧张结巴");
    if (emotions.confidence > 60) styles.push("自信坚定");

    // 关系
    if (emotions.affection > 70) styles.push("温柔亲昵");
    if (emotions.trust > 60) styles.push("信赖放松");
    if (emotions.intimacy > 60) styles.push("亲密自然");

    // 阴影
    if (emotions.possessiveness > 45) styles.push("占有欲强");
    if (emotions.pride > 50) styles.push("傲娇嘴硬");
    if (emotions.vanity > 50) styles.push("在意形象");

    return styles.join("，") || "平静自然";
}

// 根据动作和情感生成音频标签（插入到文本中）
export function generateAudioTags(action: string, emotions: Record<string, number>): string[] {
    const tags: string[] = [];

    // 根据动作添加标签（MiMo 文档支持的英文控制标签）
    if (/笑|开心|嘿嘿|哈哈/.test(action)) tags.push("[smiling]");
    if (/叹气|叹了口气/.test(action)) tags.push("[sigh]");
    if (/哭|流泪|眼泪/.test(action)) tags.push("[sobbing]");
    if (/呼吸|喘|深呼吸/.test(action)) tags.push("[takes a breath]");
    if (/颤抖|发抖/.test(action)) tags.push("[voice trembling]");

    // 根据情绪添加标签
    if (emotions.shyness > 60) tags.push("(shy, softly)");
    if (emotions.anger > 60) tags.push("(angry, low voice)");
    if (emotions.sadness > 60) tags.push("(sad, gentle)");
    if (emotions.fear > 50) tags.push("(nervous, trembling)");
    if (emotions.loneliness > 50) tags.push("(quiet, lonely)");

    return tags;
}

// 增强 TTS 文本：插入停顿/呼吸/语速标记（基于标点与情感），让语音情感自然
export function enhanceTtsText(text: string, emotions?: Record<string, number>): string {
    let t = text;

    // 1) 情绪驱动的开头风格标签（整体语气 + 语速）
    let prefix = "";
    if (emotions) {
        if (emotions.fatigue > 55) prefix = "(slowly, tired)";
        else if (emotions.shyness > 55) prefix = "(shy, softly)";
        else if (emotions.sadness > 50) prefix = "(sad, gentle)";
        else if (emotions.anger > 50) prefix = "(angry, low voice)";
        else if (emotions.joy > 60) prefix = "(happy, lively)";
        else if (emotions.nervousness > 55) prefix = "(nervous, trembling)";
        else if (emotions.anticipation > 55) prefix = "(excited, quick)";
        else if (emotions.confidence > 60) prefix = "(confident, steady)";
    }

    // 2) 句间呼吸停顿：每两句句号插入一次 [takes a breath]（不打断自然节奏）
    let sentenceCount = 0;
    t = t.replace(/。+/g, (m) => {
        sentenceCount++;
        return sentenceCount % 2 === 0 ? m + "[takes a breath]" : m;
    });

    // 3) 感叹与疑问的韵律标记（句末语气上扬/加重）
    t = t.replace(/！/g, "！[emphasis]");
    t = t.replace(/？/g, "？[rising]");

    // 4) 省略号保留为自然停顿（模型原生支持）

    return prefix ? prefix + t : t;
}

// ============ 音频上传 ============

// 读取音频文件为 Base64
export function readAudioFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        if (!file.type.match(/^audio\/(mp3|mpeg|wav)$/)) {
            reject(new Error("只支持 MP3 和 WAV 格式"));
            return;
        }
        if (file.size > 10 * 1024 * 1024) {
            reject(new Error("音频文件不能超过 10MB"));
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result as string;
            // 返回完整的 data URL
            resolve(result);
        };
        reader.onerror = () => reject(new Error("读取文件失败"));
        reader.readAsDataURL(file);
    });
}

// ============ TTS API 调用 ============

// 获取 API 配置（优先使用 TTS 专用 Key，否则使用主 Key）
function getTtsConfig(): { baseUrl: string; headers: Record<string, string>; key: string } {
    const slot = currentSlot();
    const provider = localStorage.getItem(slotKey(KEY_PREFIX.provider, slot)) ?? "xiaomi";
    // 优先使用 TTS 专用 Key，否则使用主 Key
    const ttsKey = getTtsApiKey();
    const mainKey = localStorage.getItem(slotKey(KEY_PREFIX.apikey, slot))?.trim() ?? "";
    const key = ttsKey || mainKey;

    // TTS 只支持小米 MiMo，但允许自定义地址
    let baseUrl = "https://api.xiaomimimo.com/v1";
    if (provider === "custom") {
        baseUrl = localStorage.getItem(slotKey(KEY_PREFIX.customUrl, slot))?.trim() || baseUrl;
    }

    const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
    };

    return { baseUrl, headers, key };
}

// 构建 TTS 请求的 messages
function buildTtsMessages(text: string, style?: string, emotions?: Record<string, number>): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = [];

    // user 消息：风格指令（自然语言控制，可选）
    const styleText = style || getTtsStyle();
    if (styleText) {
        messages.push({ role: "user", content: styleText });
    } else {
        messages.push({ role: "user", content: "" });
    }

    // assistant 消息：要合成的文字（已是目标语言；插入停顿/重音/语速标记）
    messages.push({ role: "assistant", content: enhanceTtsText(text, emotions) });

    return messages;
}

// 调用 TTS API 合成语音（非流式，兼容用）
export async function synthesizeSpeech(text: string, style?: string, emotions?: Record<string, number>): Promise<ArrayBuffer> {
    const { baseUrl, headers, key } = getTtsConfig();
    const voiceBase64 = await getVoiceBase64();

    if (!key) {
        throw new Error("请先设置 API Key");
    }

    if (!voiceBase64) {
        throw new Error("请先上传音色样本");
    }

    const messages = buildTtsMessages(text, style, emotions);

    const requestBody = {
        model: "mimo-v2.5-tts-voiceclone",
        messages,
        audio: {
            format: "wav",
            voice: voiceBase64,
        },
    };

    console.log("[TTS] 发送合成请求（非流式）:", { text: text.slice(0, 50) + "..." });

    // 【A-1】传输层走 ai/client；错误语义保持原样（检查 resp.ok + TTS 专属文案）
    const { resp, data } = await postJson(joinUrl(baseUrl, "chat/completions"), headers, requestBody);

    if (!resp.ok) {
        throw new Error((data as any).error?.message ?? `TTS 请求失败: HTTP ${resp.status}`);
    }

    // 从响应中提取音频数据
    const audioData = data.choices?.[0]?.message?.audio?.data;
    if (!audioData) {
        throw new Error("TTS 响应中没有音频数据");
    }

    // 解码 Base64 音频
    return base64ToArrayBuffer(audioData);
}

// 流式 TTS 合成：逐步返回音频块
export async function* synthesizeSpeechStream(text: string, style?: string, emotions?: Record<string, number>): AsyncGenerator<ArrayBuffer> {
    const { baseUrl, headers, key } = getTtsConfig();
    const voiceBase64 = await getVoiceBase64();

    if (!key) {
        throw new Error("请先设置 API Key");
    }

    if (!voiceBase64) {
        throw new Error("请先上传音色样本");
    }

    const messages = buildTtsMessages(text, style, emotions);

    const requestBody = {
        model: "mimo-v2.5-tts-voiceclone",
        messages,
        audio: {
            format: "pcm16",
            voice: voiceBase64,
        },
        stream: true,
    };

    console.log("[TTS] 发送合成请求（流式）:", { text: text.slice(0, 50) + "..." });

    // 【A-1】传输层走 ai/client；流式读取仍用同一个 Response 句柄
    const { resp, data } = await postJson(joinUrl(baseUrl, "chat/completions"), headers, requestBody);

    if (!resp.ok) {
        throw new Error((data as any).error?.message ?? `TTS 请求失败: HTTP ${resp.status}`);
    }

    const reader = resp.body?.getReader();
    if (!reader) throw new Error("无法读取流式响应");

    const decoder = new TextDecoder();
    let buffer = "";

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith("data: ")) continue;

                const data = trimmed.slice(6);
                if (data === "[DONE]") return;

                try {
                    const parsed = JSON.parse(data);
                    const delta = parsed.choices?.[0]?.delta;

                    // 提取音频块（Base64）
                    if (delta?.audio?.data) {
                        const pcmBytes = base64ToArrayBuffer(delta.audio.data);
                        if (pcmBytes.byteLength > 0) {
                            yield pcmBytes;
                        }
                    }
                } catch {
                    // 忽略解析错误
                }
            }
        }
    } finally {
        reader.releaseLock();
    }
}

// Base64 转 ArrayBuffer 辅助函数
function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

// ============ 音频播放 ============

// 为 PCM16 数据添加 WAV 头（24kHz mono 16bit）
function addWavHeader(pcmData: Uint8Array, sampleRate = 24000): ArrayBuffer {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;

    const buffer = new ArrayBuffer(44 + pcmData.length);
    const view = new DataView(buffer);

    // RIFF header
    view.setUint32(0, 0x52494646, false); // "RIFF"
    view.setUint32(4, 36 + pcmData.length, true);
    view.setUint32(8, 0x57415645, false); // "WAVE"

    // fmt chunk
    view.setUint32(12, 0x666d7420, false); // "fmt "
    view.setUint32(16, 16, true);          // chunk size
    view.setUint16(20, 1, true);           // PCM format
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);

    // data chunk
    view.setUint32(36, 0x64617461, false); // "data"
    view.setUint32(40, pcmData.length, true);

    // PCM data
    new Uint8Array(buffer, 44).set(pcmData);

    return buffer;
}

// 播放完整音频（WAV 格式，带头）
async function playWavBuffer(buffer: ArrayBuffer): Promise<void> {
    return new Promise((resolve, reject) => {
        const blob = new Blob([buffer], { type: "audio/wav" });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);

        audio.onended = () => {
            URL.revokeObjectURL(url);
            resolve();
        };

        audio.onerror = (e) => {
            URL.revokeObjectURL(url);
            reject(new Error("音频播放失败"));
        };

        audio.play().catch(reject);
    });
}

// 播放 PCM16 音频块（拼接 WAV 头后播放）
async function playPcmChunks(chunks: Uint8Array[]): Promise<void> {
    // 拼接所有 PCM 数据
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const pcmData = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        pcmData.set(chunk, offset);
        offset += chunk.length;
    }

    // 添加 WAV 头
    const wavBuffer = addWavHeader(pcmData);
    await playWavBuffer(wavBuffer);
}

// TTS 冷却：防止频繁请求触发 429
let lastSpeakAt = 0;
const SPEAK_COOLDOWN_MS = 3000;

// 合成并播放语音（流式）
export async function speak(text: string, style?: string, emotions?: Record<string, number>): Promise<void> {
    if (!ttsEnabled) return;

    // 冷却检查
    const now = Date.now();
    if (now - lastSpeakAt < SPEAK_COOLDOWN_MS) {
        console.warn(`[TTS] 冷却中，跳过（${Math.round((SPEAK_COOLDOWN_MS - (now - lastSpeakAt)) / 1000)}s）`);
        return;
    }
    lastSpeakAt = now;

    try {
        const pcmChunks: Uint8Array[] = [];

        // 流式接收音频块
        for await (const chunk of synthesizeSpeechStream(text, style, emotions)) {
            const bytes = new Uint8Array(chunk);
            pcmChunks.push(bytes);
        }

        // 拼接并播放
        if (pcmChunks.length > 0) {
            await playPcmChunks(pcmChunks);
        }
    } catch (e) {
        console.warn("[TTS] 合成或播放失败:", (e as Error).message);
        // 不抛出错误，静默失败
    }
}

// ============ UI 辅助 ============

// TTS 状态显示文本
export async function ttsStatusText(): Promise<string> {
    if (!ttsEnabled) return "语音关闭";
    const voice = await getVoiceBase64();
    if (!voice) return "未设置音色";
    return "语音开启";
}

// 初始化 TTS 模块
export function initTts() {
    // 恢复启用状态（per-slot，含旧全局键的一次性迁移）
    ttsEnabled = readTtsEnabled(activeSlot);

    // 【P0-2】预热 IndexedDB 探测。
    // 为什么必须在启动时预热：在"IDB 后端无响应"的环境下探测要等到超时才返回 false
    // （实测该环境正是如此）。若等用户点「朗读」时才第一次探测，那一次操作会多等一个
    // 探测超时（1.5s），表现为"点了没反应"。启动预热后，真正的读写在已有结论时零等待。
    void isIndexedDbAvailable().then((ok) => {
        console.log("[TTS] IndexedDB 可用:", ok, ok ? "（音色存 IndexedDB）" : "（回退 localStorage）");
    });

    console.log("[TTS] 初始化完成，启用状态:", ttsEnabled, "槽位:", activeSlot);
}
