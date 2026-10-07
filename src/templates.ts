/**
 * EduPlan AI — Prompt Templates & Parser
 * ============================================================
 * สอดคล้องกับแม่แบบมาตรฐานราชการ 11 หัวข้อ
 * ============================================================
 */

import { type Indicator, enrichStandardsString, findStandardByCode } from './curriculum';
import type { LessonPlanData, EvaluationRow } from './types';

export interface LessonPlanInput {
  planName: string;
  gradeLevel: string;
  subject: string;
  subjectName?: string;
  unit: string;
  topic: string;
  durationMinutes: number;
  durationText: string;
  selectedIndicators: Indicator[];
  selectedStandards?: { code: string; title: string; strand?: string }[];
  objectiveMode: 'kpa' | 'custom';
  kpaK: string;
  kpaP: string;
  kpaA: string;
  customObjective: string;
  teachingMethod: string;
  competencies: string[];
  classroomAtmosphere: string;
  planDirections: string[];
  additionalNotes: string;
  isEarlyChildhood: boolean;
  earlyChildhoodDomains: string[];
  // Optional Header fields
  school?: string;
  semester?: string;
  date?: string;
  month?: string;
  academicYear?: string;
  buddhistYear?: string;
  teacherName?: string;
  teacherPosition?: string;
}

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
];

export function getCurrentThaiDate() {
  const d = new Date();
  const day = String(d.getDate());
  const month = THAI_MONTHS[d.getMonth()];
  const bYear = String(d.getFullYear() + 543);
  return { day, month, bYear };
}

/**
 * กำหนดขั้นตอนกิจกรรมการเรียนรู้ตามรูปแบบการสอนที่เลือกอย่างเคร่งครัด
 */
export function getTeachingMethodGuidelines(methodName: string): string {
  const m = (methodName || '').toLowerCase();
  if (m.includes('5e') || m.includes('สืบเสาะ')) {
    return `รูปแบบการจัดการเรียนรู้แบบสืบเสาะหาความรู้ (5E) ต้องมี 5 ขั้นตอนครบถ้วนตามลำดับ ดังนี้:
1. ขั้นสร้างความสนใจ (Engagement) (ระบุเวลา เช่น ... นาที)
2. ขั้นสำรวจและค้นหา (Exploration) (ระบุเวลา เช่น ... นาที)
3. ขั้นอธิบายและลงข้อสรุป (Explanation) (ระบุเวลา เช่น ... นาที)
4. ขั้นขยายความรู้ (Elaboration) (ระบุเวลา เช่น ... นาที)
5. ขั้นประเมินผล (Evaluation) (ระบุเวลา เช่น ... นาที)`;
  }
  if (m.includes('gpas') || m.includes('5 steps')) {
    return `รูปแบบ GPAS 5 Steps ต้องมี 5 ขั้นตอนครบถ้วนตามลำดับ ดังนี้:
1. ขั้นสังเกต รวบรวมข้อมูล (Gathering: G) (ระบุเวลา)
2. ขั้นคิดวิเคราะห์และสรุปความรู้ (Processing: P) (ระบุเวลา)
3. ขั้นปฏิบัติและนำไปประยุกต์ใช้ (Applying and Constructing the Knowledge: A1) (ระบุเวลา)
4. ขั้นสื่อสารและนำเสนอ (Applying the Communication Skill: A2) (ระบุเวลา)
5. ขั้นประเมินเพื่อเพิ่มคุณค่าบริการสังคมและจิตสาธารณะ (Self-Regulating: S) (ระบุเวลา)`;
  }
  if (m.includes('problem-based') || (m.includes('pbl') && m.includes('problem'))) {
    return `รูปแบบ Problem-Based Learning (PBL) ต้องมี 6 ขั้นตอนครบถ้วน ดังนี้:
1. ขั้นกำหนดปัญหา (ระบุเวลา)
2. ขั้นทำความเข้าใจปัญหา (ระบุเวลา)
3. ขั้นดำเนินการศึกษาค้นคว้า (ระบุเวลา)
4. ขั้นสังเคราะห์ความรู้ (ระบุเวลา)
5. ขั้นสรุปและประเมินค่าของคำตอบ (ระบุเวลา)
6. ขั้นนำเสนอและประเมินผลงาน (ระบุเวลา)`;
  }
  if (m.includes('project-based') || (m.includes('pbl') && m.includes('project'))) {
    return `รูปแบบ Project-Based Learning (PBL) ต้องมี 5 ขั้นตอนครบถ้วน ดังนี้:
1. ขั้นกำหนดและเลือกหัวข้อโครงงาน (ระบุเวลา)
2. ขั้นวางแผนและออกแบบโครงงาน (ระบุเวลา)
3. ขั้นลงมือปฏิบัติตามแผนโครงงาน (ระบุเวลา)
4. ขั้นสรุปผลและสะท้อนคิด (ระบุเวลา)
5. ขั้นนำเสนอผลงานและประเมินผลโครงงาน (ระบุเวลา)`;
  }
  if (m.includes('game') || m.includes('เกม')) {
    return `รูปแบบการเรียนรู้โดยใช้เกมเป็นฐาน (Game-Based Learning) ต้องมี 5 ขั้นตอนครบถ้วน ดังนี้:
1. ขั้นเตรียมความพร้อมและชี้แจงกติกาเกม (ระบุเวลา)
2. ขั้นดำเนินกิจกรรมการเล่นเกม (ระบุเวลา)
3. ขั้นอภิปรายและสะท้อนความคิดจากการเล่นเกม (ระบุเวลา)
4. ขั้นสรุปและเชื่อมโยงสู่เนื้อหาบทเรียน (ระบุเวลา)
5. ขั้นประเมินผลการเรียนรู้ (ระบุเวลา)`;
  }
  if (m.includes('stem') || m.includes('steam')) {
    return `รูปแบบ STEM / STEAM Education (กระบวนการออกแบบเชิงวิศวกรรม) ต้องมี 6 ขั้นตอนครบถ้วน ดังนี้:
1. ขั้นระบุปัญหา (Ask) (ระบุเวลา)
2. ขั้นรวบรวมข้อมูลและแนวคิดที่เกี่ยวข้อง (Imagine) (ระบุเวลา)
3. ขั้นออกแบบวิธีการแก้ปัญหา (Plan) (ระบุเวลา)
4. ขั้นวางแผนและดำเนินการแก้ปัญหา (Create) (ระบุเวลา)
5. ขั้นทดสอบ ประเมินผล และปรับปรุงแก้ไข (Improve) (ระบุเวลา)
6. ขั้นนำเสนอวิธีการและผลการแก้ปัญหา (Present) (ระบุเวลา)`;
  }
  if (m.includes('design thinking') || m.includes('คิดเชิงออกแบบ')) {
    return `รูปแบบกระบวนการคิดเชิงออกแบบ (Design Thinking) ต้องมี 5 ขั้นตอนครบถ้วน ดังนี้:
1. ขั้นเข้าใจปัญหา (Empathize) (ระบุเวลา)
2. ขั้นกำหนดโจทย์/นิยามปัญหา (Define) (ระบุเวลา)
3. ขั้นระดมความคิด (Ideate) (ระบุเวลา)
4. ขั้นสร้างต้นแบบ (Prototype) (ระบุเวลา)
5. ขั้นทดสอบและปรับปรุง (Test) (ระบุเวลา)`;
  }
  return `รูปแบบ Active Learning (การจัดการเรียนรู้เชิงรุก) ต้องจัดขั้นตอนกิจกรรมให้ชัดเจน ดังนี้:
1. ขั้นนำเข้าสู่บทเรียนและกระตุ้นความสนใจ (Engage) (ระบุเวลา)
2. ขั้นกิจกรรมการเรียนรู้และลงมือปฏิบัติ (Active Practice & Exploration) (ระบุเวลา)
3. ขั้นแลกเปลี่ยนเรียนรู้และอภิปรายร่วมกัน (Sharing & Discussion) (ระบุเวลา)
4. ขั้นสรุปบทเรียนและสะท้อนผลการเรียนรู้ (Reflection & Conclusion) (ระบุเวลา)`;
}

