/**
 * EduPlan AI — Type Definitions
 * ============================================================
 * สอดคล้องกับ Data Schema ของ public/data/curriculum.json v2.1.0
 * ============================================================
 */

export interface GradeLevel {
  id: string;
  code: string;
  name: string;
  level: string;
  ageRange?: string;
  // Backward compatibility alias
  label?: string;
}

export interface Subject {
  id: string;
  code: string;
  name: string;
  type: string; // 'core' | 'additional'
  description?: string;
  revisionYear?: string;
  targetGrades?: string[];
  // Backward compatibility alias
  label?: string;
}

export interface Indicator {
  id: string;
  code: string;
  text: string;
}

export interface Standard {
  id: string;
  subjectId: string;
  strand: string;
  code: string;
  title: string;
  gradeLevels: Record<string, Indicator[]>;
  // Backward compatibility alias
  label?: string;
}

export interface EarlyChildhoodIndicator {
  age: string;
  text: string;
}

export interface EarlyChildhoodStandard {
  code: string;
  title: string;
  indicators: EarlyChildhoodIndicator[];
}

export interface EarlyChildhoodDomainRaw {
  id: string;
  name: string;
  description: string;
  standards: EarlyChildhoodStandard[];
}

export interface EarlyChildhoodExperience {
  domain: string;
  title: string;
  details: string;
}

export interface EarlyChildhoodLearningStrand {
  id: string;
  name: string;
  description: string;
}

export interface EarlyChildhoodData {
  framework: string;
  domains: EarlyChildhoodDomainRaw[];
  learningStrands?: EarlyChildhoodLearningStrand[];
  experiences?: EarlyChildhoodExperience[];
}

export interface CurriculumMeta {
  version: string;
  curriculumStandard: string;
  authority: string;
  lastUpdated: string;
  totalSubjects: number;
  totalStandards: number;
  totalIndicators: number;
  encoding: string;
}

export interface CurriculumData {
  meta: CurriculumMeta;
  gradeLevels: GradeLevel[];
  subjects: Subject[];
  earlyChildhood: EarlyChildhoodData;
  standards: Standard[];
}

// UI helper domain structure for Early Childhood Checkbox Selector
export interface EarlyChildhoodDomainUI {
  id: string;
  name: string;
  label: string; // compatibility with UI
  description: string;
  experiences: string[];
  standards: EarlyChildhoodStandard[];
}

/** แถวในตารางวัดและประเมินผล (ข้อ 9) */
export interface EvaluationRow {
  dimension: string; // 'ด้านความรู้ (K)' | 'ด้านทักษะและกระบวนการ (P)' | 'ด้านคุณลักษณะอันพึงประสงค์ (A)'
  objective: string;
  method: string;
  tool: string;
  criteria: string;
}

/** โครงสร้างข้อมูลแผนการจัดการเรียนรู้มาตรฐาน 11 หัวข้อ */
export interface LessonPlanData {
  // ส่วนหัวแผน
  course_name?: string; // รายวิชา (เช่น ว22101 วิทยาการคำนวณ)
  subject: string; // กลุ่มสาระการเรียนรู้ (เช่น วิทยาศาสตร์และเทคโนโลยี)
  grade: string;
  unit?: string; // หน่วยการเรียนรู้ (เช่น หน่วยการเรียนรู้ที่ 1 การแก้ปัญหา)
  plan_name?: string; // แผนการจัดการเรียนรู้ (เช่น แผนการจัดการเรียนรู้ที่ 1 เรื่อง...)
  topic: string;
  hours_text: string;
  semester?: string; // ภาคเรียนที่ (เช่น 1 หรือ 2)
  year: string;
  date: string;
  month: string;
  buddhist_year: string;
  school: string;

  // 11 หัวข้อมาตรฐาน
  standards: string;
  indicators: string;
  concept: string;
  k_objective: string;
  p_objective: string;
  a_objective: string;
  learning_content: string;
  competencies: string;
  teaching_model: string;
  activities: string;
  media_resources: string;
  evaluation_rows: EvaluationRow[];
  suggestions: string;
  assignments: string;

