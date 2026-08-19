// tts.ts —— MiMo TTS VoiceClone 语音合成模块
// 使用小米 MiMo v2.5-tts-voiceclone API，支持音色克隆

import { store } from "./storage";

// TTS 配置存储键
const TTS_ENABLED_KEY = "melai-tts-enabled";
const TTS_VOICE_KEY_PREFIX = "melai-tts-voice"; // 每个槽位独立
const TTS_STYLE_KEY_PREFIX = "melai-tts-style";
const TTS_API_KEY_PREFIX = "melai-tts-apikey"; // TTS 专用 API Key
const TTS_LANG_KEY_PREFIX = "melai-tts-lang"; // TTS 语言：zh / ja

// 当前槽位
function currentSlot(): number {
    return parseInt(localStorage.getItem("melai-current-slot") ?? "1", 10) || 1;
}

// 支持的语言
export type TtsLang = "zh" | "ja";
export const TTS_LANGS: Record<TtsLang, { name: string; flag: string }> = {
    zh: { name: "中文", flag: "🇨🇳" },
    ja: { name: "日本語", flag: "🇯🇵" },
};

// ============ TTS 状态 ============

let ttsEnabled = localStorage.getItem(TTS_ENABLED_KEY) === "true";
let audioQueue: HTMLAudioElement[] = [];
let isPlaying = false;

export function isTtsEnabled(): boolean {
    return ttsEnabled;
}

export function setTtsEnabled(enabled: boolean) {
    ttsEnabled = enabled;
    localStorage.setItem(TTS_ENABLED_KEY, String(enabled));
}

// ============ 音色管理 ============

// 获取当前槽位的音色 Base64
export function getVoiceBase64(): string | null {
    return localStorage.getItem(`${TTS_VOICE_KEY_PREFIX}-${currentSlot()}`);
}

// 保存音色 Base64
export function setVoiceBase64(base64: string) {
    localStorage.setItem(`${TTS_VOICE_KEY_PREFIX}-${currentSlot()}`, base64);
}

// 清除音色
export function clearVoice() {
    localStorage.removeItem(`${TTS_VOICE_KEY_PREFIX}-${currentSlot()}`);
}

// 获取风格指令
export function getTtsStyle(): string {
    return localStorage.getItem(`${TTS_STYLE_KEY_PREFIX}-${currentSlot()}`) ?? "";
}

// 保存风格指令
export function setTtsStyle(style: string) {
    localStorage.setItem(`${TTS_STYLE_KEY_PREFIX}-${currentSlot()}`, style);
}

// 获取 TTS 专用 API Key
export function getTtsApiKey(): string {
    return localStorage.getItem(`${TTS_API_KEY_PREFIX}-${currentSlot()}`) ?? "";
}

// 保存 TTS 专用 API Key
export function setTtsApiKey(key: string) {
    localStorage.setItem(`${TTS_API_KEY_PREFIX}-${currentSlot()}`, key);
}

// 获取 TTS 语言
export function getTtsLang(): TtsLang {
    const lang = localStorage.getItem(`${TTS_LANG_KEY_PREFIX}-${currentSlot()}`);
    return (lang === "ja" || lang === "zh") ? lang : "zh";
}

// 保存 TTS 语言
export function setTtsLang(lang: TtsLang) {
    localStorage.setItem(`${TTS_LANG_KEY_PREFIX}-${currentSlot()}`, lang);
}

// ============ 翻译功能 ============
// 翻译由 AI 在回复时直接输出 dialogue_ja，TTS 直接使用，无需单独翻译

// ============ 情感风格生成 ============