/**
 * System Instruction บังคับส่งข้อมูลแบบ Structured JSON ตามโครงสร้างแม่แบบ 11 ข้อ
 */
export function buildSystemInstruction(): string {
  return `คุณคือผู้เชี่ยวชาญระดับสูงด้านการจัดทำแผนการจัดการเรียนรู้ตามหลักสูตรแกนกลางการศึกษาขั้นพื้นฐาน (วPA) ของกระทรวงศึกษาธิการ ประเทศไทย

หน้าที่สำคัญ:
สังเคราะห์เนื้อหาแผนการจัดการเรียนรู้ที่สมบูรณ์ เป็นทางการ ถูกต้องตามระเบียบราชการ 100%
คุณต้องตอบกลับเป็น JSON Object เท่านั้น (ห้ามใส่คำเกริ่นนำหรือคำลงท้ายนอกก้อน JSON)

โครงสร้าง JSON ต้องมี Key ดังต่อไปนี้:
{
  "course_name": "ชื่อรายวิชา (เช่น ว22101 วิทยาการคำนวณ หรือ ภาษาไทยพื้นฐาน)",
  "unit": "หน่วยการเรียนรู้ (เช่น หน่วยการเรียนรู้ที่ 1 การแก้ปัญหาอย่างเป็นขั้นตอน)",
  "plan_name": "ชื่อแผนการจัดการเรียนรู้ (เช่น แผนการจัดการเรียนรู้ที่ 1 เรื่องการคิดเชิงคำนวณ)",
  "semester": "ภาคเรียนที่ (เช่น 1 หรือ 2)",
  "standards": "รหัสและคำอธิบายมาตรฐานการเรียนรู้ฉบับเต็มเสมอ ในรูปแบบ '[รหัสมาตรฐาน]: [คำอธิบายมาตรฐานฉบับเต็ม]' เช่น 'ว 4.2: เข้าใจและใช้แนวคิดเชิงคำนวณในการแก้ปัญหาที่พบในชีวิตจริงอย่างเป็นขั้นตอนและเป็นระบบ ใช้เทคโนโลยีสารสนเทศและการสื่อสารในการเรียนรู้ การทำงาน และการแก้ปัญหาได้อย่างมีประสิทธิภาพ รู้เท่าทัน และมีจริยธรรม' (ห้ามใส่แค่รหัสย่อสั้นๆ เด็ดขาด ต้องมีข้อความคำอธิบายมาตรฐานครบถ้วน)",
  "indicators": "รหัสและรายละเอียดตัวชี้วัดที่เลือกแต่ละข้ออย่างละเอียด",
  "concept": "สาระสำคัญ / ความคิดรวบยอดของบทเรียน",
  "k_objective": "จุดประสงค์ด้านความรู้ (K) เป็นข้อๆ",
  "p_objective": "จุดประสงค์ด้านทักษะกระบวนการ (P) เป็นข้อๆ",
  "a_objective": "จุดประสงค์ด้านคุณลักษณะอันพึงประสงค์ (A) เป็นข้อๆ",
  "learning_content": "สาระการเรียนรู้ (เนื้อหาย่อยที่สอนในคาบนี้)",
  "competencies": "สมรรถนะสำคัญของผู้เรียน (1. ความสามารถในการสื่อสาร... 2. ...)",
  "teaching_model": "รูปแบบการสอนที่ระบุ (เช่น การจัดการเรียนรู้แบบสืบเสาะหาความรู้ (5E) / Active Learning)",
  "activities": "กิจกรรมการเรียนรู้อย่างละเอียด โดยต้องแจกแจงตามขั้นตอนของรูปแบบการสอนที่เลือกอย่างเคร่งครัด (เช่น หากเลือก 5E ต้องมีครบทั้ง 5 ขั้นตอน: 1. ขั้นสร้างความสนใจ (Engagement), 2. ขั้นสำรวจและค้นหา (Exploration), 3. ขั้นอธิบายและลงข้อสรุป (Explanation), 4. ขั้นขยายความรู้ (Elaboration), 5. ขั้นประเมินผล (Evaluation) พร้อมกำกับเวลาและแจกแจงกิจกรรมย่อย 1.1, 1.2 เป็นต้น)",
  "media_resources": "สื่อและแหล่งการเรียนรู้ (ใบงาน, อุปกรณ์, แหล่งข้อมูล)",
  "evaluation_rows": [
    {
      "dimension": "ด้านความรู้ (K)",
      "objective": "จุดประสงค์ด้าน K ที่ประเมิน",
      "method": "วิธีการวัด (เช่น ตรวจใบงาน, การตอบคำถาม)",
      "tool": "เครื่องมือวัด (เช่น แบบประเมินใบงาน, แบบสังเกต)",
      "criteria": "เกณฑ์การผ่าน (เช่น ผ่านเกณฑ์ระดับดีขึ้นไป หรือร้อยละ 70)"
    },
    {
      "dimension": "ด้านทักษะและกระบวนการ (P)",
      "objective": "จุดประสงค์ด้าน P ที่ประเมิน",
      "method": "วิธีการวัด",
      "tool": "เครื่องมือวัด",
      "criteria": "เกณฑ์การผ่าน"
    },
    {
      "dimension": "ด้านคุณลักษณะอันพึงประสงค์ (A)",
      "objective": "จุดประสงค์ด้าน A ที่ประเมิน",
      "method": "วิธีการวัด",
      "tool": "เครื่องมือวัด",
      "criteria": "เกณฑ์การผ่าน"
    }
  ],
  "suggestions": "กิจกรรมเสนอแนะ",
  "assignments": "งานที่มอบหมาย"
}

กฎเหล็ก:
1. evaluation_rows ต้องเป็น Array ที่มีอย่างน้อย 3 แถว (ด้านความรู้ (K), ด้านทักษะและกระบวนการ (P), ด้านคุณลักษณะอันพึงประสงค์ (A))
2. ใช้ภาษาไทยทางการ สละสลวย ถูกต้องตามแบบแผนราชการ
3. ข้อ 1 มาตรฐานการเรียนรู้ ต้องระบุรหัสและคำอธิบายมาตรฐานฉบับเต็มเสมอ ในรูปแบบ '[รหัส]: [คำอธิบาย]' เช่น 'ว 4.2: เข้าใจและใช้...' ห้ามย่อเหลือเพียงรหัสสั้นเด็ดขาด
4. กิจกรรมการเรียนรู้ (activities) ต้องจัดขั้นตอนตามรูปแบบการสอนที่กำหนดอย่างเคร่งครัด ครบถ้วนทุกขั้น
5. ห้ามสุ่มเปลี่ยนรหัสมาตรฐาน/ตัวชี้วัดที่ครูระบุ`;
}

