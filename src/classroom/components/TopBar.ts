// ============================================================
// EDUPLAN Class — Top Navigation Bar & Interactive Dummy-Stage Spotlight Tutorial
// Layout:
//   บรรทัดที่ 1: [Logo]
//   บรรทัดที่ 2: ซ้ายสุด [ย้อนกลับ / กลับหน้าหลัก, ซิงก์ล่าสุด] | ขวาสุด [ปุ่มตั้งค่า, โปรไฟล์, ออกจากระบบ]
// ============================================================
import { NOT_CONFIGURED_MESSAGE, getAuthState, onAuthChange, signIn, signOut, type AuthState } from '../googleAuth';
import { fetchSharedClassrooms, fullSync, onSyncStatus, syncAppData, type SyncStatus } from '../googleSheets';
import { escapeHtml, errorMessage, icon, safeHttpsUrl } from '../types';
import { confirmDialog, toast, withBusy } from './ColumnMapperModal';

const TUTORIAL_STORAGE_KEY = 'eduplan_classroom_tutorial_seen_v1';

let syncState: SyncStatus = { state: 'idle', at: null, message: '' };
let topBarHost: HTMLElement | null = null;
let customBackHandler: (() => void) | null = null;
let settingsMenuOpen = false;

function isInsideRoom(): boolean {
  return window.location.hash.startsWith('#/room/');
}

export function setTopBarBackHandler(fn: (() => void) | null): void {
  customBackHandler = fn;
  if (topBarHost) render(topBarHost, getAuthState());
}

export function refreshTopBar(): void {
  if (topBarHost) render(topBarHost, getAuthState());
}

