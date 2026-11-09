/**
 * EduPlan AI — Long-Term Plan Prompt Templates & Parser
 * ============================================================
 * จัดการ System Instruction, Prompts, JSON Parsing, และ Fallback
 * สำหรับโมดูล "สร้างโครงการจัดการเรียนรู้ / แผนระยะยาว"
 * ตามระเบียบราชการและมาตรฐาน วPA กระทรวงศึกษาธิการ
 * ============================================================
 */

import type {
  LongTermPlanInput,
  LongTermPlanData,
  LongTermUnitRow,
  WeeklyPlanRow,
  ScoringMethodRow,
} from './types';

/**
 * สร้าง System Instruction สำหรับ AI สถาปนิกหลักสูตรและแผนการสอนระยะยาว
 */
export function buildLongTermSystemInstruction(): string {
  return `คุณคือผู้เชี่ยวชาญระดับสูงด้านการพัฒนาหลักสูตรและการจัดทำโครงการจัดการเรียนรู้ระยะยาว (Course Syllabus & Long-Term Instructional Plan) ตามมาตรฐาน วPA ของกระทรวงศึกษาธิการ ประเทศไทย

ภารกิจของคุณคือ: สังเคราะห์และออกแบบโครงการจัดการเรียนรู้ระยะยาวตลอดภาคเรียนอย่างมืออาชีพ ครอบคลุม 5 ส่วนหลักตามระเบียบราชการไทย:
ส่วนที่ 1: คำอธิบายรายวิชา (Course Description)
  - ย่อหน้า 1: อธิบายเนื้อหา สาระสำคัญ องค์ความรู้ที่ผู้เรียนจะได้ศึกษาตลอดภาคเรียนอย่างละเอียด ชัดเจน สละสลวย
  - ย่อหน้า 2: อธิบายกระบวนการจัดกิจกรรมการเรียนรู้ (เช่น Active Learning, PBL, 5E) ทักษะสำคัญในศตวรรษที่ 21 สมรรถนะ และคุณลักษณะอันพึงประสงค์ที่มุ่งเน้น
  - รายการตัวชี้วัด (indicatorsList) และจำนวนตัวชี้วัดรวม (totalIndicatorsCount)
  - จุดประสงค์การเรียนรู้แยก 3 ด้าน: K (ความรู้), P (ทักษะกระบวนการ), A (คุณลักษณะอันพึงประสงค์) เป็นข้อๆ ชัดเจน วัดผลได้จริง

ส่วนที่ 2: ตารางโครงสร้างโครงการจัดการเรียนรู้ระยะยาว (Long-Term Unit Structure)
  - แถวปฐมนิเทศ (hasOrientation: true)
  - แถวหน่วยการเรียนรู้ (unitRows): จำนวนหน่วยตรงตามที่ระบุ แต่ละหน่วยมี unitNumber, unitTitle, coreConcept (สาระสำคัญที่ลึกซึ้ง), indicators (มาตรฐาน/ตัวชี้วัด), hours (ชั่วโมง), score (คะแนน)
  - กำหนดชั่วโมงให้ผลรวมหน่วย + เวลาสอบปลายภาค เท่ากับ totalHours ที่กำหนดพอดี 100%
  - กำหนดคะแนนให้ผลรวมหน่วย + affectiveScore (จิตพิสัย 5-10 คะแนน) + finalExamScore (ปลายภาค 20 คะแนน) เท่ากับ 100 คะแนนพอดี 100%

ส่วนที่ 3: ตารางแผนการจัดการเรียนรู้รายสัปดาห์ (Weekly Plan Breakdown - 8 คอลัมน์)
  - แบ่งแผนการจัดการเรียนรู้เป็นรายสัปดาห์ตลอดภาคเรียน (สัปดาห์ที่ 1 ถึง n เช่น 20 สัปดาห์สำหรับวิชา 40 ชม. หรือสอดคล้องกับจำนวนชั่วโมง)
  - มี planGroupTitle สำหรับคั่นกลุ่มหน่วย เช่น "แผนการจัดการเรียนรู้ที่ 1 เรื่อง..."
  - ทุกสัปดาห์ต้องมีข้อมูลครบทั้ง 8 คอลัมน์: weekNumber, indicators, unitAndTopic, objectives (K-P-A), coreContent, teachingMethod, mediaResources, assessment

ส่วนที่ 4: ตารางวิธีจัดเก็บคะแนน (Scoring Methods Table)
  - คะแนนระหว่างเรียน (formativeScoreTotal: 80 คะแนน) ประกอบด้วยรายการวิธีจัดเก็บและคะแนนย่อยที่รวมกันได้ 80 พอดี
  - คะแนนสอบปลายภาค (summativeScoreTotal: 20 คะแนน) ประกอบด้วยรายการสอบปลายภาค 20 คะแนน

ส่วนที่ 5: ตารางเกณฑ์การตัดสินผลการเรียน (มาตรฐานผลการเรียน 8 เกรด + ร + มส)

กฎเหล็กการสังเคราะห์ชื่อหน่วยและกิจกรรม (Strict Professional Synthesis):
- ห้ามใส่คำว่า "(ตอนที่ 1)", "(ตอนที่ 2)", "(พาร์ท 1)", "ตอนที่...", หรือนำชื่อวิชามาต่อท้ายด้วย ตอนที่ 1, 2 เป็นอันขาด
- สังเคราะห์ชื่อหน่วยการเรียนรู้ (unitTitle) และหัวข้อย่อยรายสัปดาห์ (unitAndTopic) ให้มีความหมายเฉพาะเจาะจง สื่อถึงเนื้อหาและกิจกรรมเชิงปฏิบัติจริงตามคำอธิบายภาพรวมและตัวชี้วัดที่ได้รับ

กฎเหล็กด้านเอาต์พุต (Strict JSON Output):
- คุณต้องตอบกลับเป็น JSON บริสุทธิ์ (Valid JSON) เท่านั้น
- ห้ามใส่คำทักทาย ข้อความอธิบาย หรือ Markdown code block (\`\`\`json) ใดๆ นอกเหนือจาก JSON
- สาระการเรียนรู้และกิจกรรมต้องสมจริง สอดคล้องกับระดับชั้นและบริบทการศึกษาไทย`;
}

