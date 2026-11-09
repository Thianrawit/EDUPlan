/**
 * EduPlan AI — Long-Term Plan Module (Course Syllabus & Long-Term Plan Generator)
 * ============================================================
 * โมดูลควบคุมระบบสร้างโครงการจัดการเรียนรู้ระยะยาว (10 ขั้นตอน Wizard)
 * - การจัดเก็บ State และบันทึก Draft ลง LocalStorage
 * - การเลือกตัวชี้วัด Multi-select จาก curriculum.json
 * - การสร้างจุดประสงค์ K-P-A ด้วย AI (Tier: kpa)
 * - การสั่งประมวลผล Fast Mode / Precision Mode พร้อม Live Stopwatch
 * - การแสดงผลพรีวิวเสมือนจริง A4 (contenteditable="true")
 * - ระบบ AI Refine ปรับปรุงแก้ไขโครงการภายหลัง
 * - การส่งออก Word (.docx), Rich-Text Clipboard และ พิมพ์ PDF
 * ============================================================
 */

import {
  loadCurriculum,
  getGradeLevels,
  getSubjects,
  getStandards,
  getIndicators,
  isEarlyChildhood,
} from './curriculum';
import type {
  CurriculumData,
  LongTermPlanInput,
  LongTermPlanData,
  UnitBriefInput,
} from './types';
import {
  buildLongTermSystemInstruction,
  buildLongTermPlanPrompt,
  buildLongTermKPAPrompt,
  buildLongTermRefinePrompt,
  parseLongTermPlanResponse,
  generateStandardLongTermPlan,
} from './longTermTemplates';
import {
  exportLongTermToDocx,
  copyLongTermRichText,
} from './longTermExporter';
import { callGemini, isByokEnabled, getStoredApiKey } from './gemini';
import { sendTelemetry } from './telemetry';

export interface LongTermModuleCallbacks {
  startStopwatch: (title?: string, steps?: string[]) => void;
  stopStopwatch: () => void;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

const STORAGE_KEY_LONGTERM_DRAFT = 'eduplan_longterm_draft';

// ค่าเริ่มต้นของ Input
const defaultInputs: LongTermPlanInput = {
  gradeId: 'm2',
  gradeName: 'มัธยมศึกษาปีที่ 2',
  subjectGroupId: 'science',
  subjectGroupName: 'วิทยาศาสตร์และเทคโนโลยี',
  courseCode: 'ว22101',
  courseName: 'วิทยาการคำนวณ 2',
  totalHours: 40,
  totalCredits: 1.0,
  totalUnits: 4,
  usePerUnitDetail: false,
  unitBriefs: [
    { unitNumber: 1, title: '', description: '', hours: 10 },
    { unitNumber: 2, title: '', description: '', hours: 10 },
    { unitNumber: 3, title: '', description: '', hours: 10 },
    { unitNumber: 4, title: '', description: '', hours: 8 },
  ],
  courseOverviewPrompt: '',
  selectedIndicators: [],
  kObjective: '',
  pObjective: '',
  aObjective: '',
  teachingMethods: ['Active Learning', 'Project-Based Learning (PBL)'],
  scoringMethods: [],
  courseDirections: ['เน้นปฏิบัติจริง', 'ฝึกคิดวิเคราะห์'],
  customConstraints: '',
  teacherName: '',
  semester: '1',
  academicYear: '2569',
};

class LongTermController {
  private currentStep = 1;
  private maxStep = 10;
  private inputs: LongTermPlanInput = { ...defaultInputs };
  private planData: LongTermPlanData | null = null;
  private curriculumData: CurriculumData | null = null;
  private callbacks: LongTermModuleCallbacks | null = null;
  private isAutoScoring = true;
  private activeStandardForModal: any = null;

  public async init(callbacks: LongTermModuleCallbacks) {
    this.callbacks = callbacks;
    try {
      this.curriculumData = await loadCurriculum();
    } catch (e) {
      console.warn('Failed to load curriculum in LongTerm module:', e);
    }

    this.loadDraft();
    this.bindEvents();
    this.renderCurrentStep();
    this.syncFormInputs();

    if (this.planData) {
      this.renderPreview();
      const previewView = document.getElementById('lt-preview-view');
      if (previewView) previewView.classList.remove('hidden');
    }
  }

  private saveDraft() {
    try {
      const dataToSave = {
        inputs: this.inputs,
        planData: this.planData,
        currentStep: this.currentStep,
        isAutoScoring: this.isAutoScoring,
      };
      localStorage.setItem(STORAGE_KEY_LONGTERM_DRAFT, JSON.stringify(dataToSave));
    } catch {
      // ignore
    }
  }

