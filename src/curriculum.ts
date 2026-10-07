/**
 * EduPlan AI — Curriculum Module
 * ============================================================
 * โหลดและกรองข้อมูลหลักสูตร มาตรฐาน และตัวชี้วัด (Cascading Logic)
 * สอดคล้องกับ Data Schema ของ public/data/curriculum.json v2.1.0
 * ============================================================
 */

import type {
  CurriculumData,
  GradeLevel,
  Subject,
  Standard,
  Indicator,
  EarlyChildhoodData,
  EarlyChildhoodDomainUI,
  EarlyChildhoodDomainRaw,
  EarlyChildhoodExperience,
} from './types';

export * from './types';

let curriculumCache: CurriculumData | null = null;

/**
 * โหลดข้อมูลหลักสูตรจาก curriculum.json และแคชไว้ในหน่วยความจำ
 */
export async function loadCurriculumData(): Promise<CurriculumData> {
  if (curriculumCache) return curriculumCache;

  const response = await fetch('./data/curriculum.json');
  if (!response.ok) {
    throw new Error(`Failed to load curriculum data: ${response.status}`);
  }

  const rawData: CurriculumData = await response.json();

  // Polyfill label aliases for graceful backward compatibility
  if (Array.isArray(rawData.gradeLevels)) {
    rawData.gradeLevels.forEach(g => {
      if (!g.label) g.label = g.code;
    });
  }

  if (Array.isArray(rawData.subjects)) {
    rawData.subjects.forEach(s => {
      if (!s.label) s.label = s.name;
    });
  }

  if (Array.isArray(rawData.standards)) {
    rawData.standards.forEach(std => {
      if (!std.label) std.label = std.title;
    });
  }

  curriculumCache = rawData;
  return curriculumCache;
}

// Alias loadCurriculum for existing calls
export const loadCurriculum = loadCurriculumData;

/**
 * ดึงรายการระดับชั้นทั้งหมด
 */
export function getGradeLevels(data?: CurriculumData): GradeLevel[] {
  const source = data || curriculumCache;
  return source?.gradeLevels || [];
}

/**
 * ตรวจสอบว่าเป็นระดับปฐมวัย (อ.1 - อ.3) หรือไม่
 */
export function isEarlyChildhood(gradeId: string): boolean {
  return ['k1', 'k2', 'k3'].includes(gradeId);
}

/**
 * ดึงรายวิชาที่ใช้ได้กับระดับชั้นที่เลือก
 * - คืนค่ารายการวิชาพื้นฐาน (type === 'core') ทุกวิชา
 * - หากวิชามี targetGrades ให้ตรวจสอบว่าตรงกับ gradeId ที่เลือกหรือไม่
 *   (เช่น ฟิสิกส์ เคมี ชีวะ โลกดาราศาสตร์ จะแสดงเฉพาะ ม.4 - ม.6)
 */
export function getSubjects(
  dataOrGrade?: CurriculumData | string,
  gradeIdParam?: string
): Subject[] {
  let data: CurriculumData | null;
  let targetGrade: string | undefined;

  if (typeof dataOrGrade === 'object' && dataOrGrade !== null && 'subjects' in dataOrGrade) {
    data = dataOrGrade;
    targetGrade = gradeIdParam;
  } else {
    data = curriculumCache;
    targetGrade = typeof dataOrGrade === 'string' ? dataOrGrade : gradeIdParam;
  }

  if (!data?.subjects) return [];

  // กรองวิชาตามเงื่อนไขของหลักสูตร
  const filtered = data.subjects.filter(sub => {
    // 1. วิชาพื้นฐาน (core) แสดงทุกระดับชั้น
    if (sub.type === 'core') return true;

    // 2. วิชากลุ่มเพิ่มเติมที่มีกำหนด targetGrades (เช่น physics, chemistry, biology, earth_astronomy สำหรับ ม.4-ม.6)
    if (sub.targetGrades && sub.targetGrades.length > 0) {
      return targetGrade ? sub.targetGrades.includes(targetGrade) : false;
    }

    // 3. วิชาเพิ่มเติมทั่วไป
    return true;
  });

  return filtered;
}

/**
 * ดึงตัวชี้วัดจากมาตรฐานตามระดับชั้น
 */
