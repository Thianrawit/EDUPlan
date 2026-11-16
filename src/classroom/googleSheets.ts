// ============================================================
// EDUPLAN Classroom — Google Sheets API, Drive appDataFolder Sync, Google Picker
// (ทำงานฝั่ง Browser ล้วน ผ่าน REST API + OAuth token จาก GIS)
// ============================================================
import { ensureToken, forceRefreshToken, getApiKey, getAppId, getAuthState, loadScript } from './googleAuth';
import {
  buildSyncSnapshot,
  getAssignments,
  getClassroom,
  getSessions,
  getStudents,
  listClassrooms,
  markAssignmentSync,
  markSessionSync,
  mergeSyncSnapshot,
  saveClassroom,
} from './db';
import {
  ATTENDANCE_LABEL,
  STANDARD_TABS,
  SUBMISSION_LABEL,
  colToLetter,
  normalizeKey,
  sessionLabel,
  sortAssignments,
  sortSessions,
  type Assignment,
  type AttendanceSession,
  type Classroom,
  type RowKeyType,
  type SheetMapping,
  type SheetMerge,
  type Student,
  type SyncSnapshot,
} from './types';

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const APPDATA_FILE = 'eduplan_classrooms.json';

// ---------------- fetch wrapper ----------------
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
    if (res.status === 404) msg += ' — ไม่พบไฟล์ (อาจถูกลบหรือไม่ได้เลือกผ่านแอปนี้)';
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export function quoteSheet(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

// ---------------- Spreadsheet primitives ----------------
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
  sheets: SheetInfo[];
}

interface RawMeta {
  spreadsheetId: string;
  spreadsheetUrl: string;
  properties: { title: string };
  sheets: {
    properties: { sheetId: number; title: string; gridProperties?: { rowCount?: number; columnCount?: number } };
    merges?: SheetMerge[];
  }[];
}

