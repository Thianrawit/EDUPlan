// ============================================================
// EDUPLAN Classroom — Real-time Smart Polling & Conflict Protection
// โพลลิ่งทุก 12 วินาทีเมื่อเปิดหน้าห้องเรียนที่ซิงก์ Google Sheet และแท็บเปิดอยู่ (!document.hidden)
// ============================================================
import { getAuthState } from './googleAuth';
import {
  getDriveFileModificationInfo,
  getLastLocalSpreadsheetWrite,
  pullClassroomFromSheet,
} from './googleSheets';
import { escapeHtml, icon, type Classroom } from './types';
import { toast } from './components/ColumnMapperModal';

const POLL_INTERVAL_MS = 12_000; // 12 วินาที

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

async function checkOnce(): Promise<void> {
  if (!activeOptions || pollingInFlight) return;
  if (typeof document !== 'undefined' && document.hidden) return;
  const { room } = activeOptions;
  if (room.syncMode !== 'google' || !room.sheet?.spreadsheetId) return;
  const auth = getAuthState();
  if (!auth.signedIn) return;

  const fileId = room.sheet.spreadsheetId;
  pollingInFlight = true;
  try {
    const info = await getDriveFileModificationInfo(fileId);
    if (!info?.modifiedTime || !activeOptions || activeOptions.room.id !== room.id) return;

    if (!lastKnownModifiedTime) {
      lastKnownModifiedTime = info.modifiedTime;
      return;
    }

    if (info.modifiedTime === lastKnownModifiedTime) return;

    lastKnownModifiedTime = info.modifiedTime;
    const modifierEmail =
      info.lastModifyingUser?.emailAddress ||
      info.lastModifyingUser?.displayName ||
      'ผู้ร่วมสอน';

    // ข้ามหากเป็นการเขียนของเครื่องตัวเองเมื่อครู่
    const myEmail = (auth.profile?.email ?? '').toLowerCase().trim();
    const modEmail = (info.lastModifyingUser?.emailAddress ?? '').toLowerCase().trim();
    const isSelf = !!myEmail && modEmail === myEmail;
    const recentLocalWrite = Date.now() - getLastLocalSpreadsheetWrite(fileId) < 10_000;
    if (isSelf && recentLocalWrite) {
      return;
    }

    if (!activeOptions.isDirty()) {
      // กรณี A: ไม่มีการแก้ไขค้างไว้ (!isDirty) -> ดูดข้อมูลล่าสุดจาก Google Sheet ทันที
      const updatedRoom = await pullClassroomFromSheet(activeOptions.room);
      if (!activeOptions || activeOptions.room.id !== room.id) return;
      activeOptions.room = updatedRoom;
      pendingModifierEmail = null;
      toast(`ข้อมูลถูกอัปเดตล่าสุดโดย ${modifierEmail}`, 'info', 5000, 'refresh');
      activeOptions.onAutoReloaded(updatedRoom, modifierEmail);
    } else {
      // กรณี B: กำลังแก้ไขค้างไว้ (isDirty) -> ห้ามรีเฟรชทับ แสดงแถบแจ้งเตือนด้านบนสุดของตาราง
      pendingModifierEmail = modifierEmail;
      activeOptions.onDirtyConflict(modifierEmail);
    }
  } catch {
    /* silent background poll error */
  } finally {
    pollingInFlight = false;
  }
}

export function startRealtimeSync(opts: RealtimeSyncOptions): void {
  stopRealtimeSync();
  if (opts.room.syncMode !== 'google' || !opts.room.sheet?.spreadsheetId) return;
  activeOptions = opts;
  lastKnownModifiedTime = opts.room.lastModifiedTime ?? null;
  pendingModifierEmail = null;

  // ซิงก์ค่า modifiedTime เริ่มต้นแบบไม่บล็อก
  void checkOnce();

  pollTimer = window.setInterval(() => {
    void checkOnce();
  }, POLL_INTERVAL_MS);
}

export function stopRealtimeSync(): void {
  if (pollTimer !== undefined) {
    window.clearInterval(pollTimer);
    pollTimer = undefined;
  }
  activeOptions = null;
  lastKnownModifiedTime = null;
  pendingModifierEmail = null;
  pollingInFlight = false;
}

export function getPendingConflictModifier(): string | null {
  return pendingModifierEmail;
}

/** โหลดข้อมูลล่าสุดเมื่อผู้ใช้คลิก "[คลิกเพื่อโหลดข้อมูลล่าสุด]" จากแถบแจ้งเตือน */
export async function resolveRealtimeConflict(): Promise<void> {
  if (!activeOptions) return;
  const modifier = pendingModifierEmail || 'ผู้ร่วมสอน';
  const updatedRoom = await pullClassroomFromSheet(activeOptions.room);
  if (!activeOptions) return;
  activeOptions.room = updatedRoom;
  lastKnownModifiedTime = updatedRoom.lastModifiedTime ?? lastKnownModifiedTime;
  pendingModifierEmail = null;
  toast(`โหลดข้อมูลล่าสุดโดย ${modifier} เรียบร้อยแล้ว`, 'success', 4200, 'refresh');
  activeOptions.onAutoReloaded(updatedRoom, modifier);
}

/** แสดงแถบแจ้งเตือนด้านบนสุดของตารางเมื่อเกิด Conflict ระหว่างที่ผู้ใช้ยังไม่ได้กดบันทึก (isDirty) */
export function mountConflictBanner(host: HTMLElement, modifierEmail: string, onReload: () => void): void {
  let banner = host.querySelector<HTMLElement>('[data-rt-conflict-banner]');
  if (!banner) {
    banner = document.createElement('div');
    banner.dataset.rtConflictBanner = '1';
    banner.className = 'cr-rt-conflict-banner';
    host.prepend(banner);
  }
  banner.innerHTML = `
    <span class="cr-rt-conflict-banner__text">${icon('warning', 17)}<span>มีการบันทึกข้อมูลใหม่จาก <b>${escapeHtml(modifierEmail)}</b></span></span>
    <button type="button" class="cr-rt-conflict-banner__btn" data-rt-reload>${icon('refresh', 14)}<span>คลิกเพื่อโหลดข้อมูลล่าสุด</span></button>
  `;
  banner.querySelector('[data-rt-reload]')?.addEventListener('click', (e) => {
    e.preventDefault();
    onReload();
  });
}
