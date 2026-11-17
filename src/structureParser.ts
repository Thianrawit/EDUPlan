/**
 * EduPlan AI — Course Structure (.docx) Dual-Mode Parser
 * ============================================================
 * ชั้นที่ 1: Zero-Token DOM Parser (แกะตารางแผนรายสัปดาห์ 8 คอลัมน์ + ยุบรวมแผน (ต่อ))
 * ชั้นที่ 2: AI Smart Extractor Fallback (BYOK โหมดด่วนเท่านั้น + ประหยัด Token สูงสุด)
 * ============================================================
 */

import mammoth from 'mammoth';
import {
  loadCurriculum,
  findStandardByCode,
  enrichStandardsString,
  type CurriculumData,
} from './curriculum';
import { callGeminiByokFastOnly, sanitizeJsonString } from './gemini';
import type { LessonPlanData } from './types';

export interface ExtractedPlanItem {
  id: string;
  planNumber: number; // ลำดับแผน เช่น 1, 2, 3...
  weekLabel: string; // เช่น "สัปดาห์ที่ 2-3" หรือ "สัปดาห์ที่ 1"
  unit: string; // หน่วยการเรียนรู้
  topic: string; // ชื่อแผน / เรื่อง
  hours: number; // จำนวนชั่วโมง (คำนวณจากจำนวนสัปดาห์/คาบ)
  standards: string; // มาตรฐานการเรียนรู้
  indicators: string; // ตัวชี้วัด เช่น "ว 4.2 ม.2/4"
  k_objective: string; // ด้านความรู้ (K)
  p_objective: string; // ด้านทักษะกระบวนการ (P)
  a_objective: string; // ด้านคุณลักษณะอันพึงประสงค์ (A)
  key_concepts: string; // หัวข้อ / สาระสำคัญ
  teaching_method: string; // วิธีจัดการเรียนรู้
  media_resources: string; // สื่อ / แหล่งเรียนรู้
  evaluation_method: string; // วิธีการวัดและประเมินผล
  selected: boolean; // ค่าเริ่มต้น = true (ติ๊กเลือกทั้งหมด)
  status: 'idle' | 'queued' | 'generating' | 'completed' | 'error';
  generatedPlan?: LessonPlanData;
  errorMessage?: string;
}

export interface CourseStructureBatchJob {
  jobId: string;
  fileName: string;
  subjectGroup: string; // กลุ่มสาระการเรียนรู้
  courseCode: string; // รหัสวิชา เช่น "ว22101"
  courseName: string; // ชื่อรายวิชา เช่น "ออกแบบฯ"
  grade: string; // ระดับชั้น เช่น "ม.2"
  totalHours: string; // จำนวนชั่วโมงรวม
  semester: string; // ภาคเรียน
  academicYear: string; // ปีการศึกษา
  teacherName: string; // ชื่อผู้สอน
  teacherPosition: string; // ตำแหน่งผู้สอน
  schoolName: string; // ชื่อโรงเรียน
  teachingDate: string; // วันที่สอน (ค่าเริ่มต้น "………………………………")
  parseSource: 'template-match' | 'ai-fallback';
  plans: ExtractedPlanItem[];
}

export interface SavedHeaderDefaults {
  schoolName: string;
  teacherName: string;
  teacherPosition: string;
  semester: string;
  academicYear: string;
}

/**
 * ดึงค่าเริ่มต้นส่วนหัวที่ผู้ใช้เคยกรอกค้างไว้จาก LocalStorage ของระบบสร้างแผนเดิม
 */
export function getSavedHeaderDefaults(): SavedHeaderDefaults {
  const currentBuddhistYear = String(new Date().getFullYear() + 543);
  const defaults: SavedHeaderDefaults = {
    schoolName: '……………………………………………',
    teacherName: '',
    teacherPosition: 'ครู',
    semester: '1',
    academicYear: currentBuddhistYear,
  };

  try {
    const rawDraft = localStorage.getItem('eduplan_ai_draft');
    if (rawDraft) {
      const draft = JSON.parse(rawDraft);
      if (draft?.school && String(draft.school).trim()) {
        defaults.schoolName = String(draft.school).trim();
      }
      if (draft?.teacherName && String(draft.teacherName).trim()) {
        defaults.teacherName = String(draft.teacherName).trim();
      }
      if (draft?.teacherPosition && String(draft.teacherPosition).trim()) {
        defaults.teacherPosition = String(draft.teacherPosition).trim();
      }
      if (draft?.semester && String(draft.semester).trim()) {
        defaults.semester = String(draft.semester).trim();
      }
      if (draft?.academicYear && String(draft.academicYear).trim()) {
        defaults.academicYear = String(draft.academicYear).trim();
      }
    }
  } catch {
    // ignore
  }

  try {
    const rawLt = localStorage.getItem('eduplan_longterm_draft');
    if (rawLt) {
      const lt = JSON.parse(rawLt);
      const inp = lt?.inputs;
      if (!defaults.teacherName && inp?.teacherName && String(inp.teacherName).trim()) {
        defaults.teacherName = String(inp.teacherName).trim();
      }
      if (inp?.semester && String(inp.semester).trim()) {
        defaults.semester = String(inp.semester).trim();
      }
      if (inp?.academicYear && String(inp.academicYear).trim()) {
        defaults.academicYear = String(inp.academicYear).trim();
      }
    }
  } catch {
    // ignore
  }

  return defaults;
}

