/**
 * EduPlan AI — Main UI Controller
 * ============================================================
 * สถาปัตยกรรม SPA เพื่อคุณครู (สไตล์สว่าง เรียบง่าย ขาว-ฟ้า)
 * รองรับการกรอกทีละหัวข้อ (Dot Progress ไข่ปลา) และหน้าเดียว
 * สอดคล้องกับ Data Schema ของ curriculum.json v2.1.0
 * ============================================================
 */

import './style.css';
import {
  loadCurriculum,
  getGradeLevels,
  getSubjects,
  isEarlyChildhood,
  getEarlyChildhoodDomains,
  getAvailableStandards,
  getIndicatorsByGrade,
  formatFullGradeName,
  type CurriculumData,
  type Indicator,
  type Standard,
  type Subject,
  type GradeLevel,
} from './curriculum';
import {
  TEACHING_METHODS,
  DEFAULT_TEACHING_METHOD,
  COMPETENCIES,
  PLAN_DIRECTIONS,
  DURATION_OPTIONS,
  type DurationOption,
  getWorkerEndpoint,
  setWorkerEndpoint,
  DEFAULT_WORKER_ENDPOINT,
} from './config';
import {
  buildSystemInstruction,
  buildLessonPlanPrompt,
  buildKPAPrompt,
  getCurrentThaiDate,
  parseLessonPlanResponse,
  generateStandardLessonPlan,
  type LessonPlanInput,
} from './templates';
import type { LessonPlanData, EvaluationRow } from './types';
import { callGemini, refineWithGemini, type GeminiResult } from './gemini';
import {
  exportToDocx,
  buildFullPlanHtml,
  buildFullPlanPlainText,
  getHeaderDisplayValues,
  copyRichText,
  getSectionCopyContent,
} from './exporter';

// ============================================================
// State
// ============================================================
interface AppState {
  view: 'choice' | 'wizard' | 'allinone';
  currentStep: number; // 1 to 10
  gradeId: string;
  subjectId: string;
  subjectName: string;
  customSubject: string;
  isEarlyChildhoodMode: boolean;
  selectedECDomains: string[];
  planName: string;
  unit: string;
  topic: string;
  durationMinutes: number;
  durationText: string;
  durationOptionId: string;
  durationCustomType: 'hours' | 'minutes' | 'both';
  durationCustomHours: number;
  durationCustomMinutes: number;
  selectedStandardIds: string[];
  selectedIndicatorIds: string[];
  objectiveMode: 'kpa' | 'custom';
  kpaK: string;
  kpaP: string;
  kpaA: string;
  customObjective: string;
  teachingMethod: string;
  customTeachingMethod: string;
  competencies: string[];
  classroomAtmosphere: string;
  planDirections: string[];
  additionalNotes: string;
  school: string;
  semester: string;
  date: string;
  month: string;
  academicYear: string;
  buddhistYear: string;
  teacherName: string;
  teacherPosition: string;
  generatedPlan: string;
  lessonPlanData: LessonPlanData | null;
  resolvedModel: string;
  isLoading: boolean;
  loadingMessage: string;
}

const thaiDateNow = getCurrentThaiDate();

const state: AppState = {
  view: 'choice',
  currentStep: 1,
  gradeId: '',
  subjectId: '',
  subjectName: '',
  customSubject: '',
  isEarlyChildhoodMode: false,
  selectedECDomains: [],
  planName: '',
  unit: '',
  topic: '',
  durationMinutes: 60,
  durationText: '1 ชั่วโมง',
  durationOptionId: '1hour',
  durationCustomType: 'hours',
  durationCustomHours: 3,
  durationCustomMinutes: 45,
  selectedStandardIds: [],
  selectedIndicatorIds: [],
  objectiveMode: 'kpa',
  kpaK: '',
  kpaP: '',
  kpaA: '',
  customObjective: '',
  teachingMethod: DEFAULT_TEACHING_METHOD,
  customTeachingMethod: '',
  competencies: [],
  classroomAtmosphere: '',
  planDirections: [],
  additionalNotes: '',
  school: '',
  semester: '1',
  date: thaiDateNow.day,
  month: thaiDateNow.month,
  academicYear: thaiDateNow.bYear,
  buddhistYear: thaiDateNow.bYear,
  teacherName: '',
  teacherPosition: 'ครูผู้ช่วย / ครู',
  generatedPlan: '',
  lessonPlanData: null,
  resolvedModel: '',
  isLoading: false,
  loadingMessage: '',
};

let curriculumData: CurriculumData;
let activeStandardForModal: Standard | null = null;
const TOTAL_WIZARD_STEPS = 10;
const DRAFT_STORAGE_KEY = 'eduplan_ai_draft';
let saveTimer: any = null;

// ============================================================
// Toast System
// ============================================================
function showToast(message: string, type: 'success' | 'error' | 'info' = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    toast.style.transition = 'all 0.25s ease';
    setTimeout(() => toast.remove(), 250);
  }, 3200);
}

// ============================================================
// Loading Overlay
// ============================================================
function showLoading(message: string) {
  state.isLoading = true;
  state.loadingMessage = message;
  const overlay = document.getElementById('loading-overlay');
  const text = document.getElementById('loading-text');
  if (overlay) {
    overlay.style.display = 'flex';
    overlay.classList.remove('hidden');
  }
  if (text) text.textContent = message;
}

function hideLoading() {
  state.isLoading = false;
  const overlay = document.getElementById('loading-overlay');
  if (overlay) {
    overlay.style.display = 'none';
    overlay.classList.add('hidden');
  }
}

// ============================================================
// Confirmation Modal
// ============================================================
function showModal(title: string, message: string, onYes: () => void, onNo: () => void) {
  const overlay = document.getElementById('modal-overlay')!;
  const titleEl = document.getElementById('modal-title')!;
  const msgEl = document.getElementById('modal-message')!;
  const yesBtn = document.getElementById('modal-yes')!;
  const noBtn = document.getElementById('modal-no')!;

  titleEl.textContent = title;
  msgEl.textContent = message;
  overlay.style.display = 'flex';
  overlay.classList.remove('hidden');

  const cleanup = () => {
    overlay.style.display = 'none';
    overlay.classList.add('hidden');
    yesBtn.replaceWith(yesBtn.cloneNode(true));
    noBtn.replaceWith(noBtn.cloneNode(true));
  };

  yesBtn.addEventListener('click', () => {
    cleanup();
    onYes();
  }, { once: true });

  noBtn.addEventListener('click', () => {
    cleanup();
    onNo();
  }, { once: true });
}

// ============================================================
// Navigation & Views
// ============================================================
function switchView(view: 'choice' | 'wizard' | 'allinone') {
  state.view = view;
  const choiceEl = document.getElementById('mode-choice-section');
  const wizardEl = document.getElementById('wizard-container');
  const allInOneEl = document.getElementById('allinone-section');

  if (choiceEl) choiceEl.classList.toggle('hidden', view !== 'choice');
  if (wizardEl) wizardEl.classList.toggle('hidden', view !== 'wizard');
  if (allInOneEl) allInOneEl.classList.toggle('hidden', view !== 'allinone');

  if (view === 'wizard') {
    showStep(state.currentStep || 1);
  } else if (view === 'allinone') {
    syncStateToAllInOne();
  }

  scheduleSaveDraft();
}

function renderDots() {
  const container = document.getElementById('wizard-dots-container');
  if (!container) return;

  container.innerHTML = '';
  for (let i = 1; i <= TOTAL_WIZARD_STEPS; i++) {
    const dot = document.createElement('div');
    dot.className = 'dot-item';
    dot.title = `ขั้นตอนที่ ${i}`;

    if (i === state.currentStep) {
      dot.classList.add('active');
    } else if (i < state.currentStep) {
      dot.classList.add('completed');
    }

    dot.addEventListener('click', () => {
      showStep(i);
    });

    container.appendChild(dot);
  }
}

function updateContextTag() {
  const tag = document.getElementById('wizard-context-tag');
  if (!tag) return;

  const fullGrade = formatFullGradeName(state.gradeId, curriculumData);
  const gradeLabel = state.gradeId ? fullGrade : '';

  const subjects = getSubjects(curriculumData, state.gradeId);
  const subjectObj = subjects.find(s => s.id === state.subjectId) || curriculumData?.subjects?.find(s => s.id === state.subjectId);
  let subjectLabel = state.subjectName?.trim() || '';
  if (!subjectLabel) {
    if (state.subjectId === 'earlyChildhood') {
      subjectLabel = 'กิจกรรมปฐมวัย';
    } else if (state.subjectId === 'custom') {
      subjectLabel = 'วิชาเพิ่มเติม';
    } else if (subjectObj) {
      subjectLabel = subjectObj.name;
    }
  }

  const parts: string[] = [];
  if (state.topic) {
    const shortTopic = state.topic.length > 25 ? state.topic.substring(0, 25) + '...' : state.topic;
    parts.push(`เรื่อง: ${shortTopic}`);
  }
  if (gradeLabel) parts.push(gradeLabel);
  if (subjectLabel) parts.push(subjectLabel);

  tag.textContent = parts.length > 0 ? parts.join(' · ') : 'กำลังเตรียมแผนการจัดการเรียนรู้';
}

function showStep(stepNum: number) {
  if (stepNum < 1) stepNum = 1;
  if (stepNum > TOTAL_WIZARD_STEPS) stepNum = TOTAL_WIZARD_STEPS;

  state.currentStep = stepNum;

  // Hide all step panels
  document.querySelectorAll('.wizard-step-panel').forEach(panel => {
    panel.classList.add('hidden');
  });

  // Show active step panel
  const activePanel = document.getElementById(`step-panel-${stepNum}`);
  if (activePanel) {
    activePanel.classList.remove('hidden');
  }

  // Update dots & context tag
  renderDots();
  updateContextTag();

  // Update back / next button labels
  const prevBtn = document.getElementById('btn-prev');
  const nextBtn = document.getElementById('btn-next');

  if (prevBtn) {
    if (stepNum === 1) {
      prevBtn.textContent = '← เลือกรูปแบบการกรอก';
    } else {
      prevBtn.textContent = '← ย้อนกลับ';
    }
  }

  if (nextBtn) {
    if (stepNum === TOTAL_WIZARD_STEPS) {
      nextBtn.classList.add('hidden');
    } else {
      nextBtn.classList.remove('hidden');
      nextBtn.textContent = 'ถัดไป →';
    }
  }

  // Special hooks for specific steps
  if (stepNum === 3) {
    renderWizardSubjectCards();
  } else if (stepNum === 5) {
    renderStep5Standards();
  } else if (stepNum === 10) {
    renderSummaryStep();
  }

  scheduleSaveDraft();
}
(window as any).showStep = showStep;

// ============================================================
// Step 1: Grade Level Selection
// ============================================================
function setupGradeStep() {
  document.querySelectorAll('.grade-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const grade = (btn as HTMLElement).dataset.grade || '';
      selectGrade(grade);
    });
  });
}

function selectGrade(gradeId: string) {
  state.gradeId = gradeId;
  state.isEarlyChildhoodMode = isEarlyChildhood(gradeId);

  // Update pill active classes
  document.querySelectorAll('.grade-pill').forEach(btn => {
    const isSelected = (btn as HTMLElement).dataset.grade === gradeId;
    btn.classList.toggle('active', isSelected);
  });

  // Sync select inputs
  document.querySelectorAll('.grade-select').forEach(el => {
    (el as HTMLSelectElement).value = gradeId;
  });

  // Re-render subjects dynamically for this grade (e.g. physics/chem for m4-m6)
  renderWizardSubjectCards();
  populateAllInOneSubjects();

  // Validate current subject
  const available = getSubjects(curriculumData, gradeId);
  const isValid = state.subjectId === 'custom' ||
    (state.isEarlyChildhoodMode && state.subjectId === 'earlyChildhood') ||
    available.some(s => s.id === state.subjectId);

  if (state.subjectId && !isValid) {
    state.subjectId = state.isEarlyChildhoodMode ? 'earlyChildhood' : '';
  }

  // Clear standards if grade changed
  state.selectedStandardIds = [];
  state.selectedIndicatorIds = [];

  updateContextTag();
  scheduleSaveDraft();
}

// ============================================================
// Step 3: Subject Selection
// ============================================================
function renderWizardSubjectCards() {
  const container = document.getElementById('wizard-subject-grid') || document.querySelector('#step-panel-3 .grid') || document.querySelector('#step-panel-2 .grid');
  if (!container) return;

  const subjects = getSubjects(curriculumData, state.gradeId);
  container.innerHTML = '';

  // If early childhood mode, provide early childhood integrated experience card
  if (state.isEarlyChildhoodMode) {
    const isECActive = state.subjectId === 'earlyChildhood' || !state.subjectId;
    if (!state.subjectId) state.subjectId = 'earlyChildhood';
    const ecCard = document.createElement('button');
    ecCard.type = 'button';
    ecCard.className = `choice-card subject-card ${isECActive ? 'active' : ''}`;
    ecCard.dataset.subject = 'earlyChildhood';
    ecCard.innerHTML = `
      <div class="font-semibold text-slate-900">กิจกรรมจัดประสบการณ์ปฐมวัย</div>
      <div class="text-xs text-slate-500 mt-0.5">พัฒนาการ 4 ด้าน (มฐ.1-12)</div>
    `;
    ecCard.addEventListener('click', () => {
      selectSubject('earlyChildhood');
    });
    container.appendChild(ecCard);
  }

  subjects.forEach(sub => {
    const card = document.createElement('button');
    card.type = 'button';
    const isSelected = state.subjectId === sub.id;
    card.className = `choice-card subject-card ${isSelected ? 'active' : ''}`;
    card.dataset.subject = sub.id;

    let subDesc = sub.description || '';
    if (subDesc.length > 75) {
      subDesc = subDesc.substring(0, 75) + '...';
    }

    card.innerHTML = `
      <div class="flex items-center justify-between gap-1">
        <div class="font-semibold text-slate-900">${sub.name}</div>
        <span class="text-xs text-slate-400 font-normal">${sub.code}</span>
      </div>
      <div class="text-xs text-slate-500 mt-0.5 leading-relaxed">${subDesc || 'หลักสูตรแกนกลาง'}</div>
    `;

    card.addEventListener('click', () => {
      selectSubject(sub.id);
    });

    container.appendChild(card);
  });

  // Custom subject card
  const customCard = document.createElement('button');
  customCard.type = 'button';
  const isCustomSelected = state.subjectId === 'custom';
  customCard.className = `choice-card subject-card ${isCustomSelected ? 'active' : ''}`;
  customCard.dataset.subject = 'custom';
  customCard.innerHTML = `
    <div class="font-semibold text-slate-900">วิชาเพิ่มเติม / กำหนดเอง</div>
    <div class="text-xs text-slate-500 mt-0.5 leading-relaxed">ระบุวิชาอื่นๆ ตามหลักสูตรสถานศึกษา</div>
  `;
  customCard.addEventListener('click', () => {
    selectSubject('custom');
  });
  container.appendChild(customCard);
}