/**
 * สร้าง Prompt สั่งสร้างโครงการจัดการเรียนรู้ฉบับสมบูรณ์
 */
export function buildLongTermPlanPrompt(input: LongTermPlanInput): string {
  const unitsInfo = input.unitBriefs && input.unitBriefs.length > 0 && input.usePerUnitDetail
    ? input.unitBriefs.map(u => `  - หน่วยที่ ${u.unitNumber}: ${u.title || '(คิดชื่อหน่วยให้เหมาะสม)'} (เนื้อหา: ${u.description || 'ออกแบบตามความเหมาะสม'}, ${u.hours ? u.hours + ' ชม.' : 'คำนวณชม.ให้อัตโนมัติ'})`).join('\n')
    : `  - ให้ AI ช่วยออกแบบและแบ่งหน่วยการเรียนรู้จำนวน ${input.totalUnits || 4} หน่วย ให้มีความต่อเนื่องและครอบคลุม`;

  const indicatorsText = input.selectedIndicators && input.selectedIndicators.length > 0
    ? input.selectedIndicators.map(ind => `  - ${ind}`).join('\n')
    : '  - กำหนดมาตรฐานและตัวชี้วัดที่สอดคล้องกับรายวิชาและระดับชั้นให้อัตโนมัติ';

  const teachingMethodsText = input.teachingMethods && input.teachingMethods.length > 0
    ? input.teachingMethods.join(', ')
    : 'Active Learning, บูรณาการการคิดวิเคราะห์และการปฏิบัติจริง';

  const scoringMethodsText = input.scoringMethods && input.scoringMethods.length > 0
    ? input.scoringMethods.join(', ')
    : 'ให้ AI ออกแบบวิธีจัดเก็บคะแนนระหว่างเรียนและปลายภาคที่เหมาะสมกับสภาพจริง';

  const directionsText = input.courseDirections && input.courseDirections.length > 0
    ? input.courseDirections.join(', ')
    : 'เน้นการปฏิบัติจริง, การคิดวิเคราะห์, และการสร้างสรรค์ผลงาน';

  const estimatedWeeks = Math.max(16, Math.min(20, Math.ceil(input.totalHours / 2)));

  return `จงออกแบบ "โครงการจัดการเรียนรู้ระยะยาว (Course Syllabus & Long-Term Plan)" ตลอดภาคเรียน ตามข้อมูลดังต่อไปนี้:

[ข้อมูลทั่วไปของรายวิชา]
- ระดับชั้น: ${input.gradeName || 'มัธยมศึกษาปีที่ 2'} (${input.gradeId})
- กลุ่มสาระการเรียนรู้: ${input.subjectGroupName || 'วิทยาศาสตร์และเทคโนโลยี'}
- รหัสวิชา: ${input.courseCode || 'ว22101'}
- ชื่อรายวิชา: ${input.courseName || 'วิทยาการคำนวณ'}
- จำนวนชั่วโมงรวมตลอดภาคเรียน: ${input.totalHours || 40} ชั่วโมง
- จำนวนหน่วยกิต: ${input.totalCredits || '1.0'} หน่วยกิต
- ภาคเรียนที่: ${input.semester || '1'}
- ปีการศึกษา: ${input.academicYear || '2569'}
- ผู้สอน: ${input.teacherName || 'ครูผู้สอน'}

[ข้อมูลหน่วยการเรียนรู้และเนื้อหา]
- จำนวนหน่วยการเรียนรู้: ${input.totalUnits || 4} หน่วย
${unitsInfo}
- คำอธิบายภาพรวมโครงการ/หัวข้อหลักที่ต้องการสอน: ${input.courseOverviewPrompt || 'ครอบคลุมตามหลักสูตรแกนกลาง'}

[มาตรฐานและตัวชี้วัดที่เลือก]
${indicatorsText}

[จุดประสงค์การเรียนรู้ (K-P-A)]
- ด้านความรู้ (K): ${input.kObjective || 'ผู้เรียนมีความรู้ความเข้าใจตามมาตรฐาน'}
- ด้านทักษะกระบวนการ (P): ${input.pObjective || 'ผู้เรียนสามารถปฏิบัติงานและสร้างสรรค์ผลงานได้'}
- ด้านคุณลักษณะอันพึงประสงค์ (A): ${input.aObjective || 'ผู้เรียนมีวินัย ใฝ่เรียนรู้ และมุ่งมั่นในการทำงาน'}

[แนวทางการจัดการเรียนรู้และการประเมิน]
- วิธีการจัดการเรียนรู้: ${teachingMethodsText}
- วิธีจัดเก็บคะแนน: ${scoringMethodsText}
- ทิศทางของโครงการ: ${directionsText}
- ข้อกำหนดเพิ่มเติม: ${input.customConstraints || 'ไม่มี'}

[ข้อกำหนดสำคัญสูงสุดในการตั้งชื่อหน่วยการเรียนรู้และตารางรายสัปดาห์ (STRICT CONSTRAINTS)]:
1. **ห้ามมีคำว่า "(ตอนที่ 1)", "(ตอนที่ 2)", "(พาร์ท 1)", "ตอนที่...", หรือนำชื่อวิชามาต่อท้ายด้วย ตอนที่ 1, 2 เป็นอันขาด**
2. ให้ AI วิเคราะห์จาก "คำอธิบายภาพรวมโครงการ/หัวข้อหลักที่ต้องการสอน", "ชื่อรายวิชา", และ "มาตรฐาน/ตัวชี้วัดที่เลือก" เพื่อสังเคราะห์ชื่อหน่วยการเรียนรู้ทั้ง ${input.totalUnits || 4} หน่วย ให้เป็นชื่อหัวข้อวิชาการเฉพาะทางที่สะท้อนสาระจริง เช่น:
   - "ความรู้เบื้องต้นและหลักการ...", "การออกแบบและการลงมือปฏิบัติ...", "การวิเคราะห์และการประยุกต์ใช้...", "โครงงานสร้างสรรค์และการประเมินผล..."
   - แต่ละหน่วยต้องมีชื่อและสาระสำคัญที่แตกต่างกันอย่างชัดเจนตามลำดับขั้นการเรียนรู้ (Pedagogical progression)
3. ในตารางรายสัปดาห์ (weeklyRows):
   - ฟิลด์ "unitAndTopic": ต้องระบุหัวข้อกิจกรรมการเรียนรู้ย่อยของสัปดาห์นั้นจริง ห้ามใส่ "(กิจกรรมที่ 1)" หรือ "(กิจกรรมที่ 2)" แบบตายตัวเด็ดขาด ให้ระบุเรื่องที่เรียนจริงอย่างเป็นรูปธรรม เช่น "การศึกษาและวิเคราะห์ปัญหาในบริบทจริง", "การระดมสมองและเลือกแนวทางแก้ไข", "การลงมือสร้างสรรค์ชิ้นงานต้นแบบ"

[ข้อกำหนดในการคำนวณตัวเลข]
1. เวลาเรียน (ชั่วโมง): ผลรวมชั่วโมงของทุกหน่วย + เวลาสอบปลายภาค (2 ชม.) ต้องเท่ากับ ${input.totalHours} ชั่วโมงพอดี
2. คะแนนเต็ม 100: ผลรวมคะแนนทุกหน่วย + จิตพิสัย (affectiveScore เช่น 10) + ปลายภาค (finalExamScore เช่น 20) = 100 คะแนนพอดี
3. ตารางรายสัปดาห์: สร้างรายละเอียดแผนรายสัปดาห์จำนวน ${estimatedWeeks} สัปดาห์ ให้สอดคล้องกับชั่วโมงและหน่วยการเรียนรู้

ตอบกลับในรูปแบบ JSON ตาม Schema นี้เท่านั้น:
{
  "subjectGroupName": "${input.subjectGroupName || ''}",
  "courseName": "${input.courseName || ''}",
  "courseCode": "${input.courseCode || ''}",
  "gradeName": "${input.gradeName || ''}",
  "totalHours": ${input.totalHours || 40},
  "totalCredits": "${input.totalCredits || '1.0'}",
  "semester": "${input.semester || '1'}",
  "academicYear": "${input.academicYear || '2569'}",
  "teacherName": "${input.teacherName || 'ครูผู้สอน'}",
  "courseDescriptionPara1": "เนื้อหาคำอธิบายรายวิชา ย่อหน้าที่ 1 บรรยายภาพรวมเนื้อหาที่ศึกษาตลอดภาคเรียน...",
  "courseDescriptionPara2": "เนื้อหาคำอธิบายรายวิชา ย่อหน้าที่ 2 บรรยายกิจกรรมการเรียนรู้ ทักษะกระบวนการ และคุณลักษณะ...",
  "indicatorsList": [
    "รหัสและข้อความตัวชี้วัดที่ 1",
    "รหัสและข้อความตัวชี้วัดที่ 2"
  ],
  "totalIndicatorsCount": 4,
  "kObjective": "1. ...\\n2. ...",
  "pObjective": "1. ...\\n2. ...",
  "aObjective": "1. ...\\n2. ...",
  "hasOrientation": true,
  "unitRows": [
    {
      "unitNumber": 1,
      "unitTitle": "หลักการสำคัญและกระบวนการคิดเชิงออกแบบ",
      "coreConcept": "ศึกษาหลักการพื้นฐาน การคิดอย่างเป็นระบบ และแนวคิดการแก้ปัญหา...",
      "indicators": "ว 4.2 ม.2/1",
      "hours": 10,
      "score": 18
    }
  ],
  "affectiveScore": 10,
  "finalExamHours": 2,
  "finalExamScore": 20,
  "weeklyRows": [
    {
      "planGroupTitle": "แผนการจัดการเรียนรู้ที่ 1 ปฐมนิเทศและข้อตกลง",
      "weekNumber": 1,
      "indicators": "-",
      "unitAndTopic": "ปฐมนิเทศและชี้แจงข้อตกลงในการเรียนรู้",
      "objectives": "K: ทราบแนวทาง... P: วางแผน... A: มีความรับผิดชอบ...",
      "coreContent": "การชี้แจงเป้าหมาย เกณฑ์คะแนน และข้อตกลงในการเรียน",
      "teachingMethod": "การบรรยายเชิงปฏิสัมพันธ์และการร่วมอภิปราย",
      "mediaResources": "เอกสารประมวลการสอน, สไลด์แนะนำรายวิชา",
      "assessment": "การประเมินการมีส่วนร่วมและการตอบคำถาม"
    },
    {
      "planGroupTitle": "แผนการจัดการเรียนรู้ที่ 2 หลักการสำคัญและกระบวนการคิดเชิงออกแบบ",
      "weekNumber": 2,
      "indicators": "ว 4.2 ม.2/1",
      "unitAndTopic": "การทำความเข้าใจปัญหาและการกำหนดเป้าหมาย",
      "objectives": "K: อธิบายขั้นตอน... P: สำรวจและเก็บข้อมูล... A: มีความมุ่งมั่น...",
      "coreContent": "หลักการทำความเข้าใจผู้ใช้และสภาพปัญหาในบริบทจริง",
      "teachingMethod": "การเรียนรู้โดยใช้ปัญหาเป็นฐาน (PBL)",
      "mediaResources": "ใบกิจกรรมสำรวจปัญหา, สื่อวิดีทัศน์กรณีศึกษา",
      "assessment": "การตรวจแบบบันทึกการสำรวจปัญหา"
    }
  ],
  "formativeScoreTotal": 80,
  "formativeScoringRows": [
    { "order": 1, "methodDescription": "การประเมินใบงานและภาระงานปฏิบัติระหว่างเรียน", "score": 50 },
    { "order": 2, "methodDescription": "การทดสอบย่อยท้ายหน่วยการเรียนรู้", "score": 20 },
    { "order": 3, "methodDescription": "การเข้าชั้นเรียน การแต่งกาย จิตพิสัย และความร่วมมือ", "score": 10 }
  ],
  "summativeScoreTotal": 20,
  "summativeScoringRows": [
    { "order": 1, "methodDescription": "การทดสอบวัดผลสัมฤทธิ์ปลายภาคเรียน", "score": 20 }
  ]
}`;
}

