// ============================================================
// EDUPLAN Classroom — Google Sheets API, Drive appDataFolder Sync, Google Picker
// (ทำงานฝั่ง Browser ล้วน ผ่าน REST API + OAuth token จาก GIS)
// ============================================================
import { applyMapping, guessHeaderRow, guessMapping } from './excelService';
import { ensureToken, forceRefreshToken, getApiKey, getAppId, getAuthState, loadScript } from './googleAuth';
import {
  buildSyncSnapshot,
  deleteClassroom,
  getAssignments,
  getClassroom,
  getSessions,
  getStudents,
  listClassrooms,
  markAssignmentSync,
  markSessionSync,
  mergeSyncSnapshot,
  purgeStaleSharedClassrooms,
  replaceClassroomCache,
  saveClassroom,
} from './db';
import {
  ATTENDANCE_LABEL,
  STANDARD_TABS,
  SUBMISSION_LABEL,
  colToLetter,
  currentAcademicYear,
  currentTerm,
  getRoomAssignmentStartCol,
  normalizeKey,
  parseColumnIndex,
  safeHttpsUrl,
  sessionHeaderText,
  sortAssignments,
  sortSessions,
  todayISO,
  uid,
  type Assignment,
  type AssignmentSheetMapping,
  type AttendanceSession,
  type AttendanceSheetMapping,
  type AttendanceStatus,
  type Classroom,
  type ClassroomRole,
  type Collaborator,
  type ColumnMapping,
  type ParsedStudent,
  type RowKeyType,
  type SessionHeaderMode,
  type SheetMapping,
  type SheetMerge,
  type Student,
  type Submission,
  type SyncSnapshot,
} from './types';

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const APPDATA_FILE = 'eduplan_classrooms.json';
const SHARED_ROOMS_APPDATA_FILE = 'eduplan_shared_rooms.json';

const localWriteTimestamps = new Map<string, number>();
export function markLocalSpreadsheetWrite(spreadsheetId: string): void {
  localWriteTimestamps.set(spreadsheetId, Date.now());
}
export function getLastLocalSpreadsheetWrite(spreadsheetId: string): number {
  return localWriteTimestamps.get(spreadsheetId) ?? 0;
}

// ---------------- fetch wrapper ----------------
export class GoogleApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'GoogleApiError';
    this.status = status;
  }
}

export function isGoogleNotFoundError(err: unknown): boolean {
  return err instanceof GoogleApiError && err.status === 404;
}

async function gfetch<T = unknown>(url: string, init: RequestInit = {}, retry = true): Promise<T> {
  const token = await ensureToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && typeof init.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401 && retry) {
    await forceRefreshToken();
    return gfetch<T>(url, init, false);
  }
  if (!res.ok) {
    let msg = `Google API ผิดพลาด (HTTP ${res.status})`;
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      if (j.error?.message) msg = `${msg}: ${j.error.message}`;
    } catch {
      /* not json */
    }
    if (res.status === 403) msg += ' — ตรวจสอบว่าเปิดใช้งาน Google Sheets API / Drive API และไฟล์นี้ได้รับสิทธิ์จากแอปแล้ว';
    if (res.status === 404) msg += ' — ไม่พบไฟล์ (อาจถูกลบหรือยังไม่ได้รับสิทธิ์ Google Sheets / ไม่ได้เลือกผ่าน Google Picker)';
    throw new GoogleApiError(msg, res.status);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export function quoteSheet(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

// ---------------- Spreadsheet primitives & Developer Metadata Sync ----------------
export interface DeveloperMetadataItem {
  metadataId?: number;
  metadataKey: string;
  metadataValue: string;
  visibility?: 'DOCUMENT' | 'PROJECT' | string;
}

export interface SheetInfo {
  sheetId: number;
  title: string;
  rowCount: number;
  columnCount: number;
  merges: SheetMerge[];
}
export interface SpreadsheetMeta {
  spreadsheetId: string;
  title: string;
  url: string;
  developerMetadata?: DeveloperMetadataItem[];
  sheets: SheetInfo[];
}

interface RawMeta {
  spreadsheetId: string;
  spreadsheetUrl: string;
  properties: { title: string };
  developerMetadata?: DeveloperMetadataItem[];
  sheets: {
    properties: { sheetId: number; title: string; gridProperties?: { rowCount?: number; columnCount?: number } };
    merges?: SheetMerge[];
  }[];
}

export async function getSpreadsheetMeta(spreadsheetId: string): Promise<SpreadsheetMeta> {
  const fields =
    'spreadsheetId,spreadsheetUrl,properties.title,developerMetadata(metadataId,metadataKey,metadataValue,visibility),sheets(properties(sheetId,title,gridProperties),merges)';
  const j = await gfetch<RawMeta>(`${SHEETS}/${encodeURIComponent(spreadsheetId)}?fields=${encodeURIComponent(fields)}`);
  return {
    spreadsheetId: j.spreadsheetId,
    title: j.properties.title,
    url: j.spreadsheetUrl,
    developerMetadata: j.developerMetadata ?? [],
    sheets: j.sheets.map((s) => ({
      sheetId: s.properties.sheetId,
      title: s.properties.title,
      rowCount: s.properties.gridProperties?.rowCount ?? 1000,
      columnCount: s.properties.gridProperties?.columnCount ?? 26,
      merges: (s.merges ?? []).map((m) => ({
        startRowIndex: m.startRowIndex ?? 0,
        endRowIndex: m.endRowIndex ?? 0,
        startColumnIndex: m.startColumnIndex ?? 0,
        endColumnIndex: m.endColumnIndex ?? 0,
      })),
    })),
  };
}

const SYNC_META_KEY = 'eduplan_sync_meta';

export interface SheetSyncMetaPayload {
  v: 1;
  name: string;
  subject: string;
  term: string;
  academicYear: string;
  standard: boolean;
  roster: SheetMapping['roster'];
  attendance: SheetMapping['attendance'];
  assignments: SheetMapping['assignments'];
  attendanceHeaderMode?: SessionHeaderMode;
  students?: { n: string; c: string; f: string }[];
  sessions?: { col: number | null; date: string; period: string; headerMode?: SessionHeaderMode }[];
  assignmentsMeta?: { col: number | null; title: string; assignedDate: string; dueDate: string; maxScore: number | null }[];
}

export function parseSpreadsheetSyncMeta(meta: SpreadsheetMeta): SheetSyncMetaPayload | null {
  const entry = (meta.developerMetadata ?? []).find((d) => d.metadataKey === SYNC_META_KEY);
  if (!entry?.metadataValue) return null;
  try {
    const parsed = JSON.parse(entry.metadataValue) as SheetSyncMetaPayload;
    return parsed && parsed.v === 1 ? parsed : null;
  } catch {
    return null;
  }
}

/** บันทึกการตั้งค่าคอลัมน์, เทอม/ปี, Master Roster และ Metadata ของงาน/เช็คชื่อลงใน Google Sheet เพื่อซิงก์ให้ผู้ร่วมสอนตรงกัน 100% */
export async function syncSpreadsheetSyncMeta(c: Classroom, existingMeta?: SpreadsheetMeta): Promise<void> {
  const id = c.sheet?.spreadsheetId ?? c.sheetId;
  if (!id || c.syncMode !== 'google' || !c.sheet || !getAuthState().signedIn || c.role === 'viewer') return;

  const meta = existingMeta ?? (await getSpreadsheetMeta(id));
  const remoteMeta = parseSpreadsheetSyncMeta(meta);
  const [students, sessionsRaw, assignmentsRaw] = await Promise.all([
    getStudents(c.id),
    getSessions(c.id),
    getAssignments(c.id),
  ]);
  const sessions = sortSessions(sessionsRaw);
  const assignments = sortAssignments(assignmentsRaw);

  const isAssistant = c.role === 'assistant';
  const payload: SheetSyncMetaPayload = {
    v: 1,
    name: isAssistant && remoteMeta ? remoteMeta.name : c.name,
    subject: isAssistant && remoteMeta ? remoteMeta.subject : c.subject,
    term: isAssistant && remoteMeta ? remoteMeta.term : c.term,
    academicYear: isAssistant && remoteMeta ? remoteMeta.academicYear : c.academicYear,
    standard: isAssistant && remoteMeta ? remoteMeta.standard : c.sheet.standard,
    roster: isAssistant && remoteMeta ? remoteMeta.roster : c.sheet.roster,
    attendance: isAssistant && remoteMeta ? normalizeAttendanceMapping(remoteMeta.attendance) : normalizeAttendanceMapping(c.sheet.attendance),
    assignments: isAssistant && remoteMeta ? normalizeAssignmentMapping(remoteMeta.assignments) : normalizeAssignmentMapping(c.sheet.assignments, c.assignmentStartCol),
    attendanceHeaderMode: isAssistant && remoteMeta?.attendanceHeaderMode ? remoteMeta.attendanceHeaderMode : c.attendanceHeaderMode,
    students:
      isAssistant && remoteMeta?.students
        ? remoteMeta.students
        : students.map((s) => ({ n: s.number, c: s.studentCode, f: s.fullName })),
    sessions: sessions.map((s) => ({
      col: s.sheetColumn,
      date: s.date,
      period: s.period,
      ...(s.headerMode ? { headerMode: s.headerMode } : {}),
    })),
    assignmentsMeta: assignments.map((a) => ({
      col: a.sheetColumn,
      title: a.title,
      assignedDate: a.assignedDate,
      dueDate: a.dueDate,
      maxScore: a.maxScore,
    })),
  };

  let serialized = JSON.stringify(payload);
  if (serialized.length > 26_000) {
    delete payload.students;
    serialized = JSON.stringify(payload);
  }
  if (serialized.length > 28_000) {
    delete payload.sessions;
    serialized = JSON.stringify(payload);
  }

  const existingItem = (meta.developerMetadata ?? []).find((d) => d.metadataKey === SYNC_META_KEY);
  if (existingItem?.metadataId && existingItem.visibility === 'DOCUMENT') {
    await batchUpdate(id, [
      {
        updateDeveloperMetadata: {
          dataFilters: [{ developerMetadataLookup: { metadataId: existingItem.metadataId } }],
          developerMetadata: { metadataValue: serialized },
          fields: 'metadataValue',
        },
      },
    ]);
  } else {
    const reqs: unknown[] = [];
    if (existingItem?.metadataId) {
      reqs.push({
        deleteDeveloperMetadata: {
          dataFilter: { developerMetadataLookup: { metadataId: existingItem.metadataId } },
        },
      });
    }
    reqs.push({
      createDeveloperMetadata: {
        developerMetadata: {
          metadataKey: SYNC_META_KEY,
          metadataValue: serialized,
          location: { spreadsheet: true },
          visibility: 'DOCUMENT',
        },
      },
    });
    await batchUpdate(id, reqs);
  }
}

export async function getValues(spreadsheetId: string, range: string): Promise<string[][]> {
  const j = await gfetch<{ values?: unknown[][] }>(
    `${SHEETS}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`,
  );
  return (j.values ?? []).map((r) => r.map((c) => String(c ?? '')));
}

async function getFormulaValues(spreadsheetId: string, range: string): Promise<string[][]> {
  const j = await gfetch<{ values?: unknown[][] }>(
    `${SHEETS}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueRenderOption=FORMULA`,
  );
  return (j.values ?? []).map((r) => r.map((c) => String(c ?? '')));
}

async function batchUpdateValues(spreadsheetId: string, data: { range: string; values: (string | number)[][] }[]): Promise<void> {
  if (!data.length) return;
  markLocalSpreadsheetWrite(spreadsheetId);
  await gfetch(`${SHEETS}/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ valueInputOption: 'RAW', data }),
  });
  markLocalSpreadsheetWrite(spreadsheetId);
}

async function clearValues(spreadsheetId: string, range: string): Promise<void> {
  markLocalSpreadsheetWrite(spreadsheetId);
  await gfetch(`${SHEETS}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:clear`, {
    method: 'POST',
    body: '{}',
  });
  markLocalSpreadsheetWrite(spreadsheetId);
}

async function batchUpdate(spreadsheetId: string, requests: unknown[]): Promise<void> {
  if (!requests.length) return;
  markLocalSpreadsheetWrite(spreadsheetId);
  await gfetch(`${SHEETS}/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests }),
  });
  markLocalSpreadsheetWrite(spreadsheetId);
}

/** ขยายจำนวนแถว/คอลัมน์ของแท็บให้พอสำหรับเขียนข้อมูล */
async function ensureGrid(spreadsheetId: string, sheetTitle: string, minRows: number, minCols: number): Promise<void> {
  const meta = await getSpreadsheetMeta(spreadsheetId);
  const sh = meta.sheets.find((s) => s.title === sheetTitle);
  if (!sh) throw new Error(`ไม่พบแท็บ "${sheetTitle}" ใน Google Sheet`);
  if (sh.rowCount >= minRows && sh.columnCount >= minCols) return;
  await batchUpdate(spreadsheetId, [
    {
      updateSheetProperties: {
        properties: {
          sheetId: sh.sheetId,
          gridProperties: { rowCount: Math.max(sh.rowCount, minRows), columnCount: Math.max(sh.columnCount, minCols) },
        },
        fields: 'gridProperties.rowCount,gridProperties.columnCount',
      },
    },
  ]);
}