function selectSubject(subjectId: string) {
  state.subjectId = subjectId;

  const subjects = getSubjects(curriculumData, state.gradeId);
  const subjectObj = subjects.find(s => s.id === subjectId) || curriculumData?.subjects?.find(s => s.id === subjectId);
  if (subjectId === 'earlyChildhood') {
    state.subjectName = 'กิจกรรมจัดประสบการณ์ปฐมวัย';
  } else if (subjectId === 'custom') {
    if (!state.subjectName || state.subjectName === 'กิจกรรมจัดประสบการณ์ปฐมวัย') {
      state.subjectName = '';
    }
  } else if (subjectObj) {
    state.subjectName = subjectObj.name;
  }

  // Update subject name input fields
  document.querySelectorAll<HTMLInputElement>('.subject-name-input').forEach(input => {
    input.value = state.subjectName;
  });

  // Update custom subject input fields
  document.querySelectorAll<HTMLInputElement>('.custom-subject-input').forEach(input => {
    input.value = state.customSubject;
  });

  document.querySelectorAll('.subject-card').forEach(card => {
    const isSelected = (card as HTMLElement).dataset.subject === subjectId;
    card.classList.toggle('active', isSelected);
  });

  document.querySelectorAll('.subject-select').forEach(el => {
    (el as HTMLSelectElement).value = subjectId;
  });

  syncCustomSubjectDisplay();

  state.selectedStandardIds = [];
  state.selectedIndicatorIds = [];

  updateContextTag();
  scheduleSaveDraft();
}

function syncCustomSubjectDisplay() {
  const isCustom = state.subjectId === 'custom';
  const wizardContainer = document.getElementById('wizard-custom-subject-container');
  const aioContainer = document.getElementById('aio-custom-subject-container');
  if (wizardContainer) wizardContainer.classList.toggle('hidden', !isCustom);
  if (aioContainer) aioContainer.classList.toggle('hidden', !isCustom);
}

function syncCustomMethodDisplay() {
  const isCustom = state.teachingMethod === 'custom';
  const wizardContainer = document.getElementById('wizard-custom-method-container');
  const aioContainer = document.getElementById('aio-custom-method-container');
  if (wizardContainer) wizardContainer.classList.toggle('hidden', !isCustom);
  if (aioContainer) aioContainer.classList.toggle('hidden', !isCustom);
}

// ============================================================
// Step 5: Duration Selection
// ============================================================
function updateCustomDurationDisplay(prefix: 'wizard' | 'aio') {
  const isWizard = prefix === 'wizard';
  const hoursRow = document.getElementById(isWizard ? 'wizard-custom-hours-row' : 'aio-custom-hours-row');
  const minsRow = document.getElementById(isWizard ? 'wizard-custom-minutes-row' : 'aio-custom-minutes-row');
  const bothRow = document.getElementById(isWizard ? 'wizard-custom-both-row' : 'aio-custom-both-row');

  if (hoursRow) hoursRow.classList.toggle('hidden', state.durationCustomType !== 'hours');
  if (minsRow) minsRow.classList.toggle('hidden', state.durationCustomType !== 'minutes');
  if (bothRow) bothRow.classList.toggle('hidden', state.durationCustomType !== 'both');

  // sync radio checks
  document.querySelectorAll<HTMLInputElement>(`input[name="${prefix}-custom-type"]`).forEach(r => {
    r.checked = r.value === state.durationCustomType;
  });
}

function calculateAndApplyCustomDuration(_source: 'wizard' | 'aio') {
  if (state.durationOptionId !== 'custom') return;

  if (state.durationCustomType === 'hours') {
    const h = state.durationCustomHours || 1;
    state.durationMinutes = h * 60;
    state.durationText = `${h} ชั่วโมง`;
  } else if (state.durationCustomType === 'minutes') {
    const m = state.durationCustomMinutes || 50;
    state.durationMinutes = m;
    state.durationText = `${m} นาที`;
  } else {
    const h = state.durationCustomHours || 1;
    const m = state.durationCustomMinutes || 0;
    state.durationMinutes = (h * 60) + m;
    state.durationText = `${h} ชั่วโมง ${m} นาที`;
  }

  syncDurationControls();
  scheduleSaveDraft();
}

function selectDurationOption(durId: string) {
  state.durationOptionId = durId;

  if (durId === '1hour') {
    state.durationMinutes = 60;
    state.durationText = '1 ชั่วโมง';
  } else if (durId === '50min') {
    state.durationMinutes = 50;
    state.durationText = '50 นาที';
  } else if (durId === '2periods') {
    state.durationMinutes = 100;
    state.durationText = '1 ชั่วโมง 40 นาที';
  } else if (durId === '2hours') {
    state.durationMinutes = 120;
    state.durationText = '2 ชั่วโมง';
  } else if (durId === 'custom') {
    calculateAndApplyCustomDuration('wizard');
  }

  syncDurationControls();
  scheduleSaveDraft();
}

function syncDurationControls() {
  // Update wizard pills
  document.querySelectorAll('.duration-pill').forEach(btn => {
    const d = (btn as HTMLElement).dataset.duration;
    btn.classList.toggle('active', d === state.durationOptionId);
  });

  // Update wizard custom container
  const wizardCustomContainer = document.getElementById('wizard-custom-duration-container');
  if (wizardCustomContainer) {
    wizardCustomContainer.classList.toggle('hidden', state.durationOptionId !== 'custom');
  }
  updateCustomDurationDisplay('wizard');

  // Update aio select
  document.querySelectorAll('.duration-select').forEach(el => {
    (el as HTMLSelectElement).value = state.durationOptionId;
  });

  // Update aio custom container
  const aioCustomContainer = document.getElementById('aio-custom-duration-container');
  if (aioCustomContainer) {
    aioCustomContainer.classList.toggle('hidden', state.durationOptionId !== 'custom');
  }
  updateCustomDurationDisplay('aio');
}

function setupDurationStep() {
  document.querySelectorAll('.duration-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const dur = (btn as HTMLElement).dataset.duration || '1hour';
      selectDurationOption(dur);
    });
  });

  // Custom Duration Radio buttons in Wizard
  document.querySelectorAll('input[name="wizard-custom-type"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      state.durationCustomType = (e.target as HTMLInputElement).value as 'hours' | 'minutes' | 'both';
      updateCustomDurationDisplay('wizard');
      calculateAndApplyCustomDuration('wizard');
    });
  });

  // Inputs in wizard custom duration
  const wHours = document.getElementById('wizard-custom-hours') as HTMLInputElement;
  const wMins = document.getElementById('wizard-custom-minutes') as HTMLInputElement;
  const wBothH = document.getElementById('wizard-custom-both-hours') as HTMLInputElement;
  const wBothM = document.getElementById('wizard-custom-both-minutes') as HTMLInputElement;

  wHours?.addEventListener('input', () => {
    state.durationCustomHours = Math.max(1, parseInt(wHours.value) || 1);
    calculateAndApplyCustomDuration('wizard');
  });
  wMins?.addEventListener('input', () => {
    state.durationCustomMinutes = Math.max(5, parseInt(wMins.value) || 5);
    calculateAndApplyCustomDuration('wizard');
  });
  wBothH?.addEventListener('input', () => {
    state.durationCustomHours = Math.max(1, parseInt(wBothH.value) || 1);
    calculateAndApplyCustomDuration('wizard');
  });
  wBothM?.addEventListener('input', () => {
    state.durationCustomMinutes = Math.max(0, parseInt(wBothM.value) || 0);
    calculateAndApplyCustomDuration('wizard');
  });

  // Custom Duration Radio buttons in All-in-One
  document.querySelectorAll('input[name="aio-custom-type"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      state.durationCustomType = (e.target as HTMLInputElement).value as 'hours' | 'minutes' | 'both';
      updateCustomDurationDisplay('aio');
      calculateAndApplyCustomDuration('aio');
    });
  });

  const aioHours = document.getElementById('aio-custom-hours') as HTMLInputElement;
  const aioMins = document.getElementById('aio-custom-minutes') as HTMLInputElement;
  const aioBothH = document.getElementById('aio-custom-both-hours') as HTMLInputElement;
  const aioBothM = document.getElementById('aio-custom-both-minutes') as HTMLInputElement;

  aioHours?.addEventListener('input', () => {
    state.durationCustomHours = Math.max(1, parseInt(aioHours.value) || 1);
    calculateAndApplyCustomDuration('aio');
  });
  aioMins?.addEventListener('input', () => {
    state.durationCustomMinutes = Math.max(5, parseInt(aioMins.value) || 5);
    calculateAndApplyCustomDuration('aio');
  });
  aioBothH?.addEventListener('input', () => {
    state.durationCustomHours = Math.max(1, parseInt(aioBothH.value) || 1);
    calculateAndApplyCustomDuration('aio');
  });
  aioBothM?.addEventListener('input', () => {
    state.durationCustomMinutes = Math.max(0, parseInt(aioBothM.value) || 0);
    calculateAndApplyCustomDuration('aio');
  });
}

// ============================================================
// Step 5: Standards & Indicators (Cascading Logic)
// ============================================================
function renderStep5Standards() {
  const grid = document.getElementById('wizard-standards-grid');
  const ecContainer = document.getElementById('wizard-ec-domains');
  const summaryEl = document.getElementById('wizard-selected-indicators-summary');

  if (!grid) return;
  grid.innerHTML = '';

  // Early Childhood Experience Domains
  if (state.isEarlyChildhoodMode) {
    if (ecContainer) {
      ecContainer.classList.remove('hidden');
      const list = ecContainer.querySelector('.ec-domains-list')!;
      list.innerHTML = '';
      const domains = getEarlyChildhoodDomains(curriculumData);
      domains.forEach(d => {
        const item = document.createElement('label');
        item.className = 'choice-card flex items-start gap-3 cursor-pointer';
        const isChecked = state.selectedECDomains.includes(d.id);
        if (isChecked) item.classList.add('active');
        item.innerHTML = `
          <input type="checkbox" class="mt-1 w-4 h-4 rounded text-blue-600" value="${d.id}" ${isChecked ? 'checked' : ''}>
          <div>
            <div class="font-bold text-slate-900">${d.name}</div>
            <div class="text-xs text-slate-500 mt-1">${d.experiences.join(' · ')}</div>
          </div>
        `;
        const cb = item.querySelector('input')!;
        cb.addEventListener('change', () => {
          if (cb.checked) {
            if (!state.selectedECDomains.includes(d.id)) state.selectedECDomains.push(d.id);
            item.classList.add('active');
          } else {
            state.selectedECDomains = state.selectedECDomains.filter(id => id !== d.id);
            item.classList.remove('active');
          }
          scheduleSaveDraft();
        });
        list.appendChild(item);
      });
    }
  } else {
    if (ecContainer) ecContainer.classList.add('hidden');
  }

  if (!state.subjectId || !state.gradeId) {
    grid.innerHTML = `
      <div class="col-span-2 text-center py-8 white-card">
        <p class="text-slate-400 text-sm">กรุณาเลือกระดับชั้นและวิชาในขั้นตอนก่อนหน้าก่อน</p>
        <button id="btn-step5-back-to-grade" type="button" class="btn-outline-blue text-xs mt-3">กลับไปเลือกระดับชั้น</button>
      </div>
    `;
    grid.querySelector('#btn-step5-back-to-grade')?.addEventListener('click', () => {
      showStep(2);
    });
    return;
  }

  const standards = getAvailableStandards(curriculumData, state.subjectId, state.gradeId);
  if (!standards || standards.length === 0) {
    grid.innerHTML = `
      <div class="col-span-2 text-center py-8 white-card">
        <p class="text-slate-600 text-sm font-medium">ไม่มีตัวชี้วัดในระดับชั้นนี้</p>
        <p class="text-slate-400 text-xs mt-1">(สามารถข้ามขั้นตอนนี้เพื่อให้ระบบ AI สังเคราะห์เนื้อหาและเป้าหมายที่เหมาะสมให้อัตโนมัติ)</p>
      </div>
    `;
    return;
  }

  standards.forEach(std => {
    const card = document.createElement('div');
    card.className = 'choice-card';

    // Count how many indicators from this standard are selected
    const indicators = getIndicatorsByGrade(std, state.gradeId);
    const selectedCount = indicators.filter(ind => state.selectedIndicatorIds.includes(ind.id)).length;
    const hasSelection = selectedCount > 0;

    if (hasSelection) card.classList.add('active');

    const strandInfo = std.strand ? `<div class="text-xs text-blue-600 font-medium mb-1">${std.strand}</div>` : '';
    const stdTitle = std.title || std.label || '';

    card.innerHTML = `
      <div class="flex items-start justify-between gap-2 mb-1.5">
        <span class="font-bold text-slate-900 text-base">${std.code}</span>
        ${hasSelection ? `<span class="text-xs bg-blue-100 text-blue-800 font-semibold px-2 py-0.5 rounded-full">เลือกแล้ว ${selectedCount} ข้อ</span>` : '<span class="text-xs text-slate-400">คลิกเพื่อเลือก</span>'}
      </div>
      ${strandInfo}
      <p class="text-xs text-slate-600 line-clamp-3 leading-relaxed">${stdTitle}</p>
    `;

    card.addEventListener('click', () => {
      openIndicatorModal(std);
    });

    grid.appendChild(card);
  });

  // Update summary line
  if (summaryEl) {
    const count = state.selectedIndicatorIds.length;
    summaryEl.textContent = count > 0 ? `เลือกตัวชี้วัดแล้วทั้งหมด ${count} ข้อ` : 'ยังไม่ได้เลือกตัวชี้วัด (คลิกที่การ์ดมาตรฐานด้านบนเพื่อเลือกตัวชี้วัด)';
  }
}

