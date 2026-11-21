// ============================================================
// EDUPLAN Classroom — Data Schema, Shared Helpers & Vector Icons
// ============================================================

export type SyncMode = 'local' | 'google';
export type AttendanceStatus = 'present' | 'absent' | 'late';
export type SubmissionStatus = 'submitted' | 'missing';
export type RowKeyType = 'code' | 'number' | 'name' | 'order';
export type RoomTab = 'attendance' | 'assignments' | 'settings';
export type ClassroomRole = 'owner' | 'creator' | 'assistant' | 'viewer';
export type SessionHeaderMode = 'both' | 'date' | 'period';

export interface Collaborator {
  email: string;
  role: Exclude<ClassroomRole, 'owner'>;
  permissionId?: string;
}

export interface Classroom {
  id: string;
  name: string;          // ระดับชั้น/ห้อง เช่น ม.1/1
  subject: string;       // วิชา
  term: string;          // ภาคเรียน เช่น 1
  academicYear: string;  // ปีการศึกษา (พ.ศ.)
  syncMode: SyncMode;
  sheet: SheetMapping | null;
  sheetId?: string;                  // spreadsheetId (Backward-Compatible reference)
  isSharedWithMe?: boolean;          // true = ห้องเรียนที่ถูกเชิญมา
  importedViaPicker?: boolean;       // true = นำเข้าผ่าน Google Picker
  role?: ClassroomRole;              // สิทธิ์ของผู้ใช้ปัจจุบัน (default: 'owner')
  ownerEmail?: string;               // อีเมลเจ้าของห้อง (สำหรับห้องร่วม)
  collaborators?: Collaborator[];    // รายชื่อผู้ร่วมสอน (สูงสุด 5 คน)
  myPermissionId?: string;           // permissionId ของตัวเอง (สำหรับห้องร่วม)
  lastModifiedTime?: string;         // เวลาแก้ไขล่าสุดจาก Google Drive
  lastKnownModifiedTime?: string;    // เวลาแก้ไขล่าสุดที่ซิงก์กับ Google Sheet แล้ว (Source of Truth)
  attendanceHeaderMode?: SessionHeaderMode; // รูปแบบหัวคอลัมน์เช็คชื่อล่าสุดของห้อง
  assignmentStartCol?: number;       // 0-based index คอลัมน์เริ่มต้นของการส่งงาน (Number)
  createdAt: number;
  updatedAt: number;
}

export interface Student {
  id: string;
  classroomId: string;
  number: string;        // เลขที่
  studentCode: string;   // รหัสนักเรียน
  fullName: string;      // คำนำหน้า/ชื่อ-สกุล
  order: number;
  updatedAt: number;
}