// ---------------- Standard Sheet (แบบ A — 1 ไฟล์ 3 แท็บ) ----------------
export async function createStandardSpreadsheet(c: Classroom): Promise<SheetMapping> {
  const title = `EDUPLAN Classroom — ${[c.subject, c.name].filter(Boolean).join(' ')} (${c.term}/${c.academicYear})`;
  const tab = (t: string, cols: number) => ({
    properties: { title: t, gridProperties: { rowCount: 200, columnCount: cols, frozenRowCount: 1, frozenColumnCount: 3 } },
  });
  const j = await gfetch<{ spreadsheetId: string; spreadsheetUrl: string; sheets: { properties: { sheetId: number } }[] }>(SHEETS, {
    method: 'POST',
    body: JSON.stringify({
      properties: { title, locale: 'th_TH' },
      sheets: [tab(STANDARD_TABS.roster, 6), tab(STANDARD_TABS.attendance, 60), tab(STANDARD_TABS.assignments, 40)],
    }),
  });
  const headerFmt = j.sheets.map((s) => ({
    repeatCell: {
      range: { sheetId: s.properties.sheetId, startRowIndex: 0, endRowIndex: 1 },
      cell: {
        userEnteredFormat: {
          textFormat: { bold: true },
          backgroundColor: { red: 0.86, green: 0.92, blue: 1 },
          horizontalAlignment: 'CENTER',
        },
      },
      fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)',
    },
  }));
  const widths = j.sheets.map((s) => ({
    updateDimensionProperties: {
      range: { sheetId: s.properties.sheetId, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 },
      properties: { pixelSize: 240 },
      fields: 'pixelSize',
    },
  }));
  await batchUpdate(j.spreadsheetId, [...headerFmt, ...widths]).catch(() => undefined);
  const mapping: SheetMapping = {
    spreadsheetId: j.spreadsheetId,
    spreadsheetName: title,
    spreadsheetUrl: j.spreadsheetUrl,
    standard: true,
    roster: {
      sheetTitle: STANDARD_TABS.roster,
      mapping: { headerRow: 0, number: 0, code: 1, nameMode: 'single', name: 2, prefix: null, first: null, last: null },
    },
    attendance: { sheetTitle: STANDARD_TABS.attendance, headerRow: 1, keyCol: 1, keyType: 'order', startCol: 3, mode: 'append', fixedCount: 0 },
    assignments: { sheetTitle: STANDARD_TABS.assignments, headerRow: 1, keyCol: 1, keyType: 'order', startCol: 3 },
  };
  await syncClassroomDriveProperties({ ...c, sheet: mapping, assignmentStartCol: 3 }).catch(() => undefined);
  return mapping;
}

function rosterBlock(students: Student[]): (string | number)[][] {
  return students.map((s) => [s.number, s.studentCode, s.fullName]);
}

export function attendanceCell(session: AttendanceSession, studentId: string): string {
  const st = session.records[studentId];
  return st ? ATTENDANCE_LABEL[st] : '';
}

export function assignmentCell(a: Assignment, studentId: string): string | number {
  const sub = a.submissions[studentId];
  if (sub && sub.score !== null && sub.score !== undefined && !Number.isNaN(sub.score)) return sub.score;
  return SUBMISSION_LABEL[sub?.status ?? 'missing'];
}

export function assignmentHeader(a: Assignment): string {
  return a.maxScore ? `${a.title} (${a.maxScore})` : a.title;
}

function normalizeAttendanceMapping(m: AttendanceSheetMapping | null | undefined): AttendanceSheetMapping | null {
  if (!m) return null;
  return {
    sheetTitle: String(m.sheetTitle ?? ''),
    headerRow: Math.max(1, Math.floor(Number(m.headerRow) || 1)),
    keyCol: parseColumnIndex(m.keyCol, 0),
    keyType: m.keyType,
    startCol: parseColumnIndex(m.startCol, 0),
    mode: m.mode === 'fixed' ? 'fixed' : 'append',
    fixedCount: Math.max(0, Math.floor(Number(m.fixedCount) || 0)),
  };
}

function normalizeAssignmentMapping(
  m: AssignmentSheetMapping | null | undefined,
  fallbackStartCol?: number | null,
): AssignmentSheetMapping | null {
  if (!m) return null;
  const fallback = fallbackStartCol !== undefined && fallbackStartCol !== null ? parseColumnIndex(fallbackStartCol, 0) : 0;
  return {
    sheetTitle: String(m.sheetTitle ?? ''),
    headerRow: Math.max(1, Math.floor(Number(m.headerRow) || 1)),
    keyCol: parseColumnIndex(m.keyCol, 0),
    keyType: m.keyType,
    startCol: parseColumnIndex(m.startCol, fallback),
    ...(Number(m.colsPerAssignment) === 2 ? { colsPerAssignment: 2 as const } : {}),
  };
}

/**
 * หาคอลัมน์ว่างแรกสำหรับเขียนข้อมูล โดยเริ่มสแกนตั้งแต่ startColIndex (0-based) ไปทางขวา
 * - แปลง startColIndex เป็น Number เสมอเพื่อป้องกัน String Concatenation
 * - ไม่ใช้ values.append และไม่ใช้ headerRow.length เพื่อข้ามไปท้ายชีต
 * - หาก 1 งานใช้ 2 คอลัมน์ (สถานะ + คะแนน เช่น F และ G) จะตรวจว่าทั้ง col และ col + 1 ว่างคู่กัน
 */
export function findNextAvailableAssignmentColumn(
  sheetRows: string[][],
  headerRowIndex: number,
  startColIndex: number | string,
  columnsPerItem = 1,
  reservedCols?: ReadonlySet<number>,
): number {
  const start = parseColumnIndex(startColIndex, 0);
  const rowIdx = Math.max(0, Math.floor(Number(headerRowIndex) || 0));
  const span = Math.max(1, Math.floor(Number(columnsPerItem) || 1));
  const headerRow = Array.isArray(sheetRows) && Array.isArray(sheetRows[rowIdx]) ? sheetRows[rowIdx] : [];
  const maxScan = Math.max(start + 500, headerRow.length + span + 10);

  for (let col = start; col < maxScan; col++) {
    let slotAvailable = true;
    for (let offset = 0; offset < span; offset++) {
      const targetCol = Number(col) + offset;
      if (reservedCols?.has(targetCol)) {
        slotAvailable = false;
        break;
      }
      const cell = headerRow[targetCol];
      if (cell !== undefined && cell !== null && String(cell).trim() !== '') {
        slotAvailable = false;
        break;
      }
    }
    if (slotAvailable) return Number(col);
  }
  return start;
}

/** เขียนข้อมูลทั้งหมดลงไฟล์มาตรฐานใหม่ทั้งหมด (ใช้เฉพาะตอนสร้างไฟล์ครั้งแรกหรืออัปเดตรายชื่อ Master Roster) */
async function pushStandardAll(c: Classroom): Promise<void> {
  const sheet = c.sheet!;
  const id = sheet.spreadsheetId;
  const [students, sessionsRaw, assignmentsRaw] = await Promise.all([getStudents(c.id), getSessions(c.id), getAssignments(c.id)]);
  const sessions = sortSessions(sessionsRaw);
  const assignments = sortAssignments(assignmentsRaw);
  const rows = students.length + 1;
  const T = STANDARD_TABS;
  const attStartCol = parseColumnIndex(sheet.attendance?.startCol, 3);
  const asgStartCol = parseColumnIndex(sheet.assignments?.startCol ?? c.assignmentStartCol, 3);

  await ensureGrid(id, T.roster, rows + 5, 3);
  await ensureGrid(id, T.attendance, rows + 5, attStartCol + sessions.length + 1);
  await ensureGrid(id, T.assignments, rows + 5, asgStartCol + assignments.length + 1);

  await Promise.all([
    clearValues(id, quoteSheet(T.roster)),
    clearValues(id, quoteSheet(T.attendance)),
    clearValues(id, quoteSheet(T.assignments)),
  ]);

  const base = ['เลขที่', 'รหัสนักเรียน', 'ชื่อ-สกุล'];
  const roster = rosterBlock(students);
  const att: (string | number)[][] = [[...base, ...sessions.map((s) => sessionHeaderText(s))]];
  const asg: (string | number)[][] = [[...base, ...assignments.map(assignmentHeader)]];
  students.forEach((st, i) => {
    att.push([...roster[i], ...sessions.map((s) => attendanceCell(s, st.id))]);
    asg.push([...roster[i], ...assignments.map((a) => assignmentCell(a, st.id))]);
  });

  await batchUpdateValues(id, [
    { range: `${quoteSheet(T.roster)}!A1`, values: [base, ...roster] },
    { range: `${quoteSheet(T.attendance)}!A1`, values: att },
    { range: `${quoteSheet(T.assignments)}!A1`, values: asg },
  ]);

  await Promise.all([
    ...sessions.map((s, i) => markSessionSync(s.id, { sheetSynced: true, sheetColumn: attStartCol + i })),
    ...assignments.map((a, i) => markAssignmentSync(a.id, { sheetSynced: true, sheetColumn: asgStartCol + i })),
  ]);
}

// ---------------- Partial Batch Update (เขียนเฉพาะคอลัมน์วันที่/ชิ้นงาน) ----------------
function studentKey(s: Student, type: RowKeyType): string {
  if (type === 'code') return normalizeKey(s.studentCode);
  if (type === 'number') return normalizeKey(s.number);
  return normalizeKey(s.fullName);
}

/** หาแถว (1-based) ของนักเรียนแต่ละคนในแท็บ */
async function resolveRows(
  spreadsheetId: string,
  sheetTitle: string,
  headerRow: number,
  keyCol: number,
  keyType: RowKeyType,
  students: Student[],
): Promise<{ rows: Map<string, number>; unmatched: Student[] }> {
  const rows = new Map<string, number>();
  const unmatched: Student[] = [];
  if (keyType === 'order') {
    students.forEach((s, i) => rows.set(s.id, headerRow + 1 + i));
    return { rows, unmatched };
  }
  const L = colToLetter(keyCol);
  const vals = await getValues(spreadsheetId, `${quoteSheet(sheetTitle)}!${L}${headerRow + 1}:${L}`);
  const index = new Map<string, number>();
  vals.forEach((r, i) => {
    const k = normalizeKey(r[0]);
    if (k && !index.has(k)) index.set(k, headerRow + 1 + i);
  });
  for (const s of students) {
    const k = studentKey(s, keyType);
    const row = k ? index.get(k) : undefined;
    if (row) rows.set(s.id, row);
    else unmatched.push(s);
  }
  return { rows, unmatched };
}

export interface PushResult {
  written: number;
  unmatched: string[];
  column?: string;
}

function assignmentStatusAndScoreCells(a: Assignment, studentId: string): [string, string | number] {
  const sub = a.submissions[studentId];
  const statusText = SUBMISSION_LABEL[sub?.status ?? 'missing'];
  const scoreVal = sub && sub.score !== null && sub.score !== undefined && !Number.isNaN(sub.score) ? sub.score : '';
  return [statusText, scoreVal];
}

async function pushCustomColumn(
  c: Classroom,
  kind: 'attendance' | 'assignments',
  item: AttendanceSession | Assignment,
  header: string,
  cell: (studentId: string) => string | number,
  overrideStartCol?: number,
): Promise<PushResult> {
  const sheet = c.sheet!;
  const m =
    (kind === 'attendance' ? sheet.attendance : sheet.assignments) ??
    (sheet.standard
      ? kind === 'attendance'
        ? { sheetTitle: STANDARD_TABS.attendance, headerRow: 1, keyCol: 1, keyType: 'order' as const, startCol: 3, mode: 'append' as const, fixedCount: 0 }
        : { sheetTitle: STANDARD_TABS.assignments, headerRow: 1, keyCol: 1, keyType: 'order' as const, startCol: 3 }
      : null);
  if (!m) throw new Error(kind === 'attendance' ? 'ยังไม่ได้ตั้งค่าแท็บ/คอลัมน์การมาเรียน' : 'ยังไม่ได้ตั้งค่าแท็บ/คอลัมน์การส่งงาน');

  const headerRow = Math.max(1, Math.floor(Number(m.headerRow) || 1));
  const keyCol = parseColumnIndex(m.keyCol, 0);
  const startCol = parseColumnIndex(
    overrideStartCol !== undefined
      ? overrideStartCol
      : kind === 'assignments'
        ? (m.startCol ?? c.assignmentStartCol)
        : m.startCol,
    0,
  );
  const colsPerItem = kind === 'assignments' && 'colsPerAssignment' in m && Number(m.colsPerAssignment) === 2 ? 2 : 1;

  const others = kind === 'attendance' ? await getSessions(c.id) : await getAssignments(c.id);
  const usedLocalSet = new Set<number>();
  for (const o of others) {
    if (o.id === item.id || o.sheetColumn === null || o.sheetColumn === undefined) continue;
    const oc = parseColumnIndex(o.sheetColumn, -1);
    if (oc >= 0) {
      for (let k = 0; k < colsPerItem; k++) usedLocalSet.add(oc + k);
    }
  }

  let hVals: string[][] = [[]];
  let headerReadOk = false;
  try {
    hVals = await getValues(sheet.spreadsheetId, `${quoteSheet(m.sheetTitle)}!${headerRow}:${headerRow}`);
    headerReadOk = true;
  } catch {
    /* ignore header inspect error */
  }
  const hRow = hVals[0] ?? [];

  let col: number | null =
    item.sheetColumn !== null && item.sheetColumn !== undefined ? parseColumnIndex(item.sheetColumn, -1) : null;
  if (col !== null && col < 0) col = null;

  if (col !== null) {
    const belowStart = col < startCol;
    const existingSlotBlank =
      headerReadOk &&
      col > startCol &&
      Array.from({ length: colsPerItem }, (_, offset) => (hRow[col! + offset] ?? '').trim()).every((v) => !v);
    if (belowStart || existingSlotBlank) {
      col = null;
    }
  }

  if (col === null) {
    const trimmedHeader = header.trim();
    const primaryHeader = colsPerItem === 2 ? `${trimmedHeader} (สถานะ)` : trimmedHeader;
    let matchedCol: number | null = null;
    for (let cIdx = startCol; cIdx < hRow.length; cIdx++) {
      const hv = (hRow[cIdx] ?? '').trim();
      if (!hv) continue;
      let reserved = false;
      for (let k = 0; k < colsPerItem; k++) {
        if (usedLocalSet.has(cIdx + k)) {
          reserved = true;
          break;
        }
      }
      if (!reserved && (hv === primaryHeader || hv === trimmedHeader)) {
        matchedCol = cIdx;
        break;
      }
    }
    if (matchedCol !== null) {
      col = matchedCol;
    } else {
      col = findNextAvailableAssignmentColumn(hVals, 0, startCol, colsPerItem, usedLocalSet);
    }
  }

  if (kind === 'attendance' && sheet.attendance?.mode === 'fixed' && Number(sheet.attendance.fixedCount) > 0) {
    const fixedCount = Math.floor(Number(sheet.attendance.fixedCount));
    const limit = startCol + fixedCount;
    if (col >= limit) {
      throw new Error(
        `ช่องเช็คชื่อเต็มแล้ว (กำหนดไว้ ${fixedCount} ช่อง ถึงคอลัมน์ ${colToLetter(limit - 1)}) — เพิ่มจำนวนช่องในแท็บ "ตั้งค่าตารางและคอลัมน์"`,
      );
    }
  }

  const students = await getStudents(c.id);
  const { rows, unmatched } = await resolveRows(sheet.spreadsheetId, m.sheetTitle, headerRow, keyCol, m.keyType, students);
  const maxRow = Math.max(headerRow, ...rows.values());
  await ensureGrid(sheet.spreadsheetId, m.sheetTitle, maxRow + 1, col + colsPerItem);

  const L = colToLetter(col);
  const L2 = colsPerItem === 2 ? colToLetter(col + 1) : L;
  const q = quoteSheet(m.sheetTitle);
  const data: { range: string; values: (string | number)[][] }[] = [];

  // หากเป็นไฟล์มาตรฐาน ให้แน่ใจว่าคอลัมน์ A-C (รายชื่อ) มีอยู่ครบโดยไม่แตะคอลัมน์อื่น
  if (sheet.standard && m.keyType === 'order' && headerRow === 1) {
    const base = ['เลขที่', 'รหัสนักเรียน', 'ชื่อ-สกุล'];
    data.push({ range: `${q}!A1:C${students.length + 1}`, values: [base, ...rosterBlock(students)] });
  }

  if (colsPerItem === 2 && kind === 'assignments') {
    const asgItem = item as Assignment;
    const pairHeaders: (string | number)[] = [`${header} (สถานะ)`, `${header} (คะแนน)`];
    if (m.keyType === 'order') {
      const colValues: (string | number)[][] = [pairHeaders, ...students.map((s) => assignmentStatusAndScoreCells(asgItem, s.id))];
      data.push({ range: `${q}!${L}${headerRow}:${L2}${headerRow + students.length}`, values: colValues });
    } else {
      data.push({ range: `${q}!${L}${headerRow}:${L2}${headerRow}`, values: [pairHeaders] });
      for (const s of students) {
        const r = rows.get(s.id);
        if (r) data.push({ range: `${q}!${L}${r}:${L2}${r}`, values: [assignmentStatusAndScoreCells(asgItem, s.id)] });
      }
    }
  } else if (m.keyType === 'order') {
    const colValues: (string | number)[][] = [[header], ...students.map((s) => [cell(s.id)])];
    data.push({ range: `${q}!${L}${headerRow}:${L}${headerRow + students.length}`, values: colValues });
  } else {
    data.push({ range: `${q}!${L}${headerRow}`, values: [[header]] });
    for (const s of students) {
      const r = rows.get(s.id);
      if (r) data.push({ range: `${q}!${L}${r}`, values: [[cell(s.id)]] });
    }
  }
  await batchUpdateValues(sheet.spreadsheetId, data);

  if (kind === 'attendance') await markSessionSync(item.id, { sheetColumn: col, sheetSynced: true });
  else await markAssignmentSync(item.id, { sheetColumn: col, sheetSynced: true });
  item.sheetColumn = col;
  item.sheetSynced = true;
  return { written: rows.size, unmatched: unmatched.map((s) => s.fullName), column: colsPerItem === 2 ? `${L}–${L2}` : L };
}