/**
 * สร้าง Prompt สำหรับให้ AI ช่วยร่างจุดประสงค์ K-P-A อย่างรวดเร็ว (Tier: kpa)
 */
export function buildLongTermKPAPrompt(input: Partial<LongTermPlanInput>): string {
  const indicatorsSummary = input.selectedIndicators && input.selectedIndicators.length > 0
    ? input.selectedIndicators.join(' | ')
    : 'ตามมาตรฐานกลุ่มสาระการเรียนรู้';

  return `คุณคือผู้เชี่ยวชาญด้านหลักสูตรและการเขียนจุดประสงค์เชิงพฤติกรรม (K-P-A)
ช่วยร่างจุดประสงค์การเรียนรู้ระดับรายวิชาตลอดภาคเรียน สำหรับ:
- รายวิชา: ${input.courseName || 'วิทยาการคำนวณ'} (${input.courseCode || 'ว22101'})
- ระดับชั้น: ${input.gradeName || 'มัธยมศึกษาปีที่ 2'}
- กลุ่มสาระ: ${input.subjectGroupName || 'วิทยาศาสตร์และเทคโนโลยี'}
- หัวข้อ/คำอธิบายภาพรวม: ${input.courseOverviewPrompt || 'ตามหลักสูตร'}
- ตัวชี้วัดที่เลือก: ${indicatorsSummary}

กรุณาร่างจุดประสงค์ 3 ด้าน โดยใช้คำกริยาเชิงพฤติกรรมที่ชัดเจน วัดผลได้จริงในห้องเรียน ตอบกลับในรูปแบบ JSON สั้นๆ:
{
  "k": "1. อธิบาย...\\n2. ระบุ...",
  "p": "1. ออกแบบและเขียน...\\n2. ประยุกต์ใช้...",
  "a": "1. มีความกระตือรือร้นและใฝ่เรียนรู้\\n2. ตระหนักถึงจริยธรรมและความรับผิดชอบ..."
}`;
}

