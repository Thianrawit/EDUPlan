// ============================================================
// EDUPLAN Class — Classroom Hub (การ์ดห้องเรียน + ห้องเรียนร่วม + แจ้งเตือนโหมด Local + Wizard สร้างห้อง)
// ============================================================
import { countStudents, deleteClassroom, listClassrooms, replaceStudents, saveClassroom } from '../db';
import { readWorkbook, type WorkbookSheet } from '../excelService';
import { getAuthState, signIn } from '../googleAuth';
import {
  fetchSharedClassrooms,
  getSpreadsheetMeta,
  importSharedRoomViaPicker,
  leaveSharedClassroom,
  loadSheetGrid,
  pickSpreadsheet,
  scheduleAppDataSync,
  syncAppData,
  syncClassroomDriveProperties,
  syncSpreadsheetSyncMeta,
  upgradeToStandardSheet,
  type SheetInfo,
} from '../googleSheets';
import {
  classroomTitle,
  currentAcademicYear,
  currentTerm,
  errorMessage,
  escapeHtml,
  getEffectiveRole,
  icon,
  roleBadgeHtml,
  safeHttpsUrl,
  uid,
  type AppContext,
  type Classroom,
  type ColumnMapping,
  type ParsedStudent,
  type Student,
} from '../types';
import { confirmDialog, openColumnMapper, openModal, toast, withBusy, type MapperResult, type MapperSource } from './ColumnMapperModal';

const CARD_THEMES = ['blue', 'purple', 'emerald', 'indigo'] as const;
const SHARED_FETCH_COOLDOWN_MS = 10_000;
let sharedFetchInFlight = false;
let lastSharedFetchAt = 0;