// ---------------- Custom Sheet Roster Sync (เพิ่ม/อัปเดตรายชื่อลง Google Sheet ไฟล์กำหนดเอง) ----------------
const THAI_NAME_PREFIXES = [
  'ว่าที่ร้อยตรีหญิง',
  'ว่าที่ร้อยตรี',
  'ว่าที่ ร.ต. หญิง',
  'ว่าที่ ร.ต.',
  'เด็กชาย',
  'เด็กหญิง',
  'นางสาว',
  'ด.ช.',
  'ด.ญ.',
  'น.ส.',
  'นาย',
  'นาง',
  'Miss',
  'Mrs.',
  'Mr.',
  'Ms.',
];

export function splitThaiFullName(fullName: string): { prefix: string; first: string; last: string } {
  let rest = fullName.replace(/\s+/g, ' ').trim();
  let prefix = '';
  for (const p of THAI_NAME_PREFIXES) {
    if (rest.toLowerCase().startsWith(p.toLowerCase())) {
      const after = rest.slice(p.length);
      if (after === '' || /^[\sก-๛A-Za-z]/.test(after)) {
        prefix = rest.slice(0, p.length);
        rest = after.trim();
        break;
      }
    }
  }
  const parts = rest.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) {
    return { prefix, first: parts[0] ?? '', last: '' };
  }
  return { prefix, first: parts[0], last: parts.slice(1).join(' ') };
}

function isFormulaCell(formulaGrid: string[][], rowIdx: number, colIdx: number): boolean {
  const raw = (formulaGrid[rowIdx]?.[colIdx] ?? '').trim();
  return raw.startsWith('=');
}

function isSummaryLikeText(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return /^(รวม|สรุป|เฉลี่ย|ค่าเฉลี่ย|หมายเหตุ|ลงชื่อ|ผู้สอน|total|sum|average|summary|note)/i.test(t);
}