// 根据情感状态生成 TTS 风格指令（自然语言控制）
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

    // 根据动作添加标签
    if (/笑|开心|嘿嘿|哈哈/.test(action)) tags.push("[微笑]");
    if (/叹气|叹了口气/.test(action)) tags.push("[叹气]");
    if (/哭|流泪|眼泪/.test(action)) tags.push("[抽泣]");
    if (/呼吸|喘|深呼吸/.test(action)) tags.push("[深呼吸]");
    if (/颤抖|发抖/.test(action)) tags.push("[颤抖]");

    // 根据情绪添加标签
    if (emotions.shyness > 60) tags.push("[害羞]");
    if (emotions.anger > 60) tags.push("[压低声音]");
    if (emotions.sadness > 60) tags.push("[声音低落]");
    if (emotions.fear > 50) tags.push("[声音颤抖]");
    if (emotions.loneliness > 50) tags.push("[轻声]");

    return tags;
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
    const provider = localStorage.getItem(`provider-${slot}`) ?? "xiaomi";
    // 优先使用 TTS 专用 Key，否则使用主 Key
    const ttsKey = getTtsApiKey();
    const mainKey = localStorage.getItem(`apikey-${slot}`)?.trim() ?? "";
    const key = ttsKey || mainKey;

    // TTS 只支持小米 MiMo，但允许自定义地址
    let baseUrl = "https://api.xiaomimimo.com/v1";
    if (provider === "custom") {
        baseUrl = localStorage.getItem(`custom-url-${slot}`)?.trim() || baseUrl;
    }

    const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
    };

    return { baseUrl, headers, key };
}

// 构建 TTS 请求的 messages
function buildTtsMessages(text: string, style?: string): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = [];

    // user 消息：风格指令（可选）
    const styleText = style || getTtsStyle();
    if (styleText) {
        messages.push({ role: "user", content: styleText });
    } else {
        messages.push({ role: "user", content: "" });
    }

    // assistant 消息：要合成的文字（已经是目标语言）
    messages.push({ role: "assistant", content: text });

    return messages;
}

// 调用 TTS API 合成语音（非流式，兼容用）
export async function synthesizeSpeech(text: string, style?: string): Promise<ArrayBuffer> {
    const { baseUrl, headers, key } = getTtsConfig();
    const voiceBase64 = getVoiceBase64();

    if (!key) {
        throw new Error("请先设置 API Key");
    }

    if (!voiceBase64) {
        throw new Error("请先上传音色样本");
    }

    const messages = buildTtsMessages(text, style);

    const requestBody = {
        model: "mimo-v2.5-tts-voiceclone",
        messages,
        audio: {
            format: "wav",
            voice: voiceBase64,
        },
    };

    console.log("[TTS] 发送合成请求（非流式）:", { text: text.slice(0, 50) + "..." });

    const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
    });

    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error?.message ?? `TTS 请求失败: HTTP ${resp.status}`);
    }

    const data = await resp.json();

    // 从响应中提取音频数据
    const audioData = data.choices?.[0]?.message?.audio?.data;
    if (!audioData) {
        throw new Error("TTS 响应中没有音频数据");
    }

    // 解码 Base64 音频
    return base64ToArrayBuffer(audioData);
}

// 流式 TTS 合成：逐步返回音频块
export async function* synthesizeSpeechStream(text: string, style?: string): AsyncGenerator<ArrayBuffer> {
    const { baseUrl, headers, key } = getTtsConfig();
    const voiceBase64 = getVoiceBase64();

    if (!key) {
        throw new Error("请先设置 API Key");
    }

    if (!voiceBase64) {
        throw new Error("请先上传音色样本");
    }

    const messages = buildTtsMessages(text, style);

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

    const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
    });

    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error?.message ?? `TTS 请求失败: HTTP ${resp.status}`);
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
export async function speak(text: string, style?: string): Promise<void> {
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
        for await (const chunk of synthesizeSpeechStream(text, style)) {
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
export function ttsStatusText(): string {
    if (!ttsEnabled) return "语音关闭";
    const voice = getVoiceBase64();
    if (!voice) return "未设置音色";
    return "语音开启";
}

// 初始化 TTS 模块
export function initTts() {
    // 恢复启用状态
    ttsEnabled = localStorage.getItem(TTS_ENABLED_KEY) === "true";
    console.log("[TTS] 初始化完成，启用状态:", ttsEnabled);
}