export interface AttendanceSession {
  id: string;
  classroomId: string;
  date: string;          // YYYY-MM-DD (ค.ศ.)
  period: string;        // คาบเรียน/รอบ
  headerMode?: SessionHeaderMode; // รูปแบบการแสดงหัวช่อง: ทั้ง 2 (2 บรรทัด) / แค่คาบ / แค่วันที่
  records: Record<string, AttendanceStatus>; // studentId -> status
  sheetColumn: number | null; // 0-based column (Google Sheet แบบไฟล์เดิม)
  sheetSynced: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Submission {
  status: SubmissionStatus;
  score: number | null;
}

export interface Assignment {
  id: string;
  classroomId: string;
  title: string;
  assignedDate: string;  // YYYY-MM-DD
  dueDate: string;       // YYYY-MM-DD
  maxScore: number | null;
  submissions: Record<string, Submission>; // studentId -> submission
  sheetColumn: number | null;
  sheetSynced: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Tombstone {
  id: string;            // `${table}:${recordId}`
  table: 'classrooms' | 'students' | 'sessions' | 'assignments';
  recordId: string;
  classroomId: string;
  deletedAt: number;
}

/** ข้อมูลการรวมเซลล์ (Merged Cells) — index แบบ 0-based (end เป็น exclusive ตามมาตรฐาน GridRange) */
export interface SheetMerge {
  startRowIndex: number;
  endRowIndex: number;
  startColumnIndex: number;
  endColumnIndex: number;
}

/** การจับคู่คอลัมน์จากตาราง (Excel / Google Sheet) — index เริ่มที่ 0 */
export interface ColumnMapping {
  headerRow: number;              // index แถวหัวตาราง (0-based)
  number: number | null;
  code: number | null;
  nameMode: 'single' | 'split';
  name: number | null;
  prefix: number | null;
  first: number | null;
  last: number | null;
}

export interface ParsedStudent {
  number: string;
  studentCode: string;
  fullName: string;
}

export interface AttendanceSheetMapping {
  sheetTitle: string;
  headerRow: number;      // 1-based
  keyCol: number;         // 0-based
  keyType: RowKeyType;
  startCol: number;       // 0-based
  mode: 'append' | 'fixed';
  fixedCount: number;
}

export interface AssignmentSheetMapping {
  sheetTitle: string;
  headerRow: number;      // 1-based
  keyCol: number;
  keyType: RowKeyType;
  startCol: number;
  colsPerAssignment?: 1 | 2; // 1 = คอลัมน์เดียว (คะแนน/สถานะ), 2 = 2 คอลัมน์ (สถานะ + คะแนน)
}

export interface SheetMapping {
  spreadsheetId: string;
  spreadsheetName: string;
  spreadsheetUrl: string;
  standard: boolean;      // true = ไฟล์มาตรฐานแบบ A ที่ระบบสร้างเอง
  roster: { sheetTitle: string; mapping: ColumnMapping } | null;
  attendance: AttendanceSheetMapping | null;
  assignments: AssignmentSheetMapping | null;
}

export interface SyncSnapshot {
  version: 1;
  updatedAt: number;
  classrooms: Classroom[];
  students: Student[];
  sessions: AttendanceSession[];
  assignments: Assignment[];
  tombstones: Tombstone[];
}

/** ตัวควบคุมการนำทางที่ main.ts ส่งให้ทุก component */
export interface AppContext {
  openRoom: (id: string, tab?: RoomTab) => void;
  goHub: () => void;
  refresh: () => void;
  setDirty: (dirty: boolean) => void;
}

// ---------------- Constants ----------------
export const STANDARD_TABS = {
  roster: 'รายชื่อนักเรียน',
  attendance: 'การมาเรียน',
  assignments: 'การส่งงาน',
} as const;

export const ATTENDANCE_LABEL: Record<AttendanceStatus, string> = {
  present: 'มา',
  absent: 'ลา/ขาด',
  late: 'มาสาย',
};

export const SUBMISSION_LABEL: Record<SubmissionStatus, string> = {
  submitted: 'ส่งแล้ว',
  missing: 'ยังไม่ส่ง',
};

export const KEY_TYPE_LABEL: Record<RowKeyType, string> = {
  code: 'รหัสนักเรียน',
  number: 'เลขที่',
  name: 'ชื่อ-สกุล',
  order: 'ลำดับแถว (ไม่จับคู่)',
};

export const ROLE_BADGE_LABEL: Record<ClassroomRole, string> = {
  owner: 'เจ้าของห้อง',
  creator: 'ครีเอเตอร์',
  assistant: 'ครูผู้ช่วย',
  viewer: 'ผู้ชม',
};

export const ROLE_ICON: Record<ClassroomRole, IconName> = {
  owner: 'crown',
  creator: 'wrench',
  assistant: 'clipboard',
  viewer: 'eye',
};

export const COLLAB_ROLE_OPTIONS: { value: Exclude<ClassroomRole, 'owner'>; label: string; short: string }[] = [
  { value: 'viewer', label: 'ผู้ชม - ดูได้อย่างเดียว', short: 'ผู้ชม' },
  { value: 'assistant', label: 'ครูผู้ช่วย - เช็คชื่อ/เพิ่มลบงาน', short: 'ครูผู้ช่วย' },
  { value: 'creator', label: 'ครีเอเตอร์ - แก้ไขได้ทั้งหมด', short: 'ครีเอเตอร์' },
];

export function getEffectiveRole(room: Pick<Classroom, 'role'> | null | undefined): ClassroomRole {
  return room?.role ?? 'owner';
}

export function roleBadgeHtml(role: ClassroomRole, customLabel?: string): string {
  return `<span class="cr-role-pill is-${role}">${icon(ROLE_ICON[role], 13)}<span>${escapeHtml(customLabel ?? ROLE_BADGE_LABEL[role])}</span></span>`;
}

// ---------------- Pure helpers ----------------
export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function escapeHtml(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function colToLetter(index: number): string {
  let n = Math.floor(Number(index)) + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** แปลงค่าคอลัมน์ (ตัวเลข 0-based, สตริงตัวเลข เช่น "5", หรือตัวอักษร A1 เช่น "F", "F, G", "AA") เป็น index แบบ Number เสมอ */
export function parseColumnIndex(raw: unknown, fallback = 0): number {
  const safeFallback = Number.isFinite(Number(fallback)) ? Math.max(0, Math.floor(Number(fallback))) : 0;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : safeFallback;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return safeFallback;
    if (/^\d+$/.test(trimmed)) return Math.max(0, Math.floor(Number(trimmed)));
    const letterMatch = /^([A-Za-z]+)/.exec(trimmed);
    if (letterMatch) {
      const letters = letterMatch[1].toUpperCase();
      let acc = 0;
      for (let i = 0; i < letters.length; i++) {
        acc = acc * 26 + (letters.charCodeAt(i) - 64);
      }
      return Math.max(0, acc - 1);
    }
    const asNum = Number(trimmed);
    if (Number.isFinite(asNum)) return Math.max(0, Math.floor(asNum));
  }
  return safeFallback;
}

/** ดึงค่าคอลัมน์เริ่มต้นของการส่งงาน (0-based Number) จากการตั้งค่าของห้องเรียน */
export function getRoomAssignmentStartCol(room: Pick<Classroom, 'sheet' | 'assignmentStartCol'> | null | undefined): number | null {
  if (!room) return null;
  if (room.sheet?.assignments && room.sheet.assignments.startCol !== undefined && room.sheet.assignments.startCol !== null) {
    return parseColumnIndex(room.sheet.assignments.startCol, 0);
  }
  if (room.assignmentStartCol !== undefined && room.assignmentStartCol !== null) {
    return parseColumnIndex(room.assignmentStartCol, 0);
  }
  if (room.sheet?.standard) return 3;
  return null;
}

export function todayISO(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** YYYY-MM-DD -> dd/mm/yyyy (พ.ศ.) */
export function formatThaiDate(iso: string): string {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y + 543}`;
}

/** ปีการศึกษาไทยปัจจุบัน (เริ่มพฤษภาคม) */
export function currentAcademicYear(): string {
  const d = new Date();
  const be = d.getFullYear() + 543;
  return String(d.getMonth() >= 4 ? be : be - 1);
}

export function currentTerm(): string {
  const m = new Date().getMonth();
  return m >= 4 && m <= 9 ? '1' : '2';
}

/** ข้อความหัวคอลัมน์ใน Google Sheet / Excel / ตาราง (แบ่ง 2 บรรทัดเมื่อเลือกแสดงทั้ง 2: คาบบน + วันที่ล่าง) */
export function sessionHeaderText(s: Pick<AttendanceSession, 'date' | 'period' | 'headerMode'>): string {
  const mode: SessionHeaderMode = s.headerMode ?? 'both';
  const dateText = formatThaiDate(s.date);
  const periodText = (s.period ?? '').trim();
  if (mode === 'date') return dateText;
  if (mode === 'period') return periodText || dateText;
  return periodText ? `${periodText}\n${dateText}` : dateText;
}

/** ข้อความรอบเช็คชื่อแบบบรรทัดเดียว (ใช้กับ dropdown / dialog / toast) */
export function sessionLabel(s: Pick<AttendanceSession, 'date' | 'period' | 'headerMode'>): string {
  const mode: SessionHeaderMode = s.headerMode ?? 'both';
  const dateText = formatThaiDate(s.date);
  const periodText = (s.period ?? '').trim();
  if (mode === 'date') return dateText;
  if (mode === 'period') return periodText || dateText;
  return periodText ? `${periodText} (${dateText})` : dateText;
}

export function sortSessions(list: AttendanceSession[]): AttendanceSession[] {
  return [...list].sort(
    (a, b) => a.date.localeCompare(b.date) || a.period.localeCompare(b.period, 'th') || a.createdAt - b.createdAt,
  );
}

export function sortAssignments(list: Assignment[]): Assignment[] {
  return [...list].sort((a, b) => a.assignedDate.localeCompare(b.assignedDate) || a.createdAt - b.createdAt);
}

export function normalizeKey(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, '').toLowerCase();
}

export function classroomTitle(c: Pick<Classroom, 'subject' | 'name'>): string {
  return [c.subject, c.name].filter(Boolean).join(' · ') || 'ห้องเรียนไม่มีชื่อ';
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/** ตรวจสอบ URL ภายนอกให้ปลอดภัย (อนุญาตเฉพาะ https:// เท่านั้น) */
export function safeHttpsUrl(raw: string | null | undefined): string {
  if (!raw) return '';
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' ? u.href : '';
  } catch {
    return '';
  }
}

// ---------------- Merged Cells Layout Helper ----------------
export interface MergeAnchor {
  rowSpan: number;
  colSpan: number;
  originRow: number;
  originCol: number;
  endRow: number; // exclusive (clamped)
  endCol: number; // exclusive (clamped)
}

export interface MergeLayout {
  anchors: Map<string, MergeAnchor>;
  covered: Set<string>;
}

/** คำนวณตำแหน่ง rowspan/colspan ของเซลล์ที่ Merge กันภายในขอบเขตตารางที่แสดง */
export function buildMergeLayout(
  merges: SheetMerge[] | undefined,
  rowStart: number,
  rowEnd: number,
  colStart: number,
  colEnd: number,
): MergeLayout {
  const anchors = new Map<string, MergeAnchor>();
  const covered = new Set<string>();
  if (!merges?.length) return { anchors, covered };

  for (const m of merges) {
    const r0 = Math.max(m.startRowIndex, rowStart);
    const r1 = Math.min(m.endRowIndex, rowEnd);
    const c0 = Math.max(m.startColumnIndex, colStart);
    const c1 = Math.min(m.endColumnIndex, colEnd);
    if (r0 >= r1 || c0 >= c1) continue;
    const rowSpan = r1 - r0;
    const colSpan = c1 - c0;
    if (rowSpan <= 1 && colSpan <= 1) continue;

    const anchorKey = `${r0}:${c0}`;
    if (covered.has(anchorKey) || anchors.has(anchorKey)) continue;

    anchors.set(anchorKey, {
      rowSpan,
      colSpan,
      originRow: m.startRowIndex,
      originCol: m.startColumnIndex,
      endRow: r1,
      endCol: c1,
    });
    for (let r = r0; r < r1; r++) {
      for (let c = c0; c < c1; c++) {
        if (r === r0 && c === c0) continue;
        covered.add(`${r}:${c}`);
      }
    }
  }
  return { anchors, covered };
}

/** ดึงค่าของเซลล์โดยคำนึงถึง Merge (ถ้าอยู่ในช่วง Merge ให้ดึงค่าจากเซลล์ต้นทาง) */
export function getMergedCellValue(rows: string[][], merges: SheetMerge[] | undefined, r: number, c: number): string {
  const direct = (rows[r]?.[c] ?? '').trim();
  if (direct || !merges?.length) return direct;
  for (const m of merges) {
    if (r >= m.startRowIndex && r < m.endRowIndex && c >= m.startColumnIndex && c < m.endColumnIndex) {
      return (rows[m.startRowIndex]?.[m.startColumnIndex] ?? '').trim();
    }
  }
  return '';
}

// ---------------- Vector SVG Icon System (Zero Emoji) ----------------
export type IconName =
  | 'plus'
  | 'check'
  | 'check-all'
  | 'x'
  | 'trash'
  | 'edit'
  | 'refresh'
  | 'external'
  | 'arrow-left'
  | 'arrow-up'
  | 'arrow-down'
  | 'chevron-down'
  | 'chevron-right'
  | 'sort-number'
  | 'calendar'
  | 'clipboard'
  | 'settings'
  | 'users'
  | 'spreadsheet'
  | 'cloud-up'
  | 'database'
  | 'upload'
  | 'folder'
  | 'warning'
  | 'info'
  | 'clock'
  | 'pause'
  | 'star'
  | 'compass'
  | 'logout'
  | 'help'
  | 'sparkles'
  | 'arrow-right'
  | 'crown'
  | 'wrench'
  | 'eye'
  | 'download'
  | 'bulb';

const ICON_PATHS: Record<IconName, string> = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  'check-all': '<path d="m18 6-9.5 9.5-4-4"/><path d="m22 10-7.5 7.5L13 16"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  refresh: '<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  'arrow-left': '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  'arrow-right': '<path d="m12 5 7 7-7 7"/><path d="M5 12h14"/>',
  'arrow-up': '<path d="m18 15-6-6-6 6"/>',
  'arrow-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'sort-number': '<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M15 4h5l-5 6h5"/><path d="M15 14h3a2 2 0 0 1 0 4h-3v2h5"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="m9 16 2 2 4-4"/>',
  clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.77 1.05 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  spreadsheet: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  'cloud-up': '<path d="M4 14.9A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.24"/><path d="M12 12v9"/><path d="m16 16-4-4-4 4"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  warning: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  compass: '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
  crown: '<path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"/><path d="M5 21h14"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  bulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
};

export function icon(name: IconName, size = 16, extraClass = ''): string {
  const cls = ['cr-svg', extraClass].filter(Boolean).join(' ');
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
}