function readMappedNameFromRow(row: string[], m: ColumnMapping): string {
  const get = (c: number | null) => (c === null ? '' : (row[c] ?? '').trim());
  if (m.nameMode === 'single') return get(m.name).replace(/\s+/g, ' ').trim();
  const first = `${get(m.prefix)}${get(m.first)}`;
  return [first, get(m.last)].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function isRowBlockedForAppend(
  formattedGrid: string[][],
  formulaGrid: string[][],
  rowIdx: number,
  m: ColumnMapping,
): boolean {
  const fRow = formattedGrid[rowIdx] ?? [];
  const eqRow = formulaGrid[rowIdx] ?? [];
  const len = Math.max(fRow.length, eqRow.length);
  if (len === 0) return false;

  // หากแถวนี้มีชื่อหรือรหัสนักเรียนอยู่แล้ว ถือว่ามีข้อมูลขวางอยู่
  if (readMappedNameFromRow(fRow, m) !== '') return true;
  if (m.code !== null && (fRow[m.code] ?? '').trim() !== '') return true;

  for (let c = 0; c < len; c++) {
    const val = (fRow[c] ?? '').trim();
    const raw = (eqRow[c] ?? '').trim();
    if (!val && !raw) continue;
    // ยอมให้เขียนลงแถว template ที่มีเพียงเลขที่ (เช่น 31, 32 หรือสูตร =A31+1) รอไว้
    if (m.number !== null && c === m.number) {
      if (isSummaryLikeText(val)) return true;
      if (/^=(SUM|AVERAGE|COUNT|COUNTA|SUBTOTAL)\(/i.test(raw)) return true;
      continue;
    }
    // คอลัมน์อื่นมีข้อความหรือสูตรใดๆ (เช่น แถว "รวม", หมายเหตุ, สูตรสรุป) -> ต้องแทรกแถวใหม่
    return true;
  }
  return false;
}

function buildStudentColumnEntries(
  student: Student,
  m: ColumnMapping,
  extraKey?: { keyCol: number; keyType: RowKeyType },
): { col: number; value: string }[] {
  const byCol = new Map<number, string>();
  const setCol = (col: number | null, val: string) => {
    if (col === null || col === undefined || col < 0) return;
    byCol.set(col, val);
  };
  setCol(m.number, student.number);
  setCol(m.code, student.studentCode);
  if (m.nameMode === 'single') {
    setCol(m.name, student.fullName);
  } else {
    const sp = splitThaiFullName(student.fullName);
    if (m.prefix !== null) {
      setCol(m.prefix, sp.prefix);
      setCol(m.first, sp.first);
      setCol(m.last, sp.last);
    } else {
      setCol(m.first, `${sp.prefix}${sp.first}`);
      setCol(m.last, sp.last);
    }
  }
  if (extraKey && extraKey.keyType !== 'order' && extraKey.keyCol >= 0 && !byCol.has(extraKey.keyCol)) {
    if (extraKey.keyType === 'code') byCol.set(extraKey.keyCol, student.studentCode);
    else if (extraKey.keyType === 'number') byCol.set(extraKey.keyCol, student.number);
    else if (extraKey.keyType === 'name') byCol.set(extraKey.keyCol, student.fullName);
  }
  return Array.from(byCol.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([col, value]) => ({ col, value }));
}

function resolveTabColumnMapping(
  grid: string[][],
  sheetInfo: SheetInfo,
  explicitMapping: ColumnMapping | null,
  fallbackHeaderRow1Based?: number,
  extraKey?: { keyCol: number; keyType: RowKeyType },
): { mapping: ColumnMapping; writeDefaultHeader: boolean } {
  if (explicitMapping) {
    const hasAnyCol =
      explicitMapping.number !== null ||
      explicitMapping.code !== null ||
      (explicitMapping.nameMode === 'single' ? explicitMapping.name !== null : explicitMapping.first !== null || explicitMapping.last !== null);
    if (hasAnyCol) return { mapping: explicitMapping, writeDefaultHeader: false };
  }
  const hasGridContent = grid.some((r) => r.some((v) => (v ?? '').trim() !== ''));
  if (!hasGridContent) {
    return {
      mapping: { headerRow: 0, number: 0, code: 1, nameMode: 'single', name: 2, prefix: null, first: null, last: null },
      writeDefaultHeader: true,
    };
  }
  const headerRow0 =
    fallbackHeaderRow1Based !== undefined
      ? Math.max(0, Math.floor(Number(fallbackHeaderRow1Based) || 1) - 1)
      : guessHeaderRow(grid, sheetInfo.merges);
  const guessed = guessMapping(grid, headerRow0, sheetInfo.merges);
  if (extraKey && extraKey.keyType !== 'order') {
    if (extraKey.keyType === 'code' && guessed.code === null) guessed.code = extraKey.keyCol;
    else if (extraKey.keyType === 'number' && guessed.number === null) guessed.number = extraKey.keyCol;
    else if (extraKey.keyType === 'name' && guessed.nameMode === 'single' && guessed.name === null) guessed.name = extraKey.keyCol;
  }
  return { mapping: guessed, writeDefaultHeader: false };
}

interface CustomTabRosterResult {
  added: number;
  updated: number;
}

async function syncStudentsToCustomTab(
  spreadsheetId: string,
  sheetInfo: SheetInfo,
  students: Student[],
  previousStudents: Student[] | undefined,
  explicitMapping: ColumnMapping | null,
  fallbackHeaderRow1Based?: number,
  extraKey?: { keyCol: number; keyType: RowKeyType },
  allowUpdateExisting = true,
): Promise<CustomTabRosterResult> {
  const q = quoteSheet(sheetInfo.title);
  const [formattedGrid, formulaGrid] = await Promise.all([
    getValues(spreadsheetId, q).catch(() => [] as string[][]),
    getFormulaValues(spreadsheetId, q).catch(() => [] as string[][]),
  ]);

  const { mapping, writeDefaultHeader } = resolveTabColumnMapping(
    formattedGrid,
    sheetInfo,
    explicitMapping,
    fallbackHeaderRow1Based,
    extraKey,
  );

  const hasWritableCol =
    mapping.number !== null ||
    mapping.code !== null ||
    (mapping.nameMode === 'single' ? mapping.name !== null : mapping.first !== null || mapping.last !== null) ||
    (extraKey && extraKey.keyType !== 'order');
  if (!hasWritableCol) return { added: 0, updated: 0 };

  const firstDataRow = Math.max(0, mapping.headerRow + 1);
  const rowByCode = new Map<string, number>();
  const rowByName = new Map<string, number>();
  const rowByExtraKey = new Map<string, number>();
  let lastScannedStudentRow = -1;

  for (let r = firstDataRow; r < formattedGrid.length; r++) {
    const row = formattedGrid[r] ?? [];
    const codeVal = mapping.code !== null ? (row[mapping.code] ?? '').trim() : '';
    const nameVal = readMappedNameFromRow(row, mapping);
    const extraVal = extraKey && extraKey.keyType !== 'order' ? (row[extraKey.keyCol] ?? '').trim() : '';
    const numVal = mapping.number !== null ? (row[mapping.number] ?? '').trim() : '';

    if (isSummaryLikeText(nameVal) || isSummaryLikeText(codeVal) || isSummaryLikeText(numVal)) {
      continue;
    }
    const nameFormula =
      mapping.nameMode === 'single'
        ? mapping.name !== null && isFormulaCell(formulaGrid, r, mapping.name)
        : (mapping.first !== null && isFormulaCell(formulaGrid, r, mapping.first)) ||
          (mapping.last !== null && isFormulaCell(formulaGrid, r, mapping.last));
    if (nameFormula && /^=(SUM|AVERAGE|COUNT|COUNTA|SUBTOTAL)\(/i.test((formulaGrid[r]?.[mapping.name ?? mapping.first ?? 0] ?? '').trim())) {
      continue;
    }

    const codeKey = normalizeKey(codeVal);
    const nameKey = normalizeKey(nameVal);
    const extraKeyVal = normalizeKey(extraVal);
    if (codeKey && !rowByCode.has(codeKey)) rowByCode.set(codeKey, r);
    if (nameKey && !rowByName.has(nameKey)) rowByName.set(nameKey, r);
    if (extraKeyVal && !rowByExtraKey.has(extraKeyVal)) rowByExtraKey.set(extraKeyVal, r);
    if (nameKey || codeKey || (extraKey && extraKey.keyType !== 'order' && extraKeyVal)) {
      lastScannedStudentRow = r;
    }
  }

  const prevById = new Map((previousStudents ?? []).map((s) => [s.id, s]));
  const usedRows = new Set<number>();
  const matchedRows: number[] = [];
  const existingUpdates: { range: string; values: (string | number)[][] }[] = [];
  const toAppend: Student[] = [];
  let updatedStudentsCount = 0;

  const findRowForStudent = (st: Student): number | undefined => {
    const tryCode = (c: string) => {
      const k = normalizeKey(c);
      const r = k ? rowByCode.get(k) : undefined;
      return r !== undefined && !usedRows.has(r) ? r : undefined;
    };
    const tryName = (n: string) => {
      const k = normalizeKey(n);
      const r = k ? rowByName.get(k) : undefined;
      return r !== undefined && !usedRows.has(r) ? r : undefined;
    };
    const tryExtra = (s: Student) => {
      if (!extraKey || extraKey.keyType === 'order') return undefined;
      const k = studentKey(s, extraKey.keyType);
      const r = k ? rowByExtraKey.get(k) : undefined;
      return r !== undefined && !usedRows.has(r) ? r : undefined;
    };

    const byCurrent = tryCode(st.studentCode) ?? tryName(st.fullName) ?? tryExtra(st);
    if (byCurrent !== undefined) return byCurrent;

    const prev = prevById.get(st.id);
    if (prev) {
      return tryCode(prev.studentCode) ?? tryName(prev.fullName) ?? tryExtra(prev);
    }
    return undefined;
  };

  for (const st of students) {
    const rIdx = findRowForStudent(st);
    if (rIdx !== undefined) {
      usedRows.add(rIdx);
      matchedRows.push(rIdx);
      if (allowUpdateExisting) {
        const entries = buildStudentColumnEntries(st, mapping, extraKey);
        let rowChanged = false;
        for (const { col, value } of entries) {
          if (isFormulaCell(formulaGrid, rIdx, col)) continue;
          const currentVal = (formattedGrid[rIdx]?.[col] ?? '').trim();
          if (currentVal !== value.trim()) {
            existingUpdates.push({ range: `${q}!${colToLetter(col)}${rIdx + 1}`, values: [[value]] });
            rowChanged = true;
          }
        }
        if (rowChanged) updatedStudentsCount++;
      }
    } else {
      toAppend.push(st);
    }
  }

  const dataToWrite: { range: string; values: (string | number)[][] }[] = [];
  if (writeDefaultHeader) {
    dataToWrite.push({ range: `${q}!A1:C1`, values: [['เลขที่', 'รหัสนักเรียน', 'ชื่อ-สกุล']] });
  }
  dataToWrite.push(...existingUpdates);

  if (toAppend.length > 0) {
    const lastRow = Math.max(lastScannedStudentRow, ...matchedRows);
    let insertRowIdx = lastRow >= firstDataRow ? lastRow + 1 : firstDataRow;

    // ตรวจสอบว่าแถวที่จะเขียนนักเรียนใหม่มีข้อมูล/สูตร (เช่น แถว "รวม") ขวางอยู่หรือไม่
    let blocked = false;
    for (let i = 0; i < toAppend.length; i++) {
      if (isRowBlockedForAppend(formattedGrid, formulaGrid, insertRowIdx + i, mapping)) {
        blocked = true;
        break;
      }
    }

    let insertedRows = false;
    if (blocked) {
      try {
        await batchUpdate(spreadsheetId, [
          {
            insertDimension: {
              range: {
                sheetId: sheetInfo.sheetId,
                dimension: 'ROWS',
                startIndex: insertRowIdx,
                endIndex: insertRowIdx + toAppend.length,
              },
              inheritFromBefore: insertRowIdx > firstDataRow,
            },
          },
        ]);
        insertedRows = true;
      } catch {
        // กรณีแทรกแถวไม่ได้ (เช่น มี Merged Cell ครอบช่วงนั้น) ให้ขยับไปเขียนที่แถวว่างถัดไปแทน
        while (isRowBlockedForAppend(formattedGrid, formulaGrid, insertRowIdx, mapping)) {
          insertRowIdx++;
        }
      }
    }

    const maxNeededCol = Math.max(
      0,
      ...[
        mapping.number,
        mapping.code,
        mapping.name,
        mapping.prefix,
        mapping.first,
        mapping.last,
        extraKey?.keyType !== 'order' ? extraKey?.keyCol ?? null : null,
      ].filter((x): x is number => x !== null && x !== undefined),
    );
    await ensureGrid(spreadsheetId, sheetInfo.title, insertRowIdx + toAppend.length + 2, maxNeededCol + 1);

    toAppend.forEach((st, idx) => {
      const targetRow0Based = insertRowIdx + idx;
      const targetRow1Based = targetRow0Based + 1;
      const entries = buildStudentColumnEntries(st, mapping, extraKey);
      for (const { col, value } of entries) {
        // หากเขียนลงแถว template ที่มีสูตรรันเลขที่อยู่แล้ว ให้ข้ามคอลัมน์ที่เป็นสูตรเพื่อไม่ให้สูตรพัง
        if (!insertedRows && isFormulaCell(formulaGrid, targetRow0Based, col)) continue;
        dataToWrite.push({
          range: `${q}!${colToLetter(col)}${targetRow1Based}`,
          values: [[value]],
        });
      }
    });
  }

  if (dataToWrite.length > 0) {
    await batchUpdateValues(spreadsheetId, dataToWrite);
  }

  return { added: toAppend.length, updated: updatedStudentsCount };
}

export interface RosterSyncResult {
  added: number;
  updated: number;
  syncedTabs: string[];
}

/** เพิ่ม/อัปเดตรายชื่อนักเรียนจากเว็บลงไฟล์ Google Sheet แบบกำหนดเอง (ไม่ทับสูตรเดิมและไม่ลบแถวอื่น) */
export async function pushCustomRosterToSheet(
  classroomId: string,
  previousStudents?: Student[],
): Promise<RosterSyncResult | null> {
  const c = await getClassroom(classroomId);
  if (!canSync(c) || c.role === 'viewer') return null;
  if (c.sheet.standard) {
    await pushStandardAll(c);
    await syncSpreadsheetSyncMeta(c).catch((err) => console.warn('[EduPlan Class] syncSpreadsheetSyncMeta warning:', err));
    await syncClassroomDriveProperties(c).catch(() => undefined);
    return { added: 0, updated: 0, syncedTabs: [STANDARD_TABS.roster, STANDARD_TABS.attendance, STANDARD_TABS.assignments] };
  }

  const students = await getStudents(c.id);
  const spreadsheetId = c.sheet.spreadsheetId;
  const meta = await getSpreadsheetMeta(spreadsheetId);
  const sheetByTitle = new Map(meta.sheets.map((s) => [s.title, s]));

  const processedTabs = new Set<string>();
  const syncedTabs: string[] = [];
  let maxAdded = 0;
  let maxUpdated = 0;

  // 1) แท็บรายชื่อหลัก (roster) — ทำก่อนเสมอเพื่อให้สูตรในแท็บอื่นดึงค่าไปก่อนที่เราจะตรวจแท็บอื่น
  const primaryTitle =
    (c.sheet.roster?.sheetTitle && sheetByTitle.has(c.sheet.roster.sheetTitle) ? c.sheet.roster.sheetTitle : null) ??
    (c.sheet.attendance?.sheetTitle && sheetByTitle.has(c.sheet.attendance.sheetTitle) ? c.sheet.attendance.sheetTitle : null) ??
    (c.sheet.assignments?.sheetTitle && sheetByTitle.has(c.sheet.assignments.sheetTitle) ? c.sheet.assignments.sheetTitle : null) ??
    meta.sheets[0]?.title ??
    null;

  if (primaryTitle) {
    const sh = sheetByTitle.get(primaryTitle);
    if (sh) {
      const explicitMap = c.sheet.roster?.sheetTitle === primaryTitle ? c.sheet.roster.mapping : null;
      const fallbackHdr =
        c.sheet.attendance?.sheetTitle === primaryTitle
          ? c.sheet.attendance.headerRow
          : c.sheet.assignments?.sheetTitle === primaryTitle
            ? c.sheet.assignments.headerRow
            : undefined;
      const extraKey =
        c.sheet.attendance?.sheetTitle === primaryTitle
          ? { keyCol: parseColumnIndex(c.sheet.attendance.keyCol, 0), keyType: c.sheet.attendance.keyType }
          : c.sheet.assignments?.sheetTitle === primaryTitle
            ? { keyCol: parseColumnIndex(c.sheet.assignments.keyCol, 0), keyType: c.sheet.assignments.keyType }
            : undefined;

      const res = await syncStudentsToCustomTab(spreadsheetId, sh, students, previousStudents, explicitMap, fallbackHdr, extraKey, true);
      processedTabs.add(primaryTitle);
      if (res.added > 0 || res.updated > 0) syncedTabs.push(primaryTitle);
      maxAdded = Math.max(maxAdded, res.added);
      maxUpdated = Math.max(maxUpdated, res.updated);
    }
  }

  // 2) แท็บการมาเรียนและการส่งงาน (กรณีแยกคนละแท็บกับแท็บรายชื่อ และไม่ได้ใช้สูตรดึงชื่อมาเอง)
  const secondarySpecs: { title: string; headerRow: number; keyCol: number; keyType: RowKeyType }[] = [];
  if (c.sheet.attendance?.sheetTitle) {
    secondarySpecs.push({
      title: c.sheet.attendance.sheetTitle,
      headerRow: c.sheet.attendance.headerRow,
      keyCol: parseColumnIndex(c.sheet.attendance.keyCol, 0),
      keyType: c.sheet.attendance.keyType,
    });
  }
  if (c.sheet.assignments?.sheetTitle) {
    secondarySpecs.push({
      title: c.sheet.assignments.sheetTitle,
      headerRow: c.sheet.assignments.headerRow,
      keyCol: parseColumnIndex(c.sheet.assignments.keyCol, 0),
      keyType: c.sheet.assignments.keyType,
    });
  }

  for (const spec of secondarySpecs) {
    if (processedTabs.has(spec.title)) continue;
    const sh = sheetByTitle.get(spec.title);
    if (!sh) continue;
    const res = await syncStudentsToCustomTab(
      spreadsheetId,
      sh,
      students,
      previousStudents,
      null,
      spec.headerRow,
      { keyCol: spec.keyCol, keyType: spec.keyType },
      true,
    );
    processedTabs.add(spec.title);
    if (res.added > 0 || res.updated > 0) syncedTabs.push(spec.title);
    maxAdded = Math.max(maxAdded, res.added);
    maxUpdated = Math.max(maxUpdated, res.updated);
  }

  await syncSpreadsheetSyncMeta(c).catch((err) => console.warn('[EduPlan Class] syncSpreadsheetSyncMeta warning:', err));
  await syncClassroomDriveProperties(c).catch(() => undefined);
  return { added: maxAdded, updated: maxUpdated, syncedTabs };
}

// ---------------- Public push API ----------------
function canSync(c: Classroom | undefined): c is Classroom & { sheet: SheetMapping } {
  return !!c && c.syncMode === 'google' && !!c.sheet && getAuthState().signedIn;
}

export interface PushAssignmentOptions {
  startCol?: number;
}

export async function pushAttendanceSession(classroomId: string, session: AttendanceSession): Promise<PushResult | null> {
  const c = await getClassroom(classroomId);
  if (!canSync(c)) return null;
  if (!c.sheet.standard && !c.sheet.attendance) return null;
  await markSessionSync(session.id, { sheetSynced: false });
  const res = await pushCustomColumn(c, 'attendance', session, sessionHeaderText(session), (sid) => attendanceCell(session, sid));
  await syncSpreadsheetSyncMeta(c).catch((err) => console.warn('[EduPlan Class] syncSpreadsheetSyncMeta warning:', err));
  return res;
}

export async function pushAssignment(
  classroomId: string,
  a: Assignment,
  opts?: PushAssignmentOptions,
): Promise<PushResult | null> {
  const c = await getClassroom(classroomId);
  if (!canSync(c)) return null;
  if (!c.sheet.standard && !c.sheet.assignments) return null;
  await markAssignmentSync(a.id, { sheetSynced: false });
  const effectiveStartCol =
    opts?.startCol !== undefined && opts.startCol !== null
      ? parseColumnIndex(opts.startCol, 0)
      : getRoomAssignmentStartCol(c) ?? undefined;
  const res = await pushCustomColumn(
    c,
    'assignments',
    a,
    assignmentHeader(a),
    (sid) => assignmentCell(a, sid),
    effectiveStartCol,
  );
  await syncSpreadsheetSyncMeta(c).catch((err) => console.warn('[EduPlan Class] syncSpreadsheetSyncMeta warning:', err));
  return res;
}

/** ไฟล์มาตรฐาน: อัปเดตรายชื่อและคอลัมน์ / ไฟล์เดิม: ซิงก์รายชื่อใหม่และเขียนรายการที่ยังไม่ซิงก์ */
export async function pushClassroom(classroomId: string): Promise<void> {
  const c = await getClassroom(classroomId);
  if (!canSync(c)) return;
  if (c.sheet.standard) {
    await pushStandardAll(c);
    await syncSpreadsheetSyncMeta(c).catch((err) => console.warn('[EduPlan Class] syncSpreadsheetSyncMeta warning:', err));
    await syncClassroomDriveProperties(c).catch(() => undefined);
    return;
  }
  await pushCustomRosterToSheet(c.id).catch((err) => console.warn('[EduPlan Class] pushCustomRosterToSheet warning:', err));
  if (c.sheet.attendance) {
    for (const s of sortSessions(await getSessions(c.id))) {
      if (!s.sheetSynced) await pushCustomColumn(c, 'attendance', s, sessionHeaderText(s), (sid) => attendanceCell(s, sid));
    }
  }
  if (c.sheet.assignments) {
    const asgStartCol = getRoomAssignmentStartCol(c) ?? undefined;
    for (const a of sortAssignments(await getAssignments(c.id))) {
      if (!a.sheetSynced) {
        await pushCustomColumn(c, 'assignments', a, assignmentHeader(a), (sid) => assignmentCell(a, sid), asgStartCol);
      }
    }
  }
  await syncSpreadsheetSyncMeta(c).catch((err) => console.warn('[EduPlan Class] syncSpreadsheetSyncMeta warning:', err));
  await syncClassroomDriveProperties(c).catch(() => undefined);
}

/** อัปเกรดห้อง Local -> สร้าง Google Sheet มาตรฐานใหม่และซิงก์ */
export async function upgradeToStandardSheet(classroomId: string): Promise<Classroom> {
  const c = await getClassroom(classroomId);
  if (!c) throw new Error('ไม่พบห้องเรียน');
  const sessions = await getSessions(c.id);
  const assignments = await getAssignments(c.id);
  c.sheet = await createStandardSpreadsheet(c);
  c.sheetId = c.sheet.spreadsheetId;
  c.assignmentStartCol = parseColumnIndex(c.sheet.assignments?.startCol, 3);
  c.syncMode = 'google';
  await saveClassroom(c);
  await Promise.all([
    ...sessions.map((s) => markSessionSync(s.id, { sheetColumn: null, sheetSynced: false })),
    ...assignments.map((a) => markAssignmentSync(a.id, { sheetColumn: null, sheetSynced: false })),
  ]);
  await pushStandardAll(c);
  await syncSpreadsheetSyncMeta(c).catch((err) => console.warn('[EduPlan Class] syncSpreadsheetSyncMeta warning:', err));
  await syncClassroomDriveProperties(c).catch((err) => console.warn('[EduPlan Class] syncClassroomDriveProperties warning:', err));
  scheduleAppDataSync(0);
  return c;
}

// ============================================================
// Google Drive API v3 — Collaborators, Public Properties & Shared Rooms
// ============================================================
const COLLAB_ROLES = new Set<Exclude<ClassroomRole, 'owner'>>(['creator', 'assistant', 'viewer']);

/** จำกัดความยาวตัวอักษรและขนาด UTF-8 byte ไม่ให้เกินลิมิต 124 bytes ต่อคีย์ของ Google Drive API */
function truncateDriveProperty(key: string, rawVal: string, maxChars = 40): string {
  const enc = new TextEncoder();
  const keyBytes = enc.encode(key).length;
  const maxValBytes = Math.max(10, 120 - keyBytes);
  let out = (rawVal ?? '').trim().slice(0, maxChars);
  while (enc.encode(out).length > maxValBytes && out.length > 0) {
    out = out.slice(0, -1);
  }
  return out;
}

export function parseCollaboratorsFromProperties(props: Record<string, string | null> | undefined): Collaborator[] {
  if (!props) return [];
  const out: Collaborator[] = [];
  const seen = new Set<string>();
  for (let i = 1; i <= 5; i++) {
    const raw = (props[`collab_${i}`] ?? '').trim();
    if (!raw || !raw.includes('|')) continue;
    const [rawEmail, rawRole] = raw.split('|');
    const email = (rawEmail ?? '').toLowerCase().trim();
    const role = (rawRole ?? '').trim() as Exclude<ClassroomRole, 'owner'>;
    if (!email || !COLLAB_ROLES.has(role) || seen.has(email)) continue;
    seen.add(email);
    out.push({ email, role });
  }
  return out;
}

function buildDrivePropertiesPayload(c: Classroom, collabs?: Collaborator[]): Record<string, string> {
  const props: Record<string, string> = {
    eduplan_type: 'classroom',
    eduplan_room_name: truncateDriveProperty('eduplan_room_name', c.name || 'ห้องเรียน', 40),
    eduplan_subject: truncateDriveProperty('eduplan_subject', c.subject || 'ไม่ระบุวิชา', 40),
  };
  const asgStartCol = getRoomAssignmentStartCol(c);
  if (asgStartCol !== null) {
    props.eduplan_asg_start_col = String(Number(asgStartCol));
    props.eduplan_asg_cols = String(c.sheet?.assignments?.colsPerAssignment === 2 ? 2 : 1);
  } else {
    props.eduplan_asg_start_col = '';
    props.eduplan_asg_cols = '';
  }
  if (c.sheet?.attendance) {
    props.eduplan_att_start_col = String(parseColumnIndex(c.sheet.attendance.startCol, 0));
  } else {
    props.eduplan_att_start_col = '';
  }
  if (collabs) {
    const list = collabs.slice(0, 5);
    for (let i = 0; i < 5; i++) {
      const key = `collab_${i + 1}`;
      const item = list[i];
      props[key] = item ? truncateDriveProperty(key, `${item.email.toLowerCase().trim()}|${item.role}`, 110) : '';
    }
  }
  return props;
}

/** บันทึก Public File properties บนไฟล์ Google Sheet (ตรวจสอบ response.ok และ Log Error ชัดเจน) */
export async function syncClassroomDriveProperties(c: Classroom, collabs?: Collaborator[]): Promise<void> {
  const fileId = c.sheet?.spreadsheetId ?? c.sheetId;
  if (!fileId || !getAuthState().signedIn) return;
  if (c.role && c.role !== 'owner' && c.role !== 'creator') return;
  const properties = buildDrivePropertiesPayload(c, collabs ?? c.collaborators);
  const token = await ensureToken();
  const url = `${DRIVE}/${encodeURIComponent(fileId)}?fields=id,properties`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ properties }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error('[EduPlan Class] PATCH Drive properties failed:', res.status, errText);
    throw new Error(`บันทึกข้อมูลสิทธิ์ลง Google Drive properties ไม่สำเร็จ (HTTP ${res.status}): ${errText || res.statusText}`);
  }
  const updated = (await res.json().catch(() => null)) as { id?: string; properties?: Record<string, string> } | null;
  if (!updated?.id) {
    console.error('[EduPlan Class] PATCH Drive properties returned invalid payload:', updated);
    throw new Error('ไม่สามารถยืนยันการบันทึก Google Drive properties ได้');
  }
}

interface DrivePermissionItem {
  id: string;
  emailAddress?: string;
  role?: string;
}

interface DriveFileCollabMeta {
  id: string;
  properties?: Record<string, string>;
  permissions?: DrivePermissionItem[];
}

/** ดึงรายชื่อผู้ร่วมสอนล่าสุดจาก properties และ permissions ของไฟล์ Google Sheet */
export async function fetchRoomCollaborators(room: Classroom): Promise<Collaborator[]> {
  const fileId = room.sheet?.spreadsheetId ?? room.sheetId;
  if (!fileId || !getAuthState().signedIn) return room.collaborators ?? [];
  let props: Record<string, string> | undefined;
  let perms: DrivePermissionItem[] = [];
  try {
    const meta = await gfetch<DriveFileCollabMeta>(
      `${DRIVE}/${encodeURIComponent(fileId)}?fields=${encodeURIComponent('id,properties,permissions(id,emailAddress,role)')}`,
    );
    props = meta.properties;
    perms = meta.permissions ?? [];
  } catch {
    const meta = await gfetch<DriveFileCollabMeta>(
      `${DRIVE}/${encodeURIComponent(fileId)}?fields=${encodeURIComponent('id,properties')}`,
    );
    props = meta.properties;
  }
  const collabs = parseCollaboratorsFromProperties(props);
  for (const c of collabs) {
    const cEmail = c.email.toLowerCase().trim();
    const p = perms.find((x) => (x.emailAddress ?? '').toLowerCase().trim() === cEmail);
    if (p) c.permissionId = p.id;
  }
  room.collaborators = collabs;
  await saveClassroom(room);
  return collabs;
}

/** เพิ่มผู้ร่วมสอนใหม่ (สูงสุด 5 คนต่อห้อง) — ยิงทั้ง POST permissions และ PATCH properties */
export async function addCollaborator(
  room: Classroom,
  rawEmail: string,
  role: Exclude<ClassroomRole, 'owner'>,
): Promise<Collaborator[]> {
  const fileId = room.sheet?.spreadsheetId ?? room.sheetId;
  if (room.syncMode !== 'google' || !fileId) {
    throw new Error('ต้องเชื่อมต่อ Google Sheet ก่อนจึงจะเชิญผู้ร่วมสอนได้');
  }
  const email = rawEmail.toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('รูปแบบอีเมลไม่ถูกต้อง (ตัวอย่าง: example@gmail.com)');
  }
  const myEmail = (getAuthState().profile?.email ?? '').toLowerCase().trim();
  if (myEmail && email === myEmail) {
    throw new Error('ไม่สามารถเพิ่มอีเมลของเจ้าของห้องเองได้');
  }

  const current = await fetchRoomCollaborators(room);
  if (current.some((c) => c.email.toLowerCase().trim() === email)) {
    throw new Error(`อีเมล ${email} อยู่ในรายชื่อผู้ร่วมสอนแล้ว`);
  }
  if (current.length >= 5) {
    throw new Error('เพิ่มผู้ร่วมสอนได้สูงสุด 5 คนต่อห้องเรียน');
  }

  const driveRole = role === 'viewer' ? 'reader' : 'writer';
  const token = await ensureToken();
  const permRes = await fetch(
    `${DRIVE}/${encodeURIComponent(fileId)}/permissions?sendNotificationEmail=false&fields=id,emailAddress,role`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'user',
        role: driveRole,
        emailAddress: email,
      }),
    },
  );
  if (!permRes.ok) {
    const errText = await permRes.text().catch(() => '');
    console.error('[EduPlan Class] POST Drive permission failed:', permRes.status, errText);
    throw new Error(`เพิ่มสิทธิ์ผู้ร่วมสอนบน Google Drive ไม่สำเร็จ (HTTP ${permRes.status})`);
  }
  const perm = (await permRes.json().catch(() => null)) as DrivePermissionItem | null;

  const next: Collaborator[] = [...current, { email, role, permissionId: perm?.id }];
  await syncClassroomDriveProperties(room, next);
  room.collaborators = next;
  room.sheetId = fileId;
  await saveClassroom(room);
  await syncSpreadsheetSyncMeta(room).catch((err) => console.warn('[EduPlan Class] syncSpreadsheetSyncMeta on invite:', err));
  scheduleAppDataSync();
  return next;
}