function makeId(prefix = 'plan'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * อ่านข้อความจาก Element โดยรักษาการขึ้นบรรทัดใหม่ของ <p>, <br>, <li>
 */
function extractCellLines(el: Element | null | undefined): string[] {
  if (!el) return [];
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
  clone.querySelectorAll('p, div, li, tr').forEach(block => {
    block.append('\n');
  });
  const raw = (clone.textContent || '').replace(/\u00A0/g, ' ');
  return raw
    .split(/\r?\n/)
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function extractCellText(el: Element | null | undefined): string {
  return extractCellLines(el).join('\n');
}

/**
 * รวมข้อความ 2 ส่วนโดยตัดบรรทัดที่ซ้ำกันออกอย่างเป็นระเบียบ
 */
function mergeUniqueMultiline(a: string, b: string): string {
  const linesA = (a || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && l !== '-');
  const linesB = (b || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && l !== '-');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of [...linesA, ...linesB]) {
    const norm = line.replace(/\s+/g, ' ').toLowerCase();
    if (!seen.has(norm)) {
      seen.add(norm);
      out.push(line);
    }
  }
  return out.join('\n');
}

/**
 * แยกข้อความในช่องจุดประสงค์การเรียนรู้ K:, P:, A: (รองรับทั้งอยู่บรรทัดเดียวกัน, คั่นด้วย |, แยกหลายบรรทัด และแบบมีวงเล็บ [...])
 */
export function splitKpaObjectives(raw: string): { k: string; p: string; a: string } {
  const text = (raw || '').replace(/\u00A0/g, ' ').trim();
  if (!text || text === '-') return { k: '', p: '', a: '' };

  const kLabel = '(?:ด้านความรู้\\s*\\(\\s*K\\s*\\)|ความรู้\\s*\\(\\s*K\\s*\\))\\s*[:：\\-]?|(?:(?<![A-Za-z0-9])K\\s*[:：])';
  const pLabel =
    '(?:ด้านทักษะ(?:และ)?กระบวนการ\\s*\\(\\s*P\\s*\\)|ทักษะ(?:และ)?กระบวนการ\\s*\\(\\s*P\\s*\\)|ด้านทักษะ\\s*\\(\\s*P\\s*\\))\\s*[:：\\-]?|(?:(?<![A-Za-z0-9])P\\s*[:：])';
  const aLabel =
    '(?:ด้านคุณลักษณะ(?:อันพึงประสงค์)?\\s*\\(\\s*A\\s*\\)|คุณลักษณะ(?:อันพึงประสงค์)?\\s*\\(\\s*A\\s*\\))\\s*[:：\\-]?|(?:(?<![A-Za-z0-9])A\\s*[:：])';

  const markerRegex = new RegExp(
    `(?:^|[\\s|;•\\[\\]\\n\\r]+|(?<=[ก-๛]))(?:(?:\\d+[\\.\\)]\\s*)|(?:[-•*–—]+\\s*))?(?:(${kLabel})|(${pLabel})|(${aLabel}))\\s*`,
    'gi',
  );

  const matches: { bucket: 'k' | 'p' | 'a'; index: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = markerRegex.exec(text)) !== null) {
    const bucket: 'k' | 'p' | 'a' = m[1] ? 'k' : m[2] ? 'p' : 'a';
    matches.push({ bucket, index: m.index, end: m.index + m[0].length });
  }

  if (matches.length === 0) {
    return { k: text, p: '', a: '' };
  }

  const buckets: Record<'k' | 'p' | 'a', string[]> = { k: [], p: [], a: [] };
  const lead = text
    .slice(0, matches[0].index)
    .replace(/^[\s\[|;•\-–—]+|[\s\]|;•\-–—]+$/g, '')
    .trim();
  if (lead) buckets.k.push(lead);

  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const nextIdx = i + 1 < matches.length ? matches[i + 1].index : text.length;
    let chunk = text.slice(cur.end, nextIdx).trim();
    if (i === matches.length - 1 && text.startsWith('[') && chunk.endsWith(']')) {
      chunk = chunk.slice(0, -1).trim();
    }
    chunk = chunk.replace(/^[\s|;]+|[\s|;]+$/g, '').trim();
    if (chunk) buckets[cur.bucket].push(chunk);
  }

  return {
    k: buckets.k.join('\n').trim(),
    p: buckets.p.join('\n').trim(),
    a: buckets.a.join('\n').trim(),
  };
}

/**
 * แยกหน่วยการเรียนรู้และชื่อเรื่องออกจากคอลัมน์ "หน่วยการเรียนรู้/เรื่อง"
 */
function splitUnitAndTopic(
  rawCell: string,
  bannerTitle: string,
  lastKnownUnit: string
): { unit: string; topic: string; isContinuation: boolean; explicitPlanNum: number | null } {
  const fullText = `${bannerTitle}\n${rawCell}`;
  const isContinuation = /\(\s*ต่อ\s*\)|(?:\s|^)ต่อ\s*$/.test(rawCell.trim()) || /\(\s*ต่อ\s*\)/.test(bannerTitle.trim());

  let explicitPlanNum: number | null = null;
  const planMatch = fullText.match(/แผน(?:การจัดการเรียนรู้)?ที่\s*(\d+)/);
  if (planMatch) {
    explicitPlanNum = parseInt(planMatch[1], 10);
  }

  const stripCont = (s: string) =>
    s
      .replace(/\(\s*ต่อ\s*\)/g, '')
      .replace(/\s+ต่อ\s*$/g, '')
      .replace(/^แผน(?:การจัดการเรียนรู้)?ที่\s*\d+\s*[:：\-]?\s*/i, '')
      .replace(/^เรื่อง\s*[:：]?\s*/i, '')
      .trim();

  const lines = rawCell
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  let unit = '';
  const topicParts: string[] = [];

  for (const line of lines) {
    if (/^หน่วย(?:การเรียนรู้)?(?:ที่)?\s*\d+/i.test(line)) {
      // กรณีบรรทัดเดียวมีทั้งหน่วยและเรื่อง เช่น "หน่วยการเรียนรู้ที่ 1 แนวคิดเชิงคำนวณ เรื่อง อัลกอริทึม"
      const splitOnTopic = line.split(/\s+(?=เรื่อง\s*[:：]?)/i);
      if (splitOnTopic.length > 1) {
        unit = splitOnTopic[0].replace(/\(\s*ต่อ\s*\)/g, '').trim();
        topicParts.push(stripCont(splitOnTopic.slice(1).join(' ')));
      } else {
        unit = line.replace(/\(\s*ต่อ\s*\)/g, '').trim();
      }
    } else if (/^แผน(?:การจัดการเรียนรู้)?ที่\s*\d+/i.test(line)) {
      const cleaned = stripCont(line);
      if (cleaned) topicParts.push(cleaned);
    } else {
      const cleaned = stripCont(line);
      if (cleaned) topicParts.push(cleaned);
    }
  }

  if (!unit && lastKnownUnit) {
    unit = lastKnownUnit;
  }

  let topic = topicParts.filter(Boolean).join(' - ').trim();
  if (!topic && bannerTitle) {
    topic = stripCont(bannerTitle);
  }
  if (!topic && unit) {
    topic = stripCont(unit);
  }

  return {
    unit: unit || 'หน่วยการเรียนรู้',
    topic: topic || 'บทเรียนตามโครงสร้างรายวิชา',
    isContinuation,
    explicitPlanNum,
  };
}

