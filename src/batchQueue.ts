/**
 * EduPlan AI — Sequential Background Batch Queue & Floating Status Bar
 * ============================================================
 * - ประมวลผลทีละ 1 แผนตามลำดับคิวด้วย BYOK โหมดด่วน (Fast Mode Only)
 * - หน่วงเวลาพัก 2.5 วินาทีระหว่างแผนเพื่อป้องกัน HTTP 429
 * - Auto-Resume นับถอยหลัง 15 วินาทีเมื่อเจอ HTTP 429 แล้วทำแผนเดิมต่ออัตโนมัติ
 * - บันทึกผลลัพธ์ลง IndexedDB ทันทีที่เสร็จทีละแผน
 * - แสดง Floating Status Bar มุมขวาล่างข้ามทุกหน้าใน index.html
 * ============================================================
 */

import Dexie, { type Table } from 'dexie';
import { callGeminiByokFastOnly } from './gemini';
import {
  buildSystemInstruction,
  buildLessonPlanPrompt,
  parseLessonPlanResponse,
  type LessonPlanInput,
} from './templates';
import type { Indicator } from './curriculum';
import { type CourseStructureBatchJob, type ExtractedPlanItem } from './structureParser';
import { exportBatchPlansAsZip, syncPlanHeaderWithJob } from './batchExporter';

// ============================================================
// IndexedDB Storage (Dexie)
// ============================================================
interface StoredBatchJobRecord {
  jobId: string;
  updatedAt: number;
  job: CourseStructureBatchJob;
}

class BatchJobDatabase extends Dexie {
  public jobs!: Table<StoredBatchJobRecord, string>;

  constructor() {
    super('eduplan_batch_structure_db');
    this.version(1).stores({
      jobs: 'jobId, updatedAt',
    });
  }
}

const batchDb = new BatchJobDatabase();
const LAST_JOB_ID_KEY = 'eduplan_last_batch_job_id';

export async function saveBatchJobToDb(job: CourseStructureBatchJob): Promise<void> {
  try {
    const clone: CourseStructureBatchJob = JSON.parse(JSON.stringify(job));
    await batchDb.jobs.put({
      jobId: clone.jobId,
      updatedAt: Date.now(),
      job: clone,
    });
    localStorage.setItem(LAST_JOB_ID_KEY, clone.jobId);
  } catch (err) {
    console.warn('[BatchQueue] Failed to persist job to IndexedDB:', err);
  }
}

export async function loadLatestBatchJobFromDb(): Promise<CourseStructureBatchJob | null> {
  try {
    const lastId = localStorage.getItem(LAST_JOB_ID_KEY);
    if (lastId) {
      const rec = await batchDb.jobs.get(lastId);
      if (rec?.job) return rec.job;
    }
    const all = await batchDb.jobs.orderBy('updatedAt').reverse().toArray();
    return all[0]?.job || null;
  } catch (err) {
    console.warn('[BatchQueue] Failed to load job from IndexedDB:', err);
    return null;
  }
}

export async function clearBatchJobFromDb(jobId: string): Promise<void> {
  try {
    await batchDb.jobs.delete(jobId);
    if (localStorage.getItem(LAST_JOB_ID_KEY) === jobId) {
      localStorage.removeItem(LAST_JOB_ID_KEY);
    }
  } catch {
    // ignore
  }
}

// ============================================================
// Queue State & Subscriptions
// ============================================================
export interface BatchQueueStatusSnapshot {
  isRunning: boolean;
  isPausedForRateLimit: boolean;
  rateLimitSecondsLeft: number;
  pauseReason: string;
  activePlanNumber: number | null;
  activePlanTopic: string;
  completedCount: number;
  totalTargetCount: number;
  justFinishedAll: boolean;
}

type QueueUpdateListener = (job: CourseStructureBatchJob, status: BatchQueueStatusSnapshot) => void;
const listeners = new Set<QueueUpdateListener>();