export async function renderHub(root: HTMLElement, ctx: AppContext): Promise<void> {
  const auth = getAuthState();
  const allRooms = await listClassrooms();
  const rooms = allRooms.filter((r) => auth.signedIn || (!r.isSharedWithMe && (!r.role || r.role === 'owner')));
  const counts = await Promise.all(rooms.map((r) => countStudents(r.id)));

  // ค้นหาห้องเรียนที่ถูกแชร์มาให้เพิ่มเติมแบบไม่บล็อกการเรนเดอร์ครั้งแรก และเว้นช่วงไม่ยิงซ้ำถี่เกินไป
  if (auth.signedIn && auth.tokenValid && !sharedFetchInFlight && Date.now() - lastSharedFetchAt > SHARED_FETCH_COOLDOWN_MS) {
    sharedFetchInFlight = true;
    fetchSharedClassrooms()
      .then(async () => {
        lastSharedFetchAt = Date.now();
        const after = (await listClassrooms()).filter((r) => auth.signedIn || (!r.isSharedWithMe && (!r.role || r.role === 'owner')));
        const beforeKey = rooms.map((r) => `${r.id}:${r.role ?? 'owner'}:${r.name}:${r.subject}:${r.ownerEmail ?? ''}`).join('|');
        const afterKey = after.map((r) => `${r.id}:${r.role ?? 'owner'}:${r.name}:${r.subject}:${r.ownerEmail ?? ''}`).join('|');
        if (beforeKey !== afterKey && root.querySelector('[data-hub-page]')) {
          ctx.refresh();
        }
      })
      .catch((err) => console.warn('[EduPlan Class] fetchSharedClassrooms warning:', err))
      .finally(() => {
        sharedFetchInFlight = false;
      });
  }

  const localAdvisoryHtml = !auth.signedIn
    ? `<div class="cr-local-advisory" role="region" aria-label="คำแนะนำโหมดเก็บข้อมูล">
        <div class="cr-local-advisory__icon" aria-hidden="true">${icon('warning', 22)}</div>
        <div class="cr-local-advisory__content">
          <div class="cr-local-advisory__title-row">
            <strong>คุณกำลังใช้งาน "โหมดในเครื่อง (Local)"</strong>
            <span class="cr-local-advisory__tag">สำคัญ</span>
          </div>
          <p>
            โหมดในเครื่อง (Local) จะเป็นการเก็บข้อมูลแค่ภายในเครื่องนี้เท่านั้น
            หากต้องการใช้งานห้องเรียนที่คุณสร้างในหลายอุปกรณ์ <b class="cr-underline-accent">ควรเข้าสู่ระบบด้วย Google</b> เพื่อซิงก์ข้อมูลอัตโนมัติ
          </p>
        </div>
        ${
          auth.configured
            ? `<button type="button" class="cr-btn cr-btn--primary cr-btn--sm cr-local-advisory__cta" data-hub-login ${auth.busy ? 'disabled' : ''}>
                ${icon('cloud-up', 16)}
                <span>เข้าสู่ระบบด้วย Google</span>
              </button>`
            : ''
        }
      </div>`
    : auth.needsReconnect
      ? `<div class="cr-local-advisory" role="region" aria-label="แจ้งเตือนอัปเดตสิทธิ์บัญชี Google">
          <div class="cr-local-advisory__icon" aria-hidden="true">${icon('refresh', 22)}</div>
          <div class="cr-local-advisory__content">
            <div class="cr-local-advisory__title-row">
              <strong>กรุณาเชื่อมต่อบัญชี Google ใหม่เพื่ออัปเดตสิทธิ์ซิงก์</strong>
              <span class="cr-local-advisory__tag">อัปเดตระบบ</span>
            </div>
            <p>
              ระบบได้เพิ่มสิทธิ์อ่านข้อมูลไฟล์ร่วม และสิทธิ์ Google Sheets เพื่อให้เปิดห้องเรียนที่ถูกเชิญได้ทันทีโดยไม่ติด Error 404
            </p>
          </div>
          <button type="button" class="cr-btn cr-btn--primary cr-btn--sm cr-local-advisory__cta" data-hub-reconnect ${auth.busy ? 'disabled' : ''}>
            ${icon('refresh', 16)}
            <span>เชื่อมต่อสิทธิ์ Google ใหม่</span>
          </button>
        </div>`
      : '';

  const renderRoomCard = (r: Classroom, i: number) => {
    const google = r.syncMode === 'google';
    const role = getEffectiveRole(r);
    const isOwner = role === 'owner';
    const canSeeSheetLink = isOwner || role === 'creator';
    const theme = CARD_THEMES[i % CARD_THEMES.length];
    const roleBadge = roleBadgeHtml(role);

    return `
      <article class="cr-room-card cr-room-card--${theme} ${!isOwner ? 'is-shared-room' : ''}" data-open="${r.id}" tabindex="0" role="button" aria-label="เปิดห้อง ${escapeHtml(classroomTitle(r))}">
        <div class="cr-room-card__top">
          <div class="flex flex-wrap items-center gap-1.5">
            ${roleBadge}
            <span class="cr-badge ${google ? 'cr-badge--green' : 'cr-badge--gray'}">
              <span class="cr-dot ${google ? 'cr-dot--green' : 'cr-dot--gray'}"></span>
              <span>${google ? 'ซิงก์ Google Sheet' : 'ในเครื่อง (Local)'}</span>
            </span>
          </div>
          <div class="cr-room-card__actions">
            ${isOwner && !google && auth.signedIn ? `<button type="button" class="cr-icon-btn" data-upgrade="${r.id}" title="สร้าง Google Sheet และซิงก์ห้องนี้" aria-label="อัปโหลดขึ้น Google Sheet">${icon('cloud-up', 16)}</button>` : ''}
            ${(() => {
              const url = google && canSeeSheetLink ? safeHttpsUrl(r.sheet?.spreadsheetUrl) : '';
              return url
                ? `<a class="cr-icon-btn" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" data-stop title="เปิดไฟล์ Google Sheet" aria-label="เปิดไฟล์ Google Sheet">${icon('external', 16)}</a>`
                : '';
            })()}
            ${
              isOwner
                ? `<button type="button" class="cr-icon-btn cr-icon-btn--danger" data-del="${r.id}" title="ลบห้องเรียน" aria-label="ลบห้องเรียน">${icon('trash', 16)}</button>`
                : `<button type="button" class="cr-btn cr-btn--outline cr-btn--xs cr-text-danger" data-leave-shared="${r.id}" title="ออกจากห้องเรียนร่วมนี้">${icon('logout', 13)}<span>ออกจากห้องร่วม</span></button>`
            }
          </div>
        </div>
        <div class="cr-room-card__body-head">
          <span class="cr-room-card__emblem" aria-hidden="true">${icon('users', 20)}</span>
          <div>
            <h2 class="cr-room-card__subject">${escapeHtml(r.subject || 'ไม่ระบุวิชา')}</h2>
            <p class="cr-room-card__room">${escapeHtml(r.name || 'ไม่ระบุชั้น/ห้อง')}</p>
            ${!isOwner ? `<p class="cr-room-card__owner">เจ้าของห้อง: <b>${escapeHtml(r.ownerEmail || 'ไม่ระบุ')}</b></p>` : ''}
          </div>
        </div>
        <dl class="cr-room-card__meta">
          <div class="cr-room-card__stat"><dt>ภาคเรียน / ปีการศึกษา</dt><dd>${escapeHtml(r.term || '-')}/${escapeHtml(r.academicYear || '-')}</dd></div>
          <div class="cr-room-card__stat"><dt>จำนวนนักเรียน</dt><dd>${counts[i] ? `${counts[i]} คน` : !isOwner ? 'คลิกเพื่อซิงก์รายชื่อ' : '0 คน'}</dd></div>
        </dl>
      </article>`;
  };

  root.innerHTML = `
    <section class="cr-page" data-hub-page>
      ${localAdvisoryHtml}
      <header class="cr-page__head cr-hub-hero">
        <div class="cr-hub-hero__left">
          <h1 class="cr-h1">คลังห้องเรียนของคุณ</h1>
          <p class="cr-muted">${rooms.length ? `ทั้งหมด ${rooms.length} ห้องเรียน — คลิกการ์ดเพื่อเข้าเช็คชื่อการมาเรียนและติดตามงาน` : 'สร้างห้องเรียนเพื่อเริ่มเช็คชื่อ ติดตามงาน และส่งออกรายงาน Excel'}</p>
        </div>
        <div class="cr-hub-hero__actions">
          ${
            auth.signedIn
              ? `<button type="button" class="cr-btn cr-btn--outline" data-import-shared ${auth.busy ? 'disabled' : ''} title="เลือกไฟล์ Google Sheet ห้องเรียนที่เพื่อนแชร์มาให้คุณ">
                  ${icon('download', 17)}
                  <span>รับห้องเรียนที่ถูกแชร์</span>
                </button>`
              : ''
          }
          <button type="button" class="cr-btn cr-btn--primary" data-add-room>
            ${icon('plus', 17)}
            <span>เพิ่มห้องเรียน</span>
          </button>
        </div>
      </header>
      ${
        rooms.length
          ? `<div class="cr-room-grid">
              ${rooms.map((r, i) => renderRoomCard(r, i)).join('')}
            </div>`
          : `<div class="cr-empty">
              <div class="cr-empty__icon" aria-hidden="true">${icon('users', 28)}</div>
              <h2 class="cr-h2">ยังไม่มีห้องเรียนในคลัง</h2>
              <p class="cr-muted">สร้างห้องเรียนได้ทันทีด้วยการพิมพ์รายชื่อเอง นำเข้าจากไฟล์ Excel (.xlsx)${auth.signedIn ? ' หรือเชื่อมกับ Google Sheet ที่มีอยู่' : ''}</p>
              <button type="button" class="cr-btn cr-btn--primary mt-4" data-add-room>
                ${icon('plus', 17)}
                <span>เพิ่มห้องเรียนแรก</span>
              </button>
            </div>`
      }
    </section>`;

  const pageEl = root.querySelector<HTMLElement>('[data-hub-page]');
  if (!pageEl) return;

  pageEl.onclick = async (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-stop]')) return;
    if (t.closest('[data-hub-login], [data-hub-reconnect]')) {
      e.stopPropagation();
      const force = !!t.closest('[data-hub-reconnect]');
      try {
        const p = await signIn(force);
        lastSharedFetchAt = Date.now();
        toast(`เชื่อมต่อแล้ว: ${p.email}`, 'success');
        const [changed, shared] = await Promise.all([syncAppData(), fetchSharedClassrooms().catch(() => [])]);
        if (changed) toast(`ดึงข้อมูลห้องเรียนจาก Google Drive แล้ว (${changed} รายการ)`, 'info');
        else if (shared.length) toast(`พบห้องเรียนที่ถูกเชิญ ${shared.length} ห้อง`, 'info');
        ctx.refresh();
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
      return;
    }
    const importBtn = t.closest<HTMLButtonElement>('[data-import-shared]');
    if (importBtn) {
      e.stopPropagation();
      await withBusy(importBtn, 'กำลังเปิด...', async () => {
        try {
          const importedRoom = await importSharedRoomViaPicker();
          if (importedRoom) {
            toast(`รับห้องเรียนร่วม "${classroomTitle(importedRoom)}" เรียบร้อยแล้ว`, 'success');
            ctx.refresh();
          }
        } catch (err) {
          toast(errorMessage(err), 'error');
        }
      });
      return;
    }
    if (t.closest('[data-add-room]')) {
      e.stopPropagation();
      openCreateWizard(ctx);
      return;
    }
    const up = t.closest<HTMLButtonElement>('[data-upgrade]');
    if (up) {
      e.stopPropagation();
      const ok = await confirmDialog('สร้างไฟล์ Google Sheet ใหม่ใน Drive ของคุณ (3 แท็บ: รายชื่อนักเรียน / การมาเรียน / การส่งงาน) แล้วซิงก์ห้องนี้อัตโนมัติ?', {
        title: 'อัปเกรดเป็นห้องซิงก์ออนไลน์',
        confirmText: 'สร้างไฟล์และซิงก์',
      });
      if (!ok) return;
      await withBusy(up, '', async () => {
        try {
          await upgradeToStandardSheet(up.dataset.upgrade!);
          toast('สร้าง Google Sheet และซิงก์ข้อมูลเรียบร้อย', 'success');
          ctx.refresh();
        } catch (err) {
          toast(errorMessage(err), 'error');
        }
      });
      return;
    }
    const leaveBtn = t.closest<HTMLButtonElement>('[data-leave-shared]');
    if (leaveBtn) {
      e.stopPropagation();
      const room = rooms.find((r) => r.id === leaveBtn.dataset.leaveShared);
      if (!room) return;
      const ok = await confirmDialog(
        `ต้องการออกจากห้องเรียนร่วม "${classroomTitle(room)}" (เจ้าของห้อง: ${room.ownerEmail || '-'}) หรือไม่?\nระบบจะถอนสิทธิ์การเข้าถึงของคุณและนำห้องออกจากคลังทันที`,
        { title: 'ออกจากห้องร่วม', confirmText: 'ออกจากห้องร่วม', danger: true },
      );
      if (!ok) return;
      await withBusy(leaveBtn, 'กำลังออก...', async () => {
        try {
          await leaveSharedClassroom(room);
          toast('ออกจากห้องเรียนร่วมแล้ว', 'info');
          ctx.refresh();
        } catch (err) {
          toast(errorMessage(err), 'error');
        }
      });
      return;
    }
    const del = t.closest<HTMLElement>('[data-del]');
    if (del) {
      e.stopPropagation();
      const room = rooms.find((r) => r.id === del.dataset.del);
      if (!room) return;
      const ok = await confirmDialog(
        `ลบห้อง "${classroomTitle(room)}" พร้อมรายชื่อ ประวัติเช็คชื่อ และคะแนนงานทั้งหมด?${room.syncMode === 'google' ? '\n(ไฟล์ Google Sheet ใน Drive จะไม่ถูกลบ)' : ''}`,
        { title: 'ลบห้องเรียน', confirmText: 'ลบห้องเรียน', danger: true },
      );
      if (!ok) return;
      await deleteClassroom(room.id);
      if (room.syncMode === 'google') scheduleAppDataSync(0);
      toast('ลบห้องเรียนแล้ว', 'info');
      ctx.refresh();
      return;
    }
    const card = t.closest<HTMLElement>('[data-open]');
    if (card) {
      ctx.openRoom(card.dataset.open!);
      return;
    }
  };
  pageEl.onkeydown = (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('[data-open]');
    if (card && e.target === card && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      card.click();
    }
  };
}

// ---------------- Create Wizard ----------------
type Method = 'manual' | 'excel' | 'sheet';
interface ManualRow {
  number: string;
  code: string;
  name: string;
}

function emptyRows(n: number, from = 0): ManualRow[] {
  return Array.from({ length: n }, (_, i) => ({ number: String(from + i + 1), code: '', name: '' }));
}

export function openCreateWizard(ctx: AppContext): void {
  const auth = getAuthState();
  let method: Method | null = null;
  const info = { name: '', subject: '', term: currentTerm(), academicYear: currentAcademicYear() };
  let rows: ManualRow[] = emptyRows(5);
  let imported: { source: string; students: ParsedStudent[]; result: MapperResult } | null = null;
  let excelSheets: WorkbookSheet[] = [];
  let picked: { id: string; name: string; url: string; sheets: SheetInfo[] } | null = null;
  let createSheet = true;

  const m = openModal({ title: 'เพิ่มห้องเรียนใหม่', size: 'lg', body: '<div data-wiz></div>', footer: '' });
  const root = m.body.querySelector('[data-wiz]') as HTMLElement;

  const infoFields = () => `
    <div class="cr-form-grid cr-form-grid--4">
      <label class="cr-field cr-span-2"><span class="cr-label">วิชา</span><input class="cr-input" data-info="subject" value="${escapeHtml(info.subject)}" placeholder="เช่น วิทยาศาสตร์ ว21101" /></label>
      <label class="cr-field cr-span-2"><span class="cr-label">ระดับชั้น/ห้อง</span><input class="cr-input" data-info="name" value="${escapeHtml(info.name)}" placeholder="เช่น ม.1/1" /></label>
      <label class="cr-field cr-span-2"><span class="cr-label">ภาคเรียน</span>
        <select class="cr-input" data-info="term">${['1', '2', '3', 'ฤดูร้อน'].map((t) => `<option ${info.term === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="cr-field cr-span-2"><span class="cr-label">ปีการศึกษา (พ.ศ.)</span><input class="cr-input" data-info="academicYear" inputmode="numeric" value="${escapeHtml(info.academicYear)}" /></label>
    </div>`;

  const manualTable = () => `
    <div class="cr-table-wrap cr-table-wrap--scroll">
      <table class="cr-table cr-table--edit">
        <thead><tr><th class="w-20 text-center">เลขที่</th><th class="w-40">รหัสนักเรียน</th><th>คำนำหน้า/ชื่อ-นามสกุล</th><th class="w-12 text-center"><span class="sr-only">ลบ</span></th></tr></thead>
        <tbody>
          ${rows
            .map(
              (r, i) => `<tr>
                <td><input class="cr-input cr-input--cell text-center" data-i="${i}" data-f="number" value="${escapeHtml(r.number)}" aria-label="เลขที่แถว ${i + 1}" /></td>
                <td><input class="cr-input cr-input--cell" data-i="${i}" data-f="code" value="${escapeHtml(r.code)}" aria-label="รหัสนักเรียนแถว ${i + 1}" /></td>
                <td><input class="cr-input cr-input--cell" data-i="${i}" data-f="name" value="${escapeHtml(r.name)}" placeholder="เช่น ด.ช.สมชาย ใจดี" aria-label="ชื่อแถว ${i + 1}" /></td>
                <td class="text-center"><button type="button" class="cr-icon-btn cr-icon-btn--danger" data-delrow="${i}" aria-label="ลบแถว ${i + 1}">${icon('x', 15)}</button></td>
              </tr>`,
            )
            .join('')}
        </tbody>
      </table>
    </div>
    <div class="flex flex-wrap items-center gap-2 mt-3">
      <button type="button" class="cr-btn cr-btn--outline cr-btn--sm" data-addrow="1">${icon('plus', 15)}<span>เพิ่มแถว</span></button>
      <button type="button" class="cr-btn cr-btn--ghost cr-btn--sm" data-addrow="10">${icon('plus', 15)}<span>เพิ่ม 10 แถว</span></button>
      <button type="button" class="cr-btn cr-btn--outline cr-btn--sm" data-renumber title="รันเลขที่ 1 ถึงลำดับสุดท้ายใหม่อัตโนมัติ">${icon('sort-number', 15)}<span>เรียงลำดับใหม่</span></button>
      <span class="cr-faint ml-auto">กด Enter ในช่องชื่อเพื่อเพิ่มแถวถัดไป</span>
    </div>`;

  const importedSummary = () =>
    imported
      ? `<div class="cr-import-ok">
          <div class="flex items-center gap-2">
            ${icon('check', 18)}
            <div>
              <strong>พร้อมนำเข้า ${imported.students.length} คน</strong>
              <span class="cr-muted block">จาก ${escapeHtml(imported.source)} · แถวหัวตารางที่ ${imported.result.mapping.headerRow + 1}</span>
            </div>
          </div>
          <button type="button" class="cr-btn cr-btn--outline cr-btn--sm" data-remap>${icon('edit', 14)}<span>ปรับการจับคู่คอลัมน์</span></button>
        </div>`
      : '';

  const render = () => {
    if (!method) {
      root.innerHTML = `
        <p class="cr-muted mb-4">เลือกวิธีตั้งต้นรายชื่อนักเรียนสำหรับห้องเรียนใหม่ของคุณ</p>
        <div class="cr-method-grid">
          <button type="button" class="cr-method cr-method--blue" data-method="manual">
            <div class="cr-method__top">
              <span class="cr-method__icon" aria-hidden="true">${icon('edit', 22)}</span>
              <span class="cr-method__tag">ทำได้ทันที</span>
            </div>
            <strong>พิมพ์รายชื่อเอง</strong>
            <span>กรอกเลขที่ รหัส และชื่อในตาราง พร้อมปุ่มรันลำดับเลขที่อัตโนมัติ</span>
          </button>
          <button type="button" class="cr-method cr-method--emerald" data-method="excel">
            <div class="cr-method__top">
              <span class="cr-method__icon" aria-hidden="true">${icon('upload', 22)}</span>
              <span class="cr-method__tag">นิยมใช้</span>
            </div>
            <strong>นำเข้าจากไฟล์ Excel (.xlsx)</strong>
            <span>อัปโหลดไฟล์ .xlsx เลือกแถวหัวตารางและจับคู่คอลัมน์ พร้อมพรีวิวตามไฟล์จริง</span>
          </button>
          <button type="button" class="cr-method cr-method--purple" data-method="sheet" ${auth.signedIn ? '' : 'disabled aria-disabled="true"'}>
            <div class="cr-method__top">
              <span class="cr-method__icon" aria-hidden="true">${icon('spreadsheet', 22)}</span>
              <span class="cr-method__tag">${auth.signedIn ? 'ซิงก์ออนไลน์' : 'ต้องล็อกอิน'}</span>
            </div>
            <strong>เชื่อมกับ Google Sheet ที่มีอยู่</strong>
            <span>${auth.signedIn ? 'เลือกไฟล์จาก Google Drive แล้วจับคู่แท็บและคอลัมน์ได้โดยตรง' : 'เข้าสู่ระบบด้วย Google ก่อนเพื่อเลือกไฟล์จาก Google Drive'}</span>
          </button>
        </div>`;
      m.footer.innerHTML = `<button type="button" class="cr-btn cr-btn--ghost" data-cancel>ยกเลิก</button>`;
      return;
    }
    let section = '';
    if (method === 'manual') section = `<h3 class="cr-h3">รายชื่อนักเรียน</h3>${manualTable()}`;
    if (method === 'excel')
      section = `
        <h3 class="cr-h3">ไฟล์ Excel รายชื่อนักเรียน (.xlsx)</h3>
        <label class="cr-dropzone">
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-file class="sr-only" />
          <span class="cr-dropzone__icon">${icon('upload', 24)}</span>
          <span>คลิกเพื่อเลือกไฟล์ Excel (.xlsx)</span>
          <span class="cr-faint">รองรับการเลือกแถวหัวตารางและแสดงเซลล์ที่ Merge ตามไฟล์จริง</span>
        </label>
        ${importedSummary()}`;
    if (method === 'sheet')
      section = `
        <h3 class="cr-h3">ไฟล์ Google Sheet</h3>
        <div class="flex flex-wrap items-center gap-3">
          <button type="button" class="cr-btn cr-btn--outline" data-pick>${icon('folder', 16)}<span>${picked ? 'เลือกไฟล์อื่น' : 'เลือกไฟล์จาก Google Drive'}</span></button>
          ${picked ? `<span class="cr-badge cr-badge--green"><span class="cr-dot cr-dot--green"></span><span>${escapeHtml(picked.name)}</span></span>` : ''}
        </div>
        ${importedSummary()}
        <p class="cr-faint mt-2">ระบบจะไม่เขียนทับรายชื่อในไฟล์เดิม — หลังสร้างห้องแล้วสามารถตั้งค่าคอลัมน์เช็คชื่อและส่งงานได้ในแท็บตั้งค่า</p>`;

    root.innerHTML = `
      <h3 class="cr-h3">ข้อมูลพื้นฐานของห้องเรียน</h3>
      ${infoFields()}
      <div class="mt-5">${section}</div>
      ${
        auth.signedIn && method !== 'sheet'
          ? `<label class="cr-check mt-5">
              <input type="checkbox" data-create-sheet ${createSheet ? 'checked' : ''} />
              <span><strong>สร้างไฟล์ Google Sheet ใหม่ใน Drive และซิงก์อัตโนมัติ (แนะนำ)</strong>
              <span class="cr-faint block">สร้าง 3 แท็บมาตรฐาน: รายชื่อนักเรียน / การมาเรียน / การส่งงาน</span></span>
            </label>`
          : ''
      }`;
    m.footer.innerHTML = `
      <button type="button" class="cr-btn cr-btn--ghost mr-auto" data-back>${icon('arrow-left', 15)}<span>เปลี่ยนวิธี</span></button>
      <button type="button" class="cr-btn cr-btn--ghost" data-cancel>ยกเลิก</button>
      <button type="button" class="cr-btn cr-btn--primary" data-create>${icon('check', 16)}<span>สร้างห้องเรียน</span></button>`;
  };

  const runMapper = async (sources: MapperSource[], label: string, initial?: { source: string; mapping: ColumnMapping }) => {
    const res = await openColumnMapper({
      title: 'เลือกแถวหัวตารางและจับคู่คอลัมน์',
      sources,
      initialSource: initial?.source,
      initialMapping: initial?.mapping,
      confirmText: 'ใช้รายชื่อนี้',
    });
    if (res) {
      imported = { source: `${label} › ${res.sheetName}`, students: res.students, result: res };
      render();
    }
  };

  const excelSources = (): MapperSource[] =>
    excelSheets.map((s) => ({ name: s.name, merges: s.merges, load: async () => s.rows }));
  const sheetSources = (): MapperSource[] =>
    picked ? picked.sheets.map((s) => ({ name: s.title, merges: s.merges, load: () => loadSheetGrid(picked!.id, s.title) })) : [];

  root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.info) (info as Record<string, string>)[t.dataset.info] = t.value;
    if (t.dataset.i !== undefined) rows[Number(t.dataset.i)][t.dataset.f as keyof ManualRow] = t.value;
  });
  root.addEventListener('change', async (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.info) (info as Record<string, string>)[t.dataset.info] = t.value;
    if (t.hasAttribute('data-create-sheet')) createSheet = t.checked;
    if (t.hasAttribute('data-file') && t.files?.[0]) {
      const file = t.files[0];
      try {
        excelSheets = await readWorkbook(file);
        await runMapper(excelSources(), file.name);
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
      t.value = '';
    }
  });
  root.addEventListener('keydown', (e) => {
    const t = e.target as HTMLInputElement;
    if (e.key === 'Enter' && t.dataset.f === 'name') {
      e.preventDefault();
      const i = Number(t.dataset.i);
      if (i === rows.length - 1) {
        rows.push(...emptyRows(1, rows.length));
        render();
      }
      root.querySelector<HTMLInputElement>(`input[data-i="${i + 1}"][data-f="name"]`)?.focus();
    }
  });
  root.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    const mb = t.closest<HTMLButtonElement>('[data-method]');
    if (mb && !mb.disabled) {
      method = mb.dataset.method as Method;
      render();
      return;
    }
    const add = t.closest<HTMLElement>('[data-addrow]');
    if (add) {
      rows.push(...emptyRows(Number(add.dataset.addrow), rows.length));
      render();
      root.querySelector<HTMLInputElement>(`input[data-i="${rows.length - Number(add.dataset.addrow)}"][data-f="name"]`)?.focus();
      return;
    }
    if (t.closest('[data-renumber]')) {
      rows.forEach((r, idx) => {
        r.number = String(idx + 1);
      });
      render();
      toast(`รันเลขที่ 1–${rows.length} ใหม่เรียบร้อย`, 'info');
      return;
    }
    const del = t.closest<HTMLElement>('[data-delrow]');
    if (del) {
      rows.splice(Number(del.dataset.delrow), 1);
      if (!rows.length) rows = emptyRows(1);
      render();
      return;
    }
    if (t.closest('[data-remap]') && imported) {
      const src = method === 'excel' ? excelSources() : sheetSources();
      await runMapper(src, imported.source.split(' › ')[0], { source: imported.result.sheetName, mapping: imported.result.mapping });
      return;
    }
    const pick = t.closest<HTMLButtonElement>('[data-pick]');
    if (pick) {
      try {
        const f = await pickSpreadsheet();
        if (!f) return;
        await withBusy(pick, 'กำลังอ่านไฟล์...', async () => {
          const meta = await getSpreadsheetMeta(f.id);
          picked = { id: f.id, name: meta.title, url: meta.url, sheets: meta.sheets };
          if (!info.subject) info.subject = meta.title;
        });
        imported = null;
        render();
        await runMapper(sheetSources(), picked!.name);
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    }
  });

  m.footer.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-cancel]')) return m.close();
    if (t.closest('[data-back]')) {
      method = null;
      render();
      return;
    }
    const createBtn = t.closest<HTMLButtonElement>('[data-create]');
    if (!createBtn) return;

    if (!info.subject.trim() && !info.name.trim()) {
      toast('กรุณากรอกชื่อวิชาหรือระดับชั้น/ห้อง', 'warn');
      root.querySelector<HTMLInputElement>('[data-info="subject"]')?.focus();
      return;
    }
    let list: ParsedStudent[];
    if (method === 'manual') {
      list = rows.filter((r) => r.name.trim()).map((r, i) => ({ number: r.number.trim() || String(i + 1), studentCode: r.code.trim(), fullName: r.name.trim() }));
    } else {
      if (!imported) {
        toast(method === 'excel' ? 'กรุณาเลือกไฟล์ Excel และยืนยันการจับคู่คอลัมน์' : 'กรุณาเลือกไฟล์ Google Sheet และยืนยันการจับคู่คอลัมน์', 'warn');
        return;
      }
      list = imported.students;
    }

    await withBusy(createBtn, 'กำลังสร้าง...', async () => {
      const now = Date.now();
      const room: Classroom = {
        id: uid(),
        name: info.name.trim(),
        subject: info.subject.trim(),
        term: info.term.trim(),
        academicYear: info.academicYear.trim(),
        syncMode: 'local',
        role: 'owner',
        collaborators: [],
        sheet: null,
        createdAt: now,
        updatedAt: now,
      };
      if (method === 'sheet' && picked && imported) {
        room.syncMode = 'google';
        room.sheetId = picked.id;
        room.isSharedWithMe = false;
        room.sheet = {
          spreadsheetId: picked.id,
          spreadsheetName: picked.name,
          spreadsheetUrl: picked.url,
          standard: false,
          roster: { sheetTitle: imported.result.sheetName, mapping: imported.result.mapping },
          attendance: null,
          assignments: null,
        };
      }
      await saveClassroom(room);
      const students: Student[] = list.map((s, i) => ({ id: uid(), classroomId: room.id, number: s.number, studentCode: s.studentCode, fullName: s.fullName, order: i, updatedAt: now }));
      await replaceStudents(room.id, students);

      if (auth.signedIn && method !== 'sheet' && createSheet) {
        try {
          await upgradeToStandardSheet(room.id);
          toast('สร้างห้องเรียนและไฟล์ Google Sheet เรียบร้อย', 'success');
        } catch (err) {
          toast(`สร้างห้องในเครื่องแล้ว แต่สร้าง Google Sheet ไม่สำเร็จ: ${errorMessage(err)}`, 'error');
        }
      } else {
        if (room.syncMode === 'google') {
          await syncClassroomDriveProperties(room).catch(() => undefined);
          await syncSpreadsheetSyncMeta(room).catch(() => undefined);
          scheduleAppDataSync(0);
        }
        toast(`สร้างห้องเรียนแล้ว (${students.length} คน)`, 'success');
      }
      m.close();
      ctx.openRoom(room.id, method === 'sheet' ? 'settings' : 'attendance');
    });
  });

  render();
}
