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
  normalizeKey,
  safeHttpsUrl,
  sessionHeaderText,
  sortAssignments,
  sortSessions,
  todayISO,
  uid,
  type Assignment,
  type AttendanceSession,
  type AttendanceStatus,
  type Classroom,
  type ClassroomRole,
  type Collaborator,
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
    attendance: isAssistant && remoteMeta ? remoteMeta.attendance : c.sheet.attendance,
    assignments: isAssistant && remoteMeta ? remoteMeta.assignments : c.sheet.assignments,
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
  await syncClassroomDriveProperties({ ...c, sheet: mapping }).catch(() => undefined);
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

/** เขียนข้อมูลทั้งหมดลงไฟล์มาตรฐานใหม่ทั้งหมด (ใช้เฉพาะตอนสร้างไฟล์ครั้งแรกหรืออัปเดตรายชื่อ Master Roster) */
async function pushStandardAll(c: Classroom): Promise<void> {
  const sheet = c.sheet!;
  const id = sheet.spreadsheetId;
  const [students, sessionsRaw, assignmentsRaw] = await Promise.all([getStudents(c.id), getSessions(c.id), getAssignments(c.id)]);
  const sessions = sortSessions(sessionsRaw);
  const assignments = sortAssignments(assignmentsRaw);
  const rows = students.length + 1;
  const T = STANDARD_TABS;

  await ensureGrid(id, T.roster, rows + 5, 3);
  await ensureGrid(id, T.attendance, rows + 5, 3 + sessions.length + 1);
  await ensureGrid(id, T.assignments, rows + 5, 3 + assignments.length + 1);

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
    ...sessions.map((s, i) => markSessionSync(s.id, { sheetSynced: true, sheetColumn: 3 + i })),
    ...assignments.map((a, i) => markAssignmentSync(a.id, { sheetSynced: true, sheetColumn: 3 + i })),
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

async function pushCustomColumn(
  c: Classroom,
  kind: 'attendance' | 'assignments',
  item: AttendanceSession | Assignment,
  header: string,
  cell: (studentId: string) => string | number,
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

  let col = item.sheetColumn;
  if (col === null || col === undefined) {
    const others = kind === 'attendance' ? await getSessions(c.id) : await getAssignments(c.id);
    const usedLocal = others
      .filter((o) => o.id !== item.id && o.sheetColumn !== null && o.sheetColumn !== undefined)
      .map((o) => o.sheetColumn!);
    const usedLocalSet = new Set(usedLocal);
    let matchedCol: number | null = null;
    const usedRemote: number[] = [];
    try {
      const hVals = await getValues(sheet.spreadsheetId, `${quoteSheet(m.sheetTitle)}!${m.headerRow}:${m.headerRow}`);
      const hRow = hVals[0] ?? [];
      for (let cIdx = m.startCol; cIdx < hRow.length; cIdx++) {
        const hv = (hRow[cIdx] ?? '').trim();
        if (!hv) continue;
        if (hv === header.trim() && !usedLocalSet.has(cIdx)) {
          matchedCol = cIdx;
          break;
        }
        usedRemote.push(cIdx);
      }
    } catch {
      /* ignore header inspect error */
    }
    if (matchedCol !== null) {
      col = matchedCol;
    } else {
      const allUsed = [...usedLocal, ...usedRemote];
      col = allUsed.length ? Math.max(m.startCol - 1, ...allUsed) + 1 : m.startCol;
    }
  }
  if (kind === 'attendance' && sheet.attendance?.mode === 'fixed' && sheet.attendance.fixedCount > 0) {
    const limit = sheet.attendance.startCol + sheet.attendance.fixedCount;
    if (col >= limit) {
      throw new Error(
        `ช่องเช็คชื่อเต็มแล้ว (กำหนดไว้ ${sheet.attendance.fixedCount} ช่อง ถึงคอลัมน์ ${colToLetter(limit - 1)}) — เพิ่มจำนวนช่องในแท็บ "ตั้งค่าตารางและคอลัมน์"`,
      );
    }
  }

  const students = await getStudents(c.id);
  const { rows, unmatched } = await resolveRows(sheet.spreadsheetId, m.sheetTitle, m.headerRow, m.keyCol, m.keyType, students);
  const maxRow = Math.max(m.headerRow, ...rows.values());
  await ensureGrid(sheet.spreadsheetId, m.sheetTitle, maxRow + 1, col + 1);

  const L = colToLetter(col);
  const q = quoteSheet(m.sheetTitle);
  const data: { range: string; values: (string | number)[][] }[] = [];

  // หากเป็นไฟล์มาตรฐาน ให้แน่ใจว่าคอลัมน์ A-C (รายชื่อ) มีอยู่ครบโดยไม่แตะคอลัมน์อื่น
  if (sheet.standard && m.keyType === 'order' && m.headerRow === 1) {
    const base = ['เลขที่', 'รหัสนักเรียน', 'ชื่อ-สกุล'];
    data.push({ range: `${q}!A1:C${students.length + 1}`, values: [base, ...rosterBlock(students)] });
  }

  if (m.keyType === 'order') {
    const colValues: (string | number)[][] = [[header], ...students.map((s) => [cell(s.id)])];
    data.push({ range: `${q}!${L}${m.headerRow}:${L}${m.headerRow + students.length}`, values: colValues });
  } else {
    data.push({ range: `${q}!${L}${m.headerRow}`, values: [[header]] });
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
  return { written: rows.size, unmatched: unmatched.map((s) => s.fullName), column: L };
}

// ---------------- Public push API ----------------
function canSync(c: Classroom | undefined): c is Classroom & { sheet: SheetMapping } {
  return !!c && c.syncMode === 'google' && !!c.sheet && getAuthState().signedIn;
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

export async function pushAssignment(classroomId: string, a: Assignment): Promise<PushResult | null> {
  const c = await getClassroom(classroomId);
  if (!canSync(c)) return null;
  if (!c.sheet.standard && !c.sheet.assignments) return null;
  await markAssignmentSync(a.id, { sheetSynced: false });
  const res = await pushCustomColumn(c, 'assignments', a, assignmentHeader(a), (sid) => assignmentCell(a, sid));
  await syncSpreadsheetSyncMeta(c).catch((err) => console.warn('[EduPlan Class] syncSpreadsheetSyncMeta warning:', err));
  return res;
}

/** ไฟล์มาตรฐาน: อัปเดตรายชื่อและคอลัมน์ / ไฟล์เดิม: เขียนเฉพาะรายการที่ยังไม่ซิงก์ */
export async function pushClassroom(classroomId: string): Promise<void> {
  const c = await getClassroom(classroomId);
  if (!canSync(c)) return;
  if (c.sheet.standard) {
    await pushStandardAll(c);
    await syncSpreadsheetSyncMeta(c).catch((err) => console.warn('[EduPlan Class] syncSpreadsheetSyncMeta warning:', err));
    await syncClassroomDriveProperties(c).catch(() => undefined);
    return;
  }
  if (c.sheet.attendance) {
    for (const s of sortSessions(await getSessions(c.id))) {
      if (!s.sheetSynced) await pushCustomColumn(c, 'attendance', s, sessionHeaderText(s), (sid) => attendanceCell(s, sid));
    }
  }
  if (c.sheet.assignments) {
    for (const a of sortAssignments(await getAssignments(c.id))) {
      if (!a.sheetSynced) await pushCustomColumn(c, 'assignments', a, assignmentHeader(a), (sid) => assignmentCell(a, sid));
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
      assignments: { sheetTitle: STANDARD_TABS.assignments, headerRow: 1, keyCol: 1, keyType: 'order', startCol: 3 },
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

/** ค้นหาห้องเรียนที่ถูกแชร์มาให้ผู้ใช้ปัจจุบันผ่าน Google Drive API v3 (กรอง eduplan_type & collab_1..5 ฝั่ง JS) */
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

  const q = encodeURIComponent("sharedWithMe = true and trashed = false and mimeType = 'application/vnd.google-apps.spreadsheet'");
  const fields = encodeURIComponent('nextPageToken,files(id,name,modifiedTime,owners(emailAddress,displayName),properties,capabilities(canEdit))');

  const files: SharedDriveFile[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 3; page++) {
    const tokenParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
    const res = await gfetch<{ files?: SharedDriveFile[]; nextPageToken?: string }>(
      `${DRIVE}?q=${q}&fields=${fields}&pageSize=100${tokenParam}`,
    );
    if (res.files?.length) files.push(...res.files);
    pageToken = res.nextPageToken;
    if (!pageToken) break;
  }

  const existingAll = await listClassrooms();
  const activeSharedIds = new Set<string>();
  const sharedRooms: Classroom[] = [];

  for (const f of files) {
    const roomId = `shared_${f.id}`;
    const prev = existingAll.find((r) => r.id === roomId);
    const collabs = parseCollaboratorsFromProperties(f.properties);
    const myEntry = collabs.find((c) => c.email.toLowerCase().trim() === myEmail);
    const isEduplanSheet = f.properties?.eduplan_type === 'classroom';

    let resolvedRole: ClassroomRole | null = null;
    if (isEduplanSheet && myEntry) {
      resolvedRole = myEntry.role;
    } else if (prev?.importedViaPicker) {
      resolvedRole = myEntry?.role ?? (f.capabilities?.canEdit ? 'assistant' : 'viewer');
    }
    if (!resolvedRole) continue;

    activeSharedIds.add(roomId);
    const room = buildSharedRoomObject(f, resolvedRole, collabs, prev);
    if (sharedRoomMetaChanged(prev, room)) {
      await saveClassroom(room);
    }
    sharedRooms.push(room);
  }

  // กรณีห้องที่รับผ่าน Picker เพิ่งถูกแชร์ใหม่และยังไม่ขึ้นในดัชนี sharedWithMe ให้ตรวจสิทธิ์ไฟล์โดยตรงก่อนตัดออก
  const pendingPickerRooms = existingAll.filter((prev) => prev.importedViaPicker && !activeSharedIds.has(prev.id));
  await Promise.all(
    pendingPickerRooms.map(async (prev) => {
      const fid = prev.sheet?.spreadsheetId ?? prev.sheetId;
      if (!fid) return;
      try {
        const direct = await gfetch<SharedDriveFile & { trashed?: boolean }>(
          `${DRIVE}/${encodeURIComponent(fid)}?fields=${encodeURIComponent('id,name,trashed,modifiedTime,owners(emailAddress,displayName),properties,capabilities(canEdit)')}`,
        );
        if (direct && !direct.trashed) {
          const collabs = parseCollaboratorsFromProperties(direct.properties);
          const myEntry = collabs.find((c) => c.email.toLowerCase().trim() === myEmail);
          const role: ClassroomRole = myEntry?.role ?? (direct.capabilities?.canEdit ? 'assistant' : 'viewer');
          const room = buildSharedRoomObject(direct, role, collabs, prev, true);
          activeSharedIds.add(prev.id);
          if (sharedRoomMetaChanged(prev, room)) {
            await saveClassroom(room);
          }
          sharedRooms.push(room);
        }
      } catch {
        /* revoked or deleted -> purge cleanly */
      }
    }),
  );

  await purgeStaleSharedClassrooms(activeSharedIds);
  return sharedRooms;
}

export const fetchSharedClassroomsFromDrive = fetchSharedClassrooms;

/** ถอนสิทธิ์ตนเองออกจากห้องเรียนร่วม (ปุ่ม ออกจากห้องร่วม) */
export async function leaveSharedClassroom(room: Classroom): Promise<void> {
  const auth = getAuthState();
  const myEmail = auth.profile?.email?.trim().toLowerCase();
  const fileId = room.sheet?.spreadsheetId;

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

  if (syncMeta) {
    if (syncMeta.name) room.name = syncMeta.name;
    if (syncMeta.subject) room.subject = syncMeta.subject;
    if (syncMeta.term) room.term = syncMeta.term;
    if (syncMeta.academicYear) room.academicYear = syncMeta.academicYear;
    if (syncMeta.attendanceHeaderMode) room.attendanceHeaderMode = syncMeta.attendanceHeaderMode;
    room.sheet = {
      spreadsheetId,
      spreadsheetName: meta.title || room.sheet!.spreadsheetName,
      spreadsheetUrl: safeHttpsUrl(meta.url) || room.sheet!.spreadsheetUrl,
      standard: syncMeta.standard,
      roster: syncMeta.roster,
      attendance: syncMeta.attendance,
      assignments: syncMeta.assignments,
    };
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
  } else if (room.sheet) {
    const firstSheet = meta.sheets[0];
    const firstTab = firstSheet?.title ?? 'Sheet1';
    room.sheet.spreadsheetName = meta.title || room.sheet.spreadsheetName;
    room.sheet.spreadsheetUrl = safeHttpsUrl(meta.url) || room.sheet.spreadsheetUrl;
    room.sheet.standard = false;
    if (room.sheet.attendance && !sheetTitles.has(room.sheet.attendance.sheetTitle)) {
      room.sheet.attendance = null;
    }
    if (room.sheet.assignments && !sheetTitles.has(room.sheet.assignments.sheetTitle)) {
      room.sheet.assignments = null;
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

    for (let col = attMap.startCol; col < headers.length; col++) {
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

    for (let col = asgMap.startCol; col < headers.length; col++) {
      if (restrictCustomCols && !syncAsgByCol.has(col)) continue;
      const hText = (headers[col] ?? '').trim();
      const metaAsg = syncAsgByCol.get(col);
      if (!hText && !metaAsg) continue;
      const headerParsed = parseAssignmentHeaderLabel(hText);
      const title = metaAsg?.title || headerParsed.title;
      const maxScore = metaAsg ? metaAsg.maxScore : headerParsed.maxScore;

      const submissions: Record<string, Submission> = {};
      finalStudents.forEach((st) => {
        const rIdx = asgRowMap.get(st.id);
        if (rIdx === undefined) {
          submissions[st.id] = { status: 'missing', score: null };
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
async function findAppDataFile(): Promise<string | null> {
  const q = encodeURIComponent(`name='${APPDATA_FILE}' and trashed=false`);
  const j = await gfetch<{ files?: { id: string }[] }>(`${DRIVE}?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)&pageSize=10`);
  return j.files?.[0]?.id ?? null;
}

async function readAppData(fileId: string): Promise<SyncSnapshot | null> {
  try {
    const j = await gfetch<SyncSnapshot>(`${DRIVE}/${fileId}?alt=media`);
    return j && j.version === 1 ? j : null;
  } catch {
    return null;
  }
}

async function writeAppData(fileId: string | null, snap: SyncSnapshot): Promise<string> {
  const body = JSON.stringify(snap);
  if (fileId) {
    await gfetch(`${DRIVE_UPLOAD}/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    return fileId;
  }
  const boundary = `eduplan${Date.now()}`;
  const multipart =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify({ name: APPDATA_FILE, parents: ['appDataFolder'], mimeType: 'application/json' }) +
    `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
  const j = await gfetch<{ id: string }>(`${DRIVE_UPLOAD}?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipart,
  });
  return j.id;
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
        .setOwnedByMe(false)
        .setMode(gp.DocsViewMode.LIST)
        .setIncludeFolders(false);
      builder.addView(sharedView);
    }
    const allView = new gp.DocsView(gp.ViewId.SPREADSHEETS).setMode(gp.DocsViewMode.LIST).setIncludeFolders(false);
    builder.addView(allView);
    const appId = getAppId();
    if (/^\d+$/.test(appId)) builder.setAppId(appId);
    builder.build().setVisible(true);
  });
}

/** รับห้องเรียนที่ถูกแชร์ผ่าน Google Picker เมื่อยังไม่แสดงอัตโนมัติ */
export async function importSharedRoomViaPicker(): Promise<Classroom | null> {
  const auth = getAuthState();
  if (!auth.signedIn) throw new Error('กรุณาเข้าสู่ระบบด้วย Google ก่อน');
  const picked = await pickSpreadsheet({
    sharedOnly: true,
    title: 'เลือกไฟล์ Google Sheet ห้องเรียนที่เพื่อนแชร์มาให้คุณ',
  });
  if (!picked) return null;

  const meta = await gfetch<SharedDriveFile>(
    `${DRIVE}/${encodeURIComponent(picked.id)}?fields=${encodeURIComponent('id,name,modifiedTime,owners(emailAddress,displayName),properties,capabilities(canEdit)')}`,
  );
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
  return pullClassroomFromSheet(room);
}

/** โหลดทุกแท็บของ Spreadsheet เป็นตาราง string[][] (ใช้กับ ColumnMapper) */
export async function loadSheetGrid(spreadsheetId: string, sheetTitle: string): Promise<string[][]> {
  const grid = await getValues(spreadsheetId, quoteSheet(sheetTitle));
  return grid.slice(0, 2000).map((r) => r.slice(0, 40));
}