/**
 * สร้าง Prompt สำหรับให้ AI ปรับปรุงแก้ไขโครงการจัดการเรียนรู้ (AI Refine)
 */
export function buildLongTermRefinePrompt(
  currentData: LongTermPlanData,
  instruction: string
): string {
  return `คุณคือผู้ช่วยสถาปนิกหลักสูตร โปรดปรับปรุงข้อมูลโครงการจัดการเรียนรู้ระยะยาวต่อไปนี้ ตามคำสั่งของผู้สอนอย่างเคร่งครัด:

[คำสั่งที่ต้องการปรับแก้]
"${instruction}"

[ข้อมูลโครงการจัดการเรียนรู้เดิม (JSON)]
${JSON.stringify(currentData, null, 2)}

ข้อกำหนด:
1. ปรับปรุงข้อมูลเฉพาะจุดที่ได้รับคำสั่ง และตรวจทานความถูกต้องเชื่อมโยงกับส่วนอื่นๆ
2. รักษาสมดุลของผลรวมเวลาเรียน (${currentData.totalHours} ชั่วโมง) และผลรวมคะแนน (100 คะแนน) ให้ถูกต้องสมบูรณ์
3. ตอบกลับเป็น JSON บริสุทธิ์ในโครงสร้างเดิม 100% ห้ามมี Markdown หรือข้อความอธิบายภายนอก`;
}

/**
 * ฟังก์ชันช่วยซ่อมแซม JSON ที่ถูกตัดทอน (Truncated JSON Repair)
 */
function tryRepairTruncatedJSON(jsonStr: string): string {
  let str = jsonStr.trim();
  str = str.replace(/,\s*$/, '');

  const stack: ('{' | '[')[] = [];
  let inString = false;
  let escape = false;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === '\\') {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '{') stack.push('{');
    else if (char === '[') stack.push('[');
    else if (char === '}') {
      if (stack.length && stack[stack.length - 1] === '{') stack.pop();
    } else if (char === ']') {
      if (stack.length && stack[stack.length - 1] === '[') stack.pop();
    }
  }

  if (inString) {
    str += '"';
  }

  str = str.replace(/,\s*"[^"]*"\s*:\s*$/, '');
  str = str.replace(/"[^"]*"\s*:\s*$/, '');
  str = str.replace(/,\s*$/, '');

  const finalStack: ('{' | '[')[] = [];
  inString = false;
  escape = false;
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (escape) { escape = false; continue; }
    if (char === '\\') { escape = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (char === '{') finalStack.push('{');
    else if (char === '[') finalStack.push('[');
    else if (char === '}') {
      if (finalStack.length && finalStack[finalStack.length - 1] === '{') finalStack.pop();
    } else if (char === ']') {
      if (finalStack.length && finalStack[finalStack.length - 1] === '[') finalStack.pop();
    }
  }

  while (finalStack.length > 0) {
    const open = finalStack.pop();
    if (open === '{') str += '}';
    else if (open === '[') str += ']';
  }

  return str;
}

