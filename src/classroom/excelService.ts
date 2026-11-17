// ============================================================
// EDUPLAN Classroom — Excel Service (ExcelJS)
// อ่าน .xlsx (Dynamic Header Row + Merged Cells) และส่งออก .xlsx 3 แท็บ
// ============================================================
import { saveAs } from 'file-saver';
import type { Workbook, Worksheet, Cell } from 'exceljs';
import {
  ATTENDANCE_LABEL,
  SUBMISSION_LABEL,
  classroomTitle,
  formatThaiDate,
  sessionHeaderText,
  sortAssignments,
  sortSessions,
  type Assignment,
  type AttendanceSession,
  type Classroom,
  type ColumnMapping,
  type ParsedStudent,
  type SheetMerge,
  type Student,
} from './types';

async function loadExcelJS(): Promise<typeof import('exceljs')> {
  const mod = await import('exceljs');
  return ((mod as unknown as { default?: typeof import('exceljs') }).default ?? mod) as typeof import('exceljs');
}

export interface WorkbookSheet {
  name: string;
  rows: string[][];
  merges: SheetMerge[];
}

const MAX_ROWS = 2000;
const MAX_COLS = 40;

function cellText(cell: Cell): string {
  try {
    const t = cell.text;
    if (t !== undefined && t !== null) return String(t).trim();
  } catch {
    /* fallthrough */
  }
  const v = cell.value as unknown;
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toLocaleDateString('th-TH');
  if (typeof v === 'object') {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: string };
    if (o.richText) return o.richText.map((r) => r.text).join('').trim();
    if (o.text !== undefined) return String(o.text).trim();
    if (o.result !== undefined) return String(o.result).trim();
  }
  return String(v).trim();
}

/** อ่านไฟล์ .xlsx ทุกแท็บเป็นตาราง string[][] พร้อมตำแหน่งเซลล์ที่ Merge กัน */
export async function readWorkbook(file: File): Promise<WorkbookSheet[]> {
  if (!/\.xlsx$/i.test(file.name)) throw new Error('รองรับเฉพาะไฟล์ .xlsx (หากเป็น .xls ให้เปิดใน Excel แล้ว "บันทึกเป็น" .xlsx ก่อน)');
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(await file.arrayBuffer());
  } catch {
    throw new Error('อ่านไฟล์ Excel ไม่สำเร็จ — ไฟล์อาจเสียหายหรือมีรหัสผ่าน');
  }
  const out: WorkbookSheet[] = [];
  wb.eachSheet((ws: Worksheet) => {
    const rows: string[][] = [];
    const mergeMap = new Map<string, SheetMerge>();
    const rowCount = Math.min(ws.rowCount, MAX_ROWS);
    const colCount = Math.min(ws.columnCount, MAX_COLS);
    for (let r = 1; r <= rowCount; r++) {
      const row = ws.getRow(r);
      const vals: string[] = [];
      for (let c = 1; c <= colCount; c++) {
        const cell = row.getCell(c);
        if (cell.isMerged && cell.master) {
          const mr = Number(cell.master.row) - 1;
          const mc = Number(cell.master.col) - 1;
          const key = `${mr}:${mc}`;
          const cur = mergeMap.get(key);
          if (cur) {
            cur.endRowIndex = Math.max(cur.endRowIndex, r);
            cur.endColumnIndex = Math.max(cur.endColumnIndex, c);
          } else {
            mergeMap.set(key, {
              startRowIndex: mr,
              endRowIndex: r,
              startColumnIndex: mc,
              endColumnIndex: c,
            });
          }
          // เก็บค่าเฉพาะเซลล์ต้นทางของ Merge เพื่อไม่ให้ค่าซ้ำไปหลอกหัวตาราง
          vals.push(mr === r - 1 && mc === c - 1 ? cellText(cell) : '');
        } else {
          vals.push(cellText(cell));
        }
      }
      rows.push(vals);
    }
    while (rows.length && rows[rows.length - 1].every((v) => !v)) rows.pop();
    const merges = [...mergeMap.values()].filter(
      (m) => m.endRowIndex - m.startRowIndex > 1 || m.endColumnIndex - m.startColumnIndex > 1,
    );
    out.push({ name: ws.name, rows, merges });
  });
  if (!out.length) throw new Error('ไม่พบแท็บข้อมูลในไฟล์ Excel');
  return out;
}

