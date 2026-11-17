/**
 * EduPlan AI — Batch Course Structure (.docx) Workspace, Gatekeeper, Inspector & A4 Preview
 * ============================================================
 * - ด่านตรวจสอบ BYOK (Strict BYOK Gatekeeper Modal)
 * - หน้าอัปโหลดไฟล์ Word โครงสร้างรายวิชา (.docx)
 * - หน้าสรุปผลการวิเคราะห์ (Course & Header Defaults + Batch Toolbar + Plan Cards)
 * - หน้าต่างดู/แก้ไขรายละเอียดแผน 9 หมวดครบทุกช่อง (Plan Inspector Modal)
 * - หน้าต่างพรีวิวกระดาษ A4 มาตรฐาน 11 หัวข้อ พร้อมแก้ไขสดและคัดลอกแยกหัวข้อ/ทั้งแผน
 * ============================================================
 */

import { isByokEnabled, getStoredApiKey } from './gemini';
import { formatActivitiesToHtml } from './templates';
import {
  buildFullPlanHtml,
  buildFullPlanPlainText,
  copyRichText,
  getHeaderDisplayValues,
  getSectionCopyContent,
} from './exporter';
import type { EvaluationRow, LessonPlanData } from './types';
import {
  parseCourseStructureDocx,
  splitKpaObjectives,
  type CourseStructureBatchJob,
  type ExtractedPlanItem,
} from './structureParser';
import {
  configureBatchQueueCallbacks,
  getActiveBatchJob,
  setActiveBatchJob,
  loadLatestBatchJobFromDb,
  saveBatchJobToDb,
  clearBatchJobFromDb,
  onBatchQueueUpdate,
  startBatchGeneration,
  stopBatchGeneration,
  isBatchQueueRunning,
} from './batchQueue';
import {
  exportBatchPlansAsZip,
  exportSingleBatchPlanDocx,
  syncPlanHeaderWithJob,
} from './batchExporter';