/**
 * ดึงและแปลง JSON จาก Response ของ AI พร้อมระบบ Sanitization ป้องกัน JSON แตก
 */
export function parseLongTermPlanResponse(
  rawText: string,
  input: LongTermPlanInput
): LongTermPlanData {
  if (!rawText || !rawText.trim()) {
    return generateStandardLongTermPlan(input);
  }

  try {
    let cleanText = rawText.trim();
    // ตัด Markdown code fences ออก
    if (cleanText.includes('```')) {
      cleanText = cleanText.replace(/```(?:json)?([\s\S]*?)```/g, '$1').trim();
    }

    // หาขอบเขต JSON {...}
    const firstBrace = cleanText.indexOf('{');
    const lastBrace = cleanText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleanText = cleanText.substring(firstBrace, lastBrace + 1);
    } else if (firstBrace !== -1) {
      cleanText = cleanText.substring(firstBrace);
    }

    cleanText = cleanText.replace(/,\s*([}\]])/g, '$1');

    let parsed: any;
    try {
      parsed = JSON.parse(cleanText);
    } catch {
      cleanText = tryRepairTruncatedJSON(cleanText);
      parsed = JSON.parse(cleanText);
    }

    // ตรวจสอบความสมบูรณ์ของฟิลด์สำคัญ และเติมค่าเริ่มต้นหากขาดหาย
    return sanitizeLongTermData(parsed, input);
  } catch (err) {
    console.warn('[LongTermParser] Failed to parse AI JSON, synthesizing standard plan:', err);
    return generateStandardLongTermPlan(input);
  }
}

/**
 * เติมค่าความถูกต้องให้กับข้อมูลโครงการจัดการเรียนรู้
 */