export const inviteCollaborator = addCollaborator;

/** เปลี่ยนสิทธิ์ของผู้ร่วมสอน */
export async function updateCollaboratorRole(
  room: Classroom,
  rawEmail: string,
  newRole: Exclude<ClassroomRole, 'owner'>,
): Promise<Collaborator[]> {
  if (!room.sheet?.spreadsheetId) throw new Error('ห้องเรียนยังไม่ได้เชื่อมต่อ Google Sheet');
  const email = rawEmail.trim().toLowerCase();
  const fileId = room.sheet.spreadsheetId;
  const current = await fetchRoomCollaborators(room);
  const target = current.find((c) => c.email.toLowerCase() === email);
  if (!target) throw new Error(`ไม่พบผู้ร่วมสอน ${email}`);

  let permId = target.permissionId;
  if (!permId) {
    const pList = await gfetch<{ permissions?: DrivePermissionItem[] }>(
      `${DRIVE}/${encodeURIComponent(fileId)}/permissions?fields=${encodeURIComponent('permissions(id,emailAddress,role)')}`,
    );
    permId = pList.permissions?.find((p) => p.emailAddress?.toLowerCase() === email)?.id;
  }

  const driveRole = newRole === 'viewer' ? 'reader' : 'writer';
  if (permId) {
    await gfetch(`${DRIVE}/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permId)}?fields=id,role`, {
      method: 'PATCH',
      body: JSON.stringify({ role: driveRole }),
    });
  } else {
    const created = await gfetch<DrivePermissionItem>(
      `${DRIVE}/${encodeURIComponent(fileId)}/permissions?sendNotificationEmail=false&fields=id,emailAddress,role`,
      {
        method: 'POST',
        body: JSON.stringify({ type: 'user', role: driveRole, emailAddress: email }),
      },
    );
    permId = created?.id;
  }

  const next = current.map((c) => (c.email.toLowerCase() === email ? { ...c, role: newRole, permissionId: permId } : c));
  await syncClassroomDriveProperties(room, next);
  room.collaborators = next;
  await saveClassroom(room);
  scheduleAppDataSync();
  return next;
}

/** ลบผู้ร่วมสอนออกจากห้องเรียน */
export async function removeCollaborator(room: Classroom, rawEmail: string): Promise<Collaborator[]> {
  if (!room.sheet?.spreadsheetId) throw new Error('ห้องเรียนยังไม่ได้เชื่อมต่อ Google Sheet');
  const email = rawEmail.trim().toLowerCase();
  const fileId = room.sheet.spreadsheetId;
  const current = await fetchRoomCollaborators(room);

  try {
    const pList = await gfetch<{ permissions?: DrivePermissionItem[] }>(
      `${DRIVE}/${encodeURIComponent(fileId)}/permissions?fields=${encodeURIComponent('permissions(id,emailAddress,role)')}`,
    );
    const permId =
      pList.permissions?.find((p) => p.emailAddress?.toLowerCase() === email)?.id ??
      current.find((c) => c.email.toLowerCase() === email)?.permissionId;
    if (permId) {
      await gfetch(`${DRIVE}/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permId)}`, {
        method: 'DELETE',
      });
    }
  } catch {
    /* ignore if permission already removed */
  }

  const next = current.filter((c) => c.email.toLowerCase() !== email);
  await syncClassroomDriveProperties(room, next);
  room.collaborators = next;
  await saveClassroom(room);
  scheduleAppDataSync();
  return next;
}

// ---------------- ค้นหาห้องเรียนที่ถูกเชิญ & ดึงข้อมูลจาก Google Sheet ----------------
interface SharedDriveFile {
  id: string;
  name: string;
  modifiedTime?: string;
  owners?: { emailAddress?: string; displayName?: string }[];
  properties?: Record<string, string>;
  capabilities?: { canEdit?: boolean };
}

function buildSharedRoomObject(
  f: SharedDriveFile,
  role: ClassroomRole,
  collabs: Collaborator[],
  prev?: Classroom,
  importedViaPicker?: boolean,
): Classroom {
  const now = Date.now();
  const roomId = `shared_${f.id}`;
  const ownerEmail = (f.owners?.[0]?.emailAddress ?? prev?.ownerEmail ?? 'ไม่ระบุอีเมลเจ้าของห้อง').trim();
  const roomName = f.properties?.eduplan_room_name || prev?.name || f.name;
  const subjectName = f.properties?.eduplan_subject || prev?.subject || f.name;
  const sheetUrl = safeHttpsUrl(`https://docs.google.com/spreadsheets/d/${encodeURIComponent(f.id)}/edit`);

  const rawPropAsgStart = (f.properties?.eduplan_asg_start_col ?? '').trim();
  const parsedAsgStartCol =
    rawPropAsgStart !== ''
      ? parseColumnIndex(rawPropAsgStart, 3)
      : prev?.assignmentStartCol !== undefined && prev.assignmentStartCol !== null
        ? parseColumnIndex(prev.assignmentStartCol, 3)
        : prev?.sheet?.assignments
          ? parseColumnIndex(prev.sheet.assignments.startCol, 3)
          : 3;

  return {
    id: roomId,
    name: roomName,
    subject: subjectName,
    term: prev?.term || currentTerm(),
    academicYear: prev?.academicYear || currentAcademicYear(),
    syncMode: 'google',
    sheetId: f.id,
    isSharedWithMe: true,
    importedViaPicker: importedViaPicker ?? prev?.importedViaPicker,
    role,
    ownerEmail,
    collaborators: collabs,
    lastModifiedTime: f.modifiedTime ?? prev?.lastModifiedTime,
    attendanceHeaderMode: prev?.attendanceHeaderMode,
    assignmentStartCol: parsedAsgStartCol,
    sheet: prev?.sheet ?? {
      spreadsheetId: f.id,
      spreadsheetName: f.name,
      spreadsheetUrl: sheetUrl,
      standard: true,
      roster: {
        sheetTitle: STANDARD_TABS.roster,
        mapping: { headerRow: 0, number: 0, code: 1, nameMode: 'single', name: 2, prefix: null, first: null, last: null },
      },
      attendance: { sheetTitle: STANDARD_TABS.attendance, headerRow: 1, keyCol: 1, keyType: 'order', startCol: 3, mode: 'append', fixedCount: 0 },
      assignments: { sheetTitle: STANDARD_TABS.assignments, headerRow: 1, keyCol: 1, keyType: 'order', startCol: parsedAsgStartCol },
    },
    createdAt: prev?.createdAt ?? now,
    updatedAt: f.modifiedTime ? Date.parse(f.modifiedTime) || now : prev?.updatedAt ?? now,
  };
}

