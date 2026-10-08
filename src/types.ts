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