/**
 * แปลงรายการเลขสัปดาห์เป็นป้าย เช่น [2, 3] -> "สัปดาห์ที่ 2-3", [1] -> "สัปดาห์ที่ 1"
 */
function formatWeekLabel(weeks: number[], rawLabels: string[]): string {
  const uniqueNums = Array.from(new Set(weeks.filter(n => !Number.isNaN(n) && n > 0))).sort((a, b) => a - b);
  if (uniqueNums.length === 1) {
    return `สัปดาห์ที่ ${uniqueNums[0]}`;
  }
  if (uniqueNums.length > 1) {
    const min = uniqueNums[0];
    const max = uniqueNums[uniqueNums.length - 1];
    const isContiguous = uniqueNums.length === max - min + 1;
    if (isContiguous) {
      return `สัปดาห์ที่ ${min}-${max}`;
    }
    return `สัปดาห์ที่ ${uniqueNums.join(', ')}`;
  }
  const cleanRaw = Array.from(new Set(rawLabels.map(r => r.replace(/^สัปดาห์ที่\s*/, '').trim()).filter(Boolean)));
  return cleanRaw.length ? `สัปดาห์ที่ ${cleanRaw.join('-')}` : 'สัปดาห์ที่ 1';
}

/**
 * ดึงรหัสตัวชี้วัดและเติมคำอธิบายมาตรฐานการเรียนรู้จากฐานข้อมูล curriculum.json หรือส่วนหัวเอกสาร
 */
function buildStandardsAndIndicators(
  rawIndicators: string,
  docIndicatorMap: Map<string, string>,
  docStandardsMap: Map<string, string>,
  curriculum: CurriculumData | null
): { standards: string; indicators: string } {
  const raw = (rawIndicators || '').trim();
  if (!raw || raw === '-' || /^ไม่มี/.test(raw)) {
    return { standards: '-', indicators: '-' };
  }

  // ดึงรหัสตัวชี้วัดทั้งหมด เช่น "ว 4.2 ม.2/1", "ท 1.1 ป.1/2", "ค 1.1 ม.1/1"
  const codeRegex = /([ก-ฮ]{1,3}\s*\d+\.\d+\s*(?:ม\.|ป\.|อ\.)\s*\d+(?:\s*-\s*\d+)?\/\d+|มฐ\.?\s*\d+(?:\.\d+)?)/g;
  const matchedCodes = raw.match(codeRegex) || [];

  const indicatorLines: string[] = [];
  const standardLines: string[] = [];
  const seenStd = new Set<string>();
  const seenInd = new Set<string>();

  const findIndicatorTextInCurriculum = (indCode: string): string => {
    const normCode = indCode.replace(/\s+/g, '').toLowerCase();
    for (const [k, v] of docIndicatorMap.entries()) {
      if (k.replace(/\s+/g, '').toLowerCase() === normCode) return v;
    }
    if (!curriculum?.standards) return '';
    const stdMatch = indCode.match(/([ก-ฮ]{1,3}\s*\d+\.\d+)/);
    if (!stdMatch) return '';
    const std = findStandardByCode(stdMatch[1], curriculum);
    if (!std?.gradeLevels) return '';
    for (const inds of Object.values(std.gradeLevels)) {
      for (const item of inds) {
        if (item.code.replace(/\s+/g, '').toLowerCase() === normCode) {
          return `${item.code}: ${item.text}`;
        }
      }
    }
    return '';
  };

  if (matchedCodes.length > 0) {
    for (const rawCode of matchedCodes) {
      const cleanCode = rawCode.replace(/\s+/g, ' ').trim();
      const normKey = cleanCode.replace(/\s+/g, '').toLowerCase();
      if (!seenInd.has(normKey)) {
        seenInd.add(normKey);
        const fullInd = findIndicatorTextInCurriculum(cleanCode);
        indicatorLines.push(fullInd || cleanCode);
      }

      const stdPrefixMatch = cleanCode.match(/([ก-ฮ]{1,3}\s*\d+\.\d+)/);
      if (stdPrefixMatch) {
        const stdCode = stdPrefixMatch[1].replace(/\s+/g, ' ').trim();
        const stdKey = stdCode.replace(/\s+/g, '').toLowerCase();
        if (!seenStd.has(stdKey)) {
          seenStd.add(stdKey);
          const fromDoc = docStandardsMap.get(stdKey);
          if (fromDoc) {
            standardLines.push(fromDoc);
          } else {
            const stdObj = findStandardByCode(stdCode, curriculum || undefined);
            if (stdObj) {
              const cClean = stdObj.code.replace(/^มาตรฐาน\s*/, '').trim();
              standardLines.push(`${cClean}: ${stdObj.title}`);
            } else {
              standardLines.push(enrichStandardsString(stdCode, curriculum || undefined));
            }
          }
        }
      }
    }
  } else {
    const rawLines = raw
      .split(/\r?\n|[,;]/)
      .map(l => l.trim())
      .filter(Boolean);
    for (const line of rawLines) {
      const norm = line.toLowerCase();
      if (!seenInd.has(norm)) {
        seenInd.add(norm);
        indicatorLines.push(line);
      }
      const stdMatch = line.match(/([ก-ฮ]{1,3}\s*\d+\.\d+)/);
      if (stdMatch) {
        const stdCode = stdMatch[1];
        const stdKey = stdCode.replace(/\s+/g, '').toLowerCase();
        if (!seenStd.has(stdKey)) {
          seenStd.add(stdKey);
          const stdObj = findStandardByCode(stdCode, curriculum || undefined);
          if (stdObj) {
            const cClean = stdObj.code.replace(/^มาตรฐาน\s*/, '').trim();
            standardLines.push(`${cClean}: ${stdObj.title}`);
          }
        }
      }
    }
  }

  return {
    standards: standardLines.length > 0 ? standardLines.join('\n') : '-',
    indicators: indicatorLines.length > 0 ? indicatorLines.join('\n') : raw,
  };
}