function collabsEqual(a: Collaborator[] = [], b: Collaborator[] = []): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].email !== b[i].email || a[i].role !== b[i].role) return false;
  }
  return true;
}

function sharedRoomMetaChanged(prev: Classroom | undefined, next: Classroom): boolean {
  if (!prev) return true;
  return (
    prev.name !== next.name ||
    prev.subject !== next.subject ||
    prev.role !== next.role ||
    prev.ownerEmail !== next.ownerEmail ||
    prev.sheetId !== next.sheetId ||
    prev.isSharedWithMe !== next.isSharedWithMe ||
    prev.importedViaPicker !== next.importedViaPicker ||
    prev.lastModifiedTime !== next.lastModifiedTime ||
    (prev.sheet?.spreadsheetId ?? '') !== (next.sheet?.spreadsheetId ?? '') ||
    !collabsEqual(prev.collaborators, next.collaborators)
  );
}

let inFlightSharedFetch: Promise<Classroom[]> | null = null;

/** ซิงก์รายชื่อห้องเรียนที่ถูกแชร์จาก eduplan_shared_rooms.json (appDataFolder) + ดึง Metadata ทีละ fileId ภายใต้สิทธิ์ drive.file */
export function fetchSharedClassrooms(): Promise<Classroom[]> {
  if (inFlightSharedFetch) return inFlightSharedFetch;
  inFlightSharedFetch = fetchSharedClassroomsImpl().finally(() => {
    inFlightSharedFetch = null;
  });
  return inFlightSharedFetch;
}

async function fetchSharedClassroomsImpl(): Promise<Classroom[]> {
  const auth = getAuthState();
  if (!auth.signedIn || !auth.profile?.email) return [];
  const myEmail = auth.profile.email.toLowerCase().trim();

  const existingAll = await listClassrooms();
  const localSharedRooms = existingAll.filter((r) => r.isSharedWithMe || (r.role && r.role !== 'owner'));

  const { appFileId, fileIds: manifestIds } = await withSharedManifestLock(() => loadSharedRoomsManifest());

  // รองรับการอัปเกรดจากแคชในเครื่องเดิมหากยังไม่เคยสร้าง eduplan_shared_rooms.json ใน appDataFolder
  const candidateSet = new Set<string>(manifestIds);
  if (!appFileId) {
    for (const r of localSharedRooms) {
      const fid = r.sheet?.spreadsheetId ?? r.sheetId;
      const matchesAccount =
        !r.collaborators?.length || r.collaborators.some((c) => c.email.toLowerCase().trim() === myEmail);
      if (fid && matchesAccount) candidateSet.add(fid);
    }
  }
  const candidateIds = Array.from(candidateSet);

  if (!candidateIds.length) {
    await purgeStaleSharedClassrooms(new Set<string>());
    return [];
  }

  const activeSharedIds = new Set<string>();
  const keptManifestIds: string[] = [];
  const sharedRooms: Classroom[] = [];
  let manifestDirty = !appFileId && candidateIds.length > 0;
  const fields = encodeURIComponent('id,name,modifiedTime,owners(emailAddress,displayName),properties,trashed,capabilities(canEdit)');

  await Promise.all(
    candidateIds.map(async (fid) => {
      const roomId = `shared_${fid}`;
      const prev = existingAll.find((r) => r.id === roomId);
      try {
        const direct = await gfetch<SharedDriveFile & { trashed?: boolean }>(
          `${DRIVE}/${encodeURIComponent(fid)}?fields=${fields}`,
        );
        if (!direct || direct.trashed) {
          manifestDirty = true;
          return;
        }
        const ownerEmail = (direct.owners?.[0]?.emailAddress ?? '').toLowerCase().trim();
        if (ownerEmail && ownerEmail === myEmail) {
          manifestDirty = true;
          return;
        }
        const collabs = parseCollaboratorsFromProperties(direct.properties);
        const myEntry = collabs.find((c) => c.email.toLowerCase().trim() === myEmail);
        const resolvedRole: ClassroomRole = myEntry?.role ?? (direct.capabilities?.canEdit ? 'assistant' : 'viewer');

        const room = buildSharedRoomObject(direct, resolvedRole, collabs, prev, true);
        activeSharedIds.add(room.id);
        keptManifestIds.push(fid);
        if (sharedRoomMetaChanged(prev, room)) {
          await saveClassroom(room);
        }
        sharedRooms.push(room);
      } catch (err) {
        if (err instanceof GoogleApiError && (err.status === 404 || err.status === 403)) {
          // ไฟล์ถูกลบหรือโดนเจ้าของถอนสิทธิ์แชร์ -> นำออกจากรายการอัตโนมัติ
          manifestDirty = true;
          return;
        }
        // กรณีข้อผิดพลาดชั่วคราวของเครือข่าย ให้คงแคชเดิมไว้ก่อน
        console.warn(`[EduPlan Class] transient error loading shared room ${fid}:`, err);
        keptManifestIds.push(fid);
        if (prev) {
          activeSharedIds.add(prev.id);
          sharedRooms.push(prev);
        }
      }
    }),
  );

  if (manifestDirty || keptManifestIds.length !== manifestIds.length) {
    await withSharedManifestLock(async () => {
      const latest = await loadSharedRoomsManifest();
      const removedSet = new Set(candidateIds.filter((id) => !keptManifestIds.includes(id)));
      const merged = Array.from(
        new Set([...keptManifestIds, ...latest.fileIds.filter((id) => !removedSet.has(id))]),
      );
      await saveSharedRoomsManifest(latest.appFileId, merged);
    }).catch((err) => console.warn('[EduPlan Class] update eduplan_shared_rooms.json warning:', err));
  }

  await purgeStaleSharedClassrooms(activeSharedIds);
  return sharedRooms;
}

export const fetchSharedClassroomsFromDrive = fetchSharedClassrooms;

/** ถอนสิทธิ์ตนเองออกจากห้องเรียนร่วม (ปุ่ม ออกจากห้องร่วม) */
export async function leaveSharedClassroom(room: Classroom): Promise<void> {
  const auth = getAuthState();
  const myEmail = auth.profile?.email?.trim().toLowerCase();
  const fileId = room.sheet?.spreadsheetId ?? room.sheetId;

  if (fileId && auth.signedIn && myEmail) {
    let myPermissionId = room.myPermissionId;
    if (!myPermissionId) {
      try {
        const pList = await gfetch<{ permissions?: DrivePermissionItem[] }>(
          `${DRIVE}/${encodeURIComponent(fileId)}/permissions?fields=${encodeURIComponent('permissions(id,emailAddress,role)')}`,
        );
        myPermissionId = pList.permissions?.find((p) => p.emailAddress?.toLowerCase() === myEmail)?.id;
      } catch {
        /* fallback to /drive/v3/about */
      }
    }
    if (!myPermissionId) {
      try {
        const about = await gfetch<{ user?: { permissionId?: string } }>(
          'https://www.googleapis.com/drive/v3/about?fields=user(permissionId,emailAddress)',
        );
        myPermissionId = about.user?.permissionId;
      } catch {
        /* ignore */
      }
    }
    // หากมีสิทธิ์ writer ให้ล้างสล็อต collab_X ของตัวเองใน properties ด้วย
    if (room.role === 'creator' || room.role === 'assistant') {
      try {
        const meta = await gfetch<{ properties?: Record<string, string> }>(
          `${DRIVE}/${encodeURIComponent(fileId)}?fields=properties`,
        );
        const collabs = parseCollaboratorsFromProperties(meta.properties).filter((c) => c.email.toLowerCase() !== myEmail);
        const properties = buildDrivePropertiesPayload(room, collabs);
        await gfetch(`${DRIVE}/${encodeURIComponent(fileId)}?fields=id`, {
          method: 'PATCH',
          body: JSON.stringify({ properties }),
        });
      } catch {
        /* ignore if reader */
      }
    }
    if (myPermissionId) {
      await gfetch(`${DRIVE}/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(myPermissionId)}`, {
        method: 'DELETE',
      }).catch((e) => {
        if (!isGoogleNotFoundError(e)) throw e;
      });
    }
  }

  await deleteClassroom(room.id);
  if (fileId && auth.signedIn) {
    await removeSharedRoomIdFromAppData(fileId).catch(() => undefined);
  }
}

function parseBeDateToken(token: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(token.trim());
  if (!m) return null;
  const d = m[1].padStart(2, '0');
  const mo = m[2].padStart(2, '0');
  const yNum = Number(m[3]);
  const yCE = yNum > 2400 ? yNum - 543 : yNum;
  return `${yCE}-${mo}-${d}`;
}

function parseSessionHeaderLabel(rawHeader: string): { date: string; period: string; headerMode: SessionHeaderMode } {
  const trimmed = rawHeader.trim();
  if (trimmed.includes('\n')) {
    const lines = trimmed
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length >= 2) {
      const lastIso = parseBeDateToken(lines[lines.length - 1]);
      if (lastIso) {
        return { date: lastIso, period: lines.slice(0, -1).join(' '), headerMode: 'both' };
      }
      const firstIso = parseBeDateToken(lines[0]);
      if (firstIso) {
        return { date: firstIso, period: lines.slice(1).join(' '), headerMode: 'both' };
      }
    }
  }
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(.*))?$/.exec(trimmed);
  if (m) {
    const date = parseBeDateToken(`${m[1]}/${m[2]}/${m[3]}`) ?? todayISO();
    const period = (m[4] ?? '').trim();
    return { date, period, headerMode: period ? 'both' : 'date' };
  }
  return { date: todayISO(), period: trimmed, headerMode: 'period' };
}

function parseAssignmentHeaderLabel(rawHeader: string): { title: string; maxScore: number | null } {
  const trimmed = rawHeader.trim();
  const m = /^(.*?)\s*\((\d+(?:\.\d+)?)\)\s*$/.exec(trimmed);
  if (m && m[1].trim()) {
    return { title: m[1].trim(), maxScore: Number(m[2]) };
  }
  return { title: trimmed, maxScore: null };
}

function parseAttendanceValue(val: string): AttendanceStatus | null {
  const v = val.trim();
  if (v === 'มา' || v.toLowerCase() === 'present') return 'present';
  if (v === 'ลา/ขาด' || v === 'ลา' || v === 'ขาด' || v.toLowerCase() === 'absent') return 'absent';
  if (v === 'มาสาย' || v === 'สาย' || v.toLowerCase() === 'late') return 'late';
  return null;
}

function buildGridRowMap(
  grid: string[][],
  headerRow1Based: number,
  keyCol: number,
  keyType: RowKeyType,
  students: Student[],
): Map<string, number> {
  const map = new Map<string, number>();
  const firstDataRowIdx = headerRow1Based; // 1-based (headerRow + 1) -> 0-based index = headerRow1Based
  if (keyType === 'order') {
    students.forEach((s, i) => map.set(s.id, firstDataRowIdx + i));
    return map;
  }
  const valIndex = new Map<string, number>();
  for (let r = firstDataRowIdx; r < grid.length; r++) {
    const k = normalizeKey(grid[r]?.[keyCol]);
    if (k && !valIndex.has(k)) valIndex.set(k, r);
  }
  for (const s of students) {
    const k = studentKey(s, keyType);
    const rIdx = k ? valIndex.get(k) : undefined;
    if (rIdx !== undefined) map.set(s.id, rIdx);
  }
  return map;
}