  private loadDraft(): boolean {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_LONGTERM_DRAFT);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.inputs) {
          this.inputs = { ...defaultInputs, ...parsed.inputs };
          this.planData = parsed.planData || null;
          this.currentStep = parsed.currentStep || 1;
          this.isAutoScoring = parsed.isAutoScoring ?? true;
          return true;
        }
      }
    } catch {
      // ignore
    }
    return false;
  }

  public resetData() {
    this.inputs = { ...defaultInputs };
    this.planData = null;
    this.currentStep = 1;
    this.isAutoScoring = true;
    localStorage.removeItem(STORAGE_KEY_LONGTERM_DRAFT);
    const previewView = document.getElementById('lt-preview-view');
    if (previewView) previewView.classList.add('hidden');
    this.renderCurrentStep();
    this.syncFormInputs();
    this.switchView('wizard');
    this.callbacks?.showToast('รีเซ็ตข้อมูลโครงการจัดการเรียนรู้เรียบร้อย', 'info');
  }

  private bindEvents() {
    // Navigation Dots
    document.querySelectorAll('.lt-wizard-dot').forEach(dot => {
      dot.addEventListener('click', () => {
        const step = parseInt((dot as HTMLElement).dataset.step || '1', 10);
        this.goToStep(step);
      });
    });

    // Prev / Next Buttons
    document.getElementById('lt-btn-prev')?.addEventListener('click', () => {
      if (this.currentStep > 1) {
        this.goToStep(this.currentStep - 1);
      }
    });

    document.getElementById('lt-btn-next')?.addEventListener('click', () => {
      if (this.currentStep < this.maxStep) {
        this.goToStep(this.currentStep + 1);
      }
    });

    // Step 1: Grade Selection
    document.querySelectorAll('.lt-grade-card').forEach(card => {
      card.addEventListener('click', () => {
        const el = card as HTMLElement;
        const gid = el.dataset.gradeId || '';
        const gname = el.dataset.gradeName || '';
        this.inputs.gradeId = gid;
        this.inputs.gradeName = gname;
        this.updateGradeSelectionUI();
        this.saveDraft();
        this.renderStandardsList(); // Refresh indicators for this grade
      });
    });

    // Step 2: Subject Cards & Course Info
    document.querySelectorAll('.lt-subject-card').forEach(card => {
      card.addEventListener('click', () => {
        const el = card as HTMLElement;
        const subId = el.dataset.subject || 'science';
        const subName = el.dataset.name || 'วิทยาศาสตร์และเทคโนโลยี';
        this.inputs.subjectGroupId = subId;
        this.inputs.subjectGroupName = subName;
        this.updateSubjectSelectionUI();
        this.saveDraft();
        this.renderStandardsList(); // Refresh indicators for this subject
      });
    });

    const codeInput = document.getElementById('lt-course-code') as HTMLInputElement;
    codeInput?.addEventListener('input', () => {
      this.inputs.courseCode = codeInput.value;
      this.saveDraft();
    });

    const nameInput = document.getElementById('lt-course-name') as HTMLInputElement;
    nameInput?.addEventListener('input', () => {
      this.inputs.courseName = nameInput.value;
      this.saveDraft();
    });

    // Step 3: Total Hours & Credits
    document.querySelectorAll('.lt-quick-hour-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = parseInt((btn as HTMLElement).dataset.hours || '40', 10);
        this.setHours(val);
      });
    });

    const hoursInput = document.getElementById('lt-total-hours') as HTMLInputElement;
    hoursInput?.addEventListener('input', () => {
      const val = parseInt(hoursInput.value, 10) || 0;
      this.setHours(val, false);
    });

    const creditsInput = document.getElementById('lt-total-credits') as HTMLInputElement;
    creditsInput?.addEventListener('input', () => {
      this.inputs.totalCredits = parseFloat(creditsInput.value) || 0;
      this.saveDraft();
    });

    // Step 4: Total Units & Overview
    const unitsInput = document.getElementById('lt-total-units') as HTMLInputElement;
    unitsInput?.addEventListener('change', () => {
      let num = parseInt(unitsInput.value, 10) || 4;
      num = Math.max(2, Math.min(10, num));
      unitsInput.value = String(num);
      this.inputs.totalUnits = num;
      this.renderUnitCards();
      this.saveDraft();
    });

    const toggleUnitsBtn = document.getElementById('lt-btn-toggle-units');
    const unitsContainer = document.getElementById('lt-unit-cards-container');
    toggleUnitsBtn?.addEventListener('click', () => {
      this.inputs.usePerUnitDetail = !this.inputs.usePerUnitDetail;
      if (unitsContainer) {
        unitsContainer.classList.toggle('hidden', !this.inputs.usePerUnitDetail);
      }
      if (toggleUnitsBtn) {
        toggleUnitsBtn.innerHTML = this.inputs.usePerUnitDetail
          ? `<svg class="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 12h-15" /></svg><span>ซ่อนรายละเอียดแยกหน่วยการเรียนรู้</span>`
          : `<svg class="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg><span>กดอธิบายแยกหน่วยการเรียนรู้</span>`;
      }
      if (this.inputs.usePerUnitDetail) {
        this.renderUnitCards();
      }
      this.saveDraft();
    });

    const overviewInput = document.getElementById('lt-course-overview') as HTMLTextAreaElement;
    overviewInput?.addEventListener('input', () => {
      this.inputs.courseOverviewPrompt = overviewInput.value;
      this.saveDraft();
    });

    // Step 5: Indicators Search, Modal & Custom Adder
    const indicatorSearch = document.getElementById('lt-indicator-search') as HTMLInputElement;
    indicatorSearch?.addEventListener('input', () => {
      this.filterIndicators(indicatorSearch.value.trim().toLowerCase());
    });

    document.getElementById('lt-btn-add-custom-ind')?.addEventListener('click', () => {
      this.addCustomIndicator();
    });

    // Step 5 Modal Controls
    document.getElementById('lt-ind-modal-close')?.addEventListener('click', () => {
      this.closeIndicatorModal();
    });
    document.getElementById('lt-ind-modal-done')?.addEventListener('click', () => {
      this.closeIndicatorModal();
    });
    document.getElementById('lt-ind-modal-clear')?.addEventListener('click', () => {
      if (this.activeStandardForModal && this.curriculumData) {
        const std = this.activeStandardForModal;
        const indicators = getIndicators(std, this.inputs.gradeId, this.curriculumData);
        indicators.forEach(ind => {
          this.inputs.selectedIndicators = this.inputs.selectedIndicators.filter(i =>
            !i.startsWith(ind.code) && i !== ind.code && i !== ind.id
          );
        });
        this.populateIndicatorModalList(std);
        this.updateIndicatorsCounter();
        this.saveDraft();
      }
    });

    // Step 6: K-P-A Textareas & AI Generator
    const kInput = document.getElementById('lt-kpa-k') as HTMLTextAreaElement;
    const pInput = document.getElementById('lt-kpa-p') as HTMLTextAreaElement;
    const aInput = document.getElementById('lt-kpa-a') as HTMLTextAreaElement;

    kInput?.addEventListener('input', () => { this.inputs.kObjective = kInput.value; this.saveDraft(); });
    pInput?.addEventListener('input', () => { this.inputs.pObjective = pInput.value; this.saveDraft(); });
    aInput?.addEventListener('input', () => { this.inputs.aObjective = aInput.value; this.saveDraft(); });

    document.getElementById('lt-btn-ai-kpa')?.addEventListener('click', () => {
      this.generateKPAPromptAI();
    });

    // Step 7: Teaching Methods (Multi-select)
    document.querySelectorAll('.lt-method-card').forEach(card => {
      card.addEventListener('click', () => {
        const method = (card as HTMLElement).dataset.method || '';
        this.toggleTeachingMethod(method, card as HTMLElement);
      });
    });

    // Step 8: Scoring Methods (Multi-select & Auto Toggle)
    document.querySelectorAll('.lt-scoring-card').forEach(card => {
      card.addEventListener('click', () => {
        const method = (card as HTMLElement).dataset.method || '';
        this.toggleScoringMethod(method, card as HTMLElement);
      });
    });

    const autoScoringRadio = document.getElementById('lt-auto-scoring-toggle') as HTMLInputElement;
    autoScoringRadio?.addEventListener('change', () => {
      this.isAutoScoring = autoScoringRadio.checked;
      if (this.isAutoScoring) {
        this.inputs.scoringMethods = [];
        document.querySelectorAll('.lt-scoring-card').forEach(c => c.classList.remove('active', 'border-blue-600', 'bg-blue-50/50'));
      }
      this.saveDraft();
    });

    // Step 9: Course Directions & Constraints
    document.querySelectorAll('.lt-direction-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const dir = (pill as HTMLElement).dataset.direction || '';
        this.toggleCourseDirection(dir, pill as HTMLElement);
      });
    });

    const constraintsInput = document.getElementById('lt-custom-constraints') as HTMLTextAreaElement;
    constraintsInput?.addEventListener('input', () => {
      this.inputs.customConstraints = constraintsInput.value;
      this.saveDraft();
    });

    // Step 10: Teacher Info & Generation Buttons
    const teacherInput = document.getElementById('lt-teacher-name') as HTMLInputElement;
    const semesterInput = document.getElementById('lt-semester') as HTMLSelectElement;
    const yearInput = document.getElementById('lt-academic-year') as HTMLInputElement;

    teacherInput?.addEventListener('input', () => { this.inputs.teacherName = teacherInput.value; this.saveDraft(); });
    semesterInput?.addEventListener('change', () => { this.inputs.semester = semesterInput.value; this.saveDraft(); });
    yearInput?.addEventListener('input', () => { this.inputs.academicYear = yearInput.value; this.saveDraft(); });

    document.getElementById('lt-btn-gen-fast')?.addEventListener('click', () => {
      this.generatePlan('fast');
    });

    document.getElementById('lt-btn-gen-precision')?.addEventListener('click', () => {
      this.generatePlan('precision');
    });

    // Preview Action Buttons
    document.getElementById('lt-btn-back-wizard')?.addEventListener('click', () => {
      this.switchView('wizard');
    });

    document.getElementById('lt-btn-refine')?.addEventListener('click', () => {
      this.executeAIRefine();
    });

    document.getElementById('lt-btn-copy-word')?.addEventListener('click', async () => {
      await this.handleCopyRichText();
    });

    document.getElementById('lt-btn-export-docx')?.addEventListener('click', async () => {
      await this.handleExportDocx();
    });

    document.getElementById('lt-btn-print')?.addEventListener('click', () => {
      window.print();
    });
  }

  private setHours(hours: number, updateInput = true) {
    this.inputs.totalHours = hours;
    this.inputs.totalCredits = parseFloat((hours / 40).toFixed(1));

    if (updateInput) {
      const hoursInput = document.getElementById('lt-total-hours') as HTMLInputElement;
      if (hoursInput) hoursInput.value = String(hours);
    }
    const creditsInput = document.getElementById('lt-total-credits') as HTMLInputElement;
    if (creditsInput) creditsInput.value = String(this.inputs.totalCredits);

    // Update active state of quick buttons
    document.querySelectorAll('.lt-quick-hour-btn').forEach(btn => {
      const h = parseInt((btn as HTMLElement).dataset.hours || '0', 10);
      btn.classList.toggle('bg-blue-600', h === hours);
      btn.classList.toggle('text-white', h === hours);
      btn.classList.toggle('bg-slate-100', h !== hours);
      btn.classList.toggle('text-slate-700', h !== hours);
    });

    this.saveDraft();
  }

  private goToStep(step: number) {
    this.currentStep = Math.max(1, Math.min(this.maxStep, step));
    this.renderCurrentStep();
    this.saveDraft();
  }

  private renderCurrentStep() {
    // Hide all step panels
    document.querySelectorAll('.lt-step-panel').forEach(p => p.classList.add('hidden'));

    // Show current step panel
    const currentPanel = document.getElementById(`lt-step-panel-${this.currentStep}`);
    if (currentPanel) {
      currentPanel.classList.remove('hidden');
    }

    // Update Title & Subtitle prominently in Header
    const stepTitles = [
      'เลือกระดับชั้นการศึกษา (Grade Level)',
      'กลุ่มสาระการเรียนรู้และรายวิชา (Subject & Course Info)',
      'จำนวนชั่วโมงรวมและหน่วยกิต (Total Hours & Credits)',
      'จำนวนหน่วยการเรียนรู้ และคำอธิบายโครงการ (Units & Overview)',
      'มาตรฐานและตัวชี้วัด (Standards & Indicators)',
      'จุดประสงค์การเรียนรู้ของโครงการ (K-P-A)',
      'วิธีจัดการเรียนรู้ (Teaching Methods)',
      'วิธีจัดเก็บคะแนน (Scoring Methods)',
      'ทิศทางของโครงการ & ข้อกำหนดเพิ่มเติม (Direction & Constraints)',
      'ข้อมูลผู้สอน และสั่งสร้างโครงการ (Teacher Info & Generation)',
    ];

    const stepSubtitles = [
      'เลือกระดับชั้นตั้งแต่ ปฐมวัย (อ.1 - อ.3), ประถมศึกษา (ป.1 - ป.6) ถึง มัธยมศึกษา (ม.1 - ม.6)',
      'เลือกการ์ดกลุ่มสาระการเรียนรู้ พร้อมระบุรหัสวิชาและชื่อรายวิชา',
      'กำหนดเวลาเรียนตลอดภาคเรียน ระบบจะคำนวณหน่วยกิตให้อัตโนมัติ (40 ชม. = 1.0 นก.)',
      'ระบุจำนวนหน่วยและหัวข้อเนื้อหาที่ต้องการจัดการเรียนรู้ตลอดภาคเรียน',
      'คลิกที่การ์ดมาตรฐานเพื่อเปิดหน้าต่าง Popup เลือกตัวชี้วัดที่ต้องการ (เลือกได้หลายมาตรฐาน)',
      'ระบุจุดประสงค์ด้านความรู้ (K) ทักษะ (P) และคุณลักษณะ (A) หรือให้ AI ช่วยร่าง',
      'เลือกรูปแบบการจัดการเรียนรู้ที่ใช้ (เลือกได้มากกว่า 1 รูปแบบ AI จะนำไปกระจายลงสัปดาห์ต่างๆ)',
      'เลือกวิธีเก็บคะแนนระหว่างเรียน 80 คะแนน และปลายภาค 20 คะแนน (หรือให้ AI วิเคราะห์อัตโนมัติ)',
      'เลือกบรรยากาศการเรียนรู้และใส่เงื่อนไขเฉพาะของโรงเรียนหรือสื่อที่ใช้',
      'ตรวจสอบสรุปรายการข้อมูลทั้งหมด และเลือกโหมดสั่งสร้างโครงการจัดการเรียนรู้',
    ];

    const titleEl = document.getElementById('lt-wizard-step-title');
    if (titleEl) {
      titleEl.textContent = `ขั้นตอนที่ ${this.currentStep}: ${stepTitles[this.currentStep - 1]}`;
    }

    const subtitleEl = document.getElementById('lt-wizard-step-subtitle');
    if (subtitleEl) {
      subtitleEl.textContent = stepSubtitles[this.currentStep - 1];
    }

    const counterEl = document.getElementById('lt-wizard-step-counter');
    if (counterEl) {
      counterEl.textContent = `ขั้นตอนที่ ${this.currentStep} จาก ${this.maxStep}`;
    }

    document.querySelectorAll('.lt-wizard-dot').forEach(dot => {
      const dotEl = dot as HTMLElement;
      const s = parseInt(dotEl.dataset.step || '1', 10);

      dotEl.className = 'lt-wizard-dot h-2 rounded-full transition-all duration-200 cursor-pointer';
      if (s === this.currentStep) {
        dotEl.classList.add('w-8', 'bg-blue-600');
      } else if (s < this.currentStep) {
        dotEl.classList.add('w-2', 'bg-blue-300');
      } else {
        dotEl.classList.add('w-2', 'bg-slate-200');
      }
    });

    // Update Prev / Next Buttons
    const prevBtn = document.getElementById('lt-btn-prev') as HTMLButtonElement;
    const nextBtn = document.getElementById('lt-btn-next') as HTMLButtonElement;

    if (prevBtn) {
      prevBtn.disabled = this.currentStep === 1;
    }
    if (nextBtn) {
      nextBtn.classList.toggle('hidden', this.currentStep === this.maxStep);
    }

    // If reaching step 10, update Summary Checklist
    if (this.currentStep === 10) {
      this.updateSummaryChecklist();
    }
  }

  private updateGradeSelectionUI() {
    document.querySelectorAll('.lt-grade-card').forEach(card => {
      const el = card as HTMLElement;
      const isSelected = el.dataset.gradeId === this.inputs.gradeId;
      el.classList.toggle('border-blue-600', isSelected);
      el.classList.toggle('bg-blue-50/50', isSelected);
      el.classList.toggle('shadow-sm', isSelected);
      el.classList.toggle('border-slate-200', !isSelected);
    });
  }

  private renderUnitCards() {
    const container = document.getElementById('lt-unit-cards-container');
    if (!container) return;
    container.innerHTML = '';

    const count = this.inputs.totalUnits || 4;
    for (let i = 1; i <= count; i++) {
      let brief = this.inputs.unitBriefs.find(u => u.unitNumber === i);
      if (!brief) {
        brief = { unitNumber: i, title: '', description: '', hours: Math.floor(this.inputs.totalHours / count) };
        this.inputs.unitBriefs.push(brief);
      }

      const card = document.createElement('div');
      card.className = 'p-3 bg-white border border-slate-200 rounded-xl space-y-2';
      card.innerHTML = `
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-slate-800">หน่วยการเรียนรู้ที่ ${i}</span>
          <div class="flex items-center gap-1.5">
            <span class="text-[11px] text-slate-500">เวลา:</span>
            <input type="number" class="lt-unit-hours form-input-clean text-xs w-16 py-1 px-1.5 text-center font-bold" min="1" max="80" value="${brief.hours || 10}" data-unit="${i}" />
            <span class="text-[11px] text-slate-500">ชม.</span>
          </div>
        </div>
        <div>
          <input type="text" class="lt-unit-title form-input-clean text-xs w-full py-1.5 px-2" placeholder="ชื่อหน่วยการเรียนรู้ (เช่น ความรู้เบื้องต้นเกี่ยวกับเทคโนโลยี)" value="${brief.title || ''}" data-unit="${i}" />
        </div>
        <div>
          <textarea class="lt-unit-desc form-textarea-clean text-xs w-full py-1.5 px-2" rows="2" placeholder="หัวข้อหรือเรื่องที่สอนในหน่วยนี้ (เว้นว่างได้ ให้ AI ช่วยคิดต่อให้)" data-unit="${i}">${brief.description || ''}</textarea>
        </div>
      `;

      // Event listeners
      card.querySelector('.lt-unit-hours')?.addEventListener('input', (e) => {
        const val = parseInt((e.target as HTMLInputElement).value, 10) || 0;
        const b = this.inputs.unitBriefs.find(u => u.unitNumber === i);
        if (b) b.hours = val;
        this.saveDraft();
      });

      card.querySelector('.lt-unit-title')?.addEventListener('input', (e) => {
        const val = (e.target as HTMLInputElement).value;
        const b = this.inputs.unitBriefs.find(u => u.unitNumber === i);
        if (b) b.title = val;
        this.saveDraft();
      });

      card.querySelector('.lt-unit-desc')?.addEventListener('input', (e) => {
        const val = (e.target as HTMLTextAreaElement).value;
        const b = this.inputs.unitBriefs.find(u => u.unitNumber === i);
        if (b) b.description = val;
        this.saveDraft();
      });

      container.appendChild(card);
    }
  }

  private updateSubjectSelectionUI() {
    document.querySelectorAll('.lt-subject-card').forEach(card => {
      const el = card as HTMLElement;
      const isSelected = el.dataset.subject === this.inputs.subjectGroupId;
      el.classList.toggle('active', isSelected);
      el.classList.toggle('border-2', isSelected);
      el.classList.toggle('border-blue-600', isSelected);
      el.classList.toggle('bg-blue-50/50', isSelected);
      el.classList.toggle('shadow-xs', isSelected);
      el.classList.toggle('border-slate-200', !isSelected);
      el.classList.toggle('bg-white', !isSelected);
    });
  }

  private renderStandardsList() {
    const grid = document.getElementById('lt-standards-grid');
    if (!grid || !this.curriculumData) return;
    grid.innerHTML = '';

    const standards = getStandards(this.curriculumData, this.inputs.subjectGroupId, this.inputs.gradeId);
    if (!standards || standards.length === 0) {
      grid.innerHTML = `
        <div class="col-span-1 sm:col-span-2 text-center py-8 bg-white border border-slate-200 rounded-xl text-slate-400 text-xs">
          <p class="font-medium text-slate-600 mb-1">ไม่พบมาตรฐานการเรียนรู้ตรงกับชั้นและกลุ่มสาระนี้</p>
          <p>(สามารถกดปุ่ม "เพิ่มตัวชี้วัดกำหนดเอง" ด้านบน เพื่อกำหนดตัวชี้วัดได้)</p>
        </div>
      `;
      this.updateIndicatorsCounter();
      return;
    }

    standards.forEach(std => {
      const indicators = getIndicators(std, this.inputs.gradeId, this.curriculumData!);
      const selectedCount = indicators.filter(ind => {
        const fullText = `${ind.code}: ${ind.text}`;
        return this.inputs.selectedIndicators.includes(fullText) ||
               this.inputs.selectedIndicators.includes(ind.code) ||
               this.inputs.selectedIndicators.includes(ind.id);
      }).length;
      const hasSelection = selectedCount > 0;

      const card = document.createElement('div');
      card.className = `lt-standard-card choice-card text-left p-4 rounded-xl border transition-all cursor-pointer bg-white ${
        hasSelection ? 'active border-2 border-blue-600 bg-blue-50/40 shadow-xs' : 'border-slate-200 hover:border-blue-400'
      }`;
      card.setAttribute('data-std-code', std.code);

      const strandInfo = std.strand ? `<div class="text-xs text-blue-600 font-semibold mb-1">${std.strand}</div>` : '';
      const stdTitle = std.title || std.label || '';

      card.innerHTML = `
        <div class="flex items-start justify-between gap-2 mb-1.5">
          <span class="font-bold text-slate-900 text-base font-mono">${std.code}</span>
          ${hasSelection
            ? `<span class="text-xs bg-blue-100 text-blue-800 font-semibold px-2.5 py-0.5 rounded-full">เลือกแล้ว ${selectedCount} ข้อ</span>`
            : `<span class="text-xs text-slate-400">คลิกเพื่อเลือกตัวชี้วัด</span>`
          }
        </div>
        ${strandInfo}
        <p class="text-xs text-slate-600 line-clamp-3 leading-relaxed">${stdTitle}</p>
      `;

      card.addEventListener('click', () => {
        this.openIndicatorModal(std);
      });

      grid.appendChild(card);
    });

    this.updateIndicatorsCounter();
  }

  private openIndicatorModal(standard: any) {
    this.activeStandardForModal = standard;
    const modal = document.getElementById('lt-indicator-modal-overlay');
    const title = document.getElementById('lt-ind-modal-title');
    const subtitle = document.getElementById('lt-ind-modal-subtitle');

    if (!modal) return;

    const stdTitle = standard.title || standard.label || '';
    if (title) title.textContent = `มาตรฐาน ${standard.code}: ${stdTitle}`;
    if (subtitle) subtitle.textContent = `เลือกตัวชี้วัดสำหรับชั้น ${this.inputs.gradeName} ได้หลายข้อ แล้วกดเรียบร้อย`;

    this.populateIndicatorModalList(standard);

    modal.style.display = 'flex';
    modal.classList.remove('hidden');
  }

  private populateIndicatorModalList(standard: any) {
    const list = document.getElementById('lt-ind-modal-list');
    if (!list || !this.curriculumData) return;
    list.innerHTML = '';

    const indicators = getIndicators(standard, this.inputs.gradeId, this.curriculumData);
    if (!indicators || indicators.length === 0) {
      list.innerHTML = '<p class="text-slate-400 text-xs italic py-4 text-center">ไม่มีตัวชี้วัดในระดับชั้นนี้</p>';
      return;
    }

    indicators.forEach(ind => {
      const fullText = `${ind.code}: ${ind.text}`;
      const isChecked = this.inputs.selectedIndicators.includes(fullText) ||
                        this.inputs.selectedIndicators.includes(ind.code) ||
                        this.inputs.selectedIndicators.includes(ind.id);

      const row = document.createElement('label');
      row.className = `choice-card flex items-start gap-3 cursor-pointer p-3 rounded-xl border transition-all ${
        isChecked ? 'active border-2 border-blue-600 bg-blue-50/50 shadow-xs' : 'border-slate-200 bg-white hover:border-blue-300'
      }`;

      row.innerHTML = `
        <input type="checkbox" class="mt-1 w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer" ${isChecked ? 'checked' : ''}>
        <div class="flex-1">
          <div class="font-bold text-slate-900 text-sm font-mono">${ind.code}</div>
          <div class="text-xs text-slate-600 mt-0.5 leading-relaxed">${ind.text}</div>
        </div>
      `;

      const cb = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
      cb.addEventListener('change', () => {
        if (cb.checked) {
          if (!this.inputs.selectedIndicators.includes(fullText)) {
            this.inputs.selectedIndicators.push(fullText);
          }
          row.className = 'choice-card active border-2 border-blue-600 bg-blue-50/50 shadow-xs flex items-start gap-3 cursor-pointer p-3 rounded-xl transition-all';
        } else {
          this.inputs.selectedIndicators = this.inputs.selectedIndicators.filter(i =>
            !i.startsWith(ind.code) && i !== ind.code && i !== ind.id
          );
          row.className = 'choice-card border-slate-200 bg-white hover:border-blue-300 flex items-start gap-3 cursor-pointer p-3 rounded-xl border transition-all';
        }
        this.updateIndicatorsCounter();
        this.saveDraft();
      });

      list.appendChild(row);
    });
  }

  private closeIndicatorModal() {
    const modal = document.getElementById('lt-indicator-modal-overlay');
    if (modal) {
      modal.style.display = 'none';
      modal.classList.add('hidden');
    }
    this.renderStandardsList();
  }

  private filterIndicators(keyword: string) {
    document.querySelectorAll('#lt-standards-grid .lt-standard-card').forEach(card => {
      const cardEl = card as HTMLElement;
      if (!keyword) {
        cardEl.classList.remove('hidden');
        return;
      }

      const text = cardEl.textContent?.toLowerCase() || '';
      const match = text.includes(keyword);
      cardEl.classList.toggle('hidden', !match);
    });
  }

  private addCustomIndicator() {
    const custom = window.prompt('พิมพ์รหัสและข้อความตัวชี้วัดกำหนดเอง เช่น "ว 4.2 ม.2/1 ออกแบบอัลกอริทึม":');
    if (custom && custom.trim()) {
      const clean = custom.trim();
      if (!this.inputs.selectedIndicators.includes(clean)) {
        this.inputs.selectedIndicators.push(clean);
        this.updateIndicatorsCounter();
        this.saveDraft();
        this.callbacks?.showToast(`เพิ่มตัวชี้วัด "${clean}" สำเร็จ`, 'success');
      }
    }
  }

  private updateIndicatorsCounter() {
    const badge = document.getElementById('lt-indicators-counter-badge');
    if (badge) {
      const count = this.inputs.selectedIndicators.length;
      badge.textContent = `เลือกแล้ว ${count} ตัวชี้วัด`;
      badge.className = count > 0
        ? 'text-xs px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold'
        : 'text-xs px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200 font-medium';
    }
  }

  private async generateKPAPromptAI() {
    const btn = document.getElementById('lt-btn-ai-kpa') as HTMLButtonElement;
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<svg class="w-4 h-4 animate-spin mr-1" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg><span>กำลังร่าง K-P-A...</span>`;
    }

    try {
      this.callbacks?.showToast('กำลังให้ AI วิเคราะห์ร่างจุดประสงค์ K-P-A...', 'info');
      const prompt = buildLongTermKPAPrompt(this.inputs);
      const res = await callGemini(prompt, 'ตอบกลับเป็น JSON { "k": "...", "p": "...", "a": "..." } สั้นกระชับ', 2048, 'kpa');

      let parsed: any = null;
      try {
        let clean = res.text.trim();
        if (clean.startsWith('```')) {
          clean = clean.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
        }
        parsed = JSON.parse(clean);
      } catch {
        // fallback regex matching
        const kMatch = res.text.match(/"k":\s*"([^"]+)"/);
        const pMatch = res.text.match(/"p":\s*"([^"]+)"/);
        const aMatch = res.text.match(/"a":\s*"([^"]+)"/);
        if (kMatch || pMatch || aMatch) {
          parsed = {
            k: kMatch ? kMatch[1].replace(/\\n/g, '\n') : '',
            p: pMatch ? pMatch[1].replace(/\\n/g, '\n') : '',
            a: aMatch ? aMatch[1].replace(/\\n/g, '\n') : '',
          };
        }
      }

      if (parsed) {
        if (parsed.k) {
          this.inputs.kObjective = parsed.k;
          const kEl = document.getElementById('lt-kpa-k') as HTMLTextAreaElement;
          if (kEl) kEl.value = parsed.k;
        }
        if (parsed.p) {
          this.inputs.pObjective = parsed.p;
          const pEl = document.getElementById('lt-kpa-p') as HTMLTextAreaElement;
          if (pEl) pEl.value = parsed.p;
        }
        if (parsed.a) {
          this.inputs.aObjective = parsed.a;
          const aEl = document.getElementById('lt-kpa-a') as HTMLTextAreaElement;
          if (aEl) aEl.value = parsed.a;
        }
        this.saveDraft();
        this.callbacks?.showToast('ร่างจุดประสงค์ K-P-A สำเร็จเรียบร้อย!', 'success');
      } else {
        throw new Error('Could not parse KPA response');
      }
    } catch (err: any) {
      console.warn('AI KPA failed:', err);
      this.callbacks?.showToast('ไม่สามารถเชื่อมต่อ AI ร่าง K-P-A ได้ กรุณาลองใหม่อีกครั้ง', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg><span>ให้ AI ช่วยร่างจุดประสงค์ K-P-A ทันที</span>`;
      }
    }
  }

  private toggleTeachingMethod(method: string, card: HTMLElement) {
    const exists = this.inputs.teachingMethods.includes(method);
    if (exists) {
      this.inputs.teachingMethods = this.inputs.teachingMethods.filter(m => m !== method);
      card.classList.remove('border-blue-600', 'bg-blue-50/50', 'shadow-xs');
      card.classList.add('border-slate-200', 'bg-white');
    } else {
      this.inputs.teachingMethods.push(method);
      card.classList.add('border-blue-600', 'bg-blue-50/50', 'shadow-xs');
      card.classList.remove('border-slate-200', 'bg-white');
    }
    this.saveDraft();
  }

  private toggleScoringMethod(method: string, card: HTMLElement) {
    const autoRadio = document.getElementById('lt-auto-scoring-toggle') as HTMLInputElement;
    if (autoRadio) autoRadio.checked = false;
    this.isAutoScoring = false;

    const exists = this.inputs.scoringMethods.includes(method);
    if (exists) {
      this.inputs.scoringMethods = this.inputs.scoringMethods.filter(m => m !== method);
      card.classList.remove('border-blue-600', 'bg-blue-50/50', 'shadow-xs');
      card.classList.add('border-slate-200', 'bg-white');
    } else {
      this.inputs.scoringMethods.push(method);
      card.classList.add('border-blue-600', 'bg-blue-50/50', 'shadow-xs');
      card.classList.remove('border-slate-200', 'bg-white');
    }
    this.saveDraft();
  }

  private toggleCourseDirection(dir: string, pill: HTMLElement) {
    const exists = this.inputs.courseDirections.includes(dir);
    if (exists) {
      this.inputs.courseDirections = this.inputs.courseDirections.filter(d => d !== dir);
      pill.classList.remove('bg-blue-600', 'text-white');
      pill.classList.add('bg-slate-100', 'text-slate-700');
    } else {
      this.inputs.courseDirections.push(dir);
      pill.classList.add('bg-blue-600', 'text-white');
      pill.classList.remove('bg-slate-100', 'text-slate-700');
    }
    this.saveDraft();
  }

  private updateSummaryChecklist() {
    const setSummaryText = (id: string, text: string) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };

    setSummaryText('lt-sum-grade', this.inputs.gradeName || '-');
    setSummaryText('lt-sum-subject', `${this.inputs.courseCode} ${this.inputs.courseName} (${this.inputs.subjectGroupName})`);
    setSummaryText('lt-sum-hours', `${this.inputs.totalHours} ชั่วโมง (${this.inputs.totalCredits} หน่วยกิต)`);
    setSummaryText('lt-sum-units', `${this.inputs.totalUnits} หน่วยการเรียนรู้`);
    setSummaryText('lt-sum-indicators', `${this.inputs.selectedIndicators.length} ตัวชี้วัด`);
    setSummaryText('lt-sum-methods', this.inputs.teachingMethods.join(', ') || 'Active Learning');
    setSummaryText('lt-sum-teacher', `${this.inputs.teacherName || 'ครูผู้สอน'} (ภาคเรียนที่ ${this.inputs.semester}/${this.inputs.academicYear})`);
  }

  private async generatePlan(mode: 'fast' | 'precision') {
    if (!this.inputs.courseName || !this.inputs.courseCode) {
      this.callbacks?.showToast('กรุณาระบุรหัสวิชาและชื่อรายวิชาให้ครบถ้วน', 'error');
      this.goToStep(2);
      return;
    }

    const steps = [
      'วิเคราะห์คำอธิบายรายวิชาและมาตรฐานการเรียนรู้',
      'จัดสรรโครงสร้างหน่วยและคะแนน 100 คะแนน',
      'ออกแบบแผนรายสัปดาห์ 8 คอลัมน์ตลอดภาคเรียน',
      'คำนวณสัดส่วนคะแนนระหว่างเรียน 80 / ปลายภาค 20',
      'จัดทำเอกสารและเกณฑ์การตัดสินผลการเรียนสมบูรณ์',
    ];

    this.callbacks?.startStopwatch(`กำลังสร้างโครงการจัดการเรียนรู้ (${mode === 'fast' ? 'โหมดด่วน' : 'โหมดละเอียดสูง'})...`, steps);
    const startTime = Date.now();

    try {
      const sysInst = buildLongTermSystemInstruction();
      const prompt = buildLongTermPlanPrompt(this.inputs);
      const res = await callGemini(prompt, sysInst, 8192, mode);

      this.planData = parseLongTermPlanResponse(res.text, this.inputs);
      this.saveDraft();

      sendTelemetry({
        subject_id: this.inputs.subjectGroupId || 'longterm',
        grade_level: this.inputs.gradeId || 'general',
        generation_mode: `longterm_${mode}`,
        key_type: isByokEnabled() && getStoredApiKey() ? 'user_byok' : 'system_shared',
        resolved_model: res.resolvedModel || mode,
        duration_seconds: parseFloat(((Date.now() - startTime) / 1000).toFixed(1)),
        export_action: 'generate_longterm',
      });

      this.renderPreview();
      this.switchView('preview');
      this.callbacks?.showToast('สร้างโครงการจัดการเรียนรู้ระยะยาวสำเร็จเรียบร้อย!', 'success');
    } catch (err: any) {
      console.error('Error generating long-term plan:', err);
      // Fallback generator ensures zero failure
      this.planData = generateStandardLongTermPlan(this.inputs);
      this.saveDraft();
      this.renderPreview();
      this.switchView('preview');
      this.callbacks?.showToast('สร้างแผนสำเร็จด้วยระบบสำรองมาตรฐาน (Fallback Engine)', 'info');
    } finally {
      this.callbacks?.stopStopwatch();
    }
  }

  private async executeAIRefine() {
    const inputEl = document.getElementById('lt-refine-input') as HTMLInputElement;
    const instruction = inputEl?.value?.trim();
    if (!instruction) {
      this.callbacks?.showToast('กรุณาระบุคำสั่งที่ต้องการให้ AI ปรับปรุงแก้ไข', 'error');
      return;
    }

    if (!this.planData) {
      this.callbacks?.showToast('ไม่พบข้อมูลโครงการเดิม กรุณาสร้างโครงการก่อน', 'error');
      return;
    }

    const currentDOMData = this.getPlanDataFromDOM();
    this.callbacks?.startStopwatch('กำลังให้ AI ปรับปรุงแก้ไขโครงการตามคำสั่ง...');

    try {
      const prompt = buildLongTermRefinePrompt(currentDOMData, instruction);
      const res = await callGemini(prompt, buildLongTermSystemInstruction(), 8192, 'fast');
      this.planData = parseLongTermPlanResponse(res.text, this.inputs);
      this.saveDraft();
      this.renderPreview();
      if (inputEl) inputEl.value = '';
      this.callbacks?.showToast('ปรับปรุงข้อมูลโครงการตามคำสั่งสำเร็จเรียบร้อย!', 'success');
    } catch (err: any) {
      console.warn('AI Refine failed:', err);
      this.callbacks?.showToast('ไม่สามารถปรับแก้ผ่าน AI ได้ กรุณาลองปรับข้อความในช่องกระดาษโดยตรง', 'error');
    } finally {
      this.callbacks?.stopStopwatch();
    }
  }

  public renderPreview() {
    const container = document.getElementById('lt-preview-content');
    if (!container) return;

    if (!this.planData) {
      this.planData = generateStandardLongTermPlan(this.inputs);
    }
    const data = this.planData;

    container.innerHTML = `
      <div class="a4-paper space-y-6 text-black select-text" style="font-family: 'TH SarabunPSK', 'TH Sarabun New', Sarabun, sans-serif; font-size: 16pt; line-height: 1.35; color: #000000;">

        <!-- ส่วนที่ 1: คำอธิบายรายวิชา -->
        <div class="section-block">
          <h1 class="text-center font-bold mb-4" contenteditable="true" id="lt-dom-p1-title" style="font-size: 18pt; color: #000;">คำอธิบายรายวิชา</h1>
          
          <table class="w-full mb-3 border-none text-left" style="border: none !important; font-size: 16pt;">
            <tr style="border: none !important;">
              <td class="py-1 px-1 text-left font-normal" style="border: none !important; font-size: 16pt;" contenteditable="true" id="lt-dom-p1-h1">กลุ่มสาระการเรียนรู้${data.subjectGroupName} รายวิชา${data.courseName}</td>
              <td class="py-1 px-1 text-right font-normal" style="border: none !important; font-size: 16pt;" contenteditable="true" id="lt-dom-p1-h2">รหัสวิชา ${data.courseCode}</td>
            </tr>
            <tr style="border: none !important;">
              <td class="py-1 px-1 text-left font-normal" style="border: none !important; font-size: 16pt;" contenteditable="true" id="lt-dom-p1-h3">ชั้น${data.gradeName}</td>
              <td class="py-1 px-1 text-right font-normal" style="border: none !important; font-size: 16pt;" contenteditable="true" id="lt-dom-p1-h4">จำนวน ${data.totalHours} ชั่วโมง</td>
            </tr>
            <tr style="border: none !important;">
              <td class="py-1 px-1 text-left font-normal" style="border: none !important; font-size: 16pt;" contenteditable="true" id="lt-dom-p1-h5">ภาคเรียนที่ ${data.semester} ปีการศึกษา ${data.academicYear}</td>
              <td class="py-1 px-1 text-right font-normal" style="border: none !important; font-size: 16pt;" contenteditable="true" id="lt-dom-p1-h6">จำนวน ${data.totalCredits} หน่วยกิต</td>
            </tr>
          </table>

          <div class="space-y-3 mt-4 text-justify" style="font-size: 16pt; line-height: 1.35;">
            <p class="indent-8" contenteditable="true" id="lt-dom-para1" style="font-size: 16pt; text-indent: 1.25cm;">${data.courseDescriptionPara1}</p>
            <p class="indent-8" contenteditable="true" id="lt-dom-para2" style="font-size: 16pt; text-indent: 1.25cm;">${data.courseDescriptionPara2}</p>
          </div>

          <div class="mt-4" style="font-size: 16pt;">
            <h2 class="font-bold mb-2" style="font-size: 16pt; color: #000;">ตัวชี้วัด</h2>
            <div id="lt-dom-indicators-container" class="space-y-1" style="font-size: 16pt;">
              ${(data.indicatorsList || []).map(ind => `<p class="indent-6" contenteditable="true" style="font-size: 16pt; text-indent: 0.8cm;">${ind}</p>`).join('')}
            </div>
            <p class="font-bold mt-2" contenteditable="true" id="lt-dom-total-ind-text" style="font-size: 16pt;">รวม ${data.totalIndicatorsCount || data.indicatorsList?.length || 0} ตัวชี้วัด</p>
          </div>

          <div class="mt-4 space-y-2" style="font-size: 16pt;">
            <h2 class="font-bold" style="font-size: 16pt; color: #000;">จุดประสงค์ด้านการเรียนรู้</h2>
            <div>
              <p class="font-bold" style="font-size: 16pt;">ด้านความรู้ (K)</p>
              <div class="indent-4 whitespace-pre-line" contenteditable="true" id="lt-dom-k" style="font-size: 16pt; padding-left: 0.8cm;">${data.kObjective}</div>
            </div>
            <div>
              <p class="font-bold" style="font-size: 16pt;">ทักษะกระบวนการ (P)</p>
              <div class="indent-4 whitespace-pre-line" contenteditable="true" id="lt-dom-p" style="font-size: 16pt; padding-left: 0.8cm;">${data.pObjective}</div>
            </div>
            <div>
              <p class="font-bold" style="font-size: 16pt;">ด้านคุณลักษณะ (A)</p>
              <div class="indent-4 whitespace-pre-line" contenteditable="true" id="lt-dom-a" style="font-size: 16pt; padding-left: 0.8cm;">${data.aObjective}</div>
            </div>
          </div>
        </div>

        <div class="word-page-break no-print">
          <span>─── ตัวแบ่งหน้า (Page Break) ───</span>
        </div>

        <!-- ส่วนที่ 2: โครงการจัดการเรียนรู้ระยะยาว -->
        <div class="section-block">
          <h1 class="text-center font-bold mb-4" contenteditable="true" style="font-size: 18pt; color: #000;">โครงการจัดการเรียนรู้ระยะยาว</h1>
          
          <table class="w-full mb-3 border-none text-left" style="border: none !important; font-size: 16pt;">
            <tr style="border: none !important;">
              <td class="py-1 px-1 text-left font-normal" style="border: none !important; font-size: 16pt;">กลุ่มสาระการเรียนรู้${data.subjectGroupName} รายวิชา${data.courseName}</td>
              <td class="py-1 px-1 text-right font-normal" style="border: none !important; font-size: 16pt;">รหัสวิชา ${data.courseCode}</td>
            </tr>
            <tr style="border: none !important;">
              <td class="py-1 px-1 text-left font-normal" style="border: none !important; font-size: 16pt;">ชั้น${data.gradeName} ภาคเรียนที่ ${data.semester} ปีการศึกษา ${data.academicYear}</td>
              <td class="py-1 px-1 text-right font-normal" style="border: none !important; font-size: 16pt;">จำนวน ${data.totalHours} ชั่วโมง</td>
            </tr>
            <tr style="border: none !important;">
              <td class="py-1 px-1 text-left font-normal" style="border: none !important; font-size: 16pt;">ผู้สอน ${data.teacherName}</td>
              <td class="py-1 px-1 text-right font-normal" style="border: none !important; font-size: 16pt;">จำนวน ${data.totalCredits} หน่วยกิต</td>
            </tr>
          </table>

          <div class="overflow-x-auto my-3">
            <table class="w-full border-collapse border border-black text-left font-sarabun text-black" style="border: 1px solid #000; font-size: 16pt;">
              <thead>
                <tr class="bg-slate-100 font-bold text-center" style="background-color: #f2f2f2;">
                  <th class="border border-black p-2 w-[8%] text-center" style="border: 1px solid #000; font-size: 16pt;">หน่วยที่</th>
                  <th class="border border-black p-2 w-[24%] text-center" style="border: 1px solid #000; font-size: 16pt;">ชื่อหน่วยการเรียนรู้</th>
                  <th class="border border-black p-2 w-[31%] text-center" style="border: 1px solid #000; font-size: 16pt;">สาระสำคัญ / สาระการเรียนรู้</th>
                  <th class="border border-black p-2 w-[21%] text-center" style="border: 1px solid #000; font-size: 16pt;">มาตรฐาน / ตัวชี้วัด</th>
                  <th class="border border-black p-2 w-[8%] text-center" style="border: 1px solid #000; font-size: 16pt;">เวลา (ชม.)</th>
                  <th class="border border-black p-2 w-[8%] text-center" style="border: 1px solid #000; font-size: 16pt;">คะแนน</th>
                </tr>
              </thead>
              <tbody id="lt-dom-unit-tbody">
                <tr>
                  <td colspan="6" class="border border-black p-2 font-bold text-center bg-slate-50" style="border: 1px solid #000; font-size: 16pt;">ปฐมนิเทศ</td>
                </tr>
                ${(data.unitRows || []).map(u => `
                  <tr>
                    <td class="border border-black p-2 text-center" contenteditable="true" style="border: 1px solid #000; font-size: 16pt;">${u.unitNumber}</td>
                    <td class="border border-black p-2" contenteditable="true" style="border: 1px solid #000; font-size: 16pt;">${u.unitTitle}</td>
                    <td class="border border-black p-2" contenteditable="true" style="border: 1px solid #000; font-size: 16pt;">${u.coreConcept}</td>
                    <td class="border border-black p-2" contenteditable="true" style="border: 1px solid #000; font-size: 16pt;">${u.indicators}</td>
                    <td class="border border-black p-2 text-center font-bold" contenteditable="true" style="border: 1px solid #000; font-size: 16pt;">${u.hours}</td>
                    <td class="border border-black p-2 text-center font-bold" contenteditable="true" style="border: 1px solid #000; font-size: 16pt;">${u.score}</td>
                  </tr>
                `).join('')}
                <tr>
                  <td colspan="5" class="border border-black p-2" contenteditable="true" style="border: 1px solid #000; font-size: 16pt;">การเข้าชั้นเรียน การแต่งกาย จิตพิสัย และความร่วมมือ</td>
                  <td class="border border-black p-2 text-center font-bold" contenteditable="true" style="border: 1px solid #000; font-size: 16pt;">${data.affectiveScore ?? 10}</td>
                </tr>
                <tr>
                  <td colspan="4" class="border border-black p-2" contenteditable="true" style="border: 1px solid #000; font-size: 16pt;">สอบปลายภาค</td>
                  <td class="border border-black p-2 text-center font-bold" contenteditable="true" style="border: 1px solid #000; font-size: 16pt;">${data.finalExamHours ?? 2}</td>
                  <td class="border border-black p-2 text-center font-bold" contenteditable="true" style="border: 1px solid #000; font-size: 16pt;">${data.finalExamScore ?? 20}</td>
                </tr>
                <tr class="font-bold bg-slate-50">
                  <td colspan="4" class="border border-black p-2 text-center" style="border: 1px solid #000; font-size: 16pt;">รวม</td>
                  <td class="border border-black p-2 text-center" style="border: 1px solid #000; font-size: 16pt;">${data.totalHours}</td>
                  <td class="border border-black p-2 text-center" style="border: 1px solid #000; font-size: 16pt;">100</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="word-page-break no-print">
          <span>─── ตัวแบ่งหน้า (Page Break) ───</span>
        </div>

        <!-- ส่วนที่ 3: ตารางแผนการจัดการเรียนรู้รายสัปดาห์ -->
        <div class="section-block">
          <h1 class="text-center font-bold mb-4" contenteditable="true" style="font-size: 18pt; color: #000;">ตารางแผนการจัดการเรียนรู้รายสัปดาห์</h1>
          
          <div class="overflow-x-auto my-3">
            <table class="w-full border-collapse border border-black text-left font-sarabun text-black" style="border: 1px solid #000; font-size: 16pt;">
              <thead>
                <tr class="bg-slate-100 font-bold text-center" style="background-color: #f2f2f2;">
                  <th class="border border-black p-1.5 w-[7%] text-center" style="border: 1px solid #000; font-size: 16pt;">สัปดาห์ที่</th>
                  <th class="border border-black p-1.5 w-[12%] text-center" style="border: 1px solid #000; font-size: 16pt;">ตัวชี้วัด</th>
                  <th class="border border-black p-1.5 w-[15%] text-center" style="border: 1px solid #000; font-size: 16pt;">หน่วยการเรียนรู้/เรื่อง</th>
                  <th class="border border-black p-1.5 w-[14%] text-center" style="border: 1px solid #000; font-size: 16pt;">จุดประสงค์การเรียนรู้</th>
                  <th class="border border-black p-1.5 w-[16%] text-center" style="border: 1px solid #000; font-size: 16pt;">หัวข้อ/สาระสำคัญ</th>
                  <th class="border border-black p-1.5 w-[13%] text-center" style="border: 1px solid #000; font-size: 16pt;">วิธีจัดการเรียนรู้</th>
                  <th class="border border-black p-1.5 w-[11%] text-center" style="border: 1px solid #000; font-size: 16pt;">สื่อ/แหล่งเรียนรู้</th>
                  <th class="border border-black p-1.5 w-[12%] text-center" style="border: 1px solid #000; font-size: 16pt;">การวัดและประเมินผล</th>
                </tr>
              </thead>
              <tbody id="lt-dom-weekly-tbody">
                ${(data.weeklyRows || []).map(w => `
                  ${w.planGroupTitle ? `
                    <tr>
                      <td colspan="8" class="border border-black p-2 font-bold bg-slate-100 text-black" contenteditable="true" style="border: 1px solid #000; font-size: 16pt; background-color: #f2f2f2;">${w.planGroupTitle}</td>
                    </tr>
                  ` : ''}
                  <tr>
                    <td class="border border-black p-1.5 text-center font-bold" contenteditable="true" style="border: 1px solid #000; font-size: 16pt;">${w.weekNumber}</td>
                    <td class="border border-black p-1.5" contenteditable="true" style="border: 1px solid #000; font-size: 16pt;">${w.indicators || '-'}</td>
                    <td class="border border-black p-1.5" contenteditable="true" style="border: 1px solid #000; font-size: 16pt;">${w.unitAndTopic}</td>
                    <td class="border border-black p-1.5" contenteditable="true" style="border: 1px solid #000; font-size: 16pt;">${w.objectives}</td>
                    <td class="border border-black p-1.5" contenteditable="true" style="border: 1px solid #000; font-size: 16pt;">${w.coreContent}</td>
                    <td class="border border-black p-1.5" contenteditable="true" style="border: 1px solid #000; font-size: 16pt;">${w.teachingMethod}</td>
                    <td class="border border-black p-1.5" contenteditable="true" style="border: 1px solid #000; font-size: 16pt;">${w.mediaResources}</td>
                    <td class="border border-black p-1.5" contenteditable="true" style="border: 1px solid #000; font-size: 16pt;">${w.assessment}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="word-page-break no-print">
          <span>─── ตัวแบ่งหน้า (Page Break) ───</span>
        </div>

        <!-- ส่วนที่ 4: ตารางวิธีจัดเก็บคะแนน -->
        <div class="section-block">
          <h1 class="text-center font-bold mb-4" contenteditable="true" style="font-size: 18pt; color: #000;">ตารางวิธีจัดเก็บคะแนน</h1>
          
          <div class="overflow-x-auto my-3 max-w-2xl mx-auto">
            <table class="w-full border-collapse border border-black text-left font-sarabun text-black" style="border: 1px solid #000; font-size: 16pt;">
              <thead>
                <tr class="bg-slate-100 font-bold text-center" style="background-color: #f2f2f2;">
                  <th class="border border-black p-2 w-[12%] text-center" style="border: 1px solid #000; font-size: 16pt;">ลำดับที่</th>
                  <th class="border border-black p-2 w-[72%] text-center" style="border: 1px solid #000; font-size: 16pt;">วิธีจัดเก็บคะแนน</th>
                  <th class="border border-black p-2 w-[16%] text-center" style="border: 1px solid #000; font-size: 16pt;">คะแนน</th>
                </tr>
              </thead>
              <tbody id="lt-dom-scoring-tbody">
                <tr>
                  <td colspan="3" class="border border-black p-2 font-bold bg-slate-50" contenteditable="true" style="border: 1px solid #000; font-size: 16pt;">คะแนนระหว่างเรียน (${data.formativeScoreTotal || 80} คะแนน)</td>
                </tr>
                ${(data.formativeScoringRows || []).map(r => `
                  <tr>
                    <td class="border border-black p-2 text-center" contenteditable="true" style="border: 1px solid #000; font-size: 16pt;">${r.order}</td>
                    <td class="border border-black p-2" contenteditable="true" style="border: 1px solid #000; font-size: 16pt;">${r.methodDescription}</td>
                    <td class="border border-black p-2 text-center font-bold" contenteditable="true" style="border: 1px solid #000; font-size: 16pt;">${r.score}</td>
                  </tr>
                `).join('')}
                <tr>
                  <td colspan="3" class="border border-black p-2 font-bold bg-slate-50" contenteditable="true" style="border: 1px solid #000; font-size: 16pt;">คะแนนสอบปลายภาค (${data.summativeScoreTotal || 20} คะแนน)</td>
                </tr>
                ${(data.summativeScoringRows || []).map(r => `
                  <tr>
                    <td class="border border-black p-2 text-center" contenteditable="true" style="border: 1px solid #000; font-size: 16pt;">${r.order}</td>
                    <td class="border border-black p-2" contenteditable="true" style="border: 1px solid #000; font-size: 16pt;">${r.methodDescription}</td>
                    <td class="border border-black p-2 text-center font-bold" contenteditable="true" style="border: 1px solid #000; font-size: 16pt;">${r.score}</td>
                  </tr>
                `).join('')}
                <tr class="font-bold bg-slate-50">
                  <td colspan="2" class="border border-black p-2 text-center" style="border: 1px solid #000; font-size: 16pt;">รวม</td>
                  <td class="border border-black p-2 text-center" style="border: 1px solid #000; font-size: 16pt;">100</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="mt-6 max-w-2xl mx-auto">
            <h2 class="font-bold mb-2" style="font-size: 16pt; color: #000;">เกณฑ์การตัดสินผลการเรียน</h2>
            <table class="w-full border-collapse border border-black text-center font-sarabun text-black" style="border: 1px solid #000; font-size: 16pt;">
              <thead>
                <tr class="bg-slate-100 font-bold" style="background-color: #f2f2f2;">
                  <th class="border border-black p-2 w-1/3" style="border: 1px solid #000; font-size: 16pt;">เกรด</th>
                  <th class="border border-black p-2 w-2/3" style="border: 1px solid #000; font-size: 16pt;">ช่วงคะแนน</th>
                </tr>
              </thead>
              <tbody>
                <tr><td class="border border-black p-1.5 font-bold" style="border: 1px solid #000; font-size: 16pt;">4</td><td class="border border-black p-1.5" style="border: 1px solid #000; font-size: 16pt;">80 ขึ้นไป</td></tr>
                <tr><td class="border border-black p-1.5" style="border: 1px solid #000; font-size: 16pt;">3.5</td><td class="border border-black p-1.5" style="border: 1px solid #000; font-size: 16pt;">75 - 79</td></tr>
                <tr><td class="border border-black p-1.5" style="border: 1px solid #000; font-size: 16pt;">3</td><td class="border border-black p-1.5" style="border: 1px solid #000; font-size: 16pt;">70 - 74</td></tr>
                <tr><td class="border border-black p-1.5" style="border: 1px solid #000; font-size: 16pt;">2.5</td><td class="border border-black p-1.5" style="border: 1px solid #000; font-size: 16pt;">65 - 69</td></tr>
                <tr><td class="border border-black p-1.5" style="border: 1px solid #000; font-size: 16pt;">2</td><td class="border border-black p-1.5" style="border: 1px solid #000; font-size: 16pt;">60 - 64</td></tr>
                <tr><td class="border border-black p-1.5" style="border: 1px solid #000; font-size: 16pt;">1.5</td><td class="border border-black p-1.5" style="border: 1px solid #000; font-size: 16pt;">55 - 59</td></tr>
                <tr><td class="border border-black p-1.5" style="border: 1px solid #000; font-size: 16pt;">1</td><td class="border border-black p-1.5" style="border: 1px solid #000; font-size: 16pt;">50 - 54</td></tr>
                <tr><td class="border border-black p-1.5 font-bold" style="border: 1px solid #000; font-size: 16pt;">0</td><td class="border border-black p-1.5" style="border: 1px solid #000; font-size: 16pt;">ต่ำกว่า 50</td></tr>
                <tr><td class="border border-black p-1.5" style="border: 1px solid #000; font-size: 16pt;">ร</td><td class="border border-black p-1.5" style="border: 1px solid #000; font-size: 16pt;">ส่งงานไม่ครบ / ยังไม่ตัดสินผลการเรียน</td></tr>
                <tr><td class="border border-black p-1.5" style="border: 1px solid #000; font-size: 16pt;">มส</td><td class="border border-black p-1.5" style="border: 1px solid #000; font-size: 16pt;">มีเวลาเรียนไม่ครบ 80% ของเวลาเรียนทั้งหมด</td></tr>
              </tbody>
            </table>
          </div>
        </div>

      </div>
    `;
  }

  private getPlanDataFromDOM(): LongTermPlanData {
    if (!this.planData) {
      this.planData = generateStandardLongTermPlan(this.inputs);
    }
    const current = { ...this.planData };

    const para1 = document.getElementById('lt-dom-para1');
    if (para1 && para1.textContent) current.courseDescriptionPara1 = para1.textContent.trim();

    const para2 = document.getElementById('lt-dom-para2');
    if (para2 && para2.textContent) current.courseDescriptionPara2 = para2.textContent.trim();

    // Read indicators list from DOM
    const indContainer = document.getElementById('lt-dom-indicators-container');
    if (indContainer) {
      const ps = Array.from(indContainer.querySelectorAll('p'));
      const list = ps.map(p => p.textContent?.trim() || '').filter(Boolean);
      if (list.length > 0) {
        current.indicatorsList = list;
        current.totalIndicatorsCount = list.length;
      }
    }

    const kEl = document.getElementById('lt-dom-k');
    if (kEl && kEl.textContent) current.kObjective = kEl.textContent.trim();

    const pEl = document.getElementById('lt-dom-p');
    if (pEl && pEl.textContent) current.pObjective = pEl.textContent.trim();

    const aEl = document.getElementById('lt-dom-a');
    if (aEl && aEl.textContent) current.aObjective = aEl.textContent.trim();

    // Read unit rows from DOM
    const unitTbody = document.getElementById('lt-dom-unit-tbody');
    if (unitTbody) {
      const rows = Array.from(unitTbody.querySelectorAll('tr'));
      const unitRows: any[] = [];
      rows.forEach(tr => {
        const tds = tr.querySelectorAll('td');
        const text = tr.textContent || '';
        if (tds.length === 6 && !text.includes('ปฐมนิเทศ') && !text.includes('รวม') && !text.includes('จิตพิสัย') && !text.includes('สอบปลายภาค')) {
          unitRows.push({
            unitNumber: parseInt(tds[0]?.textContent?.trim() || '1', 10) || 1,
            unitTitle: tds[1]?.textContent?.trim() || '',
            coreConcept: tds[2]?.textContent?.trim() || '',
            indicators: tds[3]?.textContent?.trim() || '',
            hours: parseInt(tds[4]?.textContent?.trim() || '0', 10) || 0,
            score: parseInt(tds[5]?.textContent?.trim() || '0', 10) || 0,
          });
        }
      });
      if (unitRows.length > 0) current.unitRows = unitRows;
    }

    // Read weekly rows from DOM
    const weeklyTbody = document.getElementById('lt-dom-weekly-tbody');
    if (weeklyTbody) {
      const rows = Array.from(weeklyTbody.querySelectorAll('tr'));
      const weeklyRows: any[] = [];
      let pendingGroupTitle: string | undefined = undefined;
      rows.forEach(tr => {
        const tds = tr.querySelectorAll('td');
        if (tds.length === 1 && tr.textContent) {
          pendingGroupTitle = tr.textContent.trim();
        } else if (tds.length === 8) {
          weeklyRows.push({
            planGroupTitle: pendingGroupTitle,
            weekNumber: parseInt(tds[0]?.textContent?.trim() || '1', 10) || 1,
            indicators: tds[1]?.textContent?.trim() || '-',
            unitAndTopic: tds[2]?.textContent?.trim() || '',
            objectives: tds[3]?.textContent?.trim() || '',
            coreContent: tds[4]?.textContent?.trim() || '',
            teachingMethod: tds[5]?.textContent?.trim() || '',
            mediaResources: tds[6]?.textContent?.trim() || '',
            assessment: tds[7]?.textContent?.trim() || '',
          });
          pendingGroupTitle = undefined;
        }
      });
      if (weeklyRows.length > 0) current.weeklyRows = weeklyRows;
    }

    // Read scoring rows from DOM
    const scoringTbody = document.getElementById('lt-dom-scoring-tbody');
    if (scoringTbody) {
      const rows = Array.from(scoringTbody.querySelectorAll('tr'));
      const formative: any[] = [];
      const summative: any[] = [];
      let inSummative = false;
      rows.forEach(tr => {
        const text = tr.textContent || '';
        if (text.includes('คะแนนสอบปลายภาค')) {
          inSummative = true;
          return;
        }
        if (text.includes('คะแนนระหว่างเรียน') || text.includes('รวม')) return;
        const tds = tr.querySelectorAll('td');
        if (tds.length === 3) {
          const item = {
            order: parseInt(tds[0]?.textContent?.trim() || '1', 10) || 1,
            methodDescription: tds[1]?.textContent?.trim() || '',
            score: parseInt(tds[2]?.textContent?.trim() || '0', 10) || 0,
          };
          if (inSummative) summative.push(item);
          else formative.push(item);
        }
      });
      if (formative.length > 0) current.formativeScoringRows = formative;
      if (summative.length > 0) current.summativeScoringRows = summative;
    }

    return current;
  }

  private async handleCopyRichText() {
    const data = this.getPlanDataFromDOM();
    const success = await copyLongTermRichText(data);
    if (success) {
      this.callbacks?.showToast('คัดลอกเอกสารโครงการลง Clipboard เรียบร้อย! สามารถกด Paste ใน Word ได้ทันที', 'success');
      sendTelemetry({
        subject_id: this.inputs.subjectGroupId || 'longterm',
        grade_level: this.inputs.gradeId || 'general',
        generation_mode: 'longterm_copy',
        key_type: isByokEnabled() && getStoredApiKey() ? 'user_byok' : 'system_shared',
        resolved_model: 'client_clipboard',
        duration_seconds: 0,
        export_action: 'copy_longterm_rich',
      });
    } else {
      this.callbacks?.showToast('ไม่สามารถคัดลอกลง Clipboard ได้', 'error');
    }
  }

  private async handleExportDocx() {
    try {
      const data = this.getPlanDataFromDOM();
      await exportLongTermToDocx(data);
      this.callbacks?.showToast('ส่งออกเอกสาร Word (.docx) สำเร็จเรียบร้อย!', 'success');
      sendTelemetry({
        subject_id: this.inputs.subjectGroupId || 'longterm',
        grade_level: this.inputs.gradeId || 'general',
        generation_mode: 'longterm_docx',
        key_type: isByokEnabled() && getStoredApiKey() ? 'user_byok' : 'system_shared',
        resolved_model: 'client_docx',
        duration_seconds: 0,
        export_action: 'export_longterm_docx',
      });
    } catch (err: any) {
      console.error('Error exporting long-term docx:', err);
      this.callbacks?.showToast('เกิดข้อผิดพลาดในการส่งออกไฟล์ Word: ' + (err?.message || ''), 'error');
    }
  }

  public switchView(view: 'wizard' | 'preview') {
    const wizardView = document.getElementById('lt-wizard-view');
    const previewView = document.getElementById('lt-preview-view');

    // โครงสร้างใหม่: แสดงหน้าพรีวิว A4 ต่อท้ายด้านล่างของ Wizard เสมอเมื่อสั่งเจนเสร็จแล้ว
    if (wizardView) {
      wizardView.classList.remove('hidden');
    }

    if (view === 'preview') {
      if (previewView) {
        previewView.classList.remove('hidden');
        this.renderPreview();
        setTimeout(() => {
          previewView.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 120);
      }
    } else {
      wizardView?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  private syncFormInputs() {
    this.updateGradeSelectionUI();
    this.updateSubjectSelectionUI();

    const codeInput = document.getElementById('lt-course-code') as HTMLInputElement;
    if (codeInput) codeInput.value = this.inputs.courseCode;

    const nameInput = document.getElementById('lt-course-name') as HTMLInputElement;
    if (nameInput) nameInput.value = this.inputs.courseName;

    this.setHours(this.inputs.totalHours);

    const unitsInput = document.getElementById('lt-total-units') as HTMLInputElement;
    if (unitsInput) unitsInput.value = String(this.inputs.totalUnits);

    const overviewInput = document.getElementById('lt-course-overview') as HTMLTextAreaElement;
    if (overviewInput) overviewInput.value = this.inputs.courseOverviewPrompt;

    const kInput = document.getElementById('lt-kpa-k') as HTMLTextAreaElement;
    if (kInput) kInput.value = this.inputs.kObjective;

    const pInput = document.getElementById('lt-kpa-p') as HTMLTextAreaElement;
    if (pInput) pInput.value = this.inputs.pObjective;

    const aInput = document.getElementById('lt-kpa-a') as HTMLTextAreaElement;
    if (aInput) aInput.value = this.inputs.aObjective;

    const constraintsInput = document.getElementById('lt-custom-constraints') as HTMLTextAreaElement;
    if (constraintsInput) constraintsInput.value = this.inputs.customConstraints;

    const teacherInput = document.getElementById('lt-teacher-name') as HTMLInputElement;
    if (teacherInput) teacherInput.value = this.inputs.teacherName;

    const semesterInput = document.getElementById('lt-semester') as HTMLSelectElement;
    if (semesterInput) semesterInput.value = this.inputs.semester;

    const yearInput = document.getElementById('lt-academic-year') as HTMLInputElement;
    if (yearInput) yearInput.value = this.inputs.academicYear;

    // Sync Teaching Methods UI
    document.querySelectorAll('.lt-method-card').forEach(card => {
      const el = card as HTMLElement;
      const m = el.dataset.method || '';
      const isSelected = this.inputs.teachingMethods.includes(m);
      el.classList.toggle('border-blue-600', isSelected);
      el.classList.toggle('bg-blue-50/50', isSelected);
      el.classList.toggle('shadow-xs', isSelected);
      el.classList.toggle('border-slate-200', !isSelected);
      el.classList.toggle('bg-white', !isSelected);
    });

    // Sync Scoring Methods UI
    const autoRadio = document.getElementById('lt-auto-scoring-toggle') as HTMLInputElement;
    if (autoRadio) autoRadio.checked = this.isAutoScoring;

    document.querySelectorAll('.lt-scoring-card').forEach(card => {
      const el = card as HTMLElement;
      const m = el.dataset.method || '';
      const isSelected = !this.isAutoScoring && this.inputs.scoringMethods.includes(m);
      el.classList.toggle('border-blue-600', isSelected);
      el.classList.toggle('bg-blue-50/50', isSelected);
      el.classList.toggle('shadow-xs', isSelected);
    });

    // Sync Directions UI
    document.querySelectorAll('.lt-direction-pill').forEach(pill => {
      const el = pill as HTMLElement;
      const d = el.dataset.direction || '';
      const isSelected = this.inputs.courseDirections.includes(d);
      el.classList.toggle('bg-blue-600', isSelected);
      el.classList.toggle('text-white', isSelected);
      el.classList.toggle('bg-slate-100', !isSelected);
      el.classList.toggle('text-slate-700', !isSelected);
    });

    this.renderStandardsList();
    if (this.inputs.usePerUnitDetail) {
      const unitsContainer = document.getElementById('lt-unit-cards-container');
      if (unitsContainer) unitsContainer.classList.remove('hidden');
      this.renderUnitCards();
    }
  }
}

export const longTermController = new LongTermController();