/**
 * สร้าง Prompt หลักสำหรับแผนการสอน
 */
export function buildLessonPlanPrompt(input: LessonPlanInput): string {
  const indicatorsText = input.selectedIndicators
    .map(ind => `  - ${ind.code}: ${ind.text}`)
    .join('\n');

  let standardsPromptText = '';
  if (input.selectedStandards && input.selectedStandards.length > 0) {
    standardsPromptText = input.selectedStandards
      .map(std => {
        const codeClean = std.code.replace(/^มาตรฐาน\s*/, '').trim();
        return `  - ${codeClean}: ${std.title}`;
      })
      .join('\n');
  }

  let objectiveSection: string;
  if (input.objectiveMode === 'kpa') {
    objectiveSection = `
จุดประสงค์การเรียนรู้ที่ครูกำหนด:
  - ด้านความรู้ (K): ${input.kpaK || 'ให้ AI วิเคราะห์สอดคล้องกับตัวชี้วัด'}
  - ด้านทักษะกระบวนการ (P): ${input.kpaP || 'ให้ AI วิเคราะห์สอดคล้องกับตัวชี้วัด'}
  - ด้านคุณลักษณะอันพึงประสงค์ (A): ${input.kpaA || 'ให้ AI วิเคราะห์สอดคล้องกับตัวชี้วัด'}`;
  } else {
    objectiveSection = `
จุดประสงค์การเรียนรู้ที่ครูกำหนดเอง:
${input.customObjective || 'ให้ AI สังเคราะห์จุดประสงค์ K, P, A ตามมาตรฐานและตัวชี้วัด'}`;
  }

  const durationStr = input.durationText || `${input.durationMinutes} นาที`;
  const methodGuidelines = getTeachingMethodGuidelines(input.teachingMethod);

  return `
กรุณาสร้างแผนการจัดการเรียนรู้ตามโครงสร้างแม่แบบ 11 หัวข้อ:

ข้อมูลพื้นฐาน:
- ระดับชั้น: ${input.gradeLevel}
- กลุ่มสาระการเรียนรู้: ${input.subject}
- รายวิชา: ${input.subjectName || input.subject || 'ไม่ระบุ'}
- หน่วยการเรียนรู้: ${input.unit || 'ไม่ระบุ'}
- แผนการจัดการเรียนรู้: ${input.planName || `แผนการจัดการเรียนรู้ เรื่อง ${input.topic}`}
- เรื่อง: ${input.topic}
- ภาคเรียนที่: ${input.semester || '1'}
- ระยะเวลาเรียน: ${durationStr}
- รูปแบบการสอน: ${input.teachingMethod}
- สมรรถนะสำคัญของผู้เรียน: ${input.competencies.join(', ') || 'ความสามารถในการสื่อสาร, ความสามารถในการคิด, ความสามารถในการแก้ปัญหา'}
- บรรยากาศในห้องเรียน / ทิศทาง: ${input.classroomAtmosphere || input.planDirections.join(', ') || 'เน้นผู้เรียนมีส่วนร่วม Active Learning'}
- หมายเหตุเพิ่มเติม: ${input.additionalNotes || 'ไม่มี'}

มาตรฐานการเรียนรู้และตัวชี้วัดที่เลือก:
มาตรฐานการเรียนรู้:
${standardsPromptText || '  (ให้ AI สังเคราะห์มาตรฐานการเรียนรู้ฉบับเต็มที่ตรงตามระดับชั้นและกลุ่มสาระนี้ ในรูปแบบ [รหัส]: [คำอธิบายมาตรฐานฉบับเต็ม])'}

ตัวชี้วัด:
${indicatorsText || '  (ไม่ได้เลือกตัวชี้วัดระบุ ให้ AI สังเคราะห์ตัวชี้วัดที่ตรงตามระดับชั้นและกลุ่มสาระนี้)'}

${objectiveSection}

ตอบกลับเป็น JSON ที่มี Key ครบถ้วนตาม System Instruction เท่านั้น:
- ฟิลด์ "standards": ต้องระบุรหัสมาตรฐานและคำอธิบายฉบับเต็มเสมอ ในรูปแบบ "[รหัสมาตรฐาน]: [คำอธิบายมาตรฐานฉบับเต็ม]" เช่น "ว 4.2: เข้าใจและใช้แนวคิดเชิงคำนวณในการแก้ปัญหาที่พบในชีวิตจริงอย่างเป็นขั้นตอนและเป็นระบบ ใช้เทคโนโลยีสารสนเทศและการสื่อสารในการเรียนรู้ การทำงาน และการแก้ปัญหาได้อย่างมีประสิทธิภาพ รู้เท่าทัน และมีจริยธรรม" (ห้ามใส่เฉพาะรหัสย่อสั้นๆ โดยไม่มีคำอธิบายเด็ดขาด)
- ฟิลด์ "activities": ต้องออกแบบกิจกรรมการเรียนรู้ให้สอดคล้องกับ "${input.teachingMethod}" ตามขั้นตอนต่อไปนี้อย่างเคร่งครัด:
${methodGuidelines}

ในแต่ละขั้นตอนหลัก ให้ระบุหัวข้อพร้อมกำกับเวลา เช่น "1. ขั้นสร้างความสนใจ (Engagement) (10 นาที)" แล้วขึ้นบรรทัดใหม่แจกแจงกิจกรรมย่อย "1.1 ...", "1.2 ..." อย่างละเอียด ชัดเจน เห็นบทบาทครูและนักเรียน
`.trim();
}

