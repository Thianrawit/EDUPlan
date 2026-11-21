// ============================================================
// EDUPLAN Classroom — Standalone Entry Point (classroom.html)
// ============================================================
import './classroom.css';
import { getAssignments, getClassroom, getSessions, getStudents, onDataChange } from './db';
import { exportClassroomXlsx } from './excelService';
import { getAuthState, initAuth, onAuthChange } from './googleAuth';
import {
  fetchRoomCollaborators,
  fetchSharedClassrooms,
  isGoogleNotFoundError,
  pickSpreadsheet,
  pullRoomFromGoogleSheet,
  syncAppData,
} from './googleSheets';
import {
  mountConflictBanner,
  notifyRealtimeModifiedTime,
  resolveRealtimeConflict,
  startRealtimeSync,
  stopRealtimeSync,
} from './realtimeSync';
import {
  classroomTitle,
  errorMessage,
  escapeHtml,
  getEffectiveRole,
  icon,
  roleBadgeHtml,
  safeHttpsUrl,
  type AppContext,
  type Classroom,
  type RoomTab,
} from './types';
import { renderAssignments } from './components/AssignmentsTab';
import { renderAttendance } from './components/AttendanceTab';
import { renderHub } from './components/ClassroomHub';
import { openCollaboratorModal } from './components/CollaboratorModal';
import { confirmDialog, toast, withBusy } from './components/ColumnMapperModal';
import { renderSettings } from './components/SettingsTab';
import { maybeShowFirstVisitTutorial, mountTopBar, refreshTopBar, setTopBarBackHandler, setTopBarSyncHandler } from './components/TopBar';

interface RouteState {
  view: 'hub' | 'room';
  roomId: string | null;
  tab: RoomTab;
}

const VALID_TABS: RoomTab[] = ['attendance', 'assignments', 'settings'];

