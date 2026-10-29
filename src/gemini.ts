/**
 * EduPlan AI — Gemini API Client
 * ============================================================
 * Client สำหรับยิงคำขอไปยัง Cloudflare Worker หรือ Google Gemini REST API (BYOK)
 * - รองรับ Tiered AI Architecture (kpa | fast | precision)
 * - Single-Attempt (ตัด Client Retry 100% รวดเร็วฉับไว)
 * - BYOK (Bring Your Own Key) พร้อม Auto-Fallback สู่ Worker เมื่อติด 429
 * - Dynamic Quota Tracking & BYOK Model Inspector
 * - Central Admin System Management (Cloudflare KV)
 * - JSON Sanitizer ป้องกัน JSON แตก
 * ============================================================
 */

import { getWorkerEndpoint, STORAGE_KEYS, ADMIN_PASS_HASH } from './config';
import type { ByokModelItem, SystemTierModels } from './types';

export interface GeminiMessage {
  role: 'user' | 'model';
  parts: { text: string }[];
}

export interface GeminiRequest {
  contents: GeminiMessage[];
  systemInstruction?: {
    parts: { text: string }[];
  };
  generationConfig?: {
    temperature?: number;
    topP?: number;
    topK?: number;
    maxOutputTokens?: number;
  };
  mode?: 'kpa' | 'fast' | 'precision';
  prompt?: string;
}

export interface GeminiResponse {
  candidates?: {
    content: {
      parts: { text: string }[];
    };
  }[];
  error?: string;
  _resolvedModel?: string;
  _totalAttempts?: number;
  _generationMode?: string;
  retryAfterSeconds?: number;
}

/** ผลลัพธ์จาก callGemini */
export interface GeminiResult {
  text: string;
  resolvedModel: string;
  totalAttempts: number;
  keyType: 'system_shared' | 'user_byok';
  generationMode: 'kpa' | 'fast' | 'precision';
}

/**
 * คำนวณ SHA-256 Hash ด้วย Web Crypto API
 */
export async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text.trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * ดึง API Key ส่วนตัวของผู้ใช้ (BYOK) จาก LocalStorage
 */
export function getStoredApiKey(): string {
  try {
    return localStorage.getItem(STORAGE_KEYS.BYOK_KEY)?.trim() || '';
  } catch {
    return '';
  }
}

/**
 * ตรวจสอบว่าผู้ใช้เปิดใช้งาน BYOK หรือไม่
 */
export function isByokEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEYS.BYOK_ENABLED) === 'true';
  } catch {
    return false;
  }
}

/**
 * บันทึกค่า BYOK ลง LocalStorage
 */
export function setStoredApiKey(key: string, enabled: boolean): void {
  try {
    if (key && key.trim()) {
      localStorage.setItem(STORAGE_KEYS.BYOK_KEY, key.trim());
    } else {
      localStorage.removeItem(STORAGE_KEYS.BYOK_KEY);
    }
    localStorage.setItem(STORAGE_KEYS.BYOK_ENABLED, enabled ? 'true' : 'false');
  } catch {
    // ignore
  }
}

/**
 * คำสำคัญของโมเดลที่ไม่เกี่ยวข้องกับงานสร้างข้อความ (Text-out) หรือการศึกษา
 * (เช่น embedding, imagen, aqa, learnlm, medlm, robotics, computer-use, realtime, audio, live เป็นต้น)
 */
const EXCLUDED_MODEL_KEYWORDS = [
  'robotics',
  'computer-use',
  'embedding',
  'embed',
  'imagen',
  'aqa',
  'realtime',
  'audio',
  'live',
  'medlm',
  'learnlm',
  'vision',
  'veo',
  'tts',
  'whisper',
  'image',
];

/**
 * ดึงและกรองเฉพาะรายชื่อโมเดล Text-out จาก Google Gemini API ด้วย API Key ส่วนตัวอย่างเข้มงวด
 */