export interface KPAPromptOptions {
  gradeLevel: string;
  subjectGroup: string;
  subjectName?: string;
  topic?: string;
  unit?: string;
  planName?: string;
  standards?: { code: string; title: string; strand?: string }[];
  indicators?: Indicator[];
  ecDomains?: string[];
}

/**
 * Prompt สำหรับ AI ช่วยร่าง K-P-A อัตโนมัติ
 * ใช้บริบทจาก: ระดับชั้น, กลุ่มสาระวิชา, ชื่อรายวิชา, มาตรฐานตัวชี้วัด (จำเป็น)
 * และ เรื่องที่ต้องการสอน, หน่วยการเรียนรู้, ชื่อแผน (ถ้ามี)
 */
export function buildKPAPrompt(
  optionsOrGrade: KPAPromptOptions | string,
  legacySubject?: string,
  legacyTopic?: string,
  legacyIndicators?: Indicator[]
): string {
  let gradeLevel = '';
  let subjectGroup = '';
  let subjectName = '';
  let topic = '';
  let unit = '';
  let planName = '';
  let standards: { code: string; title: string; strand?: string }[] = [];
  let indicators: Indicator[] = [];
  let ecDomains: string[] = [];

  if (typeof optionsOrGrade === 'object') {
    gradeLevel = optionsOrGrade.gradeLevel || '';
    subjectGroup = optionsOrGrade.subjectGroup || '';
    subjectName = optionsOrGrade.subjectName || '';
    topic = optionsOrGrade.topic || '';
    unit = optionsOrGrade.unit || '';
    planName = optionsOrGrade.planName || '';
    standards = optionsOrGrade.standards || [];
    indicators = optionsOrGrade.indicators || [];
    ecDomains = optionsOrGrade.ecDomains || [];
  } else {
    gradeLevel = optionsOrGrade;
    subjectGroup = legacySubject || '';
    subjectName = legacySubject || '';
    topic = legacyTopic || '';
    indicators = legacyIndicators || [];
  }

  const stdText = standards.length > 0
    ? standards.map(s => `- ${s.code} ${s.title}${s.strand ? ` (${s.strand})` : ''}`).join('\n')
    : '';

  const indText = indicators.length > 0
    ? indicators.map(i => `- ${i.code}: ${i.text}`).join('\n')
    : '';

  const ecText = ecDomains.length > 0
    ? ecDomains.map(d => `- พัฒนาการ/ประสบการณ์สำคัญ: ${d}`).join('\n')
    : '';

  const optionalContext: string[] = [];
  if (topic?.trim()) optionalContext.push(`- เรื่องหรือเนื้อหาที่ต้องการสอน: ${topic.trim()}`);
  if (unit?.trim()) optionalContext.push(`- ชื่อหน่วยการเรียนรู้: ${unit.trim()}`);
  if (planName?.trim()) optionalContext.push(`- ชื่อแผนการจัดการเรียนรู้: ${planName.trim()}`);

  return `คุณคือผู้เชี่ยวชาญด้านหลักสูตรแกนกลางการศึกษาขั้นพื้นฐานและผู้เชี่ยวชาญการจัดทำแผนการจัดการเรียนรู้ของกระทรวงศึกษาธิการ
โปรดช่วยร่าง "จุดประสงค์การเรียนรู้" ตามหลัก K-P-A (Knowledge, Practice/Process, Attitude) ให้สอดคล้องกับระดับชั้น กลุ่มสาระวิชา รายวิชา และมาตรฐานตัวชี้วัดที่กำหนดอย่างถูกต้อง ครบถ้วน และวัดประเมินผลได้จริง

บริบทการจัดการเรียนรู้:
- ระดับชั้นที่สอน: ${gradeLevel}
- กลุ่มสาระการเรียนรู้: ${subjectGroup}
- ชื่อรายวิชา: ${subjectName || subjectGroup}
${optionalContext.length > 0 ? optionalContext.join('\n') : ''}
${stdText ? `- มาตรฐานการเรียนรู้:\n${stdText}` : ''}
${indText ? `- ตัวชี้วัด:\n${indText}` : ''}
${ecText ? `- ขอบข่ายปฐมวัย:\n${ecText}` : ''}

เกณฑ์และข้อกำหนดในการร่างจุดประสงค์การเรียนรู้ (K-P-A):
1. ด้านความรู้ (K: Knowledge): มโนทัศน์หรือความรู้ความเข้าใจสำคัญที่นักเรียนจะได้รับ ให้เขียนขึ้นต้นด้วย "ผู้เรียนสามารถ..." เช่น สามารถอธิบาย... สามารถระบุ... สามารถบอก...
2. ด้านทักษะและกระบวนการ (P: Practice / Process): ทักษะการปฏิบัติ การคิดวิเคราะห์ หรือกระบวนการแก้ปัญหา ให้เขียนขึ้นต้นด้วย "ผู้เรียนสามารถ..." เช่น สามารถปฏิบัติ... สามารถเขียน... สามารถคำนวณ... สามารถสร้างแบบจำลอง...
3. ด้านเจตคติ / คุณลักษณะอันพึงประสงค์ (A: Attitude): เจตคติที่ดี ค่านิยม ความมีวินัย ใฝ่เรียนรู้ หรือความตระหนัก ให้เขียนขึ้นต้นด้วย "ผู้เรียนมี..." หรือ "ผู้เรียนตระหนัก..." เช่น มีความมุ่งมั่นในการทำงาน... มีความใฝ่เรียนรู้... ตระหนักถึงความสำคัญ...

คำสั่งสำคัญ:
โปรดตอบกลับในรูปแบบ JSON เท่านั้น โดยมีโครงสร้างดังนี้ (ห้ามมีข้อความเกริ่นนำหรือคำอธิบายอื่นนอก JSON):
\`\`\`json
{
  "k": "ข้อความจุดประสงค์ด้านความรู้ (K)",
  "p": "ข้อความจุดประสงค์ด้านทักษะกระบวนการ (P)",
  "a": "ข้อความจุดประสงค์ด้านเจตคติ (A)"
}
\`\`\``.trim();
}