/**
 * ดึงข้อมูลส่วนหัวรายวิชาและรายการตัวชี้วัดจากย่อหน้า/ตารางส่วนต้นของเอกสาร
 */
function extractHeaderMetadataFromDom(doc: Document): {
  subjectGroup: string;
  courseCode: string;
  courseName: string;
  grade: string;
  totalHours: string;
  semester: string;
  academicYear: string;
  teacherName: string;
  docIndicatorMap: Map<string, string>;
  docStandardsMap: Map<string, string>;
} {
  const fullText = (doc.body?.textContent || '').replace(/\u00A0/g, ' ');
  const lines = extractCellLines(doc.body);

  let subjectGroup = '';
  let courseCode = '';
  let courseName = '';
  let grade = '';
  let totalHours = '';
  let semester = '';
  let academicYear = '';
  let teacherName = '';

  const docIndicatorMap = new Map<string, string>();
  const docStandardsMap = new Map<string, string>();

  for (const line of lines) {
    // ตรวจจับตัวชี้วัดฉบับเต็มในส่วนที่ 1 เช่น "ว 4.2 ม.2/1 ออกแบบอัลกอริทึม..."
    const indFullMatch = line.match(/^([ก-ฮ]{1,3}\s*\d+\.\d+\s*(?:ม\.|ป\.|อ\.)\s*\d+(?:\s*-\s*\d+)?\/\d+)\s*[:：\-]?\s*(.+)$/);
    if (indFullMatch && indFullMatch[2].trim().length > 4) {
      const code = indFullMatch[1].replace(/\s+/g, ' ').trim();
      const desc = indFullMatch[2].trim();
      docIndicatorMap.set(code, `${code}: ${desc}`);
    }

    // ตรวจจับมาตรฐานฉบับเต็ม
    const stdFullMatch = line.match(/^(?:มาตรฐาน\s*)?([ก-ฮ]{1,3}\s*\d+\.\d+)\s*[:：\-]?\s*(เข้าใจ.+|ใช้.+|ตระหนัก.+|มี.+|ปฏิบัติ.+|รู้.+|เห็นคุณค่า.+)$/);
    if (stdFullMatch) {
      const code = stdFullMatch[1].replace(/\s+/g, ' ').trim();
      const key = code.replace(/\s+/g, '').toLowerCase();
      docStandardsMap.set(key, `${code}: ${stdFullMatch[2].trim()}`);
    }
  }

  // 1. กลุ่มสาระการเรียนรู้ และ รายวิชา
  const sgCourseMatch = fullText.match(/กลุ่มสาระการเรียนรู้\s*([^\s\n]+(?:\s*และ\s*[^\s\n]+)?)\s+รายวิชา\s*([^\n\r]+?)(?=\s+รหัสวิชา|\s+ชั้น|$)/);
  if (sgCourseMatch) {
    subjectGroup = sgCourseMatch[1].trim();
    courseName = sgCourseMatch[2].trim();
  } else {
    const sgMatch = fullText.match(/กลุ่มสาระการเรียนรู้\s*[:：]?\s*(ภาษาไทย|คณิตศาสตร์|วิทยาศาสตร์และเทคโนโลยี|วิทยาศาสตร์|สังคมศึกษา\s*ศาสนา\s*และวัฒนธรรม|สังคมศึกษาฯ?|สุขศึกษาและพลศึกษา|ศิลปะ|การงานอาชีพ|ภาษาต่างประเทศ(?:\s*\([^\)]+\))?|ปฐมวัย)/);
    if (sgMatch) subjectGroup = sgMatch[1].trim();

    const cnMatch = fullText.match(/รายวิชา\s*[:：]?\s*([^\n\r\t]+?)(?=\s+รหัสวิชา|\s+ชั้น|\s+กลุ่มสาระ|\s+จำนวน|$)/);
    if (cnMatch) courseName = cnMatch[1].trim();
  }

  // 2. รหัสวิชา
  const codeMatch = fullText.match(/รหัสวิชา\s*[:：]?\s*([ก-ฮA-Za-z]{1,4}\s*\d{4,6})/);
  if (codeMatch) {
    courseCode = codeMatch[1].replace(/\s+/g, '').trim();
  }

  // 3. ระดับชั้น
  const gradeMatch = fullText.match(/ชั้น\s*[:：]?\s*((?:มัธยมศึกษาปีที่|ประถมศึกษาปีที่|อนุบาลปีที่|อนุบาล|ม\.|ป\.|อ\.)\s*\d+(?:\/\d+)?)/);
  if (gradeMatch) {
    grade = gradeMatch[1].trim();
  }

  // 4. จำนวนชั่วโมงรวม
  const hoursMatch = fullText.match(/จำนวน\s*(\d+)\s*ชั่วโมง/);
  if (hoursMatch) {
    totalHours = hoursMatch[1].trim();
  }

  // 5. ภาคเรียน & ปีการศึกษา
  const semMatch = fullText.match(/ภาคเรียนที่\s*[:：]?\s*(\d+|ตลอดปีการศึกษา)/);
  if (semMatch) {
    semester = semMatch[1].trim();
  }
  const yearMatch = fullText.match(/ปีการศึกษา\s*[:：]?\s*(\d{4})/);
  if (yearMatch) {
    academicYear = yearMatch[1].trim();
  }

  // 6. ชื่อผู้สอน
  const teacherMatch = fullText.match(/(?:ผู้สอน|ครูผู้สอน)\s*[:：]?\s*([^\n\r\t]+?)(?=\s+จำนวน|\s+ตำแหน่ง|\s+กลุ่มสาระ|\s+ภาคเรียน|$)/);
  if (teacherMatch) {
    const candidate = teacherMatch[1].trim();
    if (candidate && !/^\.+$|^…+$/.test(candidate)) {
      teacherName = candidate;
    }
  }

  return {
    subjectGroup,
    courseCode,
    courseName,
    grade,
    totalHours,
    semester,
    academicYear,
    teacherName,
    docIndicatorMap,
    docStandardsMap,
  };
}

