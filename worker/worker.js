/**
 * EduPlan AI — Cloudflare Worker Proxy (Serverless Edge Gateway)
 * ============================================================
 * สถาปัตยกรรม Tiered AI Architecture & Zero-Wait Multi-Key Failover
 * + Cloudflare KV Centralized Model Management & Admin Control
 * 
 * คุณสมบัติ:
 * 1. Cloudflare KV Global Control: อ่าน/บันทึก SYSTEM_TIER_MODELS ผ่าน env.CONFIG_KV
 * 2. Tiered Routing: จัดการลำดับโมเดลตาม mode ('kpa' | 'fast' | 'precision')
 * 3. Zero-Wait Failover: หาก Key ติด HTTP 429 จะข้ามไป Key ถัดไปทันที (0ms wait)
 * 4. Smart Skip: หากติด 404/400 ข้ามไปโมเดลถัดไปทันที
 * 5. Fallback Model Safety Net: การันตีโมเดล gemini-2.0-flash / gemini-1.5-flash
 *    เป็น Fallback สุดท้ายเสมอเพื่อป้องกัน 404
 * 6. Admin API: จัดการอัปเดตโมเดลระบบสากลผ่าน SHA-256 Auth Token
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
const ADMIN_HASH = 'a2cb7058a9807fa56a6ec1ec1c05d76ad72a382e70c2a2b0d061ad1845423f66';
const ADMIN_HASH_ALT = 'b88a654795e69623cdbecbf44950edf90ef247410a5555417d4cb94d1b09fea5';
const ADMIN_HASHES = [ADMIN_HASH, ADMIN_HASH_ALT];

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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With, Authorization, X-Admin-Token',
    'Access-Control-Expose-Headers': 'X-Resolved-Model, Retry-After',
    'Access-Control-Max-Age': '86400',
  };
}

/**
 * ตรวจสอบความถูกต้องของ Admin Token
 */