function normalizeString(val: any, fallback = ''): string {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'string') return val.trim();
  if (Array.isArray(val)) {
    return val.map((v, i) => (typeof v === 'string' ? `${i + 1}. ${v}` : JSON.stringify(v))).join('\n');
  }
  return String(val);
}

/**
 * แกะข้อมูล JSON หรือ Markdown จาก AI ให้อยู่ในรูป LessonPlanData 11 หัวข้อ
 */
export function parseLessonPlanResponse(rawText: string, input: LessonPlanInput): LessonPlanData {
  const now = getCurrentThaiDate();
  const school = input.school || '……………………………………………………';
  const date = input.date || now.day;
  const month = input.month || now.month;
  const buddhist_year = input.buddhistYear || now.bYear;
  const year = input.academicYear || now.bYear;
  const hours_text = input.durationText || `${input.durationMinutes} นาที`;
  const teacher_name = input.teacherName || '……………………………………………………';
  const teacher_position = input.teacherPosition || 'ครูผู้ช่วย / ครู';

  // 1. ลองแกะ JSON
  try {
    let cleanJson = rawText.trim();
    const mdBlockMatch = cleanJson.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (mdBlockMatch) {
      cleanJson = mdBlockMatch[1].trim();
    }
    const parsed = JSON.parse(cleanJson);

    let evalRows: EvaluationRow[] = [];
    if (Array.isArray(parsed.evaluation_rows) && parsed.evaluation_rows.length > 0) {
      evalRows = parsed.evaluation_rows.map((r: any) => ({
        dimension: normalizeString(r.dimension, 'ด้านการประเมิน'),
        objective: normalizeString(r.objective, '-'),
        method: normalizeString(r.method, 'การตรวจผลงาน/การสังเกต'),
        tool: normalizeString(r.tool, 'แบบประเมิน/แบบสังเกต'),
        criteria: normalizeString(r.criteria, 'ผ่านเกณฑ์ระดับคุณภาพ 2 ขึ้นไป (ร้อยละ 70)'),
      }));
    } else {
      evalRows = buildDefaultEvaluationRows(parsed.k_objective, parsed.p_objective, parsed.a_objective);
    }

    const course_name = input.subjectName || (parsed.course_name ? normalizeString(parsed.course_name) : '');
    const unit = input.unit || (parsed.unit ? normalizeString(parsed.unit) : '');
    const plan_name = input.planName || (parsed.plan_name ? normalizeString(parsed.plan_name) : '');
    const semester = input.semester || (parsed.semester ? normalizeString(parsed.semester) : '');

    return {
      course_name,
      unit,
      plan_name,
      semester,
      subject: input.subject || 'กลุ่มสาระการเรียนรู้',
      grade: input.gradeLevel || 'ชั้นประถมศึกษา/มัธยมศึกษา',
      topic: input.topic || 'บทเรียน',
      hours_text,
      year,
      date,
      month,
      buddhist_year,
      school,
      standards: (() => {
        let stdStr = normalizeString(parsed.standards, buildDefaultStandardsText(input));
        stdStr = enrichStandardsString(stdStr);
        if (stdStr.length < 35 && input.selectedStandards && input.selectedStandards.length > 0) {
          stdStr = buildDefaultStandardsText(input);
        }
        return enrichStandardsString(stdStr);
      })(),
      indicators: normalizeString(parsed.indicators, buildDefaultIndicatorsText(input)),
      concept: normalizeString(parsed.concept, `การจัดการเรียนรู้เรื่อง ${input.topic} มุ่งเน้นให้ผู้เรียนเกิดความเข้าใจและทักษะตามมาตรฐานการเรียนรู้`),
      k_objective: normalizeString(parsed.k_objective, input.kpaK || 'ผู้เรียนมีความรู้ความเข้าใจในเนื้อหาบทเรียน'),
      p_objective: normalizeString(parsed.p_objective, input.kpaP || 'ผู้เรียนสามารถปฏิบัติกิจกรรมและฝึกทักษะการเรียนรู้ได้'),
      a_objective: normalizeString(parsed.a_objective, input.kpaA || 'ผู้เรียนมีวินัย ใฝ่เรียนรู้ และมุ่งมั่นในการทำงาน'),
      learning_content: normalizeString(parsed.learning_content, `เนื้อหาสาระการเรียนรู้เรื่อง ${input.topic}`),
      competencies: normalizeString(parsed.competencies, input.competencies.join(', ') || '1. ความสามารถในการสื่อสาร\n2. ความสามารถในการคิด\n3. ความสามารถในการแก้ปัญหา'),
      teaching_model: normalizeString(parsed.teaching_model, input.teachingMethod || 'Active Learning'),
      activities: normalizeString(parsed.activities, 'ขั้นนำเข้าสู่บทเรียน (10 นาที)\n1. ครูทักทายและแจ้งจุดประสงค์การเรียนรู้\nขั้นจัดกิจกรรมการเรียนรู้ (30 นาที)\n1. ผู้เรียนลงมือปฏิบัติกิจกรรมตามขั้นตอน\nขั้นสรุปบทเรียนและประเมินผล (10 นาที)\n1. ผู้เรียนร่วมกันสรุปความรู้และสะท้อนคิด'),
      media_resources: normalizeString(parsed.media_resources, '1. สื่อการสอนและใบความรู้\n2. ใบงานแบบฝึกหัด\n3. แหล่งเรียนรู้ดิจิทัล'),
      evaluation_rows: evalRows,
      suggestions: normalizeString(parsed.suggestions, 'ครูผู้สอนควรจัดเตรียมสื่อและอุปกรณ์ให้พร้อม และเปิดโอกาสให้นักเรียนทุกคนได้มีส่วนร่วม'),
      assignments: normalizeString(parsed.assignments, 'ใบงานสรุปความรู้เรื่อง ' + input.topic),
      teacher_name,
      teacher_position,
    };
  } catch (_e) {
    // 2. ถ้า JSON ไม่ผ่าน ให้ใช้ Regex แกะหัวข้อจาก Markdown
    return parseFromMarkdownOrSynthesize(rawText, input);
  }
}