export function getIndicatorsByGrade(
  standard: Standard | null | undefined,
  gradeId: string
): Indicator[] {
  if (!standard || !standard.gradeLevels) return [];
  return standard.gradeLevels[gradeId] || [];
}

/**
 * ดึงตัวชี้วัดโดยระบุ standardId และ gradeId
 */
export function getIndicators(
  standardIdOrStandard: string | Standard,
  gradeId: string,
  data?: CurriculumData
): Indicator[] {
  if (typeof standardIdOrStandard === 'object' && standardIdOrStandard !== null) {
    return getIndicatorsByGrade(standardIdOrStandard, gradeId);
  }

  const source = data || curriculumCache;
  if (!source?.standards) return [];

  const standard = source.standards.find(s => s.id === standardIdOrStandard);
  return standard?.gradeLevels?.[gradeId] || [];
}

/**
 * ดึงมาตรฐานการเรียนรู้ตามวิชาและระดับชั้น
 * - ฟิลเตอร์ตาม subjectId
 * - คัดเลือกเฉพาะมาตรฐานที่มีตัวชี้วัดในระดับชั้นนั้น (ไม่แสดงมาตรฐานว่างเปล่า)
 */
export function getStandards(
  dataOrSubject: CurriculumData | string,
  subjectOrGrade?: string,
  maybeGrade?: string
): Standard[] {
  let data: CurriculumData | null;
  let subjectId: string;
  let gradeId: string;

  if (typeof dataOrSubject === 'object' && dataOrSubject !== null && 'standards' in dataOrSubject) {
    data = dataOrSubject;
    subjectId = subjectOrGrade || '';
    gradeId = maybeGrade || '';
  } else {
    data = curriculumCache;
    subjectId = typeof dataOrSubject === 'string' ? dataOrSubject : '';
    gradeId = subjectOrGrade || '';
  }

  if (!data) return [];

  // หากเป็นปฐมวัย และเลือกวิชาปฐมวัย หรือยังไม่ได้ระบุวิชา ให้ดึงมาตรฐานปฐมวัย
  if (isEarlyChildhood(gradeId) && (subjectId === 'earlyChildhood' || subjectId === '' || subjectId === 'custom')) {
    return getEarlyChildhoodStandards(gradeId, data);
  }

  if (!data.standards || !Array.isArray(data.standards)) return [];

  // กรองมาตรฐานตามวิชา
  const subjectStandards = data.standards.filter(s => s.subjectId === subjectId);

  // หากระบุระดับชั้น ให้คัดเลือกเฉพาะมาตรฐานที่มีตัวชี้วัดในชั้นนั้น
  if (gradeId) {
    return subjectStandards.filter(s => {
      const indicators = s.gradeLevels?.[gradeId];
      return Array.isArray(indicators) && indicators.length > 0;
    });
  }

  return subjectStandards;
}

// Alias for backwards compatibility
export const getAvailableStandards = getStandards;
export function getStandardsBySubject(data: CurriculumData, subjectId: string): Standard[] {
  return (data.standards || []).filter(s => s.subjectId === subjectId);
}

/**
 * ดึงข้อมูลชุดพัฒนาการปฐมวัย (อ.1 - อ.3) โดยแปลงโครงสร้างให้เข้ากับ Checkbox Selector ของ UI
 */
export function getEarlyChildhoodDomains(data?: CurriculumData): EarlyChildhoodDomainUI[] {
  const source = data || curriculumCache;
  if (!source?.earlyChildhood?.domains) return [];

  const rawDomains: EarlyChildhoodDomainRaw[] = source.earlyChildhood.domains;
  const rawExperiences: EarlyChildhoodExperience[] = source.earlyChildhood.experiences || [];

  return rawDomains.map(d => {
    // รวบรวมประสบการณ์สำคัญที่ตรงกับ domain นี้
    const matchedExps = rawExperiences
      .filter(e => e.domain === d.id)
      .map(e => e.title);

    return {
      id: d.id,
      name: d.name,
      label: d.name, // backward compatibility
      description: d.description,
      standards: d.standards || [],
      experiences: matchedExps.length > 0 ? matchedExps : [d.description],
    };
  });
}