/**
 * ชั้นที่ 1: ตัวแกะฟอร์แมตมาตรฐานของเว็บ (Zero-Token DOM Parser)
 * ตรวจจับตารางแผนการจัดการเรียนรู้รายสัปดาห์ (8 คอลัมน์) และยุบรวมแผน (ต่อ)
 */
function tryParseStandardTemplateDom(
  html: string,
  fileName: string,
  curriculum: CurriculumData | null
): CourseStructureBatchJob | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const tables = Array.from(doc.querySelectorAll('table'));
  if (tables.length === 0) return null;

  // ค้นหาตาราง 8 คอลัมน์ของแผนรายสัปดาห์
  let targetTable: HTMLTableElement | null = null;
  for (const tbl of tables) {
    const firstRows = Array.from(tbl.querySelectorAll('tr')).slice(0, 3);
    for (const tr of firstRows) {
      const cells = Array.from(tr.querySelectorAll('th, td')).map(c => (c.textContent || '').replace(/\s+/g, ' ').trim());
      if (cells.length >= 7) {
        const joined = cells.join(' | ');
        const hasWeek = /สัปดาห์/.test(joined);
        const hasInd = /ตัวชี้วัด|มาตรฐาน/.test(joined);
        const hasUnit = /หน่วย|เรื่อง/.test(joined);
        const hasObj = /จุดประสงค์/.test(joined);
        const hasMethod = /วิธีจัดการเรียนรู้|กิจกรรมการเรียนรู้|วิธีสอน/.test(joined);
        if (hasWeek && hasInd && hasUnit && (hasObj || hasMethod)) {
          targetTable = tbl;
          break;
        }
      }
    }
    if (targetTable) break;
  }

  if (!targetTable) return null;

  const meta = extractHeaderMetadataFromDom(doc);
  const savedDefaults = getSavedHeaderDefaults();

  interface AccumulatorPlan {
    planNumber: number;
    weeks: number[];
    rawWeekLabels: string[];
    unit: string;
    topics: string[];
    hours: number;
    indicatorsRaw: string;
    k_objective: string;
    p_objective: string;
    a_objective: string;
    key_concepts: string;
    teaching_method: string;
    media_resources: string;
    evaluation_method: string;
  }

  const planMap = new Map<number, AccumulatorPlan>();
  const planOrder: number[] = [];

  let activePlanNumber: number | null = null;
  let activeBannerTitle = '';
  let lastKnownUnit = '';
  let autoPlanSeq = 0;

  const rows = Array.from(targetTable.querySelectorAll('tr'));
  for (const tr of rows) {
    const cells = Array.from(tr.querySelectorAll('th, td'));
    if (cells.length === 0) continue;

    const firstCellText = extractCellText(cells[0]);
    // ข้ามแถวหัวตาราง
    if (cells.length >= 7 && /^สัปดาห์ที่$/i.test(firstCellText.replace(/\s+/g, ''))) {
      continue;
    }

    // ตรวจจับแถวคั่นชื่อแผน (colspan เต็มแถว หรือมี 1 เซลล์ หรือขึ้นต้นด้วย "แผนการจัดการเรียนรู้ที่ X")
    const colspan = parseInt(cells[0].getAttribute('colspan') || '1', 10);
    const isBannerRow =
      cells.length === 1 ||
      colspan >= 6 ||
      (cells.length <= 2 && /แผน(?:การจัดการเรียนรู้)?ที่\s*\d+/i.test(firstCellText));

    if (isBannerRow) {
      const bannerText = cells.map(c => extractCellText(c)).join(' ').trim();
      const numMatch = bannerText.match(/แผน(?:การจัดการเรียนรู้)?ที่\s*(\d+)/i);
      if (numMatch) {
        activePlanNumber = parseInt(numMatch[1], 10);
      }
      activeBannerTitle = bannerText;
      continue;
    }

    if (cells.length < 6) continue;

    const weekCell = extractCellText(cells[0]).trim();
    const indCell = extractCellText(cells[1]).trim();
    const unitTopicCell = extractCellText(cells[2]).trim();
    const objCell = extractCellText(cells[3]).trim();
    const conceptCell = extractCellText(cells[4]).trim();
    const methodCell = extractCellText(cells[5]).trim();
    const mediaCell = cells[6] ? extractCellText(cells[6]).trim() : '';
    const evalCell = cells[7] ? extractCellText(cells[7]).trim() : '';

    // ข้ามแถวว่างเปล่า
    if (!weekCell && !unitTopicCell && !conceptCell) continue;

    // สกัดเลขสัปดาห์ (เช่น "2", "2-3", "สัปดาห์ที่ 4")
    const weekNums = (weekCell.match(/\d+/g) || []).map(n => parseInt(n, 10)).filter(n => !Number.isNaN(n));
    const weekCountInRow =
      weekNums.length >= 2 && weekNums[weekNums.length - 1] >= weekNums[0]
        ? weekNums[weekNums.length - 1] - weekNums[0] + 1
        : 1;

    const parsedUnitTopic = splitUnitAndTopic(unitTopicCell, activeBannerTitle, lastKnownUnit);
    if (parsedUnitTopic.unit) {
      lastKnownUnit = parsedUnitTopic.unit;
    }

    let resolvedPlanNum: number;
    if (parsedUnitTopic.explicitPlanNum !== null) {
      resolvedPlanNum = parsedUnitTopic.explicitPlanNum;
    } else if (activePlanNumber !== null) {
      resolvedPlanNum = activePlanNumber;
    } else if (parsedUnitTopic.isContinuation && planOrder.length > 0) {
      resolvedPlanNum = planOrder[planOrder.length - 1];
    } else {
      autoPlanSeq = Math.max(autoPlanSeq + 1, (planOrder[planOrder.length - 1] || 0) + 1);
      resolvedPlanNum = autoPlanSeq;
    }

    // หากชื่อเรื่องมีคำว่า (ต่อ) แต่เลขแผนดันรันใหม่ ให้ยุบรวมเข้ากับแผนก่อนหน้า
    if (parsedUnitTopic.isContinuation && !planMap.has(resolvedPlanNum) && planOrder.length > 0) {
      resolvedPlanNum = planOrder[planOrder.length - 1];
    }

    const kpa = splitKpaObjectives(objCell);

    const existing = planMap.get(resolvedPlanNum);
    if (existing) {
      // ยุบรวมเข้ากับแผนหมายเลขเดียวกัน
      existing.weeks.push(...weekNums);
      if (weekCell) existing.rawWeekLabels.push(weekCell);
      existing.hours += weekCountInRow;
      if (!existing.unit && parsedUnitTopic.unit) {
        existing.unit = parsedUnitTopic.unit;
      }
      if (parsedUnitTopic.topic && !existing.topics.includes(parsedUnitTopic.topic)) {
        existing.topics.push(parsedUnitTopic.topic);
      }
      existing.indicatorsRaw = mergeUniqueMultiline(existing.indicatorsRaw, indCell);
      existing.k_objective = mergeUniqueMultiline(existing.k_objective, kpa.k);
      existing.p_objective = mergeUniqueMultiline(existing.p_objective, kpa.p);
      existing.a_objective = mergeUniqueMultiline(existing.a_objective, kpa.a);
      existing.key_concepts = mergeUniqueMultiline(existing.key_concepts, conceptCell);
      existing.teaching_method = mergeUniqueMultiline(existing.teaching_method, methodCell);
      existing.media_resources = mergeUniqueMultiline(existing.media_resources, mediaCell);
      existing.evaluation_method = mergeUniqueMultiline(existing.evaluation_method, evalCell);
    } else {
      planOrder.push(resolvedPlanNum);
      planMap.set(resolvedPlanNum, {
        planNumber: resolvedPlanNum,
        weeks: [...weekNums],
        rawWeekLabels: weekCell ? [weekCell] : [],
        unit: parsedUnitTopic.unit,
        topics: parsedUnitTopic.topic ? [parsedUnitTopic.topic] : [],
        hours: weekCountInRow,
        indicatorsRaw: indCell,
        k_objective: kpa.k,
        p_objective: kpa.p,
        a_objective: kpa.a,
        key_concepts: conceptCell,
        teaching_method: methodCell,
        media_resources: mediaCell,
        evaluation_method: evalCell,
      });
    }

    // รีเซ็ต banner เฉพาะเมื่อแถวนี้ใช้ไปแล้ว (ถ้าแถวถัดไปไม่มี banner แต่เป็น (ต่อ) จะยังเกาะแผนล่าสุดได้)
    activePlanNumber = null;
    activeBannerTitle = '';
  }

  if (planOrder.length === 0) return null;

  // คำนวณตัวคูณชั่วโมงต่อสัปดาห์หากชั่วโมงรวมของรายวิชามากกว่าจำนวนสัปดาห์รวม (เช่น 40 ชม. / 20 สัปดาห์ = 2 ชม./สัปดาห์)
  const totalWeekUnits = Array.from(planMap.values()).reduce((sum, p) => sum + p.hours, 0);
  const parsedTotalCourseHours = parseInt(meta.totalHours, 10);
  const hoursMultiplier =
    !Number.isNaN(parsedTotalCourseHours) &&
    totalWeekUnits > 0 &&
    parsedTotalCourseHours > totalWeekUnits &&
    parsedTotalCourseHours % totalWeekUnits === 0
      ? parsedTotalCourseHours / totalWeekUnits
      : 1;

  const plans: ExtractedPlanItem[] = planOrder.map((num, idx) => {
    const acc = planMap.get(num)!;
    const { standards, indicators } = buildStandardsAndIndicators(
      acc.indicatorsRaw,
      meta.docIndicatorMap,
      meta.docStandardsMap,
      curriculum
    );

    const combinedTopic = acc.topics.join(' / ').trim() || `แผนการจัดการเรียนรู้ที่ ${idx + 1}`;

    return {
      id: makeId(`plan_${idx + 1}`),
      planNumber: idx + 1,
      weekLabel: formatWeekLabel(acc.weeks, acc.rawWeekLabels),
      unit: acc.unit || 'หน่วยการเรียนรู้',
      topic: combinedTopic,
      hours: Math.max(1, acc.hours * hoursMultiplier),
      standards,
      indicators,
      k_objective: acc.k_objective || '-',
      p_objective: acc.p_objective || '-',
      a_objective: acc.a_objective || '-',
      key_concepts: acc.key_concepts || '-',
      teaching_method: acc.teaching_method || 'Active Learning',
      media_resources: acc.media_resources || '-',
      evaluation_method: acc.evaluation_method || '-',
      selected: true,
      status: 'idle',
    };
  });

  return {
    jobId: makeId('batch_job'),
    fileName,
    subjectGroup: meta.subjectGroup || 'วิทยาศาสตร์และเทคโนโลยี',
    courseCode: meta.courseCode || '',
    courseName: meta.courseName || fileName.replace(/\.docx$/i, ''),
    grade: meta.grade || 'ม.2',
    totalHours: meta.totalHours || String(plans.reduce((s, p) => s + p.hours, 0)),
    semester: meta.semester || savedDefaults.semester,
    academicYear: meta.academicYear || savedDefaults.academicYear,
    teacherName: meta.teacherName || savedDefaults.teacherName,
    teacherPosition: savedDefaults.teacherPosition,
    schoolName: savedDefaults.schoolName,
    teachingDate: '………………………………',
    parseSource: 'template-match',
    plans,
  };
}