function buildDefaultEvaluationRows(k?: string, p?: string, a?: string): EvaluationRow[] {
  return [
    {
      dimension: 'ด้านความรู้ (K)',
      objective: k || 'ประเมินความรู้ความเข้าใจในเนื้อหาบทเรียน',
      method: 'ตรวจใบงาน / การตอบคำถามในชั้นเรียน',
      tool: 'แบบประเมินใบงาน / แบบบันทึกคะแนน',
      criteria: 'ผ่านเกณฑ์การประเมินร้อยละ 70 ขึ้นไป',
    },
    {
      dimension: 'ด้านทักษะและกระบวนการ (P)',
      objective: p || 'ประเมินทักษะการปฏิบัติงานและการแก้ปัญหา',
      method: 'การสังเกตพฤติกรรมการปฏิบัติงานกลุ่มและเดี่ยว',
      tool: 'แบบประเมินทักษะกระบวนการ',
      criteria: 'ได้ระดับคุณภาพ 2 (ดี) ขึ้นไป',
    },
    {
      dimension: 'ด้านคุณลักษณะอันพึงประสงค์ (A)',
      objective: a || 'ประเมินวินัย ใฝ่เรียนรู้ และความมุ่งมั่นในการทำงาน',
      method: 'การสังเกตพฤติกรรมในชั้นเรียน',
      tool: 'แบบประเมินคุณลักษณะอันพึงประสงค์',
      criteria: 'ได้ระดับคุณภาพ 2 (ดี) ขึ้นไป',
    },
  ];
}

