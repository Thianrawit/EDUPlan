/**
 * EduPlan AI — Cloudflare Worker Proxy
 * ============================================================
 * สถาปัตยกรรม Waterfall Model Cascading & Multi-Key Failover
 * 
 * คุณสมบัติ:
 * 1. Waterfall Model Cascading: ลองไล่ระดับโมเดลตามลำดับประสิทธิภาพ
 *    ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", 
 *     "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", 
 *     "gemini-2.5-flash-lite", "gemini-2.0-flash", "gemini-1.5-flash"]
 * 2. Multi-Key Failover: แต่ละโมเดลจะหมุนเวียนสลับ API Key (สุ่มลำดับ)
 *    เพื่อหลีกเลี่ยงการติด Rate Limit (15 RPM / Key)
 * 3. Smart Skip (Fast Cascade): หากโมเดลใดติด 404/400 (ยังไม่เปิดให้ใช้ในระบบ)
 *    ระบบจะข้ามไปโมเดลถัดไปทันทีโดยไม่เสียเวลาลองคีย์ซ้ำ
 * 4. Header & Payload Reporting: แนบ `_resolvedModel` ใน JSON และ
 *    Header `X-Resolved-Model` เพื่อให้ Client ทราบโมเดลที่ให้บริการจริง
 * ============================================================
 */

const DEFAULT_MODEL_CASCADE = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash', // Safety net: โมเดลมาตรฐานที่การันตีความพร้อมใช้งาน
  'gemini-1.5-flash', // Safety net: ลำดับสุดท้าย
];

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Delay สั้นๆ ระหว่าง key ภายในโมเดลเดียวกันเพื่อลด burst (milliseconds) */
const KEY_DELAY_MS = 200;

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
 * Sleep utility
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * สร้าง CORS Headers
 */
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With',
    'Access-Control-Expose-Headers': 'X-Resolved-Model, Retry-After',
    'Access-Control-Max-Age': '86400',
  };
}

/**
 * ดึง Retry-After จาก response header (ถ้ามี)
 */
function getRetryAfterMs(response) {
  const retryAfter = response.headers.get('Retry-After');
  if (!retryAfter) return null;
  const seconds = parseInt(retryAfter, 10);
  if (!isNaN(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, 30000); // สูงสุดไม่เกิน 30s
  }
  return null;
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

    // 4. รวบรวม API Keys จาก Environment (รองรับสูงสุด GEMINI_KEY_1 ถึง GEMINI_KEY_10)
    const keys = [];
    for (let i = 1; i <= 10; i++) {
      const key = env[`GEMINI_KEY_${i}`];
      if (key && key.trim()) keys.push(key.trim());
    }

    // รองรับ fallback ตัวแปรเดี่ยว GEMINI_API_KEY หรือแบบ comma-separated
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

    // 5. กำหนดลำดับโมเดล Waterfall Cascade
    let modelCascade = [...DEFAULT_MODEL_CASCADE];
    if (Array.isArray(body.models) && body.models.length > 0) {
      modelCascade = body.models;
    } else if (typeof body.model === 'string' && body.model.trim()) {
      const preferred = body.model.trim();
      modelCascade = [preferred, ...modelCascade.filter(m => m !== preferred)];
    }

    // 6. เตรียม Payload สำหรับ Gemini API
    const geminiPayload = {
      contents: body.contents || [],
      generationConfig: body.generationConfig || {
        temperature: 0.7,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
      },
    };

    if (body.systemInstruction) {
      geminiPayload.systemInstruction = body.systemInstruction;
    }

    const failureLogs = [];
    let attemptCount = 0;

    // ============================================================
    // 7. Waterfall Cascading Execution
    // วนลูปตามลำดับโมเดล -> ในแต่ละโมเดลวนลูปสลับคีย์
    // ============================================================
    for (const model of modelCascade) {
      const shuffledKeys = shuffleArray(keys);
      let modelUnavailable = false;

      for (let keyIdx = 0; keyIdx < shuffledKeys.length; keyIdx++) {
        attemptCount++;
        const apiKey = shuffledKeys[keyIdx];
        const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`;

        if (keyIdx > 0) {
          await sleep(KEY_DELAY_MS);
        }

        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geminiPayload),
          });

          // กรณีสำเร็จ (200 OK)
          if (response.ok) {
            const data = await response.json();
            // แนบ Metadata โมเดลที่สำเร็จเพื่อให้ Client แสดงผล
            data._resolvedModel = model;
            data._totalAttempts = attemptCount;

            return new Response(JSON.stringify(data), {
              status: 200,
              headers: {
                ...corsHeaders(),
                'Content-Type': 'application/json',
                'X-Resolved-Model': model,
              },
            });
          }

          // กรณี 404 (Not Found) หรือ 400 (Bad Request - Model Not Supported)
          // แสดงว่าโมเดลนี้ยังไม่มี/ไม่รองรับบน Google API -> ข้ามโมเดลนี้ทันที!
          if (response.status === 404 || response.status === 400) {
            const errSnippet = await response.text().catch(() => '');
            failureLogs.push(`[${model}] HTTP ${response.status} (Model not available or unsupported)`);
            modelUnavailable = true;
            break; // ออกจาก loop คีย์ ข้ามไปโมเดลถัดไปใน Cascade ทันที
          }

          // กรณี 429 (Rate Limit / Quota Exceeded) หรือ 503 (Service Unavailable)
          if (response.status === 429 || response.status === 503) {
            const retryMs = getRetryAfterMs(response);
            failureLogs.push(`[${model}][Key ${keyIdx + 1}] HTTP ${response.status}`);

            // ถ้ามี Retry-After สั้นๆ และไม่ใช่คีย์สุดท้าย ให้รอนิดนึง
            if (retryMs && retryMs <= 3000 && keyIdx < shuffledKeys.length - 1) {
              await sleep(retryMs);
            }
            continue; // ลองคีย์ถัดไปของโมเดลนี้
          }

          // กรณี Error อื่นๆ
          const errText = await response.text().catch(() => '');
          failureLogs.push(`[${model}][Key ${keyIdx + 1}] HTTP ${response.status}: ${errText.slice(0, 100)}`);

        } catch (fetchErr) {
          failureLogs.push(`[${model}][Key ${keyIdx + 1}] Network error: ${fetchErr?.message || fetchErr}`);
        }
      }

      // ถ้าโมเดลนี้ใช้ไม่ได้ ให้ขยับไปโมเดลถัดไป
      if (modelUnavailable) {
        continue;
      }
    }

    // ============================================================
    // 8. ทุกโมเดลและทุกคีย์หมดโควต้า/ล้มเหลว
    // ============================================================
    return new Response(
      JSON.stringify({
        error: 'ระบบไม่สามารถประมวลผลได้ในขณะนี้ เนื่องจาก API ทุกคีย์และทุกโมเดลถูกจำกัดอัตราการใช้งาน กรุณารอสักครู่แล้วลองใหม่อีกครั้ง',
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