// Open Indicator Selection Modal
function openIndicatorModal(standard: Standard) {
  activeStandardForModal = standard;
  const modal = document.getElementById('indicator-modal-overlay');
  const title = document.getElementById('ind-modal-title');
  const subtitle = document.getElementById('ind-modal-subtitle');
  const list = document.getElementById('ind-modal-list');

  if (!modal || !list) return;

  const indicators = getIndicatorsByGrade(standard, state.gradeId);
  const gradeLevels = getGradeLevels(curriculumData);
  const gradeObj = gradeLevels.find(g => g.id === state.gradeId);
  const gradeLabel = gradeObj ? gradeObj.code : (state.gradeId || '');

  const stdTitle = standard.title || standard.label || '';
  if (title) title.textContent = `ตัวชี้วัด ${standard.code}: ${stdTitle}`;
  if (subtitle) subtitle.textContent = `เลือกตัวชี้วัดสำหรับชั้น ${gradeLabel} ได้หลายข้อ แล้วกดเรียบร้อย`;

  list.innerHTML = '';

  if (!indicators || indicators.length === 0) {
    list.innerHTML = '<p class="text-slate-400 text-sm italic py-4 text-center">ไม่มีตัวชี้วัดในระดับชั้นนี้</p>';
  } else {
    indicators.forEach(ind => {
      const isChecked = state.selectedIndicatorIds.includes(ind.id);
      const row = document.createElement('label');
      row.className = `choice-card flex items-start gap-3 cursor-pointer py-3 ${isChecked ? 'active' : ''}`;
      row.innerHTML = `
        <input type="checkbox" class="mt-1 w-4 h-4 rounded text-blue-600 cursor-pointer" value="${ind.id}" ${isChecked ? 'checked' : ''}>
        <div class="flex-1">
          <div class="font-bold text-slate-900 text-sm">${ind.code}</div>
          <div class="text-xs text-slate-600 mt-0.5 leading-relaxed">${ind.text}</div>
        </div>
      `;

      const cb = row.querySelector('input')!;
      cb.addEventListener('change', () => {
        row.classList.toggle('active', cb.checked);
        if (cb.checked) {
          if (!state.selectedIndicatorIds.includes(ind.id)) {
            state.selectedIndicatorIds.push(ind.id);
          }
          if (!state.selectedStandardIds.includes(standard.id)) {
            state.selectedStandardIds.push(standard.id);
          }
        } else {
          state.selectedIndicatorIds = state.selectedIndicatorIds.filter(id => id !== ind.id);
          const remaining = indicators.some(i => state.selectedIndicatorIds.includes(i.id));
          if (!remaining) {
            state.selectedStandardIds = state.selectedStandardIds.filter(id => id !== standard.id);
          }
        }
        scheduleSaveDraft();
      });

      list.appendChild(row);
    });
  }

  modal.style.display = 'flex';
  modal.classList.remove('hidden');
}

function setupIndicatorModalListeners() {
  const modal = document.getElementById('indicator-modal-overlay');
  const closeBtn = document.getElementById('ind-modal-close');
  const doneBtn = document.getElementById('ind-modal-done');
  const clearBtn = document.getElementById('ind-modal-clear');

  const closeModal = () => {
    if (modal) {
      modal.style.display = 'none';
      modal.classList.add('hidden');
    }
    renderStep5Standards();
    renderAllInOneStandards();
  };

  closeBtn?.addEventListener('click', closeModal);
  doneBtn?.addEventListener('click', closeModal);
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  clearBtn?.addEventListener('click', () => {
    if (!activeStandardForModal) return;
    const indicators = getIndicatorsByGrade(activeStandardForModal, state.gradeId);
    const indIds = indicators.map(i => i.id);
    state.selectedIndicatorIds = state.selectedIndicatorIds.filter(id => !indIds.includes(id));
    state.selectedStandardIds = state.selectedStandardIds.filter(id => id !== activeStandardForModal!.id);

    // Uncheck in modal
    document.querySelectorAll('#ind-modal-list input[type="checkbox"]').forEach(cb => {
      (cb as HTMLInputElement).checked = false;
      cb.closest('.choice-card')?.classList.remove('active');
    });

    renderStep5Standards();
    renderAllInOneStandards();
    scheduleSaveDraft();
    showToast('ยกเลิกตัวชี้วัดของมาตรฐานนี้แล้ว', 'info');
  });
}

// ============================================================
// Step 8: Teaching Methods
// ============================================================
function setupTeachingMethodsStep() {
  const grid = document.getElementById('wizard-methods-grid');
  if (!grid) return;

  grid.innerHTML = '';
  TEACHING_METHODS.forEach(method => {
    const card = document.createElement('div');
    const isSelected = state.teachingMethod === method.id;
    card.className = `choice-card method-choice-card ${isSelected ? 'active' : ''}`;
    card.dataset.method = method.id;

    card.innerHTML = `
      <div class="font-bold text-slate-900 text-sm">${method.label}</div>
    `;

    card.addEventListener('click', () => {
      state.teachingMethod = method.id;
      document.querySelectorAll('.method-choice-card').forEach(c => {
        c.classList.toggle('active', (c as HTMLElement).dataset.method === method.id);
      });

      syncCustomMethodDisplay();

      document.querySelectorAll('.teaching-method-select').forEach(el => {
        (el as HTMLSelectElement).value = method.id;
      });

      scheduleSaveDraft();
    });

    grid.appendChild(card);
  });
}

// ============================================================
// Step 10: Summary & Ready Step
// ============================================================
function renderSummaryStep() {
  const fullGrade = formatFullGradeName(state.gradeId, curriculumData);
  const gradeLabel = fullGrade || (state.gradeId || 'ยังไม่ระบุ');

  const subjects = getSubjects(curriculumData, state.gradeId);
  const subjectObj = subjects.find(s => s.id === state.subjectId) || curriculumData?.subjects?.find(s => s.id === state.subjectId);
  let subjectLabel = state.subjectName?.trim() || '';
  if (!subjectLabel) {
    if (state.subjectId === 'earlyChildhood') {
      subjectLabel = 'กิจกรรมจัดประสบการณ์ปฐมวัย';
    } else if (state.subjectId === 'custom') {
      subjectLabel = state.customSubject?.trim() || 'วิชาเพิ่มเติม / กำหนดเอง';
    } else if (subjectObj) {
      subjectLabel = subjectObj.name;
    } else {
      subjectLabel = state.subjectId || 'ยังไม่ระบุ';
    }
  } else if (state.subjectId === 'custom' && state.customSubject?.trim()) {
    subjectLabel = `${state.subjectName.trim()} (${state.customSubject.trim()})`;
  }

  const gradeEl = document.getElementById('summary-grade');
  const subjectEl = document.getElementById('summary-subject');
  const topicEl = document.getElementById('summary-topic');
  const durationEl = document.getElementById('summary-duration');
  const indicatorsEl = document.getElementById('summary-indicators');
  const methodEl = document.getElementById('summary-method');
  const schoolTeacherEl = document.getElementById('summary-school-teacher');

  if (gradeEl) gradeEl.textContent = gradeLabel;
  if (subjectEl) subjectEl.textContent = subjectLabel;
  if (topicEl) topicEl.textContent = state.topic || '(ยังไม่ได้ระบุเรื่องที่สอน)';
  if (durationEl) durationEl.textContent = state.durationText || `${state.durationMinutes} นาที`;

  if (indicatorsEl) {
    const count = state.selectedIndicatorIds.length;
    indicatorsEl.textContent = count > 0 ? `เลือกแล้ว ${count} ตัวชี้วัด` : 'ให้ AI สังเคราะห์ให้เหมาะสม';
  }

  if (methodEl) {
    const methodObj = TEACHING_METHODS.find(m => m.id === state.teachingMethod);
    methodEl.textContent = state.teachingMethod === 'custom' ? (state.customTeachingMethod || 'กำหนดเอง') : (methodObj?.label || state.teachingMethod);
  }

  if (schoolTeacherEl) {
    const schoolPart = state.school ? state.school : '-';
    const teacherPart = state.teacherName ? state.teacherName : '-';
    schoolTeacherEl.textContent = `${schoolPart} / ${teacherPart}`;
  }
}

// ============================================================
// Build Lesson Plan Input
// ============================================================
function getSelectedIndicatorObjects(): Indicator[] {
  if (!state.subjectId || !state.gradeId) return [];
  const standards = getAvailableStandards(curriculumData, state.subjectId, state.gradeId);
  const allIndicators: Indicator[] = [];
  for (const std of standards) {
    const inds = getIndicatorsByGrade(std, state.gradeId);
    allIndicators.push(...inds);
  }
  return allIndicators.filter(ind => state.selectedIndicatorIds.includes(ind.id));
}

function getSelectedStandardsObjects(): { code: string; title: string; strand?: string }[] {
  if (!state.subjectId || !state.gradeId) return [];
  const standards = getAvailableStandards(curriculumData, state.subjectId, state.gradeId);
  const result: { code: string; title: string; strand?: string }[] = [];
  const seen = new Set<string>();

  if (state.selectedIndicatorIds.length > 0) {
    for (const std of standards) {
      const inds = getIndicatorsByGrade(std, state.gradeId);
      const hasSelected = inds.some(ind => state.selectedIndicatorIds.includes(ind.id));
      if (hasSelected && !seen.has(std.code)) {
        seen.add(std.code);
        result.push({ code: std.code, title: std.title, strand: std.strand });
      }
    }
  }

  // ถ้ายังไม่ได้เลือกตัวชี้วัดระบุ ให้ดึงมาตรฐานทั้งหมดของวิชาและระดับชั้นนี้
  if (result.length === 0 && standards.length > 0) {
    for (const std of standards) {
      if (!seen.has(std.code)) {
        seen.add(std.code);
        result.push({ code: std.code, title: std.title, strand: std.strand });
      }
    }
  }

  return result;
}

function buildInputFromState(): LessonPlanInput {
  const fullGrade = formatFullGradeName(state.gradeId, curriculumData);
  const gradeLabel = fullGrade || state.gradeId;

  const subjects = getSubjects(curriculumData, state.gradeId);
  const subjectObj = subjects.find(s => s.id === state.subjectId) || curriculumData?.subjects?.find(s => s.id === state.subjectId);
  let defaultSubjectLabel = state.subjectId;
  if (state.subjectId === 'earlyChildhood') {
    defaultSubjectLabel = 'กิจกรรมจัดประสบการณ์ปฐมวัย';
  } else if (state.subjectId === 'custom') {
    defaultSubjectLabel = state.customSubject?.trim() || 'วิชาเพิ่มเติม / กำหนดเอง';
  } else if (subjectObj) {
    defaultSubjectLabel = subjectObj.name;
  }
  const subjectLabel = (state.subjectId === 'custom' && state.customSubject?.trim())
    ? state.customSubject.trim()
    : defaultSubjectLabel;

  const method = TEACHING_METHODS.find(m => m.id === state.teachingMethod);
  const methodLabel = state.teachingMethod === 'custom'
    ? (state.customTeachingMethod || 'กำหนดเอง')
    : method?.label || '';

  const compLabels = state.competencies.map(id => {
    const comp = COMPETENCIES.find(c => c.id === id);
    return comp?.label || id;
  });

  const dirLabels = state.planDirections.map(id => {
    const dir = PLAN_DIRECTIONS.find(d => d.id === id);
    return dir?.label || id;
  });

  const ecDomains = state.selectedECDomains.map(id => {
    const domain = getEarlyChildhoodDomains(curriculumData).find(d => d.id === id);
    return domain?.name || domain?.label || id;
  });

  return {
    planName: state.planName || `แผนการจัดการเรียนรู้ เรื่อง ${state.topic || subjectLabel}`,
    gradeLevel: gradeLabel,
    subject: subjectLabel,
    subjectName: state.subjectName,
    unit: state.unit,
    topic: state.topic,
    durationMinutes: state.durationMinutes,
    durationText: state.durationText || (state.durationMinutes ? `${state.durationMinutes} นาที` : '1 ชั่วโมง'),
    selectedIndicators: getSelectedIndicatorObjects(),
    selectedStandards: getSelectedStandardsObjects(),
    objectiveMode: state.objectiveMode,
    kpaK: state.kpaK,
    kpaP: state.kpaP,
    kpaA: state.kpaA,
    customObjective: state.customObjective,
    teachingMethod: methodLabel,
    competencies: compLabels,
    classroomAtmosphere: state.classroomAtmosphere,
    planDirections: dirLabels,
    additionalNotes: state.additionalNotes,
    isEarlyChildhood: state.isEarlyChildhoodMode,
    earlyChildhoodDomains: ecDomains,
    school: state.school,
    semester: state.semester,
    date: state.date,
    month: state.month,
    academicYear: state.academicYear,
    buddhistYear: state.buddhistYear,
    teacherName: state.teacherName,
    teacherPosition: state.teacherPosition,
  };
}