export async function fetchTextOutModels(apiKey: string): Promise<ByokModelItem[]> {
  const cleanKey = (apiKey || '').trim();
  if (!cleanKey) return [];

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${cleanKey}`
  );

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const data = await res.json();
  const models: any[] = data.models || [];

  return models
    .filter(m => {
      // 1. supportedGenerationMethods ต้องมี generateContent เท่านั้น (ตัด embedContent และอื่นๆ)
      const methods: string[] = m.supportedGenerationMethods || [];
      const hasGenerateContent = methods.some(method =>
        method.toLowerCase().includes('generatecontent')
      );
      if (!hasGenerateContent) return false;

      // 2. ชื่อโมเดลต้องขึ้นต้นด้วยหรือมีคำว่า gemini-
      const rawName: string = (m.name || '').toLowerCase();
      const cleanId: string = rawName.replace(/^models\//, '').toLowerCase();
      const isGemini = cleanId.startsWith('gemini-') || cleanId.includes('gemini-');
      if (!isGemini) return false;

      // 3. กรองโมเดลที่ไม่เกี่ยวข้องออกอย่างเข้มงวด (Exclude non-text models)
      const isExcluded = EXCLUDED_MODEL_KEYWORDS.some(kw =>
        cleanId.includes(kw) || (m.displayName || '').toLowerCase().includes(kw)
      );
      if (isExcluded) return false;

      return true;
    })
    .map(m => {
      const rawName: string = m.name || '';
      const cleanId = rawName.replace(/^models\//, '');
      return {
        id: cleanId,
        displayName: m.displayName || cleanId,
        status: 'available' as const,
      };
    });
}

/**
 * ทดสอบยิง Tiny Request เพื่อเช็คสถานะโควต้าของโมเดลที่เลือก
 */
export async function testSpecificModel(
  apiKey: string,
  modelId: string
): Promise<'available' | 'limited' | 'error'> {
  const cleanKey = (apiKey || '').trim();
  const cleanModel = (modelId || '').trim().replace(/^models\//, '');
  if (!cleanKey || !cleanModel) return 'error';

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${cleanKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
          generationConfig: { maxOutputTokens: 1 },
        }),
      }
    );

    if (res.ok) {
      return 'available';
    }
    if (res.status === 429) {
      return 'limited';
    }
    return 'error';
  } catch {
    return 'error';
  }
}

/** Dynamic Quota Tracking Subscriptions */
type QuotaLimitedListener = (modelId: string) => void;
const quotaListeners: Set<QuotaLimitedListener> = new Set();

export function onModelQuotaLimited(listener: QuotaLimitedListener): () => void {
  quotaListeners.add(listener);
  return () => quotaListeners.delete(listener);
}

export function markModelQuotaLimited(modelId: string): void {
  const cleanId = (modelId || '').replace(/^models\//, '');
  for (const listener of quotaListeners) {
    try {
      listener(cleanId);
    } catch (err) {
      console.warn('Quota listener error:', err);
    }
  }
}

/**
 * ตรวจสอบความถูกต้องและสถานะโควต้าของ Gemini API Key (BYOK)
 */
export async function validateGeminiApiKey(apiKey: string): Promise<{
  status: 'active' | 'quota_exceeded' | 'invalid';
  message: string;
}> {
  const cleanKey = (apiKey || '').trim();
  if (!cleanKey) {
    return { status: 'invalid', message: 'กรุณากรอก API Key' };
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${cleanKey}`
    );

    if (res.ok) {
      return { status: 'active', message: '🟢 พร้อมใช้งาน (Active)' };
    }

    if (res.status === 429) {
      return {
        status: 'quota_exceeded',
        message: '🟡 โควต้าเต็มชั่วคราว (HTTP 429)',
      };
    }

    return {
      status: 'invalid',
      message: `🔴 คีย์ไม่ถูกต้อง (HTTP ${res.status})`,
    };
  } catch (err: any) {
    return {
      status: 'invalid',
      message: `🔴 ไม่สามารถเชื่อมต่อเพื่อตรวจสอบได้ (${err?.message || 'Network error'})`,
    };
  }
}

