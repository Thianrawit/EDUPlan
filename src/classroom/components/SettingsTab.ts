// ============================================================
// EDUPLAN Classroom — แท็บตั้งค่าตารางและคอลัมน์
// (Sub-menu + Collapsible Sections + Auto-Renumber + Merged Cells & Edge Stroke Preview)
// ============================================================
import { getAssignments, getClassroom, getSessions, getStudents, markAssignmentSync, markSessionSync, replaceStudents, saveClassroom } from '../db';
import { readWorkbook } from '../excelService';
import { getAuthState } from '../googleAuth';
import {
  assignmentHeader,
  findNextAvailableAssignmentColumn,
  getSpreadsheetMeta,
  getValues,
  loadSheetGrid,
  pickSpreadsheet,
  pushClassroom,
  pushCustomRosterToSheet,
  quoteSheet,
  scheduleAppDataSync,
  syncClassroomDriveProperties,
  syncSpreadsheetSyncMeta,
  upgradeToStandardSheet,
  type SpreadsheetMeta,
} from '../googleSheets';
import {
  KEY_TYPE_LABEL,
  buildMergeLayout,
  colToLetter,
  errorMessage,
  escapeHtml,
  getEffectiveRole,
  getMergedCellValue,
  icon,
  normalizeKey,
  parseColumnIndex,
  safeHttpsUrl,
  sessionHeaderText,
  sortAssignments,
  sortSessions,
  uid,
  type AppContext,
  type AssignmentSheetMapping,
  type AttendanceSheetMapping,
  type Classroom,
  type ClassroomRole,
  type ParsedStudent,
  type RowKeyType,
  type Student,
} from '../types';
import { confirmDialog, openColumnMapper, openModal, toast, withBusy } from './ColumnMapperModal';

interface RosterRow {
  id: string;
  number: string;
  code: string;
  name: string;
}

type SettingsFilter = 'all' | 'roster' | 'google' | 'info';

function mergeRoster(existing: RosterRow[], incoming: ParsedStudent[], mode: 'replace' | 'append'): RosterRow[] {
  const byCode = new Map(existing.filter((r) => r.code.trim()).map((r) => [normalizeKey(r.code), r]));
  const byName = new Map(existing.map((r) => [normalizeKey(r.name), r]));
  const find = (p: ParsedStudent) => (p.studentCode && byCode.get(normalizeKey(p.studentCode))) || byName.get(normalizeKey(p.fullName));
  if (mode === 'replace') {
    const used = new Set<string>();
    return incoming.map((p) => {
      const old = find(p);
      const id = old && !used.has(old.id) ? old.id : uid();
      used.add(id);
      return { id, number: p.number, code: p.studentCode, name: p.fullName };
    });
  }
  const out = [...existing];
  for (const p of incoming) if (!find(p)) out.push({ id: uid(), number: p.number, code: p.studentCode, name: p.fullName });
  return out;
}