// ============================================================
// Generate Lesson Plan
// ============================================================
async function generatePlan() {
  if (!state.topic) {
    const topicEl = (document.getElementById('wizard-topic') as HTMLInputElement) ||
                    (document.getElementById('aio-topic') as HTMLInputElement) ||
                    (document.querySelector('.topic-input') as HTMLInputElement);
    if (topicEl && topicEl.value.trim()) {
      state.topic = topicEl.value.trim();
    }
  }

  if (!state.topic) {
    showToast('กรุณาระบุเรื่องที่ต้องการสอนก่อนเริ่มสร้างแผน', 'error');
    if (state.view === 'allinone') {
      const el = document.getElementById('aio-topic') as HTMLInputElement;
      el?.focus();
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      showStep(1);
    }
    return;
  }

  showLoading('ระบบกำลังจัดสรรแผนการจัดการเรียนรู้ตามมาตรฐาน วPA...');

  try {
    const input = buildInputFromState();
    const systemInstruction = buildSystemInstruction();
    const prompt = buildLessonPlanPrompt(input);
    const result = await callGemini(prompt, systemInstruction, 8192, (attempt, maxRetries, waitMs) => {
      const secs = Math.round(waitMs / 1000);
      showLoading(`โควต้า API สูง กำลังลองใหม่ครั้งที่ ${attempt}/${maxRetries} (รอ ${secs} วินาที)...`);
    });
    state.generatedPlan = result.text;
    state.resolvedModel = result.resolvedModel;
    state.lessonPlanData = parseLessonPlanResponse(result.text, input);
    renderPreview();
    scrollToPreview();
    scheduleSaveDraft();
    showToast('สร้างแผนการจัดการเรียนรู้สำเร็จเรียบร้อย', 'success');
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการสร้างแผน';
    showToast(msg, 'error');
  } finally {
    hideLoading();
  }
}

function generateInstantPlan() {
  if (!state.topic) {
    const topicEl = (document.getElementById('wizard-topic') as HTMLInputElement) ||
                    (document.getElementById('aio-topic') as HTMLInputElement) ||
                    (document.querySelector('.topic-input') as HTMLInputElement);
    if (topicEl && topicEl.value.trim()) {
      state.topic = topicEl.value.trim();
    }
  }

  if (!state.topic) {
    showToast('กรุณาระบุเรื่องที่ต้องการสอนก่อนเริ่มสร้างแผน', 'error');
    if (state.view === 'allinone') {
      const el = document.getElementById('aio-topic') as HTMLInputElement;
      el?.focus();
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      showStep(1);
    }
    return;
  }

  const input = buildInputFromState();
  const planData = generateStandardLessonPlan(input);
  state.lessonPlanData = planData;
  state.generatedPlan = JSON.stringify(planData);
  state.resolvedModel = 'โครงร่างแผนมาตรฐาน (Instant Engine)';
  renderPreview();
  scrollToPreview();
  scheduleSaveDraft();
  showToast('สร้างโครงร่างแผนการจัดการเรียนรู้มาตรฐานเรียบร้อย', 'success');
}