export interface BatchStructureCallbacks {
  switchMainView: (view: 'home' | 'lesson-plan' | 'rubric' | 'longterm' | 'batch-structure') => void;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

function escapeHtml(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

class BatchStructureController {
  private callbacks: BatchStructureCallbacks | null = null;
  private isParsing = false;
  private parsingStatusText = 'กำลังอ่านไฟล์โครงสร้างรายวิชา (.docx)...';
  private activeInspectorPlanId: string | null = null;
  private activeA4PreviewPlanId: string | null = null;

  public async init(callbacks: BatchStructureCallbacks): Promise<void> {
    this.callbacks = callbacks;

    configureBatchQueueCallbacks({
      onOpenWorkspace: () => {
        this.callbacks?.switchMainView('batch-structure');
      },
      showToast: (msg, type) => {
        this.callbacks?.showToast(msg, type);
      },
    });

    onBatchQueueUpdate((job) => {
      this.updateDynamicPlanListUI(job);
    });

    // กู้คืนงาน Batch ล่าสุดจาก IndexedDB อัตโนมัติ (ถ้ามี)
    const savedJob = await loadLatestBatchJobFromDb();
    if (savedJob && savedJob.plans?.length) {
      // หากมีแผนที่ค้างสถานะ generating/queued จากการปิดแท็บครั้งก่อน หรือ KPA ยังรวมอยู่ช่องเดียว ให้ปรับให้ถูกต้องทันที
      let normalized = false;
      for (const p of savedJob.plans) {
        if (p.status === 'generating' || p.status === 'queued') {
          p.status = 'idle';
          normalized = true;
        }
        if ((!p.p_objective || p.p_objective === '-') && (!p.a_objective || p.a_objective === '-') && p.k_objective && p.k_objective !== '-') {
          const split = splitKpaObjectives(p.k_objective);
          if (split.p || split.a) {
            p.k_objective = split.k || '-';
            p.p_objective = split.p || '-';
            p.a_objective = split.a || '-';
            normalized = true;
          }
        }
      }
      if (normalized) {
        await saveBatchJobToDb(savedJob);
      }
      setActiveBatchJob(savedJob);
    }

    this.ensureModalsMounted();
    this.renderWorkspace();
  }

  /**
   * ตรวจสอบสิทธิ์ BYOK ก่อนเข้าใช้งาน (Strict BYOK Gatekeeper)
   */
  public checkByokAndEnter(): void {
    const hasByok = isByokEnabled() && Boolean(getStoredApiKey());
    if (!hasByok) {
      this.openByokGatekeeperModal();
      return;
    }
    this.callbacks?.switchMainView('batch-structure');
    this.renderWorkspace();
  }

  public openByokGatekeeperModal(): void {
    this.ensureModalsMounted();
    const modal = document.getElementById('bs-byok-gatekeeper-modal');
    if (modal) {
      modal.style.display = 'flex';
      modal.classList.remove('hidden');
    }
  }

  public closeByokGatekeeperModal(): void {
    const modal = document.getElementById('bs-byok-gatekeeper-modal');
    if (modal) {
      modal.style.display = 'none';
      modal.classList.add('hidden');
    }
  }

  private openSettingsAndFocusApiKey(): void {
    this.closeByokGatekeeperModal();
    const openSettingsBtn = document.getElementById('btn-open-settings');
    openSettingsBtn?.click();

    setTimeout(() => {
      const byokToggle = document.getElementById('byok-toggle') as HTMLInputElement | null;
      if (byokToggle && !byokToggle.checked) {
        byokToggle.checked = true;
        byokToggle.dispatchEvent(new Event('change'));
      }
      const keyInput = document.getElementById('byok-key-input') as HTMLInputElement | null;
      if (keyInput) {
        keyInput.focus();
        keyInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 120);
  }

  /**
   * สร้าง Modal ทั้ง 3 ตัว (BYOK Gatekeeper, Plan Inspector, A4 Preview) เตรียมไว้ใน body
   */
  private ensureModalsMounted(): void {
    if (!document.getElementById('bs-byok-gatekeeper-modal')) {
      const gateModal = document.createElement('div');
      gateModal.id = 'bs-byok-gatekeeper-modal';
      gateModal.className = 'modal-overlay hidden';
      gateModal.style.display = 'none';
      gateModal.innerHTML = `
        <div class="modal-content max-w-lg w-full mx-4 p-6 sm:p-7 rounded-2xl bg-white border border-slate-200 shadow-2xl">
          <div class="flex items-start gap-3.5 mb-4">
            <div class="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 border border-amber-200 flex items-center justify-center shrink-0">
              <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
            </div>
            <div class="flex-1">
              <h3 class="text-lg font-extrabold text-slate-900 leading-snug">
                ต้องเปิดใช้งาน Gemini API Key ส่วนตัว (BYOK)
              </h3>
              <span class="inline-flex items-center gap-1 text-[11px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full mt-1">
                BYOK • โหมดด่วนเท่านั้น
              </span>
            </div>
          </div>
          <p class="text-xs sm:text-sm text-slate-600 leading-relaxed mb-6 bg-slate-50 border border-slate-200/80 rounded-xl p-4">
            ฟีเจอร์วิเคราะห์โครงสร้างรายวิชาและสร้างแผนการสอนแบบชุด รองรับเฉพาะการเชื่อมต่อผ่าน <strong>Gemini API Key ส่วนตัว (BYOK)</strong> และใช้โมเดล<strong>โหมดด่วน</strong>เท่านั้น เพื่อความรวดเร็วในการสร้างหลายแผนต่อเนื่องและไม่กระทบโควต้าส่วนกลางของระบบ
          </p>
          <div class="flex flex-col sm:flex-row items-center justify-end gap-2.5">
            <button type="button" id="bs-gate-close-btn" class="w-full sm:w-auto btn-secondary text-xs sm:text-sm py-2.5 px-4 rounded-xl font-bold cursor-pointer">
              ปิดหน้าต่าง
            </button>
            <button type="button" id="bs-gate-open-settings-btn" class="w-full sm:w-auto btn-primary text-xs sm:text-sm py-2.5 px-5 rounded-xl font-bold flex items-center justify-center gap-2 cursor-pointer shadow-sm">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>ตั้งค่าระบบ & ใส่ Gemini API Key</span>
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(gateModal);

      gateModal.querySelector('#bs-gate-close-btn')?.addEventListener('click', () => this.closeByokGatekeeperModal());
      gateModal.querySelector('#bs-gate-open-settings-btn')?.addEventListener('click', () => this.openSettingsAndFocusApiKey());
      gateModal.addEventListener('click', e => {
        if (e.target === gateModal) this.closeByokGatekeeperModal();
      });
    }

    if (!document.getElementById('bs-inspector-modal')) {
      const inspModal = document.createElement('div');
      inspModal.id = 'bs-inspector-modal';
      inspModal.className = 'modal-overlay hidden';
      inspModal.style.display = 'none';
      document.body.appendChild(inspModal);

      inspModal.addEventListener('click', e => {
        if (e.target === inspModal) this.closeInspectorModal();
      });
    }

    if (!document.getElementById('bs-a4-preview-modal')) {
      const a4Modal = document.createElement('div');
      a4Modal.id = 'bs-a4-preview-modal';
      a4Modal.className = 'modal-overlay hidden';
      a4Modal.style.display = 'none';
      document.body.appendChild(a4Modal);

      a4Modal.addEventListener('click', e => {
        if (e.target === a4Modal) this.closeA4PreviewModal();
      });
    }
  }

  /**
   * เรนเดอร์หน้า Workspace หลัก (#batch-structure-section)
   */
  public renderWorkspace(): void {
    const container = document.getElementById('batch-structure-section');
    if (!container) return;

    const job = getActiveBatchJob();

    if (this.isParsing) {
      container.innerHTML = `
        <div class="max-w-3xl mx-auto py-12 text-center animate-fade-in">
          <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-10 space-y-4">
            <div class="w-16 h-16 rounded-2xl bg-blue-50 text-blue-600 border border-blue-100 mx-auto flex items-center justify-center">
              <svg class="w-8 h-8 animate-spin text-blue-600" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
            </div>
            <h2 class="text-xl font-bold text-slate-900">${escapeHtml(this.parsingStatusText)}</h2>
            <p class="text-xs sm:text-sm text-slate-500">ระบบกำลังสกัดหน่วยการเรียนรู้ ตัวชี้วัด จุดประสงค์ K-P-A และยุบรวมแผนที่ต่อเนื่องกัน...</p>
          </div>
        </div>
      `;
      return;
    }

    if (!job) {
      container.innerHTML = this.buildUploadViewHtml();
      this.bindUploadViewEvents(container);
      return;
    }

    container.innerHTML = this.buildSummaryAndInspectorHtml(job);
    this.bindSummaryViewEvents(container, job);
  }

  private buildUploadViewHtml(): string {
    return `
      <div class="max-w-4xl mx-auto space-y-6 animate-fade-in">
        <!-- Top Navigation Bar inside Workspace -->
        <div class="flex flex-wrap items-center justify-between gap-3 bg-white rounded-2xl border border-slate-200 px-5 py-3.5 shadow-xs">
          <button type="button" data-bs-action="back-home" class="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs sm:text-sm font-bold text-slate-700 hover:text-blue-600 transition-colors cursor-pointer">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            <span>กลับหน้าหลัก</span>
          </button>
          <div class="flex items-center gap-2">
            <span class="inline-flex items-center gap-1.5 text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 px-3 py-1 rounded-full">
              <svg class="w-3.5 h-3.5 text-blue-600" fill="currentColor" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M14.615 1.595a.75.75 0 01.359.852L12.982 9.75h7.268a.75.75 0 01.548 1.262l-10.5 11.25a.75.75 0 01-1.272-.71l1.992-7.302H3.75a.75.75 0 01-.548-1.262l10.5-11.25a.75.75 0 01.913-.143z" clip-rule="evenodd" /></svg>
              <span>BYOK • โหมดด่วน (Fast Mode Only)</span>
            </span>
          </div>
        </div>

        <!-- Hero Header -->
        <div class="text-center max-w-2xl mx-auto pt-2">
          <h1 class="text-2xl sm:text-3xl font-extrabold text-slate-900 mb-2">
            สร้างแผนการจัดการเรียนรู้จากโครงสร้างรายวิชา (.docx)
          </h1>
          <p class="text-xs sm:text-sm text-slate-600 leading-relaxed">
            อัปโหลดไฟล์ Word (.docx) โครงสร้างรายวิชาหรือโครงการจัดการเรียนรู้ ระบบจะตรวจจับจำนวนแผนทั้งหมด ยุบรวมแผน (ต่อ) อัตโนมัติ พร้อมให้ตรวจสอบแก้ไขรายละเอียดก่อนสั่งเจนครบชุด
          </p>
        </div>

        <!-- Upload Dropzone Card -->
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-10">
          <div id="bs-dropzone" class="border-2 border-dashed border-blue-300 hover:border-blue-600 rounded-2xl p-8 sm:p-12 text-center bg-blue-50/30 hover:bg-blue-50/60 transition-all cursor-pointer">
            <input type="file" id="bs-file-input" accept=".docx" class="hidden" />
            <div class="w-16 h-16 rounded-2xl bg-blue-100 text-blue-600 mx-auto flex items-center justify-center mb-4 shadow-xs">
              <svg class="w-8 h-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12l-3-3m0 0l-3 3m3-3v8.25m-6.75-2.25H6.75a2.25 2.25 0 01-2.25-2.25V6.75a2.25 2.25 0 012.25-2.25h6.75a2.25 2.25 0 012.25 2.25v2.25" />
              </svg>
            </div>
            <p class="text-base sm:text-lg font-bold text-slate-900 mb-1">
              ลากไฟล์โครงสร้างรายวิชา (.docx) มาวางที่นี่ หรือ <span class="text-blue-600 underline">คลิกเพื่อเลือกไฟล์</span>
            </p>
            <p class="text-xs text-slate-500 mb-6">
              รองรับทั้งไฟล์โครงการจัดการเรียนรู้จากเว็บ EduPlan AI (วิเคราะห์ทันที 0 Token) และไฟล์โครงสร้างรายวิชาจากโรงเรียนทั่วไป
            </p>
            <span class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-bold shadow-sm transition-colors">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              <span>เลือกไฟล์ Word (.docx)</span>
            </span>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6 pt-6 border-t border-slate-100 text-xs text-slate-600">
            <div class="flex items-start gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200/70">
              <span class="w-6 h-6 rounded-lg bg-emerald-100 text-emerald-700 font-bold flex items-center justify-center shrink-0">1</span>
              <div>
                <p class="font-bold text-slate-900">ยุบรวมแผน (ต่อ) อัตโนมัติ</p>
                <p class="text-slate-500 mt-0.5">นับจำนวนแผนจริงและรวมชั่วโมง/จุดประสงค์ของแผนที่สอนต่อเนื่องหลายสัปดาห์</p>
              </div>
            </div>
            <div class="flex items-start gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200/70">
              <span class="w-6 h-6 rounded-lg bg-blue-100 text-blue-700 font-bold flex items-center justify-center shrink-0">2</span>
              <div>
                <p class="font-bold text-slate-900">ตรวจสอบ & แก้ไขก่อนเจน</p>
                <p class="text-slate-500 mt-0.5">เปิดดู K-P-A สื่อ วิธีสอน การวัดผลรายแผน และเลือกเฉพาะแผนที่ต้องการสร้างได้</p>
              </div>
            </div>
            <div class="flex items-start gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200/70">
              <span class="w-6 h-6 rounded-lg bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center shrink-0">3</span>
              <div>
                <p class="font-bold text-slate-900">ทำเบื้องหลัง & โหลด .zip</p>
                <p class="text-slate-500 mt-0.5">ย่อหน้าต่างไปทำงานอื่นได้ขณะสร้าง และดาวน์โหลดครบชุดเป็นไฟล์ .zip เดียว</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private buildSummaryAndInspectorHtml(job: CourseStructureBatchJob): string {
    const totalCount = job.plans.length;
    const selectedCount = job.plans.filter(p => p.selected).length;
    const completedCount = job.plans.filter(p => p.status === 'completed' && p.generatedPlan).length;
    const isRunning = isBatchQueueRunning();

    const sourceBadgeHtml =
      job.parseSource === 'template-match'
        ? `<span class="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full">
            <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
            <span>ตรวจพบโครงสร้างมาตรฐานของเว็บ (วิเคราะห์ทันที 0 Token)</span>
          </span>`
        : `<span class="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-800 bg-indigo-50 border border-indigo-200 px-3 py-1 rounded-full">
            <svg class="w-3.5 h-3.5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" /></svg>
            <span>วิเคราะห์โครงสร้างจากไฟล์ภายนอกด้วย AI (โหมดด่วน)</span>
          </span>`;

    return `
      <div class="max-w-5xl mx-auto space-y-6 animate-fade-in">
        <!-- Top Workspace Bar -->
        <div class="flex flex-wrap items-center justify-between gap-3 bg-white rounded-2xl border border-slate-200 px-5 py-3.5 shadow-xs">
          <div class="flex items-center gap-2.5">
            <button type="button" data-bs-action="back-home" class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs sm:text-sm font-bold text-slate-700 hover:text-blue-600 transition-colors cursor-pointer">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              <span>กลับหน้าหลัก</span>
            </button>
            <button type="button" data-bs-action="minimize-to-home" class="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-blue-200 bg-blue-50 hover:bg-blue-100 text-xs font-bold text-blue-700 transition-colors cursor-pointer" title="ย่อหน้าต่างไปทำงานหน้าอื่นโดยคิวยังรันต่อเบื้องหลัง">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
              <span>ย่อหน้าต่าง / ทำงานอื่นรอ</span>
            </button>
          </div>

          <div class="flex items-center gap-2">
            <span class="text-xs text-slate-500 hidden sm:inline truncate max-w-[220px]" title="${escapeHtml(job.fileName)}">
              ไฟล์: <strong>${escapeHtml(job.fileName)}</strong>
            </span>
            <button type="button" data-bs-action="reset-upload" class="px-3 py-1.5 rounded-xl border border-slate-200 hover:border-red-200 hover:bg-red-50 text-xs font-bold text-slate-600 hover:text-red-600 transition-colors cursor-pointer">
              อัปโหลดไฟล์อื่น
            </button>
          </div>
        </div>

        <!-- 4.1 Course & Header Defaults Card -->
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-7 space-y-5">
          <div class="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
            <div class="space-y-1">
              <div class="flex flex-wrap items-center gap-2">
                ${sourceBadgeHtml}
              </div>
              <h2 class="text-xl sm:text-2xl font-extrabold text-slate-900 pt-1">
                พบทั้งหมด <span class="text-blue-600">${totalCount}</span> แผนการจัดการเรียนรู้
              </h2>
            </div>
            <div class="text-right">
              <span id="bs-summary-counter-badge" class="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-slate-100 text-slate-800 text-xs sm:text-sm font-bold">
                เลือกไว้ ${selectedCount} / ${totalCount} แผน • เสร็จแล้ว ${completedCount} แผน
              </span>
            </div>
          </div>

          <div>
            <h3 class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
              ข้อมูลรายวิชาและค่าเริ่มต้นส่วนหัวแผน (นำไปใส่ทุกแผนอัตโนมัติ)
            </h3>
            <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3.5">
              <div>
                <label class="block text-xs font-bold text-slate-700 mb-1">รหัสวิชา</label>
                <input type="text" data-bs-meta="courseCode" value="${escapeHtml(job.courseCode)}" class="form-input-clean text-xs sm:text-sm w-full py-2 px-3 rounded-xl border border-slate-200" placeholder="เช่น ว22101" />
              </div>
              <div class="sm:col-span-2">
                <label class="block text-xs font-bold text-slate-700 mb-1">ชื่อรายวิชา</label>
                <input type="text" data-bs-meta="courseName" value="${escapeHtml(job.courseName)}" class="form-input-clean text-xs sm:text-sm w-full py-2 px-3 rounded-xl border border-slate-200" placeholder="เช่น วิทยาการคำนวณ 2" />
              </div>
              <div>
                <label class="block text-xs font-bold text-slate-700 mb-1">ระดับชั้น</label>
                <input type="text" data-bs-meta="grade" value="${escapeHtml(job.grade)}" class="form-input-clean text-xs sm:text-sm w-full py-2 px-3 rounded-xl border border-slate-200" placeholder="เช่น ม.2" />
              </div>

              <div class="sm:col-span-2">
                <label class="block text-xs font-bold text-slate-700 mb-1">กลุ่มสาระการเรียนรู้</label>
                <input type="text" data-bs-meta="subjectGroup" value="${escapeHtml(job.subjectGroup)}" class="form-input-clean text-xs sm:text-sm w-full py-2 px-3 rounded-xl border border-slate-200" placeholder="เช่น วิทยาศาสตร์และเทคโนโลยี" />
              </div>
              <div>
                <label class="block text-xs font-bold text-slate-700 mb-1">ภาคเรียนที่</label>
                <input type="text" data-bs-meta="semester" value="${escapeHtml(job.semester)}" class="form-input-clean text-xs sm:text-sm w-full py-2 px-3 rounded-xl border border-slate-200" placeholder="1" />
              </div>
              <div>
                <label class="block text-xs font-bold text-slate-700 mb-1">ปีการศึกษา</label>
                <input type="text" data-bs-meta="academicYear" value="${escapeHtml(job.academicYear)}" class="form-input-clean text-xs sm:text-sm w-full py-2 px-3 rounded-xl border border-slate-200" placeholder="2569" />
              </div>

              <div>
                <label class="block text-xs font-bold text-slate-700 mb-1">ชื่อโรงเรียน</label>
                <input type="text" data-bs-meta="schoolName" value="${escapeHtml(job.schoolName)}" class="form-input-clean text-xs sm:text-sm w-full py-2 px-3 rounded-xl border border-slate-200" placeholder="……………………………………………" />
              </div>
              <div>
                <label class="block text-xs font-bold text-slate-700 mb-1">ชื่อผู้สอน</label>
                <input type="text" data-bs-meta="teacherName" value="${escapeHtml(job.teacherName)}" class="form-input-clean text-xs sm:text-sm w-full py-2 px-3 rounded-xl border border-slate-200" placeholder="ชื่อ-นามสกุลครูผู้สอน" />
              </div>
              <div>
                <label class="block text-xs font-bold text-slate-700 mb-1">ตำแหน่ง</label>
                <input type="text" data-bs-meta="teacherPosition" value="${escapeHtml(job.teacherPosition)}" class="form-input-clean text-xs sm:text-sm w-full py-2 px-3 rounded-xl border border-slate-200" placeholder="ครู" />
              </div>
              <div>
                <label class="block text-xs font-bold text-slate-700 mb-1">วันที่สอน</label>
                <input type="text" data-bs-meta="teachingDate" value="${escapeHtml(job.teachingDate)}" class="form-input-clean text-xs sm:text-sm w-full py-2 px-3 rounded-xl border border-slate-200" placeholder="………………………………" />
              </div>
            </div>
          </div>
        </div>

        <!-- 4.2 Batch Action Toolbar -->
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3 sticky top-16 z-20">
          <div class="flex flex-wrap items-center gap-2">
            <button type="button" data-bs-action="select-all" class="px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 transition-colors cursor-pointer flex items-center gap-1.5">
              <svg class="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <span>เลือกทั้งหมด</span>
            </button>
            <button type="button" data-bs-action="deselect-all" class="px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 transition-colors cursor-pointer flex items-center gap-1.5">
              <svg class="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9" /></svg>
              <span>ไม่เลือกทั้งหมด</span>
            </button>
            <button type="button" data-bs-action="skip-orientation-exam" class="px-3 py-2 rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100 text-xs font-bold text-amber-800 transition-colors cursor-pointer flex items-center gap-1.5" title="ติ๊กเอาแผนปฐมนิเทศ แผนสอบ หรือแผนที่ไม่มีตัวชี้วัดออกอัตโนมัติ">
              <svg class="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" /></svg>
              <span>ข้ามแผนปฐมนิเทศ / สอบ</span>
            </button>
          </div>

          <div class="flex flex-wrap items-center gap-2.5">
            ${
              isRunning
                ? `<button type="button" data-bs-action="stop-queue" id="bs-btn-generate-batch" class="px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs sm:text-sm font-bold shadow-sm transition-all cursor-pointer flex items-center gap-2">
                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><rect x="5" y="5" width="10" height="10" rx="1.5"/></svg>
                    <span>หยุดคิวการสร้างชั่วคราว</span>
                  </button>`
                : `<button type="button" data-bs-action="generate-selected" id="bs-btn-generate-batch" class="px-4 sm:px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-xs sm:text-sm font-bold shadow-sm hover:shadow-md transition-all cursor-pointer flex items-center gap-2">
                    <svg class="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M14.615 1.595a.75.75 0 01.359.852L12.982 9.75h7.268a.75.75 0 01.548 1.262l-10.5 11.25a.75.75 0 01-1.272-.71l1.992-7.302H3.75a.75.75 0 01-.548-1.262l10.5-11.25a.75.75 0 01.913-.143z" clip-rule="evenodd" /></svg>
                    <span id="bs-btn-generate-label">สั่งเจนแผนที่เลือกทั้งหมด (${selectedCount} แผน) • โหมดด่วน</span>
                  </button>`
            }

            <button type="button" data-bs-action="download-zip" id="bs-btn-download-zip" ${completedCount > 0 ? '' : 'disabled'} class="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs sm:text-sm font-bold shadow-sm transition-all cursor-pointer disabled:cursor-not-allowed flex items-center gap-2">
              <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
              </svg>
              <span id="bs-btn-zip-label">ดาวน์โหลดทั้งหมดเป็นไฟล์ .zip (${completedCount})</span>
            </button>
          </div>
        </div>

        <!-- 4.3 Plan List Cards -->
        <div id="bs-plan-cards-container" class="space-y-3">
          ${job.plans.map(p => this.buildPlanCardHtml(p)).join('')}
        </div>
      </div>
    `;
  }

  private buildStatusBadgeHtml(plan: ExtractedPlanItem): string {
    switch (plan.status) {
      case 'completed':
        return `<span class="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
          <svg class="w-3.5 h-3.5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
          <span>สร้างเสร็จแล้ว</span>
        </span>`;
      case 'generating':
        return `<span class="inline-flex items-center gap-1.5 text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-full">
          <svg class="w-3.5 h-3.5 animate-spin text-blue-600" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
          <span>กำลังสร้าง...</span>
        </span>`;
      case 'queued':
        return `<span class="inline-flex items-center gap-1 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full">
          <svg class="w-3.5 h-3.5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <span>อยู่ในคิว</span>
        </span>`;
      case 'error':
        return `<span class="inline-flex items-center gap-1 text-xs font-bold text-red-700 bg-red-50 border border-red-200 px-2.5 py-1 rounded-full" title="${escapeHtml(plan.errorMessage || '')}">
          <svg class="w-3.5 h-3.5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
          <span>ผิดพลาด</span>
        </span>`;
      default:
        return `<span class="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-full">
          <span>รอสร้าง</span>
        </span>`;
    }
  }

  private buildPlanCardHtml(plan: ExtractedPlanItem): string {
    const indShort =
      plan.indicators && plan.indicators !== '-'
        ? plan.indicators
            .split(/\r?\n/)
            .map(l => l.split(':')[0].trim())
            .join(', ')
        : 'ไม่มีตัวชี้วัด';

    const cardBorder =
      plan.status === 'completed'
        ? 'border-emerald-300 bg-emerald-50/15'
        : plan.status === 'generating'
          ? 'border-blue-400 bg-blue-50/20 shadow-sm'
          : plan.status === 'error'
            ? 'border-red-300 bg-red-50/10'
            : 'border-slate-200 bg-white';

    return `
      <div data-bs-plan-card="${plan.id}" class="rounded-2xl border ${cardBorder} p-4 sm:p-5 transition-all hover:shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div class="flex items-start gap-3.5 min-w-0 flex-1">
          <input
            type="checkbox"
            data-bs-check="${plan.id}"
            ${plan.selected ? 'checked' : ''}
            class="w-5 h-5 mt-1 rounded text-blue-600 focus:ring-blue-500 cursor-pointer shrink-0"
            title="เลือกแผนที่ ${plan.planNumber}"
          />
          <div class="min-w-0 flex-1 space-y-1.5">
            <div class="flex flex-wrap items-center gap-2">
              <span class="px-2.5 py-0.5 rounded-lg bg-blue-600 text-white text-xs font-extrabold">
                แผนที่ ${plan.planNumber}
              </span>
              <span class="text-xs font-semibold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-lg">
                ${escapeHtml(plan.weekLabel)} • ${plan.hours} ชั่วโมง
              </span>
              <span class="text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200/70 px-2.5 py-0.5 rounded-lg truncate max-w-[260px]" title="${escapeHtml(plan.indicators)}">
                ตัวชี้วัด: ${escapeHtml(indShort)}
              </span>
              ${this.buildStatusBadgeHtml(plan)}
            </div>

            <h3 class="text-sm sm:text-base font-bold text-slate-900 leading-snug">
              ${escapeHtml(plan.topic)}
            </h3>
            <p class="text-xs text-slate-500 truncate">
              ${escapeHtml(plan.unit)} • วิธีสอน: ${escapeHtml(plan.teaching_method || 'Active Learning')}
            </p>
            ${
              plan.status === 'error' && plan.errorMessage
                ? `<p class="text-xs text-red-600 font-medium mt-1">สาเหตุ: ${escapeHtml(plan.errorMessage)}</p>`
                : ''
            }
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2 shrink-0 pl-8 md:pl-0">
          <button type="button" data-bs-inspect="${plan.id}" class="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 transition-colors cursor-pointer flex items-center gap-1.5">
            <svg class="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span>ดู / แก้ไขรายละเอียด</span>
          </button>

          ${
            plan.status === 'completed' && plan.generatedPlan
              ? `
                <button type="button" data-bs-preview-a4="${plan.id}" class="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer flex items-center gap-1.5">
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                  <span>พรีวิว A4 / แก้ไข</span>
                </button>
                <button type="button" data-bs-dl-one="${plan.id}" class="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer flex items-center gap-1.5">
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  <span>โหลด .docx</span>
                </button>
              `
              : `
                <button type="button" data-bs-gen-one="${plan.id}" ${plan.status === 'generating' ? 'disabled' : ''} class="px-3.5 py-2 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-xs font-bold transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5">
                  <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M14.615 1.595a.75.75 0 01.359.852L12.982 9.75h7.268a.75.75 0 01.548 1.262l-10.5 11.25a.75.75 0 01-1.272-.71l1.992-7.302H3.75a.75.75 0 01-.548-1.262l10.5-11.25a.75.75 0 01.913-.143z" clip-rule="evenodd" /></svg>
                  <span>เจนแผนนี้</span>
                </button>
              `
          }
        </div>
      </div>
    `;
  }

  /**
   * อัปเดตเฉพาะการ์ดแผนและปุ่มนับจำนวนแบบเรียลไทม์โดยไม่รบกวนช่อง Input ส่วนหัวที่ผู้ใช้กำลังพิมพ์
   */
  private updateDynamicPlanListUI(job: CourseStructureBatchJob): void {
    const container = document.getElementById('batch-structure-section');
    if (!container || container.classList.contains('hidden')) return;

    const listEl = document.getElementById('bs-plan-cards-container');
    if (!listEl) {
      this.renderWorkspace();
      return;
    }

    listEl.innerHTML = job.plans.map(p => this.buildPlanCardHtml(p)).join('');

    const totalCount = job.plans.length;
    const selectedCount = job.plans.filter(p => p.selected).length;
    const completedCount = job.plans.filter(p => p.status === 'completed' && p.generatedPlan).length;

    const summaryBadge = document.getElementById('bs-summary-counter-badge');
    if (summaryBadge) {
      summaryBadge.textContent = `เลือกไว้ ${selectedCount} / ${totalCount} แผน • เสร็จแล้ว ${completedCount} แผน`;
    }

    const zipBtn = document.getElementById('bs-btn-download-zip') as HTMLButtonElement | null;
    const zipLbl = document.getElementById('bs-btn-zip-label');
    if (zipBtn) zipBtn.disabled = completedCount === 0;
    if (zipLbl) zipLbl.textContent = `ดาวน์โหลดทั้งหมดเป็นไฟล์ .zip (${completedCount})`;

    const genBtn = document.getElementById('bs-btn-generate-batch');
    if (genBtn) {
      const running = isBatchQueueRunning();
      if (running && genBtn.getAttribute('data-bs-action') !== 'stop-queue') {
        this.renderWorkspace();
      } else if (!running && genBtn.getAttribute('data-bs-action') === 'stop-queue') {
        this.renderWorkspace();
      } else {
        const genLbl = document.getElementById('bs-btn-generate-label');
        if (genLbl) {
          genLbl.textContent = `สั่งเจนแผนที่เลือกทั้งหมด (${selectedCount} แผน) • โหมดด่วน`;
        }
      }
    }
  }

  private bindUploadViewEvents(container: HTMLElement): void {
    container.querySelector('[data-bs-action="back-home"]')?.addEventListener('click', () => {
      this.callbacks?.switchMainView('home');
    });

    const dropzone = container.querySelector<HTMLElement>('#bs-dropzone');
    const fileInput = container.querySelector<HTMLInputElement>('#bs-file-input');

    dropzone?.addEventListener('click', () => fileInput?.click());
    dropzone?.addEventListener('dragover', e => {
      e.preventDefault();
      dropzone.classList.add('border-blue-600', 'bg-blue-50');
    });
    dropzone?.addEventListener('dragleave', () => {
      dropzone.classList.remove('border-blue-600', 'bg-blue-50');
    });
    dropzone?.addEventListener('drop', e => {
      e.preventDefault();
      dropzone.classList.remove('border-blue-600', 'bg-blue-50');
      const file = e.dataTransfer?.files?.[0];
      if (file) void this.handleFileSelected(file);
    });

    fileInput?.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) void this.handleFileSelected(file);
    });
  }

  private async handleFileSelected(file: File): Promise<void> {
    if (!file.name.toLowerCase().endsWith('.docx')) {
      this.callbacks?.showToast('รองรับเฉพาะไฟล์เอกสาร Word (.docx) เท่านั้น', 'error');
      return;
    }

    if (!isByokEnabled() || !getStoredApiKey()) {
      this.openByokGatekeeperModal();
      return;
    }

    this.isParsing = true;
    this.parsingStatusText = 'กำลังวิเคราะห์โครงสร้างรายวิชาจากไฟล์ Word (.docx)...';
    this.renderWorkspace();

    try {
      const job = await parseCourseStructureDocx(file, msg => {
        this.parsingStatusText = msg;
        this.renderWorkspace();
      });
      this.isParsing = false;
      setActiveBatchJob(job);
      this.renderWorkspace();
      this.callbacks?.showToast(
        `วิเคราะห์สำเร็จ พบทั้งหมด ${job.plans.length} แผนการจัดการเรียนรู้`,
        'success'
      );
    } catch (err: any) {
      this.isParsing = false;
      this.renderWorkspace();
      this.callbacks?.showToast(
        err?.message || 'ไม่สามารถวิเคราะห์ไฟล์โครงสร้างรายวิชาได้ กรุณาตรวจสอบไฟล์อีกครั้ง',
        'error'
      );
    }
  }

  private bindSummaryViewEvents(container: HTMLElement, job: CourseStructureBatchJob): void {
    // อัปเดตข้อมูลส่วนหัวรายวิชาแบบ Real-time
    container.querySelectorAll<HTMLInputElement>('[data-bs-meta]').forEach(inp => {
      inp.addEventListener('input', () => {
        const key = inp.dataset.bsMeta as keyof CourseStructureBatchJob;
        if (!key) return;
        (job as any)[key] = inp.value;
        void saveBatchJobToDb(job);

        // ซิงก์ค่าโรงเรียน/ชื่อครูกลับไปเก็บใน localStorage ของระบบด้วย
        try {
          const rawDraft = localStorage.getItem('eduplan_ai_draft');
          const draft = rawDraft ? JSON.parse(rawDraft) : {};
          if (key === 'schoolName') draft.school = inp.value;
          if (key === 'teacherName') draft.teacherName = inp.value;
          if (key === 'teacherPosition') draft.teacherPosition = inp.value;
          if (key === 'semester') draft.semester = inp.value;
          if (key === 'academicYear') draft.academicYear = inp.value;
          localStorage.setItem('eduplan_ai_draft', JSON.stringify(draft));
        } catch {
          // ignore
        }
      });
    });

    // Event Delegation สำหรับปุ่มทั้งหมดและรายการการ์ดแผน
    container.onclick = async e => {
      const target = e.target as HTMLElement;

      const checkInput = target.closest<HTMLInputElement>('[data-bs-check]');
      if (checkInput) {
        const planId = checkInput.dataset.bsCheck;
        const plan = job.plans.find(p => p.id === planId);
        if (plan) {
          plan.selected = checkInput.checked;
          await saveBatchJobToDb(job);
          this.updateDynamicPlanListUI(job);
        }
        return;
      }

      const inspectBtn = target.closest<HTMLElement>('[data-bs-inspect]');
      if (inspectBtn) {
        this.openInspectorModal(job, inspectBtn.dataset.bsInspect!);
        return;
      }

      const genOneBtn = target.closest<HTMLElement>('[data-bs-gen-one]');
      if (genOneBtn) {
        if (!isByokEnabled() || !getStoredApiKey()) {
          this.openByokGatekeeperModal();
          return;
        }
        const planId = genOneBtn.dataset.bsGenOne!;
        void startBatchGeneration(job, [planId]);
        return;
      }

      const previewA4Btn = target.closest<HTMLElement>('[data-bs-preview-a4]');
      if (previewA4Btn) {
        this.openA4PreviewModal(job, previewA4Btn.dataset.bsPreviewA4!);
        return;
      }

      const dlOneBtn = target.closest<HTMLElement>('[data-bs-dl-one]');
      if (dlOneBtn) {
        const plan = job.plans.find(p => p.id === dlOneBtn.dataset.bsDlOne);
        if (plan) {
          try {
            await exportSingleBatchPlanDocx(job, plan);
            this.callbacks?.showToast(`ดาวน์โหลดแผนที่ ${plan.planNumber} (.docx) เรียบร้อยแล้ว`, 'success');
          } catch (err: any) {
            this.callbacks?.showToast(err?.message || 'เกิดข้อผิดพลาดในการดาวน์โหลด .docx', 'error');
          }
        }
        return;
      }

      const actionBtn = target.closest<HTMLElement>('[data-bs-action]');
      if (!actionBtn) return;
      const action = actionBtn.dataset.bsAction;

      if (action === 'back-home' || action === 'minimize-to-home') {
        this.callbacks?.switchMainView('home');
        if (action === 'minimize-to-home' && isBatchQueueRunning()) {
          this.callbacks?.showToast('ย่อหน้าต่างแล้ว ระบบกำลังสร้างแผนต่อเบื้องหลัง (ดูสถานะที่มุมขวาล่าง)', 'info');
        }
        return;
      }

      if (action === 'reset-upload') {
        if (isBatchQueueRunning()) {
          stopBatchGeneration();
        }
        await clearBatchJobFromDb(job.jobId);
        setActiveBatchJob(null);
        this.renderWorkspace();
        return;
      }

      if (action === 'select-all') {
        job.plans.forEach(p => {
          p.selected = true;
        });
        await saveBatchJobToDb(job);
        this.updateDynamicPlanListUI(job);
        return;
      }

      if (action === 'deselect-all') {
        job.plans.forEach(p => {
          p.selected = false;
        });
        await saveBatchJobToDb(job);
        this.updateDynamicPlanListUI(job);
        return;
      }

      if (action === 'skip-orientation-exam') {
        let skipped = 0;
        job.plans.forEach(p => {
          const text = `${p.unit} ${p.topic}`.toLowerCase();
          const isExamOrOrientation =
            /ปฐมนิเทศ|สอบกลางภาค|สอบปลายภาค|ทบทวนก่อนสอบ|วัดผลกลางภาค|วัดผลปลายภาค/.test(text) ||
            !p.indicators ||
            p.indicators.trim() === '-';
          if (isExamOrOrientation) {
            p.selected = false;
            skipped++;
          } else {
            p.selected = true;
          }
        });
        await saveBatchJobToDb(job);
        this.updateDynamicPlanListUI(job);
        this.callbacks?.showToast(
          skipped > 0
            ? `ข้ามแผนปฐมนิเทศ/สอบหรือแผนที่ไม่มีตัวชี้วัดแล้ว (${skipped} แผน)`
            : 'ไม่พบแผนปฐมนิเทศหรือแผนสอบในรายการ',
          'info'
        );
        return;
      }

      if (action === 'generate-selected') {
        if (!isByokEnabled() || !getStoredApiKey()) {
          this.openByokGatekeeperModal();
          return;
        }
        const selectedIds = job.plans.filter(p => p.selected && p.status !== 'completed').map(p => p.id);
        if (selectedIds.length === 0) {
          // หากแผนที่เลือกสร้างเสร็จหมดแล้ว ให้เจนใหม่เฉพาะแผนที่ติ๊กเลือก
          const allSelectedIds = job.plans.filter(p => p.selected).map(p => p.id);
          if (allSelectedIds.length === 0) {
            this.callbacks?.showToast('กรุณาติ๊กเลือกอย่างน้อย 1 แผนก่อนสั่งสร้าง', 'error');
            return;
          }
          void startBatchGeneration(job, allSelectedIds);
        } else {
          void startBatchGeneration(job, selectedIds);
        }
        return;
      }

      if (action === 'stop-queue') {
        stopBatchGeneration();
        return;
      }

      if (action === 'download-zip') {
        try {
          const count = await exportBatchPlansAsZip(job);
          this.callbacks?.showToast(`ดาวน์โหลดไฟล์ .zip รวม ${count} แผนเรียบร้อยแล้ว`, 'success');
        } catch (err: any) {
          this.callbacks?.showToast(err?.message || 'ไม่สามารถส่งออกไฟล์ .zip ได้', 'error');
        }
      }
    };
  }

  // ============================================================
  // 4.3 หน้าต่างดู / แก้ไขรายละเอียดแผนก่อนเจน (Plan Inspector Modal — 9 หมวด)
  // ============================================================
  private openInspectorModal(job: CourseStructureBatchJob, planId: string): void {
    const plan = job.plans.find(p => p.id === planId);
    if (!plan) return;
    this.activeInspectorPlanId = plan.id;

    const modal = document.getElementById('bs-inspector-modal');
    if (!modal) return;

    modal.innerHTML = `
      <div class="modal-content max-w-3xl w-full mx-4 max-h-[90vh] flex flex-col rounded-2xl bg-white border border-slate-200 shadow-2xl p-6">
        <div class="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
          <div>
            <span class="text-xs font-extrabold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded-full">
              แผนการจัดการเรียนรู้ที่ ${plan.planNumber} (${escapeHtml(plan.weekLabel)})
            </span>
            <h3 class="text-lg font-extrabold text-slate-900 mt-1">
              ดู / แก้ไขรายละเอียดข้อมูลตั้งต้นของแผน
            </h3>
          </div>
          <button type="button" data-insp-close class="text-slate-400 hover:text-slate-700 p-1.5 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer">
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div class="flex-1 overflow-y-auto pr-1 space-y-4 text-xs sm:text-sm">
          <!-- 1. มาตรฐานการเรียนรู้ และ ตัวชี้วัด -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3.5 bg-slate-50 p-3.5 rounded-xl border border-slate-200/80">
            <div>
              <label class="block text-xs font-bold text-slate-800 mb-1">1. มาตรฐานการเรียนรู้</label>
              <textarea id="insp-standards" rows="3" class="form-textarea-clean w-full p-2.5 rounded-xl border border-slate-200 bg-white text-xs leading-relaxed">${escapeHtml(plan.standards)}</textarea>
            </div>
            <div>
              <label class="block text-xs font-bold text-slate-800 mb-1">ตัวชี้วัด</label>
              <textarea id="insp-indicators" rows="3" class="form-textarea-clean w-full p-2.5 rounded-xl border border-slate-200 bg-white text-xs leading-relaxed">${escapeHtml(plan.indicators)}</textarea>
            </div>
          </div>

          <!-- 2. หน่วยการเรียนรู้, ชื่อเรื่อง, จำนวนชั่วโมง -->
          <div class="grid grid-cols-1 md:grid-cols-6 gap-3">
            <div class="md:col-span-2">
              <label class="block text-xs font-bold text-slate-800 mb-1">2. หน่วยการเรียนรู้</label>
              <input type="text" id="insp-unit" value="${escapeHtml(plan.unit)}" class="form-input-clean w-full py-2 px-3 rounded-xl border border-slate-200 text-xs sm:text-sm" />
            </div>
            <div class="md:col-span-3">
              <label class="block text-xs font-bold text-slate-800 mb-1">ชื่อเรื่อง / ชื่อแผน</label>
              <input type="text" id="insp-topic" value="${escapeHtml(plan.topic)}" class="form-input-clean w-full py-2 px-3 rounded-xl border border-slate-200 text-xs sm:text-sm" />
            </div>
            <div class="md:col-span-1">
              <label class="block text-xs font-bold text-slate-800 mb-1">จำนวนชั่วโมง</label>
              <input type="number" id="insp-hours" min="1" max="40" value="${plan.hours}" class="form-input-clean w-full py-2 px-3 rounded-xl border border-slate-200 text-xs sm:text-sm font-bold text-center" />
            </div>
          </div>

          <!-- 3-5. จุดประสงค์ K, P, A -->
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label class="block text-xs font-bold text-blue-800 mb-1">3. จุดประสงค์ด้านความรู้ (K)</label>
              <textarea id="insp-k" rows="3" class="form-textarea-clean w-full p-2.5 rounded-xl border border-slate-200 text-xs leading-relaxed">${escapeHtml(plan.k_objective)}</textarea>
            </div>
            <div>
              <label class="block text-xs font-bold text-emerald-800 mb-1">4. ด้านทักษะกระบวนการ (P)</label>
              <textarea id="insp-p" rows="3" class="form-textarea-clean w-full p-2.5 rounded-xl border border-slate-200 text-xs leading-relaxed">${escapeHtml(plan.p_objective)}</textarea>
            </div>
            <div>
              <label class="block text-xs font-bold text-purple-800 mb-1">5. ด้านคุณลักษณะอันพึงประสงค์ (A)</label>
              <textarea id="insp-a" rows="3" class="form-textarea-clean w-full p-2.5 rounded-xl border border-slate-200 text-xs leading-relaxed">${escapeHtml(plan.a_objective)}</textarea>
            </div>
          </div>

          <!-- 6-7. หัวข้อ/สาระสำคัญ & วิธีจัดการเรียนรู้ -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-bold text-slate-800 mb-1">6. หัวข้อ / สาระสำคัญ</label>
              <textarea id="insp-concepts" rows="3" class="form-textarea-clean w-full p-2.5 rounded-xl border border-slate-200 text-xs leading-relaxed">${escapeHtml(plan.key_concepts)}</textarea>
            </div>
            <div>
              <label class="block text-xs font-bold text-slate-800 mb-1">7. วิธีจัดการเรียนรู้</label>
              <textarea id="insp-method" rows="3" class="form-textarea-clean w-full p-2.5 rounded-xl border border-slate-200 text-xs leading-relaxed">${escapeHtml(plan.teaching_method)}</textarea>
            </div>
          </div>

          <!-- 8-9. สื่อ/แหล่งเรียนรู้ & วิธีการวัดและประเมินผล -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-bold text-slate-800 mb-1">8. สื่อ / แหล่งเรียนรู้</label>
              <textarea id="insp-media" rows="2" class="form-textarea-clean w-full p-2.5 rounded-xl border border-slate-200 text-xs leading-relaxed">${escapeHtml(plan.media_resources)}</textarea>
            </div>
            <div>
              <label class="block text-xs font-bold text-slate-800 mb-1">9. วิธีการวัดและประเมินผล</label>
              <textarea id="insp-eval" rows="2" class="form-textarea-clean w-full p-2.5 rounded-xl border border-slate-200 text-xs leading-relaxed">${escapeHtml(plan.evaluation_method)}</textarea>
            </div>
          </div>
        </div>

        <div class="pt-4 mt-4 border-t border-slate-100 flex flex-wrap items-center justify-end gap-2.5">
          <button type="button" data-insp-close class="btn-secondary text-xs sm:text-sm py-2 px-4 rounded-xl font-bold cursor-pointer">
            ยกเลิก
          </button>
          <button type="button" id="insp-btn-save" class="px-4 py-2 rounded-xl border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs sm:text-sm font-bold transition-colors cursor-pointer">
            บันทึกการแก้ไข
          </button>
          <button type="button" id="insp-btn-save-and-gen" class="btn-primary text-xs sm:text-sm py-2 px-5 rounded-xl font-bold flex items-center gap-1.5 cursor-pointer shadow-sm">
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M14.615 1.595a.75.75 0 01.359.852L12.982 9.75h7.268a.75.75 0 01.548 1.262l-10.5 11.25a.75.75 0 01-1.272-.71l1.992-7.302H3.75a.75.75 0 01-.548-1.262l10.5-11.25a.75.75 0 01.913-.143z" clip-rule="evenodd" /></svg>
            <span>บันทึก & เจนแผนนี้ทันที</span>
          </button>
        </div>
      </div>
    `;

    const applyChangesToPlan = async () => {
      plan.standards = (modal.querySelector<HTMLTextAreaElement>('#insp-standards')?.value || '').trim() || '-';
      plan.indicators = (modal.querySelector<HTMLTextAreaElement>('#insp-indicators')?.value || '').trim() || '-';
      plan.unit = (modal.querySelector<HTMLInputElement>('#insp-unit')?.value || '').trim() || plan.unit;
      plan.topic = (modal.querySelector<HTMLInputElement>('#insp-topic')?.value || '').trim() || plan.topic;
      plan.hours = Math.max(1, parseInt(modal.querySelector<HTMLInputElement>('#insp-hours')?.value || '1', 10) || 1);
      plan.k_objective = (modal.querySelector<HTMLTextAreaElement>('#insp-k')?.value || '').trim() || '-';
      plan.p_objective = (modal.querySelector<HTMLTextAreaElement>('#insp-p')?.value || '').trim() || '-';
      plan.a_objective = (modal.querySelector<HTMLTextAreaElement>('#insp-a')?.value || '').trim() || '-';
      plan.key_concepts = (modal.querySelector<HTMLTextAreaElement>('#insp-concepts')?.value || '').trim() || '-';
      plan.teaching_method = (modal.querySelector<HTMLTextAreaElement>('#insp-method')?.value || '').trim() || 'Active Learning';
      plan.media_resources = (modal.querySelector<HTMLTextAreaElement>('#insp-media')?.value || '').trim() || '-';
      plan.evaluation_method = (modal.querySelector<HTMLTextAreaElement>('#insp-eval')?.value || '').trim() || '-';

      await saveBatchJobToDb(job);
      this.updateDynamicPlanListUI(job);
    };

    modal.querySelectorAll('[data-insp-close]').forEach(btn => {
      btn.addEventListener('click', () => this.closeInspectorModal());
    });

    modal.querySelector('#insp-btn-save')?.addEventListener('click', async () => {
      await applyChangesToPlan();
      this.closeInspectorModal();
      this.callbacks?.showToast(`บันทึกรายละเอียดแผนที่ ${plan.planNumber} เรียบร้อยแล้ว`, 'success');
    });

    modal.querySelector('#insp-btn-save-and-gen')?.addEventListener('click', async () => {
      if (!isByokEnabled() || !getStoredApiKey()) {
        this.closeInspectorModal();
        this.openByokGatekeeperModal();
        return;
      }
      await applyChangesToPlan();
      this.closeInspectorModal();
      void startBatchGeneration(job, [plan.id]);
    });

    modal.style.display = 'flex';
    modal.classList.remove('hidden');
  }

  private closeInspectorModal(): void {
    this.activeInspectorPlanId = null;
    const modal = document.getElementById('bs-inspector-modal');
    if (modal) {
      modal.style.display = 'none';
      modal.classList.add('hidden');
    }
  }

  // ============================================================
  // พรีวิวกระดาษ A4 มาตรฐาน 11 หัวข้อรายแผน (A4 Preview & Live Editor Modal)
  // ============================================================
  private openA4PreviewModal(job: CourseStructureBatchJob, planId: string): void {
    const plan = job.plans.find(p => p.id === planId);
    if (!plan || !plan.generatedPlan) return;
    this.activeA4PreviewPlanId = plan.id;

    // ซิงก์ส่วนหัวล่าสุดจาก job ก่อนเปิดพรีวิว
    plan.generatedPlan = syncPlanHeaderWithJob(plan, job);
    const data: LessonPlanData = plan.generatedPlan;

    const modal = document.getElementById('bs-a4-preview-modal');
    if (!modal) return;

    const h = getHeaderDisplayValues(data);
    const teacherName = data.teacher_name || job.teacherName || '……………………………………………………';
    const teacherPos = data.teacher_position || job.teacherPosition || 'ครู';
    const signDateStr =
      data.date && data.month && data.buddhist_year
        ? `วันที่ ${escapeHtml(data.date)} / ${escapeHtml(data.month)} / ${escapeHtml(data.buddhist_year)}`
        : 'วันที่ ............ / ............ / ............';

    const copyIconSvg =
      '<svg class="w-3.5 h-3.5 text-slate-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" /></svg>';

    const rows =
      data.evaluation_rows && data.evaluation_rows.length > 0
        ? data.evaluation_rows
        : [
            {
              dimension: 'ด้านความรู้ (K)',
              objective: data.k_objective,
              method: 'ตรวจใบงาน',
              tool: 'แบบประเมินใบงาน',
              criteria: 'ผ่านเกณฑ์ร้อยละ 70 ขึ้นไป',
            },
            {
              dimension: 'ด้านทักษะและกระบวนการ (P)',
              objective: data.p_objective,
              method: 'สังเกตพฤติกรรม',
              tool: 'แบบประเมินทักษะกระบวนการ',
              criteria: 'ผ่านเกณฑ์ระดับคุณภาพ 2 ขึ้นไป',
            },
            {
              dimension: 'ด้านคุณลักษณะอันพึงประสงค์ (A)',
              objective: data.a_objective,
              method: 'สังเกตพฤติกรรม',
              tool: 'แบบสังเกตคุณลักษณะ',
              criteria: 'ผ่านเกณฑ์ระดับคุณภาพ 2 ขึ้นไป',
            },
          ];

    const evalRowsHtml = rows
      .map(
        (r, idx) => `
        <tr data-bs-eval-row="${idx}">
          <td class="bs-eval-cell" contenteditable="true" data-field="objective" style="border: 1px solid #000; padding: 6px 8px; vertical-align: top;">
            <strong>${escapeHtml(r.dimension)}</strong><br/>${escapeHtml(r.objective)}
          </td>
          <td class="bs-eval-cell" contenteditable="true" data-field="method" style="border: 1px solid #000; padding: 6px 8px; vertical-align: top;">
            ${escapeHtml(r.method)}
          </td>
          <td class="bs-eval-cell" contenteditable="true" data-field="tool" style="border: 1px solid #000; padding: 6px 8px; vertical-align: top;">
            ${escapeHtml(r.tool)}
          </td>
          <td class="bs-eval-cell" contenteditable="true" data-field="criteria" style="border: 1px solid #000; padding: 6px 8px; vertical-align: top;">
            ${escapeHtml(r.criteria)}
          </td>
        </tr>
      `
      )
      .join('');

    modal.innerHTML = `
      <div class="modal-content max-w-5xl w-full mx-3 sm:mx-6 max-h-[92vh] flex flex-col rounded-2xl bg-slate-100 border border-slate-300 shadow-2xl p-4 sm:p-6">
        <!-- Toolbar -->
        <div class="bg-white rounded-xl border border-slate-200 p-3.5 mb-4 flex flex-wrap items-center justify-between gap-3 shadow-xs">
          <div>
            <span class="text-xs font-extrabold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded-full">
              แผนที่ ${plan.planNumber} • ${escapeHtml(plan.weekLabel)}
            </span>
            <h3 class="text-sm sm:text-base font-extrabold text-slate-900 mt-1">
              ${escapeHtml(plan.topic)} <span class="text-xs font-normal text-slate-500">(คลิกแก้ไขข้อความบนกระดาษ A4 ได้โดยตรง)</span>
            </h3>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button type="button" id="bs-a4-copy-all" class="btn-secondary text-xs py-2 px-3 rounded-xl font-bold flex items-center gap-1.5 cursor-pointer">
              ${copyIconSvg}
              <span>คัดลอกทั้งแผน (สำหรับ Word)</span>
            </button>
            <button type="button" id="bs-a4-export-docx" class="btn-primary text-xs py-2 px-3.5 rounded-xl font-bold flex items-center gap-1.5 cursor-pointer">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
              <span>โหลด .docx</span>
            </button>
            <button type="button" data-bs-a4-close class="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-xs font-bold text-slate-700 cursor-pointer">
              ปิดหน้าต่าง
            </button>
          </div>
        </div>

        <!-- Scrollable A4 Paper -->
        <div class="flex-1 overflow-y-auto pb-4">
          <div id="bs-a4-sheet-container" class="a4-paper bg-white mx-auto shadow-xl border border-slate-300 p-6 sm:p-10" style="font-family: 'TH SarabunPSK', 'TH Sarabun PSK', sans-serif !important; font-size: 16pt; line-height: 1.5; color: #000000;">
            <div class="plan-header pb-4 mb-4" style="border-bottom: 2px dashed #94a3b8;">
              <h1 class="text-2xl font-bold mb-3 text-center" style="font-size: 20pt; text-align: center; color: #000000;">
                แผนจัดการเรียนรู้
              </h1>
              <table style="width: 100%; border-collapse: collapse; border: none; font-size: 16pt; color: #000000; margin-bottom: 6px;">
                <tbody>
                  <tr>
                    <td style="border: none; padding: 2px 0; text-align: left; font-weight: bold; width: 60%;">${escapeHtml(h.courseText)}</td>
                    <td style="border: none; padding: 2px 0; text-align: right; font-weight: bold; width: 40%;">${escapeHtml(h.gradeText)}</td>
                  </tr>
                  <tr>
                    <td style="border: none; padding: 2px 0; text-align: left; font-weight: bold; width: 60%;">${escapeHtml(h.unitText)}</td>
                    <td style="border: none; padding: 2px 0; text-align: right; width: 40%;">&nbsp;</td>
                  </tr>
                  <tr>
                    <td style="border: none; padding: 2px 0; text-align: left; font-weight: bold; width: 60%;">${escapeHtml(h.planText)}</td>
                    <td style="border: none; padding: 2px 0; text-align: right; font-weight: bold; width: 40%;">${escapeHtml(h.hoursText)}</td>
                  </tr>
                  <tr>
                    <td style="border: none; padding: 2px 0; text-align: left; font-weight: bold; width: 60%;">${escapeHtml(h.subjectText)}</td>
                    <td style="border: none; padding: 2px 0; text-align: right; font-weight: bold; width: 40%;">${escapeHtml(h.semesterText)}</td>
                  </tr>
                  <tr>
                    <td style="border: none; padding: 2px 0; text-align: left; width: 60%;">${escapeHtml(h.dateFullText)}</td>
                    <td style="border: none; padding: 2px 0; text-align: right; width: 40%;">${escapeHtml(h.schoolText)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="space-y-4">
              <!-- 1. มาตรฐานการเรียนรู้ -->
              <div class="section-card bg-white p-3 rounded-lg border border-slate-200">
                <div class="flex items-center justify-between border-b border-slate-200 pb-1 mb-2">
                  <h3 class="font-bold text-slate-900" style="font-size: 16pt;">1. มาตรฐานการเรียนรู้</h3>
                  <button type="button" class="bs-copy-sec-btn text-xs bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 px-2.5 py-1 rounded border border-slate-200 flex items-center gap-1 cursor-pointer" data-sec="1">${copyIconSvg} คัดลอกหัวข้อนี้</button>
                </div>
                <div class="whitespace-pre-wrap pl-3" contenteditable="true" data-bs-field="standards">${escapeHtml(data.standards)}</div>
              </div>

              <!-- 2. ตัวชี้วัด -->
              <div class="section-card bg-white p-3 rounded-lg border border-slate-200">
                <div class="flex items-center justify-between border-b border-slate-200 pb-1 mb-2">
                  <h3 class="font-bold text-slate-900" style="font-size: 16pt;">2. ตัวชี้วัด</h3>
                  <button type="button" class="bs-copy-sec-btn text-xs bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 px-2.5 py-1 rounded border border-slate-200 flex items-center gap-1 cursor-pointer" data-sec="2">${copyIconSvg} คัดลอกหัวข้อนี้</button>
                </div>
                <div class="whitespace-pre-wrap pl-3" contenteditable="true" data-bs-field="indicators">${escapeHtml(data.indicators)}</div>
              </div>

              <!-- 3. สาระสำคัญ -->
              <div class="section-card bg-white p-3 rounded-lg border border-slate-200">
                <div class="flex items-center justify-between border-b border-slate-200 pb-1 mb-2">
                  <h3 class="font-bold text-slate-900" style="font-size: 16pt;">3. สาระสำคัญ</h3>
                  <button type="button" class="bs-copy-sec-btn text-xs bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 px-2.5 py-1 rounded border border-slate-200 flex items-center gap-1 cursor-pointer" data-sec="3">${copyIconSvg} คัดลอกหัวข้อนี้</button>
                </div>
                <div class="whitespace-pre-wrap pl-3" contenteditable="true" data-bs-field="concept">${escapeHtml(data.concept)}</div>
              </div>

              <!-- 4. จุดประสงค์รายวิชา -->
              <div class="section-card bg-white p-3 rounded-lg border border-slate-200">
                <div class="flex items-center justify-between border-b border-slate-200 pb-1 mb-2">
                  <h3 class="font-bold text-slate-900" style="font-size: 16pt;">4. จุดประสงค์รายวิชา</h3>
                  <button type="button" class="bs-copy-sec-btn text-xs bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 px-2.5 py-1 rounded border border-slate-200 flex items-center gap-1 cursor-pointer" data-sec="4">${copyIconSvg} คัดลอกหัวข้อนี้</button>
                </div>
                <div class="pl-3 space-y-2">
                  <div><span class="font-bold">ความรู้ (K):</span><div class="whitespace-pre-wrap pl-2" contenteditable="true" data-bs-field="k_objective">${escapeHtml(data.k_objective)}</div></div>
                  <div><span class="font-bold">ทักษะและกระบวนการ (P):</span><div class="whitespace-pre-wrap pl-2" contenteditable="true" data-bs-field="p_objective">${escapeHtml(data.p_objective)}</div></div>
                  <div><span class="font-bold">คุณลักษณะอันพึงประสงค์ (A):</span><div class="whitespace-pre-wrap pl-2" contenteditable="true" data-bs-field="a_objective">${escapeHtml(data.a_objective)}</div></div>
                </div>
              </div>

              <!-- 5. สาระการเรียนรู้ -->
              <div class="section-card bg-white p-3 rounded-lg border border-slate-200">
                <div class="flex items-center justify-between border-b border-slate-200 pb-1 mb-2">
                  <h3 class="font-bold text-slate-900" style="font-size: 16pt;">5. สาระการเรียนรู้</h3>
                  <button type="button" class="bs-copy-sec-btn text-xs bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 px-2.5 py-1 rounded border border-slate-200 flex items-center gap-1 cursor-pointer" data-sec="5">${copyIconSvg} คัดลอกหัวข้อนี้</button>
                </div>
                <div class="whitespace-pre-wrap pl-3" contenteditable="true" data-bs-field="learning_content">${escapeHtml(data.learning_content)}</div>
              </div>

              <!-- 6. สมรรถนะสำคัญของผู้เรียน -->
              <div class="section-card bg-white p-3 rounded-lg border border-slate-200">
                <div class="flex items-center justify-between border-b border-slate-200 pb-1 mb-2">
                  <h3 class="font-bold text-slate-900" style="font-size: 16pt;">6. สมรรถนะสำคัญของผู้เรียน</h3>
                  <button type="button" class="bs-copy-sec-btn text-xs bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 px-2.5 py-1 rounded border border-slate-200 flex items-center gap-1 cursor-pointer" data-sec="6">${copyIconSvg} คัดลอกหัวข้อนี้</button>
                </div>
                <div class="whitespace-pre-wrap pl-3" contenteditable="true" data-bs-field="competencies">${escapeHtml(data.competencies)}</div>
              </div>

              <!-- 7. กิจกรรมการเรียนรู้ -->
              <div class="section-card bg-white p-3 rounded-lg border border-slate-200">
                <div class="flex items-center justify-between border-b border-slate-200 pb-1 mb-2">
                  <h3 class="font-bold text-slate-900" style="font-size: 16pt;">7. กิจกรรมการเรียนรู้ (รูปแบบการสอนแบบ <span contenteditable="true" data-bs-field="teaching_model">${escapeHtml(data.teaching_model)}</span>)</h3>
                  <button type="button" class="bs-copy-sec-btn text-xs bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 px-2.5 py-1 rounded border border-slate-200 flex items-center gap-1 cursor-pointer" data-sec="7">${copyIconSvg} คัดลอกหัวข้อนี้</button>
                </div>
                <div class="pl-1" contenteditable="true" data-bs-field="activities">${formatActivitiesToHtml(escapeHtml(data.activities))}</div>
              </div>

              <!-- 8. สื่อและแหล่งการเรียนรู้ -->
              <div class="section-card bg-white p-3 rounded-lg border border-slate-200">
                <div class="flex items-center justify-between border-b border-slate-200 pb-1 mb-2">
                  <h3 class="font-bold text-slate-900" style="font-size: 16pt;">8. สื่อและแหล่งการเรียนรู้</h3>
                  <button type="button" class="bs-copy-sec-btn text-xs bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 px-2.5 py-1 rounded border border-slate-200 flex items-center gap-1 cursor-pointer" data-sec="8">${copyIconSvg} คัดลอกหัวข้อนี้</button>
                </div>
                <div class="whitespace-pre-wrap pl-3" contenteditable="true" data-bs-field="media_resources">${escapeHtml(data.media_resources)}</div>
              </div>

              <!-- 9. การวัดผลประเมินผล -->
              <div class="section-card bg-white p-3 rounded-lg border border-slate-200">
                <div class="flex items-center justify-between border-b border-slate-200 pb-1 mb-2">
                  <h3 class="font-bold text-slate-900" style="font-size: 16pt;">9. การวัดผลประเมินผล</h3>
                  <button type="button" class="bs-copy-sec-btn text-xs bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 px-2.5 py-1 rounded border border-slate-200 flex items-center gap-1 cursor-pointer" data-sec="9">${copyIconSvg} คัดลอกหัวข้อนี้</button>
                </div>
                <div class="overflow-x-auto my-2">
                  <table style="border-collapse: collapse; border: 1px solid #000; width: 100%; font-size: 15pt;">
                    <thead>
                      <tr style="background-color: #f1f5f9;">
                        <th style="border: 1px solid #000; padding: 6px 8px; text-align: center; width: 30%;">จุดประสงค์การเรียนรู้</th>
                        <th style="border: 1px solid #000; padding: 6px 8px; text-align: center; width: 25%;">วิธีการวัด</th>
                        <th style="border: 1px solid #000; padding: 6px 8px; text-align: center; width: 25%;">เครื่องมือวัด</th>
                        <th style="border: 1px solid #000; padding: 6px 8px; text-align: center; width: 20%;">เกณฑ์การวัด</th>
                      </tr>
                    </thead>
                    <tbody>${evalRowsHtml}</tbody>
                  </table>
                </div>
              </div>

              <!-- 10. กิจกรรมเสนอแนะ/งานที่มอบหมาย -->
              <div class="section-card bg-white p-3 rounded-lg border border-slate-200">
                <div class="flex items-center justify-between border-b border-slate-200 pb-1 mb-2">
                  <h3 class="font-bold text-slate-900" style="font-size: 16pt;">10. กิจกรรมเสนอแนะ/งานที่มอบหมาย</h3>
                  <button type="button" class="bs-copy-sec-btn text-xs bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 px-2.5 py-1 rounded border border-slate-200 flex items-center gap-1 cursor-pointer" data-sec="10">${copyIconSvg} คัดลอกหัวข้อนี้</button>
                </div>
                <div class="pl-3 space-y-2">
                  <div><span class="font-bold">1. กิจกรรมเสนอแนะ:</span><div class="whitespace-pre-wrap pl-2" contenteditable="true" data-bs-field="suggestions">${escapeHtml(data.suggestions)}</div></div>
                  <div><span class="font-bold">2. งานที่มอบหมาย:</span><div class="whitespace-pre-wrap pl-2" contenteditable="true" data-bs-field="assignments">${escapeHtml(data.assignments)}</div></div>
                </div>
              </div>

              <!-- 11. บันทึกหลังกระบวนการจัดการเรียนรู้ -->
              <div class="section-card bg-white p-3 rounded-lg border border-slate-200">
                <div class="flex items-center justify-between border-b border-slate-200 pb-1 mb-2">
                  <h3 class="font-bold text-slate-900" style="font-size: 16pt;">11. บันทึกหลังกระบวนการจัดการเรียนรู้</h3>
                  <button type="button" class="bs-copy-sec-btn text-xs bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 px-2.5 py-1 rounded border border-slate-200 flex items-center gap-1 cursor-pointer" data-sec="11">${copyIconSvg} คัดลอกหัวข้อนี้</button>
                </div>
                <div class="pl-3 space-y-2" style="font-size: 16pt;">
                  <div class="font-bold">ผลการจัดการเรียนการสอน</div>
                  <div style="padding-left: 24pt;">นักเรียนจำนวน................คน / ผ่านจุดประสงค์................คน (คิดเป็นร้อยละ...............)</div>
                  <div class="pt-4 flex justify-end">
                    <div class="text-center" style="width: 320px;">
                      <div>ลงชื่อ .................................................................</div>
                      <div>( ${escapeHtml(teacherName)} )</div>
                      <div>ตำแหน่ง ${escapeHtml(teacherPos)}</div>
                      <div>${signDateStr}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    modal.querySelectorAll('[data-bs-a4-close]').forEach(btn => {
      btn.addEventListener('click', () => this.closeA4PreviewModal());
    });

    // ซิงก์การแก้ไข contenteditable ลง IndexedDB ทันที
    modal.querySelectorAll<HTMLElement>('[data-bs-field]').forEach(el => {
      el.addEventListener('blur', () => {
        const field = el.dataset.bsField as keyof LessonPlanData;
        if (field && plan.generatedPlan) {
          (plan.generatedPlan as any)[field] = el.innerText.trim();
          void saveBatchJobToDb(job);
        }
      });
    });

    modal.querySelectorAll<HTMLElement>('.bs-eval-cell').forEach(cell => {
      cell.addEventListener('blur', () => {
        const tr = cell.closest('tr');
        const idx = parseInt(tr?.getAttribute('data-bs-eval-row') || '0', 10);
        const field = cell.dataset.field as keyof EvaluationRow;
        if (plan.generatedPlan?.evaluation_rows?.[idx] && field) {
          plan.generatedPlan.evaluation_rows[idx][field] = cell.innerText.trim();
          void saveBatchJobToDb(job);
        }
      });
    });

    // ปุ่มคัดลอกแยกหัวข้อ 1-11
    modal.querySelectorAll<HTMLElement>('.bs-copy-sec-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const secNum = parseInt(btn.dataset.sec || '1', 10);
        const content = getSectionCopyContent(secNum, plan.generatedPlan!);
        const ok = await copyRichText(content.html, content.text);
        this.callbacks?.showToast(
          ok ? `คัดลอกหัวข้อที่ ${secNum} เรียบร้อยแล้ว` : 'ไม่สามารถคัดลอกลงคลิปบอร์ดได้',
          ok ? 'success' : 'error'
        );
      });
    });

    // ปุ่มคัดลอกทั้งแผน
    modal.querySelector('#bs-a4-copy-all')?.addEventListener('click', async () => {
      const synced = syncPlanHeaderWithJob(plan, job);
      const html = buildFullPlanHtml(synced);
      const plain = buildFullPlanPlainText(synced);
      const ok = await copyRichText(html, plain);
      this.callbacks?.showToast(
        ok ? 'คัดลอกทั้งแผนเรียบร้อยแล้ว (วางใน Word ได้ทันที)' : 'ไม่สามารถคัดลอกได้',
        ok ? 'success' : 'error'
      );
    });

    // ปุ่มโหลด .docx
    modal.querySelector('#bs-a4-export-docx')?.addEventListener('click', async () => {
      try {
        await exportSingleBatchPlanDocx(job, plan);
        this.callbacks?.showToast(`ดาวน์โหลดแผนที่ ${plan.planNumber} (.docx) เรียบร้อยแล้ว`, 'success');
      } catch (err: any) {
        this.callbacks?.showToast(err?.message || 'ไม่สามารถส่งออกไฟล์ .docx ได้', 'error');
      }
    });

    modal.style.display = 'flex';
    modal.classList.remove('hidden');
  }

  private closeA4PreviewModal(): void {
    this.activeA4PreviewPlanId = null;
    const modal = document.getElementById('bs-a4-preview-modal');
    if (modal) {
      modal.style.display = 'none';
      modal.classList.add('hidden');
    }
  }
}

export const batchStructureController = new BatchStructureController();
