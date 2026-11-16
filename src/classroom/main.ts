// ============================================================
// EDUPLAN Classroom — Standalone Entry Point (classroom.html)
// ============================================================
import './classroom.css';
import { getAssignments, getClassroom, getSessions, getStudents, onDataChange } from './db';
import { exportClassroomXlsx } from './excelService';
import { initAuth, onAuthChange } from './googleAuth';
import { syncAppData } from './googleSheets';
import { classroomTitle, errorMessage, escapeHtml, icon, safeHttpsUrl, type AppContext, type Classroom, type RoomTab } from './types';
import { renderAssignments } from './components/AssignmentsTab';
import { renderAttendance } from './components/AttendanceTab';
import { renderHub } from './components/ClassroomHub';
import { confirmDialog, toast, withBusy } from './components/ColumnMapperModal';
import { renderSettings } from './components/SettingsTab';
import { maybeShowFirstVisitTutorial, mountTopBar, refreshTopBar, setTopBarBackHandler } from './components/TopBar';

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
    route = next;
    const targetHash = buildHash(route);
    if (window.location.hash !== targetHash) history.pushState(null, '', targetHash);
    await render();
  }

  async function renderRoomWorkspace(room: Classroom): Promise<void> {
    const google = room.syncMode === 'google' && !!room.sheet;
    const students = await getStudents(room.id);
    appEl!.innerHTML = `
      <section class="cr-page">
        <div class="cr-ws-bar">
          <div class="cr-ws-bar__left">
            <div class="cr-ws-title">
              <div class="flex flex-wrap items-center gap-2">
                <h1 class="cr-h1">${escapeHtml(classroomTitle(room))}</h1>
                <span class="cr-badge ${google ? 'cr-badge--green' : 'cr-badge--gray'}">
                  <span class="cr-dot ${google ? 'cr-dot--green' : 'cr-dot--gray'}"></span>
                  <span>${google ? 'ซิงก์ Google Sheet' : 'ในเครื่อง'}</span>
                </span>
              </div>
              <p class="cr-muted">ภาคเรียนที่ ${escapeHtml(room.term || '-')}/${escapeHtml(room.academicYear || '-')} · นักเรียน ${students.length} คน</p>
            </div>
          </div>
          <div class="cr-ws-bar__right">
            ${(() => {
              const url = google ? safeHttpsUrl(room.sheet?.spreadsheetUrl) : '';
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

        <nav class="cr-tabs" role="tablist" aria-label="เมนูจัดการห้องเรียน">
          <button type="button" role="tab" aria-selected="${route.tab === 'attendance'}" class="cr-tab ${route.tab === 'attendance' ? 'is-active' : ''}" data-tab="attendance">
            ${icon('calendar', 17)}
            <span>การมาเรียน</span>
          </button>
          <button type="button" role="tab" aria-selected="${route.tab === 'assignments'}" class="cr-tab ${route.tab === 'assignments' ? 'is-active' : ''}" data-tab="assignments">
            ${icon('clipboard', 17)}
            <span>การส่งงาน</span>
          </button>
          <button type="button" role="tab" aria-selected="${route.tab === 'settings'}" class="cr-tab ${route.tab === 'settings' ? 'is-active' : ''}" data-tab="settings">
            ${icon('settings', 17)}
            <span>ตั้งค่าตารางและคอลัมน์</span>
          </button>
        </nav>

        <div id="cr-tab-panel" class="cr-tab-panel" role="tabpanel"></div>
      </section>`;

    const bar = appEl!.querySelector('.cr-ws-bar') as HTMLElement;
    const tabs = appEl!.querySelector('.cr-tabs') as HTMLElement;
    const panel = appEl!.querySelector('#cr-tab-panel') as HTMLElement;

    bar.addEventListener('click', async (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-back-hub]')) {
        ctx.goHub();
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

    if (route.tab === 'attendance') await renderAttendance(panel, room, ctx);
    else if (route.tab === 'assignments') await renderAssignments(panel, room, ctx);
    else await renderSettings(panel, room, ctx);
  }

  async function render(): Promise<void> {
    if (rendering) return;
    rendering = true;
    try {
      dirty = false;
      // ล้าง handler เดิมบน appEl ทุกครั้งก่อนสลับหน้า
      appEl!.onclick = null;
      appEl!.onkeydown = null;
      appEl!.onchange = null;
      appEl!.oninput = null;
      appEl!.onsubmit = null;

      if (route.view === 'room' && route.roomId) {
        const room = await getClassroom(route.roomId);
        if (!room) {
          toast('ไม่พบห้องเรียนที่เลือก', 'warn');
          route = { view: 'hub', roomId: null, tab: 'attendance' };
          history.replaceState(null, '', '#/');
          refreshTopBar();
          await renderHub(appEl!, ctx);
          return;
        }
        refreshTopBar();
        await renderRoomWorkspace(room);
      } else {
        refreshTopBar();
        await renderHub(appEl!, ctx);
      }
    } finally {
      rendering = false;
    }
  }

  const auth = initAuth();
  mountTopBar(topbarEl);
  setTopBarBackHandler(() => ctx.goHub());

  if (auth.signedIn && auth.tokenValid) {
    syncAppData()
      .then((changed) => {
        if (changed > 0 && !dirty) void render();
      })
      .catch(() => undefined);
  }

  let prevSigned = auth.signedIn;
  onAuthChange((s) => {
    if (s.signedIn !== prevSigned) {
      prevSigned = s.signedIn;
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