  // ข้อมูลท้ายแผน (ข้อ 11)
  teacher_name?: string;
  teacher_position?: string;
}

/** โครงสร้างข้อมูลเกณฑ์การประเมินรูบริกสกอร์ (Rubric Score Generator) */
export interface RubricCriterion {
  aspect: string; // เช่น "1. ด้านความรู้ (Knowledge: K)"
  target: string; // เช่น "สรุปจุดประสงค์ K จากแผน..."
  descriptors: Record<string, string>; // เช่น { "level_3": "...", "level_2": "...", "level_1": "..." }
}

export interface RubricData {
  title: string;
  levelCount: number; // 3 | 4 | 5
  scaleLabels: string[]; // เช่น ["ดีมาก (4)", "ดี (3)", "พอใช้ (2)", "ปรับปรุง (1)"]
  criteria: RubricCriterion[];
}

/** โครงสร้างข้อมูลโมเดล BYOK ที่ดึงมาจาก Google API */
export interface ByokModelItem {
  id: string; // เช่น 'gemini-2.5-flash'
  displayName: string;
  status: 'available' | 'limited' | 'error';
}

/** โครงสร้าง Tier Models ของระบบสากล (Cloudflare KV) */
export interface SystemTierModels {
  kpa: string[];
  fast: string[];
  precision: string[];
}

/** ข้อมูลสรุปย่อของแต่ละหน่วยการเรียนรู้ */
export interface UnitBriefInput {
  unitNumber: number;
  title: string;
  description: string;
  hours?: number;
}

/** โครงสร้าง Input ของโครงการจัดการเรียนรู้ (Long-Term Plan Wizard) */
export interface LongTermPlanInput {
  gradeId: string;
  gradeName: string;              // อ.1 ถึง ม.6
  subjectGroupId: string;
  subjectGroupName: string;       // 8 กลุ่มสาระการเรียนรู้ หรือ อื่นๆ
  courseCode: string;             // รหัสวิชา เช่น ว22101
  courseName: string;             // ชื่อรายวิชา เช่น วิทยาการคำนวณ
  totalHours: number;             // จำนวนชั่วโมงรวมตลอดภาคเรียน เช่น 40
  totalCredits: number;           // จำนวนหน่วยกิตรวม (คำนวณอัตโนมัติ = totalHours / 40 หรือกรอกเอง)
  totalUnits: number;             // จำนวนหน่วยการเรียนรู้
  usePerUnitDetail: boolean;      // เปิด/ปิดโหมดอธิบายแยกหน่วยการเรียนรู้
  unitBriefs: UnitBriefInput[];   // รายละเอียดแยกแต่ละหน่วย (ถ้าเปิดใช้)
  courseOverviewPrompt: string;   // คำอธิบายโครงการจัดการเรียนรู้โดยรวม (เช่น พ.ร.บ.คอมพิวเตอร์, ลิขสิทธิ์, Canva, CapCut)
  selectedIndicators: string[];   // มาตรฐานและตัวชี้วัดที่เลือก (เลือกได้มากกว่า 1 มาตรฐาน)
  kObjective: string;             // จุดประสงค์ด้านความรู้ (K)
  pObjective: string;             // จุดประสงค์ด้านทักษะกระบวนการ (P)
  aObjective: string;             // จุดประสงค์ด้านคุณลักษณะ (A)
  teachingMethods: string[];      // วิธีจัดการเรียนรู้ (Multi-select: Active Learning, PBL, SCSS, GPAS 5 Steps, 5E ฯลฯ)
  scoringMethods: string[];       // วิธีจัดเก็บคะแนน (Multi-select หรือ [] หากให้ AI จัดการอัตโนมัติ)
  courseDirections: string[];     // ทิศทางของโครงการ (Multi-select: เน้นปฏิบัติจริง, ทำงานเป็นกลุ่ม, ถาม-โต้ตอบ, ฝึกคิดวิเคราะห์ ฯลฯ)
  customConstraints: string;      // ข้อกำหนดเพิ่มเติม (สื่อ/แหล่งเรียนรู้ หรือทิศทางเฉพาะ - เว้นว่างได้)
  teacherName: string;            // ชื่อผู้สอน
  semester: string;               // ภาคเรียนที่
  academicYear: string;           // ปีการศึกษา
}