// ---------------- Mapping helpers (ใช้ร่วมกับ ColumnMapper) ----------------
const KW = {
  number: /^(เลขที่|ที่|no\.?|number|ลำดับ|ลำดับที่)$/i,
  code: /(รหัส|เลขประจำตัว|student\s*id|^id$)/i,
  prefix: /(คำนำหน้า|prefix|title)/i,
  last: /(นามสกุล|surname|last\s*name)/i,
  first: /^(ชื่อ|ชื่อตัว|first\s*name|name)$/i,
  full: /(ชื่อ\s*-?\s*(นาม)?สกุล|ชื่อ-สกุล|ชื่อ\s*สกุล|full\s*name|ชื่อนักเรียน)/i,
};

/** ดึงชื่อหัวคอลัมน์ (รองรับกรณีหัวตาราง Merge แนวตั้งลงมา) */
export function getEffectiveHeaderRow(rows: string[][], headerRow: number, merges?: SheetMerge[]): string[] {
  const base = rows[headerRow] ?? [];
  const width = Math.max(base.length, ...(merges ?? []).map((m) => m.endColumnIndex));
  const result: string[] = [];
  for (let c = 0; c < width; c++) {
    let val = (base[c] ?? '').trim();
    if (!val && merges?.length) {
      const m = merges.find(
        (x) =>
          headerRow >= x.startRowIndex &&
          headerRow < x.endRowIndex &&
          c >= x.startColumnIndex &&
          c < x.endColumnIndex &&
          x.endColumnIndex - x.startColumnIndex === 1,
      );
      if (m) val = (rows[m.startRowIndex]?.[m.startColumnIndex] ?? '').trim();
    }
    result.push(val);
  }
  return result;
}

export function guessHeaderRow(rows: string[][], merges?: SheetMerge[]): number {
  const limit = Math.min(rows.length, 15);
  for (let i = 0; i < limit; i++) {
    const r = getEffectiveHeaderRow(rows, i, merges);
    const nonEmpty = r.filter(Boolean).length;
    if (nonEmpty < 2) continue;
    if (r.some((v) => /ชื่อ|name/i.test(v)) && r.some((v) => KW.number.test(v.trim()) || KW.code.test(v))) return i;
  }
  for (let i = 0; i < limit; i++) {
    const r = getEffectiveHeaderRow(rows, i, merges);
    if (r.filter(Boolean).length >= 2 && r.some((v) => /ชื่อ|name/i.test(v))) return i;
  }
  return 0;
}

export function guessMapping(rows: string[][], headerRow: number, merges?: SheetMerge[]): ColumnMapping {
  const h = getEffectiveHeaderRow(rows, headerRow, merges);
  const find = (re: RegExp, exclude: number[] = []): number | null => {
    const i = h.findIndex((v, idx) => !exclude.includes(idx) && v && re.test(v));
    return i >= 0 ? i : null;
  };
  const number = find(KW.number);
  const code = find(KW.code, number !== null ? [number] : []);
  const full = find(KW.full);
  const prefix = find(KW.prefix);
  const last = find(KW.last);
  const first = find(KW.first);
  const used = [number, code].filter((x): x is number => x !== null);
  if (full !== null && !(last !== null && last !== full)) {
    return { headerRow, number, code, nameMode: 'single', name: full, prefix: null, first: null, last: null };
  }
  if (first !== null && last !== null) {
    return { headerRow, number, code, nameMode: 'split', name: null, prefix, first, last };
  }
  const anyName = full ?? first ?? find(/ชื่อ|name/i, used);
  return { headerRow, number, code, nameMode: 'single', name: anyName, prefix: null, first: null, last: null };
}

export function applyMapping(rows: string[][], m: ColumnMapping): ParsedStudent[] {
  const out: ParsedStudent[] = [];
  const get = (r: string[], c: number | null): string => (c === null ? '' : (r[c] ?? '').trim());
  for (let i = m.headerRow + 1; i < rows.length; i++) {
    const r = rows[i];
    let fullName: string;
    if (m.nameMode === 'single') fullName = get(r, m.name);
    else {
      const first = `${get(r, m.prefix)}${get(r, m.first)}`;
      fullName = [first, get(r, m.last)].filter(Boolean).join(' ');
    }
    fullName = fullName.replace(/\s+/g, ' ').trim();
    if (!fullName) continue;
    out.push({ number: get(r, m.number) || String(out.length + 1), studentCode: get(r, m.code), fullName });
  }
  return out;
}