export async function renderSettings(
  root: HTMLElement,
  roomIn: Classroom,
  ctx: AppContext,
  currentRole: ClassroomRole = getEffectiveRole(roomIn),
): Promise<void> {
  if (currentRole !== 'owner' && currentRole !== 'creator') {
    ctx.openRoom(roomIn.id, 'attendance');
    return;
  }
  const isOwner = currentRole === 'owner';
  let room: Classroom = JSON.parse(JSON.stringify(roomIn)) as Classroom;
  const students = await getStudents(room.id);
  let roster: RosterRow[] = students.map((s) => ({ id: s.id, number: s.number, code: s.studentCode, name: s.fullName }));
  let rosterDirty = false;
  let meta: SpreadsheetMeta | null = null;
  let metaError = '';
  const valuesCache = new Map<string, string[][]>();
  let attMap: AttendanceSheetMapping | null = room.sheet?.attendance
    ? {
        ...room.sheet.attendance,
        headerRow: Math.max(1, Math.floor(Number(room.sheet.attendance.headerRow) || 1)),
        keyCol: parseColumnIndex(room.sheet.attendance.keyCol, 0),
        startCol: parseColumnIndex(room.sheet.attendance.startCol, 0),
        fixedCount: Math.max(0, Math.floor(Number(room.sheet.attendance.fixedCount) || 0)),
      }
    : null;
  let asgMap: AssignmentSheetMapping | null = room.sheet?.assignments
    ? {
        ...room.sheet.assignments,
        headerRow: Math.max(1, Math.floor(Number(room.sheet.assignments.headerRow) || 1)),
        keyCol: parseColumnIndex(room.sheet.assignments.keyCol, 0),
        startCol: parseColumnIndex(room.sheet.assignments.startCol, room.assignmentStartCol ?? 0),
        ...(Number(room.sheet.assignments.colsPerAssignment) === 2 ? { colsPerAssignment: 2 as const } : {}),
      }
    : null;
  let mapDirty = false;
  const sessions = sortSessions(await getSessions(room.id));
  const assignments = sortAssignments(await getAssignments(room.id));

  // สถานะเมนูย่อยและการย่อ/ขยายแต่ละส่วน
  const needsGoogleSetup = room.syncMode === 'google' && !!room.sheet && !room.sheet.standard && (!attMap || !asgMap);
  let activeFilter: SettingsFilter = needsGoogleSetup ? 'google' : 'all';
  let infoCollapsed = true;
  let attCollapsed = false;
  let asgCollapsed = false;
  let focusedField: string | null = null; // เช่น 'attendance.startCol', 'attendance.keyCol', 'attendance.headerRow'

  const getAuth = () => getAuthState();
  const markDirty = () => ctx.setDirty(rosterDirty || mapDirty);

  // ---------- Sub-navigation bar ----------
  const subNavHtml = () => {
    const items: { id: SettingsFilter; label: string; badge?: string; ic: Parameters<typeof icon>[0] }[] = [
      { id: 'all', label: 'แสดงทั้งหมด', ic: 'settings' },
      { id: 'roster', label: 'รายชื่อนักเรียน', badge: `${roster.length} คน`, ic: 'users' },
      { id: 'google', label: 'Google Sheet & คอลัมน์', badge: room.syncMode === 'google' ? 'ซิงก์' : 'Local', ic: 'spreadsheet' },
      { id: 'info', label: 'ข้อมูลห้องเรียน', ic: 'edit' },
    ];
    return `
      <div class="cr-subnav" role="navigation" aria-label="หมวดหมู่การตั้งค่า">
        ${items
          .map(
            (it) => `
          <button type="button" class="cr-subnav__btn ${activeFilter === it.id ? 'is-active' : ''}" data-filter="${it.id}">
            ${icon(it.ic, 15)}
            <span>${it.label}</span>
            ${it.badge ? `<span class="cr-subnav__badge">${escapeHtml(it.badge)}</span>` : ''}
          </button>`,
          )
          .join('')}
      </div>`;
  };

  // ---------- Section: info (Collapsible) ----------
  const infoHtml = () => {
    const open = activeFilter === 'info' || !infoCollapsed;
    return `
    <section class="cr-panel cr-collapsible ${open ? 'is-open' : ''}">
      <div class="cr-collapsible__head" data-toggle-info role="button" tabindex="0" aria-expanded="${open}">
        <div class="cr-collapsible__title">
          <span class="cr-collapsible__icon">${icon('edit', 17)}</span>
          <div>
            <h2 class="cr-h2">ข้อมูลพื้นฐานห้องเรียน</h2>
            <p class="cr-muted">${escapeHtml(room.subject || 'ไม่ระบุวิชา')} · ชั้น ${escapeHtml(room.name || '-')} · ภาคเรียนที่ ${escapeHtml(room.term || '-')}/${escapeHtml(room.academicYear || '-')}</p>
          </div>
        </div>
        <span class="cr-collapsible__chev">${icon(open ? 'chevron-down' : 'chevron-right', 18)}</span>
      </div>
      ${
        open
          ? `<div class="cr-collapsible__body">
              <form data-info-form class="cr-form-grid cr-form-grid--4">
                <label class="cr-field cr-span-2"><span class="cr-label">วิชา</span><input class="cr-input" name="subject" value="${escapeHtml(room.subject)}" /></label>
                <label class="cr-field cr-span-2"><span class="cr-label">ระดับชั้น/ห้อง</span><input class="cr-input" name="name" value="${escapeHtml(room.name)}" /></label>
                <label class="cr-field"><span class="cr-label">ภาคเรียน</span>
                  <select class="cr-input" name="term">${['1', '2', '3', 'ฤดูร้อน'].map((t) => `<option ${room.term === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
                <label class="cr-field"><span class="cr-label">ปีการศึกษา (พ.ศ.)</span><input class="cr-input" name="academicYear" inputmode="numeric" value="${escapeHtml(room.academicYear)}" /></label>
                <div class="cr-span-2 flex items-end justify-end">
                  <button type="submit" class="cr-btn cr-btn--primary">${icon('check', 16)}<span>บันทึกข้อมูลห้อง</span></button>
                </div>
              </form>
            </div>`
          : ''
      }
    </section>`;
  };

  // ---------- Section: roster (Master Roster + Auto-Renumber) ----------
  const rosterHtml = () => `
    <section class="cr-panel">
      <div class="cr-section-head">
        <div>
          <h2 class="cr-h2">รายชื่อนักเรียน (Master Roster)</h2>
          <p class="cr-muted">ทั้งหมด ${roster.length} คน — กดปุ่ม "เรียงลำดับใหม่" เพื่อรันเลขที่ 1 ถึงคนสุดท้ายอัตโนมัติ</p>
        </div>
        <div class="cr-toolbar-group">
          <button type="button" class="cr-btn cr-btn--outline cr-btn--sm" data-r-renumber title="รันลำดับเลขที่ 1 ถึง ${roster.length || 'N'} ใหม่อัตโนมัติตามลำดับรายชื่อปัจจุบัน">
            ${icon('sort-number', 16)}
            <span>เรียงลำดับใหม่</span>
          </button>
          <label class="cr-btn cr-btn--outline cr-btn--sm cursor-pointer">
            ${icon('upload', 15)}
            <span>อัปโหลด Excel (.xlsx)</span>
            <input type="file" accept=".xlsx" class="sr-only" data-roster-file />
          </label>
          ${
            room.sheet && !room.sheet.standard && getAuth().signedIn
              ? `<button type="button" class="cr-btn cr-btn--outline cr-btn--sm" data-roster-sheet>
                  ${icon('spreadsheet', 15)}
                  <span>ดึงจาก Google Sheet</span>
                </button>`
              : ''
          }
        </div>
      </div>
      <div class="cr-table-wrap cr-table-wrap--scroll cr-table-wrap--edit-cards mt-3">
        <table class="cr-table cr-table--edit cr-table--edit-roster">
          <thead><tr><th class="w-14 text-center">ลำดับ</th><th class="w-24 text-center">เลขที่</th><th class="w-44">รหัสนักเรียน</th><th>คำนำหน้า/ชื่อ-นามสกุล</th><th class="w-28 text-center">จัดการแถว</th></tr></thead>
          <tbody>
            ${
              roster
                .map(
                  (r, i) => `<tr>
                    <td class="text-center cr-faint cr-num cr-edit-order" data-label="ลำดับที่">${i + 1}</td>
                    <td class="cr-edit-no" data-label="เลขที่"><input class="cr-input cr-input--cell text-center cr-num" data-ri="${i}" data-rf="number" value="${escapeHtml(r.number)}" aria-label="เลขที่ลำดับ ${i + 1}" /></td>
                    <td class="cr-edit-code" data-label="รหัสนักเรียน"><input class="cr-input cr-input--cell cr-num" data-ri="${i}" data-rf="code" value="${escapeHtml(r.code)}" aria-label="รหัสนักเรียนลำดับ ${i + 1}" /></td>
                    <td class="cr-edit-name" data-label="คำนำหน้า/ชื่อ-นามสกุล"><input class="cr-input cr-input--cell" data-ri="${i}" data-rf="name" value="${escapeHtml(r.name)}" aria-label="ชื่อลำดับ ${i + 1}" /></td>
                    <td class="text-center whitespace-nowrap cr-edit-actions">
                      <button type="button" class="cr-icon-btn" data-move="${i}" data-dir="-1" aria-label="เลื่อนขึ้น" title="เลื่อนขึ้น" ${i === 0 ? 'disabled' : ''}>${icon('arrow-up', 15)}</button>
                      <button type="button" class="cr-icon-btn" data-move="${i}" data-dir="1" aria-label="เลื่อนลง" title="เลื่อนลง" ${i === roster.length - 1 ? 'disabled' : ''}>${icon('arrow-down', 15)}</button>
                      <button type="button" class="cr-icon-btn cr-icon-btn--danger" data-rdel="${i}" aria-label="ลบ ${escapeHtml(r.name)}" title="ลบแถวนี้">${icon('x', 15)}</button>
                    </td>
                  </tr>`,
                )
                .join('') || `<tr><td colspan="5" class="text-center cr-faint py-6 cr-edit-empty">ยังไม่มีรายชื่อ — กด "+ เพิ่มนักเรียน" หรืออัปโหลดไฟล์ Excel</td></tr>`
            }
          </tbody>
        </table>
      </div>
      <div class="cr-panel-foot">
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" class="cr-btn cr-btn--outline cr-btn--sm" data-radd>${icon('plus', 15)}<span>เพิ่มนักเรียน</span></button>
          <button type="button" class="cr-btn cr-btn--ghost cr-btn--sm" data-r-renumber>${icon('sort-number', 15)}<span>รันเลขที่ 1–${roster.length || 1} อัตโนมัติ</span></button>
        </div>
        <div class="flex items-center gap-3 ml-auto">
          <span class="cr-unsaved ${rosterDirty ? '' : 'hidden'}" data-roster-dirty><span class="cr-dot cr-dot--amber"></span><span>รายชื่อยังไม่ได้บันทึก</span></span>
          <button type="button" class="cr-btn cr-btn--primary" data-rsave>${icon('check', 16)}<span>บันทึกรายชื่อ</span></button>
        </div>
      </div>
    </section>`;

  // ---------- Section: Google & Collapsible Column Mapping ----------
  const sheetOptions = (selected: string) =>
    (meta?.sheets ?? []).map((s) => `<option ${s.title === selected ? 'selected' : ''} value="${escapeHtml(s.title)}">${escapeHtml(s.title)}</option>`).join('');

  const colOptions = (selected: number, sheetTitle: string, headerRow: number, max = 52) => {
    const vals = valuesCache.get(sheetTitle) ?? [];
    const head = vals[headerRow - 1] ?? [];
    const width = Math.max(max, head.length + 2, selected + 2);
    let html = '';
    for (let c = 0; c < width; c++) {
      const h = head[c] ? ` · ${head[c].slice(0, 24)}` : '';
      html += `<option value="${c}" ${c === selected ? 'selected' : ''}>คอลัมน์ ${colToLetter(c)}${escapeHtml(h)}</option>`;
    }
    return html;
  };

  const projectColumns = (kind: 'attendance' | 'assignments') => {
    const m = kind === 'attendance' ? attMap : asgMap;
    if (!m) return [] as { col: number; label: string; ghost?: boolean }[];
    const items = kind === 'attendance' ? sessions : assignments;
    const startCol = parseColumnIndex(m.startCol, 0);
    const headerRowIdx = Math.max(0, Math.floor(Number(m.headerRow) || 1) - 1);
    const span = kind === 'assignments' && Number((m as AssignmentSheetMapping).colsPerAssignment) === 2 ? 2 : 1;
    const vals = valuesCache.get(m.sheetTitle) ?? [];
    const prevM = room.sheet?.[kind];
    const resetting =
      !!prevM &&
      (prevM.sheetTitle !== m.sheetTitle ||
        parseColumnIndex(prevM.startCol, 0) !== startCol ||
        Number(prevM.headerRow) !== Number(m.headerRow) ||
        (kind === 'assignments' &&
          (Number((prevM as AssignmentSheetMapping).colsPerAssignment) === 2 ? 2 : 1) !== span));
    const used = new Set<number>();
    const out: { col: number; label: string; ghost?: boolean }[] = [];
    const label = (i: number) => (kind === 'attendance' ? sessionHeaderText(sessions[i]) : assignmentHeader(assignments[i]));
    const pushSlot = (col: number, text: string, ghost = false) => {
      if (span === 2) {
        out.push({ col, label: `${text} (สถานะ)`, ghost });
        out.push({ col: col + 1, label: `${text} (คะแนน)`, ghost });
        used.add(col);
        used.add(col + 1);
      } else {
        out.push({ col, label: text, ghost });
        used.add(col);
      }
    };

    const headRow = vals[headerRowIdx] ?? [];
    items.forEach((it, i) => {
      if (!resetting && it.sheetColumn !== null && it.sheetColumn !== undefined) {
        const existingCol = parseColumnIndex(it.sheetColumn, -1);
        const existingBlank =
          existingCol > startCol &&
          vals.length > 0 &&
          Array.from({ length: span }, (_, offset) => (headRow[existingCol + offset] ?? '').trim()).every((v) => !v);
        if (existingCol >= startCol && !existingBlank) {
          pushSlot(existingCol, label(i));
        }
      }
    });
    items.forEach((it, i) => {
      const existingCol = it.sheetColumn !== null && it.sheetColumn !== undefined ? parseColumnIndex(it.sheetColumn, -1) : -1;
      const placed = !resetting && existingCol >= startCol && used.has(existingCol);
      if (!placed) {
        const nextCol = findNextAvailableAssignmentColumn(vals, headerRowIdx, startCol, span, used);
        pushSlot(nextCol, label(i));
      }
    });
    const ghostCol = findNextAvailableAssignmentColumn(vals, headerRowIdx, startCol, span, used);
    pushSlot(ghostCol, kind === 'attendance' ? '(รอบถัดไป)' : '(งานถัดไป)', true);
    return out.sort((a, b) => a.col - b.col);
  };

  const previewHtml = (kind: 'attendance' | 'assignments') => {
    const m = kind === 'attendance' ? attMap : asgMap;
    if (!m) return '';
    const vals = valuesCache.get(m.sheetTitle);
    if (!vals) return `<div class="cr-empty-mini"><span class="cr-spinner"></span> กำลังโหลดตารางตัวอย่างแท็บ "${escapeHtml(m.sheetTitle)}"...</div>`;

    const sheetMeta = meta?.sheets.find((s) => s.title === m.sheetTitle);
    const merges = sheetMeta?.merges ?? [];
    const proj = projectColumns(kind);
    const projMap = new Map(proj.map((p) => [p.col, p]));
    const fixedEnd = kind === 'attendance' && attMap?.mode === 'fixed' && attMap.fixedCount > 0 ? attMap.startCol + attMap.fixedCount : null;
    const lastProj = Math.max(...proj.map((p) => p.col));
    const maxCol = Math.min(Math.max(lastProj, m.keyCol, fixedEnd ? fixedEnd - 1 : 0) + 1, Math.max(m.keyCol, m.startCol) + 12);
    const firstCol = 0;
    const startRow = Math.max(1, m.headerRow - 1); // 1-based
    const endRow = m.headerRow + 4; // 1-based inclusive
    const layout = buildMergeLayout(merges, startRow - 1, endRow, firstCol, maxCol + 1);

    const isFocusStart = focusedField === `${kind}.startCol` || focusedField === `${kind}.fixedCount` || focusedField === `${kind}.mode`;
    const isFocusKey = focusedField === `${kind}.keyCol` || focusedField === `${kind}.keyType`;
    const isFocusHeader = focusedField === `${kind}.headerRow`;

    const overflow = fixedEnd !== null && proj.some((p) => !p.ghost && p.col >= fixedEnd);
    const conflicts = proj.filter((p) => {
      const existing = (vals[m.headerRow - 1] ?? [])[p.col];
      return !p.ghost && existing && existing.trim() && existing.trim() !== p.label;
    });

    const selectionBar = `
      <div class="cr-preview-status">
        <span class="cr-sel-pill is-header-pill ${isFocusHeader ? 'is-pill-active' : ''}">
          แถวหัวตาราง: <b>แถว ${m.headerRow}</b>
        </span>
        <span class="cr-sel-pill is-key-pill ${isFocusKey ? 'is-pill-active' : ''}">
          จับคู่นักเรียน: <b>${m.keyType === 'order' ? 'ตามลำดับแถว' : `คอลัมน์ ${colToLetter(m.keyCol)} (${KEY_TYPE_LABEL[m.keyType]})`}</b>
        </span>
        <span class="cr-sel-pill is-write-pill ${isFocusStart ? 'is-pill-active' : ''}">
          จุดเริ่มเขียน: <b>เซลล์ ${colToLetter(m.startCol)}${m.headerRow}</b>
        </span>
        ${merges.length ? `<span class="cr-sel-pill is-merge-pill">เซลล์รวม (Merge) ในแท็บนี้ ${merges.length} จุด</span>` : ''}
        <span class="cr-faint ml-auto">คลิกหัวคอลัมน์เพื่อเลือกคอลัมน์เริ่มเขียน หรือคลิกเลขแถวเพื่อตั้งเป็นหัวตาราง</span>
      </div>`;

    let html = `${selectionBar}<div class="cr-grid-wrap"><table class="cr-grid cr-grid--map cr-grid--stroke" data-preview-kind="${kind}"><thead><tr><th class="cr-grid__rn">แถว</th>`;
    for (let c = firstCol; c <= maxCol; c++) {
      const p = projMap.get(c);
      const isKey = c === m.keyCol && m.keyType !== 'order';
      const isStart = c === m.startCol;
      const isSlot = fixedEnd !== null && c >= m.startCol && c < fixedEnd;
      const cls = [
        isKey ? 'is-key is-key-edge-top' : '',
        p ? (p.ghost ? 'is-ghost is-write-edge-top' : 'is-write is-write-edge-top') : isSlot ? 'is-slot' : '',
        isStart ? 'is-start-col' : '',
        (isStart && isFocusStart) || (isKey && isFocusKey) ? 'is-col-focused' : '',
      ].filter(Boolean).join(' ');
      const roleTag = isStart
        ? `<span class="cr-grid__role is-role-start">เริ่มเขียน (${colToLetter(c)})</span>`
        : isKey
          ? `<span class="cr-grid__role is-role-key">จับคู่แถว</span>`
          : p && !p.ghost
            ? `<span class="cr-grid__role">เขียนข้อมูล</span>`
            : '';
      html += `<th class="${cls}" data-pick-col="${c}" title="คลิกเพื่อตั้งคอลัมน์ ${colToLetter(c)} เป็นคอลัมน์เริ่มเขียน"><span class="cr-grid__col-letter">${colToLetter(c)}</span>${roleTag}</th>`;
    }
    html += `</tr></thead><tbody>`;
    for (let r = startRow; r <= endRow; r++) {
      const r0 = r - 1;
      const row = vals[r0] ?? [];
      const isHeader = r === m.headerRow;
      const isLast = r === endRow;
      const trCls = [isHeader ? 'is-header' : '', isHeader && isFocusHeader ? 'is-row-focused' : ''].filter(Boolean).join(' ');
      html += `<tr class="${trCls}"><td class="cr-grid__rn" data-pick-row="${r}" title="คลิกเพื่อตั้งแถวที่ ${r} เป็นแถวหัวตาราง">${r}${isHeader ? `<span class="cr-hdr-tag">หัวตาราง</span>` : ''}</td>`;
      for (let c = firstCol; c <= maxCol; c++) {
        const key = `${r0}:${c}`;
        if (layout.covered.has(key)) continue;
        const anchor = layout.anchors.get(key);
        const spanEndCol = anchor ? anchor.endCol - 1 : c;
        const spanEndRow = anchor ? anchor.endRow : r; // 1-based

        const p = projMap.get(c);
        const isKey = c === m.keyCol && m.keyType !== 'order';
        const isStart = c === m.startCol;
        const isOriginCell = isHeader && isStart;

        const cls = [
          isKey ? 'is-key is-key-edge' : '',
          isKey && (isLast || spanEndRow === endRow) ? 'is-key-edge-bottom' : '',
          p ? (p.ghost ? 'is-ghost is-write-edge' : 'is-write is-write-edge') : '',
          p && (isLast || spanEndRow === endRow) ? 'is-write-edge-bottom' : '',
          isStart ? 'is-start-col' : '',
          isOriginCell ? 'is-origin-cell' : '',
          anchor ? 'is-merged-cell' : '',
          (isStart && isFocusStart) || (isKey && isFocusKey) ? 'is-col-focused' : '',
        ].filter(Boolean).join(' ');

        const spanAttrs = anchor
          ? `${anchor.rowSpan > 1 ? ` rowspan="${anchor.rowSpan}"` : ''}${anchor.colSpan > 1 ? ` colspan="${anchor.colSpan}"` : ''}`
          : '';

        const rawVal = anchor ? getMergedCellValue(vals, merges, r0, c) : (row[c] ?? '');
        let cell = escapeHtml(rawVal);
        if (p && isHeader) {
          cell = `<span class="cr-proj">${escapeHtml(p.label).replace(/\n/g, '<br>')}</span>`;
        } else if (p && r > m.headerRow && !p.ghost) {
          cell = `<span class="cr-proj">${kind === 'attendance' ? 'มา / ลา / สาย' : 'คะแนน / ส่งแล้ว'}</span>`;
        }
        if (isOriginCell) {
          cell += `<span class="cr-origin-badge">${colToLetter(c)}${r}</span>`;
        } else if (anchor) {
          cell += `<span class="cr-merge-tag" title="เซลล์รวมตามไฟล์จริง">${colToLetter(c)}${r}:${colToLetter(spanEndCol)}${spanEndRow}</span>`;
        }
        html += `<td class="${cls}"${spanAttrs} data-pick-cell="${c}:${r}">${cell}</td>`;
      }
      html += `</tr>`;
    }
    html += `</tbody></table></div>
      <div class="cr-legend">
        <span><i class="cr-legend__sw is-key"></i>กรอบสีส้ม: คอลัมน์จับคู่แถวนักเรียน (${m.keyType === 'order' ? 'ลำดับแถว' : colToLetter(m.keyCol)})</span>
        <span><i class="cr-legend__sw is-write"></i>กรอบสีเขียว: เซลล์/คอลัมน์ที่ระบบจะเขียนข้อมูล (เริ่มที่ ${colToLetter(m.startCol)}${m.headerRow})</span>
        <span><i class="cr-legend__sw is-header-sw"></i>กรอบสีน้ำเงิน: แถวหัวตาราง (แถว ${m.headerRow})</span>
        ${fixedEnd !== null ? `<span><i class="cr-legend__sw is-slot"></i>ช่วงช่องที่จองไว้ (${colToLetter(m.startCol)}–${colToLetter(fixedEnd - 1)})</span>` : ''}
      </div>
      ${overflow ? `<div class="cr-alert cr-alert--error mt-2">${icon('warning', 16)}<span>จำนวนรอบเช็คชื่อเกินช่องที่กำหนด (${attMap!.fixedCount} ช่อง) — เพิ่มจำนวนช่องหรือเปลี่ยนเป็นโหมดเพิ่มไปทางขวาอัตโนมัติ</span></div>` : ''}
      ${conflicts.length ? `<div class="cr-alert cr-alert--warn mt-2">${icon('warning', 16)}<span>คอลัมน์ ${conflicts.map((c) => colToLetter(c.col)).join(', ')} มีหัวตารางเดิมอยู่แล้ว — ข้อมูลในคอลัมน์ดังกล่าวจะถูกเขียนทับ</span></div>` : ''}`;
    return html;
  };

  const mappingPanel = (kind: 'attendance' | 'assignments') => {
    const m = kind === 'attendance' ? attMap : asgMap;
    const isAtt = kind === 'attendance';
    const collapsed = isAtt ? attCollapsed : asgCollapsed;
    const title = isAtt ? 'คอลัมน์สำหรับการมาเรียน' : 'คอลัมน์สำหรับการส่งงาน';
    const ic = isAtt ? 'calendar' : 'clipboard';

    if (!m) {
      return `
        <div class="cr-map-card is-disabled">
          <div class="cr-map-card__head">
            <div class="cr-collapsible__title">
              <span class="cr-collapsible__icon">${icon(ic, 17)}</span>
              <div>
                <h3 class="cr-h3 mb-0">${title}</h3>
                <span class="cr-faint">ยังไม่ได้เปิดใช้งานการซิงก์ส่วนนี้</span>
              </div>
            </div>
            <button type="button" class="cr-btn cr-btn--outline cr-btn--sm" data-map-enable="${kind}">
              ${icon('plus', 15)}
              <span>ตั้งค่า${title}</span>
            </button>
          </div>
        </div>`;
    }

    const summaryText = `แท็บ "${m.sheetTitle}" · หัวตารางแถว ${m.headerRow} · เริ่มคอลัมน์ ${colToLetter(m.startCol)} (${colToLetter(m.startCol)}${m.headerRow}) · จับคู่ด้วย${KEY_TYPE_LABEL[m.keyType]}`;
    const keyTypes = (Object.keys(KEY_TYPE_LABEL) as RowKeyType[])
      .map((k) => `<option value="${k}" ${m.keyType === k ? 'selected' : ''}>${KEY_TYPE_LABEL[k]}</option>`)
      .join('');

    return `
      <div class="cr-map-card ${collapsed ? 'is-collapsed' : 'is-open'}" data-panel="${kind}">
        <div class="cr-map-card__head" data-toggle-map="${kind}" role="button" tabindex="0" aria-expanded="${!collapsed}">
          <div class="cr-collapsible__title">
            <span class="cr-collapsible__icon">${icon(ic, 17)}</span>
            <div>
              <div class="flex flex-wrap items-center gap-2">
                <h3 class="cr-h3 mb-0">${title}</h3>
                <span class="cr-badge cr-badge--green">เริ่มที่ ${colToLetter(m.startCol)}${m.headerRow}</span>
              </div>
              <p class="cr-muted">${escapeHtml(summaryText)}</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <button type="button" class="cr-btn cr-btn--ghost cr-btn--sm cr-text-danger" data-map-disable="${kind}" title="ยกเลิกการตั้งค่าส่วนนี้">
              ${icon('x', 14)}
              <span>ปิดส่วนนี้</span>
            </button>
            <span class="cr-collapsible__chev" aria-hidden="true">${icon(collapsed ? 'chevron-right' : 'chevron-down', 18)}</span>
          </div>
        </div>
        ${
          collapsed
            ? ''
            : `<div class="cr-map-card__body">
                <div class="cr-form-grid cr-form-grid--4">
                  <label class="cr-field cr-span-2"><span class="cr-label">แท็บ (Worksheet)</span><select class="cr-input" data-m="${kind}.sheetTitle">${sheetOptions(m.sheetTitle)}</select></label>
                  <label class="cr-field"><span class="cr-label">แถวหัวตาราง</span><input type="number" min="1" class="cr-input" data-m="${kind}.headerRow" value="${m.headerRow}" /></label>
                  <label class="cr-field"><span class="cr-label">คอลัมน์เริ่มเขียน</span><select class="cr-input" data-m="${kind}.startCol">${colOptions(m.startCol, m.sheetTitle, m.headerRow)}</select></label>
                  <label class="cr-field cr-span-2"><span class="cr-label">จับคู่นักเรียนด้วย</span><select class="cr-input" data-m="${kind}.keyType">${keyTypes}</select></label>
                  <label class="cr-field cr-span-2 ${m.keyType === 'order' ? 'opacity-50' : ''}"><span class="cr-label">คอลัมน์ที่ใช้จับคู่</span><select class="cr-input" data-m="${kind}.keyCol" ${m.keyType === 'order' ? 'disabled' : ''}>${colOptions(m.keyCol, m.sheetTitle, m.headerRow, 26)}</select></label>
                  ${
                    isAtt && attMap
                      ? `<div class="cr-field cr-span-4">
                          <span class="cr-label">รูปแบบการจองช่องเช็คชื่อ</span>
                          <div class="flex flex-wrap items-center gap-4">
                            <label class="cr-radio"><input type="radio" name="att-mode" value="append" data-m="attendance.mode" ${attMap.mode === 'append' ? 'checked' : ''}/> เพิ่มคอลัมน์ไปทางขวาอัตโนมัติ</label>
                            <label class="cr-radio"><input type="radio" name="att-mode" value="fixed" data-m="attendance.mode" ${attMap.mode === 'fixed' ? 'checked' : ''}/> กำหนดจำนวนช่องตายตัว</label>
                            <input type="number" min="1" max="400" class="cr-input w-24" data-m="attendance.fixedCount" value="${attMap.fixedCount || 20}" ${attMap.mode === 'fixed' ? '' : 'disabled'} aria-label="จำนวนช่อง" />
                            <span class="cr-faint">${attMap.mode === 'fixed' ? `ช่วงคอลัมน์ ${colToLetter(attMap.startCol)}–${colToLetter(attMap.startCol + (attMap.fixedCount || 20) - 1)}` : ''}</span>
                          </div>
                        </div>`
                      : ''
                  }
                </div>
                <div class="mt-4">
                  <div class="cr-step-title">${icon('spreadsheet', 15)}<span>ตารางจำลองตำแหน่งเขียนข้อมูล (Real-time Mapping Preview)</span></div>
                  <div data-preview-box="${kind}">${previewHtml(kind)}</div>
                </div>
              </div>`
        }
      </div>`;
  };

  const standardPreview = () => {
    const sCols = sessions
      .slice(0, 4)
      .map(
        (s, i) =>
          `<th class="is-write is-write-edge-top">${colToLetter(3 + i)}<span class="cr-grid__role">${escapeHtml(sessionHeaderText(s)).replace(/\n/g, '<br>')}</span></th>`,
      )
      .join('');
    const aCols = assignments.slice(0, 4).map((a, i) => `<th class="is-write is-write-edge-top">${colToLetter(3 + i)}<span class="cr-grid__role">${escapeHtml(a.title)}</span></th>`).join('');
    const table = (title: string, cols: string, nextCol: number, nextLabel: string) => `
      <div class="cr-std-card">
        <div class="cr-step-title">${icon('spreadsheet', 15)}<span>แท็บ "${title}"</span></div>
        <div class="cr-grid-wrap"><table class="cr-grid cr-grid--map cr-grid--stroke"><thead><tr>
          <th class="is-key is-key-edge-top">A<span class="cr-grid__role is-role-key">เลขที่</span></th>
          <th class="is-key is-key-edge-top">B<span class="cr-grid__role is-role-key">รหัสนักเรียน</span></th>
          <th class="is-key is-key-edge-top">C<span class="cr-grid__role is-role-key">ชื่อ-สกุล</span></th>
          ${cols}
          <th class="is-ghost is-write-edge-top">${colToLetter(nextCol)}<span class="cr-grid__role">${nextLabel}</span></th>
        </tr></thead></table></div>
      </div>`;
    return `
      <div class="cr-alert cr-alert--info mt-3">${icon('info', 16)}<span>ไฟล์มาตรฐาน (1 ไฟล์ 3 แท็บ): ระบบจัดคอลัมน์ให้อัตโนมัติและอัปเดตข้อมูลทุกครั้งที่บันทึก</span></div>
      <div class="grid gap-4 md:grid-cols-2 mt-3">
        ${table('การมาเรียน', sCols, 3 + Math.min(sessions.length, 4), sessions.length > 4 ? `+${sessions.length - 4} รอบ` : 'รอบถัดไป')}
        ${table('การส่งงาน', aCols, 3 + Math.min(assignments.length, 4), assignments.length > 4 ? `+${assignments.length - 4} งาน` : 'งานถัดไป')}
      </div>`;
  };

  const googleHtml = () => {
    const auth = getAuth();
    const sheet = room.sheet;
    let body: string;
    if (!auth.configured) {
      body = `<div class="cr-alert cr-alert--info">${icon('info', 16)}<span>ยังไม่ได้ตั้งค่า Google Client ID (ใช้งานโหมดในเครื่องได้ปกติ)</span></div>`;
    } else if (!auth.signedIn) {
      body = `<div class="cr-alert cr-alert--info">${icon('info', 16)}<span>เข้าสู่ระบบด้วย Google ที่แถบด้านบนเพื่อเชื่อมต่อหรือตั้งค่า Google Sheet</span></div>
        ${sheet ? `<p class="cr-muted mt-2">ไฟล์ที่ผูกไว้: ${escapeHtml(sheet.spreadsheetName)}</p>` : ''}`;
    } else if (!sheet) {
      body = `
        <p class="cr-muted">ห้องนี้ใช้งานในเครื่องเท่านั้น สามารถเลือกเชื่อมต่อกับ Google Sheet ได้ 2 รูปแบบ:</p>
        <div class="flex flex-wrap gap-3 mt-3">
          <button type="button" class="cr-btn cr-btn--primary" data-g-create>${icon('cloud-up', 16)}<span>สร้างไฟล์ Google Sheet ใหม่และซิงก์ (แนะนำ)</span></button>
          <button type="button" class="cr-btn cr-btn--outline" data-g-pick>${icon('folder', 16)}<span>เชื่อมกับไฟล์ Google Sheet ที่มีอยู่</span></button>
        </div>`;
    } else {
      const on = room.syncMode === 'google';
      body = `
        <div class="cr-sheet-info">
          <div class="flex flex-wrap items-center gap-2">
            <span class="cr-badge ${on ? 'cr-badge--green' : 'cr-badge--gray'}">
              <span class="cr-dot ${on ? 'cr-dot--green' : 'cr-dot--gray'}"></span>
              <span>${on ? 'กำลังซิงก์' : 'หยุดซิงก์ชั่วคราว'}</span>
            </span>
            <strong>${escapeHtml(sheet.spreadsheetName)}</strong>
            <span class="cr-faint">${sheet.standard ? '(ไฟล์มาตรฐาน 3 แท็บ)' : '(ไฟล์กำหนดเอง)'}</span>
          </div>
          <div class="cr-toolbar-group">
            ${(() => {
              const url = safeHttpsUrl(sheet.spreadsheetUrl);
              return url
                ? `<a class="cr-btn cr-btn--outline cr-btn--sm" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${icon('external', 14)}<span>เปิดไฟล์</span></a>`
                : '';
            })()}
            ${
              isOwner
                ? `<button type="button" class="cr-btn cr-btn--outline cr-btn--sm" data-g-toggle>${icon(on ? 'pause' : 'refresh', 14)}<span>${on ? 'พักการซิงก์' : 'เปิดการซิงก์'}</span></button>
                   <button type="button" class="cr-btn cr-btn--ghost cr-btn--sm" data-g-create>${icon('cloud-up', 14)}<span>สร้างไฟล์ใหม่แทน</span></button>
                   <button type="button" class="cr-btn cr-btn--ghost cr-btn--sm" data-g-pick>${icon('folder', 14)}<span>เปลี่ยนไฟล์</span></button>`
                : ''
            }
          </div>
        </div>
        ${
          sheet.standard
            ? standardPreview()
            : metaError
              ? `<div class="cr-alert cr-alert--error mt-3">${icon('warning', 16)}<span>${escapeHtml(metaError)}</span><button type="button" class="cr-btn cr-btn--outline cr-btn--sm ml-auto" data-g-reload>${icon('refresh', 14)}<span>ลองใหม่</span></button></div>`
              : !meta
                ? `<div class="cr-empty-mini mt-3"><span class="cr-spinner"></span> กำลังอ่านโครงสร้างไฟล์ Google Sheet...</div>`
                : `<div class="flex flex-col gap-3 mt-4" data-mapping>
                    ${mappingPanel('attendance')}
                    ${mappingPanel('assignments')}
                    <div class="cr-panel-foot">
                      <span class="cr-unsaved ${mapDirty ? '' : 'hidden'}" data-map-dirty><span class="cr-dot cr-dot--amber"></span><span>การตั้งค่าคอลัมน์ยังไม่ได้บันทึก</span></span>
                      <button type="button" class="cr-btn cr-btn--primary ml-auto" data-map-save>${icon('check', 16)}<span>บันทึกการตั้งค่าคอลัมน์</span></button>
                    </div>
                  </div>`
        }`;
    }
    return `<section class="cr-panel" data-google><h2 class="cr-h2">การเชื่อมต่อ Google Sheet & คอลัมน์</h2><div class="mt-3">${body}</div></section>`;
  };

  const render = () => {
    const showInfo = activeFilter === 'all' || activeFilter === 'info';
    const showRoster = activeFilter === 'all' || activeFilter === 'roster';
    const showGoogle = activeFilter === 'all' || activeFilter === 'google';
    root.innerHTML = `
      ${subNavHtml()}
      <div class="cr-settings-stack">
        <div data-sec-info class="${showInfo ? '' : 'hidden'}">${infoHtml()}</div>
        <div data-sec-roster class="${showRoster ? '' : 'hidden'}">${rosterHtml()}</div>
        <div data-sec-google class="${showGoogle ? '' : 'hidden'}">${googleHtml()}</div>
      </div>`;
  };

  const renderSection = (sec: 'info' | 'roster' | 'google') => {
    const el = root.querySelector(`[data-sec-${sec}]`);
    if (!el) return;
    const active = document.activeElement as HTMLElement | null;
    const focusKey = active?.dataset?.m ?? active?.dataset?.rf ? `${active?.dataset.m ?? ''}|${active?.dataset.ri ?? ''}|${active?.dataset.rf ?? ''}` : null;
    el.innerHTML = sec === 'info' ? infoHtml() : sec === 'roster' ? rosterHtml() : googleHtml();
    if (focusKey) {
      const [mk, ri, rf] = focusKey.split('|');
      const target = mk ? el.querySelector<HTMLElement>(`[data-m="${mk}"]`) : el.querySelector<HTMLElement>(`[data-ri="${ri}"][data-rf="${rf}"]`);
      target?.focus();
    }
  };

  // ---------- Google data loading ----------
  const ensureValues = async (title: string) => {
    if (!room.sheet || valuesCache.has(title)) return;
    try {
      const vals = await getValues(room.sheet.spreadsheetId, quoteSheet(title));
      valuesCache.set(title, vals.slice(0, 60));
    } catch (e) {
      valuesCache.set(title, []);
      toast(errorMessage(e), 'error');
    }
    renderSection('google');
  };

  const loadMeta = async () => {
    if (!room.sheet || room.sheet.standard || !getAuth().signedIn) return;
    meta = null;
    metaError = '';
    renderSection('google');
    try {
      meta = await getSpreadsheetMeta(room.sheet.spreadsheetId);
      renderSection('google');
      const titles = new Set([attMap?.sheetTitle, asgMap?.sheetTitle].filter((x): x is string => !!x));
      for (const t of titles) await ensureValues(t);
    } catch (e) {
      metaError = errorMessage(e);
      renderSection('google');
    }
  };

  const firstEmptyCol = (vals: string[][], headerRow: number, minStart = 0, span = 1): number => {
    const rowIdx = Math.max(0, Math.floor(Number(headerRow) || 1) - 1);
    const head = vals[rowIdx] ?? [];
    let searchFrom = parseColumnIndex(minStart, 0);
    if (searchFrom === 0) {
      const firstNonEmpty = head.findIndex((v) => v && v.trim() !== '');
      if (firstNonEmpty >= 0) searchFrom = firstNonEmpty;
    }
    return findNextAvailableAssignmentColumn(vals, rowIdx, searchFrom, span);
  };

  const defaultMapping = async (kind: 'attendance' | 'assignments'): Promise<AttendanceSheetMapping | AssignmentSheetMapping> => {
    const r = room.sheet?.roster;
    const title = r?.sheetTitle ?? meta?.sheets[0]?.title ?? 'Sheet1';
    await ensureValues(title);
    const vals = valuesCache.get(title) ?? [];
    const headerRow = r && r.sheetTitle === title ? Math.max(1, Number(r.mapping.headerRow) + 1) : 1;
    let keyType: RowKeyType = 'order';
    let keyCol = 0;
    let minStart = 0;
    if (r) {
      if (r.mapping.code !== null) [keyType, keyCol] = ['code', parseColumnIndex(r.mapping.code, 0)];
      else if (r.mapping.number !== null) [keyType, keyCol] = ['number', parseColumnIndex(r.mapping.number, 0)];
      else if (r.mapping.nameMode === 'single' && r.mapping.name !== null) [keyType, keyCol] = ['name', parseColumnIndex(r.mapping.name, 0)];
      if (r.sheetTitle === title) {
        const rosterCols = [r.mapping.number, r.mapping.code, r.mapping.name, r.mapping.prefix, r.mapping.first, r.mapping.last]
          .filter((x): x is number => x !== null && x !== undefined)
          .map((x) => parseColumnIndex(x, 0));
        if (rosterCols.length) minStart = Math.max(...rosterCols) + 1;
      }
    }
    if (kind === 'assignments' && attMap && attMap.sheetTitle === title) {
      const attStart = parseColumnIndex(attMap.startCol, 0);
      const attOffset = attMap.mode === 'fixed' && Number(attMap.fixedCount) > 0 ? Number(attMap.fixedCount) : Math.max(sessions.length, 1);
      minStart = Math.max(minStart, attStart + attOffset);
    }
    const startCol = firstEmptyCol(vals, headerRow, minStart);
    const base = { sheetTitle: title, headerRow, keyCol, keyType, startCol };
    return kind === 'attendance' ? { ...base, mode: 'append', fixedCount: 20 } : base;
  };

  // ---------- Focus highlight on Real-time Mapping Preview ----------
  root.addEventListener('focusin', (e) => {
    const inp = (e.target as HTMLElement).closest<HTMLElement>('[data-m]');
    const nextField = inp?.dataset.m ?? null;
    if (nextField !== focusedField) {
      focusedField = nextField;
      if (focusedField?.startsWith('attendance.')) {
        const box = root.querySelector('[data-preview-box="attendance"]');
        if (box) box.innerHTML = previewHtml('attendance');
      } else if (focusedField?.startsWith('assignments.')) {
        const box = root.querySelector('[data-preview-box="assignments"]');
        if (box) box.innerHTML = previewHtml('assignments');
      }
    }
  });

  // ---------- Events ----------
  root.onsubmit = async (e) => {
    const form = (e.target as HTMLElement).closest<HTMLFormElement>('[data-info-form]');
    if (!form) return;
    e.preventDefault();
    const fd = new FormData(form);
    const subject = String(fd.get('subject') ?? '').trim();
    const name = String(fd.get('name') ?? '').trim();
    if (!subject && !name) return toast('กรุณากรอกชื่อวิชาหรือระดับชั้น/ห้อง', 'warn');
    const fresh = { ...room, subject, name, term: String(fd.get('term') ?? ''), academicYear: String(fd.get('academicYear') ?? '').trim() };
    room = await saveClassroom(fresh);
    toast('บันทึกข้อมูลห้องเรียนแล้ว', 'success');
    if (room.syncMode === 'google') {
      syncClassroomDriveProperties(room).catch(() => undefined);
      syncSpreadsheetSyncMeta(room).catch(() => undefined);
      scheduleAppDataSync();
    }
    ctx.refresh();
  };

  root.oninput = (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.ri !== undefined) {
      roster[Number(t.dataset.ri)][t.dataset.rf as 'number' | 'code' | 'name'] = t.value;
      if (!rosterDirty) {
        rosterDirty = true;
        root.querySelector('[data-roster-dirty]')?.classList.remove('hidden');
        markDirty();
      }
    }
  };

  root.onchange = async (e) => {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    if (t.matches('[data-roster-file]')) {
      const input = t as HTMLInputElement;
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      try {
        const sheets = await readWorkbook(file);
        const res = await openColumnMapper({
          title: `นำเข้ารายชื่อจาก ${file.name}`,
          sources: sheets.map((s) => ({ name: s.name, merges: s.merges, load: async () => s.rows })),
          confirmText: 'ใช้รายชื่อนี้',
        });
        if (res) await applyImported(res.students);
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
      return;
    }
    const key = t.dataset.m;
    if (!key) return;
    const [kind, field] = key.split('.') as ['attendance' | 'assignments', string];
    const m = (kind === 'attendance' ? attMap : asgMap) as (AttendanceSheetMapping & AssignmentSheetMapping) | null;
    if (!m) return;
    const v = t.value;
    if (field === 'sheetTitle') {
      m.sheetTitle = v;
      await ensureValues(v);
      const vals = valuesCache.get(v) ?? [];
      const minStart = m.keyType !== 'order' ? parseColumnIndex(m.keyCol, 0) + 1 : 0;
      const span = kind === 'assignments' && Number(m.colsPerAssignment) === 2 ? 2 : 1;
      m.startCol = firstEmptyCol(vals, m.headerRow, minStart, span);
    } else if (field === 'headerRow') m.headerRow = Math.max(1, Math.floor(Number(v) || 1));
    else if (field === 'startCol') m.startCol = parseColumnIndex(v, 0);
    else if (field === 'keyCol') m.keyCol = parseColumnIndex(v, 0);
    else if (field === 'keyType') m.keyType = v as RowKeyType;
    else if (field === 'mode') m.mode = v as 'append' | 'fixed';
    else if (field === 'fixedCount') m.fixedCount = Math.max(1, Math.min(400, Math.floor(Number(v) || 20)));
    else if (field === 'colsPerAssignment') m.colsPerAssignment = Number(v) === 2 ? 2 : 1;
    if (m.mode === 'fixed' && !m.fixedCount) m.fixedCount = 20;
    focusedField = key;
    mapDirty = true;
    markDirty();
    renderSection('google');
  };

  async function applyImported(list: ParsedStudent[]): Promise<void> {
    let mode: 'replace' | 'append' = 'replace';
    if (roster.length) {
      const choice = await new Promise<'replace' | 'append' | null>((resolve) => {
        let r: 'replace' | 'append' | null = null;
        const md = openModal({
          title: 'นำเข้ารายชื่อนักเรียน',
          size: 'sm',
          body: `<p class="cr-text-body">พบรายชื่อ ${list.length} คน — ต้องการ<strong>แทนที่</strong>รายชื่อเดิม (${roster.length} คน) หรือ<strong>เพิ่มต่อท้าย</strong>?<br/><span class="cr-faint">ระบบจะจับคู่คนเดิมจากรหัส/ชื่อ เพื่อรักษาประวัติเช็คชื่อและคะแนนไว้</span></p>`,
          footer: `<button type="button" class="cr-btn cr-btn--ghost" data-c>ยกเลิก</button><button type="button" class="cr-btn cr-btn--outline" data-a>เพิ่มต่อท้าย</button><button type="button" class="cr-btn cr-btn--primary" data-r>แทนที่ทั้งหมด</button>`,
          onClose: () => resolve(r),
        });
        md.footer.querySelector('[data-c]')!.addEventListener('click', () => md.close());
        md.footer.querySelector('[data-a]')!.addEventListener('click', () => ((r = 'append'), md.close()));
        md.footer.querySelector('[data-r]')!.addEventListener('click', () => ((r = 'replace'), md.close()));
      });
      if (!choice) return;
      mode = choice;
    }
    roster = mergeRoster(roster, list, mode);
    rosterDirty = true;
    markDirty();
    render();
    toast(`นำเข้าแล้ว ${list.length} คน — กด "บันทึกรายชื่อ" เพื่อยืนยัน`, 'info');
  }

  async function saveRoster(btn: HTMLButtonElement): Promise<void> {
    const clean = roster.filter((r) => r.name.trim());
    if (clean.length < roster.length) {
      const ok = await confirmDialog(`มี ${roster.length - clean.length} แถวที่ไม่มีชื่อ ระบบจะตัดแถวเหล่านั้นออก ดำเนินการต่อ?`, { confirmText: 'ดำเนินการต่อ' });
      if (!ok) return;
    }
    const codes = clean.map((r) => normalizeKey(r.code)).filter(Boolean);
    const dup = codes.filter((c, i) => codes.indexOf(c) !== i);
    if (dup.length && !(await confirmDialog(`พบรหัสนักเรียนซ้ำ ${new Set(dup).size} รหัส — การจับคู่แถวใน Google Sheet อาจผิดพลาด บันทึกต่อหรือไม่?`, { confirmText: 'บันทึกต่อ' }))) return;
    await withBusy(btn, 'กำลังบันทึก...', async () => {
      const now = Date.now();
      const prevStudents = await getStudents(room.id);
      const list: Student[] = clean.map((r, i) => ({ id: r.id, classroomId: room.id, number: r.number.trim() || String(i + 1), studentCode: r.code.trim(), fullName: r.name.trim(), order: i, updatedAt: now }));
      await replaceStudents(room.id, list);
      roster = list.map((s) => ({ id: s.id, number: s.number, code: s.studentCode, name: s.fullName }));

      const freshRoom = (await getClassroom(room.id)) ?? room;
      room = JSON.parse(JSON.stringify(freshRoom)) as Classroom;
      const authNow = getAuth();

      if (freshRoom.syncMode === 'google' && freshRoom.sheet) {
        if (authNow.signedIn) {
          if (freshRoom.sheet.standard) {
            try {
              await pushClassroom(freshRoom.id);
              toast(`บันทึกรายชื่อ ${list.length} คน และอัปเดต Google Sheet แล้ว`, 'success');
            } catch (err) {
              toast(`บันทึกในเครื่องแล้ว แต่อัปเดต Google Sheet ไม่สำเร็จ: ${errorMessage(err)}`, 'error');
            }
          } else {
            try {
              const res = await pushCustomRosterToSheet(freshRoom.id, prevStudents);
              valuesCache.clear();
              const parts: string[] = [];
              if (res?.added) parts.push(`เพิ่มใหม่ ${res.added} คน`);
              if (res?.updated) parts.push(`อัปเดต ${res.updated} คน`);
              const detail = parts.length ? ` (${parts.join(', ')})` : '';
              toast(`บันทึกรายชื่อ ${list.length} คน และอัปเดตลง Google Sheet แล้ว${detail}`, 'success');
            } catch (err) {
              await syncSpreadsheetSyncMeta(freshRoom).catch(() => undefined);
              toast(`บันทึกในเครื่องแล้ว แต่อัปเดตรายชื่อลง Google Sheet ไม่สำเร็จ: ${errorMessage(err)}`, 'error');
            }
          }
          scheduleAppDataSync();
        } else {
          toast(`บันทึกรายชื่อ ${list.length} คนในเครื่องแล้ว — เข้าสู่ระบบ Google เพื่อส่งขึ้น Google Sheet`, 'warn');
        }
      } else {
        toast(`บันทึกรายชื่อ ${list.length} คนแล้ว`, 'success');
      }

      rosterDirty = false;
      markDirty();
      render();
      if (freshRoom.syncMode === 'google' && freshRoom.sheet && !freshRoom.sheet.standard && authNow.signedIn) {
        void loadMeta();
      }
    });
  }

  async function saveMapping(btn: HTMLButtonElement): Promise<void> {
    if (!room.sheet) return;
    const prev = room.sheet;
    const cleanAtt: AttendanceSheetMapping | null = attMap
      ? {
          sheetTitle: attMap.sheetTitle,
          headerRow: Math.max(1, Math.floor(Number(attMap.headerRow) || 1)),
          keyCol: parseColumnIndex(attMap.keyCol, 0),
          keyType: attMap.keyType,
          startCol: parseColumnIndex(attMap.startCol, 0),
          mode: attMap.mode === 'fixed' ? 'fixed' : 'append',
          fixedCount: Math.max(0, Math.floor(Number(attMap.fixedCount) || 0)),
        }
      : null;
    const cleanAsg: AssignmentSheetMapping | null = asgMap
      ? {
          sheetTitle: asgMap.sheetTitle,
          headerRow: Math.max(1, Math.floor(Number(asgMap.headerRow) || 1)),
          keyCol: parseColumnIndex(asgMap.keyCol, 0),
          keyType: asgMap.keyType,
          startCol: parseColumnIndex(asgMap.startCol, 0),
          ...(Number(asgMap.colsPerAssignment) === 2 ? { colsPerAssignment: 2 as const } : {}),
        }
      : null;

    const reset = (kind: 'attendance' | 'assignments') => {
      const before = prev[kind];
      const after = kind === 'attendance' ? cleanAtt : cleanAsg;
      if (!after) return false;
      if (!before) return true;
      const beforeCols = kind === 'assignments' ? (Number((before as AssignmentSheetMapping).colsPerAssignment) === 2 ? 2 : 1) : 1;
      const afterCols = kind === 'assignments' ? (Number((after as AssignmentSheetMapping).colsPerAssignment) === 2 ? 2 : 1) : 1;
      return (
        before.sheetTitle !== after.sheetTitle ||
        parseColumnIndex(before.startCol, 0) !== after.startCol ||
        Number(before.headerRow) !== after.headerRow ||
        beforeCols !== afterCols
      );
    };
    const hasOutOfBoundsAsg =
      !!cleanAsg && assignments.some((a) => a.sheetColumn !== null && a.sheetColumn !== undefined && parseColumnIndex(a.sheetColumn, 0) < cleanAsg.startCol);
    const resetAtt = reset('attendance') && sessions.length > 0;
    const resetAsg = (reset('assignments') || hasOutOfBoundsAsg) && assignments.length > 0;
    if (cleanAtt && cleanAsg && cleanAtt.sheetTitle === cleanAsg.sheetTitle) {
      const attEnd = cleanAtt.mode === 'fixed' ? cleanAtt.startCol + cleanAtt.fixedCount : Infinity;
      if (cleanAsg.startCol >= cleanAtt.startCol && cleanAsg.startCol < attEnd) {
        const ok = await confirmDialog('การมาเรียนและการส่งงานอยู่แท็บเดียวกันและคอลัมน์อาจทับกัน แนะนำให้ใช้คนละแท็บ หรือกำหนดจำนวนช่องเช็คชื่อแบบตายตัว บันทึกต่อหรือไม่?', { confirmText: 'บันทึกต่อ' });
        if (!ok) return;
      }
    }
    if ((resetAtt || resetAsg) && !(await confirmDialog('ตำแหน่งแท็บ/คอลัมน์เริ่มต้นเปลี่ยนไป ระบบจะเขียนข้อมูลที่บันทึกไว้ทั้งหมดลงตำแหน่งใหม่ (ข้อมูลเดิมในตำแหน่งเก่าจะไม่ถูกลบ) ดำเนินการต่อ?', { confirmText: 'ดำเนินการต่อ' })))
      return;
    await withBusy(btn, 'กำลังบันทึก...', async () => {
      attMap = cleanAtt;
      asgMap = cleanAsg;
      room.sheet = { ...prev, attendance: cleanAtt ? { ...cleanAtt } : null, assignments: cleanAsg ? { ...cleanAsg } : null };
      room.assignmentStartCol = cleanAsg ? Number(cleanAsg.startCol) : undefined;
      room = await saveClassroom(room);
      if (resetAtt) await Promise.all(sessions.map((s) => markSessionSync(s.id, { sheetColumn: null, sheetSynced: false })));
      if (resetAsg) await Promise.all(assignments.map((a) => markAssignmentSync(a.id, { sheetColumn: null, sheetSynced: false })));
      mapDirty = false;
      markDirty();
      scheduleAppDataSync();
      if (room.syncMode === 'google' && getAuth().signedIn) {
        await syncClassroomDriveProperties(room).catch((err) =>
          console.warn('[EduPlan Class] syncClassroomDriveProperties on saveMapping:', err),
        );
        try {
          await pushClassroom(room.id);
          toast('บันทึกการตั้งค่าคอลัมน์และส่งข้อมูลที่ค้างขึ้น Google Sheet แล้ว', 'success');
        } catch (err) {
          await syncSpreadsheetSyncMeta(room).catch(() => undefined);
          toast(`บันทึกการตั้งค่าแล้ว แต่ส่งข้อมูลไม่สำเร็จ: ${errorMessage(err)}`, 'error');
        }
      } else toast('บันทึกการตั้งค่าคอลัมน์แล้ว', 'success');
      ctx.refresh();
    });
  }

  async function connectExisting(btn: HTMLButtonElement): Promise<void> {
    try {
      const f = await pickSpreadsheet();
      if (!f) return;
      await withBusy(btn, 'กำลังเชื่อมต่อ...', async () => {
        const m = await getSpreadsheetMeta(f.id);
        room.sheet = { spreadsheetId: m.spreadsheetId, spreadsheetName: m.title, spreadsheetUrl: m.url, standard: false, roster: null, attendance: null, assignments: null };
        room.sheetId = m.spreadsheetId;
        room.syncMode = 'google';
        await Promise.all([
          ...sessions.map((s) => markSessionSync(s.id, { sheetColumn: null, sheetSynced: false })),
          ...assignments.map((a) => markAssignmentSync(a.id, { sheetColumn: null, sheetSynced: false })),
        ]);
        room = await saveClassroom(room);
        await syncClassroomDriveProperties(room).catch(() => undefined);
        await syncSpreadsheetSyncMeta(room, m).catch(() => undefined);
        scheduleAppDataSync();
        toast(`เชื่อมต่อ "${m.title}" แล้ว — ตั้งค่าแท็บและคอลัมน์ด้านล่าง`, 'success');
        ctx.refresh();
      });
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  root.onclick = async (e) => {
    const t = e.target as HTMLElement;

    // Sub-nav filter
    const filterBtn = t.closest<HTMLButtonElement>('[data-filter]');
    if (filterBtn) {
      activeFilter = filterBtn.dataset.filter as SettingsFilter;
      if (activeFilter === 'info') infoCollapsed = false;
      render();
      return;
    }

    // Toggle Info panel
    if (t.closest('[data-toggle-info]')) {
      infoCollapsed = !infoCollapsed;
      renderSection('info');
      return;
    }

    // Disable mapping (ตรวจสอบก่อน toggle-map เพราะปุ่มอยู่ภายใน header)
    const dis = t.closest<HTMLElement>('[data-map-disable]');
    if (dis) {
      e.stopPropagation();
      if (dis.dataset.mapDisable === 'attendance') attMap = null;
      else asgMap = null;
      mapDirty = true;
      markDirty();
      renderSection('google');
      return;
    }

    // Toggle Attendance / Assignments mapping accordion
    const toggleMap = t.closest<HTMLElement>('[data-toggle-map]');
    if (toggleMap) {
      const kind = toggleMap.dataset.toggleMap as 'attendance' | 'assignments';
      if (kind === 'attendance') attCollapsed = !attCollapsed;
      else asgCollapsed = !asgCollapsed;
      renderSection('google');
      return;
    }

    // Interactive click on preview table to pick column or header row
    const pickCol = t.closest<HTMLElement>('[data-pick-col]');
    if (pickCol) {
      const table = pickCol.closest<HTMLElement>('[data-preview-kind]');
      const kind = table?.dataset.previewKind as 'attendance' | 'assignments' | undefined;
      const m = kind === 'attendance' ? attMap : kind === 'assignments' ? asgMap : null;
      if (m && kind) {
        m.startCol = parseColumnIndex(pickCol.dataset.pickCol, 0);
        focusedField = `${kind}.startCol`;
        mapDirty = true;
        markDirty();
        renderSection('google');
      }
      return;
    }
    const pickRow = t.closest<HTMLElement>('[data-pick-row]');
    if (pickRow) {
      const table = pickRow.closest<HTMLElement>('[data-preview-kind]');
      const kind = table?.dataset.previewKind as 'attendance' | 'assignments' | undefined;
      const m = kind === 'attendance' ? attMap : kind === 'assignments' ? asgMap : null;
      if (m && kind) {
        m.headerRow = Number(pickRow.dataset.pickRow);
        focusedField = `${kind}.headerRow`;
        mapDirty = true;
        markDirty();
        renderSection('google');
      }
      return;
    }

    // Roster: Auto-Renumber (เรียงลำดับใหม่)
    if (t.closest('[data-r-renumber]')) {
      if (!roster.length) {
        toast('ยังไม่มีรายชื่อนักเรียนให้เรียงลำดับ', 'warn');
        return;
      }
      roster.forEach((r, idx) => {
        r.number = String(idx + 1);
      });
      rosterDirty = true;
      markDirty();
      renderSection('roster');
      toast(`รันเลขที่ 1–${roster.length} ตามลำดับรายชื่อเรียบร้อย (กด "บันทึกรายชื่อ" เพื่อยืนยัน)`, 'success');
      return;
    }

    // Roster: Add student
    if (t.closest('[data-radd]')) {
      const nextNo = String(roster.length + 1);
      roster.push({ id: uid(), number: nextNo, code: '', name: '' });
      rosterDirty = true;
      markDirty();
      renderSection('roster');
      root.querySelector<HTMLInputElement>(`[data-ri="${roster.length - 1}"][data-rf="name"]`)?.focus();
      return;
    }
    const del = t.closest<HTMLElement>('[data-rdel]');
    if (del) {
      const i = Number(del.dataset.rdel);
      const r = roster[i];
      if (r.name.trim() && !(await confirmDialog(`ลบ "${r.name}" ออกจากรายชื่อ? (ประวัติเช็คชื่อ/คะแนนของคนนี้จะไม่แสดงอีก)`, { confirmText: 'ลบ', danger: true }))) return;
      roster.splice(i, 1);
      rosterDirty = true;
      markDirty();
      renderSection('roster');
      return;
    }
    const mv = t.closest<HTMLButtonElement>('[data-move]');
    if (mv) {
      const i = Number(mv.dataset.move);
      const j = i + Number(mv.dataset.dir);
      if (j < 0 || j >= roster.length) return;
      [roster[i], roster[j]] = [roster[j], roster[i]];
      rosterDirty = true;
      markDirty();
      renderSection('roster');
      return;
    }
    const rs = t.closest<HTMLButtonElement>('[data-rsave]');
    if (rs) return saveRoster(rs);
    if (t.closest('[data-roster-sheet]') && room.sheet) {
      const sh = room.sheet;
      try {
        const m = meta ?? (await getSpreadsheetMeta(sh.spreadsheetId));
        const res = await openColumnMapper({
          title: `ดึงรายชื่อจาก ${m.title}`,
          sources: m.sheets.map((s) => ({ name: s.title, merges: s.merges, load: () => loadSheetGrid(sh.spreadsheetId, s.title) })),
          initialSource: sh.roster?.sheetTitle,
          initialMapping: sh.roster?.mapping ?? null,
          confirmText: 'ใช้รายชื่อนี้',
        });
        if (res) {
          room.sheet = { ...sh, roster: { sheetTitle: res.sheetName, mapping: res.mapping } };
          room = await saveClassroom(room);
          await applyImported(res.students);
        }
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
      return;
    }
    // Google
    const gc = t.closest<HTMLButtonElement>('[data-g-create]');
    if (gc) {
      const msg = room.sheet
        ? 'สร้างไฟล์ Google Sheet มาตรฐานใหม่ (3 แท็บ) และย้ายการซิงก์ไปไฟล์ใหม่? ไฟล์เดิมจะไม่ถูกลบ'
        : 'สร้างไฟล์ Google Sheet ใหม่ใน Drive ของคุณ (3 แท็บ: รายชื่อนักเรียน / การมาเรียน / การส่งงาน) แล้วซิงก์ห้องนี้?';
      if (!(await confirmDialog(msg, { confirmText: 'สร้างไฟล์และซิงก์' }))) return;
      if (rosterDirty) toast('รายชื่อที่ยังไม่บันทึกจะไม่ถูกส่งขึ้น Sheet — กด "บันทึกรายชื่อ" ก่อนหากต้องการ', 'warn');
      await withBusy(gc, 'กำลังสร้างไฟล์...', async () => {
        try {
          room = await upgradeToStandardSheet(room.id);
          toast('สร้าง Google Sheet และซิงก์ข้อมูลเรียบร้อย', 'success');
          ctx.refresh();
        } catch (err) {
          toast(errorMessage(err), 'error');
        }
      });
      return;
    }
    const gp = t.closest<HTMLButtonElement>('[data-g-pick]');
    if (gp) return connectExisting(gp);
    if (t.closest('[data-g-toggle]') && room.sheet) {
      const turnOn = room.syncMode !== 'google';
      if (!turnOn && !(await confirmDialog('ปิดการซิงก์ Google Sheet ของห้องนี้? ข้อมูลจะบันทึกในเครื่องเท่านั้นจนกว่าจะเปิดอีกครั้ง', { confirmText: 'ปิดการซิงก์' }))) return;
      room.syncMode = turnOn ? 'google' : 'local';
      room = await saveClassroom(room);
      if (turnOn) {
        scheduleAppDataSync(0);
        pushClassroom(room.id).catch((err) => toast(errorMessage(err), 'error'));
      }
      toast(turnOn ? 'เปิดการซิงก์แล้ว' : 'ปิดการซิงก์แล้ว — ห้องนี้ใช้งานในเครื่อง', 'info');
      ctx.refresh();
      return;
    }
    if (t.closest('[data-g-reload]')) return loadMeta();
    const en = t.closest<HTMLElement>('[data-map-enable]');
    if (en) {
      const kind = en.dataset.mapEnable as 'attendance' | 'assignments';
      const dm = await defaultMapping(kind);
      if (kind === 'attendance') {
        attMap = dm as AttendanceSheetMapping;
        attCollapsed = false;
      } else {
        asgMap = dm as AssignmentSheetMapping;
        asgCollapsed = false;
      }
      mapDirty = true;
      markDirty();
      renderSection('google');
      return;
    }
    const ms = t.closest<HTMLButtonElement>('[data-map-save]');
    if (ms) return saveMapping(ms);
  };

  render();
  void loadMeta();
}