export interface LongTermUnitRow {
  unitNumber: number | string;    // 1, 2, ..., n
  unitTitle: string;              // ชื่อหน่วยการเรียนรู้
  coreConcept: string;            // สาระสำคัญ / สาระการเรียนรู้
  indicators: string;             // มาตรฐาน / ตัวชี้วัด
  hours: number;                  // เวลา (ชม.)
  score: number;                  // คะแนน
}

export interface WeeklyPlanRow {
  planGroupTitle?: string;        // เช่น "แผนการจัดการเรียนรู้ที่ 1" (สำหรับแถวคั่น colspan=8)
  weekNumber: number | string;    // สัปดาห์ที่
  indicators: string;             // ตัวชี้วัด
  unitAndTopic: string;           // หน่วยการเรียนรู้/เรื่อง
  objectives: string;             // จุดประสงค์การเรียนรู้ K-P-A
  coreContent: string;            // หัวข้อ/สาระสำคัญ
  teachingMethod: string;         // วิธีจัดการเรียนรู้
  mediaResources: string;         // สื่อ/แหล่งเรียนรู้
  assessment: string;             // การวัดและการประเมินผล
}

export interface ScoringMethodRow {
  order: number;
  methodDescription: string;      // วิธีจัดเก็บคะแนน
  score: number;                  // คะแนน
}

export interface LongTermPlanData {
  subjectGroupName: string;
  courseName: string;
  courseCode: string;
  gradeName: string;
  totalHours: number;
  totalCredits: number | string;
  semester: string;
  academicYear: string;
  teacherName: string;

  // ส่วนที่ 1: คำอธิบายรายวิชา
  courseDescriptionPara1: string; // อธิบายโครงการจัดการเรียนรู้โดยย่อ (เนื้อหาที่ศึกษา)
  courseDescriptionPara2: string; // อธิบายการจัดกิจกรรมการเรียนรู้ ทักษะ และคุณลักษณะที่มุ่งหวัง
  indicatorsList: string[];       // รายการตัวชี้วัดที่ใช้
  totalIndicatorsCount: number;   // จำนวนตัวชี้วัดรวม
  kObjective: string;
  pObjective: string;
  aObjective: string;

  // ส่วนที่ 2: ตารางโครงสร้างโครงการจัดการเรียนรู้ระยะยาว
  hasOrientation: boolean;        // แถวปฐมนิเทศ
  unitRows: LongTermUnitRow[];    // แถวหน่วยที่ 1 ถึง n
  affectiveScore: number;         // คะแนนการเข้าชั้นเรียน การแต่งกาย จิตพิสัย และความร่วมมือ
  finalExamHours: number;         // เวลาสอบปลายภาค (ชม.)
  finalExamScore: number;         // คะแนนสอบปลายภาค

  // ส่วนที่ 3: ตารางแผนการจัดการเรียนรู้รายสัปดาห์ (8 คอลัมน์)
  weeklyRows: WeeklyPlanRow[];

  // ส่วนที่ 4: ตารางวิธีจัดเก็บคะแนน (ระหว่างเรียน 80 / ปลายภาค 20 รวม 100)
  formativeScoreTotal: number;    // ค่าเริ่มต้น 80
  formativeScoringRows: ScoringMethodRow[];
  summativeScoreTotal: number;    // ค่าเริ่มต้น 20
  summativeScoringRows: ScoringMethodRow[];
}


