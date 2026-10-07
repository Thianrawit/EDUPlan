/**
 * EduPlan AI — Gemini API Client
 * ============================================================
 * Client สำหรับยิง Request ไปยัง Cloudflare Worker
 * รองรับ Waterfall Model Cascading Response
 * + Auto-retry with Exponential Backoff (ฝั่ง Client)
 * ============================================================
 */

import { getWorkerEndpoint } from './config';

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
  retryAfterSeconds?: number;
}

/** ผลลัพธ์จาก callGemini รวมข้อมูลโมเดลที่ใช้ */
export interface GeminiResult {
  text: string;
  resolvedModel: string;
  totalAttempts: number;
}

/** จำนวนครั้งที่ client จะ retry เมื่อได้ 429 (Worker จัดการ waterfall ครบ 21 ครั้งแล้ว) */
const CLIENT_MAX_RETRIES = 0;

/** Base delay (ms) */
const BASE_DELAY_MS = 5000;

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * ส่ง Request ไปยัง Cloudflare Worker Proxy
 * Worker จะทำ Waterfall Model Cascading ให้เอง
 * Client ไม่ต้องส่ง model — แค่ส่ง payload ไปตรงๆ
 *
 * @returns GeminiResult พร้อมชื่อโมเดลที่ใช้จริง
 */
export async function callGemini(
  prompt: string,
  systemInstruction?: string,
  maxTokens: number = 8192,
  onRetry?: (attempt: number, maxRetries: number, waitMs: number) => void
): Promise<GeminiResult> {
  const requestBody: GeminiRequest = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.7,
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

  const endpoint = getWorkerEndpoint();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= CLIENT_MAX_RETRIES; attempt++) {
    // Exponential backoff (ไม่ delay รอบแรก)
    if (attempt > 0) {
      const jitter = Math.random() * 3000;
      const waitMs = Math.min(BASE_DELAY_MS * Math.pow(1.5, attempt - 1) + jitter, 90000);

      if (onRetry) {
        onRetry(attempt, CLIENT_MAX_RETRIES, Math.round(waitMs));
      }
      console.log(`[Gemini Client] Retry ${attempt}/${CLIENT_MAX_RETRIES}, waiting ${Math.round(waitMs)}ms...`);
      await sleep(waitMs);
    }

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
    } catch (netErr: any) {
      lastError = new Error(
        `ไม่สามารถเชื่อมต่อ Cloudflare Worker Proxy ได้ (${netErr?.message || 'Network Error'})\n` +
        `กรุณาตรวจสอบว่าได้ตั้งค่า Worker URL ถูกต้องแล้ว (Endpoint: ${endpoint})`
      );
      // Network error ลอง retry ได้
      if (attempt < CLIENT_MAX_RETRIES) continue;
      throw lastError;
    }

    // 429 = Worker ลองครบทุกโมเดล+คีย์แล้ว
    if (response.status === 429) {
      const errorData = await response.json().catch(() => ({})) as GeminiResponse;
      const serverMsg = errorData.error || 'โควต้ากำลังถูกใช้งานพร้อมกันจำนวนมาก';
      lastError = new Error(serverMsg);

      if (attempt < CLIENT_MAX_RETRIES) continue;

      // หมด retry → throw ข้อความสุดท้าย
      throw new Error(
        'โควต้ากำลังถูกใช้งานพร้อมกันจำนวนมาก ระบบจะพร้อมใช้งานใหม่อีกครั้งใน 1 นาที'
      );
    }

    // Error อื่นที่ไม่ใช่ 429 → ไม่ retry, throw เลย
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const serverMsg = (errorData as { error?: string }).error;
      throw new Error(
        serverMsg || `เกิดข้อผิดพลาดจากเซิร์ฟเวอร์ (HTTP ${response.status} ${response.statusText})`
      );
    }

    // ========== SUCCESS ==========
    const data: GeminiResponse = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    if (!data.candidates || data.candidates.length === 0) {
      throw new Error('ไม่ได้รับการตอบกลับจาก AI กรุณาลองใหม่อีกครั้ง');
    }

    // ดึงชื่อโมเดลที่ใช้จริง จาก body หรือ header
    const resolvedModel =
      data._resolvedModel ||
      response.headers.get('X-Resolved-Model') ||
      'unknown';

    const totalAttempts = data._totalAttempts || 1;

    return {
      text: data.candidates[0].content.parts.map(p => p.text).join(''),
      resolvedModel,
      totalAttempts,
    };
  }

  throw lastError || new Error('เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง');
}

/**
 * ส่ง Request แบบ Refinement (ปรับปรุงแผนเดิม)
 */
export async function refineWithGemini(
  currentPlan: string,
  instruction: string,
  systemInstruction?: string,
  onRetry?: (attempt: number, maxRetries: number, waitMs: number) => void
): Promise<GeminiResult> {
  const combinedPrompt = `
## แผนการจัดการเรียนรู้ปัจจุบัน:
${currentPlan}

## คำสั่งปรับปรุง:
${instruction}

กรุณาปรับปรุงแผนการจัดการเรียนรู้ตามคำสั่งข้างต้น โดยคงโครงสร้างเดิมไว้ แก้ไขเฉพาะส่วนที่ระบุ และส่งกลับแผนทั้งหมดที่ปรับปรุงแล้ว
`.trim();

  return callGemini(combinedPrompt, systemInstruction, 8192, onRetry);
}
