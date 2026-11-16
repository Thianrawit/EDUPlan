// ============================================================
// EDUPLAN Classroom — แท็บการมาเรียน (Attendance)
// ============================================================
import { deleteSession, getSessions, getStudents, saveSession } from '../db';
import { pushAttendanceSession, pushClassroom, scheduleAppDataSync } from '../googleSheets';
import { getAuthState } from '../googleAuth';
import {
  ATTENDANCE_LABEL,
  errorMessage,
  escapeHtml,
  icon,
  sessionLabel,
  sortSessions,
  todayISO,
  uid,
  type AppContext,
  type AttendanceSession,
  type AttendanceStatus,
  type Classroom,
  type IconName,
  type Student,
} from '../types';
import { confirmDialog, toast, withBusy } from './ColumnMapperModal';

const STATUSES: AttendanceStatus[] = ['present', 'absent', 'late'];
const STATUS_ICON: Record<AttendanceStatus, IconName> = {
  present: 'check',
  absent: 'x',
  late: 'clock',
};
let lastSelected: Record<string, string> = {};

export async function renderAttendance(root: HTMLElement, room: Classroom, ctx: AppContext): Promise<void> {
  const [students, sessionsRaw] = await Promise.all([getStudents(room.id), getSessions(room.id)]);
  let sessions = sortSessions(sessionsRaw);
  let selectedId = lastSelected[room.id] && sessions.some((s) => s.id === lastSelected[room.id]) ? lastSelected[room.id] : 'new';
  let draft: Record<string, AttendanceStatus> = {};
  let date = todayISO();
  let period = '';
  let dirty = false;

  const google = room.syncMode === 'google' && !!room.sheet;
  const sheetReady = google && (room.sheet!.standard || !!room.sheet!.attendance);

  const nextPeriod = (d: string) => `คาบ ${sessions.filter((s) => s.date === d).length + 1}`;
  const setDirty = (v: boolean) => {
    dirty = v;
    ctx.setDirty(v);
    root.querySelector('[data-dirty]')?.classList.toggle('hidden', !v);
  };

  const loadSelection = () => {
    const s = sessions.find((x) => x.id === selectedId);
    if (s) {
      draft = { ...s.records };
      date = s.date;
      period = s.period;
    } else {
      selectedId = 'new';
      draft = {};
      date = todayISO();
      period = nextPeriod(date);
    }
    lastSelected[room.id] = selectedId;
    setDirty(false);
  };

  const counts = () => {
    const c = { present: 0, absent: 0, late: 0, none: 0 };
    for (const st of students) {
      const v = draft[st.id];
      if (v) c[v]++;
      else c.none++;
    }
    return c;
  };

  const summaryHtml = () => {
    const c = counts();
    return `
      <span class="cr-sum cr-sum--present">มา: <b>${c.present}</b> คน</span>
      <span class="cr-sum cr-sum--absent">ลา/ขาด: <b>${c.absent}</b> คน</span>
      <span class="cr-sum cr-sum--late">มาสาย: <b>${c.late}</b> คน</span>
      <span class="cr-sum cr-sum--none">ยังไม่ระบุ: <b>${c.none}</b> คน</span>`;
  };

  const segHtml = (st: Student) => `
    <div class="cr-seg cr-seg--status" role="radiogroup" aria-label="สถานะของ ${escapeHtml(st.fullName)}">
      ${STATUSES.map(
        (k) => `<button type="button" role="radio" aria-checked="${draft[st.id] === k}" class="cr-seg__btn cr-seg__btn--${k} ${draft[st.id] === k ? 'is-on' : ''}" data-sid="${st.id}" data-st="${k}">${icon(STATUS_ICON[k], 14)}<span>${ATTENDANCE_LABEL[k]}</span></button>`,
      ).join('')}
    </div>`;

  const sessionOption = (s: AttendanceSession) => {
    const present = students.filter((st) => s.records[st.id] === 'present' || s.records[st.id] === 'late').length;
    const flag = google && !s.sheetSynced ? ' (รอซิงก์)' : '';
    return `<option value="${s.id}" ${s.id === selectedId ? 'selected' : ''}>${escapeHtml(sessionLabel(s))} — มาเรียน ${present}/${students.length}${flag}</option>`;
  };

  const render = () => {
    const current = sessions.find((s) => s.id === selectedId);
    root.innerHTML = `
      ${
        google && !sheetReady
          ? `<div class="cr-alert cr-alert--warn cr-alert--row">
              <div class="flex items-center gap-2">
                ${icon('warning', 18)}
                <span>ยังไม่ได้ตั้งค่าแท็บและคอลัมน์สำหรับการมาเรียนใน Google Sheet — ข้อมูลจะบันทึกในเครื่องก่อน</span>
              </div>
              <button type="button" class="cr-btn cr-btn--outline cr-btn--sm" data-goto-settings>${icon('settings', 15)}<span>ตั้งค่าคอลัมน์</span></button>
            </div>`
          : ''
      }
      <div class="cr-session-bar">
        <label class="cr-field cr-session-bar__select">
          <span class="cr-label">รอบการเช็คชื่อ</span>
          <select class="cr-input" data-session>
            <option value="new" ${selectedId === 'new' ? 'selected' : ''}>+ สร้างรอบเช็คชื่อใหม่ (วันที่ / คาบเรียน)</option>
            ${sessions.length ? `<optgroup label="รอบที่บันทึกไว้ (เลือกเพื่อแก้ไขย้อนหลัง)">${[...sessions].reverse().map(sessionOption).join('')}</optgroup>` : ''}
          </select>
        </label>
        <label class="cr-field cr-session-bar__date">
          <span class="cr-label">วันที่</span>
          <input type="date" class="cr-input" data-date value="${escapeHtml(date)}" />
        </label>
        <label class="cr-field cr-session-bar__period">
          <span class="cr-label">คาบเรียน / รอบ</span>
          <input class="cr-input" data-period value="${escapeHtml(period)}" placeholder="เช่น คาบ 1" />
        </label>
        <div class="cr-session-bar__actions">
          <button type="button" class="cr-btn cr-btn--soft-green" data-all-present ${students.length ? '' : 'disabled'}>
            ${icon('check-all', 17)}
            <span>เช็คมาเรียนทั้งหมด</span>
          </button>
          ${
            current
              ? `<button type="button" class="cr-btn cr-btn--outline cr-text-danger" data-del-session title="ลบรอบเช็คชื่อนี้">
                  ${icon('trash', 16)}
                  <span>ลบรอบนี้</span>
                </button>`
              : ''
          }
        </div>
      </div>
      ${
        students.length
          ? `<div class="cr-table-wrap">
              <table class="cr-table cr-table--att">
                <thead><tr><th class="w-16 text-center">เลขที่</th><th class="w-36">รหัสนักเรียน</th><th>ชื่อ-นามสกุล</th><th class="w-[310px] text-center">สถานะการมาเรียน</th></tr></thead>
                <tbody>
                  ${students
                    .map(
                      (st) => `<tr data-row="${st.id}" class="${draft[st.id] ? `is-${draft[st.id]}` : ''}">
                        <td class="text-center cr-num">${escapeHtml(st.number)}</td>
                        <td class="cr-num">${escapeHtml(st.studentCode) || '<span class="cr-faint">-</span>'}</td>
                        <td>${escapeHtml(st.fullName)}</td>
                        <td>${segHtml(st)}</td>
                      </tr>`,
                    )
                    .join('')}
                </tbody>
              </table>
            </div>`
          : `<div class="cr-empty">
              <div class="cr-empty__icon" aria-hidden="true">${icon('users', 28)}</div>
              <h2 class="cr-h2">ยังไม่มีรายชื่อนักเรียน</h2>
              <p class="cr-muted">เพิ่มรายชื่อนักเรียนในแท็บตั้งค่าก่อนเริ่มเช็คชื่อ</p>
              <button type="button" class="cr-btn cr-btn--primary mt-4" data-goto-settings>${icon('plus', 16)}<span>ไปเพิ่มรายชื่อ</span></button>
            </div>`
      }
      <div class="cr-sticky-footer" role="region" aria-label="สรุปการมาเรียน">
        <div class="cr-sticky-footer__sum" data-summary aria-live="polite">${summaryHtml()}</div>
        <div class="flex items-center gap-3">
          <span class="cr-unsaved ${dirty ? '' : 'hidden'}" data-dirty><span class="cr-dot cr-dot--amber"></span><span>ยังไม่ได้บันทึก</span></span>
          <button type="button" class="cr-btn cr-btn--primary" data-save ${students.length ? '' : 'disabled'}>
            ${icon('check', 16)}
            <span>บันทึกการมาเรียน</span>
          </button>
        </div>
      </div>`;
  };

  const updateRow = (sid: string) => {
    const tr = root.querySelector<HTMLElement>(`tr[data-row="${sid}"]`);
    if (!tr) return;
    tr.className = draft[sid] ? `is-${draft[sid]}` : '';
    tr.querySelectorAll<HTMLButtonElement>('[data-st]').forEach((b) => {
      const on = draft[sid] === b.dataset.st;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', String(on));
    });
  };
  const updateSummary = () => {
    const el = root.querySelector('[data-summary]');
    if (el) el.innerHTML = summaryHtml();
  };

  const confirmDiscard = async () =>
    !dirty || (await confirmDialog('มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก ต้องการละทิ้งหรือไม่?', { confirmText: 'ละทิ้งการเปลี่ยนแปลง', danger: true }));

  root.onclick = async (e) => {
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLButtonElement>('[data-st]');
    if (b) {
      const sid = b.dataset.sid!;
      const st = b.dataset.st as AttendanceStatus;
      if (draft[sid] === st) delete draft[sid];
      else draft[sid] = st;
      updateRow(sid);
      updateSummary();
      setDirty(true);
      return;
    }
    if (t.closest('[data-goto-settings]')) {
      if (await confirmDiscard()) {
        setDirty(false);
        ctx.openRoom(room.id, 'settings');
      }
      return;
    }
    if (t.closest('[data-all-present]')) {
      students.forEach((st) => {
        draft[st.id] = 'present';
        updateRow(st.id);
      });
      updateSummary();
      setDirty(true);
      return;
    }
    const delBtn = t.closest<HTMLButtonElement>('[data-del-session]');
    if (delBtn) {
      const s = sessions.find((x) => x.id === selectedId);
      if (!s) return;
      const ok = await confirmDialog(
        `ลบรอบเช็คชื่อ "${sessionLabel(s)}"?${google && !room.sheet!.standard ? '\n(คอลัมน์ใน Google Sheet ไฟล์เดิมจะไม่ถูกลบ ต้องลบเองใน Sheet)' : ''}`,
        { title: 'ลบรอบเช็คชื่อ', confirmText: 'ลบรอบนี้', danger: true },
      );
      if (!ok) return;
      await deleteSession(s);
      sessions = sessions.filter((x) => x.id !== s.id);
      selectedId = 'new';
      loadSelection();
      render();
      toast('ลบรอบเช็คชื่อแล้ว', 'info');
      if (google && room.sheet!.standard && getAuthState().signedIn) pushClassroom(room.id).catch((err) => toast(errorMessage(err), 'error'));
      if (google) scheduleAppDataSync();
      return;
    }
    const saveBtn = t.closest<HTMLButtonElement>('[data-save]');
    if (saveBtn) await save(saveBtn);
  };

  root.onchange = async (e) => {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    if (t.matches('[data-session]')) {
      const val = t.value;
      if (!(await confirmDiscard())) {
        (t as HTMLSelectElement).value = selectedId;
        return;
      }
      selectedId = val;
      loadSelection();
      render();
      return;
    }
    if (t.matches('[data-date]')) {
      const wasAuto = selectedId === 'new' && /^คาบ \d+$/.test(period) && period === nextPeriod(date);
      date = t.value || todayISO();
      if (wasAuto) {
        period = nextPeriod(date);
        const p = root.querySelector<HTMLInputElement>('[data-period]');
        if (p) p.value = period;
      }
      setDirty(true);
    }
  };
  root.oninput = (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches('[data-period]')) {
      period = t.value;
      setDirty(true);
    }
  };

  async function save(btn: HTMLButtonElement): Promise<void> {
    if (!date) return toast('กรุณาเลือกวันที่', 'warn');
    const existing = sessions.find((s) => s.id === selectedId);
    const dup = sessions.find((s) => s.id !== selectedId && s.date === date && s.period.trim() === period.trim());
    if (dup && !(await confirmDialog(`มีรอบ "${sessionLabel(dup)}" อยู่แล้ว ต้องการบันทึกเป็นอีกรอบหรือไม่?`, { confirmText: 'บันทึกเป็นรอบใหม่' }))) return;
    const c = counts();
    if (c.none > 0 && !(await confirmDialog(`ยังไม่ระบุสถานะ ${c.none} คน — บันทึกเลยหรือไม่?`, { confirmText: 'บันทึกเลย' }))) return;

    await withBusy(btn, 'กำลังบันทึก...', async () => {
      const now = Date.now();
      const session: AttendanceSession = existing
        ? { ...existing, date, period: period.trim(), records: { ...draft }, sheetSynced: false }
        : { id: uid(), classroomId: room.id, date, period: period.trim(), records: { ...draft }, sheetColumn: null, sheetSynced: false, createdAt: now, updatedAt: now };
      await saveSession(session);
      selectedId = session.id;
      lastSelected[room.id] = session.id;
      sessions = sortSessions([...sessions.filter((s) => s.id !== session.id), session]);
      setDirty(false);

      if (google && sheetReady && getAuthState().signedIn) {
        try {
          const r = await pushAttendanceSession(room.id, session);
          session.sheetSynced = true;
          const extra = r?.column ? ` (คอลัมน์ ${r.column})` : '';
          if (r?.unmatched.length) {
            toast(`บันทึกแล้ว แต่หาแถวใน Google Sheet ไม่พบ ${r.unmatched.length} คน: ${r.unmatched.slice(0, 5).join(', ')}${r.unmatched.length > 5 ? '…' : ''}`, 'warn', 9000);
          } else toast(`บันทึกการมาเรียนและอัปเดต Google Sheet แล้ว${extra}`, 'success');
        } catch (err) {
          toast(`บันทึกในเครื่องแล้ว แต่อัปเดต Google Sheet ไม่สำเร็จ: ${errorMessage(err)} — กด "ซิงก์ข้อมูล" เพื่อลองใหม่`, 'error');
        }
      } else if (google && !getAuthState().signedIn) {
        toast('บันทึกในเครื่องแล้ว — เข้าสู่ระบบ Google เพื่อส่งข้อมูลขึ้น Sheet', 'info');
      } else {
        toast('บันทึกการมาเรียนแล้ว', 'success');
      }
      if (google) scheduleAppDataSync();
    });
    const fresh = sortSessions(await getSessions(room.id));
    sessions = fresh;
    render();
  }

  loadSelection();
  render();
}