function parseHash(): RouteState {
  const raw = window.location.hash.replace(/^#\/?/, '');
  if (!raw) return { view: 'hub', roomId: null, tab: 'attendance' };
  const [first, second, third] = raw.split('/');
  if (first === 'room' && second) {
    const tab = VALID_TABS.includes(third as RoomTab) ? (third as RoomTab) : 'attendance';
    return { view: 'room', roomId: decodeURIComponent(second), tab };
  }
  return { view: 'hub', roomId: null, tab: 'attendance' };
}

function buildHash(r: RouteState): string {
  if (r.view === 'room' && r.roomId) return `#/room/${encodeURIComponent(r.roomId)}/${r.tab}`;
  return '#/';
}

async function bootstrap(): Promise<void> {
  const topbarEl = document.getElementById('classroom-topbar');
  const appEl = document.getElementById('classroom-app');
  if (!topbarEl || !appEl) return;

  let route: RouteState = parseHash();
  let dirty = false;
  let rendering = false;
  let renderQueued = false;

  const confirmLeaveIfDirty = async (): Promise<boolean> => {
    if (!dirty) return true;
    const ok = await confirmDialog('มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้โดยไม่บันทึกหรือไม่?', {
      title: 'ยังไม่ได้บันทึกข้อมูล',
      confirmText: 'ออกจากหน้านี้',
      danger: true,
    });
    if (ok) dirty = false;
    return ok;
  };

  const ctx: AppContext = {
    openRoom: (id: string, tab: RoomTab = 'attendance') => {
      void navigate({ view: 'room', roomId: id, tab });
    },
    goHub: () => {
      void navigate({ view: 'hub', roomId: null, tab: 'attendance' });
    },
    refresh: () => {
      void render();
    },
    setDirty: (v: boolean) => {
      dirty = v;
    },
  };

  async function navigate(next: RouteState): Promise<void> {
    const same = next.view === route.view && next.roomId === route.roomId && next.tab === route.tab;
    if (!same && !(await confirmLeaveIfDirty())) {
      const curHash = buildHash(route);
      if (window.location.hash !== curHash) history.replaceState(null, '', curHash);
      return;
    }
    const prevRoomId = route.view === 'room' ? route.roomId : null;
    route = next;
    // เมื่อออกจากห้องเรียนหรือสลับไปห้องอื่น ให้ล้าง cooldown เพื่อดึงข้อมูลสดจาก Sheet ทันทีเมื่อคลิกเข้าห้องอีกครั้ง
    if (prevRoomId && (next.view !== 'room' || next.roomId !== prevRoomId)) {
      lastRoomPullAt.delete(prevRoomId);
    }
    const targetHash = buildHash(route);
    if (window.location.hash !== targetHash) history.pushState(null, '', targetHash);
    await render();
  }

  const activeRoomPulls = new Map<string, Promise<Classroom | null>>();
  const lastRoomPullAt = new Map<string, number>();
  const ROOM_PULL_COOLDOWN_MS = 4000;

  function ensureRoomPull(room: Classroom): Promise<Classroom | null> {
    const existing = activeRoomPulls.get(room.id);
    if (existing) return existing;
    const job = (async (): Promise<Classroom | null> => {
      try {
        return await pullRoomFromGoogleSheet(room);
      } catch (err) {
        if (isGoogleNotFoundError(err)) {
          const ok = await confirmDialog(
            `ยังไม่สามารถอ่านข้อมูลภายในไฟล์ "${room.sheet?.spreadsheetName || room.subject}" ได้ (HTTP 404)\n\nอาจเกิดจาก Token เดิมยังไม่ได้อนุญาตสิทธิ์ Google Sheets หรือต้องเลือกไฟล์ผ่าน Google Picker 1 ครั้งเพื่อเปิดสิทธิ์\n\nต้องการเปิด Google Picker เพื่อเลือกไฟล์นี้และปลดล็อกสิทธิ์หรือไม่?`,
            { title: 'ยืนยันสิทธิ์เข้าถึงไฟล์ Google Sheet', confirmText: 'เลือกไฟล์เพื่อเปิดสิทธิ์' },
          );
          if (ok) {
            try {
              const picked = await pickSpreadsheet({
                sharedOnly: room.role !== 'owner',
                title: `เลือกไฟล์ "${room.sheet?.spreadsheetName || room.subject}" เพื่อเปิดสิทธิ์การซิงก์`,
              });
              if (picked) {
                const pulled = await pullRoomFromGoogleSheet(room);
                toast('เปิดสิทธิ์และดึงข้อมูลล่าสุดจาก Google Sheet สำเร็จแล้ว', 'success');
                return pulled;
              }
            } catch (err2) {
              toast(`เปิดสิทธิ์ Google Sheet ไม่สำเร็จ: ${errorMessage(err2)}`, 'warn');
            }
          }
        } else {
          toast(`ดึงข้อมูลล่าสุดจาก Google Sheet ไม่สำเร็จ: ${errorMessage(err)}`, 'warn');
        }
        return null;
      } finally {
        lastRoomPullAt.set(room.id, Date.now());
        activeRoomPulls.delete(room.id);
      }
    })();
    activeRoomPulls.set(room.id, job);
    return job;
  }

  async function renderRoomWorkspace(room: Classroom): Promise<void> {
    const currentRole = getEffectiveRole(room);
    const isOwner = currentRole === 'owner';
    const canSeeSettings = isOwner || currentRole === 'creator';
    const canSeeSheetLink = isOwner || currentRole === 'creator';

    if (!canSeeSettings && route.tab === 'settings') {
      route = { ...route, tab: 'attendance' };
      history.replaceState(null, '', buildHash(route));
    }

    const google = room.syncMode === 'google' && !!room.sheet;
    const students = await getStudents(room.id);
    const collabCount = (room.collaborators ?? []).length;

    const authNow = getAuthState();
    const pullInFlight = activeRoomPulls.has(room.id);
    const needsAutoPull =
      google &&
      authNow.signedIn &&
      authNow.tokenValid &&
      Date.now() - (lastRoomPullAt.get(room.id) ?? 0) > ROOM_PULL_COOLDOWN_MS;
    const shouldSyncSheet = pullInFlight || needsAutoPull;

    appEl!.innerHTML = `
      <section class="cr-page">
        <div class="cr-ws-bar">
          <div class="cr-ws-bar__left">
            <div class="cr-ws-title">
              <div class="flex flex-wrap items-center gap-2">
                <h1 class="cr-h1">${escapeHtml(classroomTitle(room))}</h1>
                ${roleBadgeHtml(currentRole)}
                <span class="cr-badge ${google ? 'cr-badge--green' : 'cr-badge--gray'}">
                  <span class="cr-dot ${google ? 'cr-dot--green' : 'cr-dot--gray'}"></span>
                  <span>${google ? 'ซิงก์ Google Sheet' : 'ในเครื่อง'}</span>
                </span>
                ${
                  shouldSyncSheet && students.length > 0
                    ? `<span class="cr-badge cr-badge--gray" data-sheet-sync-pill>
                        <span class="cr-spinner cr-spinner--sm"></span>
                        <span>กำลังดึงข้อมูลล่าสุดจาก Sheet...</span>
                      </span>`
                    : ''
                }
                ${
                  isOwner && !google
                    ? `<span class="cr-badge cr-badge--amber" title="ต้องเชื่อมต่อ Google Sheet ก่อนจึงจะเชิญผู้ร่วมสอนได้">ต้องเชื่อมต่อ Google Sheet ก่อนจึงจะเชิญผู้ร่วมสอนได้</span>`
                    : ''
                }
              </div>
              <p class="cr-muted">
                ภาคเรียนที่ ${escapeHtml(room.term || '-')}/${escapeHtml(room.academicYear || '-')} · นักเรียน ${students.length} คน
                ${!isOwner && room.ownerEmail ? ` · เจ้าของห้อง: <b>${escapeHtml(room.ownerEmail)}</b>` : ''}
              </p>
            </div>
          </div>
          <div class="cr-ws-bar__right">
            ${
              isOwner
                ? `<button type="button" class="cr-btn cr-btn--outline" data-manage-collab title="${google ? 'เชิญและจัดการสิทธิ์ผู้ร่วมสอน' : 'ต้องเชื่อมต่อ Google Sheet ก่อนจึงจะเชิญผู้ร่วมสอนได้'}">
                    ${icon('users', 16)}
                    <span>จัดการผู้ร่วมสอน (<span data-collab-count>${collabCount}</span>/5)</span>
                  </button>`
                : ''
            }
            ${(() => {
              const url = google && canSeeSheetLink ? safeHttpsUrl(room.sheet?.spreadsheetUrl) : '';
              return url
                ? `<a class="cr-btn cr-btn--outline" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">
                    ${icon('external', 16)}
                    <span>เปิด Google Sheet</span>
                  </a>`
                : '';
            })()}
            <button type="button" class="cr-btn cr-btn--excel" data-export-xlsx>
              ${icon('spreadsheet', 16)}
              <span>ส่งออก Excel (.xlsx)</span>
            </button>
          </div>
        </div>

        <nav class="cr-tabs ${!canSeeSettings ? 'cr-tabs--2' : ''}" role="tablist" aria-label="เมนูจัดการห้องเรียน">
          <button type="button" role="tab" aria-selected="${route.tab === 'attendance'}" class="cr-tab ${route.tab === 'attendance' ? 'is-active' : ''}" data-tab="attendance">
            ${icon('calendar', 17)}
            <span>การมาเรียน</span>
          </button>
          <button type="button" role="tab" aria-selected="${route.tab === 'assignments'}" class="cr-tab ${route.tab === 'assignments' ? 'is-active' : ''}" data-tab="assignments">
            ${icon('clipboard', 17)}
            <span>การส่งงาน</span>
          </button>
          ${
            canSeeSettings
              ? `<button type="button" role="tab" aria-selected="${route.tab === 'settings'}" class="cr-tab ${route.tab === 'settings' ? 'is-active' : ''}" data-tab="settings">
                  ${icon('settings', 17)}
                  <span>ตั้งค่าตารางและคอลัมน์</span>
                </button>`
              : ''
          }
        </nav>

        <div id="cr-tab-panel" class="cr-tab-panel" role="tabpanel"></div>
      </section>`;

    const bar = appEl!.querySelector('.cr-ws-bar') as HTMLElement;
    const tabs = appEl!.querySelector('.cr-tabs') as HTMLElement;
    const panel = appEl!.querySelector('#cr-tab-panel') as HTMLElement;

    const updateCollabCountLabel = (n: number) => {
      const cntEl = bar.querySelector('[data-collab-count]');
      if (cntEl) cntEl.textContent = String(n);
    };

    if (isOwner && google && getAuthState().signedIn) {
      fetchRoomCollaborators(room)
        .then((list) => updateCollabCountLabel(list.length))
        .catch(() => undefined);
    }

    bar.addEventListener('click', async (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-back-hub]')) {
        ctx.goHub();
        return;
      }
      if (isOwner && t.closest('[data-manage-collab]')) {
        openCollaboratorModal(room, (collabs, updatedRoom) => {
          Object.assign(room, updatedRoom);
          updateCollabCountLabel(collabs.length);
          if (!dirty) void render();
        });
        return;
      }
      const expBtn = t.closest<HTMLButtonElement>('[data-export-xlsx]');
      if (expBtn) {
        await withBusy(expBtn, 'กำลังสร้างไฟล์...', async () => {
          try {
            const [sts, ses, asg] = await Promise.all([
              getStudents(room.id),
              getSessions(room.id),
              getAssignments(room.id),
            ]);
            await exportClassroomXlsx(room, sts, ses, asg);
            toast('ส่งออกไฟล์ Excel (.xlsx) เรียบร้อย', 'success');
          } catch (err) {
            toast(errorMessage(err), 'error');
          }
        });
      }
    });

    tabs.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-tab]');
      if (!btn) return;
      const tab = btn.dataset.tab as RoomTab;
      if (tab !== route.tab) ctx.openRoom(room.id, tab);
    });

    if (shouldSyncSheet && students.length === 0) {
      panel.innerHTML = `
        <div class="cr-empty" style="text-align:center;">
          <span class="cr-spinner" style="width:26px;height:26px;border-width:2.5px;color:var(--cr-primary);display:inline-block;"></span>
          <p class="mt-3 font-semibold" style="color:var(--cr-ink);">กำลังดึงข้อมูลล่าสุดจาก Sheet...</p>
          <p class="cr-muted mt-1">โปรดรอสักครู่ ระบบกำลังซิงก์รายชื่อ การมาเรียน และคะแนนล่าสุดจาก Google Sheet</p>
        </div>`;
    } else if (route.tab === 'attendance') {
      await renderAttendance(panel, room, ctx, currentRole);
    } else if (route.tab === 'assignments') {
      await renderAssignments(panel, room, ctx, currentRole);
    } else if (canSeeSettings) {
      await renderSettings(panel, room, ctx, currentRole);
    } else {
      await renderAttendance(panel, room, ctx, currentRole);
    }

    if (shouldSyncSheet) {
      void ensureRoomPull(room).then((pulled) => {
        bar.querySelector('[data-sheet-sync-pill]')?.remove();
        if (pulled) {
          notifyRealtimeModifiedTime(room.id, pulled.lastKnownModifiedTime ?? pulled.lastModifiedTime);
        }
        if (route.view !== 'room' || route.roomId !== room.id) return;
        if (!dirty && (pulled || students.length === 0)) {
          void render();
        } else if (pulled && dirty) {
          const currentPanel = appEl!.querySelector<HTMLElement>('#cr-tab-panel');
          if (currentPanel) {
            mountConflictBanner(currentPanel, 'Google Sheet', () => {
              dirty = false;
              void resolveRealtimeConflict();
            });
          }
        }
      });
    }

    if (google) {
      startRealtimeSync({
        room,
        isDirty: () => dirty,
        onAutoReloaded: (updatedRoom) => {
          lastRoomPullAt.set(updatedRoom.id, Date.now());
          if (route.view === 'room' && route.roomId === room.id && !dirty) {
            void render();
          }
        },
        onDirtyConflict: (modifierEmail) => {
          const currentPanel = appEl!.querySelector<HTMLElement>('#cr-tab-panel');
          if (!currentPanel) return;
          mountConflictBanner(currentPanel, modifierEmail, () => {
            dirty = false;
            void resolveRealtimeConflict();
          });
        },
      });
    } else {
      stopRealtimeSync();
    }
  }

  async function render(): Promise<void> {
    if (rendering) {
      renderQueued = true;
      return;
    }
    rendering = true;
    try {
      do {
        renderQueued = false;
        dirty = false;
        const snapshotRoute = { ...route };
        // ล้าง handler เดิมบน appEl ทุกครั้งก่อนสลับหน้า
        appEl!.onclick = null;
        appEl!.onkeydown = null;
        appEl!.onchange = null;
        appEl!.oninput = null;
        appEl!.onsubmit = null;

        if (snapshotRoute.view === 'room' && snapshotRoute.roomId) {
          const room = await getClassroom(snapshotRoute.roomId);
          if (route.view !== snapshotRoute.view || route.roomId !== snapshotRoute.roomId || route.tab !== snapshotRoute.tab) {
            renderQueued = true;
            continue;
          }
          if (!room) {
            stopRealtimeSync();
            toast('ไม่พบห้องเรียนที่เลือก', 'warn');
            route = { view: 'hub', roomId: null, tab: 'attendance' };
            history.replaceState(null, '', '#/');
            refreshTopBar();
            await renderHub(appEl!, ctx);
            continue;
          }
          refreshTopBar();
          await renderRoomWorkspace(room);
        } else {
          stopRealtimeSync();
          refreshTopBar();
          await renderHub(appEl!, ctx);
        }
      } while (renderQueued);
    } finally {
      rendering = false;
    }
  }

  const auth = initAuth();
  mountTopBar(topbarEl);
  setTopBarBackHandler(() => ctx.goHub());
  setTopBarSyncHandler(async () => {
    if (route.view !== 'room' || !route.roomId) return false;
    const currentRoom = await getClassroom(route.roomId);
    if (!currentRoom || currentRoom.syncMode !== 'google' || !currentRoom.sheet) return false;
    if (dirty) {
      const ok = await confirmDialog(
        'มีการแก้ไขที่ยังไม่ได้บันทึกอยู่ในหน้านี้ ต้องการดึงข้อมูลล่าสุดจาก Google Sheet มาทับหรือไม่?',
        { title: 'ยืนยันการดึงข้อมูลจาก Google Sheet', confirmText: 'ดึงข้อมูลล่าสุด', danger: true },
      );
      if (!ok) return true;
      dirty = false;
    }
    const pulled = await pullRoomFromGoogleSheet(currentRoom);
    lastRoomPullAt.set(currentRoom.id, Date.now());
    notifyRealtimeModifiedTime(currentRoom.id, pulled.lastKnownModifiedTime ?? pulled.lastModifiedTime);
    await render();
    toast('อัปเดตข้อมูลล่าสุดจาก Google Sheet แล้ว', 'success', 4200, 'refresh');
    return true;
  });

  if (auth.signedIn && auth.tokenValid) {
    Promise.all([
      syncAppData().catch(() => 0),
      fetchSharedClassrooms().catch(() => []),
    ]).then(([changed]) => {
      if (changed > 0 && !dirty) void render();
    });
  }

  let prevSigned = auth.signedIn;
  let prevTokenValid = auth.tokenValid;
  onAuthChange((s) => {
    if (s.signedIn !== prevSigned || s.tokenValid !== prevTokenValid) {
      prevSigned = s.signedIn;
      prevTokenValid = s.tokenValid;
      if (!dirty) void render();
    }
  });

  onDataChange((changedRoomId) => {
    if (dirty) return;
    if (route.view === 'hub' || changedRoomId === null) void render();
  });

  window.addEventListener('hashchange', () => {
    const next = parseHash();
    if (next.view !== route.view || next.roomId !== route.roomId || next.tab !== route.tab) {
      void navigate(next);
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  await render();
  maybeShowFirstVisitTutorial();
}

void bootstrap();
