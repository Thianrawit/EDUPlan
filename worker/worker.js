/**
 * EduPlan AI — Cloudflare Worker Proxy (Serverless Edge Gateway)
 * ============================================================
 * สถาปัตยกรรม Tiered AI Architecture & Zero-Wait Multi-Key Failover
 * 
 * คุณสมบัติ:
 * 1. Tiered Routing: จัดการลำดับโมเดลตาม mode ('kpa' | 'fast' | 'precision')
 * 2. Zero-Wait Failover: หาก Key ติด HTTP 429 จะข้ามไป Key ถัดไปทันที (0ms wait)
 * 3. Smart Skip: หากติด 404/400 ข้ามไปโมเดลถัดไปทันที
 * 4. Fallback Model Safety Net: การันตีโมเดล gemini-2.0-flash / gemini-1.5-flash
 *    เป็น Fallback สุดท้ายเสมอเพื่อป้องกัน 404
 * 5. Metadata Headers: ส่งคืน X-Resolved-Model และแนบ _resolvedModel ใน body
 * ============================================================
 */

const TIER_MODELS = {
  kpa: [
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
  ],
  fast: [
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
  ],
  precision: [
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
  ],
};

const DEFAULT_MODEL_CASCADE = TIER_MODELS.fast;
const GUARANTEED_FALLBACKS = ['gemini-2.0-flash', 'gemini-1.5-flash'];
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * สุ่มสลับลำดับ Array (Fisher-Yates Shuffle)
 */
function shuffleArray(arr) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * สร้าง CORS Headers
 */
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With, Authorization',
    'Access-Control-Expose-Headers': 'X-Resolved-Model, Retry-After',
    'Access-Control-Max-Age': '86400',
  };
}