/**
 * ทำความสะอาด String ที่ได้จาก AI ก่อนสั่ง JSON.parse()
 * ป้องกัน Markdown Backticks (```json ... ```) และตัวอักษรส่วนเกิน
 */
export function sanitizeJsonString(raw: string): string {
  if (!raw) return '{}';
  let text = raw.trim();

  // 1. ตัด markdown code block wrapper ```json ... ```
  const mdMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (mdMatch) {
    text = mdMatch[1].trim();
  } else {
    // กำจัดกรณีมี ``` เปิดหรือปิดโดดๆ
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  }

  // 2. ดึงเฉพาะก้อน JSON Object { ... } ตัวนอกสุด
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    text = text.substring(firstBrace, lastBrace + 1);
  }

  return text.trim();
}

/**
 * ส่ง Request ตรงไปยัง Google Gemini REST API โดยใช้ BYOK
 */
async function callGeminiDirectBYOK(
  userKey: string,
  prompt: string,
  systemInstruction?: string,
  maxTokens: number = 8192,
  mode: 'kpa' | 'fast' | 'precision' = 'fast'
): Promise<GeminiResult> {
  const candidateModels: string[] = [];

  // 1. ตรวจสอบการตั้งค่าโมเดลส่วนตัวของผู้ใช้จาก LocalStorage (eduplan_user_byok_tiers)
  try {
    const savedTiersRaw = localStorage.getItem(STORAGE_KEYS.USER_BYOK_TIERS);
    if (savedTiersRaw) {
      const savedTiers = JSON.parse(savedTiersRaw);
      if (savedTiers && Array.isArray(savedTiers[mode])) {
        for (const m of savedTiers[mode]) {
          const clean = (m || '').trim().replace(/^models\//, '');
          if (clean && !candidateModels.includes(clean)) {
            candidateModels.push(clean);
          }
        }
      }
    }
  } catch (err) {
    console.warn('Failed to parse user BYOK tiers:', err);
  }

  // Backward-compatibility: ตรวจสอบ single mapped model เผื่อไว้
  if (candidateModels.length === 0) {
    try {
      const oldMapped = mode === 'precision'
        ? localStorage.getItem(STORAGE_KEYS.BYOK_PRECISION_MODEL)
        : localStorage.getItem(STORAGE_KEYS.BYOK_FAST_MODEL);
      if (oldMapped && oldMapped.trim()) {
        candidateModels.push(oldMapped.trim().replace(/^models\//, ''));
      }
    } catch {}
  }

  // 2. หากยังไม่มีโมเดลที่เลือกไว้ ให้ใช้ Default Candidates
  const defaultCandidates = [
    'gemini-3.5-flash',
    'gemini-flash-latest',
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
  ];
  for (const def of defaultCandidates) {
    if (!candidateModels.includes(def)) {
      candidateModels.push(def);
    }
  }

  const geminiPayload: any = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: mode === 'kpa' ? 0.2 : 0.7,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: maxTokens,
    },
  };

  if (systemInstruction) {
    geminiPayload.systemInstruction = {
      parts: [{ text: systemInstruction }],
    };
  }

  let lastStatus = 0;
  for (const model of candidateModels) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${userKey}`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiPayload),
      });

      lastStatus = response.status;
      if (response.ok) {
        const data: GeminiResponse = await response.json();
        if (data.candidates && data.candidates.length > 0) {
          const text = data.candidates[0].content.parts.map(p => p.text).join('');
          return {
            text,
            resolvedModel: model,
            totalAttempts: 1,
            keyType: 'user_byok',
            generationMode: mode,
          };
        }
      }

      // หากเจอ 400 หรือ 403 (Invalid Key / Bad Request) ให้หยุดทันทีและแจ้ง Error (ห้ามวนต่อ)
      if (response.status === 400 || response.status === 403) {
        const errorData = await response.json().catch(() => ({}));
        const serverMsg = (errorData as any)?.error?.message || `BYOK Error (HTTP ${response.status})`;
        const fatalErr = new Error(serverMsg);
        (fatalErr as any).isFatal = true;
        throw fatalErr;
      }

      // หากเจอ 429 ให้ mark status ใน Dynamic Quota Tracker และลองโมเดลถัดไปในลิสต์ของผู้ใช้ (Waterfall Fallback)
      if (response.status === 429) {
        markModelQuotaLimited(model);
        console.warn(`[BYOK] Model ${model} returned 429, trying next candidate in waterfall...`);
        continue;
      }

      // หากเจอ 404 หรือ 503 ให้ลองโมเดลถัดไป
      if (response.status === 404 || response.status === 503) {
        continue;
      }

      // สถานะอื่นๆ ที่ไม่คาดคิด ให้หยุดทันทีและแจ้ง Error
      const otherErrJson = await response.json().catch(() => ({}));
      const otherMsg = (otherErrJson as any)?.error?.message || `BYOK Error (HTTP ${response.status})`;
      const fatalErr = new Error(otherMsg);
      (fatalErr as any).isFatal = true;
      throw fatalErr;
    } catch (err: any) {
      if ((err as any)?.isFatal) {
        throw err;
      }
      // หากเกิด Network Error ขณะลองโมเดล ให้วนลองโมเดลถัดไป
    }
  }

  // หากโมเดลทั้งหมดใน Waterfall ติด 429 ให้ตัดสลับไป Shared Worker Proxy
  if (lastStatus === 429) {
    throw new Error('BYOK_429');
  }

  throw new Error(`BYOK_FAILED_${lastStatus}`);
}

/**
 * ฟังก์ชันหลักในการเรียกใช้ Gemini AI
 * - Single-Attempt (ไม่หน่วงเวลา Client Retry)
 * - สลับอัตโนมัติระหว่าง BYOK และ Cloudflare Worker
 *
 * @param prompt ข้อความ Prompt
 * @param systemInstruction คำสั่งระบบ
 * @param maxTokens จำนวน Token สูงสุด
 * @param mode ระดับโมเดล ('kpa' | 'fast' | 'precision')
 */
export async function callGemini(
  prompt: string,
  systemInstruction?: string,
  maxTokens: number = 8192,
  mode: 'kpa' | 'fast' | 'precision' = 'fast'
): Promise<GeminiResult> {
  const userKey = getStoredApiKey();
  const byokActive = isByokEnabled() && Boolean(userKey);

  // 1. หากผู้ใช้เปิด BYOK ให้ยิงตรงก่อน
  if (byokActive) {
    try {
      return await callGeminiDirectBYOK(userKey, prompt, systemInstruction, maxTokens, mode);
    } catch (byokErr: any) {
      if ((byokErr as any)?.isFatal) {
        // หากเจอ 400 หรือ 403 ให้หยุดทันทีและแจ้ง Error (ห้ามวนต่อ / ไม่ต้อง fallback)
        throw byokErr;
      }
      console.warn('[Gemini Client] BYOK call failed or quota exceeded. Falling back to shared worker proxy...', byokErr);
      // Auto-fallback ไปที่ Worker กลางด้านล่าง
    }
  }

  // 2. ยิงไปยัง Cloudflare Worker ส่วนกลาง (Single-Attempt)
  const endpoint = getWorkerEndpoint();
  const requestBody: GeminiRequest = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
    mode,
    prompt,
    generationConfig: {
      temperature: mode === 'kpa' ? 0.2 : 0.7,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: maxTokens,
    },
  };

  if (systemInstruction) {
    requestBody.systemInstruction = {
      parts: [{ text: systemInstruction }],
    };
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
  } catch (netErr: any) {
    throw new Error(
      `ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ระบบได้ (${netErr?.message || 'Network Error'})\n` +
      `กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ตของท่าน`
    );
  }

  if (response.status === 429) {
    const errorData = await response.json().catch(() => ({})) as GeminiResponse;
    const serverMsg = errorData.error || 'โควต้าระบบส่วนกลางกำลังถูกใช้งานพร้อมกันจำนวนมาก';
    throw new Error(serverMsg);
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const serverMsg = (errorData as { error?: string }).error;
    throw new Error(
      serverMsg || `เกิดข้อผิดพลาดจากเซิร์ฟเวอร์ (HTTP ${response.status} ${response.statusText})`
    );
  }

  const data: GeminiResponse = await response.json();

  if (data.error) {
    throw new Error(data.error);
  }

  if (!data.candidates || data.candidates.length === 0) {
    throw new Error('ไม่ได้รับการตอบกลับจาก AI กรุณาลองใหม่อีกครั้ง');
  }

  const resolvedModel =
    data._resolvedModel ||
    response.headers.get('X-Resolved-Model') ||
    'gemini-flash';

  const totalAttempts = data._totalAttempts || 1;

  return {
    text: data.candidates[0].content.parts.map(p => p.text).join(''),
    resolvedModel,
    totalAttempts,
    keyType: 'system_shared',
    generationMode: mode,
  };
}

/**
 * ส่งคำขอปรับปรุงแผนเดิม (Refinement)
 */
export async function refineWithGemini(
  currentPlan: string,
  instruction: string,
  systemInstruction?: string,
  mode: 'fast' | 'precision' = 'fast'
): Promise<GeminiResult> {
  const combinedPrompt = `
## แผนการจัดการเรียนรู้ปัจจุบัน:
${currentPlan}

## คำสั่งปรับปรุง:
${instruction}

กรุณาปรับปรุงแผนการจัดการเรียนรู้ตามคำสั่งข้างต้น โดยคงโครงสร้างเดิมไว้ แก้ไขเฉพาะส่วนที่ระบุ และส่งกลับแผนทั้งหมดที่ปรับปรุงแล้ว
`.trim();

  return callGemini(combinedPrompt, systemInstruction, 8192, mode);
}

// ============================================================
// ADMIN API CLIENT (Cloudflare KV Central Management)
// ============================================================

/**
 * ดึงการตั้งค่าโมเดลระบบสากลจาก Worker ผ่าน KV
 */
export async function fetchAdminConfig(endpoint?: string): Promise<{ success: boolean; tiers: SystemTierModels }> {
  const base = (endpoint || getWorkerEndpoint()).replace(/\/+$/, '');
  const url = `${base}/api/admin/config`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error((errJson as any)?.error || `HTTP ${res.status}`);
  }

  return await res.json();
}

/**
 * บันทึกการตั้งค่าโมเดลระบบสากลลง Cloudflare KV
 */
export async function saveAdminConfig(
  token: string,
  newTiers: SystemTierModels,
  endpoint?: string
): Promise<{ success: boolean; message: string }> {
  const base = (endpoint || getWorkerEndpoint()).replace(/\/+$/, '');
  const url = `${base}/api/admin/config`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Token': token,
    },
    body: JSON.stringify({
      adminToken: token,
      newTiers,
    }),
  });

  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error((errJson as any)?.error || `HTTP ${res.status}`);
  }

  return await res.json();
}

/**
 * คืนค่าโมเดลระบบเริ่มต้นตาม Worker (ลบค่าจาก KV)
 */
export async function resetAdminConfig(
  token: string,
  endpoint?: string
): Promise<{ success: boolean; message: string; tiers: SystemTierModels }> {
  const base = (endpoint || getWorkerEndpoint()).replace(/\/+$/, '');
  const url = `${base}/api/admin/reset`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Token': token,
    },
    body: JSON.stringify({
      adminToken: token,
    }),
  });

  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error((errJson as any)?.error || `HTTP ${res.status}`);
  }

  return await res.json();
}