/** ดึงโครงสร้างและข้อมูลล่าสุด (รายชื่อ + เช็คชื่อ + งาน) จาก Google Sheet มาแคชลง Dexie ให้ตรงกับฝั่งเจ้าของห้อง 100% */
export async function pullClassroomFromSheet(roomIn: Classroom): Promise<Classroom> {
  if (!roomIn.sheet?.spreadsheetId || !getAuthState().signedIn) return roomIn;
  const room: Classroom = JSON.parse(JSON.stringify(roomIn)) as Classroom;
  const spreadsheetId = room.sheet!.spreadsheetId;
  const now = Date.now();

  room.sheetId = spreadsheetId;

  const [meta, driveMeta, existingStudents, existingSessions, existingAssignments] = await Promise.all([
    getSpreadsheetMeta(spreadsheetId),
    gfetch<{
      id: string;
      name?: string;
      modifiedTime?: string;
      owners?: { emailAddress?: string }[];
      properties?: Record<string, string>;
      capabilities?: { canEdit?: boolean };
    }>(`${DRIVE}/${encodeURIComponent(spreadsheetId)}?fields=${encodeURIComponent('id,name,modifiedTime,owners(emailAddress),properties,capabilities(canEdit)')}`).catch(() => null),
    getStudents(room.id),
    getSessions(room.id),
    getAssignments(room.id),
  ]);

  if (driveMeta) {
    if (driveMeta.modifiedTime) room.lastModifiedTime = driveMeta.modifiedTime;
    const collabs = parseCollaboratorsFromProperties(driveMeta.properties);
    room.collaborators = collabs;
    if (room.role && room.role !== 'owner') {
      const myEmail = (getAuthState().profile?.email ?? '').toLowerCase().trim();
      const me = myEmail ? collabs.find((c) => c.email.toLowerCase().trim() === myEmail) : undefined;
      if (me) room.role = me.role;
      else if (room.importedViaPicker && driveMeta.capabilities) {
        room.role = driveMeta.capabilities.canEdit ? 'assistant' : 'viewer';
      }
      if (driveMeta.properties?.eduplan_room_name) room.name = driveMeta.properties.eduplan_room_name;
      if (driveMeta.properties?.eduplan_subject) room.subject = driveMeta.properties.eduplan_subject;
    }
    if (driveMeta.owners?.[0]?.emailAddress && room.role && room.role !== 'owner') {
      room.ownerEmail = driveMeta.owners[0].emailAddress;
    }
  }

  const syncMeta = parseSpreadsheetSyncMeta(meta);
  const sheetTitles = new Set(meta.sheets.map((s) => s.title));
  const hasStandardTabs =
    sheetTitles.has(STANDARD_TABS.roster) &&
    sheetTitles.has(STANDARD_TABS.attendance) &&
    sheetTitles.has(STANDARD_TABS.assignments);

  const propAsgStartRaw = (driveMeta?.properties?.eduplan_asg_start_col ?? '').trim();
  const propAsgStartCol = propAsgStartRaw !== '' ? parseColumnIndex(propAsgStartRaw, 0) : null;

  if (syncMeta) {
    if (syncMeta.name) room.name = syncMeta.name;
    if (syncMeta.subject) room.subject = syncMeta.subject;
    if (syncMeta.term) room.term = syncMeta.term;
    if (syncMeta.academicYear) room.academicYear = syncMeta.academicYear;
    if (syncMeta.attendanceHeaderMode) room.attendanceHeaderMode = syncMeta.attendanceHeaderMode;
    const normAtt = normalizeAttendanceMapping(syncMeta.attendance);
    const normAsg = normalizeAssignmentMapping(syncMeta.assignments, propAsgStartCol ?? room.assignmentStartCol);
    room.sheet = {
      spreadsheetId,
      spreadsheetName: meta.title || room.sheet!.spreadsheetName,
      spreadsheetUrl: safeHttpsUrl(meta.url) || room.sheet!.spreadsheetUrl,
      standard: syncMeta.standard,
      roster: syncMeta.roster,
      attendance: normAtt,
      assignments: normAsg,
    };
    room.assignmentStartCol = normAsg ? Number(normAsg.startCol) : propAsgStartCol ?? undefined;
  } else if (hasStandardTabs) {
    room.sheet = {
      spreadsheetId,
      spreadsheetName: meta.title || room.sheet!.spreadsheetName,
      spreadsheetUrl: safeHttpsUrl(meta.url) || room.sheet!.spreadsheetUrl,
      standard: true,
      roster: {
        sheetTitle: STANDARD_TABS.roster,
        mapping: { headerRow: 0, number: 0, code: 1, nameMode: 'single', name: 2, prefix: null, first: null, last: null },
      },
      attendance: { sheetTitle: STANDARD_TABS.attendance, headerRow: 1, keyCol: 1, keyType: 'order', startCol: 3, mode: 'append', fixedCount: 0 },
      assignments: { sheetTitle: STANDARD_TABS.assignments, headerRow: 1, keyCol: 1, keyType: 'order', startCol: 3 },
    };
    room.assignmentStartCol = 3;
  } else if (room.sheet) {
    const firstSheet = meta.sheets[0];
    const firstTab = firstSheet?.title ?? 'Sheet1';
    room.sheet.spreadsheetName = meta.title || room.sheet.spreadsheetName;
    room.sheet.spreadsheetUrl = safeHttpsUrl(meta.url) || room.sheet.spreadsheetUrl;
    room.sheet.standard = false;
    room.sheet.attendance = normalizeAttendanceMapping(room.sheet.attendance);
    room.sheet.assignments = normalizeAssignmentMapping(room.sheet.assignments, propAsgStartCol ?? room.assignmentStartCol);
    if (room.sheet.attendance && !sheetTitles.has(room.sheet.attendance.sheetTitle)) {
      room.sheet.attendance = null;
    }
    if (room.sheet.assignments && !sheetTitles.has(room.sheet.assignments.sheetTitle)) {
      room.sheet.assignments = null;
    }
    if (room.sheet.assignments) {
      room.assignmentStartCol = Number(room.sheet.assignments.startCol);
    } else if (propAsgStartCol !== null) {
      room.assignmentStartCol = propAsgStartCol;
    }
    if (!room.sheet.roster || !sheetTitles.has(room.sheet.roster.sheetTitle)) {
      const firstGrid = firstSheet ? await getValues(spreadsheetId, quoteSheet(firstTab)).catch(() => []) : [];
      const guessedH = guessHeaderRow(firstGrid, firstSheet?.merges);
      const guessedMap = guessMapping(firstGrid, guessedH, firstSheet?.merges);
      room.sheet.roster = { sheetTitle: firstTab, mapping: guessedMap };
    }
  }

  const rosterTab = room.sheet?.roster?.sheetTitle;
  const attMap = room.sheet?.attendance;
  const asgMap = room.sheet?.assignments;

  const tabsToFetch = new Set<string>();
  if (rosterTab && sheetTitles.has(rosterTab) && (!syncMeta?.students?.length || attMap?.sheetTitle === rosterTab || asgMap?.sheetTitle === rosterTab)) {
    tabsToFetch.add(rosterTab);
  }
  if (attMap && sheetTitles.has(attMap.sheetTitle)) tabsToFetch.add(attMap.sheetTitle);
  if (asgMap && sheetTitles.has(asgMap.sheetTitle)) tabsToFetch.add(asgMap.sheetTitle);

  const gridByTab = new Map<string, string[][]>();
  await Promise.all(
    Array.from(tabsToFetch).map(async (tab) => {
      const grid = await getValues(spreadsheetId, quoteSheet(tab)).catch(() => []);
      gridByTab.set(tab, grid);
    }),
  );

  const rosterGrid = rosterTab ? gridByTab.get(rosterTab) ?? [] : [];
  const attGrid = attMap ? gridByTab.get(attMap.sheetTitle) ?? [] : [];
  const asgGrid = asgMap ? gridByTab.get(asgMap.sheetTitle) ?? [] : [];

  // 1) Parse Students (ใช้ Master Roster จาก syncMeta สำหรับไฟล์กำหนดเอง หรือ applyMapping บน rosterGrid)
  const byCode = new Map(existingStudents.filter((s) => s.studentCode.trim()).map((s) => [normalizeKey(s.studentCode), s]));
  const byName = new Map(existingStudents.map((s) => [normalizeKey(s.fullName), s]));
  const usedStudentIds = new Set<string>();

  const parsedList: ParsedStudent[] =
    syncMeta?.students?.length
      ? syncMeta.students.map((s) => ({ number: s.n, studentCode: s.c, fullName: s.f }))
      : room.sheet?.roster?.mapping && rosterGrid.length > room.sheet.roster.mapping.headerRow + 1
        ? applyMapping(rosterGrid, room.sheet.roster.mapping)
        : !room.sheet?.standard && attGrid.length > (attMap?.headerRow ?? 1)
          ? applyMapping(attGrid, {
              headerRow: (attMap?.headerRow ?? 1) - 1,
              number: 0,
              code: attMap?.keyType === 'code' ? attMap.keyCol : 1,
              nameMode: 'single',
              name: attMap?.keyType === 'name' ? attMap.keyCol : 2,
              prefix: null,
              first: null,
              last: null,
            })
          : [];

  const nextStudents: Student[] = [];
  parsedList.forEach((p) => {
    const matched =
      (p.studentCode && byCode.get(normalizeKey(p.studentCode))) ||
      (p.fullName && byName.get(normalizeKey(p.fullName)));
    const sid = matched && !usedStudentIds.has(matched.id) ? matched.id : uid();
    usedStudentIds.add(sid);
    nextStudents.push({
      id: sid,
      classroomId: room.id,
      number: p.number || String(nextStudents.length + 1),
      studentCode: p.studentCode,
      fullName: p.fullName || `นักเรียนคนที่ ${nextStudents.length + 1}`,
      order: nextStudents.length,
      updatedAt: now,
    });
  });

  const finalStudents = nextStudents.length ? nextStudents : existingStudents;

  // 2) Parse Attendance Sessions (อ้างอิง Row ตาม keyType/keyCol เหมือนตอนเขียน)
  const nextSessions: AttendanceSession[] = [];
  if (attMap && attGrid.length >= attMap.headerRow) {
    const hRowIdx = attMap.headerRow - 1;
    const headers = attGrid[hRowIdx] ?? [];
    const attRowMap = buildGridRowMap(attGrid, attMap.headerRow, attMap.keyCol, attMap.keyType, finalStudents);
    const syncSesByCol = new Map<number, { col: number | null; date: string; period: string; headerMode?: SessionHeaderMode }>();
    syncMeta?.sessions?.forEach((s) => {
      if (s.col !== null && s.col !== undefined) syncSesByCol.set(s.col, s);
    });
    const restrictCustomCols = !room.sheet?.standard && syncSesByCol.size > 0;

    const attStartCol = parseColumnIndex(attMap.startCol, 0);
    for (let col = attStartCol; col < headers.length; col++) {
      if (restrictCustomCols && !syncSesByCol.has(col)) continue;
      const hText = (headers[col] ?? '').trim();
      const metaSes = syncSesByCol.get(col);
      if (!hText && !metaSes) continue;
      const fallbackParsed = parseSessionHeaderLabel(hText);
      const date = metaSes?.date || fallbackParsed.date;
      const period = metaSes ? metaSes.period : fallbackParsed.period;
      const headerMode: SessionHeaderMode = metaSes?.headerMode ?? fallbackParsed.headerMode;
      const records: Record<string, AttendanceStatus> = {};
      finalStudents.forEach((st) => {
        const rIdx = attRowMap.get(st.id);
        if (rIdx === undefined) return;
        const rawVal = attGrid[rIdx]?.[col] ?? '';
        const parsed = parseAttendanceValue(rawVal);
        if (parsed) records[st.id] = parsed;
      });
      const prevSes =
        existingSessions.find((s) => s.sheetColumn === col) ??
        existingSessions.find((s) => s.date === date && s.period === period);
      nextSessions.push({
        id: prevSes?.id ?? uid(),
        classroomId: room.id,
        date,
        period,
        headerMode,
        records,
        sheetColumn: col,
        sheetSynced: true,
        createdAt: prevSes?.createdAt ?? now + col,
        updatedAt: now,
      });
    }
  }

  // 3) Parse Assignments (อ้างอิง Row ตาม keyType/keyCol และใช้ assignmentsMeta เพื่อคืนค่าวันที่สั่ง/กำหนดส่ง/คะแนนเต็ม)
  const nextAssignments: Assignment[] = [];
  if (asgMap && asgGrid.length >= asgMap.headerRow) {
    const hRowIdx = asgMap.headerRow - 1;
    const headers = asgGrid[hRowIdx] ?? [];
    const asgRowMap = buildGridRowMap(asgGrid, asgMap.headerRow, asgMap.keyCol, asgMap.keyType, finalStudents);
    const syncAsgByCol = new Map<
      number,
      { col: number | null; title: string; assignedDate: string; dueDate: string; maxScore: number | null }
    >();
    syncMeta?.assignmentsMeta?.forEach((a) => {
      if (a.col !== null && a.col !== undefined) syncAsgByCol.set(a.col, a);
    });
    const restrictCustomCols = !room.sheet?.standard && syncAsgByCol.size > 0;

    const asgStartCol = parseColumnIndex(asgMap.startCol, room.assignmentStartCol ?? 0);
    const colsPerAsg = Number(asgMap.colsPerAssignment) === 2 ? 2 : 1;
    const step = restrictCustomCols ? 1 : colsPerAsg;

    for (let col = asgStartCol; col < headers.length; col += step) {
      if (restrictCustomCols && !syncAsgByCol.has(col)) continue;
      const hText = (headers[col] ?? '').trim();
      const metaAsg = syncAsgByCol.get(col);
      if (!hText && !metaAsg) continue;
      const cleanHText = colsPerAsg === 2 ? hText.replace(/\s*\(สถานะ\)\s*$/, '').trim() : hText;
      const headerParsed = parseAssignmentHeaderLabel(cleanHText);
      const title = metaAsg?.title || headerParsed.title;
      const maxScore = metaAsg ? metaAsg.maxScore : headerParsed.maxScore;

      const submissions: Record<string, Submission> = {};
      finalStudents.forEach((st) => {
        const rIdx = asgRowMap.get(st.id);
        if (rIdx === undefined) {
          submissions[st.id] = { status: 'missing', score: null };
          return;
        }
        if (colsPerAsg === 2) {
          const rawStatus = (asgGrid[rIdx]?.[col] ?? '').trim();
          const rawScore = (asgGrid[rIdx]?.[col + 1] ?? '').trim();
          const parsedScore = rawScore !== '' && !Number.isNaN(Number(rawScore)) ? Number(rawScore) : null;
          const isSubmitted =
            parsedScore !== null ||
            rawStatus === SUBMISSION_LABEL.submitted ||
            rawStatus.toLowerCase() === 'submitted';
          submissions[st.id] = { status: isSubmitted ? 'submitted' : 'missing', score: parsedScore };
          return;
        }
        const rawVal = (asgGrid[rIdx]?.[col] ?? '').trim();
        if (rawVal !== '' && !Number.isNaN(Number(rawVal))) {
          submissions[st.id] = { status: 'submitted', score: Number(rawVal) };
        } else if (rawVal === SUBMISSION_LABEL.submitted || rawVal.toLowerCase() === 'submitted') {
          submissions[st.id] = { status: 'submitted', score: null };
        } else {
          submissions[st.id] = { status: 'missing', score: null };
        }
      });
      const prevAsg =
        existingAssignments.find((a) => a.sheetColumn === col) ??
        existingAssignments.find((a) => a.title === title);
      nextAssignments.push({
        id: prevAsg?.id ?? uid(),
        classroomId: room.id,
        title,
        assignedDate: metaAsg?.assignedDate || prevAsg?.assignedDate || todayISO(),
        dueDate: metaAsg ? metaAsg.dueDate : prevAsg?.dueDate ?? '',
        maxScore: maxScore ?? prevAsg?.maxScore ?? null,
        submissions,
        sheetColumn: col,
        sheetSynced: true,
        createdAt: prevAsg?.createdAt ?? now + col,
        updatedAt: now,
      });
    }
  }

  await replaceClassroomCache(
    room,
    finalStudents,
    nextSessions.length || (attMap && attGrid.length) ? nextSessions : existingSessions,
    nextAssignments.length || (asgMap && asgGrid.length) ? nextAssignments : existingAssignments,
  );
  return room;
}

export interface DriveModificationInfo {
  modifiedTime: string;
  lastModifyingUser?: {
    emailAddress?: string;
    displayName?: string;
  };
}

