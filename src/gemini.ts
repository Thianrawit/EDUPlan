/**
 * EduPlan AI — Gemini API Client
 * ============================================================
 * Client สำหรับยิงคำขอไปยัง Cloudflare Worker หรือ Google Gemini REST API (BYOK)
 * - รองรับ Tiered AI Architecture (kpa | fast | precision)
 * - Single-Attempt (ตัด Client Retry 100% รวดเร็วฉับไว)
 * - BYOK (Bring Your Own Key) พร้อม Auto-Fallback สู่ Worker เมื่อติด 429
 * - JSON Sanitizer ป้องกัน JSON แตก
 * ============================================================
 */

import { getWorkerEndpoint, STORAGE_KEYS } from './config';

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
  // เลือกลำดับโมเดลสำหรับ Direct API (รองรับโมเดลล่าสุด Gemini 3.x / Flash-latest และ Fallback ครอบคลุม)
  const candidateModels =
    mode === 'kpa'
      ? ['gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash']
      : mode === 'precision'
      ? ['gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-3.1-pro-preview', 'gemini-pro-latest', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-1.5-pro']
      : ['gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];

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

      // หากติด 404 (โมเดลเลิกใช้), 400, 503 (โหลดเกินชั่วคราว), หรือ 429 (โควต้าเฉพาะโมเดล) ให้ลองโมเดลถัดไป
      if (response.status === 404 || response.status === 400 || response.status === 503 || response.status === 429) {
        continue;
      }
    } catch (err: any) {
      // ลองโมเดลถัดไป
    }
  }

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