/**
 * แปลง HTML จาก Mammoth เป็นข้อความ/ตาราง Markdown ที่กระชับสูงสุดสำหรับ AI Fallback
 */
function compactHtmlToMarkdownForAi(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const chunks: string[] = [];

  const children = Array.from(doc.body.children);
  for (const el of children) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'table') {
      const rows = Array.from(el.querySelectorAll('tr'));
      for (const tr of rows) {
        const cells = Array.from(tr.querySelectorAll('th, td')).map(c =>
          extractCellLines(c).join(' ').replace(/\|/g, '/').trim()
        );
        if (cells.some(Boolean)) {
          chunks.push(`| ${cells.join(' | ')} |`);
        }
      }
      chunks.push('');
    } else {
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) chunks.push(text);
    }
  }

  return chunks.join('\n').slice(0, 45000);
}

/**
 * ชั้นที่ 2: ตัววิเคราะห์สำรองด้วย AI (AI Smart Extractor Fallback — Fast Mode Only)
 */
async function parseWithAiFallback(
  html: string,
  fileName: string,
  curriculum: CurriculumData | null,
  onStatus?: (msg: string) => void
): Promise<CourseStructureBatchJob> {
  onStatus?.('กำลังใช้ AI โหมดด่วนวิเคราะห์โครงสร้างรายวิชาจากไฟล์ของคุณ...');

  const compactText = compactHtmlToMarkdownForAi(html);
  const savedDefaults = getSavedHeaderDefaults();

  const systemInstruction = `คุณคือผู้เชี่ยวชาญวิเคราะห์โครงสร้างรายวิชาและกำหนดการสอนของครูไทย
หน้าที่ของคุณคือสกัดข้อมูลรายวิชาและแยกแยะรายการ "แผนการจัดการเรียนรู้" ทุกแผนออกจากเอกสารโครงสร้างรายวิชาที่ได้รับ
หากแผนใดต่อเนื่องหลายสัปดาห์หรือมีคำว่า "(ต่อ)" ให้ยุบรวมเป็นแผนเดียวกันและบวกจำนวนชั่วโมงเข้าด้วยกัน
ตอบกลับเป็น JSON Object เท่านั้น ห้ามมีข้อความอื่นนอก JSON`;

  const prompt = `วิเคราะห์โครงสร้างรายวิชาต่อไปนี้และสกัดข้อมูลออกมาเป็น JSON ตามโครงสร้างนี้:
{
  "subjectGroup": "กลุ่มสาระการเรียนรู้ (เช่น วิทยาศาสตร์และเทคโนโลยี)",
  "courseCode": "รหัสวิชา (เช่น ว22101)",
  "courseName": "ชื่อรายวิชา",
  "grade": "ระดับชั้น (เช่น ป.4 หรือ ม.2)",
  "totalHours": "จำนวนชั่วโมงรวม (ตัวเลข)",
  "semester": "ภาคเรียน (เช่น 1 หรือ 2)",
  "academicYear": "ปีการศึกษา พ.ศ. (เช่น 2569)",
  "teacherName": "ชื่อผู้สอน (ถ้ามีในไฟล์)",
  "plans": [
    {
      "planNumber": 1,
      "weekLabel": "สัปดาห์ที่ 1 หรือ สัปดาห์ที่ 2-3",
      "unit": "ชื่อหน่วยการเรียนรู้",
      "topic": "ชื่อแผน / เรื่อง",
      "hours": 1,
      "standards": "มาตรฐานการเรียนรู้ (เช่น ว 4.2)",
      "indicators": "ตัวชี้วัด (เช่น ว 4.2 ม.2/1)",
      "k_objective": "จุดประสงค์ด้านความรู้ (K)",
      "p_objective": "จุดประสงค์ด้านทักษะกระบวนการ (P)",
      "a_objective": "จุดประสงค์ด้านคุณลักษณะอันพึงประสงค์ (A)",
      "key_concepts": "หัวข้อ / สาระสำคัญ",
      "teaching_method": "วิธีจัดการเรียนรู้ (เช่น Active Learning, GPAS 5 Steps, 5E)",
      "media_resources": "สื่อ / แหล่งเรียนรู้",
      "evaluation_method": "วิธีการวัดและประเมินผล"
    }
  ]
}

ข้อมูลจากไฟล์เอกสาร (${fileName}):
${compactText}`;

  const result = await callGeminiByokFastOnly(prompt, systemInstruction, 8192, 'application/json');
  const cleanJson = sanitizeJsonString(result.text);
  const parsed = JSON.parse(cleanJson);

  const rawPlans: any[] = Array.isArray(parsed?.plans) ? parsed.plans : [];
  if (rawPlans.length === 0) {
    throw new Error('ไม่พบรายการแผนการจัดการเรียนรู้ในไฟล์ที่อัปโหลด กรุณาตรวจสอบไฟล์โครงสร้างรายวิชา');
  }

  const emptyMap = new Map<string, string>();
  const plans: ExtractedPlanItem[] = rawPlans.map((p, idx) => {
    const rawInd = String(p.indicators || '').trim();
    const rawStd = String(p.standards || '').trim();
    const enriched = buildStandardsAndIndicators(rawInd || rawStd, emptyMap, emptyMap, curriculum);
    const stdFinal =
      enriched.standards && enriched.standards !== '-'
        ? enriched.standards
        : rawStd
          ? enrichStandardsString(rawStd, curriculum || undefined)
          : '-';

    let kObj = String(p.k_objective || '').trim();
    let pObj = String(p.p_objective || '').trim();
    let aObj = String(p.a_objective || '').trim();
    if ((!pObj || pObj === '-') && (!aObj || aObj === '-') && kObj && kObj !== '-') {
      const split = splitKpaObjectives(kObj);
      if (split.p || split.a) {
        kObj = split.k;
        pObj = split.p;
        aObj = split.a;
      }
    }

    return {
      id: makeId(`ai_plan_${idx + 1}`),
      planNumber: Number(p.planNumber) || idx + 1,
      weekLabel: String(p.weekLabel || `สัปดาห์ที่ ${idx + 1}`).trim(),
      unit: String(p.unit || 'หน่วยการเรียนรู้').trim(),
      topic: String(p.topic || `แผนการจัดการเรียนรู้ที่ ${idx + 1}`).trim(),
      hours: Math.max(1, Number(p.hours) || 1),
      standards: stdFinal,
      indicators: enriched.indicators !== '-' ? enriched.indicators : rawInd || '-',
      k_objective: kObj || '-',
      p_objective: pObj || '-',
      a_objective: aObj || '-',
      key_concepts: String(p.key_concepts || '-').trim(),
      teaching_method: String(p.teaching_method || 'Active Learning').trim(),
      media_resources: String(p.media_resources || '-').trim(),
      evaluation_method: String(p.evaluation_method || '-').trim(),
      selected: true,
      status: 'idle',
    };
  });

  return {
    jobId: makeId('batch_job'),
    fileName,
    subjectGroup: String(parsed.subjectGroup || 'วิทยาศาสตร์และเทคโนโลยี').trim(),
    courseCode: String(parsed.courseCode || '').trim(),
    courseName: String(parsed.courseName || fileName.replace(/\.docx$/i, '')).trim(),
    grade: String(parsed.grade || 'ม.2').trim(),
    totalHours: String(parsed.totalHours || plans.reduce((s, p) => s + p.hours, 0)).trim(),
    semester: String(parsed.semester || savedDefaults.semester).trim(),
    academicYear: String(parsed.academicYear || savedDefaults.academicYear).trim(),
    teacherName: String(parsed.teacherName || savedDefaults.teacherName).trim(),
    teacherPosition: savedDefaults.teacherPosition,
    schoolName: savedDefaults.schoolName,
    teachingDate: '………………………………',
    parseSource: 'ai-fallback',
    plans,
  };
}