export async function getSpreadsheetMeta(spreadsheetId: string): Promise<SpreadsheetMeta> {
  const fields = 'spreadsheetId,spreadsheetUrl,properties.title,sheets(properties(sheetId,title,gridProperties),merges)';
  const j = await gfetch<RawMeta>(`${SHEETS}/${encodeURIComponent(spreadsheetId)}?fields=${encodeURIComponent(fields)}`);
  return {
    spreadsheetId: j.spreadsheetId,
    title: j.properties.title,
    url: j.spreadsheetUrl,
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

export async function getValues(spreadsheetId: string, range: string): Promise<string[][]> {
  const j = await gfetch<{ values?: unknown[][] }>(
    `${SHEETS}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`,
  );
  return (j.values ?? []).map((r) => r.map((c) => String(c ?? '')));
}

async function batchUpdateValues(spreadsheetId: string, data: { range: string; values: (string | number)[][] }[]): Promise<void> {
  if (!data.length) return;
  await gfetch(`${SHEETS}/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ valueInputOption: 'RAW', data }),
  });
}

async function clearValues(spreadsheetId: string, range: string): Promise<void> {
  await gfetch(`${SHEETS}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:clear`, {
    method: 'POST',
    body: '{}',
  });
}

async function batchUpdate(spreadsheetId: string, requests: unknown[]): Promise<void> {
  if (!requests.length) return;
  await gfetch(`${SHEETS}/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests }),
  });
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
  return {
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

/** เขียนข้อมูลทั้งหมดลงไฟล์มาตรฐานใหม่ทั้งหมด (รายชื่อ + การมาเรียน + การส่งงาน) */
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
  const att: (string | number)[][] = [[...base, ...sessions.map((s) => sessionLabel(s))]];
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

// ---------------- Custom (ไฟล์เดิมของครู) ----------------
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
  const m = kind === 'attendance' ? sheet.attendance : sheet.assignments;
  if (!m) throw new Error(kind === 'attendance' ? 'ยังไม่ได้ตั้งค่าแท็บ/คอลัมน์การมาเรียน' : 'ยังไม่ได้ตั้งค่าแท็บ/คอลัมน์การส่งงาน');

  let col = item.sheetColumn;
  if (col === null || col === undefined) {
    const others = kind === 'attendance' ? await getSessions(c.id) : await getAssignments(c.id);
    const used = others.filter((o) => o.id !== item.id && o.sheetColumn !== null && o.sheetColumn !== undefined).map((o) => o.sheetColumn!);
    col = used.length ? Math.max(m.startCol - 1, ...used) + 1 : m.startCol;
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
  const data: { range: string; values: (string | number)[][] }[] = [{ range: `${q}!${L}${m.headerRow}`, values: [[header]] }];
  for (const s of students) {
    const r = rows.get(s.id);
    if (r) data.push({ range: `${q}!${L}${r}`, values: [[cell(s.id)]] });
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
  if (c.sheet.standard) {
    await pushStandardAll(c);
    return { written: (await getStudents(c.id)).length, unmatched: [] };
  }
  if (!c.sheet.attendance) return null;
  await markSessionSync(session.id, { sheetSynced: false });
  return pushCustomColumn(c, 'attendance', session, sessionLabel(session), (sid) => attendanceCell(session, sid));
}

export async function pushAssignment(classroomId: string, a: Assignment): Promise<PushResult | null> {
  const c = await getClassroom(classroomId);
  if (!canSync(c)) return null;
  if (c.sheet.standard) {
    await pushStandardAll(c);
    return { written: (await getStudents(c.id)).length, unmatched: [] };
  }
  if (!c.sheet.assignments) return null;
  await markAssignmentSync(a.id, { sheetSynced: false });
  return pushCustomColumn(c, 'assignments', a, assignmentHeader(a), (sid) => assignmentCell(a, sid));
}

/** ไฟล์มาตรฐาน: เขียนใหม่ทั้งหมด / ไฟล์เดิม: เขียนเฉพาะรายการที่ยังไม่ซิงก์ */
export async function pushClassroom(classroomId: string): Promise<void> {
  const c = await getClassroom(classroomId);
  if (!canSync(c)) return;
  if (c.sheet.standard) {
    await pushStandardAll(c);
    return;
  }
  if (c.sheet.attendance) {
    for (const s of sortSessions(await getSessions(c.id))) {
      if (!s.sheetSynced) await pushCustomColumn(c, 'attendance', s, sessionLabel(s), (sid) => attendanceCell(s, sid));
    }
  }
  if (c.sheet.assignments) {
    for (const a of sortAssignments(await getAssignments(c.id))) {
      if (!a.sheetSynced) await pushCustomColumn(c, 'assignments', a, assignmentHeader(a), (sid) => assignmentCell(a, sid));
    }
  }
}

/** อัปเกรดห้อง Local -> สร้าง Google Sheet มาตรฐานใหม่และซิงก์ */
export async function upgradeToStandardSheet(classroomId: string): Promise<Classroom> {
  const c = await getClassroom(classroomId);
  if (!c) throw new Error('ไม่พบห้องเรียน');
  const sessions = await getSessions(c.id);
  const assignments = await getAssignments(c.id);
  c.sheet = await createStandardSpreadsheet(c);
  c.syncMode = 'google';
  await saveClassroom(c);
  await Promise.all([
    ...sessions.map((s) => markSessionSync(s.id, { sheetColumn: null, sheetSynced: false })),
    ...assignments.map((a) => markAssignmentSync(a.id, { sheetColumn: null, sheetSynced: false })),
  ]);
  await pushStandardAll(c);
  scheduleAppDataSync(0);
  return c;
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

/** ปุ่ม "ซิงก์ข้อมูล": appData + ส่งข้อมูลค้างทุกห้องขึ้น Google Sheet */
export async function fullSync(): Promise<{ changed: number; errors: string[] }> {
  const changed = await syncAppData();
  const errors: string[] = [];
  const rooms = (await listClassrooms()).filter((c) => c.syncMode === 'google' && c.sheet);
  for (const r of rooms) {
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
export async function pickSpreadsheet(): Promise<{ id: string; name: string } | null> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('ยังไม่ได้ตั้งค่า VITE_GOOGLE_API_KEY จึงเปิด Google Picker ไม่ได้');
  const token = await ensureToken();
  await loadPicker();
  const gp = window.google?.picker;
  if (!gp) throw new Error('Google Picker ไม่พร้อมใช้งาน');
  return new Promise((resolve) => {
    const view = new gp.DocsView(gp.ViewId.SPREADSHEETS).setMode(gp.DocsViewMode.LIST).setIncludeFolders(false);
    const builder = new gp.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(apiKey)
      .setLocale('th')
      .setTitle('เลือกไฟล์ Google Sheet รายชื่อนักเรียน')
      .setCallback((data: { action: string; docs?: { id: string; name: string }[] }) => {
        if (data.action === gp.Action.PICKED && data.docs?.[0]) resolve({ id: data.docs[0].id, name: data.docs[0].name });
        else if (data.action === gp.Action.CANCEL) resolve(null);
      });
    const appId = getAppId();
    if (/^\d+$/.test(appId)) builder.setAppId(appId);
    builder.build().setVisible(true);
  });
}

/** โหลดทุกแท็บของ Spreadsheet เป็นตาราง string[][] (ใช้กับ ColumnMapper) */
export async function loadSheetGrid(spreadsheetId: string, sheetTitle: string): Promise<string[][]> {
  const grid = await getValues(spreadsheetId, quoteSheet(sheetTitle));
  return grid.slice(0, 2000).map((r) => r.slice(0, 40));
}