let activeJob: CourseStructureBatchJob | null = null;
let queueRunning = false;
let stopRequested = false;
let rateLimitWaitLeft = 0;
let pauseReasonText = '';
let currentGeneratingPlanNum: number | null = null;
let currentGeneratingTopic = '';
let currentBatchTargetIds = new Set<string>();
let floatingBarHiddenManual = false;
let onOpenWorkspaceCallback: (() => void) | null = null;
let toastCallback: ((msg: string, type?: 'success' | 'error' | 'info') => void) | null = null;

export function configureBatchQueueCallbacks(opts: {
  onOpenWorkspace: () => void;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}): void {
  onOpenWorkspaceCallback = opts.onOpenWorkspace;
  toastCallback = opts.showToast;
}

export function onBatchQueueUpdate(listener: QueueUpdateListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getActiveBatchJob(): CourseStructureBatchJob | null {
  return activeJob;
}

export function setActiveBatchJob(job: CourseStructureBatchJob | null): void {
  activeJob = job;
  if (job) {
    void saveBatchJobToDb(job);
    notifyListeners(false);
  } else {
    renderFloatingStatusBar();
  }
}

export function isBatchQueueRunning(): boolean {
  return queueRunning;
}

function getStatusSnapshot(justFinishedAll = false): BatchQueueStatusSnapshot {
  const plans = activeJob?.plans || [];
  const targetPlans =
    currentBatchTargetIds.size > 0
      ? plans.filter(p => currentBatchTargetIds.has(p.id))
      : plans.filter(p => p.selected || p.status === 'completed');

  const completedInTarget = targetPlans.filter(p => p.status === 'completed').length;

  return {
    isRunning: queueRunning,
    isPausedForRateLimit: rateLimitWaitLeft > 0,
    rateLimitSecondsLeft: rateLimitWaitLeft,
    pauseReason: pauseReasonText,
    activePlanNumber: currentGeneratingPlanNum,
    activePlanTopic: currentGeneratingTopic,
    completedCount: completedInTarget,
    totalTargetCount: Math.max(targetPlans.length, completedInTarget),
    justFinishedAll,
  };
}

function notifyListeners(justFinishedAll = false): void {
  const snap = getStatusSnapshot(justFinishedAll);
  renderFloatingStatusBar(snap);
  if (!activeJob) return;
  for (const fn of listeners) {
    try {
      fn(activeJob, snap);
    } catch (e) {
      console.warn('[BatchQueue] Listener error:', e);
    }
  }
}

// ป้องกันการปิดหรือรีเฟรชแท็บขณะคิวกำลังทำงาน
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', e => {
    if (queueRunning) {
      e.preventDefault();
      e.returnValue = 'กำลังสร้างแผนการจัดการเรียนรู้แบบชุดค้างอยู่ หากปิดหน้านี้คิวจะถูกหยุด';
    }
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeHtml(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * แปลงข้อมูลของแต่ละแผนจากโครงสร้างรายวิชาเป็น LessonPlanInput สำหรับ Prompt Builder มาตรฐาน 11 หัวข้อ
 */
function buildLessonPlanInputFromItem(
  job: CourseStructureBatchJob,
  item: ExtractedPlanItem
): LessonPlanInput {
  const indicatorLines = (item.indicators || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && l !== '-');

  const selectedIndicators: Indicator[] = indicatorLines.map((line, i) => {
    const colonIdx = line.indexOf(':');
    if (colonIdx !== -1) {
      return {
        id: `batch_ind_${item.planNumber}_${i}`,
        code: line.slice(0, colonIdx).trim(),
        text: line.slice(colonIdx + 1).trim(),
      };
    }
    return {
      id: `batch_ind_${item.planNumber}_${i}`,
      code: line,
      text: `ตัวชี้วัดตามโครงสร้างรายวิชา (${line})`,
    };
  });

  const standardLines = (item.standards || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && l !== '-');

  const selectedStandards = standardLines.map(line => {
    const colonIdx = line.indexOf(':');
    if (colonIdx !== -1) {
      return {
        code: line.slice(0, colonIdx).trim(),
        title: line.slice(colonIdx + 1).trim(),
      };
    }
    return {
      code: line,
      title: 'มาตรฐานการเรียนรู้ตามหลักสูตรแกนกลางการศึกษาขั้นพื้นฐาน',
    };
  });

  const extraContextParts: string[] = [];
  if (item.weekLabel) extraContextParts.push(`กำหนดการสอน: ${item.weekLabel}`);
  if (item.key_concepts && item.key_concepts !== '-') {
    extraContextParts.push(`หัวข้อ/สาระสำคัญจากโครงสร้างรายวิชา:\n${item.key_concepts}`);
  }
  if (item.media_resources && item.media_resources !== '-') {
    extraContextParts.push(`สื่อและแหล่งเรียนรู้ที่ระบุในโครงสร้างรายวิชา:\n${item.media_resources}`);
  }
  if (item.evaluation_method && item.evaluation_method !== '-') {
    extraContextParts.push(`วิธีการวัดและประเมินผลที่ระบุในโครงสร้างรายวิชา:\n${item.evaluation_method}`);
  }

  const courseDisplay = [job.courseCode?.trim(), job.courseName?.trim()].filter(Boolean).join(' ');
  const isEc = /^(?:อ\.|อนุบาล|ปฐมวัย)/i.test(job.grade.trim());

  return {
    planName: `แผนการจัดการเรียนรู้ที่ ${item.planNumber} เรื่อง ${item.topic}`,
    gradeLevel: job.grade || 'ม.2',
    subject: job.subjectGroup || 'วิทยาศาสตร์และเทคโนโลยี',
    subjectName: courseDisplay || job.courseName || 'รายวิชา',
    unit: item.unit || 'หน่วยการเรียนรู้',
    topic: item.topic,
    durationMinutes: Math.max(1, item.hours) * 60,
    durationText: `${Math.max(1, item.hours)} ชั่วโมง`,
    selectedIndicators,
    selectedStandards,
    objectiveMode: 'kpa',
    kpaK: item.k_objective && item.k_objective !== '-' ? item.k_objective : '',
    kpaP: item.p_objective && item.p_objective !== '-' ? item.p_objective : '',
    kpaA: item.a_objective && item.a_objective !== '-' ? item.a_objective : '',
    customObjective: '',
    teachingMethod: item.teaching_method && item.teaching_method !== '-' ? item.teaching_method : 'Active Learning',
    competencies: [
      'ความสามารถในการสื่อสาร',
      'ความสามารถในการคิด',
      'ความสามารถในการแก้ปัญหา',
      'ความสามารถในการใช้ทักษะชีวิต',
      'ความสามารถในการใช้เทคโนโลยี',
    ],
    classroomAtmosphere: 'เน้นผู้เรียนลงมือปฏิบัติจริง คิดวิเคราะห์ และมีส่วนร่วมอย่างสร้างสรรค์',
    planDirections: ['แผนละเอียด', 'ขั้นตอนชัดเจน', 'ลงมือปฏิบัติ'],
    additionalNotes: extraContextParts.join('\n\n'),
    isEarlyChildhood: isEc,
    earlyChildhoodDomains: [],
    school: job.schoolName || '……………………………………………',
    semester: job.semester || '1',
    date: '…………',
    month: '……………………',
    academicYear: job.academicYear || String(new Date().getFullYear() + 543),
    buddhistYear: job.academicYear || String(new Date().getFullYear() + 543),
    teacherName: job.teacherName || '……………………………………………………',
    teacherPosition: job.teacherPosition || 'ครู',
  };
}

/**
 * สั่งเริ่มรันคิวสร้างแผนการสอนทีละ 1 แผน (Sequential Queue + 2.5s Pacing + 429 Auto-Resume)
 */
export async function startBatchGeneration(
  job: CourseStructureBatchJob,
  specificPlanIds?: string[]
): Promise<void> {
  activeJob = job;
  floatingBarHiddenManual = false;

  const targetPlans = specificPlanIds?.length
    ? job.plans.filter(p => specificPlanIds.includes(p.id))
    : job.plans.filter(p => p.selected && p.status !== 'completed');

  if (targetPlans.length === 0) {
    toastCallback?.('ไม่มีแผนที่รอสร้างในคิว (หากต้องการสร้างซ้ำ กดปุ่ม "เจนแผนนี้" ที่การ์ดแผน)', 'info');
    return;
  }

  for (const p of targetPlans) {
    p.status = 'queued';
    p.errorMessage = undefined;
    currentBatchTargetIds.add(p.id);
  }

  await saveBatchJobToDb(job);
  notifyListeners(false);

  if (queueRunning) {
    // คิวกำลังทำงานอยู่แล้ว แผนที่ถูกปรับเป็น queued จะถูกรันต่ออัตโนมัติ
    return;
  }

  queueRunning = true;
  stopRequested = false;
  notifyListeners(false);

  let generatedInThisRun = 0;

  try {
    while (!stopRequested && activeJob) {
      const nextPlan = activeJob.plans.find(p => p.status === 'queued');
      if (!nextPlan) break;

      // หน่วงเวลาพัก 2.5 วินาทีระหว่างแผนเพื่อป้องกันติด Rate Limit (RPM)
      if (generatedInThisRun > 0) {
        for (let ms = 0; ms < 2500 && !stopRequested; ms += 250) {
          await sleep(250);
        }
        if (stopRequested) break;
      }

      nextPlan.status = 'generating';
      nextPlan.errorMessage = undefined;
      currentGeneratingPlanNum = nextPlan.planNumber;
      currentGeneratingTopic = nextPlan.topic;
      await saveBatchJobToDb(activeJob);
      notifyListeners(false);

      let planDone = false;
      let transientAttempts = 0;
      const MAX_TRANSIENT_RETRIES = 4;

      while (!planDone && !stopRequested) {
        try {
          const input = buildLessonPlanInputFromItem(activeJob, nextPlan);
          const systemInstruction = buildSystemInstruction();
          const prompt = buildLessonPlanPrompt(input);

          const res = await callGeminiByokFastOnly(prompt, systemInstruction, 8192);
          const parsedPlan = parseLessonPlanResponse(res.text, input);

          nextPlan.generatedPlan = parsedPlan;
          nextPlan.generatedPlan = syncPlanHeaderWithJob(nextPlan, activeJob);
          nextPlan.status = 'completed';
          nextPlan.errorMessage = undefined;
          generatedInThisRun++;
          planDone = true;

          await saveBatchJobToDb(activeJob);
          notifyListeners(false);
        } catch (err: any) {
          const msg = String(err?.message || err || '');
          const isRateLimit = err?.status === 429 || /429|BYOK_429|quota|rate.?limit/i.test(msg);
          const isServiceBusy = err?.status === 503 || /503|overloaded|unavailable/i.test(msg);
          const isNetworkErr =
            Boolean(err?.isTransientNetwork) ||
            /Failed to fetch|NetworkError|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_CLOSED/i.test(msg);
          const isTransient = isRateLimit || isServiceBusy || isNetworkErr || Boolean(err?.isTransient);

          if (isTransient && !stopRequested && transientAttempts < MAX_TRANSIENT_RETRIES) {
            transientAttempts++;
            const waitSec = isRateLimit ? 15 : 8;
            pauseReasonText = isRateLimit
              ? 'ติดโควต้าความถี่ (HTTP 429)'
              : isServiceBusy
                ? 'เซิร์ฟเวอร์ Google Gemini หนาแน่นชั่วคราว (HTTP 503)'
                : 'การเชื่อมต่อ/DNS ขัดข้องชั่วคราว';
            rateLimitWaitLeft = waitSec;
            notifyListeners(false);
            while (rateLimitWaitLeft > 0 && !stopRequested) {
              await sleep(1000);
              rateLimitWaitLeft = Math.max(0, rateLimitWaitLeft - 1);
              notifyListeners(false);
            }
            rateLimitWaitLeft = 0;
            pauseReasonText = '';
            notifyListeners(false);
            continue;
          } else {
            nextPlan.status = 'error';
            nextPlan.errorMessage = msg || 'เกิดข้อผิดพลาดในการสร้างแผน';
            planDone = true;
            await saveBatchJobToDb(activeJob);
            notifyListeners(false);

            // หากคีย์ผิด (400/403) หรือ BYOK ถูกปิด ให้หยุดคิวทันทีเพื่อไม่ให้เสียเวลาวนทุกแผน
            if (err?.code === 'BYOK_REQUIRED' || err?.isFatal) {
              stopRequested = true;
              toastCallback?.(`หยุดคิวเนื่องจากข้อผิดพลาดของ API Key: ${nextPlan.errorMessage}`, 'error');
            }
          }
        }
      }
    }
  } finally {
    // หากกดหยุดคิวกลางคัน ให้คืนสถานะแผนที่ยังค้างอยู่ในคิวกลับเป็น idle
    if (stopRequested && activeJob) {
      for (const p of activeJob.plans) {
        if (p.status === 'queued' || p.status === 'generating') {
          p.status = 'idle';
        }
      }
      await saveBatchJobToDb(activeJob);
    }

    const finishedNormally = !stopRequested && activeJob && !activeJob.plans.some(p => p.status === 'queued');
    queueRunning = false;
    rateLimitWaitLeft = 0;
    pauseReasonText = '';
    currentGeneratingPlanNum = null;
    currentGeneratingTopic = '';
    notifyListeners(Boolean(finishedNormally && generatedInThisRun > 0));

    if (finishedNormally && generatedInThisRun > 0) {
      toastCallback?.(`สร้างแผนการจัดการเรียนรู้เสร็จสมบูรณ์แล้ว (${generatedInThisRun} แผน)`, 'success');
    }
  }
}

/**
 * หยุดคิวการสร้างแผนที่กำลังทำงานอยู่
 */
export function stopBatchGeneration(): void {
  if (!queueRunning) return;
  stopRequested = true;
  rateLimitWaitLeft = 0;
  toastCallback?.('กำลังหยุดคิวการสร้างแผน...', 'info');
  notifyListeners(false);
}

// ============================================================
// Persistent Floating Status Bar (แสดงผลมุมขวาล่างข้ามทุกหน้าใน index.html)
// ============================================================
function ensureFloatingBarElement(): HTMLElement {
  let el = document.getElementById('batch-floating-status-bar');
  if (!el) {
    el = document.createElement('div');
    el.id = 'batch-floating-status-bar';
    el.className = 'fixed bottom-4 right-4 z-50 max-w-md w-[calc(100vw-2rem)] hidden transition-all duration-200';
    document.body.appendChild(el);

    el.addEventListener('click', async e => {
      const target = (e.target as HTMLElement).closest<HTMLElement>('[data-fb-action]');
      if (!target) return;
      const action = target.dataset.fbAction;
      if (action === 'open-queue') {
        onOpenWorkspaceCallback?.();
      } else if (action === 'stop-queue') {
        stopBatchGeneration();
      } else if (action === 'download-zip') {
        if (activeJob) {
          try {
            const count = await exportBatchPlansAsZip(activeJob);
            toastCallback?.(`ดาวน์โหลดไฟล์ .zip รวม ${count} แผนเรียบร้อยแล้ว`, 'success');
          } catch (err: any) {
            toastCallback?.(err?.message || 'ไม่สามารถดาวน์โหลดไฟล์ .zip ได้', 'error');
          }
        }
        onOpenWorkspaceCallback?.();
      } else if (action === 'close-bar') {
        floatingBarHiddenManual = true;
        el?.classList.add('hidden');
      }
    });
  }
  return el;
}

function renderFloatingStatusBar(snapInput?: BatchQueueStatusSnapshot): void {
  if (typeof document === 'undefined') return;
  const bar = ensureFloatingBarElement();

  if (!activeJob) {
    bar.classList.add('hidden');
    return;
  }

  const snap = snapInput || getStatusSnapshot(false);
  const completedAll = activeJob.plans.filter(p => p.status === 'completed').length;

  // แสดงแถบเมื่อคิวกำลังรัน หรือเมื่อเพิ่งสร้างเสร็จและผู้ใช้ยังไม่ได้กดปิด
  if (!snap.isRunning && (completedAll === 0 || floatingBarHiddenManual)) {
    bar.classList.add('hidden');
    return;
  }

  bar.classList.remove('hidden');

  if (snap.isRunning) {
    const pct =
      snap.totalTargetCount > 0 ? Math.min(100, Math.round((snap.completedCount / snap.totalTargetCount) * 100)) : 0;

    const statusLine = snap.isPausedForRateLimit
      ? `${snap.pauseReason || 'ติดโควต้าความถี่'} • พักรอ ${snap.rateLimitSecondsLeft} วินาที แล้วทำแผนที่ ${snap.activePlanNumber || '-'} ต่ออัตโนมัติ...`
      : `กำลังสร้างแผนจากโครงสร้าง (เสร็จแล้ว ${snap.completedCount}/${snap.totalTargetCount} แผน) • กำลังทำ: แผนที่ ${snap.activePlanNumber || '-'}...`;

    bar.innerHTML = `
      <div class="bg-white border-2 border-blue-200 rounded-2xl shadow-2xl p-4 text-slate-800">
        <div class="flex items-start gap-3">
          <div class="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 mt-0.5">
            <svg class="w-5 h-5 animate-spin text-blue-600" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-xs font-bold text-slate-900 leading-snug">${escapeHtml(statusLine)}</p>
            <p class="text-[11px] text-slate-500 truncate mt-0.5">${escapeHtml(snap.activePlanTopic || activeJob.courseName)}</p>
            <div class="w-full h-2 bg-slate-100 rounded-full overflow-hidden mt-2">
              <div class="h-full bg-gradient-to-r from-blue-600 to-sky-500 transition-all duration-300" style="width: ${pct}%"></div>
            </div>
          </div>
        </div>
        <div class="flex items-center justify-end gap-2 mt-3 pt-2.5 border-t border-slate-100">
          <button type="button" data-fb-action="open-queue" class="px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold border border-blue-200 transition-colors cursor-pointer">
            เปิดดูคิว
          </button>
          <button type="button" data-fb-action="stop-queue" class="px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold border border-red-200 transition-colors cursor-pointer flex items-center gap-1">
            <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><rect x="5" y="5" width="10" height="10" rx="1.5"/></svg>
            <span>หยุดคิว</span>
          </button>
        </div>
      </div>
    `;
  } else {
    bar.innerHTML = `
      <div class="bg-emerald-50 border-2 border-emerald-300 rounded-2xl shadow-2xl p-4 text-emerald-950">
        <div class="flex items-start justify-between gap-3">
          <div class="flex items-start gap-2.5 min-w-0">
            <div class="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 mt-0.5">
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <div class="min-w-0">
              <p class="text-xs sm:text-sm font-bold text-emerald-950 leading-snug">
                สร้างแผนครบทั้งหมด ${completedAll} แผนเรียบร้อยแล้ว
              </p>
              <p class="text-[11px] text-emerald-700 truncate mt-0.5">
                ${escapeHtml(activeJob.courseCode ? `${activeJob.courseCode} ` : '')}${escapeHtml(activeJob.courseName)}
              </p>
            </div>
          </div>
          <button type="button" data-fb-action="close-bar" class="text-emerald-700 hover:text-emerald-950 p-1 rounded-lg hover:bg-emerald-100 transition-colors cursor-pointer shrink-0" title="ปิดแถบแจ้งเตือน">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div class="flex items-center justify-end gap-2 mt-3 pt-2.5 border-t border-emerald-200/80">
          <button type="button" data-fb-action="open-queue" class="px-3 py-1.5 rounded-lg bg-white hover:bg-emerald-100 text-emerald-800 text-xs font-bold border border-emerald-300 transition-colors cursor-pointer">
            เปิดหน้ารายการแผน
          </button>
          <button type="button" data-fb-action="download-zip" class="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer flex items-center gap-1.5">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
            </svg>
            <span>ดูผลลัพธ์ / โหลด ZIP</span>
          </button>
        </div>
      </div>
    `;
  }
}