// ============================================================
// AI K-P-A Helper
// ============================================================
function parseKPAResult(text: string): { k: string; p: string; a: string } {
  let k = '';
  let p = '';
  let a = '';

  // 1. ลองค้นหาและแยก JSON Block
  const jsonMatch = text.match(/\{[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const formatVal = (v: any): string => {
        if (!v) return '';
        if (Array.isArray(v)) {
          return v.map((item, idx) => {
            const str = typeof item === 'string' ? item.trim() : String(item).trim();
            return /^\d+[\.\)]\s*/.test(str) ? str : `${idx + 1}. ${str}`;
          }).join('\n');
        }
        return String(v).trim();
      };

      k = formatVal(parsed.k || parsed.K || parsed.knowledge || parsed['ด้านความรู้']);
      p = formatVal(parsed.p || parsed.P || parsed.practice || parsed.process || parsed['ด้านทักษะ'] || parsed['ด้านทักษะกระบวนการ']);
      a = formatVal(parsed.a || parsed.A || parsed.attitude || parsed['ด้านเจตคติ'] || parsed['ด้านคุณลักษณะ'] || parsed['ด้านคุณลักษณะอันพึงประสงค์']);
    } catch {
      // JSON parse error, fallback to line parser
    }
  }

  // 2. หากยังได้ไม่ครบ ให้สกัดตามบรรทัด (Line-by-line section parser)
  if (!k || !p || !a) {
    const lines = text.split('\n');
    let currentSection: 'k' | 'p' | 'a' | null = null;
    const kLines: string[] = [];
    const pLines: string[] = [];
    const aLines: string[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      if (/^(?:[\*\#\-\s]*)(?:K\b|ด้านความรู้|Knowledge)/i.test(line)) {
        currentSection = 'k';
        const stripped = line.replace(/^(?:[\*\#\-\s]*)(?:K\b|ด้านความรู้|Knowledge)(?:\s*\([Kk]\))?[\s\*\:：\-]*/i, '').trim();
        if (stripped) kLines.push(stripped);
        continue;
      }
      if (/^(?:[\*\#\-\s]*)(?:P\b|ด้านทักษะ|Process|Practice)/i.test(line)) {
        currentSection = 'p';
        const stripped = line.replace(/^(?:[\*\#\-\s]*)(?:P\b|ด้านทักษะ(?:กระบวนการ)?|Process|Practice)(?:\s*\([Pp]\))?[\s\*\:：\-]*/i, '').trim();
        if (stripped) pLines.push(stripped);
        continue;
      }
      if (/^(?:[\*\#\-\s]*)(?:A\b|ด้านเจตคติ|ด้านคุณลักษณะ|Attitude)/i.test(line)) {
        currentSection = 'a';
        const stripped = line.replace(/^(?:[\*\#\-\s]*)(?:A\b|ด้านเจตคติ|ด้านคุณลักษณะ(?:อันพึงประสงค์)?|Attitude)(?:\s*\([Aa]\))?[\s\*\:：\-]*/i, '').trim();
        if (stripped) aLines.push(stripped);
        continue;
      }

      if (currentSection === 'k') kLines.push(line);
      else if (currentSection === 'p') pLines.push(line);
      else if (currentSection === 'a') aLines.push(line);
    }

    if (!k && kLines.length > 0) k = kLines.join('\n');
    if (!p && pLines.length > 0) p = pLines.join('\n');
    if (!a && aLines.length > 0) a = aLines.join('\n');
  }

  const cleanText = (s: string) => {
    return s
      .replace(/^[`"'\s]+|[`"'\s]+$/g, '')
      .replace(/^(?:\*\*)?(?:ด้านความรู้|ด้านทักษะ(?:กระบวนการ)?|ด้านเจตคติ|ด้านคุณลักษณะ(?:อันพึงประสงค์)?|Knowledge|Practice|Process|Attitude)(?:\s*\([KPAkpa]\))?(?:\*\*)?[\s:：\-]*/i, '')
      .replace(/^\*\*(.*?)\*\*$/gm, '$1')
      .trim();
  };

  return {
    k: cleanText(k),
    p: cleanText(p),
    a: cleanText(a)
  };
}

async function generateKPA() {
  // 1. ตรวจสอบเงื่อนไขจำเป็น (Required):
  // (1) ระดับชั้นที่สอน
  if (!state.gradeId) {
    showToast('กรุณาเลือกระดับชั้นที่สอนก่อน จึงจะสามารถให้ระบบช่วยร่าง K-P-A ได้', 'error');
    if (state.view === 'wizard') showStep(1);
    return;
  }

  // (2) กลุ่มสาระวิชาและชื่อรายวิชา
  const subjects = getSubjects(curriculumData, state.gradeId);
  const subjectObj = subjects.find(s => s.id === state.subjectId) || curriculumData?.subjects?.find(s => s.id === state.subjectId);

  let subjectGroup = '';
  if (state.subjectId === 'earlyChildhood') {
    subjectGroup = 'กิจกรรมจัดประสบการณ์ปฐมวัย';
  } else if (state.subjectId === 'custom') {
    subjectGroup = state.customSubject?.trim() || 'วิชาเพิ่มเติม / กำหนดเอง';
  } else if (subjectObj) {
    subjectGroup = subjectObj.name;
  }

  const subjectName = state.subjectName?.trim() || (state.subjectId === 'custom' ? state.customSubject?.trim() : subjectGroup);

  if (!state.subjectId || !subjectName) {
    showToast('กรุณาเลือกกลุ่มสาระวิชาและระบุชื่อรายวิชาก่อน จึงจะสามารถให้ระบบช่วยร่าง K-P-A ได้', 'error');
    if (state.view === 'wizard') showStep(2);
    return;
  }

  // (3) มาตรฐานตัวชี้วัด
  const selectedIndicators = getSelectedIndicatorObjects();
  const selectedStandards = getSelectedStandardsObjects();
  const hasIndicatorsOrStandards = state.isEarlyChildhoodMode
    ? (state.selectedECDomains.length > 0 || selectedIndicators.length > 0 || selectedStandards.length > 0)
    : (selectedIndicators.length > 0 || selectedStandards.length > 0);

  if (!hasIndicatorsOrStandards) {
    showToast('กรุณาเลือกมาตรฐานและตัวชี้วัดการเรียนรู้ก่อน จึงจะสามารถให้ระบบช่วยร่าง K-P-A ได้', 'error');
    if (state.view === 'wizard') showStep(5);
    return;
  }

  showLoading('ระบบกำลังวิเคราะห์มาตรฐานและตัวชี้วัด เพื่อช่วยร่าง K-P-A...');

  try {
    const fullGrade = formatFullGradeName(state.gradeId, curriculumData);
    const gradeLabel = fullGrade || state.gradeId;

    const ecDomainLabels = state.selectedECDomains.map(id => {
      const domain = getEarlyChildhoodDomains(curriculumData).find(d => d.id === id);
      return domain?.name || domain?.label || id;
    });

    const prompt = buildKPAPrompt({
      gradeLevel: gradeLabel,
      subjectGroup,
      subjectName,
      standards: selectedStandards,
      indicators: selectedIndicators,
      ecDomains: ecDomainLabels,
      topic: state.topic?.trim() || undefined,
      unit: state.unit?.trim() || undefined,
      planName: state.planName?.trim() || undefined,
    });

    const result = await callGemini(
      prompt,
      'คุณคือผู้เชี่ยวชาญหลักสูตรและการเขียนแผนการสอน ตอบเป็น JSON ภาษาไทยทางการ ถูกต้องตามหลักวิชาการ',
      1024,
      (attempt, maxRetries, waitMs) => {
        const secs = Math.round(waitMs / 1000);
        showLoading(`โควต้า API สูง กำลังลองใหม่ครั้งที่ ${attempt}/${maxRetries} (รอ ${secs} วินาที)...`);
      }
    );

    const parsed = parseKPAResult(result.text);

    if (parsed.k) state.kpaK = parsed.k;
    if (parsed.p) state.kpaP = parsed.p;
    if (parsed.a) state.kpaA = parsed.a;

    syncKPAToForm();
    scheduleSaveDraft();
    showToast('ระบบได้ร่าง K-P-A และแยกใส่ช่อง K, P และ A เรียบร้อยแล้ว', 'success');
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการร่าง K-P-A';
    showToast(msg, 'error');
  } finally {
    hideLoading();
  }
}

function syncKPAToForm() {
  document.querySelectorAll<HTMLTextAreaElement>('.kpa-k').forEach(el => {
    el.value = state.kpaK;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  document.querySelectorAll<HTMLTextAreaElement>('.kpa-p').forEach(el => {
    el.value = state.kpaP;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  document.querySelectorAll<HTMLTextAreaElement>('.kpa-a').forEach(el => {
    el.value = state.kpaA;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  updateContextTag();
  scheduleSaveDraft();
}

// ============================================================
// Refinement
// ============================================================
async function refinePlan() {
  const input = document.getElementById('refine-input') as HTMLInputElement;
  if (!input || !input.value.trim()) {
    showToast('กรุณาระบุคำสั่งปรับปรุงแผนที่ต้องการ', 'error');
    return;
  }

  showLoading('ระบบกำลังปรับปรุงแผนการสอนตามคำสั่ง...');

  try {
    const systemInstruction = buildSystemInstruction();
    const retryCallback = (attempt: number, maxRetries: number, waitMs: number) => {
      const secs = Math.round(waitMs / 1000);
      showLoading(`โควต้า API สูง กำลังลองใหม่ครั้งที่ ${attempt}/${maxRetries} (รอ ${secs} วินาที)...`);
    };
    const result = await refineWithGemini(state.generatedPlan, input.value.trim(), systemInstruction, retryCallback);
    state.generatedPlan = result.text;
    state.resolvedModel = result.resolvedModel;
    const planInput = buildInputFromState();
    state.lessonPlanData = parseLessonPlanResponse(result.text, planInput);
    renderPreview();
    input.value = '';
    scheduleSaveDraft();
    showToast('ปรับปรุงแผนการจัดการเรียนรู้เรียบร้อยแล้ว', 'success');
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการปรับปรุง';
    showToast(msg, 'error');
  } finally {
    hideLoading();
  }
}

// ============================================================
// HTML Helper
// ============================================================
function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================
// Preview Rendering (Strict 11-Section Template)
// ============================================================
function formatActivitiesPreviewHtml(text: string): string {
  if (!text) return '<div style="padding-left: 24pt;">-</div>';
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const stageRegex = /^(?:(?:\d+[\.\)]\s*)?ขั้น(?:นำ|จัดกิจกรรม|กิจกรรม|สอน|สรุป|ปฏิบัติ|ประเมิน|สร้างความสนใจ|สำรวจ|อธิบาย|ขยายความ|สะท้อนคิด|การเรียนรู้|ฝึกทักษะ)|ขั้นที่\s*\d+|ช่วงที่\s*\d+)/i;

  return lines.map(line => {
    const cleanLine = escapeHtml(line.replace(/^[\t\s]+/, ''));
    if (stageRegex.test(cleanLine)) {
      return `<div style="padding-left: 24pt; font-weight: bold; margin-top: 8px; margin-bottom: 2px;">${cleanLine}</div>`;
    } else {
      return `<div style="padding-left: 48pt; margin-top: 2px; margin-bottom: 2px;">${cleanLine}</div>`;
    }
  }).join('');
}

function renderPreview() {
  const previewSection = document.getElementById('preview-section')!;
  const previewContent = document.getElementById('preview-content')!;

  if (!state.generatedPlan && !state.lessonPlanData) {
    previewSection.style.display = 'none';
    previewSection.classList.add('hidden');
    return;
  }

  // Ensure lessonPlanData exists
  if (!state.lessonPlanData && state.generatedPlan) {
    state.lessonPlanData = parseLessonPlanResponse(state.generatedPlan, buildInputFromState());
  }
  const data = state.lessonPlanData!;

  previewSection.style.display = 'block';
  previewSection.classList.remove('hidden');



  const teacherName = data.teacher_name || state.teacherName || '……………………………………………………';
  const teacherPos = data.teacher_position || state.teacherPosition || 'ครูผู้ช่วย / ครู';
  const hoursDisplay = data.hours_text.includes('ชั่วโมง') || data.hours_text.includes('นาที')
    ? data.hours_text
    : `${data.hours_text} ชั่วโมง`;
  const signDateStr = (data.date && data.month && data.buddhist_year)
    ? `วันที่ ${escapeHtml(data.date)} / ${escapeHtml(data.month)} / ${escapeHtml(data.buddhist_year)}`
    : 'วันที่ ............ / ............ / ............';

  const rows = data.evaluation_rows && data.evaluation_rows.length > 0
    ? data.evaluation_rows
    : [
        { dimension: 'ด้านความรู้ (K)', objective: data.k_objective || 'ผู้เรียนมีความรู้ความเข้าใจตามตัวชี้วัด', method: 'ตรวจแบบฝึกหัด / สังเกตการตอบคำถาม', tool: 'แบบประเมินใบงาน', criteria: 'ผ่านเกณฑ์ร้อยละ 70 ขึ้นไป' },
        { dimension: 'ด้านทักษะและกระบวนการ (P)', objective: data.p_objective || 'ผู้เรียนสามารถปฏิบัติกิจกรรมได้ตามกระบวนการ', method: 'สังเกตพฤติกรรมการปฏิบัติงานกลุ่ม/เดี่ยว', tool: 'แบบประเมินทักษะกระบวนการ', criteria: 'ผ่านเกณฑ์ระดับคุณภาพ 2 ขึ้นไป' },
        { dimension: 'ด้านคุณลักษณะอันพึงประสงค์ (A)', objective: data.a_objective || 'ผู้เรียนมีวินัย ใฝ่เรียนรู้ มุ่งมั่นในการทำงาน', method: 'สังเกตพฤติกรรมในชั้นเรียน', tool: 'แบบสังเกตคุณลักษณะอันพึงประสงค์', criteria: 'ผ่านเกณฑ์ระดับคุณภาพ 2 ขึ้นไป' },
      ];

  let evalTableRowsHtml = '';
  rows.forEach((r, idx) => {
    evalTableRowsHtml += `
      <tr data-row="${idx}">
        <td class="eval-cell" contenteditable="true" data-field="objective" style="border: 1px solid #000; padding: 6px 8px; vertical-align: top;">
          <strong>${escapeHtml(r.dimension)}</strong><br/>${escapeHtml(r.objective)}
        </td>
        <td class="eval-cell" contenteditable="true" data-field="method" style="border: 1px solid #000; padding: 6px 8px; vertical-align: top;">
          ${escapeHtml(r.method)}
        </td>
        <td class="eval-cell" contenteditable="true" data-field="tool" style="border: 1px solid #000; padding: 6px 8px; vertical-align: top;">
          ${escapeHtml(r.tool)}
        </td>
        <td class="eval-cell" contenteditable="true" data-field="criteria" style="border: 1px solid #000; padding: 6px 8px; vertical-align: top;">
          ${escapeHtml(r.criteria)}
        </td>
      </tr>
    `;
  });

  const h = getHeaderDisplayValues(data);

  const html = `
    <div class="a4-sheet" style="font-family: 'TH SarabunPSK', 'TH Sarabun PSK', sans-serif !important; font-size: 16pt; line-height: 1.5; color: #000000;">
      <!-- ส่วนหัวแผน: คำว่า "แผนจัดการเรียนรู้" และ ตาราง 5 แถว 2 คอลัมน์ ไร้ขอบ -->
      <div class="plan-header pb-4 mb-4" style="border-bottom: 2px dashed #94a3b8;">
        <h1 class="text-2xl font-bold mb-3 text-center" style="font-size: 20pt; text-align: center; color: #000000; font-family: 'TH SarabunPSK', 'TH Sarabun PSK', sans-serif;">
          แผนจัดการเรียนรู้
        </h1>
        <table style="width: 100%; border-collapse: collapse; border: none; font-family: 'TH SarabunPSK', 'TH Sarabun PSK', sans-serif; font-size: 16pt; color: #000000; margin-bottom: 6px;">
          <tbody>
            <tr>
              <td style="border: none; padding: 2px 0; text-align: left; font-weight: bold; width: 60%; vertical-align: top;">
                <span contenteditable="true" data-header="course_name">${escapeHtml(h.courseText)}</span>
              </td>
              <td style="border: none; padding: 2px 0; text-align: right; font-weight: bold; width: 40%; vertical-align: top;">
                <span contenteditable="true" data-header="grade">${escapeHtml(h.gradeText)}</span>
              </td>
            </tr>
            <tr>
              <td style="border: none; padding: 2px 0; text-align: left; font-weight: bold; width: 60%; vertical-align: top;">
                <span contenteditable="true" data-header="unit">${escapeHtml(h.unitText)}</span>
              </td>
              <td style="border: none; padding: 2px 0; text-align: right; width: 40%; vertical-align: top;">
                &nbsp;
              </td>
            </tr>
            <tr>
              <td style="border: none; padding: 2px 0; text-align: left; font-weight: bold; width: 60%; vertical-align: top;">
                <span contenteditable="true" data-header="plan_name">${escapeHtml(h.planText)}</span>
              </td>
              <td style="border: none; padding: 2px 0; text-align: right; font-weight: bold; width: 40%; vertical-align: top;">
                <span contenteditable="true" data-header="hours_text">${escapeHtml(h.hoursText)}</span>
              </td>
            </tr>
            <tr>
              <td style="border: none; padding: 2px 0; text-align: left; font-weight: bold; width: 60%; vertical-align: top;">
                <span contenteditable="true" data-header="subject">${escapeHtml(h.subjectText)}</span>
              </td>
              <td style="border: none; padding: 2px 0; text-align: right; font-weight: bold; width: 40%; vertical-align: top;">
                <span contenteditable="true" data-header="semester">${escapeHtml(h.semesterText)}</span>
              </td>
            </tr>
            <tr>
              <td style="border: none; padding: 2px 0; text-align: left; width: 60%; vertical-align: top;">
                ปีการศึกษา <span contenteditable="true" data-header="year">${escapeHtml(data.year || '............')}</span> วันที่ <span contenteditable="true" data-header="date">${escapeHtml(data.date || '......')}</span> <span contenteditable="true" data-header="month">${escapeHtml(data.month || '..................')}</span> พ.ศ. <span contenteditable="true" data-header="buddhist_year">${escapeHtml(data.buddhist_year || '............')}</span>
              </td>
              <td style="border: none; padding: 2px 0; text-align: right; width: 40%; vertical-align: top;">
                <span contenteditable="true" data-header="school">${escapeHtml(h.schoolText)}</span>
              </td>
            </tr>
          </tbody>
        </table>
        <div class="text-slate-400 select-none text-xs" style="letter-spacing: 2px; text-align: center;">
          ……………………………………………………………………………………………………………………………………………………
        </div>
      </div>

      <!-- 11 หัวข้อมาตรฐาน -->
      <div class="sections-container space-y-5">
        <!-- 1. มาตรฐานการเรียนรู้ -->
        <div class="section-card bg-white p-3 rounded-lg relative border border-slate-200">
          <div class="flex items-center justify-between border-b border-slate-200 pb-1 mb-2">
            <h3 class="font-bold text-base text-slate-900" style="font-size: 16pt;">1. มาตรฐานการเรียนรู้</h3>
            <button class="copy-section-btn text-xs bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 px-2.5 py-1 rounded border border-slate-200 transition-colors cursor-pointer flex items-center gap-1" data-section="1">
              📋 คัดลอกหัวข้อนี้
            </button>
          </div>
          <div class="editable-content whitespace-pre-wrap pl-3" contenteditable="true" data-field="standards">${escapeHtml(data.standards)}</div>
        </div>

        <!-- 2. ตัวชี้วัด -->
        <div class="section-card bg-white p-3 rounded-lg relative border border-slate-200">
          <div class="flex items-center justify-between border-b border-slate-200 pb-1 mb-2">
            <h3 class="font-bold text-base text-slate-900" style="font-size: 16pt;">2. ตัวชี้วัด</h3>
            <button class="copy-section-btn text-xs bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 px-2.5 py-1 rounded border border-slate-200 transition-colors cursor-pointer flex items-center gap-1" data-section="2">
              📋 คัดลอกหัวข้อนี้
            </button>
          </div>
          <div class="editable-content whitespace-pre-wrap pl-3" contenteditable="true" data-field="indicators">${escapeHtml(data.indicators)}</div>
        </div>

        <!-- 3. สาระสำคัญ -->
        <div class="section-card bg-white p-3 rounded-lg relative border border-slate-200">
          <div class="flex items-center justify-between border-b border-slate-200 pb-1 mb-2">
            <h3 class="font-bold text-base text-slate-900" style="font-size: 16pt;">3. สาระสำคัญ</h3>
            <button class="copy-section-btn text-xs bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 px-2.5 py-1 rounded border border-slate-200 transition-colors cursor-pointer flex items-center gap-1" data-section="3">
              📋 คัดลอกหัวข้อนี้
            </button>
          </div>
          <div class="editable-content whitespace-pre-wrap pl-3" contenteditable="true" data-field="concept">${escapeHtml(data.concept)}</div>
        </div>

        <!-- 4. จุดประสงค์รายวิชา (K, P, A) -->
        <div class="section-card bg-white p-3 rounded-lg relative border border-slate-200">
          <div class="flex items-center justify-between border-b border-slate-200 pb-1 mb-2">
            <h3 class="font-bold text-base text-slate-900" style="font-size: 16pt;">4. จุดประสงค์รายวิชา</h3>
            <button class="copy-section-btn text-xs bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 px-2.5 py-1 rounded border border-slate-200 transition-colors cursor-pointer flex items-center gap-1" data-section="4">
              📋 คัดลอกหัวข้อนี้
            </button>
          </div>
          <div class="pl-3 space-y-2">
            <div>
              <span class="font-bold">ความรู้ (K):</span>
              <div class="editable-content whitespace-pre-wrap pl-2" contenteditable="true" data-field="k_objective">${escapeHtml(data.k_objective)}</div>
            </div>
            <div>
              <span class="font-bold">ทักษะและกระบวนการ (P):</span>
              <div class="editable-content whitespace-pre-wrap pl-2" contenteditable="true" data-field="p_objective">${escapeHtml(data.p_objective)}</div>
            </div>
            <div>
              <span class="font-bold">คุณลักษณะอันพึงประสงค์ (A):</span>
              <div class="editable-content whitespace-pre-wrap pl-2" contenteditable="true" data-field="a_objective">${escapeHtml(data.a_objective)}</div>
            </div>
          </div>
        </div>

        <!-- 5. สาระการเรียนรู้ -->
        <div class="section-card bg-white p-3 rounded-lg relative border border-slate-200">
          <div class="flex items-center justify-between border-b border-slate-200 pb-1 mb-2">
            <h3 class="font-bold text-base text-slate-900" style="font-size: 16pt;">5. สาระการเรียนรู้</h3>
            <button class="copy-section-btn text-xs bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 px-2.5 py-1 rounded border border-slate-200 transition-colors cursor-pointer flex items-center gap-1" data-section="5">
              📋 คัดลอกหัวข้อนี้
            </button>
          </div>
          <div class="editable-content whitespace-pre-wrap pl-3" contenteditable="true" data-field="learning_content">${escapeHtml(data.learning_content)}</div>
        </div>

        <!-- 6. สมรรถนะสำคัญของผู้เรียน -->
        <div class="section-card bg-white p-3 rounded-lg relative border border-slate-200">
          <div class="flex items-center justify-between border-b border-slate-200 pb-1 mb-2">
            <h3 class="font-bold text-base text-slate-900" style="font-size: 16pt;">6. สมรรถนะสำคัญของผู้เรียน</h3>
            <button class="copy-section-btn text-xs bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 px-2.5 py-1 rounded border border-slate-200 transition-colors cursor-pointer flex items-center gap-1" data-section="6">
              📋 คัดลอกหัวข้อนี้
            </button>
          </div>
          <div class="editable-content whitespace-pre-wrap pl-3" contenteditable="true" data-field="competencies">${escapeHtml(data.competencies)}</div>
        </div>

        <!-- 7. กิจกรรมการเรียนรู้ (จัดย่อหน้า Tab ขั้นการสอน และ กิจกรรมย่อย) -->
        <div class="section-card bg-white p-3 rounded-lg relative border border-slate-200">
          <div class="flex items-center justify-between border-b border-slate-200 pb-1 mb-2">
            <h3 class="font-bold text-base text-slate-900" style="font-size: 16pt;">7. กิจกรรมการเรียนรู้ (รูปแบบการสอนแบบ <span contenteditable="true" data-field="teaching_model">${escapeHtml(data.teaching_model)}</span>)</h3>
            <button class="copy-section-btn text-xs bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 px-2.5 py-1 rounded border border-slate-200 transition-colors cursor-pointer flex items-center gap-1" data-section="7">
              📋 คัดลอกหัวข้อนี้
            </button>
          </div>
          <div class="editable-content pl-1" contenteditable="true" data-field="activities">${formatActivitiesPreviewHtml(data.activities)}</div>
        </div>

        <!-- 8. สื่อและแหล่งการเรียนรู้ -->
        <div class="section-card bg-white p-3 rounded-lg relative border border-slate-200">
          <div class="flex items-center justify-between border-b border-slate-200 pb-1 mb-2">
            <h3 class="font-bold text-base text-slate-900" style="font-size: 16pt;">8. สื่อและแหล่งการเรียนรู้</h3>
            <button class="copy-section-btn text-xs bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 px-2.5 py-1 rounded border border-slate-200 transition-colors cursor-pointer flex items-center gap-1" data-section="8">
              📋 คัดลอกหัวข้อนี้
            </button>
          </div>
          <div class="editable-content whitespace-pre-wrap pl-3" contenteditable="true" data-field="media_resources">${escapeHtml(data.media_resources)}</div>
        </div>

        <!-- 9. การวัดผลประเมินผล (ตาราง 4 คอลัมน์) -->
        <div class="section-card bg-white p-3 rounded-lg relative border border-slate-200">
          <div class="flex items-center justify-between border-b border-slate-200 pb-1 mb-2">
            <h3 class="font-bold text-base text-slate-900" style="font-size: 16pt;">9. การวัดผลประเมินผล</h3>
            <button class="copy-section-btn text-xs bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 px-2.5 py-1 rounded border border-slate-200 transition-colors cursor-pointer flex items-center gap-1" data-section="9">
              📋 คัดลอกหัวข้อนี้
            </button>
          </div>
          <div class="overflow-x-auto my-2">
            <table class="w-full text-left" style="border-collapse: collapse; border: 1px solid #000; width: 100%; font-size: 15pt;">
              <thead>
                <tr style="background-color: #f1f5f9;">
                  <th style="border: 1px solid #000; padding: 6px 8px; text-align: center; width: 30%;">จุดประสงค์การเรียนรู้</th>
                  <th style="border: 1px solid #000; padding: 6px 8px; text-align: center; width: 25%;">วิธีการวัด</th>
                  <th style="border: 1px solid #000; padding: 6px 8px; text-align: center; width: 25%;">เครื่องมือวัด</th>
                  <th style="border: 1px solid #000; padding: 6px 8px; text-align: center; width: 20%;">เกณฑ์การวัด</th>
                </tr>
              </thead>
              <tbody id="preview-eval-tbody">
                ${evalTableRowsHtml}
              </tbody>
            </table>
          </div>
        </div>

        <!-- 10. กิจกรรมเสนอแนะ/งานที่มอบหมาย -->
        <div class="section-card bg-white p-3 rounded-lg relative border border-slate-200">
          <div class="flex items-center justify-between border-b border-slate-200 pb-1 mb-2">
            <h3 class="font-bold text-base text-slate-900" style="font-size: 16pt;">10. กิจกรรมเสนอแนะ/งานที่มอบหมาย</h3>
            <button class="copy-section-btn text-xs bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 px-2.5 py-1 rounded border border-slate-200 transition-colors cursor-pointer flex items-center gap-1" data-section="10">
              📋 คัดลอกหัวข้อนี้
            </button>
          </div>
          <div class="pl-3 space-y-2">
            <div>
              <span class="font-bold">1. กิจกรรมเสนอแนะ:</span>
              <div class="editable-content whitespace-pre-wrap pl-2" contenteditable="true" data-field="suggestions">${escapeHtml(data.suggestions)}</div>
            </div>
            <div>
              <span class="font-bold">2. งานที่มอบหมาย:</span>
              <div class="editable-content whitespace-pre-wrap pl-2" contenteditable="true" data-field="assignments">${escapeHtml(data.assignments)}</div>
            </div>
          </div>
        </div>

        <!-- 11. บันทึกหลังกระบวนการจัดการเรียนรู้ -->
        <div class="section-card bg-white p-3 rounded-lg relative border border-slate-200">
          <div class="flex items-center justify-between border-b border-slate-200 pb-1 mb-2">
            <h3 class="font-bold text-base text-slate-900" style="font-size: 16pt;">11. บันทึกหลังกระบวนการจัดการเรียนรู้</h3>
            <button class="copy-section-btn text-xs bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 px-2.5 py-1 rounded border border-slate-200 transition-colors cursor-pointer flex items-center gap-1" data-section="11">
              📋 คัดลอกหัวข้อนี้
            </button>
          </div>
          <div class="pl-3 space-y-4" style="font-size: 16pt; line-height: 1.6;">
            <!-- 1. ผลการจัดการเรียนการสอน -->
            <div>
              <div class="font-bold mb-1" style="font-size: 16pt;">ผลการจัดการเรียนการสอน</div>
              <div class="text-slate-800" style="padding-left: 24pt; font-size: 16pt; line-height: 1.8;">
                นักเรียนจำนวน................คน
              </div>
              <div class="text-slate-800 flex flex-wrap items-center gap-x-12" style="padding-left: 24pt; font-size: 16pt; line-height: 1.8;">
                <span>ผ่านจุดประสงค์การเรียนรู้................คน</span>
                <span>คิดเป็นร้อยละ...............</span>
              </div>
              <div class="text-slate-800 flex flex-wrap items-center gap-x-12" style="padding-left: 24pt; font-size: 16pt; line-height: 1.8;">
                <span>ไม่ผ่านจุดประสงค์การเรียนรู้................คน</span>
                <span>คิดเป็นร้อยละ...............</span>
              </div>
            </div>

            <!-- 2. ด้านความรู้ (K) -->
            <div>
              <div class="font-bold mb-1" style="font-size: 16pt;">ด้านความรู้ (K)</div>
              <div class="text-slate-800" style="padding-left: 24pt; font-size: 16pt; line-height: 1.8;">
                ............................................................................................................................................................................................................
              </div>
            </div>

            <!-- 3. ด้านทักษะและกระบวนการ (P) -->
            <div>
              <div class="font-bold mb-1" style="font-size: 16pt;">ด้านทักษะและกระบวนการ (P)</div>
              <div class="text-slate-800" style="padding-left: 24pt; font-size: 16pt; line-height: 1.8;">
                ............................................................................................................................................................................................................
              </div>
            </div>

            <!-- 4. ด้านคุณลักษณะอันพึงประสงค์ (A) -->
            <div>
              <div class="font-bold mb-1" style="font-size: 16pt;">ด้านคุณลักษณะอันพึงประสงค์ (A)</div>
              <div class="text-slate-800" style="padding-left: 24pt; font-size: 16pt; line-height: 1.8;">
                ............................................................................................................................................................................................................
              </div>
            </div>

            <!-- 5. ปัญหา / อุปสรรค -->
            <div>
              <div class="font-bold mb-1" style="font-size: 16pt;">ปัญหา / อุปสรรค</div>
              <div class="text-slate-800" style="padding-left: 24pt; font-size: 16pt; line-height: 1.8;">
                ............................................................................................................................................................................................................
              </div>
            </div>

            <!-- 6. ข้อเสนอแนะ / แนวทางแก้ไข -->
            <div>
              <div class="font-bold mb-1" style="font-size: 16pt;">ข้อเสนอแนะ / แนวทางแก้ไข</div>
              <div class="text-slate-800" style="padding-left: 24pt; font-size: 16pt; line-height: 1.8;">
                ............................................................................................................................................................................................................
              </div>
            </div>

            <!-- ช่องลงชื่อ: ตาราง 4 แถว จัดกึ่งกลาง ชิดขวาสุด ไร้เส้น -->
            <div class="pt-6 flex justify-end">
              <table style="width: 340px; border-collapse: collapse; border: none; text-align: center; margin-left: auto; margin-right: 0;">
                <tbody>
                  <tr>
                    <td style="border: none; padding: 3px 0; text-align: center; font-size: 16pt; font-family: 'TH SarabunPSK', 'TH Sarabun PSK', sans-serif;">
                      ลงชื่อ.................................................................
                    </td>
                  </tr>
                  <tr>
                    <td style="border: none; padding: 3px 0; text-align: center; font-size: 16pt; font-family: 'TH SarabunPSK', 'TH Sarabun PSK', sans-serif;">
                      ( <span contenteditable="true" data-field="teacher_name">${escapeHtml(teacherName)}</span> )
                    </td>
                  </tr>
                  <tr>
                    <td style="border: none; padding: 3px 0; text-align: center; font-size: 16pt; font-family: 'TH SarabunPSK', 'TH Sarabun PSK', sans-serif;">
                      ตำแหน่ง <span contenteditable="true" data-field="teacher_position">${escapeHtml(teacherPos)}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="border: none; padding: 3px 0; text-align: center; font-size: 16pt; font-family: 'TH SarabunPSK', 'TH Sarabun PSK', sans-serif;">
                      ${signDateStr}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  previewContent.innerHTML = html;

  // Bind Section Copy Buttons
  previewContent.querySelectorAll('.copy-section-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const secNum = parseInt((btn as HTMLElement).dataset.section || '1');
      const content = getSectionCopyContent(secNum, state.lessonPlanData!);
      const success = await copyRichText(content.html, content.text);
      if (success) {
        showToast(`คัดลอกหัวข้อที่ ${secNum} เรียบร้อยแล้ว`, 'success');
      } else {
        showToast('ไม่สามารถคัดลอกลงคลิปบอร์ดได้', 'error');
      }
    });
  });

  // Bind Contenteditable Blur / Input sync
  previewContent.querySelectorAll('[data-field]').forEach(el => {
    el.addEventListener('blur', () => {
      const field = (el as HTMLElement).dataset.field as keyof LessonPlanData;
      if (field && state.lessonPlanData) {
        (state.lessonPlanData as any)[field] = (el as HTMLElement).innerText.trim();
        scheduleSaveDraft();
      }
    });
  });

  // Bind Header edits
  previewContent.querySelectorAll('[data-header]').forEach(el => {
    el.addEventListener('blur', () => {
      const headerKey = (el as HTMLElement).dataset.header as keyof LessonPlanData;
      if (headerKey && state.lessonPlanData) {
        (state.lessonPlanData as any)[headerKey] = (el as HTMLElement).innerText.trim();
        scheduleSaveDraft();
      }
    });
  });

  // Bind Table edits
  previewContent.querySelectorAll('.eval-cell').forEach(cell => {
    cell.addEventListener('blur', () => {
      const rowEl = cell.closest('tr');
      const rowIdx = parseInt(rowEl?.dataset.row || '0');
      const field = (cell as HTMLElement).dataset.field as keyof EvaluationRow;
      if (state.lessonPlanData?.evaluation_rows?.[rowIdx] && field) {
        state.lessonPlanData.evaluation_rows[rowIdx][field] = (cell as HTMLElement).innerText.trim();
        scheduleSaveDraft();
      }
    });
  });
}

function scrollToPreview() {
  setTimeout(() => {
    document.getElementById('preview-section')?.scrollIntoView({ behavior: 'smooth' });
  }, 100);
}

// ============================================================
// Export Actions
// ============================================================
async function handleCopyAll() {
  if (!state.lessonPlanData && !state.generatedPlan) {
    showToast('ยังไม่มีแผนการสอนที่จะคัดลอก กรุณาสร้างแผนก่อน', 'error');
    return;
  }
  const planData = state.lessonPlanData || parseLessonPlanResponse(state.generatedPlan, buildInputFromState());
  const html = buildFullPlanHtml(planData);
  const plainText = buildFullPlanPlainText(planData);
  const success = await copyRichText(html, plainText);
  if (success) {
    showToast('คัดลอกทั้งแผนเรียบร้อยแล้ว (สามารถวางใน Microsoft Word ได้ทันที)', 'success');
  } else {
    showToast('ไม่สามารถคัดลอกลงคลิปบอร์ดได้', 'error');
  }
}

async function handleExportDocx() {
  if (!state.lessonPlanData && !state.generatedPlan) {
    showToast('ยังไม่มีแผนการสอนที่จะส่งออก กรุณาสร้างแผนก่อน', 'error');
    return;
  }
  try {
    const planData = state.lessonPlanData || parseLessonPlanResponse(state.generatedPlan, buildInputFromState());
    await exportToDocx(planData);
    showToast('ส่งออกไฟล์ Word (.docx) สำเร็จแล้ว', 'success');
  } catch (error) {
    console.error('Export error:', error);
    showToast('เกิดข้อผิดพลาดในการส่งออกไฟล์ Word', 'error');
  }
}

function handlePrint() {
  if (!state.generatedPlan) {
    showToast('ยังไม่มีแผนการสอนที่จะพิมพ์ กรุณาสร้างแผนก่อน', 'error');
    return;
  }
  window.print();
}

// ============================================================
// LocalStorage Autosave
// ============================================================
function saveDraftToLocalStorage() {
  try {
    const draft: Partial<AppState> = {
      view: state.view,
      currentStep: state.currentStep,
      gradeId: state.gradeId,
      subjectId: state.subjectId,
      isEarlyChildhoodMode: state.isEarlyChildhoodMode,
      selectedECDomains: state.selectedECDomains,
      planName: state.planName,
      unit: state.unit,
      topic: state.topic,
      durationMinutes: state.durationMinutes,
      durationText: state.durationText,
      durationOptionId: state.durationOptionId,
      durationCustomType: state.durationCustomType,
      durationCustomHours: state.durationCustomHours,
      durationCustomMinutes: state.durationCustomMinutes,
      selectedStandardIds: state.selectedStandardIds,
      selectedIndicatorIds: state.selectedIndicatorIds,
      objectiveMode: state.objectiveMode,
      kpaK: state.kpaK,
      kpaP: state.kpaP,
      kpaA: state.kpaA,
      customObjective: state.customObjective,
      customSubject: state.customSubject,
      teachingMethod: state.teachingMethod,
      customTeachingMethod: state.customTeachingMethod,
      competencies: state.competencies,
      classroomAtmosphere: state.classroomAtmosphere,
      planDirections: state.planDirections,
      additionalNotes: state.additionalNotes,
      school: state.school,
      semester: state.semester,
      date: state.date,
      month: state.month,
      academicYear: state.academicYear,
      buddhistYear: state.buddhistYear,
      teacherName: state.teacherName,
      teacherPosition: state.teacherPosition,
      generatedPlan: state.generatedPlan,
      lessonPlanData: state.lessonPlanData,
      resolvedModel: state.resolvedModel,
    };
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Ignore storage quota errors
  }
}

function scheduleSaveDraft() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDraftToLocalStorage, 250);
}

function loadDraftFromLocalStorage(): boolean {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return false;
    const draft = JSON.parse(raw);
    Object.assign(state, draft);
    return true;
  } catch {
    return false;
  }
}

function syncAllFormInputsFromState() {
  // Sync grade
  document.querySelectorAll('.grade-pill').forEach(btn => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.grade === state.gradeId);
  });
  document.querySelectorAll('.grade-select').forEach(el => ((el as HTMLSelectElement).value = state.gradeId));

  // Sync subject cards & select dropdown
  renderWizardSubjectCards();
  populateAllInOneSubjects();

  document.querySelectorAll('.subject-card').forEach(card => {
    card.classList.toggle('active', (card as HTMLElement).dataset.subject === state.subjectId);
  });
  document.querySelectorAll('.subject-select').forEach(el => ((el as HTMLSelectElement).value = state.subjectId));

  // Sync topic & unit & name
  const topicInput = document.getElementById('wizard-topic') as HTMLInputElement;
  if (topicInput) topicInput.value = state.topic;
  const unitInput = document.getElementById('wizard-unit') as HTMLInputElement;
  if (unitInput) unitInput.value = state.unit;
  const planNameInput = document.getElementById('wizard-plan-name') as HTMLInputElement;
  if (planNameInput) planNameInput.value = state.planName;

  document.querySelectorAll('.topic-input').forEach(el => ((el as HTMLInputElement).value = state.topic));
  document.querySelectorAll('.unit-input').forEach(el => ((el as HTMLInputElement).value = state.unit));
  document.querySelectorAll('.plan-name-input').forEach(el => ((el as HTMLInputElement).value = state.planName));

  // Sync duration
  syncDurationControls();

  // Sync Header fields
  document.querySelectorAll('.school-input').forEach(el => ((el as HTMLInputElement).value = state.school || ''));
  document.querySelectorAll('.semester-input').forEach(el => ((el as HTMLInputElement).value = state.semester || ''));
  document.querySelectorAll('.year-input').forEach(el => ((el as HTMLInputElement).value = state.academicYear || ''));
  document.querySelectorAll('.date-input').forEach(el => ((el as HTMLInputElement).value = state.date || ''));
  document.querySelectorAll('.month-input').forEach(el => ((el as HTMLInputElement).value = state.month || ''));
  document.querySelectorAll('.byear-input').forEach(el => ((el as HTMLInputElement).value = state.buddhistYear || ''));
  document.querySelectorAll('.teacher-name-input').forEach(el => ((el as HTMLInputElement).value = state.teacherName || ''));
  document.querySelectorAll('.teacher-pos-input').forEach(el => ((el as HTMLInputElement).value = state.teacherPosition || ''));
  document.querySelectorAll('.subject-name-input').forEach(el => ((el as HTMLInputElement).value = state.subjectName || ''));
  document.querySelectorAll('.custom-subject-input').forEach(el => ((el as HTMLInputElement).value = state.customSubject || ''));
  document.querySelectorAll('.custom-method-input').forEach(el => ((el as HTMLInputElement).value = state.customTeachingMethod || ''));
  syncCustomSubjectDisplay();
  syncCustomMethodDisplay();

  // Sync KPA
  syncKPAToForm();

  // Sync teaching method
  document.querySelectorAll('.method-choice-card').forEach(card => {
    card.classList.toggle('active', (card as HTMLElement).dataset.method === state.teachingMethod);
  });
  document.querySelectorAll('.teaching-method-select').forEach(el => ((el as HTMLSelectElement).value = state.teachingMethod));

  // Sync chips
  document.querySelectorAll('.competencies-container .chip-checkbox').forEach(label => {
    const cb = label.querySelector('input') as HTMLInputElement;
    if (cb) {
      cb.checked = state.competencies.includes(cb.value);
      label.classList.toggle('active', cb.checked);
    }
  });

  document.querySelectorAll('.directions-container .chip-checkbox').forEach(label => {
    const cb = label.querySelector('input') as HTMLInputElement;
    if (cb) {
      cb.checked = state.planDirections.includes(cb.value);
      label.classList.toggle('active', cb.checked);
    }
  });

  document.querySelectorAll('.atmosphere-input').forEach(el => ((el as HTMLTextAreaElement).value = state.classroomAtmosphere));

  // Update view
  switchView(state.view || 'choice');
  updateContextTag();

  if (state.generatedPlan) {
    renderPreview();
  }
}

function syncStateToAllInOne() {
  const form = document.getElementById('allinone-section')!;
  (form.querySelector('.grade-select') as HTMLSelectElement).value = state.gradeId;
  (form.querySelector('.subject-select') as HTMLSelectElement).value = state.subjectId;
  const subNameEl = form.querySelector('.subject-name-input') as HTMLInputElement;
  if (subNameEl) subNameEl.value = state.subjectName || '';
  const customSubEl = form.querySelector('.custom-subject-input') as HTMLInputElement;
  if (customSubEl) customSubEl.value = state.customSubject || '';
  const customMethodEl = form.querySelector('.custom-method-input') as HTMLInputElement;
  if (customMethodEl) customMethodEl.value = state.customTeachingMethod || '';
  syncCustomSubjectDisplay();
  syncCustomMethodDisplay();
  (form.querySelector('#aio-plan-name') as HTMLInputElement).value = state.planName;
  (form.querySelector('#aio-unit') as HTMLInputElement).value = state.unit;
  (form.querySelector('#aio-topic') as HTMLInputElement).value = state.topic;
  (form.querySelector('#aio-teaching-method') as HTMLSelectElement).value = state.teachingMethod;
  (form.querySelector('#aio-atmosphere') as HTMLTextAreaElement).value = state.classroomAtmosphere;
  renderAllInOneStandards();
}

function renderAllInOneStandards() {
  const grid = (document.getElementById('aio-standards-grid') || document.querySelector('#allinone-section .standards-list')) as HTMLElement;
  const summaryEl = document.getElementById('aio-selected-indicators-summary');
  if (!grid) return;
  grid.innerHTML = '';

  if (!state.subjectId || !state.gradeId) {
    grid.innerHTML = '<p class="text-slate-400 text-sm italic col-span-2 text-center py-6">กรุณาเลือกระดับชั้นและวิชาก่อน</p>';
    if (summaryEl) summaryEl.textContent = 'กรุณาเลือกระดับชั้นและวิชาก่อน';
    return;
  }

  const standards = getAvailableStandards(curriculumData, state.subjectId, state.gradeId);
  if (!standards || standards.length === 0) {
    grid.innerHTML = `
      <div class="col-span-2 text-center py-6 white-card">
        <p class="text-slate-600 text-sm font-medium">ไม่มีตัวชี้วัดในระดับชั้นนี้</p>
        <p class="text-slate-400 text-xs mt-1">(ระบบ AI จะสังเคราะห์เนื้อหาและเป้าหมายที่เหมาะสมให้อัตโนมัติ)</p>
      </div>
    `;
    if (summaryEl) summaryEl.textContent = 'ไม่มีตัวชี้วัดเฉพาะในระดับชั้นนี้';
    return;
  }

  standards.forEach(std => {
    const card = document.createElement('div');
    card.className = 'choice-card';

    const indicators = getIndicatorsByGrade(std, state.gradeId);
    const selectedCount = indicators.filter(ind => state.selectedIndicatorIds.includes(ind.id)).length;
    const hasSelection = selectedCount > 0;

    if (hasSelection) card.classList.add('active');

    const strandInfo = std.strand ? `<div class="text-xs text-blue-600 font-medium mb-1">${std.strand}</div>` : '';
    const stdTitle = std.title || std.label || '';

    card.innerHTML = `
      <div class="flex items-start justify-between gap-2 mb-1.5">
        <span class="font-bold text-slate-900 text-base">${std.code}</span>
        ${hasSelection ? `<span class="text-xs bg-blue-100 text-blue-800 font-semibold px-2 py-0.5 rounded-full">เลือกแล้ว ${selectedCount} ข้อ</span>` : '<span class="text-xs text-slate-400">คลิกเพื่อเลือก</span>'}
      </div>
      ${strandInfo}
      <p class="text-xs text-slate-600 line-clamp-3 leading-relaxed">${stdTitle}</p>
    `;

    card.addEventListener('click', () => {
      openIndicatorModal(std);
    });

    grid.appendChild(card);
  });

  if (summaryEl) {
    const count = state.selectedIndicatorIds.length;
    summaryEl.textContent = count > 0 ? `เลือกตัวชี้วัดแล้วทั้งหมด ${count} ข้อ` : 'คลิกที่การ์ดมาตรฐานด้านบนเพื่อเลือกตัวชี้วัด';
  }
}

function resetForm() {
  showModal(
    'ยืนยันการล้างข้อมูลฟอร์ม',
    'คุณต้องการล้างข้อมูลที่กรอกทั้งหมดและเริ่มต้นร่างแผนใหม่ ใช่หรือไม่?',
    () => {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
      state.view = 'choice';
      state.currentStep = 1;
      state.gradeId = '';
      state.subjectId = '';
      state.subjectName = '';
      state.customSubject = '';
      state.isEarlyChildhoodMode = false;
      state.selectedECDomains = [];
      state.planName = '';
      state.unit = '';
      state.topic = '';
      state.durationMinutes = 60;
      state.durationText = '1 ชั่วโมง';
      state.durationOptionId = '1hour';
      state.durationCustomType = 'hours';
      state.durationCustomHours = 3;
      state.durationCustomMinutes = 45;
      state.selectedStandardIds = [];
      state.selectedIndicatorIds = [];
      state.objectiveMode = 'kpa';
      state.kpaK = '';
      state.kpaP = '';
      state.kpaA = '';
      state.customObjective = '';
      state.teachingMethod = DEFAULT_TEACHING_METHOD;
      state.customTeachingMethod = '';
      state.competencies = [];
      state.classroomAtmosphere = '';
      state.planDirections = [];
      state.additionalNotes = '';
      state.school = '';
      state.semester = '1';
      state.academicYear = '';
      state.teacherName = '';
      state.teacherPosition = 'ครูผู้ช่วย / ครู';
      state.generatedPlan = '';
      state.lessonPlanData = null;

      syncAllFormInputsFromState();
      document.getElementById('preview-section')?.classList.add('hidden');
      showToast('ล้างข้อมูลฟอร์มเรียบร้อยแล้ว', 'info');
    },
    () => {}
  );
}

// ============================================================
// Presets (Clean, authentic IDs from curriculum v2.1.0)
// ============================================================
const PRESETS: Record<string, Partial<AppState>> = {
  thai1: {
    gradeId: 'p1',
    subjectId: 'thai',
    subjectName: 'ภาษาไทยพื้นฐาน',
    isEarlyChildhoodMode: false,
    selectedECDomains: [],
    planName: 'แผนการจัดการเรียนรู้ที่ 1 การอ่านออกเสียงคำสระอา',
    unit: 'หน่วยการเรียนรู้ที่ 1 สนุกกับสระ',
    topic: 'การอ่านออกเสียงคำและข้อความสั้นๆ ที่ประสมสระอา',
    durationMinutes: 60,
    selectedStandardIds: ['std_thai_1_1'],
    selectedIndicatorIds: ['TH-1.1-P1-01', 'TH-1.1-P1-02'],
    teachingMethod: 'game',
    competencies: ['communication', 'thinking'],
    classroomAtmosphere: 'บรรยากาศเป็นกันเอง สนุกสนาน มีกิจกรรมเกมคำศัพท์เพื่อกระตุ้นการมีส่วนร่วม',
    planDirections: ['detailed', 'games', 'hands_on'],
    kpaK: 'ผู้เรียนสามารถบอกหลักการอ่านออกเสียงและแจกลูกสะกดคำที่ประสมสระอาได้ถูกต้อง',
    kpaP: 'ผู้เรียนสามารถอ่านออกเสียงคำและข้อความสั้นๆ ที่ประสมสระอาได้คล่องแคล่ว',
    kpaA: 'ผู้เรียนมีความกระตือรือร้นและมีมารยาทในการอ่าน',
  },
  math1: {
    gradeId: 'p1',
    subjectId: 'math',
    subjectName: 'คณิตศาสตร์พื้นฐาน',
    isEarlyChildhoodMode: false,
    selectedECDomains: [],
    planName: 'แผนการจัดการเรียนรู้ที่ 5 การวัดและเปรียบเทียบความยาว',
    unit: 'หน่วยการเรียนรู้ที่ 3 การวัดความยาว',
    topic: 'การวัดความยาวเป็นเซนติเมตรโดยใช้ไม้บรรทัด',
    durationMinutes: 60,
    selectedStandardIds: ['std_math_2_1'],
    selectedIndicatorIds: ['MA-2.1-P1-01'],
    teachingMethod: 'active',
    competencies: ['thinking', 'problem_solving'],
    classroomAtmosphere: 'เน้นการลงมือปฏิบัติจริง มีเครื่องมือและสิ่งของรอบตัวให้นักเรียนได้ทดลองวัด',
    planDirections: ['hands_on', 'real_life', 'clear_steps'],
    kpaK: 'ผู้เรียนสามารถอธิบายวิธีการใช้ไม้บรรทัดวัดความยาวเป็นเซนติเมตรได้อย่างถูกต้อง',
    kpaP: 'ผู้เรียนสามารถใช้ไม้บรรทัดวัดและบอกความยาวของสิ่งของเป็นเซนติเมตรได้',
    kpaA: 'ผู้เรียนมีความละเอียดรอบคอบในการวัดและการทำงานร่วมกับผู้อื่น',
  },
  sci1: {
    gradeId: 'm1',
    subjectId: 'science',
    subjectName: 'วิทยาศาสตร์และเทคโนโลยี',
    isEarlyChildhoodMode: false,
    selectedECDomains: [],
    planName: 'แผนการจัดการเรียนรู้ที่ 2 สมบัติทางกายภาพของสารบริสุทธิ์และสารผสม',
    unit: 'หน่วยการเรียนรู้ที่ 1 สารรอบตัว',
    topic: 'การทดสอบจุดเดือดและจุดหลอมเหลวเพื่อจำแนกสารบริสุทธิ์และสารผสม',
    durationMinutes: 120,
    selectedStandardIds: ['std_sci_2_1'],
    selectedIndicatorIds: ['SC-2.1-M1-01', 'SC-2.1-M1-02'],
    teachingMethod: '5e',
    competencies: ['thinking', 'problem_solving', 'technology'],
    classroomAtmosphere: 'บรรยากาศห้องปฏิบัติการวิทยาศาสตร์ที่เน้นความปลอดภัย และการร่วมมือกันทดลองเป็นกลุ่ม',
    planDirections: ['hands_on', 'group_work', 'critical_thinking'],
    kpaK: 'ผู้เรียนสามารถอธิบายความแตกต่างระหว่างจุดเดือดและจุดหลอมเหลวของสารบริสุทธิ์และสารผสมได้',
    kpaP: 'ผู้เรียนสามารถวางแผนและทำการทดลองเพื่อเปรียบเทียบจุดเดือดของสารได้ตามกระบวนการทางวิทยาศาสตร์',
    kpaA: 'ผู้เรียนมีความซื่อสัตย์ในการบันทึกข้อมูลและรับผิดชอบต่อความปลอดภัยในการทดลอง',
  },
  ec2: {
    gradeId: 'k2',
    isEarlyChildhoodMode: true,
    subjectId: 'earlyChildhood',
    subjectName: 'กิจกรรมจัดประสบการณ์ปฐมวัย',
    selectedECDomains: ['physical', 'emotional', 'cognitive'],
    planName: 'แผนการจัดประสบการณ์การเรียนรู้ กิจกรรมสำรวจใบไม้รอบโรงเรียน',
    unit: 'หน่วยธรรมชาติรอบตัว',
    topic: 'การสำรวจรูปทรงและสีสันของใบไม้ผ่านประสาทสัมผัส',
    durationMinutes: 60,
    selectedStandardIds: ['std_ec_มฐ.1'],
    selectedIndicatorIds: ['EC-มฐ.1-k2'],
    teachingMethod: 'active',
    competencies: ['thinking', 'life_skills'],
    classroomAtmosphere: 'อบอุ่น เป็นกันเอง เด็กได้เคลื่อนไหวและสัมผัสธรรมชาติอย่างอิสระ',
    planDirections: ['hands_on', 'local_materials'],
    kpaK: 'เด็กรู้จักสังเกตและบอกความแตกต่างของสีและรูปร่างใบไม้ได้',
    kpaP: 'เด็กสามารถใช้ประสาทสัมผัสและกล้ามเนื้อมัดเล็กในการหยิบจับและพิมพ์ภาพใบไม้ได้',
    kpaA: 'เด็กมีความสุข สนุกสนาน และรักธรรมชาติรอบตัว',
  },
};

function applyPreset(presetKey: string) {
  const preset = PRESETS[presetKey];
  if (!preset) return;
  Object.assign(state, preset);
  state.view = 'wizard';
  state.currentStep = 10;
  syncAllFormInputsFromState();
  scheduleSaveDraft();
  showToast(`โหลดตัวอย่าง "${state.planName}" เรียบร้อยแล้ว`, 'success');
}

// ============================================================
// Worker Proxy Settings Modal
// ============================================================
function setupSettingsModal() {
  const modal = document.getElementById('settings-modal-overlay');
  const openBtn = document.getElementById('btn-open-settings');
  const closeBtn = document.getElementById('settings-close-btn');
  const saveBtn = document.getElementById('settings-save-btn');
  const resetBtn = document.getElementById('settings-reset-btn');
  const input = document.getElementById('worker-endpoint-input') as HTMLInputElement;

  if (!modal || !input) return;

  const openModal = () => {
    input.value = getWorkerEndpoint();
    modal.style.display = 'flex';
    modal.classList.remove('hidden');
  };

  const closeModal = () => {
    modal.style.display = 'none';
    modal.classList.add('hidden');
  };

  openBtn?.addEventListener('click', openModal);
  closeBtn?.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  saveBtn?.addEventListener('click', () => {
    const val = input.value.trim();
    if (val && !val.startsWith('http://') && !val.startsWith('https://')) {
      showToast('กรุณาระบุ URL ที่ขึ้นต้นด้วย https:// หรือ http://', 'error');
      return;
    }
    setWorkerEndpoint(val);
    showToast('บันทึก URL ของ Worker Proxy เรียบร้อยแล้ว', 'success');
    closeModal();
  });

  resetBtn?.addEventListener('click', () => {
    setWorkerEndpoint('');
    input.value = DEFAULT_WORKER_ENDPOINT;
    showToast('รีเซ็ตเป็นค่าเริ่มต้นเรียบร้อยแล้ว', 'info');
  });
}

// ============================================================
// Two-way Input Helpers
// ============================================================
function bindInput(selector: string, stateKey: keyof AppState) {
  document.querySelectorAll(selector).forEach(el => {
    el.addEventListener('input', () => {
      (state as any)[stateKey] = (el as HTMLInputElement).value;
      document.querySelectorAll(selector).forEach(other => {
        if (other !== el) (other as HTMLInputElement).value = (el as HTMLInputElement).value;
      });
      updateContextTag();
      scheduleSaveDraft();
    });
  });
}

// ============================================================
// Initialization
// ============================================================
async function init() {
  try {
    curriculumData = await loadCurriculum();
  } catch (error) {
    showToast('ไม่สามารถโหลดข้อมูลหลักสูตรได้', 'error');
    console.error(error);
    return;
  }

  // Populate drop-downs for All-in-One form
  populateAllInOneGrades();
  populateAllInOneSubjects();
  populateAllInOneMethods();
  populateCompetencies();
  populatePlanDirections();
  populateDurationOptions();

  // Setup Step components
  setupGradeStep();
  renderWizardSubjectCards();
  setupDurationStep();
  setupTeachingMethodsStep();
  setupIndicatorModalListeners();

  // Setup Mode Choice Buttons
  document.getElementById('card-mode-wizard')?.addEventListener('click', () => {
    switchView('wizard');
  });
  document.getElementById('card-mode-allinone')?.addEventListener('click', () => {
    switchView('allinone');
  });

  // Switch mode buttons in sub-views
  document.getElementById('btn-wizard-change-mode')?.addEventListener('click', () => {
    switchView('choice');
  });
  document.getElementById('btn-allinone-to-wizard')?.addEventListener('click', () => {
    switchView('wizard');
  });

  // Wizard Stepper Prev / Next
  document.getElementById('btn-prev')?.addEventListener('click', () => {
    if (state.currentStep === 1) {
      switchView('choice');
    } else {
      showStep(state.currentStep - 1);
    }
  });

  document.getElementById('btn-next')?.addEventListener('click', () => {
    if (state.currentStep < TOTAL_WIZARD_STEPS) {
      showStep(state.currentStep + 1);
    }
  });

  // Bind inputs
  bindInput('.topic-input', 'topic');
  bindInput('.unit-input', 'unit');
  bindInput('.plan-name-input', 'planName');
  bindInput('.subject-name-input', 'subjectName');
  bindInput('.custom-subject-input', 'customSubject');
  bindInput('.custom-method-input', 'customTeachingMethod');
  bindInput('.kpa-k', 'kpaK');
  bindInput('.kpa-p', 'kpaP');
  bindInput('.kpa-a', 'kpaA');
  bindInput('.atmosphere-input', 'classroomAtmosphere');
  bindInput('.school-input', 'school');
  bindInput('.semester-input', 'semester');
  bindInput('.year-input', 'academicYear');
  bindInput('.date-input', 'date');
  bindInput('.month-input', 'month');
  bindInput('.byear-input', 'buddhistYear');
  bindInput('.teacher-name-input', 'teacherName');
  bindInput('.teacher-pos-input', 'teacherPosition');

  // Select events in All-in-One
  document.querySelectorAll('.grade-select').forEach(el => {
    el.addEventListener('change', () => {
      selectGrade((el as HTMLSelectElement).value);
      renderAllInOneStandards();
    });
  });

  document.querySelectorAll('.subject-select').forEach(el => {
    el.addEventListener('change', () => {
      selectSubject((el as HTMLSelectElement).value);
      renderAllInOneStandards();
    });
  });

  document.querySelectorAll('.teaching-method-select').forEach(el => {
    el.addEventListener('change', () => {
      state.teachingMethod = (el as HTMLSelectElement).value;
      document.querySelectorAll('.method-choice-card').forEach(c => {
        c.classList.toggle('active', (c as HTMLElement).dataset.method === state.teachingMethod);
      });
      syncCustomMethodDisplay();
      scheduleSaveDraft();
    });
  });

  document.querySelectorAll('.duration-select').forEach(el => {
    el.addEventListener('change', () => {
      const durId = (el as HTMLSelectElement).value;
      selectDurationOption(durId);
    });
  });

  // AI KPA buttons
  document.querySelectorAll('.btn-ai-kpa').forEach(btn => {
    btn.addEventListener('click', generateKPA);
  });

  // Generate buttons (AI)
  document.getElementById('btn-generate-wizard')?.addEventListener('click', generatePlan);
  document.getElementById('btn-generate-aio')?.addEventListener('click', generatePlan);

  // Back to Form button in Preview
  document.getElementById('btn-back-to-form')?.addEventListener('click', () => {
    document.getElementById('preview-section')?.classList.add('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Export & Print buttons
  document.getElementById('btn-copy-all')?.addEventListener('click', handleCopyAll);
  document.getElementById('btn-export-docx')?.addEventListener('click', handleExportDocx);
  document.getElementById('btn-print')?.addEventListener('click', handlePrint);

  // Refine
  document.getElementById('btn-refine')?.addEventListener('click', refinePlan);

  // Reset form
  document.getElementById('btn-reset-form')?.addEventListener('click', resetForm);

  // Presets in header
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = (btn as HTMLElement).dataset.preset;
      if (preset) applyPreset(preset);
    });
  });

  // Settings Modal
  setupSettingsModal();

  // Restore Draft if exists
  const hasDraft = loadDraftFromLocalStorage();
  if (hasDraft) {
    syncAllFormInputsFromState();
    showToast('โหลดข้อมูลร่างเดิมที่บันทึกไว้อัตโนมัติ', 'info');
  } else {
    switchView('choice');
  }
}

function populateAllInOneGrades() {
  const levels = getGradeLevels(curriculumData);
  document.querySelectorAll('.grade-select').forEach(sel => {
    const s = sel as HTMLSelectElement;
    s.innerHTML = '<option value="">— เลือกระดับชั้น —</option>';
    levels.forEach(g => {
      s.innerHTML += `<option value="${g.id}">${g.code} (${g.name})</option>`;
    });
  });
}

function populateAllInOneSubjects() {
  const subjects = getSubjects(curriculumData, state.gradeId);
  document.querySelectorAll('.subject-select').forEach(sel => {
    const s = sel as HTMLSelectElement;
    const curVal = s.value || state.subjectId;
    s.innerHTML = '<option value="">— เลือกวิชา —</option>';
    if (state.isEarlyChildhoodMode) {
      s.innerHTML += `<option value="earlyChildhood">กิจกรรมจัดประสบการณ์ปฐมวัย</option>`;
    }
    subjects.forEach(sub => {
      s.innerHTML += `<option value="${sub.id}">${sub.name}</option>`;
    });
    s.innerHTML += `<option value="custom">วิชาเพิ่มเติม / กำหนดเอง</option>`;

    if (curVal && (subjects.some(sub => sub.id === curVal) || curVal === 'custom' || curVal === 'earlyChildhood')) {
      s.value = curVal;
    }
  });
}

function populateAllInOneMethods() {
  document.querySelectorAll('.teaching-method-select').forEach(sel => {
    const s = sel as HTMLSelectElement;
    s.innerHTML = '';
    TEACHING_METHODS.forEach(m => {
      s.innerHTML += `<option value="${m.id}" ${m.id === DEFAULT_TEACHING_METHOD ? 'selected' : ''}>${m.label}</option>`;
    });
  });
}

function populateCompetencies() {
  document.querySelectorAll('.competencies-container').forEach(container => {
    container.innerHTML = '';
    COMPETENCIES.forEach(comp => {
      const chip = document.createElement('label');
      chip.className = 'chip-checkbox';
      chip.innerHTML = `
        <input type="checkbox" value="${comp.id}">
        <span>${comp.label}</span>
      `;
      const cb = chip.querySelector('input')!;
      cb.addEventListener('change', () => {
        chip.classList.toggle('active', cb.checked);
        if (cb.checked) {
          if (!state.competencies.includes(comp.id)) state.competencies.push(comp.id);
        } else {
          state.competencies = state.competencies.filter(id => id !== comp.id);
        }
        scheduleSaveDraft();
      });
      container.appendChild(chip);
    });
  });
}

function populatePlanDirections() {
  document.querySelectorAll('.directions-container').forEach(container => {
    container.innerHTML = '';
    PLAN_DIRECTIONS.forEach(dir => {
      const chip = document.createElement('label');
      chip.className = 'chip-checkbox';
      chip.innerHTML = `
        <input type="checkbox" value="${dir.id}">
        <span>${dir.label}</span>
      `;
      const cb = chip.querySelector('input')!;
      cb.addEventListener('change', () => {
        chip.classList.toggle('active', cb.checked);
        if (cb.checked) {
          if (!state.planDirections.includes(dir.id)) state.planDirections.push(dir.id);
        } else {
          state.planDirections = state.planDirections.filter(id => id !== dir.id);
        }
        scheduleSaveDraft();
      });
      container.appendChild(chip);
    });
  });
}

function populateDurationOptions() {
  document.querySelectorAll('.duration-select').forEach(sel => {
    const s = sel as HTMLSelectElement;
    s.innerHTML = '';
    DURATION_OPTIONS.forEach(opt => {
      s.innerHTML += `<option value="${opt.id}" ${opt.id === state.durationOptionId ? 'selected' : ''}>${opt.label}</option>`;
    });
  });
}

// Start application
document.addEventListener('DOMContentLoaded', init);