/**
 * สกัดมาตรฐานปฐมวัย 12 มาตรฐาน (มฐ.1 - มฐ.12) ให้เป็น Standard[] สำหรับระดับชั้น k1, k2 หรือ k3
 */
export function getEarlyChildhoodStandards(gradeId: string, data?: CurriculumData): Standard[] {
  const source = data || curriculumCache;
  if (!source?.earlyChildhood?.domains) return [];

  // แมป gradeId กับคีย์อายุใน indicators
  // k1 = อ.1 (3-4 ปี), k2 = อ.2 (4-5 ปี), k3 = อ.3 (5-6 ปี)
  const ageMatch = gradeId === 'k1' ? 'อ.1' : gradeId === 'k2' ? 'อ.2' : 'อ.3';
  const standardsList: Standard[] = [];

  source.earlyChildhood.domains.forEach(domain => {
    (domain.standards || []).forEach(std => {
      const matchedInd = (std.indicators || []).find(ind => ind.age && ind.age.includes(ageMatch));
      if (matchedInd) {
        const indicatorObj: Indicator = {
          id: `EC-${std.code}-${gradeId}`,
          code: `${std.code} (${ageMatch})`,
          text: matchedInd.text,
        };

        standardsList.push({
          id: `std_ec_${std.code}`,
          subjectId: 'earlyChildhood',
          strand: domain.name,
          code: std.code,
          title: std.title,
          label: std.title,
          gradeLevels: {
            [gradeId]: [indicatorObj],
          },
        });
      }
    });
  });

  return standardsList;
}

/**
 * ค้นหามาตรฐานการเรียนรู้ตามรหัสมาตรฐาน เช่น 'ว 4.2', 'ว 4.2 ม.2', 'ท 1.1'
 */
export function findStandardByCode(code: string, data?: CurriculumData): Standard | undefined {
  if (!code) return undefined;
  const source = data || curriculumCache;
  if (!source?.standards) return undefined;

  const clean = code.trim().replace(/^มาตรฐาน\s*/, '');
  const m = clean.match(/([ก-๙]\s*[\d\.]+)/);
  if (!m) return undefined;

  const targetCode = m[1].replace(/\s+/g, '');
  return source.standards.find(s => s.code.replace(/\s+/g, '') === targetCode);
}

export function enrichStandardsString(text: string, data?: CurriculumData): string {
  if (!text) return text;
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const enrichedLines: string[] = [];

  for (const line of lines) {
    // ข้ามบรรทัดที่เป็นเพียงหัวข้อ "1. มาตรฐานการเรียนรู้"
    if (/^\d+\.\s*มาตรฐานการเรียนรู้$/.test(line)) continue;

    const std = findStandardByCode(line, data);
    if (std) {
      const codeClean = std.code.replace(/^มาตรฐาน\s*/, '').trim();
      const fullText = `${codeClean}: ${std.title}`;
      if (line.includes(std.title.slice(0, 25))) {
        if (!line.includes(':')) {
          enrichedLines.push(`${codeClean}: ${line.replace(/^(?:มาตรฐาน\s*)?[ก-๙]\s*[\d\.]+\s*(?::\s*)?/, '').trim()}`);
        } else {
          enrichedLines.push(line);
        }
      } else {
        enrichedLines.push(fullText);
      }
    } else {
      enrichedLines.push(line);
    }
  }

  return enrichedLines.length > 0 ? enrichedLines.join('\n') : text;
}

/**
 * แปลงรหัสระดับชั้นเป็นชื่อเต็ม เช่น 'm2' -> 'ชั้นมัธยมศึกษาปีที่ 2', 'p1' -> 'ชั้นประถมศึกษาปีที่ 1'
 */
export function formatFullGradeName(gradeId: string, data?: CurriculumData): string {
  if (!gradeId) return 'ชั้นมัธยมศึกษาปีที่ 2';
  const list = getGradeLevels(data);
  const found = list.find(g => g.id === gradeId || g.code === gradeId);
  if (found) {
    const raw = found.name || found.code;
    return raw.startsWith('ชั้น') ? raw : `ชั้น${raw}`;
  }
  return gradeId.startsWith('ชั้น') ? gradeId : `ชั้น${gradeId}`;
}

