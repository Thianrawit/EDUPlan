// ============================================================
// EDUPLAN Classroom — Real-time Smart Polling, Focus/Visibility Sync & Conflict Protection
// โพลลิ่งทุก 12 วินาที + ตรวจสอบทันทีเมื่อสลับหน้าต่าง/แท็บกลับมาจาก Google Sheet (Debounce >= 3 วินาที)
// ============================================================
import { getAuthState } from './googleAuth';
import {
  getDriveFileModificationInfo,
  getLastLocalSpreadsheetWrite,
  pullRoomFromGoogleSheet,
} from './googleSheets';
import { escapeHtml, icon, type Classroom } from './types';
import { toast } from './components/ColumnMapperModal';

const POLL_INTERVAL_MS = 12_000; // 12 วินาที
const FOCUS_DEBOUNCE_MS = 3_000; // Debounce อย่างน้อย 3 วินาทีเมื่อสลับแท็บ/หน้าต่างกลับมา

export interface RealtimeSyncOptions {
  room: Classroom;
  isDirty: () => boolean;
  onAutoReloaded: (updatedRoom: Classroom, modifierEmail: string) => void;
  onDirtyConflict: (modifierEmail: string) => void;
}

let activeOptions: RealtimeSyncOptions | null = null;
let lastKnownModifiedTime: string | null = null;
let pollTimer: number | undefined;
let pollingInFlight = false;
let pendingModifierEmail: string | null = null;
let lastFocusCheckAt = 0;
let listenersBound = false;

function isNewerModifiedTime(remoteTime: string, knownTime: string | null): boolean {
  if (!remoteTime) return false;
  if (!knownTime) return false;
  if (remoteTime === knownTime) return false;
  const rMs = Date.parse(remoteTime);
  const kMs = Date.parse(knownTime);
  if (Number.isFinite(rMs) && Number.isFinite(kMs)) {
    return rMs > kMs;
  }
  return remoteTime !== knownTime;
}

async function checkOnce(fromFocus = false): Promise<void> {
  if (!activeOptions || pollingInFlight) return;
  if (typeof document !== 'undefined' && document.hidden) return;
  const { room } = activeOptions;
  if (room.syncMode !== 'google' || !room.sheet?.spreadsheetId) return;
  const auth = getAuthState();
  if (!auth.signedIn || !auth.tokenValid) return;

  const fileId = room.sheet.spreadsheetId;
  pollingInFlight = true;
  try {
    const info = await getDriveFileModificationInfo(fileId);
    if (!info?.modifiedTime || !activeOptions || activeOptions.room.id !== room.id) return;

    if (!lastKnownModifiedTime) {
      lastKnownModifiedTime = info.modifiedTime;
      return;
    }

    if (!isNewerModifiedTime(info.modifiedTime, lastKnownModifiedTime)) return;

    const modifierEmail =
      info.lastModifyingUser?.emailAddress ||
      info.lastModifyingUser?.displayName ||
      'Google Sheet';

    // ระหว่าง polling ปกติ: ข้ามหากเพิ่งเขียนจากหน้าเว็บนี้เองภายใน 6 วินาที
    // แต่หากสลับหน้าต่างกลับมาจากข้างนอก (fromFocus = true) ให้ดึงข้อมูลล่าสุดจาก Sheet เสมอ
    const myEmail = (auth.profile?.email ?? '').toLowerCase().trim();
    const modEmail = (info.lastModifyingUser?.emailAddress ?? '').toLowerCase().trim();
    const isSelf = !!myEmail && modEmail === myEmail;
    const recentLocalWrite = Date.now() - getLastLocalSpreadsheetWrite(fileId) < 6_000;
    if (!fromFocus && isSelf && recentLocalWrite) {
      lastKnownModifiedTime = info.modifiedTime;
      return;
    }

    if (!activeOptions.isDirty()) {
      // กรณี A: ไม่มีการแก้ไขค้างไว้ (!isDirty) -> ดึงข้อมูลล่าสุดจาก Google Sheet ทันทีแล้ว re-render
      const updatedRoom = await pullRoomFromGoogleSheet(activeOptions.room);
      if (!activeOptions || activeOptions.room.id !== room.id) return;
      activeOptions.room = updatedRoom;
      lastKnownModifiedTime = updatedRoom.lastKnownModifiedTime ?? updatedRoom.lastModifiedTime ?? info.modifiedTime;
      pendingModifierEmail = null;
      toast('อัปเดตข้อมูลล่าสุดจาก Google Sheet แล้ว', 'info', 4500, 'refresh');
      activeOptions.onAutoReloaded(updatedRoom, modifierEmail);
    } else {
      // กรณี B: กำลังติ๊กหรือพิมพ์แก้ค้างอยู่ (isDirty) -> ห้ามเขียนทับ แสดงแบนเนอร์ให้ผู้ใช้กดดึงเอง
      lastKnownModifiedTime = info.modifiedTime;
      pendingModifierEmail = modifierEmail;
      activeOptions.onDirtyConflict(modifierEmail);
    }
  } catch {
    /* silent background poll error */
  } finally {
    pollingInFlight = false;
  }
}

