// ============================================================
// EDUPLAN Classroom — แท็บการมาเรียน (Attendance)
// ============================================================
import { deleteSession, getSessions, getStudents, saveClassroom, saveSession } from '../db';
import { pushAttendanceSession, pushClassroom, scheduleAppDataSync } from '../googleSheets';
import { getAuthState } from '../googleAuth';
import {
  ATTENDANCE_LABEL,
  errorMessage,
  escapeHtml,
  getEffectiveRole,
  icon,
  roleBadgeHtml,
  sessionHeaderText,
  sessionLabel,
  sortSessions,
  todayISO,
  uid,
  type AppContext,
  type AttendanceSession,
  type AttendanceStatus,
  type Classroom,
  type ClassroomRole,
  type IconName,
  type SessionHeaderMode,
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

export async function renderAttendance(
  root: HTMLElement,
  room: Classroom,
  ctx: AppContext,
  currentRole: ClassroomRole = getEffectiveRole(room),
): Promise<void> {
  const isViewer = currentRole === 'viewer';
  const canSeeSettings = currentRole === 'owner' || currentRole === 'creator';
  const [students, sessionsRaw] = await Promise.all([getStudents(room.id), getSessions(room.id)]);
  let sessions = sortSessions(sessionsRaw);
  let selectedId = lastSelected[room.id] && sessions.some((s) => s.id === lastSelected[room.id]) ? lastSelected[room.id] : 'new';
  if (isViewer && selectedId === 'new' && sessions.length > 0) {
    selectedId = sessions[sessions.length - 1].id;
  }
  let draft: Record<string, AttendanceStatus> = {};
  let date = todayISO();
  let period = '';
  let defaultHeaderMode: SessionHeaderMode = room.attendanceHeaderMode ?? 'both';
  let headerMode: SessionHeaderMode = defaultHeaderMode;
  let dirty = false;

  const google = room.syncMode === 'google' && !!room.sheet;
  const sheetReady = google && (room.sheet!.standard || !!room.sheet!.attendance);

  const nextPeriod = (d: string) => `คาบ ${sessions.filter((s) => s.date === d).length + 1}`;
  const setDirty = (v: boolean) => {
    if (isViewer) return;
    dirty = v;
    ctx.setDirty(v);
    root.querySelector('[data-dirty]')?.classList.toggle('hidden', !v);
  };

  const renderHeaderPreviewHtml = () => {
    const raw = sessionHeaderText({ date, period, headerMode });
    const lines = raw.split('\n');
    if (lines.length >= 2) {
      return `<span class="cr-header-preview__top">${escapeHtml(lines[0])}</span><span class="cr-header-preview__sub">${escapeHtml(lines.slice(1).join(' '))}</span>`;
    }
    return `<span class="cr-header-preview__top">${escapeHtml(raw)}</span>`;
  };

  const updateHeaderPreview = () => {
    const el = root.querySelector('[data-header-preview]');
    if (el) el.innerHTML = renderHeaderPreviewHtml();
  };

  const loadSelection = () => {
    const s = sessions.find((x) => x.id === selectedId);
    if (s) {
      draft = { ...s.records };
      date = s.date;
      period = s.period;
      headerMode = s.headerMode ?? 'both';
    } else if (isViewer && sessions.length > 0) {
      const latest = sessions[sessions.length - 1];
      selectedId = latest.id;
      draft = { ...latest.records };
      date = latest.date;
      period = latest.period;
      headerMode = latest.headerMode ?? 'both';
    } else {
      selectedId = 'new';
      draft = {};
      date = todayISO();
      period = nextPeriod(date);
      headerMode = defaultHeaderMode;
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
        (k) => `<button type="button" role="radio" aria-checked="${draft[st.id] === k}" class="cr-seg__btn cr-seg__btn--${k} ${draft[st.id] === k ? 'is-on' : ''}" data-sid="${st.id}" data-st="${k}" ${isViewer ? 'disabled' : ''}>${icon(STATUS_ICON[k], 14)}<span>${ATTENDANCE_LABEL[k]}</span></button>`,
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
              ${canSeeSettings ? `<button type="button" class="cr-btn cr-btn--outline cr-btn--sm" data-goto-settings>${icon('settings', 15)}<span>ตั้งค่าคอลัมน์</span></button>` : ''}
            </div>`
          : ''
      }
      <div class="cr-session-bar">
        <label class="cr-field cr-session-bar__select">
          <span class="cr-label">รอบการเช็คชื่อ</span>
          <select class="cr-input" data-session>
            ${
              !isViewer
                ? `<option value="new" ${selectedId === 'new' ? 'selected' : ''}>+ สร้างรอบเช็คชื่อใหม่ (วันที่ / คาบเรียน)</option>`
                : !sessions.length
                  ? `<option value="new" selected>ยังไม่มีรอบเช็คชื่อที่บันทึกไว้</option>`
                  : ''
            }
            ${sessions.length ? `<optgroup label="รอบที่บันทึกไว้">${[...sessions].reverse().map(sessionOption).join('')}</optgroup>` : ''}
          </select>
        </label>
        <label class="cr-field cr-session-bar__date">
          <span class="cr-label">วันที่</span>
          <input type="date" class="cr-input" data-date value="${escapeHtml(date)}" ${isViewer ? 'disabled' : ''} />
        </label>
        <label class="cr-field cr-session-bar__period">
          <span class="cr-label">คาบเรียน / รอบ</span>
          <input class="cr-input" data-period value="${escapeHtml(period)}" placeholder="เช่น คาบที่ 1" ${isViewer ? 'disabled' : ''} />
        </label>
        <div class="cr-field cr-session-bar__mode">
          <span class="cr-label">ชื่อหัวช่อง (Sheet / Excel)</span>
          <div class="cr-seg cr-seg--header-mode" role="radiogroup" aria-label="เลือกรูปแบบการแสดงชื่อหัวช่อง">
            <button type="button" role="radio" aria-checked="${headerMode === 'both'}" class="cr-seg__btn ${headerMode === 'both' ? 'is-on' : ''}" data-header-mode="both" ${isViewer ? 'disabled' : ''}>ทั้ง 2 (2 บรรทัด)</button>
            <button type="button" role="radio" aria-checked="${headerMode === 'period'}" class="cr-seg__btn ${headerMode === 'period' ? 'is-on' : ''}" data-header-mode="period" ${isViewer ? 'disabled' : ''}>แค่คาบ</button>
            <button type="button" role="radio" aria-checked="${headerMode === 'date'}" class="cr-seg__btn ${headerMode === 'date' ? 'is-on' : ''}" data-header-mode="date" ${isViewer ? 'disabled' : ''}>แค่วันที่</button>
          </div>
        </div>
        <div class="cr-field cr-session-bar__preview" aria-live="polite">
          <span class="cr-label">ตัวอย่างในช่อง</span>
          <div class="cr-header-preview" data-header-preview>${renderHeaderPreviewHtml()}</div>
        </div>
        ${
          !isViewer
            ? `<div class="cr-session-bar__actions">
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
              </div>`
            : ''
        }
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
              <p class="cr-muted">${canSeeSettings ? 'เพิ่มรายชื่อนักเรียนในแท็บตั้งค่าก่อนเริ่มเช็คชื่อ' : 'เจ้าของห้องเรียนยังไม่ได้เพิ่มรายชื่อนักเรียน'}</p>
              ${canSeeSettings ? `<button type="button" class="cr-btn cr-btn--primary mt-4" data-goto-settings>${icon('plus', 16)}<span>ไปเพิ่มรายชื่อ</span></button>` : ''}
            </div>`
      }
      <div class="cr-sticky-footer" role="region" aria-label="สรุปการมาเรียน">
        <div class="cr-sticky-footer__sum" data-summary aria-live="polite">${summaryHtml()}</div>
        <div class="flex items-center gap-3">
          ${
            isViewer
              ? roleBadgeHtml('viewer', 'โหมดผู้ชม (ดูได้อย่างเดียว)')
              : `<span class="cr-unsaved ${dirty ? '' : 'hidden'}" data-dirty><span class="cr-dot cr-dot--amber"></span><span>ยังไม่ได้บันทึก</span></span>
                 <button type="button" class="cr-btn cr-btn--primary" data-save ${students.length ? '' : 'disabled'}>
                   ${icon('check', 16)}
                   <span>บันทึกการมาเรียน</span>
                 </button>`
          }
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
    if (isViewer) return;
    const modeBtn = t.closest<HTMLButtonElement>('[data-header-mode]');
    if (modeBtn && !modeBtn.disabled) {
      const nextMode = modeBtn.dataset.headerMode as SessionHeaderMode;
      if (nextMode !== headerMode) {
        headerMode = nextMode;
        defaultHeaderMode = nextMode;
        room.attendanceHeaderMode = nextMode;
        root.querySelectorAll<HTMLButtonElement>('[data-header-mode]').forEach((btn) => {
          const on = btn.dataset.headerMode === nextMode;
          btn.classList.toggle('is-on', on);
          btn.setAttribute('aria-checked', String(on));
        });
        updateHeaderPreview();
        if (selectedId !== 'new') setDirty(true);
        void saveClassroom({ ...room, attendanceHeaderMode: nextMode }).then(() => {
          if (google) scheduleAppDataSync();
        });
      }
      return;
    }
    const b = t.closest<HTMLButtonElement>('[data-st]');
    if (b && !b.disabled) {
      const sid = b.dataset.sid!;
      const st = b.dataset.st as AttendanceStatus;
      if (draft[sid] === st) delete draft[sid];
      else draft[sid] = st;
      updateRow(sid);
      updateSummary();
      setDirty(true);
      return;
    }
    if (t.closest('[data-goto-settings]') && canSeeSettings) {
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
      updateHeaderPreview();
      setDirty(true);
    }
  };
  root.oninput = (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches('[data-period]')) {
      period = t.value;
      updateHeaderPreview();
      setDirty(true);
    }
  };

  async function save(btn: HTMLButtonElement): Promise<void> {
    if (!date) return toast('กรุณาเลือกวันที่', 'warn');
    if (headerMode === 'period' && !period.trim()) {
      toast('กรุณาระบุชื่อคาบเรียน / รอบ', 'warn');
      root.querySelector<HTMLInputElement>('[data-period]')?.focus();
      return;
    }
    const existing = sessions.find((s) => s.id === selectedId);
    const trimmedPeriod = period.trim();
    const nextHeader = sessionHeaderText({ date, period: trimmedPeriod, headerMode });
    const dup = sessions.find(
      (s) =>
        s.id !== selectedId &&
        (sessionHeaderText(s) === nextHeader || (s.date === date && s.period.trim() === trimmedPeriod)),
    );
    if (dup && !(await confirmDialog(`มีรอบ "${sessionLabel(dup)}" อยู่แล้ว ต้องการบันทึกเป็นอีกรอบหรือไม่?`, { confirmText: 'บันทึกเป็นรอบใหม่' }))) return;
    const c = counts();
    if (c.none > 0 && !(await confirmDialog(`ยังไม่ระบุสถานะ ${c.none} คน — บันทึกเลยหรือไม่?`, { confirmText: 'บันทึกเลย' }))) return;

    await withBusy(btn, 'กำลังบันทึก...', async () => {
      const now = Date.now();
      defaultHeaderMode = headerMode;
      if (room.attendanceHeaderMode !== headerMode) {
        room.attendanceHeaderMode = headerMode;
        await saveClassroom({ ...room, attendanceHeaderMode: headerMode });
      }
      const session: AttendanceSession = existing
        ? { ...existing, date, period: trimmedPeriod, headerMode, records: { ...draft }, sheetSynced: false }
        : { id: uid(), classroomId: room.id, date, period: trimmedPeriod, headerMode, records: { ...draft }, sheetColumn: null, sheetSynced: false, createdAt: now, updatedAt: now };
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