/**
 * ฟังก์ชันหลักสำหรับวิเคราะห์ไฟล์โครงสร้างรายวิชา (.docx) แบบ 2 ชั้น
 */
export async function parseCourseStructureDocx(
  file: File,
  onStatus?: (msg: string) => void
): Promise<CourseStructureBatchJob> {
  const MAX_DOCX_BYTES = 15 * 1024 * 1024;
  if (file.size > MAX_DOCX_BYTES) {
    throw new Error('ไฟล์มีขนาดใหญ่เกินไป (รองรับไฟล์ .docx ขนาดไม่เกิน 15 MB)');
  }
  onStatus?.('กำลังอ่านโครงสร้างตารางจากไฟล์ Word (.docx)...');
  const arrayBuffer = await file.arrayBuffer();

  // แปลง .docx เป็น HTML ด้วย mammoth โดยตัดรูปภาพออกทั้งหมดเพื่อความเร็วและประหยัดหน่วยความจำ/Token
  const mammothRes = await mammoth.convertToHtml(
    { arrayBuffer },
    {
      convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: '' })),
    }
  );

  let curriculum: CurriculumData | null = null;
  try {
    curriculum = await loadCurriculum();
  } catch {
    // ignore if curriculum fails to load
  }

  // ชั้นที่ 1: Zero-Token DOM Parser
  const domParsed = tryParseStandardTemplateDom(mammothRes.value, file.name, curriculum);
  if (domParsed && domParsed.plans.length > 0) {
    return domParsed;
  }

  // ชั้นที่ 2: AI Smart Extractor Fallback (BYOK Fast Mode Only)
  return await parseWithAiFallback(mammothRes.value, file.name, curriculum, onStatus);
}