function sanitizeLongTermData(parsed: any, input: LongTermPlanInput): LongTermPlanData {
  const totalHours = Number(parsed.totalHours) || input.totalHours || 40;
  const totalCredits = parsed.totalCredits || input.totalCredits || (totalHours / 40).toFixed(1);

  // ตรวจสอบ unitRows
  let unitRows: LongTermUnitRow[] = Array.isArray(parsed.unitRows) && parsed.unitRows.length > 0
    ? parsed.unitRows.map((u: any, idx: number) => {
        let title = String(u.unitTitle || '')
          .replace(/\s*\(?ตอนที่\s*\d+\)?/gi, '')
          .replace(/\s*ตอนที่\s*\d+/gi, '')
          .trim();
        if (!title) {
          title = `หน่วยที่ ${idx + 1} เรื่อง การเรียนรู้${input.courseName}`;
        }
        return {
          unitNumber: u.unitNumber || (idx + 1),
          unitTitle: title,
          coreConcept: u.coreConcept || 'ศึกษาและเรียนรู้สาระสำคัญตามมาตรฐานการเรียนรู้',
          indicators: u.indicators || (input.selectedIndicators[idx % input.selectedIndicators.length] || '-'),
          hours: Number(u.hours) || Math.floor((totalHours - 2) / (parsed.unitRows.length || 4)),
          score: Number(u.score) || Math.floor(70 / (parsed.unitRows.length || 4)),
        };
      })
    : generateDefaultUnitRows(input);

  // ปรับคะแนนและชั่วโมงให้ลงตัว 100 คะแนน และ totalHours
  const finalExamHours = Number(parsed.finalExamHours) || 2;
  const finalExamScore = Number(parsed.finalExamScore) || 20;
  const affectiveScore = Number(parsed.affectiveScore) || 10;

  // ตรวจสอบ weeklyRows
  const weeklyRows: WeeklyPlanRow[] = Array.isArray(parsed.weeklyRows) && parsed.weeklyRows.length > 0
    ? parsed.weeklyRows.map((w: any, idx: number) => {
        let topic = String(w.unitAndTopic || '')
          .replace(/\s*\(?ตอนที่\s*\d+\)?/gi, '')
          .replace(/\s*\(?กิจกรรมที่\s*\d+\)?/gi, '')
          .trim();
        if (!topic) topic = `กิจกรรมการเรียนรู้สัปดาห์ที่ ${idx + 1}`;

        let groupTitle = w.planGroupTitle
          ? String(w.planGroupTitle).replace(/\s*\(?ตอนที่\s*\d+\)?/gi, '').trim()
          : undefined;

        return {
          planGroupTitle: groupTitle,
          weekNumber: w.weekNumber || (idx + 1),
          indicators: w.indicators || '-',
          unitAndTopic: topic,
          objectives: w.objectives || 'ผู้เรียนมีความรู้ ทักษะ และเจตคติที่ดี',
          coreContent: w.coreContent || 'กิจกรรมการเรียนรู้ตามหลักสูตร',
          teachingMethod: w.teachingMethod || (input.teachingMethods[0] || 'Active Learning'),
          mediaResources: w.mediaResources || 'ใบงาน, สื่อมัลติมีเดีย',
          assessment: w.assessment || 'การประเมินชิ้นงานและการสังเกตพฤติกรรม',
        };
      })
    : generateDefaultWeeklyRows(input, unitRows);

  // ตรวจสอบคะแนนจัดเก็บ
  const formativeScoringRows: ScoringMethodRow[] = Array.isArray(parsed.formativeScoringRows) && parsed.formativeScoringRows.length > 0
    ? parsed.formativeScoringRows
    : [
        { order: 1, methodDescription: 'การประเมินใบงาน แบบฝึกหัด และภาระงานปฏิบัติ', score: 50 },
        { order: 2, methodDescription: 'การทดสอบย่อยท้ายหน่วยการเรียนรู้', score: 20 },
        { order: 3, methodDescription: 'การเข้าชั้นเรียน การแต่งกาย จิตพิสัย และความร่วมมือ', score: affectiveScore },
      ];

  const summativeScoringRows: ScoringMethodRow[] = Array.isArray(parsed.summativeScoringRows) && parsed.summativeScoringRows.length > 0
    ? parsed.summativeScoringRows
    : [
        { order: 1, methodDescription: 'การทดสอบวัดผลสัมฤทธิ์ทางการเรียนปลายภาค', score: finalExamScore },
      ];

  const indicatorsList = Array.isArray(parsed.indicatorsList) && parsed.indicatorsList.length > 0
    ? parsed.indicatorsList
    : (input.selectedIndicators.length > 0 ? input.selectedIndicators : ['มาตรฐานการเรียนรู้ตามหลักสูตรแกนกลาง']);

  return {
    subjectGroupName: parsed.subjectGroupName || input.subjectGroupName || 'กลุ่มสาระการเรียนรู้',
    courseName: parsed.courseName || input.courseName || 'ชื่อรายวิชา',
    courseCode: parsed.courseCode || input.courseCode || 'รหัสวิชา',
    gradeName: parsed.gradeName || input.gradeName || 'ระดับชั้น',
    totalHours,
    totalCredits,
    semester: parsed.semester || input.semester || '1',
    academicYear: parsed.academicYear || input.academicYear || '2569',
    teacherName: parsed.teacherName || input.teacherName || 'ครูผู้สอน',

    courseDescriptionPara1: parsed.courseDescriptionPara1 || `ศึกษา ค้นคว้า ฝึกทักษะและกระบวนการเรียนรู้ในรายวิชา ${input.courseName} โดยเน้นองค์ความรู้ที่สำคัญและทักษะที่จำเป็นในศตวรรษที่ 21`,
    courseDescriptionPara2: parsed.courseDescriptionPara2 || `โดยใช้กระบวนการจัดการเรียนรู้เชิงรุก (Active Learning) การคิดวิเคราะห์ การแก้ปัญหา และการทำงานร่วมกัน เพื่อให้ผู้เรียนเกิดความรู้ ความเข้าใจ มีวินัย และเจตคติที่ดี`,
    indicatorsList,
    totalIndicatorsCount: Number(parsed.totalIndicatorsCount) || indicatorsList.length,
    kObjective: parsed.kObjective || input.kObjective || '1. มีความรู้ความเข้าใจในเนื้อหาสาระสำคัญ\n2. อธิบายหลักการและกระบวนการได้อย่างถูกต้อง',
    pObjective: parsed.pObjective || input.pObjective || '1. สามารถปฏิบัติงานตามขั้นตอนได้อย่างถูกต้อง\n2. ประยุกต์ใช้ความรู้ในการแก้ปัญหาและสร้างสรรค์ผลงาน',
    aObjective: parsed.aObjective || input.aObjective || '1. มีวินัย ใฝ่เรียนรู้ และมุ่งมั่นในการทำงาน\n2. มีเจตคติที่ดีและร่วมมือในการทำงานเป็นทีม',

    hasOrientation: true,
    unitRows,
    affectiveScore,
    finalExamHours,
    finalExamScore,

    weeklyRows,

    formativeScoreTotal: Number(parsed.formativeScoreTotal) || 80,
    formativeScoringRows,
    summativeScoreTotal: Number(parsed.summativeScoreTotal) || 20,
    summativeScoringRows,
  };
}

/**
 * สร้างข้อมูลมาตรฐานสำรองกรณีไม่มีผลจาก AI เพื่อรับประกันว่าระบบไม่มีวันล่ม (Guaranteed Fallback)
 */