function isAuthorizedAdmin(request, body) {
  const tokenHeader = request.headers.get('X-Admin-Token');
  if (tokenHeader && ADMIN_HASHES.includes(tokenHeader.trim())) return true;
  if (body && (ADMIN_HASHES.includes(body.adminToken) || ADMIN_HASHES.includes(body.hash))) return true;
  return false;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 1. จัดการ CORS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    // ============================================================
    // 2. ADMIN ENDPOINTS (Centralized Model Control via Cloudflare KV)
    // ============================================================

    // 2.1 GET /api/admin/config — ดึงคอนฟิกโมเดลระบบปัจจุบัน
    if (path === '/api/admin/config' && request.method === 'GET') {
      let effectiveTiers = { ...TIER_MODELS };
      if (env.CONFIG_KV) {
        try {
          const savedTiers = await env.CONFIG_KV.get('SYSTEM_TIER_MODELS', { type: 'json' });
          if (savedTiers && typeof savedTiers === 'object') {
            effectiveTiers = savedTiers;
          }
        } catch (err) {
          console.warn('KV read error, falling back to default:', err);
        }
      }
      return new Response(JSON.stringify({ success: true, tiers: effectiveTiers }), {
        status: 200,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      });
    }

    // 2.2 POST /api/admin/config — อัปเดตโมเดลระบบสากลลง KV
    if (path === '/api/admin/config' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
          status: 400,
          headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
        });
      }

      if (!isAuthorizedAdmin(request, body)) {
        return new Response(JSON.stringify({ error: 'Unauthorized: Invalid Admin Token' }), {
          status: 401,
          headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
        });
      }

      if (!body.newTiers || typeof body.newTiers !== 'object') {
        return new Response(JSON.stringify({ error: 'Missing or invalid newTiers object' }), {
          status: 400,
          headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
        });
      }

      if (env.CONFIG_KV) {
        try {
          await env.CONFIG_KV.put('SYSTEM_TIER_MODELS', JSON.stringify(body.newTiers));
        } catch (err) {
          return new Response(JSON.stringify({ error: `KV write error: ${err.message}` }), {
            status: 500,
            headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
          });
        }
      } else {
        console.warn('CONFIG_KV binding not configured on environment');
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: 'อัปเดตโมเดลระบบสากลสำเร็จ มีผลทุกเครื่องทันที',
          tiers: body.newTiers,
        }),
        {
          status: 200,
          headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
        }
      );
    }

    // 2.3 POST /api/admin/reset — คืนค่าเริ่มต้นโมเดลระบบเดิม (ลบจาก KV)
    if (path === '/api/admin/reset' && request.method === 'POST') {
      let body = {};
      try {
        body = await request.json();
      } catch {}

      if (!isAuthorizedAdmin(request, body)) {
        return new Response(JSON.stringify({ error: 'Unauthorized: Invalid Admin Token' }), {
          status: 401,
          headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
        });
      }

      if (env.CONFIG_KV) {
        try {
          await env.CONFIG_KV.delete('SYSTEM_TIER_MODELS');
        } catch (err) {
          console.warn('KV delete error:', err);
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: 'คืนค่าเริ่มต้นตาม Worker เรียบร้อย',
          tiers: TIER_MODELS,
        }),
        {
          status: 200,
          headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
        }
      );
    }

    // ============================================================
    // 3. GENERATION REQUESTS (POST / or Root)
    // ============================================================
    if (request.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        {
          status: 405,
          headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
        }
      );
    }

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

    // 5. อ่าน Effective Tiers จาก Cloudflare KV (Defensive Check ป้องกันแครช)
    let effectiveTiers = { ...TIER_MODELS };
    if (env.CONFIG_KV) {
      try {
        const savedTiers = await env.CONFIG_KV.get('SYSTEM_TIER_MODELS', { type: 'json' });
        if (savedTiers && typeof savedTiers === 'object') {
          effectiveTiers = {
            kpa: Array.isArray(savedTiers.kpa) && savedTiers.kpa.length > 0 ? savedTiers.kpa : TIER_MODELS.kpa,
            fast: Array.isArray(savedTiers.fast) && savedTiers.fast.length > 0 ? savedTiers.fast : TIER_MODELS.fast,
            precision: Array.isArray(savedTiers.precision) && savedTiers.precision.length > 0 ? savedTiers.precision : TIER_MODELS.precision,
          };
        }
      } catch (err) {
        console.warn('KV read error, falling back to default:', err);
      }
    }

    // 6. กำหนดลำดับโมเดลตาม Routing Mode ('kpa' | 'fast' | 'precision')
    const mode = (body.mode || '').toLowerCase().trim();
    let modelCascade;

    if (mode && effectiveTiers[mode]) {
      modelCascade = [...effectiveTiers[mode]];
    } else if (Array.isArray(body.models) && body.models.length > 0) {
      modelCascade = [...body.models];
    } else if (typeof body.model === 'string' && body.model.trim()) {
      const preferred = body.model.trim();
      const fallbackList = effectiveTiers.fast || DEFAULT_MODEL_CASCADE;
      modelCascade = [preferred, ...fallbackList.filter(m => m !== preferred)];
    } else {
      modelCascade = [...(effectiveTiers.fast || DEFAULT_MODEL_CASCADE)];
    }

    // รับประกันว่ามี Fallback Model ตัวสุดท้ายเสมอเพื่อป้องกัน HTTP 404
    for (const fb of GUARANTEED_FALLBACKS) {
      if (!modelCascade.includes(fb)) {
        modelCascade.push(fb);
      }
    }

    // 7. เตรียม Payload สำหรับ Gemini API
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
    // 8. Waterfall Cascading Execution (Zero-Wait Failover)
    // วนลูปโมเดล -> ในแต่ละโมเดลวนสลับคีย์
    // หากเจอ 429 จะข้ามไปคีย์ถัดไปทันที (0ms wait)
    // ============================================================
    for (const model of modelCascade) {
      const shuffledKeys = shuffleArray(keys);
      let modelUnavailable = false;

      for (let keyIdx = 0; keyIdx < shuffledKeys.length; keyIdx++) {
        attemptCount++;
        const apiKey = shuffledKeys[keyIdx];
        const apiUrl = `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`;

        try {
          const response = await fetch(apiUrl, {
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
    // 9. ทุกโมเดลและทุกคีย์หมดโควต้า/ล้มเหลว
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
