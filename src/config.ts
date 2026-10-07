/**
 * EduPlan AI — Configuration
 * ============================================================
 * ตั้งค่า Worker Endpoint และค่าคงที่ของระบบ
 * ============================================================
 */

/**
 * URL ของ Cloudflare Worker Proxy
 * เปลี่ยนค่านี้เป็น URL ของ Worker ที่ Deploy แล้ว
 * ตัวอย่าง: https://eduplan-proxy.your-subdomain.workers.dev
 */
export const DEFAULT_WORKER_ENDPOINT = 'https://eduplan-proxy.thianrawit-9347.workers.dev';

export function getWorkerEndpoint(): string {
  try {
    const saved = localStorage.getItem('eduplan_worker_endpoint');
    if (saved && saved.trim()) return saved.trim();
  } catch {
    // localStorage not accessible
  }
  return DEFAULT_WORKER_ENDPOINT;
}

export function setWorkerEndpoint(endpoint: string): void {
  try {
    if (endpoint && endpoint.trim()) {
      localStorage.setItem('eduplan_worker_endpoint', endpoint.trim());
    } else {
      localStorage.removeItem('eduplan_worker_endpoint');
    }
  } catch {
    // ignore
  }
}

export const WORKER_ENDPOINT = DEFAULT_WORKER_ENDPOINT;

/** Google Apps Script Web App URL สำหรับส่งข้อมูลการวิจัย (Telemetry) */
export const GOOGLE_SHEET_WEBAPP_URL: string = 'https://script.google.com/macros/s/AKfycbwT1ECr-NEmI6BUqDG3DT6LhzJSjqLSHNtLckfvNsfPPvT65P_vtdHEQKtzjQIH6cbG/exec';

/** ลำดับ Cascade สำหรับโหมดต่างๆ */
export const KPA_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
] as const;

export const FAST_MODELS = [
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
] as const;

export const PRECISION_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
] as const;

/** ลำดับ Waterfall Cascading ทั่วไป */
export const MODEL_CASCADE = FAST_MODELS;

/** ชื่อโมเดลเริ่มต้น (แสดงผลก่อนได้ response จาก Worker) */
export const GEMINI_MODEL = FAST_MODELS[0];

/** LocalStorage keys */
export const STORAGE_KEYS = {
  BYOK_KEY: 'eduplan_user_api_key',
  BYOK_ENABLED: 'eduplan_use_byok',
  PRECISION_QUOTA: 'eduplan_precision_quota',
  WORKER_ENDPOINT: 'eduplan_worker_endpoint',
} as const;

/** จำนวนชั่วโมงเรียนต่อคาบเริ่มต้น */
export const DEFAULT_DURATION_HOURS = 1;

/** วิธีการจัดการเรียนรู้ */
export const TEACHING_METHODS = [
  { id: 'active', label: 'Active Learning (เชิงรุก)' },
  { id: '5e', label: 'การจัดการเรียนรู้แบบสืบเสาะหาความรู้ (5E)' },
  { id: 'pbl_project', label: 'Project-Based Learning (PBL)' },
  { id: 'stem', label: 'STEM / STEAM Education' },
  { id: 'gpas', label: 'GPAS 5 Steps' },
  { id: 'pbl_problem', label: 'Problem-Based Learning (PBL)' },
  { id: 'game', label: 'Game-Based Learning (การเรียนรู้โดยใช้เกมเป็นฐาน)' },
  { id: 'design_thinking', label: 'กระบวนการคิดเชิงออกแบบ (Design Thinking)' },
  { id: 'custom', label: 'กำหนดเอง / ระบุเพิ่มเติม' },
] as const;

/** ค่าเริ่มต้นวิธีสอน */
export const DEFAULT_TEACHING_METHOD = 'game';

/** สมรรถนะสำคัญของผู้เรียน */
export const COMPETENCIES = [
  { id: 'communication', label: 'ความสามารถในการสื่อสาร' },
  { id: 'thinking', label: 'ความสามารถในการคิด' },
  { id: 'problem_solving', label: 'ความสามารถในการแก้ปัญหา' },
  { id: 'life_skills', label: 'ความสามารถในการใช้ทักษะชีวิต' },
  { id: 'technology', label: 'ความสามารถในการใช้เทคโนโลยี' },
] as const;

/** ทิศทางของแผน */
export const PLAN_DIRECTIONS = [
  { id: 'detailed', label: 'แผนละเอียด' },
  { id: 'clear_steps', label: 'ขั้นตอนชัดเจน' },
  { id: 'hands_on', label: 'ลงมือปฏิบัติ' },
  { id: 'games', label: 'เกมการเรียนรู้' },
  { id: 'varied_activities', label: 'กิจกรรมหลากหลาย' },
  { id: 'real_life', label: 'เชื่อมโยงชีวิตจริง' },
  { id: 'group_work', label: 'ทำงานกลุ่ม' },
  { id: 'differentiated', label: 'ดูแลผู้เรียนต่างระดับ' },
  { id: 'interactive', label: 'ถาม-ตอบโต้ตอบ' },
  { id: 'local_materials', label: 'สื่อและวัสดุใกล้ตัว' },
  { id: 'critical_thinking', label: 'ฝึกคิดวิเคราะห์' },
] as const;

/** ตัวเลือกชั่วโมงจัดการเรียนรู้ */
export interface DurationOption {
  id: string;
  value: number; // minutes
  label: string;
}

export const DURATION_OPTIONS: DurationOption[] = [
  { id: '1hour', value: 60, label: '1 ชั่วโมง' },
  { id: '50min', value: 50, label: '50 นาที' },
  { id: '2periods', value: 100, label: '1 ชั่วโมง 40 นาที' },
  { id: '2hours', value: 120, label: '2 ชั่วโมง' },
  { id: 'custom', value: 0, label: 'กำหนดเอง' },
];