export function generateStandardLongTermPlan(input: LongTermPlanInput): LongTermPlanData {
  const totalHours = input.totalHours || 40;
  const totalCredits = input.totalCredits || (totalHours / 40).toFixed(1);
  const unitRows = generateDefaultUnitRows(input);
  const weeklyRows = generateDefaultWeeklyRows(input, unitRows);
  const indicatorsList = input.selectedIndicators.length > 0
    ? input.selectedIndicators
    : ['มาตรฐานการเรียนรู้ตามหลักสูตรแกนกลางการศึกษาขั้นพื้นฐาน'];

  return {
    subjectGroupName: input.subjectGroupName || 'กลุ่มสาระการเรียนรู้',
    courseName: input.courseName || 'ชื่อรายวิชา',
    courseCode: input.courseCode || 'รหัสวิชา',
    gradeName: input.gradeName || 'ระดับชั้น',
    totalHours,
    totalCredits,
    semester: input.semester || '1',
    academicYear: input.academicYear || '2569',
    teacherName: input.teacherName || 'ครูผู้สอน',

    courseDescriptionPara1: `ศึกษาและเรียนรู้เกี่ยวกับ ${input.courseOverviewPrompt || input.courseName} เพื่อให้ผู้เรียนมีความรู้ความเข้าใจในหลักการ ทฤษฎี และกระบวนการที่เกี่ยวข้อง สามารถสืบค้นข้อมูล วิเคราะห์ และสังเคราะห์สาระสำคัญได้อย่างมีประสิทธิภาพ`,
    courseDescriptionPara2: `โดยใช้กระบวนการจัดการเรียนรู้แบบ ${input.teachingMethods.join(', ') || 'Active Learning'} มุ่งเน้นการลงมือปฏิบัติจริง การแก้ปัญหาอย่างเป็นระบบ การทำงานเป็นทีม และการสื่อสารอย่างสร้างสรรค์ เพื่อพัฒนาผู้เรียนให้มีสมรรถนะสำคัญและคุณลักษณะอันพึงประสงค์ตามหลักสูตร`,
    indicatorsList,
    totalIndicatorsCount: indicatorsList.length,
    kObjective: input.kObjective || '1. อธิบายหลักการ ทฤษฎี และแนวคิดสำคัญของบทเรียนได้อย่างถูกต้อง\n2. ระบุและเชื่อมโยงความรู้สู่การประยุกต์ใช้ในสถานการณ์จริง',
    pObjective: input.pObjective || '1. วางแผน ปฏิบัติการ และแก้ปัญหาตามกระบวนการได้อย่างถูกต้อง\n2. สื่อสารและนำเสนอผลงานได้อย่างชัดเจนและเป็นระบบ',
    aObjective: input.aObjective || '1. มีวินัย ใฝ่เรียนรู้ และมุ่งมั่นในการทำงาน\n2. ตระหนักถึงความสำคัญและมีเจตคติที่ดีต่อการเรียนรู้',

    hasOrientation: true,
    unitRows,
    affectiveScore: 10,
    finalExamHours: 2,
    finalExamScore: 20,

    weeklyRows,

    formativeScoreTotal: 80,
    formativeScoringRows: [
      { order: 1, methodDescription: 'การประเมินใบงานและภาระงานปฏิบัติระหว่างเรียน', score: 50 },
      { order: 2, methodDescription: 'การทดสอบย่อยท้ายหน่วยการเรียนรู้', score: 20 },
      { order: 3, methodDescription: 'การเข้าชั้นเรียน การแต่งกาย จิตพิสัย และความร่วมมือ', score: 10 },
    ],
    summativeScoreTotal: 20,
    summativeScoringRows: [
      { order: 1, methodDescription: 'การทดสอบวัดผลสัมฤทธิ์ทางการเรียนปลายภาคเรียน', score: 20 },
    ],
  };
}

function generateDefaultUnitRows(input: LongTermPlanInput): LongTermUnitRow[] {
  const numUnits = input.totalUnits || 4;
  const availableHours = Math.max(numUnits, (input.totalHours || 40) - 2);
  const baseHours = Math.floor(availableHours / numUnits);
  const remainderHours = availableHours % numUnits;

  const baseScore = Math.floor(70 / numUnits);
  const remainderScore = 70 % numUnits;

  // ดึงหัวข้อจากคำอธิบายภาพรวมโครงการที่ผู้ใช้กรอก (ถ้ามี)
  const extractedTopics: string[] = [];
  if (input.courseOverviewPrompt && input.courseOverviewPrompt.trim()) {
    const rawParts = input.courseOverviewPrompt
      .split(/[\n,;•·|\/]+/)
      .map(s => s.trim().replace(/^(?:หน่วยที่\s*\d+[:.]?|\d+[\.\)]\s*|เรื่อง\s*)/, '').trim())
      .filter(s => s.length >= 3 && !s.includes('ตอนที่'));
    extractedTopics.push(...rawParts);
  }

  // ลำดับขั้นการเรียนรู้และหัวข้อมาตรฐานเชิงวิชาการตามหลักสูตรไทย (Pedagogical Progression)
  const pedagogicalThemes = [
    {
      prefix: 'พื้นฐานและหลักการสำคัญของ',
      concept: 'ศึกษาความหมาย แนวคิด ความสำคัญ และหลักการพื้นฐานที่เกี่ยวข้องอย่างเป็นระบบ',
    },
    {
      prefix: 'กระบวนการและทักษะการปฏิบัติงานด้าน',
      concept: 'ฝึกทักษะการใช้เครื่องมือ อุปกรณ์ และขั้นตอนกระบวนการปฏิบัติงานจริงอย่างถูกต้องปลอดภัย',
    },
    {
      prefix: 'การคิดวิเคราะห์ การแก้ปัญหา และการประยุกต์ใช้',
      concept: 'วิเคราะห์สถานการณ์ ปัญหา และประยุกต์ใช้องค์ความรู้เพื่อแก้ปัญหาในชีวิตจริง',
    },
    {
      prefix: 'การสร้างสรรค์ผลงาน นวัตกรรม และโครงงาน',
      concept: 'วางแผน ออกแบบ และลงมือสร้างสรรค์ชิ้นงานหรือโครงงานบูรณาการที่มีคุณภาพ',
    },
    {
      prefix: 'การทดสอบ ประเมินผล และการพัฒนาต่อยอด',
      concept: 'ทดสอบประสิทธิภาพ ประเมินผลงาน ปรับปรุงแก้ไข และพัฒนาต่อยอดองค์ความรู้',
    },
    {
      prefix: 'คุณธรรม จริยธรรม และผลกระทบต่อสังคมของ',
      concept: 'ตระหนักถึงสิทธิ จริยธรรม ความรับผิดชอบ และผลกระทบต่อสิ่งแวดล้อมและสังคม',
    },
  ];

  const rows: LongTermUnitRow[] = [];
  for (let i = 1; i <= numUnits; i++) {
    const brief = input.unitBriefs?.find(b => b.unitNumber === i);
    let title = (brief?.title || '').trim().replace(/\s*\(?ตอนที่\s*\d+\)?/gi, '');
    let desc = (brief?.description || '').trim();

    if (!title) {
      if (extractedTopics.length >= i) {
        title = `หน่วยที่ ${i} เรื่อง ${extractedTopics[i - 1]}`;
      } else {
        const theme = pedagogicalThemes[(i - 1) % pedagogicalThemes.length];
        title = `หน่วยที่ ${i} เรื่อง ${theme.prefix}${input.courseName}`;
        if (!desc) desc = theme.concept;
      }
    }

    if (!desc) {
      desc = `ศึกษา วิเคราะห์ และฝึกทักษะการเรียนรู้ที่สอดคล้องกับสาระสำคัญของ${title}`;
    }

    const indicator = input.selectedIndicators[i - 1] || input.selectedIndicators[0] || `มาตรฐานข้อที่ ${i}`;

    rows.push({
      unitNumber: i,
      unitTitle: title,
      coreConcept: desc,
      indicators: indicator,
      hours: baseHours + (i <= remainderHours ? 1 : 0),
      score: baseScore + (i <= remainderScore ? 1 : 0),
    });
  }
  return rows;
}