function buildDefaultStandardsText(input: LessonPlanInput): string {
  if (input.selectedStandards && input.selectedStandards.length > 0) {
    return input.selectedStandards.map(s => {
      const codeClean = s.code.replace(/^มาตรฐาน\s*/, '').trim();
      return `${codeClean}: ${s.title}`.trim();
    }).join('\n');
  }
  if (input.selectedIndicators && input.selectedIndicators.length > 0) {
    const codes = Array.from(new Set(input.selectedIndicators.map(i => {
      const m = i.code.match(/([ก-๙]\s*[\d\.]+)/);
      return m ? m[1] : i.code.split('/')[0];
    })));
    return codes.map(c => {
      const std = findStandardByCode(c);
      if (std) {
        const codeClean = std.code.replace(/^มาตรฐาน\s*/, '').trim();
        return `${codeClean}: ${std.title}`;
      }
      return enrichStandardsString(c);
    }).join('\n');
  }
  return 'ว 4.2: เข้าใจและใช้แนวคิดเชิงคำนวณในการแก้ปัญหาที่พบในชีวิตจริงอย่างเป็นขั้นตอนและเป็นระบบ ใช้เทคโนโลยีสารสนเทศและการสื่อสารในการเรียนรู้ การทำงาน และการแก้ปัญหาได้อย่างมีประสิทธิภาพ รู้เท่าทัน และมีจริยธรรม';
}

function buildDefaultIndicatorsText(input: LessonPlanInput): string {
  if (input.selectedIndicators.length > 0) {
    return input.selectedIndicators.map(i => `${i.code}: ${i.text}`).join('\n');
  }
  return 'ตัวชี้วัดชั้นปีที่สอดคล้องกับบทเรียน';
}

function parseFromMarkdownOrSynthesize(rawText: string, input: LessonPlanInput): LessonPlanData {
  const fallback = generateStandardLessonPlan(input);
  if (!rawText || rawText.trim().length < 50) return fallback;

  const extractSection = (headingRegex: RegExp, nextHeadingRegex: RegExp): string => {
    const startMatch = rawText.match(headingRegex);
    if (!startMatch || startMatch.index === undefined) return '';
    const startIdx = startMatch.index + startMatch[0].length;
    const sub = rawText.slice(startIdx);
    const endMatch = sub.match(nextHeadingRegex);
    const content = endMatch && endMatch.index !== undefined ? sub.slice(0, endMatch.index) : sub;
    return content.trim();
  };

  const std = enrichStandardsString(extractSection(/(?:มาตรฐานการเรียนรู้|ข้อที่\s*1)/i, /(?:ตัวชี้วัด|สาระสำคัญ)/i) || fallback.standards);
  const ind = extractSection(/(?:ตัวชี้วัด|ข้อที่\s*2)/i, /(?:สาระสำคัญ|จุดประสงค์)/i) || fallback.indicators;
  const conc = extractSection(/(?:สาระสำคัญ|ความคิดรวบยอด|ข้อที่\s*3)/i, /(?:จุดประสงค์|สาระการเรียนรู้)/i) || fallback.concept;
  const obj = extractSection(/(?:จุดประสงค์การเรียนรู้|จุดประสงค์รายวิชา|ข้อที่\s*4)/i, /(?:สาระการเรียนรู้|สมรรถนะ)/i);
  const cont = extractSection(/(?:สาระการเรียนรู้|เนื้อหา|ข้อที่\s*5)/i, /(?:สมรรถนะ|กิจกรรม)/i) || fallback.learning_content;
  const comp = extractSection(/(?:สมรรถนะสำคัญ|ข้อที่\s*6)/i, /(?:กิจกรรม|สื่อ)/i) || fallback.competencies;
  const act = extractSection(/(?:กิจกรรมการเรียนรู้|ขั้นตอนการจัด|ข้อที่\s*7)/i, /(?:สื่อและแหล่ง|การวัดผล)/i) || fallback.activities;
  const media = extractSection(/(?:สื่อและแหล่งการเรียนรู้|สื่อการสอน|ข้อที่\s*8)/i, /(?:การวัดผล|กิจกรรมเสนอแนะ)/i) || fallback.media_resources;

  return {
    ...fallback,
    standards: std,
    indicators: ind,
    concept: conc,
    k_objective: obj || fallback.k_objective,
    learning_content: cont,
    competencies: comp,
    activities: act,
    media_resources: media,
  };
}

/**
 * สังเคราะห์โครงร่างแผนมาตรฐาน วPA 11 หัวข้อทันที (Instant Generator / Offline Fallback)
 */
