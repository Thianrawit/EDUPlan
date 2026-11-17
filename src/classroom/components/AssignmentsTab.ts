// ============================================================
// EDUPLAN Classroom — แท็บการส่งงาน (Assignments)
// ============================================================
import { deleteAssignment, getAssignments, getStudents, saveAssignment } from '../db';
import { pushAssignment, pushClassroom, scheduleAppDataSync } from '../googleSheets';
import { getAuthState } from '../googleAuth';
import {
  SUBMISSION_LABEL,
  errorMessage,
  escapeHtml,
  formatThaiDate,
  getEffectiveRole,
  icon,
  roleBadgeHtml,
  sortAssignments,
  todayISO,
  uid,
  type AppContext,
  type Assignment,
  type Classroom,
  type ClassroomRole,
  type Student,
  type Submission,
  type SubmissionStatus,
} from '../types';
import { confirmDialog, openModal, toast, withBusy } from './ColumnMapperModal';

const openedAssignment: Record<string, string | null> = {};

export async function renderAssignments(
  root: HTMLElement,
  room: Classroom,
  ctx: AppContext,
  currentRole: ClassroomRole = getEffectiveRole(room),
): Promise<void> {
  const isViewer = currentRole === 'viewer';
  const canSeeSettings = currentRole === 'owner' || currentRole === 'creator';
  const google = room.syncMode === 'google' && !!room.sheet;
  const sheetReady = google && (room.sheet!.standard || !!room.sheet!.assignments);

  // ---------- Sync Guard ----------
  if (google && !sheetReady) {
    root.innerHTML = `
      <div class="cr-guard">
        <div class="cr-guard__icon" aria-hidden="true">${icon('compass', 28)}</div>
        <h2 class="cr-h2">ตั้งค่าคอลัมน์สำหรับเก็บงานก่อน</h2>
        <p class="cr-muted">ห้องนี้เชื่อมกับ Google Sheet "${escapeHtml(room.sheet!.spreadsheetName)}" ${canSeeSettings ? 'กรุณาเลือกแท็บและคอลัมน์สำหรับบันทึกการส่งงานและคะแนน' : 'กรุณาแจ้งเจ้าของห้องเรียนให้ตั้งค่าคอลัมน์การส่งงานก่อน'}</p>
        ${
          canSeeSettings
            ? `<button type="button" class="cr-btn cr-btn--primary mt-4" data-goto-settings>
                ${icon('settings', 16)}
                <span>ไปตั้งค่าตารางและคอลัมน์</span>
              </button>`
            : ''
        }
      </div>`;
    root.onclick = (e) => {
      if (canSeeSettings && (e.target as HTMLElement).closest('[data-goto-settings]')) ctx.openRoom(room.id, 'settings');
    };
    root.onchange = null;
    root.oninput = null;
    return;
  }

  const students = await getStudents(room.id);
  let assignments = sortAssignments(await getAssignments(room.id));
  const openId = openedAssignment[room.id];
  const current = openId ? assignments.find((a) => a.id === openId) : undefined;
  if (current) renderDetail(current);
  else renderCards();

  // ---------- Cards view ----------
  function renderCards(): void {
    openedAssignment[room.id] = null;
    ctx.setDirty(false);
    root.innerHTML = `
      <div class="cr-section-head">
        <div>
          <h2 class="cr-h2">รายการงานที่มอบหมาย</h2>
          <p class="cr-muted">${assignments.length ? `ทั้งหมด ${assignments.length} ชิ้นงาน — คลิกการ์ดเพื่อ${isViewer ? 'ดูสถานะการส่งงานและคะแนน' : 'ตรวจการส่งงานและบันทึกคะแนน'}` : 'ยังไม่มีชิ้นงานในห้องเรียนนี้'}</p>
        </div>
        ${
          !isViewer
            ? `<button type="button" class="cr-btn cr-btn--primary" data-add-assignment>
                ${icon('plus', 17)}
                <span>เพิ่มงาน</span>
              </button>`
            : ''
        }
      </div>
      ${
        assignments.length
          ? `<div class="cr-asg-grid">${[...assignments]
              .reverse()
              .map((a) => {
                const sent = students.filter((s) => a.submissions[s.id]?.status === 'submitted').length;
                const pct = students.length ? Math.round((sent / students.length) * 100) : 0;
                const overdue = a.dueDate && a.dueDate < todayISO() && sent < students.length;
                return `
                <article class="cr-asg-card" data-open="${a.id}" tabindex="0" role="button" aria-label="ตรวจงาน ${escapeHtml(a.title)}">
                  <div class="cr-asg-card__top">
                    <h3 class="cr-asg-card__title">${escapeHtml(a.title)}</h3>
                    ${
                      !isViewer
                        ? `<div class="cr-room-card__actions">
                            <button type="button" class="cr-icon-btn" data-edit="${a.id}" aria-label="แก้ไขงาน" title="แก้ไขงาน">${icon('edit', 15)}</button>
                            <button type="button" class="cr-icon-btn cr-icon-btn--danger" data-del="${a.id}" aria-label="ลบงาน" title="ลบงาน">${icon('trash', 15)}</button>
                          </div>`
                        : ''
                    }
                  </div>
                  <dl class="cr-asg-card__meta">
                    <div><dt>วันที่สั่ง</dt><dd>${formatThaiDate(a.assignedDate)}</dd></div>
                    <div><dt>กำหนดส่ง</dt><dd class="${overdue ? 'cr-text-danger' : ''}">${formatThaiDate(a.dueDate)}</dd></div>
                    <div><dt>คะแนนเต็ม</dt><dd>${a.maxScore ?? '-'}</dd></div>
                  </dl>
                  <div class="cr-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${students.length}" aria-valuenow="${sent}" aria-label="ส่งแล้ว ${sent} จาก ${students.length} คน">
                    <div class="cr-progress__bar" style="width:${pct}%"></div>
                  </div>
                  <div class="cr-asg-card__foot">
                    <span>ส่งแล้ว <b>${sent}</b>/${students.length} คน</span>
                    ${google && !a.sheetSynced ? `<span class="cr-badge cr-badge--amber">${icon('warning', 13)}<span>รอซิงก์</span></span>` : `<span class="cr-faint">${pct}%</span>`}
                  </div>
                </article>`;
              })
              .join('')}</div>`
          : `<div class="cr-empty">
              <div class="cr-empty__icon" aria-hidden="true">${icon('clipboard', 28)}</div>
              <h2 class="cr-h2">ยังไม่มีงานในห้องเรียนนี้</h2>
              <p class="cr-muted">${!isViewer ? 'กดปุ่ม "+ เพิ่มงาน" เพื่อสร้างชิ้นงานและเริ่มติดตามการส่งงานของนักเรียน' : 'ยังไม่มีชิ้นงานที่ถูกมอบหมายในห้องเรียนนี้'}</p>
              ${
                !isViewer
                  ? `<button type="button" class="cr-btn cr-btn--primary mt-4" data-add-assignment>
                      ${icon('plus', 17)}
                      <span>เพิ่มงานชิ้นแรก</span>
                    </button>`
                  : ''
              }
            </div>`
      }`;

    root.onclick = async (e) => {
      const t = e.target as HTMLElement;
      if (!isViewer && t.closest('[data-add-assignment]')) {
        e.stopPropagation();
        openAssignmentModal(null);
        return;
      }
      const ed = !isViewer ? t.closest<HTMLElement>('[data-edit]') : null;
      if (ed) {
        e.stopPropagation();
        const a = assignments.find((x) => x.id === ed.dataset.edit);
        if (a) openAssignmentModal(a);
        return;
      }
      const del = !isViewer ? t.closest<HTMLElement>('[data-del]') : null;
      if (del) {
        e.stopPropagation();
        const a = assignments.find((x) => x.id === del.dataset.del);
        if (!a) return;
        const ok = await confirmDialog(
          `ลบงาน "${a.title}" พร้อมข้อมูลการส่งงานและคะแนน?${google && !room.sheet!.standard ? '\n(คอลัมน์ใน Google Sheet ไฟล์เดิมจะไม่ถูกลบ)' : ''}`,
          { title: 'ลบงาน', confirmText: 'ลบงาน', danger: true },
        );
        if (!ok) return;
        await deleteAssignment(a);
        assignments = assignments.filter((x) => x.id !== a.id);
        toast('ลบงานแล้ว', 'info');
        if (google && room.sheet!.standard && getAuthState().signedIn) pushClassroom(room.id).catch((err) => toast(errorMessage(err), 'error'));
        if (google) scheduleAppDataSync();
        renderCards();
        return;
      }
      const card = t.closest<HTMLElement>('[data-open]');
      if (card) {
        const a = assignments.find((x) => x.id === card.dataset.open);
        if (a) renderDetail(a);
      }
    };
    root.onkeydown = (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('[data-open]');
      if (card && e.target === card && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        card.click();
      }
    };
    root.onchange = null;
    root.oninput = null;
  }

  // ---------- Add / Edit modal ----------
  function openAssignmentModal(edit: Assignment | null): void {
    const m = openModal({
      title: edit ? 'แก้ไขข้อมูลงาน' : 'เพิ่มงานใหม่',
      size: 'md',
      body: `
        <form data-form class="cr-form-grid cr-form-grid--2" novalidate>
          <label class="cr-field cr-span-2"><span class="cr-label">ชื่องาน *</span><input class="cr-input" name="title" required value="${escapeHtml(edit?.title ?? '')}" placeholder="เช่น ใบงานที่ 1 เรื่องเซลล์" /></label>
          <label class="cr-field"><span class="cr-label">วันที่สั่ง</span><input type="date" class="cr-input" name="assignedDate" value="${escapeHtml(edit?.assignedDate ?? todayISO())}" /></label>
          <label class="cr-field"><span class="cr-label">กำหนดส่ง</span><input type="date" class="cr-input" name="dueDate" value="${escapeHtml(edit?.dueDate ?? '')}" /></label>
          <label class="cr-field cr-span-2"><span class="cr-label">คะแนนเต็ม (ไม่บังคับ)</span><input type="number" min="0" step="0.5" class="cr-input" name="maxScore" value="${edit?.maxScore ?? ''}" placeholder="เว้นว่างได้หากเช็คเฉพาะสถานะการส่ง" /></label>
          <button type="submit" class="hidden" aria-hidden="true" tabindex="-1"></button>
        </form>`,
      footer: `<button type="button" class="cr-btn cr-btn--ghost" data-cancel>ยกเลิก</button><button type="button" class="cr-btn cr-btn--primary" data-ok>${icon('check', 16)}<span>บันทึกงาน</span></button>`,
    });
    const form = m.body.querySelector('form') as HTMLFormElement;
    const submit = async () => {
      const fd = new FormData(form);
      const title = String(fd.get('title') ?? '').trim();
      if (!title) {
        toast('กรุณากรอกชื่องาน', 'warn');
        (form.elements.namedItem('title') as HTMLInputElement).focus();
        return;
      }
      const assignedDate = String(fd.get('assignedDate') ?? '') || todayISO();
      const dueDate = String(fd.get('dueDate') ?? '');
      if (dueDate && dueDate < assignedDate) {
        toast('กำหนดส่งต้องไม่ก่อนวันที่สั่ง', 'warn');
        return;
      }
      const raw = String(fd.get('maxScore') ?? '').trim();
      const maxScore = raw === '' ? null : Number(raw);
      if (maxScore !== null && (Number.isNaN(maxScore) || maxScore < 0)) {
        toast('คะแนนเต็มต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป', 'warn');
        return;
      }
      const now = Date.now();
      const a: Assignment = edit
        ? { ...edit, title, assignedDate, dueDate, maxScore, sheetSynced: false }
        : { id: uid(), classroomId: room.id, title, assignedDate, dueDate, maxScore, submissions: {}, sheetColumn: null, sheetSynced: false, createdAt: now, updatedAt: now };
      await saveAssignment(a);
      m.close();
      assignments = sortAssignments([...assignments.filter((x) => x.id !== a.id), a]);
      toast(edit ? 'บันทึกการแก้ไขงานแล้ว' : 'เพิ่มงานแล้ว', 'success');
      if (google) {
        if (getAuthState().signedIn) pushAssignment(room.id, a).catch((err) => toast(`อัปเดต Google Sheet ไม่สำเร็จ: ${errorMessage(err)}`, 'error'));
        scheduleAppDataSync();
      }
      renderCards();
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void submit();
    });
    m.footer.querySelector('[data-ok]')!.addEventListener('click', () => void submit());
    m.footer.querySelector('[data-cancel]')!.addEventListener('click', () => m.close());
  }

  // ---------- Detail (ตรวจงานรายชิ้น) ----------
  function renderDetail(a: Assignment): void {
    openedAssignment[room.id] = a.id;
    const draft: Record<string, Submission> = {};
    students.forEach((s) => {
      const sub = a.submissions[s.id];
      draft[s.id] = { status: sub?.status ?? 'missing', score: sub?.score ?? null };
    });
    let dirty = false;
    const setDirty = (v: boolean) => {
      if (isViewer) return;
      dirty = v;
      ctx.setDirty(v);
      root.querySelector('[data-dirty]')?.classList.toggle('hidden', !v);
    };

    const summary = () => {
      const sent = students.filter((s) => draft[s.id].status === 'submitted').length;
      const scores = students.map((s) => draft[s.id].score).filter((x): x is number => x !== null);
      const avg = scores.length ? (scores.reduce((x, y) => x + y, 0) / scores.length).toFixed(2) : '-';
      return `
        <span class="cr-sum cr-sum--present">ส่งแล้ว: <b>${sent}</b> คน</span>
        <span class="cr-sum cr-sum--absent">ยังไม่ส่ง: <b>${students.length - sent}</b> คน</span>
        <span class="cr-sum cr-sum--none">ใส่คะแนนแล้ว: <b>${scores.length}</b> คน · เฉลี่ย ${avg}</span>`;
    };

    root.innerHTML = `
      <div class="cr-detail-head">
        <button type="button" class="cr-btn cr-btn--outline cr-btn--sm" data-back>
          ${icon('arrow-left', 15)}
          <span>กลับไปหน้ารวมงาน</span>
        </button>
        <div class="cr-detail-head__info">
          <h2 class="cr-h2">${escapeHtml(a.title)}</h2>
          <p class="cr-muted">วันที่สั่ง ${formatThaiDate(a.assignedDate)} · กำหนดส่ง ${formatThaiDate(a.dueDate)} · คะแนนเต็ม ${a.maxScore ?? 'ไม่กำหนด'}</p>
        </div>
        ${
          !isViewer
            ? `<button type="button" class="cr-btn cr-btn--soft-green cr-btn--sm ml-auto" data-all-submitted ${students.length ? '' : 'disabled'}>
                ${icon('check-all', 16)}
                <span>ส่งแล้วทั้งหมด</span>
              </button>`
            : ''
        }
      </div>
      ${
        students.length
          ? `<div class="cr-table-wrap">
              <table class="cr-table cr-table--att">
                <thead><tr><th class="w-16 text-center">เลขที่</th><th class="w-36">รหัสนักเรียน</th><th>ชื่อ-นามสกุล</th><th class="w-[230px] text-center">สถานะการส่ง</th><th class="w-44 text-center">คะแนน${a.maxScore !== null ? ` (เต็ม ${a.maxScore})` : ''}</th></tr></thead>
                <tbody>
                  ${students
                    .map((s: Student) => {
                      const d = draft[s.id];
                      return `<tr data-row="${s.id}" class="${d.status === 'submitted' ? 'is-present' : ''}">
                        <td class="text-center cr-num">${escapeHtml(s.number)}</td>
                        <td class="cr-num">${escapeHtml(s.studentCode) || '<span class="cr-faint">-</span>'}</td>
                        <td>${escapeHtml(s.fullName)}</td>
                        <td>
                          <div class="cr-seg cr-seg--status" role="radiogroup" aria-label="สถานะการส่งของ ${escapeHtml(s.fullName)}">
                            ${(['submitted', 'missing'] as SubmissionStatus[])
                              .map(
                                (k) => `<button type="button" role="radio" aria-checked="${d.status === k}" class="cr-seg__btn cr-seg__btn--${k === 'submitted' ? 'present' : 'absent'} ${d.status === k ? 'is-on' : ''}" data-sid="${s.id}" data-st="${k}" ${isViewer ? 'disabled' : ''}>${icon(k === 'submitted' ? 'check' : 'x', 14)}<span>${SUBMISSION_LABEL[k]}</span></button>`,
                              )
                              .join('')}
                          </div>
                        </td>
                        <td><input type="number" inputmode="decimal" min="0" ${a.maxScore !== null ? `max="${a.maxScore}"` : ''} step="0.5" class="cr-input cr-input--score" data-score="${s.id}" value="${d.score ?? ''}" placeholder="${isViewer ? '-' : 'ใส่คะแนน'}" aria-label="คะแนนของ ${escapeHtml(s.fullName)}" ${isViewer ? 'disabled readonly' : ''} /></td>
                      </tr>`;
                    })
                    .join('')}
                </tbody>
              </table>
            </div>`
          : `<div class="cr-empty"><h2 class="cr-h2">ยังไม่มีรายชื่อนักเรียน</h2>${canSeeSettings ? `<button type="button" class="cr-btn cr-btn--primary mt-4" data-goto-settings>${icon('plus', 16)}<span>ไปเพิ่มรายชื่อ</span></button>` : ''}</div>`
      }
      <div class="cr-sticky-footer" role="region" aria-label="สรุปการส่งงาน">
        <div class="cr-sticky-footer__sum" data-summary aria-live="polite">${summary()}</div>
        <div class="flex items-center gap-3">
          ${
            isViewer
              ? roleBadgeHtml('viewer', 'โหมดผู้ชม (ดูได้อย่างเดียว)')
              : `<span class="cr-unsaved hidden" data-dirty><span class="cr-dot cr-dot--amber"></span><span>ยังไม่ได้บันทึก</span></span>
                 <button type="button" class="cr-btn cr-btn--primary" data-save ${students.length ? '' : 'disabled'}>
                   ${icon('check', 16)}
                   <span>บันทึกการส่งงาน</span>
                 </button>`
          }
        </div>
      </div>`;

    const refreshRow = (sid: string) => {
      const tr = root.querySelector<HTMLElement>(`tr[data-row="${sid}"]`);
      if (!tr) return;
      tr.className = draft[sid].status === 'submitted' ? 'is-present' : '';
      tr.querySelectorAll<HTMLButtonElement>('[data-st]').forEach((b) => {
        const on = draft[sid].status === b.dataset.st;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-checked', String(on));
      });
      const sumEl = root.querySelector('[data-summary]');
      if (sumEl) sumEl.innerHTML = summary();
    };

    const leave = async () =>
      !dirty || (await confirmDialog('มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก ต้องการละทิ้งหรือไม่?', { confirmText: 'ละทิ้งการเปลี่ยนแปลง', danger: true }));

    root.onclick = async (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-back]')) {
        if (await leave()) {
          assignments = sortAssignments(await getAssignments(room.id));
          renderCards();
        }
        return;
      }
      if (isViewer) return;
      const b = t.closest<HTMLButtonElement>('[data-st]');
      if (b && !b.disabled) {
        const sid = b.dataset.sid!;
        draft[sid].status = b.dataset.st as SubmissionStatus;
        if (draft[sid].status === 'missing' && draft[sid].score !== null) {
          draft[sid].score = null;
          const inp = root.querySelector<HTMLInputElement>(`[data-score="${sid}"]`);
          if (inp) inp.value = '';
        }
        refreshRow(sid);
        setDirty(true);
        return;
      }
      if (t.closest('[data-all-submitted]')) {
        students.forEach((s) => {
          draft[s.id].status = 'submitted';
          refreshRow(s.id);
        });
        setDirty(true);
        return;
      }
      if (t.closest('[data-goto-settings]') && canSeeSettings) {
        ctx.openRoom(room.id, 'settings');
        return;
      }
      const sb = t.closest<HTMLButtonElement>('[data-save]');
      if (sb) await save(sb);
    };
    root.oninput = (e) => {
      if (isViewer) return;
      const inp = (e.target as HTMLElement).closest<HTMLInputElement>('[data-score]');
      if (!inp) return;
      const sid = inp.dataset.score!;
      const v = inp.value.trim();
      const n = v === '' ? null : Number(v);
      draft[sid].score = n !== null && !Number.isNaN(n) ? n : null;
      if (draft[sid].score !== null) draft[sid].status = 'submitted';
      inp.classList.toggle('is-invalid', n !== null && (Number.isNaN(n) || n < 0 || (a.maxScore !== null && n > a.maxScore)));
      refreshRow(sid);
      setDirty(true);
    };
    root.onkeydown = (e) => {
      const inp = (e.target as HTMLElement).closest<HTMLInputElement>('[data-score]');
      if (inp && e.key === 'Enter') {
        e.preventDefault();
        const all = [...root.querySelectorAll<HTMLInputElement>('[data-score]')];
        all[all.indexOf(inp) + 1]?.focus();
      }
    };
    root.onchange = null;

    async function save(btn: HTMLButtonElement): Promise<void> {
      const invalid = students.filter((s) => {
        const sc = draft[s.id].score;
        return sc !== null && (sc < 0 || (a.maxScore !== null && sc > a.maxScore));
      });
      if (invalid.length) {
        toast(`คะแนนไม่ถูกต้อง ${invalid.length} คน (ต้องอยู่ระหว่าง 0–${a.maxScore ?? '∞'})`, 'warn');
        return;
      }
      await withBusy(btn, 'กำลังบันทึก...', async () => {
        const updated: Assignment = { ...a, submissions: JSON.parse(JSON.stringify(draft)) as Record<string, Submission>, sheetSynced: false };
        await saveAssignment(updated);
        Object.assign(a, updated);
        setDirty(false);
        if (google && getAuthState().signedIn) {
          try {
            const r = await pushAssignment(room.id, updated);
            if (r?.unmatched.length) toast(`บันทึกแล้ว แต่หาแถวใน Google Sheet ไม่พบ ${r.unmatched.length} คน: ${r.unmatched.slice(0, 5).join(', ')}`, 'warn', 9000);
            else toast(`บันทึกการส่งงานและอัปเดต Google Sheet แล้ว${r?.column ? ` (คอลัมน์ ${r.column})` : ''}`, 'success');
          } catch (err) {
            toast(`บันทึกในเครื่องแล้ว แต่อัปเดต Google Sheet ไม่สำเร็จ: ${errorMessage(err)} — กด "ซิงก์ข้อมูล" เพื่อลองใหม่`, 'error');
          }
        } else if (google) {
          toast('บันทึกในเครื่องแล้ว — เข้าสู่ระบบ Google เพื่อส่งข้อมูลขึ้น Sheet', 'info');
        } else toast('บันทึกการส่งงานแล้ว', 'success');
        if (google) scheduleAppDataSync();
      });
    }
  }
}