// ---------------- Export ----------------
const FONT = 'TH SarabunPSK';
const thin = { style: 'thin' as const, color: { argb: 'FF94A3B8' } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };

function styleTable(ws: Worksheet, headerRows: number[], bodyFrom: number, bodyTo: number, footerRows: number[]): void {
  const cols = ws.columnCount;
  const all = [...headerRows, ...footerRows];
  for (let r = Math.min(...all, bodyFrom); r <= Math.max(...all, bodyTo); r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= cols; c++) {
      const cell = row.getCell(c);
      cell.border = BORDER;
      cell.font = { name: FONT, size: 16, bold: headerRows.includes(r) || footerRows.includes(r) };
      cell.alignment = { vertical: 'middle', horizontal: c === 3 ? 'left' : 'center', wrapText: headerRows.includes(r) };
      if (headerRows.includes(r)) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
      else if (footerRows.includes(r)) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    }
  }
}

function addTitle(ws: Worksheet, text: string, span: number): void {
  ws.addRow([text]);
  ws.mergeCells(1, 1, 1, Math.max(span, 3));
  const c = ws.getCell(1, 1);
  c.font = { name: FONT, size: 20, bold: true };
  c.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 30;
}

export async function exportClassroomXlsx(
  c: Classroom,
  students: Student[],
  sessionsRaw: AttendanceSession[],
  assignmentsRaw: Assignment[],
): Promise<void> {
  const ExcelJS = await loadExcelJS();
  const wb: Workbook = new ExcelJS.Workbook();
  wb.creator = 'EDUPLAN Classroom';
  wb.created = new Date();
  const sessions = sortSessions(sessionsRaw);
  const assignments = sortAssignments(assignmentsRaw);
  const title = `${classroomTitle(c)} — ภาคเรียนที่ ${c.term}/${c.academicYear}`;
  const base = ['เลขที่', 'รหัสนักเรียน', 'ชื่อ-สกุล'];

  // ---- 1) รายชื่อนักเรียน ----
  const ws1 = wb.addWorksheet('รายชื่อนักเรียน', { views: [{ state: 'frozen', ySplit: 2 }] });
  addTitle(ws1, `รายชื่อนักเรียน ${title}`, 3);
  ws1.addRow(base);
  students.forEach((s) => ws1.addRow([s.number, s.studentCode, s.fullName]));
  ws1.addRow(['', 'รวม', `${students.length} คน`]);
  ws1.columns = [{ width: 9 }, { width: 18 }, { width: 38 }];
  styleTable(ws1, [2], 3, 2 + students.length, [3 + students.length]);

  // ---- 2) สรุปการมาเรียน ----
  const ws2 = wb.addWorksheet('สรุปการมาเรียน', { views: [{ state: 'frozen', ySplit: 2, xSplit: 3 }] });
  const attHead = [...base, ...sessions.map((s) => sessionHeaderText(s)), 'มา', 'ลา/ขาด', 'มาสาย'];
  addTitle(ws2, `สรุปการมาเรียน ${title}`, attHead.length);
  ws2.addRow(attHead);
  if (sessions.some((s) => sessionHeaderText(s).includes('\n'))) {
    ws2.getRow(2).height = 42;
  }
  students.forEach((st) => {
    let p = 0, a = 0, l = 0;
    const cells = sessions.map((s) => {
      const v = s.records[st.id];
      if (v === 'present') p++;
      else if (v === 'absent') a++;
      else if (v === 'late') l++;
      return v ? ATTENDANCE_LABEL[v] : '-';
    });
    const row = ws2.addRow([st.number, st.studentCode, st.fullName, ...cells, p, a, l]);
    sessions.forEach((s, i) => {
      const v = s.records[st.id];
      const color = v === 'present' ? 'FF15803D' : v === 'absent' ? 'FFB91C1C' : v === 'late' ? 'FFB45309' : 'FF94A3B8';
      row.getCell(4 + i).font = { name: FONT, size: 16, color: { argb: color } };
    });
  });
  const attFooter = (label: string, key: 'present' | 'absent' | 'late') => {
    const counts = sessions.map((s) => students.filter((st) => s.records[st.id] === key).length);
    const total = counts.reduce((x, y) => x + y, 0);
    ws2.addRow(['', '', `รวม ${label} (คน)`, ...counts, key === 'present' ? total : '', key === 'absent' ? total : '', key === 'late' ? total : '']);
  };
  attFooter('มา', 'present');
  attFooter('ลา/ขาด', 'absent');
  attFooter('มาสาย', 'late');
  ws2.columns = attHead.map((_, i) => ({ width: i === 0 ? 9 : i === 1 ? 16 : i === 2 ? 34 : 14 }));
  const f2 = 3 + students.length;
  styleTable(ws2, [2], 3, f2 - 1, [f2, f2 + 1, f2 + 2]);
  students.forEach((st, r) => {
    sessions.forEach((s, i) => {
      const v = s.records[st.id];
      const color = v === 'present' ? 'FF15803D' : v === 'absent' ? 'FFB91C1C' : v === 'late' ? 'FFB45309' : 'FF94A3B8';
      ws2.getRow(3 + r).getCell(4 + i).font = { name: FONT, size: 16, color: { argb: color } };
    });
  });

  // ---- 3) สรุปคะแนนและการส่งงาน ----
  const ws3 = wb.addWorksheet('สรุปคะแนนและการส่งงาน', { views: [{ state: 'frozen', ySplit: 2, xSplit: 3 }] });
  const asgHead = [
    ...base,
    ...assignments.map((a) => `${a.title}${a.maxScore ? ` (${a.maxScore})` : ''}\nส่ง ${formatThaiDate(a.dueDate)}`),
    'ส่งแล้ว',
    'ยังไม่ส่ง',
    'คะแนนรวม',
  ];
  addTitle(ws3, `สรุปคะแนนและการส่งงาน ${title}`, asgHead.length);
  ws3.addRow(asgHead);
  ws3.getRow(2).height = 44;
  students.forEach((st) => {
    let sent = 0, miss = 0, score = 0;
    const cells = assignments.map((a) => {
      const sub = a.submissions[st.id];
      const status = sub?.status ?? 'missing';
      if (status === 'submitted') sent++;
      else miss++;
      if (sub?.score !== null && sub?.score !== undefined && !Number.isNaN(sub.score)) {
        score += sub.score;
        return sub.score;
      }
      return SUBMISSION_LABEL[status];
    });
    ws3.addRow([st.number, st.studentCode, st.fullName, ...cells, sent, miss, score]);
  });
  const sentCounts = assignments.map((a) => students.filter((st) => a.submissions[st.id]?.status === 'submitted').length);
  ws3.addRow(['', '', 'รวม ส่งแล้ว (คน)', ...sentCounts, sentCounts.reduce((x, y) => x + y, 0), '', '']);
  const missCounts = sentCounts.map((n) => students.length - n);
  ws3.addRow(['', '', 'รวม ยังไม่ส่ง (คน)', ...missCounts, '', missCounts.reduce((x, y) => x + y, 0), '']);
  const scoreSums = assignments.map((a) =>
    students.reduce((sum, st) => {
      const sc = a.submissions[st.id]?.score;
      return sum + (sc !== null && sc !== undefined && !Number.isNaN(sc) ? sc : 0);
    }, 0),
  );
  ws3.addRow(['', '', 'คะแนนรวมทั้งห้อง', ...scoreSums, '', '', scoreSums.reduce((x, y) => x + y, 0)]);
  ws3.columns = asgHead.map((_, i) => ({ width: i === 0 ? 9 : i === 1 ? 16 : i === 2 ? 34 : 16 }));
  const f3 = 3 + students.length;
  styleTable(ws3, [2], 3, f3 - 1, [f3, f3 + 1, f3 + 2]);

  const buf = await wb.xlsx.writeBuffer();
  const safe = classroomTitle(c).replace(/[\\/:*?"<>|]/g, '-');
  saveAs(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `EDUPLAN_${safe}_${c.term}-${c.academicYear}.xlsx`,
  );
}