export function generateStandardLessonPlan(input: LessonPlanInput): LessonPlanData {
  const now = getCurrentThaiDate();
  const school = input.school || '……………………………………………………';
  const date = input.date || now.day;
  const month = input.month || now.month;
  const buddhist_year = input.buddhistYear || now.bYear;
  const year = input.academicYear || now.bYear;
  const hours_text = input.durationText || `${input.durationMinutes} นาที`;
  const teacher_name = input.teacherName || '……………………………………………………';
  const teacher_position = input.teacherPosition || 'ครูผู้ช่วย / ครู';

  const indicatorsText = buildDefaultIndicatorsText(input);
  const standardsText = buildDefaultStandardsText(input);

  const k = input.kpaK || `ผู้เรียนมีความรู้ความเข้าใจเกี่ยวกับเรื่อง ${input.topic} และหลักการสำคัญตามตัวชี้วัด`;
  const p = input.kpaP || `ผู้เรียนสามารถปฏิบัติกิจกรรม วิเคราะห์ และประยุกต์ใช้ความรู้เรื่อง ${input.topic} ในสถานการณ์จริงได้`;
  const a = input.kpaA || `ผู้เรียนมีวินัย ใฝ่เรียนรู้ มีความรับผิดชอบ และให้ความร่วมมือในการทำงานร่วมกับผู้อื่น`;

  const competenciesText = input.competencies.length > 0
    ? input.competencies.map((c, idx) => `${idx + 1}. ${c}`).join('\n')
    : '1. ความสามารถในการสื่อสาร\n2. ความสามารถในการคิด\n3. ความสามารถในการแก้ปัญหา\n4. ความสามารถในการใช้ทักษะชีวิต\n5. ความสามารถในการใช้เทคโนโลยี';

  const activities = `ขั้นนำเข้าสู่บทเรียน (ประมาณ 10 นาที)
   1. ครูทักทายผู้เรียนและกระตุ้นความสนใจด้วยคำถามกระตุ้นความคิดเกี่ยวกับ ${input.topic}
   2. เชื่อมโยงประสบการณ์เดิมของผู้เรียนเข้าสู่หัวข้อใหม่ และแจ้งจุดประสงค์การเรียนรู้ให้ผู้เรียนทราบ

ขั้นจัดกิจกรรมการเรียนรู้ (รูปแบบ ${input.teachingMethod || 'Active Learning'}) (ประมาณ 30-70 นาที)
   1. ผู้เรียนศึกษาข้อมูลหรือสถานการณ์ตัวอย่างเกี่ยวกับ ${input.topic}
   2. ผู้เรียนร่วมกันลงมือปฏิบัติกิจกรรมกลุ่มหรือเดี่ยว มีการแลกเปลี่ยนความคิดเห็นและร่วมกันแก้ปัญหา
   3. ครูคอยอำนวยความสะดวก ให้คำแนะนำ และกระตุ้นให้ผู้เรียนสรุปความรู้ด้วยตนเอง
   4. ตัวแทนผู้เรียนนำเสนอผลงานหรือแนวคิดหน้าชั้นเรียน และร่วมกันวิพากษ์เชิงสร้างสรรค์

ขั้นสรุปบทเรียนและประเมินผล (ประมาณ 10-20 นาที)
   1. ครูและผู้เรียนร่วมกันอภิปรายสรุปสาระสำคัญของเรื่อง ${input.topic}
   2. ผู้เรียนทำแบบฝึกหัด/ใบงาน เพื่อตรวจสอบความเข้าใจ
   3. ครูมอบหมายงานเพิ่มเติมและเปิดโอกาสให้ผู้เรียนสอบถามข้อสงสัย`;

  return {
    course_name: input.subjectName || '',
    unit: input.unit || '',
    plan_name: input.planName || '',
    semester: input.semester || '',
    subject: input.subject || 'กลุ่มสาระการเรียนรู้',
    grade: input.gradeLevel || 'ระดับชั้น',
    topic: input.topic || 'บทเรียน',
    hours_text,
    year,
    date,
    month,
    buddhist_year,
    school,
    standards: standardsText,
    indicators: indicatorsText,
    concept: `การจัดการเรียนรู้เรื่อง ${input.topic} ช่วยให้ผู้เรียนเกิดความเข้าใจเชิงมโนทัศน์ พัฒนาทักษะกระบวนการคิด และสามารถนำไปประยุกต์ใช้ในชีวิตประจำวันได้อย่างมีประสิทธิภาพ`,
    k_objective: k,
    p_objective: p,
    a_objective: a,
    learning_content: `1. ความหมายและหลักการสำคัญของ ${input.topic}\n2. ขั้นตอนและวิธีการปฏิบัติ\n3. การประยุกต์ใช้ในชีวิตจริง`,
    competencies: competenciesText,
    teaching_model: input.teachingMethod || 'Active Learning',
    activities,
    media_resources: `1. ใบความรู้และใบงานเรื่อง ${input.topic}\n2. สื่อนำเสนอ (PowerPoint / สื่อดิจิทัล)\n3. อุปกรณ์ประกอบกิจกรรมการเรียนรู้\n4. แหล่งเรียนรู้ออนไลน์`,
    evaluation_rows: buildDefaultEvaluationRows(k, p, a),
    suggestions: 'ผู้สอนควรสังเกตพฤติกรรมการมีส่วนร่วมของผู้เรียนอย่างใกล้ชิด และปรับความเร็วของกิจกรรมให้เหมาะสมกับบริบทของผู้เรียน',
    assignments: `ใบงานสรุปองค์ความรู้เรื่อง ${input.topic}`,
    teacher_name,
    teacher_position,
  };
}
