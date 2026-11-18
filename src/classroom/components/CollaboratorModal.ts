// ============================================================
// EDUPLAN Classroom — Collaborator Management Modal (RBAC Option A)
// เปิดได้เฉพาะเจ้าของห้อง (owner) สูงสุด 5 คนต่อห้องเรียน
// ============================================================
import { getAuthState, signIn } from '../googleAuth';
import {
  addCollaborator,
  fetchRoomCollaborators,
  removeCollaborator,
  updateCollaboratorRole,
  upgradeToStandardSheet,
} from '../googleSheets';
import {
  COLLAB_ROLE_OPTIONS,
  ROLE_BADGE_LABEL,
  classroomTitle,
  errorMessage,
  escapeHtml,
  getEffectiveRole,
  icon,
  roleBadgeHtml,
  type Classroom,
  type ClassroomRole,
  type Collaborator,
} from '../types';
import { confirmDialog, openModal, toast, withBusy } from './ColumnMapperModal';

export function openCollaboratorModal(
  room: Classroom,
  onUpdated?: (collabs: Collaborator[], updatedRoom: Classroom) => void,
): void {
  if (getEffectiveRole(room) !== 'owner') {
    toast('เฉพาะเจ้าของห้องเรียนเท่านั้นที่สามารถจัดการผู้ร่วมสอนได้', 'warn');
    return;
  }

  let collabs: Collaborator[] = [...(room.collaborators ?? [])];
  let selectedRole: Exclude<ClassroomRole, 'owner'> = 'assistant';
  let emailDraft = '';
  let loading = false;

  const modal = openModal({
    title: `จัดการผู้ร่วมสอน — ${classroomTitle(room)}`,
    titleIcon: 'users',
    size: 'md',
    body: '<div data-collab-root></div>',
    footer: '<button type="button" class="cr-btn cr-btn--outline" data-close-collab>ปิดหน้าต่าง</button>',
  });

  const root = modal.body.querySelector<HTMLElement>('[data-collab-root]')!;
  modal.footer.querySelector('[data-close-collab]')?.addEventListener('click', () => modal.close());

  const notifyParent = () => {
    room.collaborators = collabs;
    onUpdated?.(collabs, room);
  };

  const render = () => {
    const auth = getAuthState();
    const isGoogleSynced = room.syncMode === 'google' && !!room.sheet?.spreadsheetId;

    if (!isGoogleSynced) {
      root.innerHTML = `
        <div class="cr-alert cr-alert--warn">
          ${icon('warning', 20)}
          <div>
            <strong>ต้องเชื่อมต่อ Google Sheet ก่อนจึงจะเชิญผู้ร่วมสอนได้</strong>
            <p class="cr-muted mt-1">
              ห้องเรียนนี้อยู่ในโหมดในเครื่อง (Local Only) การเชิญครูผู้ช่วยหรือผู้ร่วมสอนจำเป็นต้องซิงก์ห้องเรียนกับ Google Sheet บน Google Drive ก่อน
            </p>
            ${
              auth.signedIn
                ? `<button type="button" class="cr-btn cr-btn--primary cr-btn--sm mt-3" data-upgrade-now>
                    ${icon('cloud-up', 15)}
                    <span>สร้าง Google Sheet และเชื่อมต่อทันที</span>
                  </button>`
                : auth.configured
                  ? `<button type="button" class="cr-btn cr-btn--primary cr-btn--sm mt-3" data-login-now>
                      ${icon('cloud-up', 15)}
                      <span>เข้าสู่ระบบด้วย Google ก่อน</span>
                    </button>`
                  : ''
            }
          </div>
        </div>`;
      return;
    }

    if (!auth.signedIn) {
      root.innerHTML = `
        <div class="cr-alert cr-alert--info">
          ${icon('info', 20)}
          <div>
            <strong>กรุณาเข้าสู่ระบบด้วย Google เพื่อจัดการผู้ร่วมสอน</strong>
            <p class="cr-muted mt-1">การเพิ่ม เปลี่ยนสิทธิ์ หรือลบผู้ร่วมสอนจะซิงก์สิทธิ์กับไฟล์ Google Sheet ของห้องนี้โดยตรง</p>
            ${
              auth.configured
                ? `<button type="button" class="cr-btn cr-btn--primary cr-btn--sm mt-3" data-login-now>
                    ${icon('cloud-up', 15)}
                    <span>เข้าสู่ระบบด้วย Google</span>
                  </button>`
                : ''
            }
          </div>
        </div>`;
      return;
    }

    const isFull = collabs.length >= 5;
    const roleOptionsHtml = COLLAB_ROLE_OPTIONS.map(
      (opt) => `<option value="${opt.value}" ${selectedRole === opt.value ? 'selected' : ''}>${escapeHtml(opt.label)}</option>`,
    ).join('');

    root.innerHTML = `
      <div class="cr-collab-box">
        <div class="cr-collab-head">
          <div class="flex items-center flex-wrap gap-2">
            ${roleBadgeHtml('owner')}
            <span class="cr-muted">${escapeHtml(auth.profile?.email || '')}</span>
          </div>
          <span class="cr-collab-count ${isFull ? 'is-full' : ''}">ผู้ร่วมสอน <b>${collabs.length}/5</b> คน</span>
        </div>

        <form data-invite-form class="cr-collab-invite" novalidate>
          <div class="cr-collab-invite__row">
            <label class="cr-field cr-collab-invite__email">
              <span class="cr-label">อีเมลบัญชี Google ของผู้ร่วมสอน</span>
              <input
                type="email"
                class="cr-input"
                data-collab-email
                placeholder="example@gmail.com"
                value="${escapeHtml(emailDraft)}"
                ${isFull ? 'disabled' : ''}
                required
              />
            </label>
            <label class="cr-field cr-collab-invite__role">
              <span class="cr-label">ระดับสิทธิ์การใช้งาน</span>
              <select class="cr-input" data-collab-role ${isFull ? 'disabled' : ''}>
                ${roleOptionsHtml}
              </select>
            </label>
            <div class="cr-collab-invite__cta">
              <button type="submit" class="cr-btn cr-btn--primary" data-invite-btn ${isFull ? 'disabled title="ครบจำนวนสูงสุด 5 คนแล้ว"' : ''}>
                ${icon('plus', 16)}
                <span>เชิญ</span>
              </button>
            </div>
          </div>
          ${
            isFull
              ? `<p class="cr-text-danger text-sm mt-2">ครบจำนวนผู้ร่วมสอนสูงสุด 5 คนต่อห้องแล้ว (หากต้องการเพิ่มใหม่ กรุณาลบรายชื่อเดิมออกก่อน)</p>`
              : `<p class="cr-faint mt-2">ระบบจะแชร์สิทธิ์ไฟล์ Google Sheet ของห้องนี้ให้ผู้ร่วมสอนอัตโนมัติโดยไม่ต้องส่งอีเมลรบกวน</p>`
          }
        </form>

        <div class="cr-collab-list-wrap mt-4">
          <div class="flex items-center justify-between mb-2">
            <h3 class="cr-h3 mb-0">รายชื่อผู้ร่วมสอนปัจจุบัน (${collabs.length}/5)</h3>
            ${loading ? `<span class="cr-faint flex items-center gap-1"><span class="cr-spinner cr-spinner--sm"></span> กำลังซิงก์สิทธิ์...</span>` : ''}
          </div>
          ${
            collabs.length
              ? `<ul class="cr-collab-list">
                  ${collabs
                    .map((c) => {
                      const opts = COLLAB_ROLE_OPTIONS.map(
                        (o) => `<option value="${o.value}" ${c.role === o.value ? 'selected' : ''}>${escapeHtml(o.label)}</option>`,
                      ).join('');
                      return `
                        <li class="cr-collab-item" data-collab-row="${escapeHtml(c.email)}">
                          <div class="cr-collab-item__info">
                            ${roleBadgeHtml(c.role)}
                            <span class="cr-collab-item__email" title="${escapeHtml(c.email)}">${escapeHtml(c.email)}</span>
                          </div>
                          <div class="cr-collab-item__actions">
                            <select class="cr-input cr-input--sm cr-collab-role-select" data-change-role="${escapeHtml(c.email)}" aria-label="เปลี่ยนสิทธิ์ของ ${escapeHtml(c.email)}">
                              ${opts}
                            </select>
                            <button type="button" class="cr-btn cr-btn--outline cr-btn--sm cr-text-danger" data-remove-collab="${escapeHtml(c.email)}" title="ลบผู้ร่วมสอนออก">
                              ${icon('trash', 14)}
                              <span>ลบออก</span>
                            </button>
                          </div>
                        </li>`;
                    })
                    .join('')}
                </ul>`
              : `<div class="cr-empty-mini">ยังไม่มีผู้ร่วมสอนในห้องเรียนนี้ — กรอกอีเมลด้านบนเพื่อเชิญครูผู้ช่วยหรือผู้ร่วมสอน</div>`
          }
          <div class="cr-alert cr-alert--info mt-3 mb-0">
            ${icon('info', 17)}
            <span>แจ้งผู้ถูกเชิญให้ล็อกอินแล้วกดปุ่ม <b>'${icon('download', 14)} รับห้องเรียนที่ถูกแชร์'</b> เพื่อเลือกไฟล์ของห้องนี้เข้าสู่หน้าหลัก</span>
          </div>
        </div>
      </div>`;
  };

  root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches('[data-collab-email]')) {
      emailDraft = t.value;
    }
  });

  root.addEventListener('change', async (e) => {
    const t = e.target as HTMLSelectElement;
    if (t.matches('[data-collab-role]')) {
      selectedRole = t.value as Exclude<ClassroomRole, 'owner'>;
      return;
    }
    if (t.matches('[data-change-role]')) {
      const email = t.dataset.changeRole!;
      const newRole = t.value as Exclude<ClassroomRole, 'owner'>;
      t.disabled = true;
      try {
        collabs = await updateCollaboratorRole(room, email, newRole);
        notifyParent();
        toast(`เปลี่ยนสิทธิ์ของ ${email} เป็น ${ROLE_BADGE_LABEL[newRole]} แล้ว`, 'success');
        render();
      } catch (err) {
        toast(errorMessage(err), 'error');
        render();
      }
    }
  });

  root.addEventListener('submit', async (e) => {
    const form = (e.target as HTMLElement).closest<HTMLFormElement>('[data-invite-form]');
    if (!form) return;
    e.preventDefault();
    const btn = form.querySelector<HTMLButtonElement>('[data-invite-btn]');
    if (!btn || btn.disabled) return;
    const email = emailDraft.trim().toLowerCase();
    if (!email) {
      toast('กรุณากรอกอีเมลของผู้ร่วมสอน', 'warn');
      form.querySelector<HTMLInputElement>('[data-collab-email]')?.focus();
      return;
    }
    await withBusy(btn, 'กำลังเชิญ...', async () => {
      try {
        collabs = await addCollaborator(room, email, selectedRole);
        emailDraft = '';
        notifyParent();
        toast(`เพิ่ม ${email} (${ROLE_BADGE_LABEL[selectedRole]}) เรียบร้อยแล้ว`, 'success');
        render();
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    });
  });

  root.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    const loginBtn = t.closest<HTMLButtonElement>('[data-login-now]');
    if (loginBtn) {
      await withBusy(loginBtn, 'กำลังเข้าสู่ระบบ...', async () => {
        try {
          await signIn();
          if (room.syncMode === 'google' && room.sheet?.spreadsheetId) {
            loading = true;
            render();
            collabs = await fetchRoomCollaborators(room);
            loading = false;
            notifyParent();
          }
          render();
        } catch (err) {
          toast(errorMessage(err), 'error');
        }
      });
      return;
    }

    const upBtn = t.closest<HTMLButtonElement>('[data-upgrade-now]');
    if (upBtn) {
      await withBusy(upBtn, 'กำลังสร้าง Sheet...', async () => {
        try {
          const updated = await upgradeToStandardSheet(room.id);
          Object.assign(room, updated);
          notifyParent();
          toast('สร้าง Google Sheet และเชื่อมต่อเรียบร้อย สามารถเชิญผู้ร่วมสอนได้ทันที', 'success');
          render();
        } catch (err) {
          toast(errorMessage(err), 'error');
        }
      });
      return;
    }

    const rmBtn = t.closest<HTMLButtonElement>('[data-remove-collab]');
    if (rmBtn) {
      const email = rmBtn.dataset.removeCollab!;
      const ok = await confirmDialog(`ต้องการลบ "${email}" ออกจากผู้ร่วมสอนของห้องนี้หรือไม่?`, {
        title: 'ลบผู้ร่วมสอน',
        confirmText: 'ลบออก',
        danger: true,
      });
      if (!ok) return;
      await withBusy(rmBtn, 'กำลังลบ...', async () => {
        try {
          collabs = await removeCollaborator(room, email);
          notifyParent();
          toast(`ลบ ${email} ออกจากห้องเรียนแล้ว`, 'info');
          render();
        } catch (err) {
          toast(errorMessage(err), 'error');
        }
      });
    }
  });

  render();

  if (room.syncMode === 'google' && room.sheet?.spreadsheetId && getAuthState().signedIn) {
    loading = true;
    render();
    fetchRoomCollaborators(room)
      .then((fresh) => {
        collabs = fresh;
        loading = false;
        notifyParent();
        render();
      })
      .catch(() => {
        loading = false;
        render();
      });
  }
}