function handleReturnToApp(): void {
  if (!activeOptions) return;
  if (typeof document !== 'undefined' && document.hidden) return;
  const now = Date.now();
  if (now - lastFocusCheckAt < FOCUS_DEBOUNCE_MS) return;
  lastFocusCheckAt = now;
  void checkOnce(true);
}

function handleVisibilityChange(): void {
  if (typeof document !== 'undefined' && !document.hidden) {
    handleReturnToApp();
  }
}

function bindReturnListeners(): void {
  if (listenersBound || typeof window === 'undefined' || typeof document === 'undefined') return;
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('focus', handleReturnToApp);
  listenersBound = true;
}

function unbindReturnListeners(): void {
  if (!listenersBound || typeof window === 'undefined' || typeof document === 'undefined') return;
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('focus', handleReturnToApp);
  listenersBound = false;
}

/** อัปเดตเวลา modifiedTime ล่าสุดของห้องที่กำลังเปิดอยู่ (เรียกหลัง pull/push เสร็จ) */
export function notifyRealtimeModifiedTime(roomId: string, modifiedTime: string | undefined): void {
  if (!activeOptions || activeOptions.room.id !== roomId || !modifiedTime) return;
  lastKnownModifiedTime = modifiedTime;
  activeOptions.room.lastKnownModifiedTime = modifiedTime;
  activeOptions.room.lastModifiedTime = modifiedTime;
}

export function startRealtimeSync(opts: RealtimeSyncOptions): void {
  stopRealtimeSync();
  if (opts.room.syncMode !== 'google' || !opts.room.sheet?.spreadsheetId) return;
  activeOptions = opts;
  lastKnownModifiedTime = opts.room.lastKnownModifiedTime ?? opts.room.lastModifiedTime ?? null;
  pendingModifierEmail = null;

  bindReturnListeners();

  // ซิงก์ค่า modifiedTime เริ่มต้นแบบไม่บล็อก
  void checkOnce(false);

  pollTimer = window.setInterval(() => {
    void checkOnce(false);
  }, POLL_INTERVAL_MS);
}

export function stopRealtimeSync(): void {
  if (pollTimer !== undefined) {
    window.clearInterval(pollTimer);
    pollTimer = undefined;
  }
  unbindReturnListeners();
  activeOptions = null;
  lastKnownModifiedTime = null;
  pendingModifierEmail = null;
  pollingInFlight = false;
}

export function getPendingConflictModifier(): string | null {
  return pendingModifierEmail;
}

/** โหลดข้อมูลล่าสุดเมื่อผู้ใช้คลิก "[คลิกเพื่อดึงข้อมูลล่าสุด]" จากแถบแจ้งเตือน */
export async function resolveRealtimeConflict(): Promise<void> {
  if (!activeOptions) return;
  const modifier = pendingModifierEmail || 'Google Sheet';
  const updatedRoom = await pullRoomFromGoogleSheet(activeOptions.room);
  if (!activeOptions) return;
  activeOptions.room = updatedRoom;
  lastKnownModifiedTime = updatedRoom.lastKnownModifiedTime ?? updatedRoom.lastModifiedTime ?? lastKnownModifiedTime;
  pendingModifierEmail = null;
  toast('อัปเดตข้อมูลล่าสุดจาก Google Sheet แล้ว', 'success', 4200, 'refresh');
  activeOptions.onAutoReloaded(updatedRoom, modifier);
}

/** แสดงแถบแจ้งเตือนด้านบนสุดของตารางเมื่อข้อมูลใน Google Sheet ถูกแก้ไขระหว่างที่ผู้ใช้กำลังแก้ไขค้างอยู่ (isDirty) */
export function mountConflictBanner(host: HTMLElement, modifierEmail: string, onReload: () => void): void {
  let banner = host.querySelector<HTMLElement>('[data-rt-conflict-banner]');
  if (!banner) {
    banner = document.createElement('div');
    banner.dataset.rtConflictBanner = '1';
    banner.className = 'cr-rt-conflict-banner';
    host.prepend(banner);
  }
  const byWho = modifierEmail && modifierEmail !== 'Google Sheet' ? ` (${escapeHtml(modifierEmail)})` : '';
  banner.innerHTML = `
    <span class="cr-rt-conflict-banner__text">${icon('warning', 17)}<span>ข้อมูลใน Google Sheet ถูกแก้ไขใหม่${byWho}</span></span>
    <button type="button" class="cr-rt-conflict-banner__btn" data-rt-reload>${icon('refresh', 14)}<span>คลิกเพื่อดึงข้อมูลล่าสุด</span></button>
  `;
  banner.querySelector('[data-rt-reload]')?.addEventListener('click', (e) => {
    e.preventDefault();
    onReload();
  });
}