export default {
  async fetch(request, env) {
    // 1. จัดการ CORS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    // 2. รับเฉพาะ POST Method
    if (request.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        {
          status: 405,
          headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
        }
      );
    }

    // 3. แปลง Request Body
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON body' }),
        {
          status: 400,
          headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
        }
      );
    }

    // 4. รวบรวม API Keys จาก Environment (รองรับ GEMINI_KEY_1 ถึง GEMINI_KEY_10 และ Fallback)
    const keys = [];
    for (let i = 1; i <= 10; i++) {
      const key = env[`GEMINI_KEY_${i}`];
      if (key && key.trim()) keys.push(key.trim());
    }

    if (env.GEMINI_API_KEY && !keys.includes(env.GEMINI_API_KEY.trim())) {
      keys.push(env.GEMINI_API_KEY.trim());
    }
    if (env.GEMINI_API_KEYS) {
      env.GEMINI_API_KEYS.split(',')
        .map(k => k.trim())
        .filter(Boolean)
        .forEach(k => {
          if (!keys.includes(k)) keys.push(k);
        });
    }

    if (keys.length === 0) {
      return new Response(
        JSON.stringify({
          error: 'No API keys configured on Worker. Please set GEMINI_KEY_1, GEMINI_KEY_2, etc.',
        }),
        {
          status: 500,
          headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
        }
      );
    }

    // 5. กำหนดลำดับโมเดลตาม Routing Mode ('kpa' | 'fast' | 'precision')
    const mode = (body.mode || '').toLowerCase().trim();
    let modelCascade;

    if (mode && TIER_MODELS[mode]) {
      modelCascade = [...TIER_MODELS[mode]];
    } else if (Array.isArray(body.models) && body.models.length > 0) {
      modelCascade = [...body.models];
    } else if (typeof body.model === 'string' && body.model.trim()) {
      const preferred = body.model.trim();
      modelCascade = [preferred, ...DEFAULT_MODEL_CASCADE.filter(m => m !== preferred)];
    } else {
      modelCascade = [...DEFAULT_MODEL_CASCADE];
    }

    // รับประกันว่ามี Fallback Model ตัวสุดท้ายเสมอเพื่อป้องกัน HTTP 404
    for (const fb of GUARANTEED_FALLBACKS) {
      if (!modelCascade.includes(fb)) {
        modelCascade.push(fb);
      }
    }

    // 6. เตรียม Payload สำหรับ Gemini API
    let contents = body.contents;
    if (!contents && body.prompt) {
      contents = [
        {
          role: 'user',
          parts: [{ text: body.prompt }],
        },
      ];
    }

    const geminiPayload = {
      contents: contents || [],
      generationConfig: body.generationConfig || {
        temperature: mode === 'kpa' ? 0.2 : 0.7,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: mode === 'kpa' ? 1024 : 8192,
      },
    };

    if (body.systemInstruction) {
      if (typeof body.systemInstruction === 'string') {
        geminiPayload.systemInstruction = {
          parts: [{ text: body.systemInstruction }],
        };
      } else {
        geminiPayload.systemInstruction = body.systemInstruction;
      }
    }

    const failureLogs = [];
    let attemptCount = 0;

    // ============================================================
    // 7. Waterfall Cascading Execution (Zero-Wait Failover)
    // วนลูปโมเดล -> ในแต่ละโมเดลวนสลับคีย์
    // หากเจอ 429 จะข้ามไปคีย์ถัดไปทันที (0ms wait)
    // ============================================================
    for (const model of modelCascade) {
      const shuffledKeys = shuffleArray(keys);
      let modelUnavailable = false;

      for (let keyIdx = 0; keyIdx < shuffledKeys.length; keyIdx++) {
        attemptCount++;
        const apiKey = shuffledKeys[keyIdx];
        const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`;

        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geminiPayload),
          });

          // สำเร็จ (200 OK)
          if (response.ok) {
            const data = await response.json();
            data._resolvedModel = model;
            data._totalAttempts = attemptCount;
            data._generationMode = mode || 'default';

            return new Response(JSON.stringify(data), {
              status: 200,
              headers: {
                ...corsHeaders(),
                'Content-Type': 'application/json',
                'X-Resolved-Model': model,
              },
            });
          }

          // กรณี 404 (Not Found) หรือ 400 (Model not available or unsupported)
          // โมเดลนี้ไม่รองรับบน Google API -> ข้ามโมเดลนี้ทันที!
          if (response.status === 404 || response.status === 400) {
            failureLogs.push(`[${model}] HTTP ${response.status} (Model unavailable)`);
            modelUnavailable = true;
            break; // ข้ามไปโมเดลถัดไปใน Cascade ทันที
          }

          // กรณี 429 (Rate Limit / Quota Exceeded) หรือ 503
          // ZERO-WAIT FAILOVER: ข้ามไปลอง Key ถัดไปทันที 0ms wait!
          if (response.status === 429 || response.status === 503) {
            failureLogs.push(`[${model}][Key ${keyIdx + 1}] HTTP ${response.status}`);
            continue; // ไม่ sleep ข้ามไปคีย์ถัดไปทันที 0ms!
          }

          // กรณี Error อื่นๆ
          const errText = await response.text().catch(() => '');
          failureLogs.push(`[${model}][Key ${keyIdx + 1}] HTTP ${response.status}: ${errText.slice(0, 100)}`);

        } catch (fetchErr) {
          failureLogs.push(`[${model}][Key ${keyIdx + 1}] Network error: ${fetchErr?.message || fetchErr}`);
          // ข้ามไปคีย์ถัดไปทันที
          continue;
        }
      }

      if (modelUnavailable) {
        continue;
      }
    }

    // ============================================================
    // 8. ทุกโมเดลและทุกคีย์หมดโควต้า/ล้มเหลว
    // ============================================================
    return new Response(
      JSON.stringify({
        error: 'ระบบไม่สามารถประมวลผลได้ในขณะนี้ เนื่องจาก API ทุกคีย์และทุกโมเดลถูกจำกัดอัตราการใช้งาน กรุณารอสักครู่แล้วลองใหม่อีกครั้ง หรือใช้งาน Gemini API Key ส่วนตัว (BYOK) ผ่านเมนูตั้งค่า ⚙️',
        details: failureLogs,
        retryAfterSeconds: 30,
      }),
      {
        status: 429,
        headers: {
          ...corsHeaders(),
          'Content-Type': 'application/json',
          'Retry-After': '30',
        },
      }
    );
  },
};
