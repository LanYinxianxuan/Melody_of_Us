// tts.ts —— MiMo TTS VoiceClone 语音合成模块
// 使用小米 MiMo v2.5-tts-voiceclone API，支持音色克隆

import { store } from "./storage";

// TTS 配置存储键
const TTS_ENABLED_KEY = "melai-tts-enabled";
const TTS_VOICE_KEY_PREFIX = "melai-tts-voice"; // 每个槽位独立
const TTS_STYLE_KEY_PREFIX = "melai-tts-style";
const TTS_API_KEY_PREFIX = "melai-tts-apikey"; // TTS 专用 API Key

// 当前槽位
function currentSlot(): number {
    return parseInt(localStorage.getItem("melai-current-slot") ?? "1", 10) || 1;
}

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

// 调用 TTS API 合成语音
export async function synthesizeSpeech(text: string, style?: string): Promise<ArrayBuffer> {
    const { baseUrl, headers, key } = getTtsConfig();
    const voiceBase64 = getVoiceBase64();

    if (!key) {
        throw new Error("请先设置 API Key");
    }

    if (!voiceBase64) {
        throw new Error("请先上传音色样本");
    }

    // 构建 messages
    const messages: Array<{ role: string; content: string }> = [];

    // user 消息：风格指令（可选）
    const styleText = style || getTtsStyle();
    if (styleText) {
        messages.push({ role: "user", content: styleText });
    } else {
        messages.push({ role: "user", content: "" });
    }

    // assistant 消息：要合成的文字
    messages.push({ role: "assistant", content: text });

    // 构建请求体
    const requestBody = {
        model: "mimo-v2.5-tts-voiceclone",
        messages,
        audio: {
            format: "wav",
            voice: voiceBase64,
        },
    };

    console.log("[TTS] 发送合成请求:", { text: text.slice(0, 50) + "...", style: styleText });

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
    const binaryString = atob(audioData);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }

    return bytes.buffer;
}

// ============ 音频播放 ============

// 播放音频 ArrayBuffer
async function playAudioBuffer(buffer: ArrayBuffer): Promise<void> {
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

// 合成并播放语音（带队列）
export async function speak(text: string, style?: string): Promise<void> {
    if (!ttsEnabled) return;

    try {
        const buffer = await synthesizeSpeech(text, style);
        await playAudioBuffer(buffer);
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