function generateDefaultWeeklyRows(
  input: LongTermPlanInput,
  unitRows: LongTermUnitRow[]
): WeeklyPlanRow[] {
  const totalWeeks = Math.max(16, Math.min(20, Math.ceil((input.totalHours || 40) / 2)));
  const rows: WeeklyPlanRow[] = [];

  // Week 1: ปฐมนิเทศ
  rows.push({
    planGroupTitle: 'แผนการจัดการเรียนรู้ที่ 1 ปฐมนิเทศและข้อตกลงในการเรียน',
    weekNumber: 1,
    indicators: '-',
    unitAndTopic: 'ปฐมนิเทศและชี้แจงข้อตกลงในการเรียนรู้',
    objectives: 'K: เข้าใจโครงสร้างรายวิชา | P: วางแผนการเรียนรู้ | A: มีวินัยและตรงต่อเวลา',
    coreContent: 'ชี้แจงคำอธิบายรายวิชา วัตถุประสงค์ เกณฑ์การให้คะแนน และข้อตกลงร่วมกันในห้องเรียน',
    teachingMethod: 'การบรรยายเชิงปฏิสัมพันธ์และการอภิปรายกลุ่ม',
    mediaResources: 'เอกสารประมวลการสอน, สไลด์แนะนำวิชา',
    assessment: 'การมีส่วนร่วมในกิจกรรมและการตอบคำถาม',
  });

  // Weeks 2 to totalWeeks - 1: Distributed across units
  const teachingWeeks = totalWeeks - 2;
  const weeksPerUnit = Math.max(1, Math.floor(teachingWeeks / unitRows.length));

  const weeklyPedagogicalPhases = [
    'การศึกษาค้นคว้าและทำความเข้าใจแนวคิดหลัก',
    'การวิเคราะห์กรณีศึกษาและการฝึกปฏิบัติการ',
    'การแก้ปัญหาและการลงมือสร้างสรรค์ชิ้นงาน',
    'การทดสอบ ปรับปรุง และสรุปองค์ความรู้',
    'การนำเสนอและประเมินผลสัมฤทธิ์ทางการเรียน',
  ];

  let currentUnitIdx = 0;
  for (let w = 2; w <= totalWeeks - 1; w++) {
    const unit = unitRows[currentUnitIdx] || unitRows[unitRows.length - 1];
    const subWeek = (w - 2) % weeksPerUnit;
    const isNewPlan = subWeek === 0;

    const activityPhase = weeklyPedagogicalPhases[subWeek % weeklyPedagogicalPhases.length];
    const pureUnitTitle = unit.unitTitle.replace(/^หน่วยที่\s*\d+\s*(?:เรื่อง\s*)?/, '').trim();
    const topicTitle = `${pureUnitTitle}: ${activityPhase}`;

    rows.push({
      planGroupTitle: isNewPlan ? `แผนการจัดการเรียนรู้ที่ ${currentUnitIdx + 2} ${unit.unitTitle}` : undefined,
      weekNumber: w,
      indicators: unit.indicators,
      unitAndTopic: topicTitle,
      objectives: 'K: อธิบายสาระสำคัญ | P: ปฏิบัติกิจกรรมตามขั้นตอน | A: มีความมุ่งมั่นในการทำงาน',
      coreContent: unit.coreConcept,
      teachingMethod: input.teachingMethods[0] || 'Active Learning',
      mediaResources: 'ใบความรู้, ใบงานปฏิบัติการ, สื่อการเรียนรู้ดิจิทัล',
      assessment: 'การตรวจใบงาน และการสังเกตพฤติกรรมการเรียนรู้',
    });

    if ((w - 1) % weeksPerUnit === 0 && currentUnitIdx < unitRows.length - 1) {
      currentUnitIdx++;
    }
  }

  // Final Week: สอบปลายภาค
  rows.push({
    planGroupTitle: `แผนการจัดการเรียนรู้ที่ ${unitRows.length + 2} การวัดผลสัมฤทธิ์ปลายภาคเรียน`,
    weekNumber: totalWeeks,
    indicators: input.selectedIndicators.join(', ') || '-',
    unitAndTopic: 'การวัดผลสัมฤทธิ์ทางการเรียนปลายภาคเรียน',
    objectives: 'K: ประเมินความรอบรู้ในเนื้อหา | P: คิดวิเคราะห์และถ่ายทอดคำตอบ | A: มีความซื่อสัตย์สุจริต',
    coreContent: 'การทดสอบวัดความรู้และสมรรถนะผู้เรียนตามมาตรฐานและตัวชี้วัดตลอดภาคเรียน',
    teachingMethod: 'การทดสอบข้อเขียนและการประเมินตามสภาพจริง',
    mediaResources: 'แบบทดสอบปลายภาค, กระดาษคำตอบ',
    assessment: 'การตรวจแบบทดสอบวัดผลสัมฤทธิ์ปลายภาคเรียน',
  });

  return rows;
}