/** ตรวจสอบเวลาแก้ไขล่าสุดและผู้แก้ไขล่าสุดของไฟล์ Google Sheet บน Google Drive */
export async function getDriveFileModificationInfo(fileId: string): Promise<DriveModificationInfo | null> {
  if (!fileId || !getAuthState().signedIn) return null;
  const fields = encodeURIComponent('modifiedTime,lastModifyingUser(emailAddress,displayName)');
  return gfetch<DriveModificationInfo>(`${DRIVE}/${encodeURIComponent(fileId)}?fields=${fields}`);
}

// ---------------- Drive appDataFolder ----------------
async function findAppDataFileByName(fileName: string): Promise<string | null> {
  const escaped = fileName.replace(/'/g, "\\'");
  const q = encodeURIComponent(`name='${escaped}' and trashed=false`);
  const j = await gfetch<{ files?: { id: string; modifiedTime?: string }[] }>(
    `${DRIVE}?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)&pageSize=10`,
  );
  const files = (j.files ?? []).slice().sort((a, b) => (b.modifiedTime ?? '').localeCompare(a.modifiedTime ?? ''));
  return files[0]?.id ?? null;
}

async function readAppDataJson<T>(fileId: string): Promise<T | null> {
  try {
    return await gfetch<T>(`${DRIVE}/${encodeURIComponent(fileId)}?alt=media`);
  } catch {
    return null;
  }
}

async function writeAppDataJson(fileName: string, fileId: string | null, payload: unknown): Promise<string> {
  const body = JSON.stringify(payload);
  if (fileId) {
    await gfetch(`${DRIVE_UPLOAD}/${encodeURIComponent(fileId)}?uploadType=media`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    return fileId;
  }
  const boundary = `eduplan${Date.now()}`;
  const multipart =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify({ name: fileName, parents: ['appDataFolder'], mimeType: 'application/json' }) +
    `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
  const j = await gfetch<{ id: string }>(`${DRIVE_UPLOAD}?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipart,
  });
  return j.id;
}

interface SharedRoomsManifest {
  version: 1;
  updatedAt: number;
  fileIds: string[];
}

let sharedManifestQueue: Promise<unknown> = Promise.resolve();
function withSharedManifestLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = sharedManifestQueue.then(fn, fn);
  sharedManifestQueue = run.catch(() => undefined);
  return run;
}

async function loadSharedRoomsManifest(): Promise<{ appFileId: string | null; fileIds: string[] }> {
  const appFileId = await findAppDataFileByName(SHARED_ROOMS_APPDATA_FILE);
  if (!appFileId) return { appFileId: null, fileIds: [] };
  const data = await readAppDataJson<Partial<SharedRoomsManifest>>(appFileId);
  const raw = Array.isArray(data?.fileIds) ? data.fileIds : [];
  const fileIds = Array.from(
    new Set(raw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim())),
  );
  return { appFileId, fileIds };
}

async function saveSharedRoomsManifest(appFileId: string | null, fileIds: string[]): Promise<string> {
  const cleanIds = Array.from(
    new Set(fileIds.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim())),
  );
  const payload: SharedRoomsManifest = {
    version: 1,
    updatedAt: Date.now(),
    fileIds: cleanIds,
  };
  return writeAppDataJson(SHARED_ROOMS_APPDATA_FILE, appFileId, payload);
}

async function addSharedRoomIdToAppData(fileId: string): Promise<void> {
  const fid = fileId.trim();
  if (!fid || !getAuthState().signedIn) return;
  await withSharedManifestLock(async () => {
    const { appFileId, fileIds } = await loadSharedRoomsManifest();
    if (appFileId && fileIds.includes(fid)) return;
    await saveSharedRoomsManifest(appFileId, [...fileIds, fid]);
  });
}

async function removeSharedRoomIdFromAppData(fileId: string): Promise<void> {
  const fid = fileId.trim();
  if (!fid || !getAuthState().signedIn) return;
  await withSharedManifestLock(async () => {
    const { appFileId, fileIds } = await loadSharedRoomsManifest();
    if (!appFileId) return;
    const next = fileIds.filter((id) => id !== fid);
    if (next.length !== fileIds.length) {
      await saveSharedRoomsManifest(appFileId, next);
    }
  });
}

async function findAppDataFile(): Promise<string | null> {
  return findAppDataFileByName(APPDATA_FILE);
}

async function readAppData(fileId: string): Promise<SyncSnapshot | null> {
  const j = await readAppDataJson<SyncSnapshot>(fileId);
  return j && j.version === 1 ? j : null;
}

async function writeAppData(fileId: string | null, snap: SyncSnapshot): Promise<string> {
  return writeAppDataJson(APPDATA_FILE, fileId, snap);
}

export type SyncStatus = { state: 'idle' | 'syncing' | 'ok' | 'error'; at: number | null; message: string };
let syncStatus: SyncStatus = { state: 'idle', at: null, message: '' };
const syncListeners = new Set<(s: SyncStatus) => void>();
export function onSyncStatus(fn: (s: SyncStatus) => void): () => void {
  syncListeners.add(fn);
  fn(syncStatus);
  return () => syncListeners.delete(fn);
}
function setSyncStatus(s: SyncStatus): void {
  syncStatus = s;
  syncListeners.forEach((fn) => fn(s));
}

let appDataRunning: Promise<number> | null = null;
/** ดึงไฟล์ตั้งค่าจาก appDataFolder -> รวมกับเครื่อง -> อัปโหลดกลับ */
export function syncAppData(): Promise<number> {
  if (appDataRunning) return appDataRunning;
  appDataRunning = (async () => {
    setSyncStatus({ ...syncStatus, state: 'syncing', message: 'กำลังซิงก์ข้อมูลกับ Google Drive...' });
    try {
      const fileId = await findAppDataFile();
      let changed = 0;
      if (fileId) {
        const remote = await readAppData(fileId);
        if (remote) changed = await mergeSyncSnapshot(remote);
      }
      const snap = await buildSyncSnapshot();
      await writeAppData(fileId, snap);
      setSyncStatus({ state: 'ok', at: Date.now(), message: 'ซิงก์ล่าสุด' });
      return changed;
    } catch (e) {
      setSyncStatus({ state: 'error', at: syncStatus.at, message: e instanceof Error ? e.message : String(e) });
      throw e;
    } finally {
      appDataRunning = null;
    }
  })();
  return appDataRunning;
}

let appDataTimer: number | undefined;
/** ตั้งเวลาซิงก์ appData แบบ debounce หลังมีการแก้ไขห้องที่ซิงก์ออนไลน์ */
export function scheduleAppDataSync(delay = 2500): void {
  if (!getAuthState().signedIn) return;
  window.clearTimeout(appDataTimer);
  appDataTimer = window.setTimeout(() => {
    syncAppData().catch(() => undefined);
  }, delay);
}

/** ปุ่ม "ซิงก์ข้อมูล": appData + ซิงก์ห้องเรียนร่วม + ส่งข้อมูลค้างขึ้น Google Sheet */
export async function fullSync(): Promise<{ changed: number; errors: string[] }> {
  const changed = await syncAppData();
  const errors: string[] = [];
  try {
    await fetchSharedClassrooms();
  } catch (e) {
    errors.push(`ค้นหาห้องเรียนร่วม: ${e instanceof Error ? e.message : String(e)}`);
  }
  const rooms = (await listClassrooms()).filter((c) => c.syncMode === 'google' && c.sheet);
  for (const r of rooms) {
    if (r.role === 'viewer') continue;
    try {
      await pushClassroom(r.id);
    } catch (e) {
      errors.push(`${r.subject || r.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { changed, errors };
}

// ---------------- Google Picker ----------------
let pickerReady: Promise<void> | null = null;
function loadPicker(): Promise<void> {
  if (pickerReady) return pickerReady;
  pickerReady = (async () => {
    await loadScript('https://apis.google.com/js/api.js');
    await new Promise<void>((resolve, reject) => {
      if (!window.gapi) return reject(new Error('Google API (gapi) ไม่พร้อมใช้งาน'));
      window.gapi.load('picker', { callback: () => resolve(), onerror: () => reject(new Error('โหลด Google Picker ไม่สำเร็จ')) });
    });
  })().catch((e) => {
    pickerReady = null;
    throw e;
  });
  return pickerReady;
}

/** เปิดหน้าต่างเลือกไฟล์ Google Sheet จาก Drive (ไฟล์ที่เลือกจะได้รับสิทธิ์ drive.file) */
export async function pickSpreadsheet(opts?: { sharedOnly?: boolean; title?: string }): Promise<{ id: string; name: string } | null> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('ยังไม่ได้ตั้งค่า VITE_GOOGLE_API_KEY จึงเปิด Google Picker ไม่ได้');
  const token = await ensureToken();
  await loadPicker();
  const gp = window.google?.picker;
  if (!gp) throw new Error('Google Picker ไม่พร้อมใช้งาน');
  return new Promise((resolve) => {
    const builder = new gp.PickerBuilder()
      .setOAuthToken(token)
      .setDeveloperKey(apiKey)
      .setLocale('th')
      .setTitle(opts?.title ?? 'เลือกไฟล์ Google Sheet รายชื่อนักเรียน')
      .setCallback((data: { action: string; docs?: { id: string; name: string }[] }) => {
        if (data.action === gp.Action.PICKED && data.docs?.[0]) resolve({ id: data.docs[0].id, name: data.docs[0].name });
        else if (data.action === gp.Action.CANCEL) resolve(null);
      });
    if (opts?.sharedOnly) {
      const sharedView = new gp.DocsView(gp.ViewId.SPREADSHEETS)
        .setMimeTypes('application/vnd.google-apps.spreadsheet')
        .setOwnedByMe(false)
        .setMode(gp.DocsViewMode.LIST)
        .setIncludeFolders(false);
      if (typeof sharedView.setLabel === 'function') sharedView.setLabel('แชร์กับฉัน');
      builder.addView(sharedView);
    }
    const allView = new gp.DocsView(gp.ViewId.SPREADSHEETS)
      .setMimeTypes('application/vnd.google-apps.spreadsheet')
      .setMode(gp.DocsViewMode.LIST)
      .setIncludeFolders(false);
    if (typeof allView.setLabel === 'function') allView.setLabel('สเปรดชีตทั้งหมด');
    builder.addView(allView);
    const appId = getAppId();
    if (/^\d+$/.test(appId)) builder.setAppId(appId);
    builder.build().setVisible(true);
  });
}

/** รับห้องเรียนที่ถูกแชร์ผ่าน Google Picker แล้วบันทึกลง Dexie และ eduplan_shared_rooms.json */
export async function importSharedRoomViaPicker(): Promise<Classroom | null> {
  const auth = getAuthState();
  if (!auth.signedIn) throw new Error('กรุณาเข้าสู่ระบบด้วย Google ก่อน');
  const picked = await pickSpreadsheet({
    sharedOnly: true,
    title: 'เลือกไฟล์ Google Sheet ห้องเรียนที่เพื่อนแชร์มาให้คุณ',
  });
  if (!picked) return null;

  const meta = await gfetch<SharedDriveFile & { trashed?: boolean }>(
    `${DRIVE}/${encodeURIComponent(picked.id)}?fields=${encodeURIComponent('id,name,modifiedTime,owners(emailAddress,displayName),properties,trashed,capabilities(canEdit)')}`,
  );
  if (meta.trashed) {
    throw new Error('ไฟล์ Google Sheet นี้อยู่ในถังขยะบน Google Drive แล้ว');
  }
  const myEmail = (auth.profile?.email ?? '').toLowerCase().trim();
  const ownerEmail = (meta.owners?.[0]?.emailAddress ?? '').toLowerCase().trim();
  const collabs = parseCollaboratorsFromProperties(meta.properties);
  const myEntry = myEmail ? collabs.find((c) => c.email.toLowerCase().trim() === myEmail) : undefined;

  const existingAll = await listClassrooms();
  const existingOwned = existingAll.find(
    (r) => (!r.role || r.role === 'owner') && (r.sheet?.spreadsheetId === meta.id || r.sheetId === meta.id),
  );
  if (existingOwned) {
    return pullClassroomFromSheet(existingOwned);
  }

  let role: ClassroomRole;
  if (myEmail && ownerEmail && ownerEmail === myEmail) {
    role = 'owner';
  } else if (myEntry) {
    role = myEntry.role;
  } else {
    role = meta.capabilities?.canEdit ? 'assistant' : 'viewer';
  }

  const prevShared = existingAll.find((r) => r.id === `shared_${meta.id}`);
  const isShared = role !== 'owner';
  const room = isShared
    ? buildSharedRoomObject(meta, role, collabs, prevShared, true)
    : {
        id: uid(),
        name: meta.properties?.eduplan_room_name || meta.name,
        subject: meta.properties?.eduplan_subject || meta.name,
        term: currentTerm(),
        academicYear: currentAcademicYear(),
        syncMode: 'google' as const,
        sheetId: meta.id,
        isSharedWithMe: false,
        role: 'owner' as const,
        collaborators: collabs,
        lastModifiedTime: meta.modifiedTime,
        sheet: {
          spreadsheetId: meta.id,
          spreadsheetName: meta.name,
          spreadsheetUrl: safeHttpsUrl(`https://docs.google.com/spreadsheets/d/${encodeURIComponent(meta.id)}/edit`),
          standard: true,
          roster: {
            sheetTitle: STANDARD_TABS.roster,
            mapping: { headerRow: 0, number: 0, code: 1, nameMode: 'single' as const, name: 2, prefix: null, first: null, last: null },
          },
          attendance: { sheetTitle: STANDARD_TABS.attendance, headerRow: 1, keyCol: 1, keyType: 'order' as const, startCol: 3, mode: 'append' as const, fixedCount: 0 },
          assignments: { sheetTitle: STANDARD_TABS.assignments, headerRow: 1, keyCol: 1, keyType: 'order' as const, startCol: 3 },
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

  await saveClassroom(room);
  if (isShared) {
    await addSharedRoomIdToAppData(meta.id);
  } else {
    scheduleAppDataSync(0);
  }
  return pullClassroomFromSheet(room);
}

/** โหลดทุกแท็บของ Spreadsheet เป็นตาราง string[][] (ใช้กับ ColumnMapper) */
export async function loadSheetGrid(spreadsheetId: string, sheetTitle: string): Promise<string[][]> {
  const grid = await getValues(spreadsheetId, quoteSheet(sheetTitle));
  return grid.slice(0, 2000).map((r) => r.slice(0, 40));
}

