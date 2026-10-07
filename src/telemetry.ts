/**
 * EduPlan AI — Anonymous Research Telemetry
 * ============================================================
 * ระบบบันทึกสถิติเพื่อการวิจัยปริญญานิพนธ์ (Thesis)
 * ไม่บันทึกข้อมูลส่วนบุคคลเด็ดขาดตามมาตรฐานจริยธรรมการวิจัยและ PDPA
 * Non-blocking Fire-and-forget mechanism
 * ============================================================
 */

import { GOOGLE_SHEET_WEBAPP_URL } from './config';

export interface TelemetryPayload {
  timestamp: string;          // ISO String
  session_id: string;         // สุ่ม UUID ประจำ Session ในเบราว์เซอร์
  subject_id: string;         // รหัสวิชา เช่น 'thai', 'math'
  grade_level: string;        // รหัสชั้น เช่น 'p1', 'm3'
  generation_mode: string;    // 'kpa', 'fast', 'precision'
  key_type: string;           // 'system_shared' | 'user_byok'
  resolved_model: string;     // ชื่อโมเดลที่ใช้งานจริง
  duration_seconds: number;   // ระยะเวลาประมวลผล (ทศนิยม 1 ตำแหน่ง)
  export_action?: string;     // 'docx' | 'copy_section' | 'copy_full'
}

const SESSION_KEY = 'eduplan_research_session_id';

/**
 * ดึงหรือสร้าง Session ID แบบสุ่ม (UUID v4) สำหรับเซสชันปัจจุบัน
 */
export function getOrCreateSessionId(): string {
  try {
    let sid = sessionStorage.getItem(SESSION_KEY);
    if (!sid) {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        sid = crypto.randomUUID();
      } else {
        sid = 'sess_' + Math.random().toString(36).substring(2, 15) + '_' + Date.now().toString(36);
      }
      sessionStorage.setItem(SESSION_KEY, sid);
    }
    return sid;
  } catch {
    return 'anon_session_' + Date.now();
  }
}

/**
 * ส่งข้อมูล Telemetry แบบ Non-blocking (Fire-and-forget)
 * หากไม่มี URL ตั้งค่าไว้ จะข้ามโดยอัตโนมัติ ไม่โยน error ใดๆ ออกมา
 */
export function sendTelemetry(data: Omit<TelemetryPayload, 'timestamp' | 'session_id'> & { session_id?: string }): void {
  try {
    const rawUrl = (GOOGLE_SHEET_WEBAPP_URL as string) || '';
    const url = rawUrl.trim();
    if (!url) {
      // ข้ามการส่งหากยังไม่ได้กำหนด URL ของ Google Apps Script
      return;
    }

    const payload: TelemetryPayload = {
      timestamp: new Date().toISOString(),
      session_id: data.session_id || getOrCreateSessionId(),
      subject_id: data.subject_id || '',
      grade_level: data.grade_level || '',
      generation_mode: data.generation_mode || 'fast',
      key_type: data.key_type || 'system_shared',
      resolved_model: data.resolved_model || 'unknown',
      duration_seconds: Math.round(data.duration_seconds * 10) / 10,
      export_action: data.export_action,
    };

    const jsonStr = JSON.stringify(payload);

    // ลองใช้ navigator.sendBeacon ก่อน ถ้าไม่ได้ให้ใช้ fetch (no-cors, keepalive)
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([jsonStr], { type: 'text/plain;charset=UTF-8' });
      const queued = navigator.sendBeacon(url, blob);
      if (queued) return;
    }

    fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      keepalive: true,
      headers: {
        'Content-Type': 'text/plain;charset=UTF-8',
      },
      body: jsonStr,
    }).catch(() => {
      // กลืน error เพื่อไม่ให้กระทบการทำงานของผู้ใช้
    });
  } catch {
    // Fail silently for research telemetry
  }
}