function syncBadgeHtml(s: AuthState): string {
  if (!s.signedIn) {
    return `
      <span class="cr-mode-badge cr-mode-badge--local" data-mode-indicator title="ข้อมูลทั้งหมดจัดเก็บในเครื่อง (IndexedDB)">
        ${icon('database', 14)}
        <span>โหมดในเครื่อง (Local)</span>
      </span>`;
  }
  if (syncState.state === 'syncing') {
    return `<span class="cr-sync-text" data-sync-text data-mode-indicator><span class="cr-spinner cr-spinner--sm"></span><span>กำลังซิงก์...</span></span>`;
  }
  if (syncState.state === 'error') {
    return `<span class="cr-sync-text" data-sync-text data-mode-indicator title="${escapeHtml(syncState.message)}"><span class="cr-dot cr-dot--red"></span><span>ซิงก์ไม่สำเร็จ</span></span>`;
  }
  if (syncState.at) {
    const t = new Date(syncState.at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    return `<span class="cr-sync-text" data-sync-text data-mode-indicator><span class="cr-dot cr-dot--green"></span><span>ซิงก์ล่าสุด ${t} น.</span></span>`;
  }
  return `<span class="cr-sync-text" data-sync-text data-mode-indicator><span class="cr-dot cr-dot--green"></span><span>ซิงก์ล่าสุด: เชื่อมต่อแล้ว</span></span>`;
}

function render(el: HTMLElement, s: AuthState): void {
  const inRoom = isInsideRoom();
  const backLabel = inRoom ? 'ย้อนกลับ' : 'กลับหน้าหลัก';
  const backTitle = inRoom
    ? 'ย้อนกลับไปหน้าก่อนหน้า (คลังห้องเรียน)'
    : 'กลับไปยังหน้าหลัก EduPlan AI';

  const row1 = `
    <div class="cr-topbar__row1">
      <a href="#/" class="cr-brand" aria-label="EduPlan Class">
        <img src="./icons/icon.png" alt="EduPlan Class" class="cr-brand__logo" />
        <span class="cr-brand__text">
          <span class="cr-brand__title-row">
            <strong>EduPlan Class</strong>
            <span class="cr-brand__pill">เบต้า</span>
          </span>
          <span class="cr-brand__sub">ระบบเช็คชื่อและติดตามงาน</span>
        </span>
      </a>
    </div>`;

  const left = `
    <div class="cr-topbar__left">
      <button type="button" class="cr-btn cr-btn--outline cr-btn--sm" data-nav-back title="${backTitle}">
        ${icon('arrow-left', 15)}
        <span>${backLabel}</span>
      </button>
      ${syncBadgeHtml(s)}
    </div>`;

  const settingsDropdown = `
    <div class="cr-settings-menu-wrap">
      <button type="button" class="cr-btn cr-btn--outline cr-btn--sm ${settingsMenuOpen ? 'is-active' : ''}" data-settings-toggle aria-expanded="${settingsMenuOpen}" title="ตั้งค่า · วิธีใช้งาน & ซิงก์ข้อมูล">
        ${icon('settings', 15)}
        <span>ตั้งค่า</span>
        ${icon('chevron-down', 13)}
      </button>
      <div class="cr-settings-dropdown ${settingsMenuOpen ? '' : 'hidden'}" data-settings-menu role="menu">
        <button type="button" class="cr-settings-dropdown__item" data-help role="menuitem">
          <span class="cr-settings-dropdown__icon is-blue">${icon('help', 16)}</span>
          <span class="cr-settings-dropdown__text">
            <strong>วิธีใช้งาน</strong>
            <small>ดูคำแนะนำการใช้งานทีละปุ่ม (หน้าจำลอง)</small>
          </span>
        </button>
        <button type="button" class="cr-settings-dropdown__item" data-sync role="menuitem" ${s.signedIn ? '' : 'disabled title="ต้องเข้าสู่ระบบด้วย Google ก่อน"'}>
          <span class="cr-settings-dropdown__icon is-emerald">${icon('refresh', 16)}</span>
          <span class="cr-settings-dropdown__text">
            <strong>${s.needsReconnect ? 'เชื่อมต่อใหม่ & ซิงก์ข้อมูล' : 'ซิงก์ข้อมูล'}</strong>
            <small>${s.signedIn ? 'ซิงก์ห้องเรียนกับ Google Drive & Sheet' : 'เข้าสู่ระบบด้วย Google เพื่อซิงก์ข้อมูล'}</small>
          </span>
        </button>
      </div>
    </div>`;

  let right: string;
  if (!s.signedIn) {
    right = `
      <div class="cr-topbar__right">
        ${settingsDropdown}
        ${
          s.configured
            ? `<div class="cr-login-wrap">
                <button type="button" class="cr-btn cr-btn--google" data-login ${s.busy ? 'disabled' : ''}>
                  <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
                  <span>${s.busy ? 'กำลังเชื่อมต่อ...' : 'เข้าสู่ระบบด้วย Google'}</span>
                </button>
                <span class="cr-oauth-hint" role="note">
                  ${icon('bulb', 14)}
                  <span>หากขึ้นแจ้งเตือน 'Google ยังไม่ได้ยืนยันแอปนี้' ให้กด ขั้นสูง (Advanced) &gt; ไปที่ thianrawit.github.io</span>
                </span>
              </div>`
            : `<span class="cr-config-note" data-login role="note" title="${escapeHtml(NOT_CONFIGURED_MESSAGE)}">
                ${icon('info', 15)}
                <span>${escapeHtml(NOT_CONFIGURED_MESSAGE)}</span>
              </span>`
        }
      </div>`;
  } else {
    const p = s.profile!;
    const safePic = safeHttpsUrl(p.picture);
    const avatar = safePic
      ? `<img src="${escapeHtml(safePic)}" alt="" class="cr-avatar" referrerpolicy="no-referrer" />`
      : `<span class="cr-avatar cr-avatar--initial" aria-hidden="true">${escapeHtml((p.name || p.email).charAt(0).toUpperCase())}</span>`;
    right = `
      <div class="cr-topbar__right">
        ${settingsDropdown}
        <div class="cr-profile" data-profile-pill title="${escapeHtml(p.email)}">
          ${avatar}
          <div class="cr-profile__text"><strong>${escapeHtml(p.name)}</strong><span>${escapeHtml(p.email)}</span></div>
        </div>
        <button type="button" class="cr-btn cr-btn--outline cr-btn--sm cr-text-danger" data-logout title="ออกจากระบบ">
          ${icon('logout', 15)}
          <span>ออกจากระบบ</span>
        </button>
      </div>`;
  }

  const row2 = `<div class="cr-topbar__row2">${left}${right}</div>`;
  el.innerHTML = `<div class="cr-topbar__inner">${row1}${row2}</div>`;
}

export function mountTopBar(el: HTMLElement): void {
  topBarHost = el;
  el.className = 'cr-topbar';
  render(el, getAuthState());
  onAuthChange((s) => render(el, s));
  onSyncStatus((s) => {
    syncState = s;
    render(el, getAuthState());
  });

  // ปิดเมนูตั้งค่าเมื่อคลิกนอกเมนูหรือกด Escape
  document.addEventListener('click', (e) => {
    if (!settingsMenuOpen) return;
    const t = e.target as HTMLElement;
    if (!t.closest('.cr-settings-menu-wrap')) {
      settingsMenuOpen = false;
      render(el, getAuthState());
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && settingsMenuOpen) {
      settingsMenuOpen = false;
      render(el, getAuthState());
    }
  });

  window.addEventListener('hashchange', () => {
    settingsMenuOpen = false;
    render(el, getAuthState());
  });

  el.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;

    // ปุ่มย้อนกลับ / กลับหน้าหลัก
    if (t.closest('[data-nav-back]')) {
      // 1) ถ้าเปิดหน้าตรวจงานรายชิ้นอยู่ ให้ย้อนกลับไปหน้ารวมการ์ดงานก่อน
      const detailBackBtn = document.querySelector<HTMLButtonElement>('#cr-tab-panel [data-back]');
      if (detailBackBtn) {
        detailBackBtn.click();
        return;
      }
      // 2) ถ้าอยู่ในหน้าห้องเรียน ให้ย้อนกลับไปหน้าคลังห้องเรียน
      if (isInsideRoom()) {
        if (customBackHandler) customBackHandler();
        else window.location.hash = '#/';
        return;
      }
      // 3) ถ้าอยู่ที่หน้าคลังห้องเรียนแล้ว ให้กลับไปหน้าหลัก EduPlan AI (index.html)
      window.location.href = './index.html';
      return;
    }

    // ปุ่มเปิด/ปิดเมนูตั้งค่า
    if (t.closest('[data-settings-toggle]')) {
      e.stopPropagation();
      settingsMenuOpen = !settingsMenuOpen;
      render(el, getAuthState());
      return;
    }

    // ปุ่มวิธีใช้งาน (อยู่ในเมนูตั้งค่า)
    if (t.closest('[data-help]')) {
      settingsMenuOpen = false;
      render(el, getAuthState());
      startTutorialTour();
      return;
    }

    // ปุ่มซิงก์ข้อมูล (อยู่ในเมนูตั้งค่า)
    const syncBtn = t.closest<HTMLButtonElement>('[data-sync]');
    if (syncBtn && !syncBtn.disabled) {
      settingsMenuOpen = false;
      render(el, getAuthState());
      try {
        const r = await fullSync();
        if (r.errors.length) toast(`ซิงก์ Google Drive แล้ว แต่ส่งข้อมูลบางห้องไม่สำเร็จ:\n${r.errors.join('\n')}`, 'warn', 9000);
        else toast(r.changed ? `ซิงก์สำเร็จ — อัปเดต ${r.changed} รายการจากเครื่องอื่น` : 'ซิงก์ข้อมูลสำเร็จ', 'success');
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
      return;
    }

    // ปุ่มเข้าสู่ระบบด้วย Google
    if (t.closest('button[data-login]')) {
      try {
        const p = await signIn();
        toast(`เข้าสู่ระบบแล้ว: ${p.email}`, 'success');
        const [changed, shared] = await Promise.all([syncAppData(), fetchSharedClassrooms().catch(() => [])]);
        if (changed) toast(`ดึงข้อมูลห้องเรียนจาก Google Drive แล้ว (${changed} รายการ)`, 'info');
        else if (shared.length) toast(`พบห้องเรียนที่ถูกเชิญ ${shared.length} ห้อง`, 'info');
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
      return;
    }

    // ปุ่มออกจากระบบ
    if (t.closest('[data-logout]')) {
      const ok = await confirmDialog(
        'ออกจากระบบ Google และยกเลิกสิทธิ์การเข้าถึง?\nข้อมูลในเครื่องนี้ยังอยู่ครบ และข้อมูลที่ซิงก์แล้วยังอยู่ใน Google Drive ของคุณ',
        { title: 'ออกจากระบบ', confirmText: 'ออกจากระบบ' },
      );
      if (!ok) return;
      await signOut();
      toast('ออกจากระบบแล้ว — กลับสู่โหมดใช้งานในเครื่อง', 'info');
    }
  });
}

// ============================================================
// Dummy Sandbox Scenes + 23-Step Spotlight Cutout Tutorial
// ============================================================
type DummyScene =
  | 'hub'
  | 'wizard-methods'
  | 'wizard-manual'
  | 'mapper-preview'
  | 'attendance'
  | 'assignments-cards'
  | 'assignments-grading'
  | 'settings-roster'
  | 'settings-sheet';

interface TourStep {
  scene: DummyScene;
  chapter: string;
  selector: string;
  title: string;
  desc: string;
}

const TOUR_STEPS: TourStep[] = [
  // ---- หมวด 1: หน้าคลังห้องเรียน & การเชื่อมต่อบัญชี ----
  {
    scene: 'hub',
    chapter: '1. คลังห้องเรียน & แถบด้านบน',
    selector: '[data-nav-back]',
    title: 'ปุ่ม "ย้อนกลับ / กลับหน้าหลัก"',
    desc: 'เมื่ออยู่ในห้องเรียน ปุ่มนี้จะใช้ย้อนกลับไปหน้าก่อนหน้า (คลังห้องเรียน) และเมื่ออยู่ที่หน้าคลังห้องเรียน การกดปุ่มนี้จะพากลับไปยังหน้าหลัก EduPlan AI',
  },
  {
    scene: 'hub',
    chapter: '1. คลังห้องเรียน & แถบด้านบน',
    selector: '[data-mode-indicator]',
    title: 'สถานะซิงก์ล่าสุด / โหมดเก็บข้อมูล',
    desc: 'แสดงเวลาซิงก์ล่าสุดเมื่อเชื่อมต่อ Google แล้ว หรือแสดงป้าย "โหมดในเครื่อง (Local)" เมื่อใช้งานแบบเก็บข้อมูลเฉพาะในเครื่องนี้',
  },
  {
    scene: 'hub',
    chapter: '1. คลังห้องเรียน & แถบด้านบน',
    selector: '[data-settings-toggle]',
    title: 'ปุ่ม "ตั้งค่า" (วิธีใช้งาน & ซิงก์ข้อมูล)',
    desc: 'คลิกที่ปุ่มตั้งค่าเพื่อเปิดเมนูย่อยสำหรับกด "ซิงก์ข้อมูล" กับ Google Drive/Sheet หรือเปิดดู "วิธีใช้งาน" ซ้ำได้ทุกเมื่อ',
  },
  {
    scene: 'hub',
    chapter: '1. คลังห้องเรียน & แถบด้านบน',
    selector: '[data-profile-pill], button[data-login], [data-login]',
    title: 'โปรไฟล์ครู / เข้าสู่ระบบด้วย Google',
    desc: 'เชื่อมต่อบัญชี Google เพื่อใช้งานห้องเรียนข้ามอุปกรณ์และสำรองข้อมูลลง Google Sheet อัตโนมัติ พร้อมปุ่มออกจากระบบด้านขวาสุด',
  },
  {
    scene: 'hub',
    chapter: '1. คลังห้องเรียน & แถบด้านบน',
    selector: '[data-tour="hub-add-room"]',
    title: 'ปุ่ม "+ เพิ่มห้องเรียน"',
    desc: 'กดปุ่มนี้เมื่อต้องการสร้างห้องเรียนวิชาใหม่ สามารถเพิ่มได้ไม่จำกัดจำนวนห้อง',
  },
  {
    scene: 'hub',
    chapter: '1. คลังห้องเรียน & แถบด้านบน',
    selector: '[data-tour="hub-room-card"]',
    title: 'การ์ดห้องเรียนของคุณ',
    desc: 'แสดงชื่อวิชา ชั้น/ห้อง ภาคเรียน จำนวนนักเรียน และปุ่มลัดเปิด Google Sheet หรือลบห้อง เมื่อคลิกที่การ์ดจะเข้าสู่หน้าจัดการห้องเรียนนั้นทันที',
  },

  // ---- หมวด 2: การเพิ่มห้องเรียน & นำเข้ารายชื่อนักเรียน ----
  {
    scene: 'wizard-methods',
    chapter: '2. เพิ่มห้องเรียน & นำเข้ารายชื่อ',
    selector: '[data-tour="wiz-methods"]',
    title: 'เลือกวิธีเพิ่มรายชื่อนักเรียน 3 รูปแบบ',
    desc: 'เลือกได้ตามสะดวก: (1) พิมพ์รายชื่อเอง (2) นำเข้าจากไฟล์ Excel (.xlsx) หรือ (3) เชื่อมต่อจากไฟล์ Google Sheet ที่มีอยู่ใน Drive',
  },
  {
    scene: 'wizard-manual',
    chapter: '2. เพิ่มห้องเรียน & นำเข้ารายชื่อ',
    selector: '[data-tour="wiz-room-fields"]',
    title: 'กรอกข้อมูลพื้นฐานของห้องเรียน',
    desc: 'ระบุชื่อวิชา ระดับชั้น/ห้อง ภาคเรียน และปีการศึกษา (พ.ศ.) สำหรับห้องเรียนที่กำลังสร้าง',
  },
  {
    scene: 'wizard-manual',
    chapter: '2. เพิ่มห้องเรียน & นำเข้ารายชื่อ',
    selector: '[data-tour="wiz-manual-table"]',
    title: 'พิมพ์รายชื่อนักเรียน & ปุ่มเพิ่มแถว/เรียงเลขที่',
    desc: 'กรอกเลขที่ รหัสนักเรียน และชื่อ-สกุล กด "+ เพิ่มแถว" หรือกดปุ่ม "เรียงลำดับใหม่" เพื่อรันเลขที่ 1–N ให้อัตโนมัติ',
  },
  {
    scene: 'wizard-manual',
    chapter: '2. เพิ่มห้องเรียน & นำเข้ารายชื่อ',
    selector: '[data-tour="wiz-auto-sheet"]',
    title: 'ตัวเลือกสร้างไฟล์ Google Sheet อัตโนมัติ',
    desc: 'หากล็อกอิน Google อยู่ ติ๊กช่องนี้เพื่อให้ระบบสร้างไฟล์ Google Sheet ใหม่ (แยก 3 แท็บ: รายชื่อนักเรียน / การมาเรียน / การส่งงาน) และซิงก์ให้อัตโนมัติ',
  },
  {
    scene: 'mapper-preview',
    chapter: '2. เพิ่มห้องเรียน & นำเข้ารายชื่อ',
    selector: '[data-tour="mapper-grid"]',
    title: 'คลิกเลือก "แถวหัวตาราง" & แยกสีคอลัมน์ชัดเจน',
    desc: 'กรณีนำเข้าจากไฟล์ Excel (.xlsx) หรือ Google Sheet คลิกแถวที่เป็นหัวตาราง ระบบจะแยกสีคอลัมน์ เลขที่ (สีส้ม), รหัสนักเรียน (สีม่วง), ชื่อ-สกุล (สีเขียว) และแสดงเซลล์ที่ Merge ตามไฟล์จริง',
  },
  {
    scene: 'mapper-preview',
    chapter: '2. เพิ่มห้องเรียน & นำเข้ารายชื่อ',
    selector: '[data-tour="mapper-cols"]',
    title: 'จับคู่คอลัมน์ เลขที่ / รหัส / ชื่อ-สกุล',
    desc: 'เลือกคอลัมน์ให้ตรงกับข้อมูล (รองรับทั้งชื่อ-สกุลคอลัมน์เดียว หรือแยก คำนำหน้า / ชื่อ / นามสกุล) พร้อมดูตัวอย่างรายชื่อที่อ่านได้ด้านขวาทันที',
  },

  // ---- หมวด 3: การเช็คชื่อการมาเรียน (Attendance) ----
  {
    scene: 'attendance',
    chapter: '3. เช็คชื่อการมาเรียน',
    selector: '[data-tour="att-session-bar"]',
    title: 'เลือกรอบเช็คชื่อใหม่ หรือแก้ไขย้อนหลัง',
    desc: 'สร้างรอบเช็คชื่อใหม่ตามวันที่และคาบเรียน หรือคลิก Dropdown เพื่อเลือกรอบเดิมที่เคยบันทึกไว้กลับมาแก้ไขย้อนหลังได้ตลอด',
  },
  {
    scene: 'attendance',
    chapter: '3. เช็คชื่อการมาเรียน',
    selector: '[data-tour="att-all-present"]',
    title: 'ปุ่มลัด "เช็คมาเรียนทั้งหมด"',
    desc: 'กดปุ่มเดียวเพื่อตั้งสถานะนักเรียนทุกคนเป็น "มา" พร้อมกัน แล้วค่อยกดเปลี่ยนเฉพาะคนที่ลาหรือมาสาย ช่วยเช็คชื่อเสร็จในไม่กี่วินาที',
  },
  {
    scene: 'attendance',
    chapter: '3. เช็คชื่อการมาเรียน',
    selector: '[data-tour="att-row-status"]',
    title: 'ปุ่มสถานะรายบุคคล (มา / ลา-ขาด / มาสาย)',
    desc: 'คลิกเลือกสถานะของนักเรียนแต่ละคน (มา = สีเขียว, ลา/ขาด = สีแดง, มาสาย = สีส้ม)',
  },
  {
    scene: 'attendance',
    chapter: '3. เช็คชื่อการมาเรียน',
    selector: '[data-tour="att-footer"]',
    title: 'สรุปยอด Real-time & บันทึกการมาเรียน',
    desc: 'แถบด้านล่างสรุปจำนวนคน มา / ลา-ขาด / มาสาย ทันที เมื่อกด "บันทึกการมาเรียน" ระบบจะเซฟลงเครื่องและอัปเดตลง Google Sheet อัตโนมัติ',
  },

  // ---- หมวด 4: การเพิ่มงาน แก้ไขงาน และตรวจให้คะแนน ----
  {
    scene: 'assignments-cards',
    chapter: '4. เพิ่มงาน & ตรวจให้คะแนน',
    selector: '[data-tour="asg-add-btn"]',
    title: 'ปุ่ม "+ เพิ่มงาน" สั่งชิ้นงานใหม่',
    desc: 'กดเพื่อสร้างชิ้นงานใหม่ กำหนดชื่องาน วันที่สั่ง กำหนดส่ง และคะแนนเต็ม (ไม่บังคับ)',
  },
  {
    scene: 'assignments-cards',
    chapter: '4. เพิ่มงาน & ตรวจให้คะแนน',
    selector: '[data-tour="asg-card"]',
    title: 'การ์ดชิ้นงาน & ปุ่มแก้ไข/ลบงาน',
    desc: 'แสดงความคืบหน้าจำนวนนักเรียนที่ส่งแล้ว กดไอคอนรูปดินสอเพื่อแก้ไขรายละเอียดงาน หรือคลิกที่การ์ดเพื่อเข้าไปตรวจงานรายคน',
  },
  {
    scene: 'assignments-grading',
    chapter: '4. เพิ่มงาน & ตรวจให้คะแนน',
    selector: '[data-tour="asg-grading-row"]',
    title: 'ติ๊กสถานะ ส่งแล้ว/ยังไม่ส่ง & กรอกคะแนน',
    desc: 'คลิกเลือกสถานะ ส่งแล้ว / ยังไม่ส่ง หรือพิมพ์คะแนนลงในช่องคะแนนด้านขวา (เมื่อพิมพ์คะแนน ระบบจะเปลี่ยนเป็น "ส่งแล้ว" ให้อัตโนมัติ)',
  },
  {
    scene: 'assignments-grading',
    chapter: '4. เพิ่มงาน & ตรวจให้คะแนน',
    selector: '[data-tour="asg-save-btn"]',
    title: 'ปุ่ม "บันทึกการส่งงาน"',
    desc: 'กดเพื่อบันทึกสถานะการส่งและคะแนนของทุกคนลงฐานข้อมูล และส่งค่าขึ้นคอลัมน์งานนั้นใน Google Sheet',
  },

  // ---- หมวด 5: แก้ไขห้องเรียน แก้ไขรายชื่อ ตั้งค่า Sheet & ส่งออก Excel ----
  {
    scene: 'settings-roster',
    chapter: '5. แก้ไขห้อง/รายชื่อ & ส่งออก Excel',
    selector: '[data-tour="set-room-info"]',
    title: 'แก้ไขข้อมูลพื้นฐานของห้องเรียน',
    desc: 'ในแท็บ "ตั้งค่าตารางและคอลัมน์" สามารถแก้ไขชื่อวิชา ระดับชั้น/ห้อง ภาคเรียน และปีการศึกษา แล้วกด "บันทึกข้อมูลห้อง" ได้ทุกเมื่อ',
  },
  {
    scene: 'settings-roster',
    chapter: '5. แก้ไขห้อง/รายชื่อ & ส่งออก Excel',
    selector: '[data-tour="set-roster-tools"]',
    title: 'ปุ่ม "เรียงลำดับใหม่" & อัปโหลด Excel ใหม่',
    desc: 'กด "เรียงลำดับใหม่" เพื่อรันเลขที่นักเรียน 1 ถึงคนสุดท้ายให้อัตโนมัติตามลำดับรายชื่อ หรือกดอัปโหลดไฟล์ Excel เพื่อนำเข้ารายชื่อใหม่',
  },
  {
    scene: 'settings-roster',
    chapter: '5. แก้ไขห้อง/รายชื่อ & ส่งออก Excel',
    selector: '[data-tour="set-roster-table"]',
    title: 'แก้ไขรายชื่อนักเรียน (Master Roster) รายคน',
    desc: 'พิมพ์แก้ไข เลขที่ รหัสนักเรียน หรือชื่อ-นามสกุล ได้โดยตรง ใช้ปุ่มลูกศรเลื่อนลำดับขึ้น-ลง ปุ่มลบแถว หรือปุ่ม "+ เพิ่มนักเรียน" แล้วกด "บันทึกรายชื่อ"',
  },
  {
    scene: 'settings-sheet',
    chapter: '5. แก้ไขห้อง/รายชื่อ & ส่งออก Excel',
    selector: '[data-tour="set-sheet-preview"]',
    title: 'ตั้งค่าคอลัมน์ Google Sheet & ตารางจำลองสีชัดเจน',
    desc: 'ย่อ/ขยายตั้งค่าคอลัมน์การมาเรียนและการส่งงานได้ ตารางจำลองจะตีกรอบสีส้ม (คอลัมน์จับคู่นักเรียน) และกรอบสีเขียว (เซลล์เริ่มเขียนข้อมูล เช่น D1)',
  },
  {
    scene: 'settings-sheet',
    chapter: '5. แก้ไขห้อง/รายชื่อ & ส่งออก Excel',
    selector: '[data-tour="ws-export-excel"]',
    title: 'ปุ่ม "ส่งออก Excel (.xlsx)" สรุปครบ 3 แท็บ',
    desc: 'กดปุ่มสีเขียวด้านบนห้องเรียนเพื่อดาวน์โหลดไฟล์ Excel (.xlsx) ที่จัดตารางสวยงามครบทั้ง 3 แท็บ (รายชื่อ, สรุปการมาเรียน, สรุปคะแนนงาน) พร้อมใช้งานทันที',
  },
];

function dummyWorkspaceHeader(activeTab: 'attendance' | 'assignments' | 'settings'): string {
  return `
    <div class="cr-ws-bar">
      <div class="cr-ws-bar__left">
        <div class="cr-ws-title">
          <div class="flex flex-wrap items-center gap-2">
            <h1 class="cr-h1">วิทยาศาสตร์ ว21101 · ม.1/1</h1>
            <span class="cr-badge cr-badge--green">
              <span class="cr-dot cr-dot--green"></span>
              <span>ซิงก์ Google Sheet</span>
            </span>
          </div>
          <p class="cr-muted">ภาคเรียนที่ 1/2569 · นักเรียน 35 คน (ข้อมูลจำลองสำหรับสาธิต)</p>
        </div>
      </div>
      <div class="cr-ws-bar__right">
        <span class="cr-btn cr-btn--outline">${icon('external', 16)}<span>เปิด Google Sheet</span></span>
        <button type="button" class="cr-btn cr-btn--excel" data-tour="ws-export-excel" tabindex="-1">
          ${icon('spreadsheet', 16)}
          <span>ส่งออก Excel (.xlsx)</span>
        </button>
      </div>
    </div>
    <nav class="cr-tabs" aria-label="เมนูจัดการห้องเรียน (ตัวอย่าง)">
      <button type="button" class="cr-tab ${activeTab === 'attendance' ? 'is-active' : ''}" tabindex="-1">${icon('calendar', 17)}<span>การมาเรียน</span></button>
      <button type="button" class="cr-tab ${activeTab === 'assignments' ? 'is-active' : ''}" tabindex="-1">${icon('clipboard', 17)}<span>การส่งงาน</span></button>
      <button type="button" class="cr-tab ${activeTab === 'settings' ? 'is-active' : ''}" tabindex="-1">${icon('settings', 17)}<span>ตั้งค่าตารางและคอลัมน์</span></button>
    </nav>`;
}

function renderDummyScene(scene: DummyScene): string {
  switch (scene) {
    case 'hub':
      return `
        <section class="cr-page">
          <div class="cr-local-advisory">
            <div class="cr-local-advisory__icon">${icon('warning', 22)}</div>
            <div class="cr-local-advisory__content">
              <div class="cr-local-advisory__title-row">
                <strong>คุณกำลังใช้งาน "โหมดในเครื่อง (Local)"</strong>
                <span class="cr-local-advisory__tag">สำคัญ</span>
              </div>
              <p>โหมดในเครื่อง (Local) จะเป็นการเก็บข้อมูลแค่ภายในเครื่องนี้เท่านั้น หากต้องการใช้งานห้องเรียนที่คุณสร้างในหลายอุปกรณ์ <b class="cr-underline-accent">ควรเข้าสู่ระบบด้วย Google</b> เพื่อซิงก์ข้อมูลอัตโนมัติ</p>
            </div>
          </div>
          <header class="cr-page__head cr-hub-hero">
            <div class="cr-hub-hero__left">
              <span class="cr-hub-hero__eyebrow">${icon('sparkles', 14)}<span>EduPlan Class · Smart Classroom Manager</span></span>
              <h1 class="cr-h1">คลังห้องเรียนของคุณ</h1>
              <p class="cr-muted">ตัวอย่างหน้าคลังห้องเรียน — คลิกการ์ดเพื่อเข้าเช็คชื่อการมาเรียนและติดตามงาน</p>
            </div>
            <button type="button" class="cr-btn cr-btn--primary" data-tour="hub-add-room" tabindex="-1">
              ${icon('plus', 17)}
              <span>เพิ่มห้องเรียน</span>
            </button>
          </header>
          <div class="cr-room-grid">
            <article class="cr-room-card cr-room-card--blue" data-tour="hub-room-card">
              <div class="cr-room-card__top">
                <span class="cr-badge cr-badge--green"><span class="cr-dot cr-dot--green"></span><span>ซิงก์ Google Sheet</span></span>
                <div class="cr-room-card__actions">
                  <span class="cr-icon-btn">${icon('external', 16)}</span>
                  <span class="cr-icon-btn cr-icon-btn--danger">${icon('trash', 16)}</span>
                </div>
              </div>
              <div class="cr-room-card__body-head">
                <span class="cr-room-card__emblem">${icon('users', 20)}</span>
                <div>
                  <h2 class="cr-room-card__subject">วิทยาศาสตร์ ว21101</h2>
                  <p class="cr-room-card__room">ชั้น ม.1/1 (ห้องตัวอย่าง)</p>
                </div>
              </div>
              <dl class="cr-room-card__meta">
                <div class="cr-room-card__stat"><dt>ภาคเรียน / ปีการศึกษา</dt><dd>1/2569</dd></div>
                <div class="cr-room-card__stat"><dt>จำนวนนักเรียน</dt><dd>35 คน</dd></div>
              </dl>
            </article>
            <article class="cr-room-card cr-room-card--purple">
              <div class="cr-room-card__top">
                <span class="cr-badge cr-badge--gray"><span class="cr-dot cr-dot--gray"></span><span>ในเครื่อง (Local)</span></span>
                <div class="cr-room-card__actions">
                  <span class="cr-icon-btn">${icon('cloud-up', 16)}</span>
                  <span class="cr-icon-btn cr-icon-btn--danger">${icon('trash', 16)}</span>
                </div>
              </div>
              <div class="cr-room-card__body-head">
                <span class="cr-room-card__emblem">${icon('users', 20)}</span>
                <div>
                  <h2 class="cr-room-card__subject">คณิตศาสตร์ ค21101</h2>
                  <p class="cr-room-card__room">ชั้น ม.1/2 (ห้องตัวอย่าง)</p>
                </div>
              </div>
              <dl class="cr-room-card__meta">
                <div class="cr-room-card__stat"><dt>ภาคเรียน / ปีการศึกษา</dt><dd>1/2569</dd></div>
                <div class="cr-room-card__stat"><dt>จำนวนนักเรียน</dt><dd>38 คน</dd></div>
              </dl>
            </article>
          </div>
        </section>`;

    case 'wizard-methods':
      return `
        <section class="cr-page">
          <div class="cr-panel">
            <div class="cr-section-head">
              <div>
                <span class="cr-hub-hero__eyebrow">${icon('plus', 14)}<span>หน้าต่างจำลอง: เพิ่มห้องเรียนใหม่</span></span>
                <h2 class="cr-h2">เลือกวิธีตั้งต้นรายชื่อนักเรียน</h2>
              </div>
            </div>
            <div class="cr-method-grid" data-tour="wiz-methods">
              <div class="cr-method cr-method--blue">
                <div class="cr-method__top">
                  <span class="cr-method__icon">${icon('edit', 22)}</span>
                  <span class="cr-method__tag">ทำได้ทันที</span>
                </div>
                <strong>พิมพ์รายชื่อเอง</strong>
                <span>กรอกเลขที่ รหัส และชื่อในตาราง พร้อมปุ่มรันลำดับเลขที่อัตโนมัติ</span>
              </div>
              <div class="cr-method cr-method--emerald">
                <div class="cr-method__top">
                  <span class="cr-method__icon">${icon('upload', 22)}</span>
                  <span class="cr-method__tag">นิยมใช้</span>
                </div>
                <strong>นำเข้าจากไฟล์ Excel (.xlsx)</strong>
                <span>อัปโหลดไฟล์ .xlsx เลือกแถวหัวตารางและจับคู่คอลัมน์ พร้อมพรีวิวตามไฟล์จริง</span>
              </div>
              <div class="cr-method cr-method--purple">
                <div class="cr-method__top">
                  <span class="cr-method__icon">${icon('spreadsheet', 22)}</span>
                  <span class="cr-method__tag">ซิงก์ออนไลน์</span>
                </div>
                <strong>เชื่อมกับ Google Sheet ที่มีอยู่</strong>
                <span>เลือกไฟล์จาก Google Drive แล้วจับคู่แท็บและคอลัมน์ได้โดยตรง</span>
              </div>
            </div>
          </div>
        </section>`;

    case 'wizard-manual':
      return `
        <section class="cr-page">
          <div class="cr-panel">
            <h2 class="cr-h2 mb-3">หน้าต่างจำลอง: กรอกข้อมูลห้องเรียน & พิมพ์รายชื่อนักเรียน</h2>
            <div class="cr-form-grid cr-form-grid--4 p-2 rounded-xl" data-tour="wiz-room-fields">
              <label class="cr-field cr-span-2"><span class="cr-label">วิชา</span><input class="cr-input" value="วิทยาศาสตร์ ว21101" readonly /></label>
              <label class="cr-field cr-span-2"><span class="cr-label">ระดับชั้น/ห้อง</span><input class="cr-input" value="ม.1/1" readonly /></label>
              <label class="cr-field cr-span-2"><span class="cr-label">ภาคเรียน</span><input class="cr-input" value="1" readonly /></label>
              <label class="cr-field cr-span-2"><span class="cr-label">ปีการศึกษา (พ.ศ.)</span><input class="cr-input" value="2569" readonly /></label>
            </div>
            <div class="mt-4 p-2 rounded-xl" data-tour="wiz-manual-table">
              <h3 class="cr-h3">รายชื่อนักเรียน</h3>
              <div class="cr-table-wrap">
                <table class="cr-table cr-table--edit">
                  <thead><tr><th class="w-20 text-center">เลขที่</th><th class="w-40">รหัสนักเรียน</th><th>คำนำหน้า/ชื่อ-นามสกุล</th><th class="w-12 text-center">ลบ</th></tr></thead>
                  <tbody>
                    <tr><td><input class="cr-input cr-input--cell text-center" value="1" readonly /></td><td><input class="cr-input cr-input--cell" value="69101" readonly /></td><td><input class="cr-input cr-input--cell" value="ด.ช.กิตติพงศ์ ใจดี" readonly /></td><td class="text-center"><span class="cr-icon-btn cr-icon-btn--danger">${icon('x', 15)}</span></td></tr>
                    <tr><td><input class="cr-input cr-input--cell text-center" value="2" readonly /></td><td><input class="cr-input cr-input--cell" value="69102" readonly /></td><td><input class="cr-input cr-input--cell" value="ด.ญ.ชนิกานต์ รักเรียน" readonly /></td><td class="text-center"><span class="cr-icon-btn cr-icon-btn--danger">${icon('x', 15)}</span></td></tr>
                  </tbody>
                </table>
              </div>
              <div class="flex flex-wrap items-center gap-2 mt-3">
                <span class="cr-btn cr-btn--outline cr-btn--sm">${icon('plus', 15)}<span>เพิ่มแถว</span></span>
                <span class="cr-btn cr-btn--ghost cr-btn--sm">${icon('plus', 15)}<span>เพิ่ม 10 แถว</span></span>
                <span class="cr-btn cr-btn--outline cr-btn--sm">${icon('sort-number', 15)}<span>เรียงลำดับใหม่</span></span>
              </div>
            </div>
            <div class="mt-4 p-3 rounded-xl border border-blue-200 bg-blue-50/60" data-tour="wiz-auto-sheet">
              <label class="cr-check">
                <input type="checkbox" checked readonly />
                <span><strong>สร้างไฟล์ Google Sheet ใหม่ใน Drive และซิงก์อัตโนมัติ (แนะนำ)</strong>
                <span class="cr-faint block">สร้าง 3 แท็บมาตรฐาน: รายชื่อนักเรียน / การมาเรียน / การส่งงาน</span></span>
              </label>
            </div>
          </div>
        </section>`;

    case 'mapper-preview':
      return `
        <section class="cr-page">
          <div class="cr-panel">
            <h2 class="cr-h2 mb-3">หน้าต่างจำลอง: เลือกแถวหัวตาราง & จับคู่คอลัมน์จากไฟล์ Excel / Sheet</h2>
            <div class="p-2 rounded-xl" data-tour="mapper-grid">
              <div class="cr-step-head">
                <div class="cr-step-title"><span class="cr-step-no">1</span> คลิกเลือก "แถวหัวตาราง" จากตารางตัวอย่าง (แยกสีตามประเภทคอลัมน์)</div>
                <div class="cr-sel-pills">
                  <span class="cr-sel-pill is-header-pill">แถวหัวตาราง: <b>แถว 2</b></span>
                  <span class="cr-sel-pill is-pill-number">เลขที่: <b>คอลัมน์ A</b></span>
                  <span class="cr-sel-pill is-pill-code">รหัสนักเรียน: <b>คอลัมน์ B</b></span>
                  <span class="cr-sel-pill is-pill-name">ชื่อ-สกุล: <b>คอลัมน์ C</b></span>
                  <span class="cr-sel-pill is-merge-pill">เซลล์รวม (Merge) 1 จุด</span>
                </div>
              </div>
              <div class="cr-grid-wrap">
                <table class="cr-grid cr-grid--stroke">
                  <thead>
                    <tr>
                      <th class="cr-grid__rn">แถว</th>
                      <th class="is-mapped is-role-number is-col-edge-top"><span class="cr-grid__col-letter">A</span><span class="cr-grid__role is-role-badge-number">เลขที่</span></th>
                      <th class="is-mapped is-role-code is-col-edge-top"><span class="cr-grid__col-letter">B</span><span class="cr-grid__role is-role-badge-code">รหัสนักเรียน</span></th>
                      <th class="is-mapped is-role-name is-col-edge-top"><span class="cr-grid__col-letter">C</span><span class="cr-grid__role is-role-badge-name">ชื่อ-สกุล</span></th>
                      <th><span class="cr-grid__col-letter">D</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr class="is-skipped">
                      <td class="cr-grid__rn">1</td>
                      <td class="is-merged-cell" colspan="4">รายชื่อนักเรียนชั้นมัธยมศึกษาปีที่ 1/1 ปีการศึกษา 2569<span class="cr-merge-tag">A1:D1</span></td>
                    </tr>
                    <tr class="is-header">
                      <td class="cr-grid__rn">2<span class="cr-hdr-tag">หัวตาราง</span></td>
                      <td class="is-mapped is-role-number is-col-edge is-target-cell">เลขที่</td>
                      <td class="is-mapped is-role-code is-col-edge is-target-cell">รหัสประจำตัว</td>
                      <td class="is-mapped is-role-name is-col-edge is-target-cell">ชื่อ - นามสกุล</td>
                      <td>หมายเหตุ</td>
                    </tr>
                    <tr>
                      <td class="cr-grid__rn">3</td>
                      <td class="is-mapped is-role-number is-col-edge is-col-edge-bottom">1</td>
                      <td class="is-mapped is-role-code is-col-edge is-col-edge-bottom">69101</td>
                      <td class="is-mapped is-role-name is-col-edge is-col-edge-bottom">ด.ช.กิตติพงศ์ ใจดี</td>
                      <td>ปกติ</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div class="cr-mapper__cols mt-4 p-2 rounded-xl" data-tour="mapper-cols">
              <div>
                <div class="cr-step-title"><span class="cr-step-no">2</span> จับคู่คอลัมน์ (สีของช่องตรงกับสีกรอบในตารางด้านบน)</div>
                <div class="cr-form-grid cr-form-grid--2">
                  <label class="cr-field cr-map-field cr-map-field--number"><span class="cr-label flex items-center justify-between"><span class="inline-flex items-center gap-1.5"><span class="cr-th-dot is-dot-number"></span>เลขที่</span><span class="cr-col-tag is-tag-number">คอลัมน์ A</span></span><select class="cr-input"><option>A · เลขที่</option></select></label>
                  <label class="cr-field cr-map-field cr-map-field--code"><span class="cr-label flex items-center justify-between"><span class="inline-flex items-center gap-1.5"><span class="cr-th-dot is-dot-code"></span>รหัสนักเรียน</span><span class="cr-col-tag is-tag-code">คอลัมน์ B</span></span><select class="cr-input"><option>B · รหัสประจำตัว</option></select></label>
                  <label class="cr-field cr-map-field cr-map-field--name cr-span-2"><span class="cr-label flex items-center justify-between"><span class="inline-flex items-center gap-1.5"><span class="cr-th-dot is-dot-name"></span>คำนำหน้า/ชื่อ-สกุล</span><span class="cr-col-tag is-tag-name">คอลัมน์ C</span></span><select class="cr-input"><option>C · ชื่อ - นามสกุล</option></select></label>
                </div>
              </div>
              <div>
                <div class="cr-step-title"><span class="cr-step-no">3</span> ตัวอย่างรายชื่อที่อ่านได้</div>
                <div class="cr-table-wrap cr-table-wrap--preview">
                  <table class="cr-table cr-table--compact">
                    <thead><tr><th class="w-16 text-center"><span class="cr-th-dot is-dot-number"></span>เลขที่</th><th class="w-36"><span class="cr-th-dot is-dot-code"></span>รหัสนักเรียน</th><th><span class="cr-th-dot is-dot-name"></span>ชื่อ-นามสกุล</th></tr></thead>
                    <tbody>
                      <tr><td class="text-center cr-num">1</td><td class="cr-num">69101</td><td>ด.ช.กิตติพงศ์ ใจดี</td></tr>
                      <tr><td class="text-center cr-num">2</td><td class="cr-num">69102</td><td>ด.ญ.ชนิกานต์ รักเรียน</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </section>`;

    case 'attendance':
      return `
        <section class="cr-page">
          ${dummyWorkspaceHeader('attendance')}
          <div class="cr-session-bar">
            <div class="flex flex-1 flex-wrap gap-4" data-tour="att-session-bar">
              <label class="cr-field cr-session-bar__select">
                <span class="cr-label">รอบการเช็คชื่อ</span>
                <select class="cr-input"><option>+ สร้างรอบเช็คชื่อใหม่ (16/11/2569 คาบ 1)</option></select>
              </label>
              <label class="cr-field cr-session-bar__date"><span class="cr-label">วันที่</span><input type="date" class="cr-input" value="2026-11-16" readonly /></label>
              <label class="cr-field cr-session-bar__period"><span class="cr-label">คาบเรียน / รอบ</span><input class="cr-input" value="คาบ 1" readonly /></label>
            </div>
            <div class="cr-session-bar__actions">
              <button type="button" class="cr-btn cr-btn--soft-green" data-tour="att-all-present" tabindex="-1">
                ${icon('check-all', 17)}
                <span>เช็คมาเรียนทั้งหมด</span>
              </button>
            </div>
          </div>
          <div class="cr-table-wrap">
            <table class="cr-table cr-table--att">
              <thead><tr><th class="w-16 text-center">เลขที่</th><th class="w-36">รหัสนักเรียน</th><th>ชื่อ-นามสกุล</th><th class="w-[310px] text-center">สถานะการมาเรียน</th></tr></thead>
              <tbody>
                <tr class="is-present" data-tour="att-row-status">
                  <td class="text-center cr-num">1</td>
                  <td class="cr-num">69101</td>
                  <td>ด.ช.กิตติพงศ์ ใจดี</td>
                  <td>
                    <div class="cr-seg cr-seg--status">
                      <button type="button" class="cr-seg__btn cr-seg__btn--present is-on" tabindex="-1">${icon('check', 14)}<span>มา</span></button>
                      <button type="button" class="cr-seg__btn cr-seg__btn--absent" tabindex="-1">${icon('x', 14)}<span>ลา/ขาด</span></button>
                      <button type="button" class="cr-seg__btn cr-seg__btn--late" tabindex="-1">${icon('clock', 14)}<span>มาสาย</span></button>
                    </div>
                  </td>
                </tr>
                <tr class="is-late">
                  <td class="text-center cr-num">2</td>
                  <td class="cr-num">69102</td>
                  <td>ด.ญ.ชนิกานต์ รักเรียน</td>
                  <td>
                    <div class="cr-seg cr-seg--status">
                      <button type="button" class="cr-seg__btn cr-seg__btn--present" tabindex="-1">${icon('check', 14)}<span>มา</span></button>
                      <button type="button" class="cr-seg__btn cr-seg__btn--absent" tabindex="-1">${icon('x', 14)}<span>ลา/ขาด</span></button>
                      <button type="button" class="cr-seg__btn cr-seg__btn--late is-on" tabindex="-1">${icon('clock', 14)}<span>มาสาย</span></button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="cr-sticky-footer" data-tour="att-footer">
            <div class="cr-sticky-footer__sum">
              <span class="cr-sum cr-sum--present">มา: <b>33</b> คน</span>
              <span class="cr-sum cr-sum--absent">ลา/ขาด: <b>1</b> คน</span>
              <span class="cr-sum cr-sum--late">มาสาย: <b>1</b> คน</span>
              <span class="cr-sum cr-sum--none">ยังไม่ระบุ: <b>0</b> คน</span>
            </div>
            <button type="button" class="cr-btn cr-btn--primary" tabindex="-1">${icon('check', 16)}<span>บันทึกการมาเรียน</span></button>
          </div>
        </section>`;

    case 'assignments-cards':
      return `
        <section class="cr-page">
          ${dummyWorkspaceHeader('assignments')}
          <div class="cr-section-head">
            <div>
              <h2 class="cr-h2">รายการงานที่มอบหมาย</h2>
              <p class="cr-muted">ทั้งหมด 2 ชิ้นงาน — คลิกการ์ดเพื่อตรวจการส่งงานและบันทึกคะแนน</p>
            </div>
            <button type="button" class="cr-btn cr-btn--primary" data-tour="asg-add-btn" tabindex="-1">
              ${icon('plus', 17)}
              <span>เพิ่มงาน</span>
            </button>
          </div>
          <div class="cr-asg-grid">
            <article class="cr-asg-card" data-tour="asg-card">
              <div class="cr-asg-card__top">
                <h3 class="cr-asg-card__title">ใบงานที่ 1 เรื่องโครงสร้างเซลล์</h3>
                <div class="cr-room-card__actions">
                  <span class="cr-icon-btn" title="แก้ไขงาน">${icon('edit', 15)}</span>
                  <span class="cr-icon-btn cr-icon-btn--danger" title="ลบงาน">${icon('trash', 15)}</span>
                </div>
              </div>
              <dl class="cr-asg-card__meta">
                <div><dt>วันที่สั่ง</dt><dd>10/11/2569</dd></div>
                <div><dt>กำหนดส่ง</dt><dd>17/11/2569</dd></div>
                <div><dt>คะแนนเต็ม</dt><dd>10</dd></div>
              </dl>
              <div class="cr-progress"><div class="cr-progress__bar" style="width:86%"></div></div>
              <div class="cr-asg-card__foot">
                <span>ส่งแล้ว <b>30</b>/35 คน</span>
                <span class="cr-faint">86%</span>
              </div>
            </article>
            <article class="cr-asg-card">
              <div class="cr-asg-card__top">
                <h3 class="cr-asg-card__title">แบบฝึกหัดบทที่ 2 การลำเลียงสาร</h3>
                <div class="cr-room-card__actions">
                  <span class="cr-icon-btn">${icon('edit', 15)}</span>
                  <span class="cr-icon-btn cr-icon-btn--danger">${icon('trash', 15)}</span>
                </div>
              </div>
              <dl class="cr-asg-card__meta">
                <div><dt>วันที่สั่ง</dt><dd>14/11/2569</dd></div>
                <div><dt>กำหนดส่ง</dt><dd>21/11/2569</dd></div>
                <div><dt>คะแนนเต็ม</dt><dd>20</dd></div>
              </dl>
              <div class="cr-progress"><div class="cr-progress__bar" style="width:60%"></div></div>
              <div class="cr-asg-card__foot">
                <span>ส่งแล้ว <b>21</b>/35 คน</span>
                <span class="cr-faint">60%</span>
              </div>
            </article>
          </div>
        </section>`;

    case 'assignments-grading':
      return `
        <section class="cr-page">
          ${dummyWorkspaceHeader('assignments')}
          <div class="cr-detail-head">
            <span class="cr-btn cr-btn--outline cr-btn--sm">${icon('arrow-left', 15)}<span>กลับไปหน้ารวมงาน</span></span>
            <div class="cr-detail-head__info">
              <h2 class="cr-h2">ใบงานที่ 1 เรื่องโครงสร้างเซลล์</h2>
              <p class="cr-muted">วันที่สั่ง 10/11/2569 · กำหนดส่ง 17/11/2569 · คะแนนเต็ม 10</p>
            </div>
            <span class="cr-btn cr-btn--soft-green cr-btn--sm ml-auto">${icon('check-all', 16)}<span>ส่งแล้วทั้งหมด</span></span>
          </div>
          <div class="cr-table-wrap">
            <table class="cr-table cr-table--att">
              <thead><tr><th class="w-16 text-center">เลขที่</th><th class="w-36">รหัสนักเรียน</th><th>ชื่อ-นามสกุล</th><th class="w-[230px] text-center">สถานะการส่ง</th><th class="w-44 text-center">คะแนน (เต็ม 10)</th></tr></thead>
              <tbody>
                <tr class="is-present" data-tour="asg-grading-row">
                  <td class="text-center cr-num">1</td>
                  <td class="cr-num">69101</td>
                  <td>ด.ช.กิตติพงศ์ ใจดี</td>
                  <td>
                    <div class="cr-seg cr-seg--status">
                      <button type="button" class="cr-seg__btn cr-seg__btn--present is-on" tabindex="-1">${icon('check', 14)}<span>ส่งแล้ว</span></button>
                      <button type="button" class="cr-seg__btn cr-seg__btn--absent" tabindex="-1">${icon('x', 14)}<span>ยังไม่ส่ง</span></button>
                    </div>
                  </td>
                  <td><input type="number" class="cr-input cr-input--score" value="9.5" readonly /></td>
                </tr>
                <tr>
                  <td class="text-center cr-num">2</td>
                  <td class="cr-num">69102</td>
                  <td>ด.ญ.ชนิกานต์ รักเรียน</td>
                  <td>
                    <div class="cr-seg cr-seg--status">
                      <button type="button" class="cr-seg__btn cr-seg__btn--present" tabindex="-1">${icon('check', 14)}<span>ส่งแล้ว</span></button>
                      <button type="button" class="cr-seg__btn cr-seg__btn--absent is-on" tabindex="-1">${icon('x', 14)}<span>ยังไม่ส่ง</span></button>
                    </div>
                  </td>
                  <td><input type="number" class="cr-input cr-input--score" placeholder="ใส่คะแนน" readonly /></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="cr-sticky-footer">
            <div class="cr-sticky-footer__sum">
              <span class="cr-sum cr-sum--present">ส่งแล้ว: <b>30</b> คน</span>
              <span class="cr-sum cr-sum--absent">ยังไม่ส่ง: <b>5</b> คน</span>
              <span class="cr-sum cr-sum--none">ใส่คะแนนแล้ว: <b>30</b> คน · เฉลี่ย 8.85</span>
            </div>
            <button type="button" class="cr-btn cr-btn--primary" data-tour="asg-save-btn" tabindex="-1">${icon('check', 16)}<span>บันทึกการส่งงาน</span></button>
          </div>
        </section>`;

    case 'settings-roster':
      return `
        <section class="cr-page">
          ${dummyWorkspaceHeader('settings')}
          <div class="cr-settings-stack">
            <section class="cr-panel cr-collapsible is-open" data-tour="set-room-info">
              <div class="cr-collapsible__head">
                <div class="cr-collapsible__title">
                  <span class="cr-collapsible__icon">${icon('edit', 17)}</span>
                  <div>
                    <h2 class="cr-h2">ข้อมูลพื้นฐานห้องเรียน (แก้ไขห้องเรียน)</h2>
                    <p class="cr-muted">วิทยาศาสตร์ ว21101 · ชั้น ม.1/1 · ภาคเรียนที่ 1/2569</p>
                  </div>
                </div>
                <span class="cr-collapsible__chev">${icon('chevron-down', 18)}</span>
              </div>
              <div class="cr-collapsible__body">
                <div class="cr-form-grid cr-form-grid--4">
                  <label class="cr-field cr-span-2"><span class="cr-label">วิชา</span><input class="cr-input" value="วิทยาศาสตร์ ว21101" readonly /></label>
                  <label class="cr-field cr-span-2"><span class="cr-label">ระดับชั้น/ห้อง</span><input class="cr-input" value="ม.1/1" readonly /></label>
                  <label class="cr-field"><span class="cr-label">ภาคเรียน</span><input class="cr-input" value="1" readonly /></label>
                  <label class="cr-field"><span class="cr-label">ปีการศึกษา (พ.ศ.)</span><input class="cr-input" value="2569" readonly /></label>
                  <div class="cr-span-2 flex items-end justify-end">
                    <span class="cr-btn cr-btn--primary">${icon('check', 16)}<span>บันทึกข้อมูลห้อง</span></span>
                  </div>
                </div>
              </div>
            </section>

            <section class="cr-panel">
              <div class="cr-section-head">
                <div>
                  <h2 class="cr-h2">รายชื่อนักเรียน (Master Roster)</h2>
                  <p class="cr-muted">ทั้งหมด 35 คน — แก้ไขข้อมูลรายคน หรือกด "เรียงลำดับใหม่" เพื่อรันเลขที่ 1–35 อัตโนมัติ</p>
                </div>
                <div class="cr-toolbar-group p-1 rounded-xl" data-tour="set-roster-tools">
                  <span class="cr-btn cr-btn--outline cr-btn--sm">${icon('sort-number', 16)}<span>เรียงลำดับใหม่</span></span>
                  <span class="cr-btn cr-btn--outline cr-btn--sm">${icon('upload', 15)}<span>อัปโหลด Excel (.xlsx)</span></span>
                </div>
              </div>
              <div data-tour="set-roster-table">
                <div class="cr-table-wrap mt-2">
                  <table class="cr-table cr-table--edit">
                    <thead><tr><th class="w-14 text-center">ลำดับ</th><th class="w-24 text-center">เลขที่</th><th class="w-44">รหัสนักเรียน</th><th>คำนำหน้า/ชื่อ-นามสกุล</th><th class="w-28 text-center">จัดการแถว</th></tr></thead>
                    <tbody>
                      <tr>
                        <td class="text-center cr-faint cr-num">1</td>
                        <td><input class="cr-input cr-input--cell text-center cr-num" value="1" readonly /></td>
                        <td><input class="cr-input cr-input--cell cr-num" value="69101" readonly /></td>
                        <td><input class="cr-input cr-input--cell" value="ด.ช.กิตติพงศ์ ใจดี" readonly /></td>
                        <td class="text-center whitespace-nowrap">
                          <span class="cr-icon-btn">${icon('arrow-up', 15)}</span>
                          <span class="cr-icon-btn">${icon('arrow-down', 15)}</span>
                          <span class="cr-icon-btn cr-icon-btn--danger">${icon('x', 15)}</span>
                        </td>
                      </tr>
                      <tr>
                        <td class="text-center cr-faint cr-num">2</td>
                        <td><input class="cr-input cr-input--cell text-center cr-num" value="2" readonly /></td>
                        <td><input class="cr-input cr-input--cell cr-num" value="69102" readonly /></td>
                        <td><input class="cr-input cr-input--cell" value="ด.ญ.ชนิกานต์ รักเรียน" readonly /></td>
                        <td class="text-center whitespace-nowrap">
                          <span class="cr-icon-btn">${icon('arrow-up', 15)}</span>
                          <span class="cr-icon-btn">${icon('arrow-down', 15)}</span>
                          <span class="cr-icon-btn cr-icon-btn--danger">${icon('x', 15)}</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div class="cr-panel-foot">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="cr-btn cr-btn--outline cr-btn--sm">${icon('plus', 15)}<span>เพิ่มนักเรียน</span></span>
                    <span class="cr-btn cr-btn--ghost cr-btn--sm">${icon('sort-number', 15)}<span>รันเลขที่ 1–35 อัตโนมัติ</span></span>
                  </div>
                  <span class="cr-btn cr-btn--primary ml-auto">${icon('check', 16)}<span>บันทึกรายชื่อ</span></span>
                </div>
              </div>
            </section>
          </div>
        </section>`;

    case 'settings-sheet':
      return `
        <section class="cr-page">
          ${dummyWorkspaceHeader('settings')}
          <section class="cr-panel">
            <h2 class="cr-h2 mb-3">การเชื่อมต่อ Google Sheet & คอลัมน์</h2>
            <div class="cr-map-card is-open" data-tour="set-sheet-preview">
              <div class="cr-map-card__head">
                <div class="cr-collapsible__title">
                  <span class="cr-collapsible__icon">${icon('calendar', 17)}</span>
                  <div>
                    <div class="flex flex-wrap items-center gap-2">
                      <h3 class="cr-h3 mb-0">คอลัมน์สำหรับการมาเรียน (ย่อ/ขยายได้)</h3>
                      <span class="cr-badge cr-badge--green">เริ่มที่ D1</span>
                    </div>
                    <p class="cr-muted">แท็บ "การมาเรียน" · หัวตารางแถว 1 · เริ่มคอลัมน์ D (D1) · จับคู่ด้วยรหัสนักเรียน</p>
                  </div>
                </div>
                <span class="cr-collapsible__chev">${icon('chevron-down', 18)}</span>
              </div>
              <div class="cr-map-card__body">
                <div class="cr-preview-status">
                  <span class="cr-sel-pill is-header-pill">แถวหัวตาราง: <b>แถว 1</b></span>
                  <span class="cr-sel-pill is-key-pill">จับคู่นักเรียน: <b>คอลัมน์ B (รหัสนักเรียน)</b></span>
                  <span class="cr-sel-pill is-write-pill">จุดเริ่มเขียน: <b>เซลล์ D1</b></span>
                </div>
                <div class="cr-grid-wrap">
                  <table class="cr-grid cr-grid--map cr-grid--stroke">
                    <thead>
                      <tr>
                        <th class="cr-grid__rn">แถว</th>
                        <th><span class="cr-grid__col-letter">A</span></th>
                        <th class="is-key is-key-edge-top"><span class="cr-grid__col-letter">B</span><span class="cr-grid__role is-role-key">จับคู่แถว</span></th>
                        <th><span class="cr-grid__col-letter">C</span></th>
                        <th class="is-write is-write-edge-top is-start-col"><span class="cr-grid__col-letter">D</span><span class="cr-grid__role is-role-start">เริ่มเขียน (D)</span></th>
                        <th class="is-ghost is-write-edge-top"><span class="cr-grid__col-letter">E</span><span class="cr-grid__role">เขียนข้อมูล</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr class="is-header">
                        <td class="cr-grid__rn">1<span class="cr-hdr-tag">หัวตาราง</span></td>
                        <td>เลขที่</td>
                        <td class="is-key is-key-edge">รหัสนักเรียน</td>
                        <td>ชื่อ-สกุล</td>
                        <td class="is-write is-write-edge is-start-col is-origin-cell"><span class="cr-proj">16/11/2569 คาบ 1</span><span class="cr-origin-badge">D1</span></td>
                        <td class="is-ghost is-write-edge"><span class="cr-proj">(รอบถัดไป)</span></td>
                      </tr>
                      <tr>
                        <td class="cr-grid__rn">2</td>
                        <td>1</td>
                        <td class="is-key is-key-edge is-key-edge-bottom">69101</td>
                        <td>ด.ช.กิตติพงศ์ ใจดี</td>
                        <td class="is-write is-write-edge is-start-col is-write-edge-bottom"><span class="cr-proj">มา / ลา / สาย</span></td>
                        <td class="is-ghost is-write-edge is-write-edge-bottom"></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>
        </section>`;
  }
}

/** แจ้งเตือนผู้ใช้เฉพาะครั้งแรกที่เข้า classroom.html ว่าจะข้ามหรือให้สอนทีละปุ่ม */
export function maybeShowFirstVisitTutorial(): void {
  try {
    if (localStorage.getItem(TUTORIAL_STORAGE_KEY)) return;
  } catch {
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'cr-overlay cr-tut-overlay';
  overlay.innerHTML = `
    <div class="cr-modal cr-modal--md cr-tut-welcome" role="dialog" aria-modal="true" aria-label="ยินดีต้อนรับสู่ EduPlan Class">
      <div class="cr-tut-welcome__hero">
        <img src="./icons/icon.png" alt="EduPlan Class" class="cr-tut-welcome__logo" />
        <span class="cr-tut-welcome__badge">${icon('sparkles', 14)}<span>ยินดีต้อนรับสู่ EduPlan Class</span></span>
        <h2 class="cr-tut-welcome__title">ระบบจัดการห้องเรียน เช็คชื่อ & ติดตามงาน</h2>
        <p class="cr-tut-welcome__sub">ใช้งานง่ายทั้งโหมดในเครื่องและซิงก์ออนไลน์ผ่าน Google Sheet</p>
      </div>
      <div class="cr-modal__body">
        <div class="cr-local-advisory cr-local-advisory--compact">
          <div class="cr-local-advisory__icon">${icon('warning', 20)}</div>
          <div class="cr-local-advisory__content">
            <strong>ข้อควรทราบก่อนเริ่มใช้งาน</strong>
            <p>
              <b>โหมดในเครื่อง (Local)</b> จะเป็นการเก็บข้อมูลแค่ภายในเครื่องนี้เท่านั้น
              หากต้องการใช้งานห้องเรียนที่คุณสร้างในหลายอุปกรณ์ <b class="cr-underline-accent">ควรเข้าสู่ระบบด้วย Google</b>
            </p>
          </div>
        </div>
        <div class="cr-tut-welcome__ask">
          <div class="cr-tut-welcome__ask-icon">${icon('compass', 20)}</div>
          <div>
            <strong>ต้องการดูสาธิตวิธีใช้งานครบทุกหน้าทีละปุ่มหรือไม่?</strong>
            <p class="cr-muted">ระบบจะเปิดหน้าตัวอย่างจำลอง (Dummy) พร้อมไฮไลต์ชี้ปุ่มใช้งานจริงทีละจุด (เปิดดูซ้ำภายหลังได้ในปุ่ม "ตั้งค่า › วิธีใช้งาน" มุมขวาบน)</p>
          </div>
        </div>
      </div>
      <div class="cr-modal__foot cr-tut-welcome__foot">
        <button type="button" class="cr-btn cr-btn--outline" data-tut-skip>
          <span>ข้ามคำแนะนำ</span>
        </button>
        <button type="button" class="cr-btn cr-btn--primary" data-tut-start>
          ${icon('sparkles', 16)}
          <span>เริ่มดูวิธีใช้งานทีละปุ่ม</span>
        </button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  document.body.classList.add('cr-no-scroll');

  const markSeenAndClose = () => {
    try {
      localStorage.setItem(TUTORIAL_STORAGE_KEY, '1');
    } catch {
      /* ignore */
    }
    overlay.remove();
    if (!document.querySelector('.cr-overlay')) document.body.classList.remove('cr-no-scroll');
  };

  overlay.querySelector('[data-tut-skip]')!.addEventListener('click', () => {
    markSeenAndClose();
  });
  overlay.querySelector('[data-tut-start]')!.addEventListener('click', () => {
    markSeenAndClose();
    startTutorialTour();
  });
}

/** เปิดโหมดสอนทีละปุ่มผ่านหน้า Dummy ครบทุกฟีเจอร์: Spotlight Cutout สว่างเฉพาะจุดที่สอน + กล่องชิดมุมขอบจอ */
export function startTutorialTour(): void {
  try {
    localStorage.setItem(TUTORIAL_STORAGE_KEY, '1');
  } catch {
    /* ignore */
  }
  document.querySelector('.cr-tour-layer')?.remove();
  document.querySelector('.cr-tour-sandbox')?.remove();

  const appEl = document.getElementById('classroom-app');
  if (!appEl) return;

  const realChildren = [...appEl.children] as HTMLElement[];
  realChildren.forEach((ch) => ch.classList.add('cr-tour-hidden-real'));

  const sandbox = document.createElement('div');
  sandbox.className = 'cr-tour-sandbox';
  appEl.appendChild(sandbox);

  let idx = 0;
  let currentScene: DummyScene | null = null;

  const chapters: { name: string; startIdx: number }[] = [];
  TOUR_STEPS.forEach((st, i) => {
    if (!chapters.some((c) => c.name === st.chapter)) chapters.push({ name: st.chapter, startIdx: i });
  });

  const layer = document.createElement('div');
  layer.className = 'cr-tour-layer';
  layer.innerHTML = `
    <div class="cr-tour-backdrop-click" data-tour-backdrop></div>
    <div class="cr-tour-banner">
      <span class="cr-tour-banner__dot"></span>
      <span>โหมดสาธิตการใช้งาน (หน้าจำลอง Dummy — ไม่กระทบข้อมูลจริงของคุณ)</span>
    </div>
    <div class="cr-tour-spotlight" data-tour-hole>
      <span class="cr-tour-spotlight__tag" data-tour-tag></span>
    </div>
    <aside class="cr-tour-dock" data-tour-dock role="dialog" aria-modal="false" aria-label="คำแนะนำการใช้งานทีละปุ่ม"></aside>`;
  document.body.appendChild(layer);

  const holeEl = layer.querySelector<HTMLElement>('[data-tour-hole]')!;
  const tagEl = layer.querySelector<HTMLElement>('[data-tour-tag]')!;
  const dockEl = layer.querySelector<HTMLElement>('[data-tour-dock]')!;

  const closeTour = () => {
    window.removeEventListener('resize', updatePosition);
    window.removeEventListener('scroll', updatePosition, true);
    document.removeEventListener('keydown', onKey);
    layer.remove();
    sandbox.remove();
    realChildren.forEach((ch) => ch.classList.remove('cr-tour-hidden-real'));
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeTour();
    else if (e.key === 'ArrowRight' && idx < TOUR_STEPS.length - 1) {
      idx++;
      renderStep();
    } else if (e.key === 'ArrowLeft' && idx > 0) {
      idx--;
      renderStep();
    }
  };

  const findTarget = (selector: string): HTMLElement | null => {
    for (const part of selector.split(',')) {
      const s = part.trim();
      const el = sandbox.querySelector<HTMLElement>(s) ?? document.querySelector<HTMLElement>(s);
      if (el && el.offsetWidth > 0 && el.offsetHeight > 0) return el;
    }
    return null;
  };

  const updatePosition = () => {
    const step = TOUR_STEPS[idx];
    const target = findTarget(step.selector);
    if (!target) {
      holeEl.style.opacity = '0';
      return;
    }
    const r = target.getBoundingClientRect();
    const pad = 8;
    const top = Math.max(4, r.top - pad);
    const left = Math.max(4, r.left - pad);
    const width = Math.min(window.innerWidth - 8, r.width + pad * 2);
    const height = Math.min(window.innerHeight - 8, r.height + pad * 2);

    holeEl.style.opacity = '1';
    holeEl.style.top = `${top}px`;
    holeEl.style.left = `${left}px`;
    holeEl.style.width = `${width}px`;
    holeEl.style.height = `${height}px`;

    const tagBelow = top < 52;
    tagEl.classList.toggle('is-below', tagBelow);
    tagEl.textContent = `${idx + 1}/${TOUR_STEPS.length} · ${step.title}`;

    const overlapsBottomRight = r.bottom > window.innerHeight - 280 && r.right > window.innerWidth - 460;
    const overlapsBottomLeft = r.bottom > window.innerHeight - 280 && r.left < 460;
    dockEl.classList.toggle('is-left', overlapsBottomRight && !overlapsBottomLeft);
    dockEl.classList.toggle('is-top-right', overlapsBottomRight && overlapsBottomLeft);
  };

  const renderStep = () => {
    const step = TOUR_STEPS[idx];
    if (currentScene !== step.scene) {
      currentScene = step.scene;
      sandbox.innerHTML = renderDummyScene(step.scene);
    }

    const target = findTarget(step.selector);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    }

    const isLast = idx === TOUR_STEPS.length - 1;
    const chapterOpts = chapters
      .map(
        (c) => `<option value="${c.startIdx}" ${c.name === step.chapter ? 'selected' : ''}>หมวด: ${escapeHtml(c.name)}</option>`,
      )
      .join('');

    dockEl.innerHTML = `
      <div class="cr-tour-dock__head">
        <span class="cr-tour-dock__step">
          <span class="cr-tour-dock__num">${idx + 1}</span>
          <span>จุดที่ ${idx + 1} / ${TOUR_STEPS.length}</span>
        </span>
        <select class="cr-tour-dock__chapter" data-tour-chapter aria-label="เลือกหมวดที่ต้องการดู">${chapterOpts}</select>
        <button type="button" class="cr-tour-dock__close" data-tour-close title="ปิดโหมดสาธิต (Esc)">
          <span>ปิด</span>
          ${icon('x', 15)}
        </button>
      </div>
      <div class="cr-tour-dock__body">
        <h3 class="cr-tour-dock__title">${escapeHtml(step.title)}</h3>
        <p class="cr-tour-dock__desc">${escapeHtml(step.desc)}</p>
      </div>
      <div class="cr-tour-dock__foot">
        <span class="cr-faint">${escapeHtml(step.chapter)}</span>
        <div class="flex items-center gap-2">
          ${idx > 0 ? `<button type="button" class="cr-btn cr-btn--outline cr-btn--sm" data-tour-prev>${icon('arrow-left', 14)}<span>ก่อนหน้า</span></button>` : ''}
          <button type="button" class="cr-btn cr-btn--primary cr-btn--sm" data-tour-next>
            <span>${isLast ? 'จบการสาธิต' : 'ปุ่มถัดไป'}</span>
            ${icon(isLast ? 'check' : 'arrow-right', 14)}
          </button>
        </div>
      </div>`;

    updatePosition();
    window.setTimeout(updatePosition, 160);
    window.setTimeout(updatePosition, 340);
  };

  layer.addEventListener('change', (e) => {
    const sel = (e.target as HTMLElement).closest<HTMLSelectElement>('[data-tour-chapter]');
    if (sel) {
      idx = Number(sel.value);
      renderStep();
    }
  });

  layer.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-tour-close]')) {
      closeTour();
      return;
    }
    if (t.closest('[data-tour-prev]') && idx > 0) {
      idx--;
      renderStep();
      return;
    }
    if (t.closest('[data-tour-next]') || t.hasAttribute('data-tour-backdrop')) {
      if (idx < TOUR_STEPS.length - 1) {
        idx++;
        renderStep();
      } else {
        closeTour();
        toast('จบการสาธิตวิธีใช้งานแล้ว — เริ่มสร้างห้องเรียนจริงได้เลย!', 'success');
      }
    }
  });

  window.addEventListener('resize', updatePosition);
  window.addEventListener('scroll', updatePosition, true);
  document.addEventListener('keydown', onKey);

  renderStep();
}
