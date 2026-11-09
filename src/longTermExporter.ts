/**
 * EduPlan AI — Long-Term Plan Exporter & Clipboard Module
 * ============================================================
 * จัดการสร้างเอกสาร Word (.docx) มาตรฐานราชการ 5 ส่วน
 * และ Rich-Text HTML Clipboard สำหรับโครงการจัดการเรียนรู้ระยะยาว
 * ============================================================
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
  TableLayoutType,
  convertInchesToTwip,
  ShadingType,
} from 'docx';
import { saveAs } from 'file-saver';
import type { LongTermPlanData } from './types';

// Typography & Dimensions
type AlignmentValue = (typeof AlignmentType)[keyof typeof AlignmentType];

export const THAI_FONT = {
  name: 'TH SarabunPSK',
  cs: 'TH SarabunPSK',
  ascii: 'TH SarabunPSK',
  hAnsi: 'TH SarabunPSK',
  eastAsia: 'TH SarabunPSK',
};

export const THAI_LANG = {
  value: 'th-TH',
  bidi: 'th-TH',
  eastAsia: 'th-TH',
};

const A4_WIDTH_DXA = 11906;
const A4_HEIGHT_DXA = 16838;
const MARGIN_1_INCH_DXA = 1440; // 1 นิ้ว = 1440 DXA
const CONTENT_WIDTH_DXA = 9000; // ความกว้างพิมพ์มาตรฐาน

const borderNone = {
  style: BorderStyle.NONE,
  size: 0,
  color: 'FFFFFF',
};

const tableNoBorders = {
  top: borderNone,
  bottom: borderNone,
  left: borderNone,
  right: borderNone,
  insideHorizontal: borderNone,
  insideVertical: borderNone,
};

const borderSingle = {
  style: BorderStyle.SINGLE,
  size: 1, // 0.5pt
  color: '000000',
};

const tableBordersAll = {
  top: borderSingle,
  bottom: borderSingle,
  left: borderSingle,
  right: borderSingle,
  insideHorizontal: borderSingle,
  insideVertical: borderSingle,
};

/**
 * ทำความสะอาดข้อความภาษาไทย ป้องกันปัญหาวรรณยุกต์ลอยและคำฉีกขาด
 */
export function cleanThaiText(text: string): string {
  if (!text) return '';
  return String(text)
    .normalize('NFC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // ลบ Zero-Width Spaces
    .trim();
}

/**
 * สร้าง TextRun มาตรฐานภาษาไทย
 */
export function createThaiTextRun(
  text: string,
  options: { bold?: boolean; size?: number; italics?: boolean; color?: string } = {}
): TextRun {
  return new TextRun({
    text: cleanThaiText(text),
    font: THAI_FONT,
    language: THAI_LANG,
    size: options.size ?? 32, // 16pt (half-points: 16 * 2 = 32)
    bold: options.bold ?? false,
    italics: options.italics ?? false,
    color: options.color,
  });
}

function createParagraph(
  text: string,
  options: {
    bold?: boolean;
    size?: number;
    alignment?: AlignmentValue;
    spacingBefore?: number;
    spacingAfter?: number;
    line?: number;
    indentLeftInches?: number;
  } = {}
): Paragraph {
  return new Paragraph({
    alignment: options.alignment ?? AlignmentType.LEFT,
    spacing: {
      before: options.spacingBefore ?? 60,
      after: options.spacingAfter ?? 60,
      line: options.line ?? 280,
    },
    indent: options.indentLeftInches ? { left: convertInchesToTwip(options.indentLeftInches) } : undefined,
    children: [
      createThaiTextRun(text, {
        bold: options.bold ?? false,
        size: options.size ?? 32,
      }),
    ],
  });
}

/**
 * สร้างตาราง Header ไร้เส้นขอบ 3 แถว 2 คอลัมน์ (ซ้ายชิดซ้าย ขวาชิดขวา)
 */
function createHeaderTable(
  left1: string, right1: string,
  left2: string, right2: string,
  left3: string, right3: string
): Table {
  const rowData = [
    [left1, right1],
    [left2, right2],
    [left3, right3],
  ];

  const tableRows = rowData.map(([left, right]) => {
    return new TableRow({
      children: [
        new TableCell({
          width: { size: 5400, type: WidthType.DXA },
          borders: tableNoBorders,
          children: [
            createParagraph(left, { bold: false, size: 32, spacingBefore: 20, spacingAfter: 20 }),
          ],
        }),
        new TableCell({
          width: { size: 3600, type: WidthType.DXA },
          borders: tableNoBorders,
          children: [
            createParagraph(right, { bold: false, size: 32, alignment: AlignmentType.RIGHT, spacingBefore: 20, spacingAfter: 20 }),
          ],
        }),
      ],
    });
  });

  return new Table({
    width: { size: CONTENT_WIDTH_DXA, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    borders: tableNoBorders,
    rows: tableRows,
  });
}

/**
 * ============================================================
 * ส่งออกเอกสารโครงการจัดการเรียนรู้ระยะยาวเป็นไฟล์ Word (.docx)
 * ============================================================
 */
export async function exportLongTermToDocx(data: LongTermPlanData): Promise<void> {
  const docElements: (Paragraph | Table)[] = [];

  // ==========================================
  // ส่วนที่ 1: คำอธิบายรายวิชา
  // ==========================================
  docElements.push(
    createParagraph('คำอธิบายรายวิชา', {
      bold: true,
      size: 36, // 18pt
      alignment: AlignmentType.CENTER,
      spacingBefore: 120,
      spacingAfter: 120,
    })
  );

  docElements.push(
    createHeaderTable(
      `กลุ่มสาระการเรียนรู้${data.subjectGroupName} รายวิชา${data.courseName}`,
      `รหัสวิชา ${data.courseCode}`,
      `ชั้น${data.gradeName}`,
      `จำนวน ${data.totalHours} ชั่วโมง`,
      `ภาคเรียนที่ ${data.semester} ปีการศึกษา ${data.academicYear}`,
      `จำนวน ${data.totalCredits} หน่วยกิต`
    )
  );

  docElements.push(new Paragraph({ spacing: { before: 80, after: 40 } }));

  // ย่อหน้า 1 และ 2
  docElements.push(
    createParagraph(data.courseDescriptionPara1, {
      size: 32,
      indentLeftInches: 0.5,
      spacingBefore: 60,
      spacingAfter: 60,
    })
  );

  docElements.push(
    createParagraph(data.courseDescriptionPara2, {
      size: 32,
      indentLeftInches: 0.5,
      spacingBefore: 60,
      spacingAfter: 100,
    })
  );

  // ตัวชี้วัด
  docElements.push(createParagraph('ตัวชี้วัด', { bold: true, size: 32, spacingBefore: 100, spacingAfter: 40 }));
  if (data.indicatorsList && data.indicatorsList.length > 0) {
    data.indicatorsList.forEach(ind => {
      docElements.push(
        createParagraph(ind, {
          size: 32,
          indentLeftInches: 0.5,
          spacingBefore: 30,
          spacingAfter: 30,
        })
      );
    });
  }
  docElements.push(
    createParagraph(`รวม ${data.totalIndicatorsCount || data.indicatorsList?.length || 0} ตัวชี้วัด`, {
      bold: true,
      size: 32,
      spacingBefore: 60,
      spacingAfter: 100,
    })
  );

  // จุดประสงค์ด้านการเรียนรู้
  docElements.push(createParagraph('จุดประสงค์ด้านการเรียนรู้', { bold: true, size: 32, spacingBefore: 80, spacingAfter: 40 }));

  docElements.push(createParagraph('ด้านความรู้ (K)', { bold: true, size: 32, spacingBefore: 40, spacingAfter: 20 }));
  (data.kObjective || '').split('\n').filter(Boolean).forEach(line => {
    docElements.push(createParagraph(line, { size: 32, indentLeftInches: 0.3, spacingBefore: 20, spacingAfter: 20 }));
  });

  docElements.push(createParagraph('ทักษะกระบวนการ (P)', { bold: true, size: 32, spacingBefore: 40, spacingAfter: 20 }));
  (data.pObjective || '').split('\n').filter(Boolean).forEach(line => {
    docElements.push(createParagraph(line, { size: 32, indentLeftInches: 0.3, spacingBefore: 20, spacingAfter: 20 }));
  });

  docElements.push(createParagraph('ด้านคุณลักษณะ (A)', { bold: true, size: 32, spacingBefore: 40, spacingAfter: 20 }));
  (data.aObjective || '').split('\n').filter(Boolean).forEach(line => {
    docElements.push(createParagraph(line, { size: 32, indentLeftInches: 0.3, spacingBefore: 20, spacingAfter: 20 }));
  });

  // Page Break ระหว่างส่วนที่ 1 และส่วนที่ 2
  docElements.push(new Paragraph({ pageBreakBefore: true }));

  // ==========================================
  // ส่วนที่ 2: โครงการจัดการเรียนรู้ระยะยาว (ตารางโครงสร้างหน่วย)
  // ==========================================
  docElements.push(
    createParagraph('โครงการจัดการเรียนรู้ระยะยาว', {
      bold: true,
      size: 36, // 18pt
      alignment: AlignmentType.CENTER,
      spacingBefore: 120,
      spacingAfter: 120,
    })
  );

  docElements.push(
    createHeaderTable(
      `กลุ่มสาระการเรียนรู้${data.subjectGroupName} รายวิชา${data.courseName}`,
      `รหัสวิชา ${data.courseCode}`,
      `ชั้น${data.gradeName} ภาคเรียนที่ ${data.semester} ปีการศึกษา ${data.academicYear}`,
      `จำนวน ${data.totalHours} ชั่วโมง`,
      `ผู้สอน ${data.teacherName}`,
      `จำนวน ${data.totalCredits} หน่วยกิต`
    )
  );

  docElements.push(new Paragraph({ spacing: { before: 80, after: 60 } }));

  // ตาราง 6 คอลัมน์ (9,000 DXA)
  // หน่วยที่ (800) | ชื่อหน่วย (2200) | สาระสำคัญ (2800) | มาตรฐาน/ตัวชี้วัด (1800) | เวลา (700) | คะแนน (700)
  const unitColWidths = [800, 2200, 2800, 1800, 700, 700];

  const unitTableRows: TableRow[] = [];

  // Header Row
  unitTableRows.push(
    new TableRow({
      tableHeader: true,
      children: [
        makeCell('หน่วยที่', 800, { bold: true, align: AlignmentType.CENTER, shading: 'F8FAFC' }),
        makeCell('ชื่อหน่วยการเรียนรู้', 2200, { bold: true, align: AlignmentType.CENTER, shading: 'F8FAFC' }),
        makeCell('สาระสำคัญ / สาระการเรียนรู้', 2800, { bold: true, align: AlignmentType.CENTER, shading: 'F8FAFC' }),
        makeCell('มาตรฐาน / ตัวชี้วัด', 1800, { bold: true, align: AlignmentType.CENTER, shading: 'F8FAFC' }),
        makeCell('เวลา (ชม.)', 700, { bold: true, align: AlignmentType.CENTER, shading: 'F8FAFC' }),
        makeCell('คะแนน', 700, { bold: true, align: AlignmentType.CENTER, shading: 'F8FAFC' }),
      ],
    })
  );

  // แถวที่ 1: ปฐมนิเทศ (columnSpan 6)
  unitTableRows.push(
    new TableRow({
      children: [
        new TableCell({
          width: { size: CONTENT_WIDTH_DXA, type: WidthType.DXA },
          columnSpan: 6,
          borders: tableBordersAll,
          children: [
            createParagraph('ปฐมนิเทศ', {
              bold: true,
              size: 32,
              alignment: AlignmentType.CENTER,
              spacingBefore: 60,
              spacingAfter: 60,
            }),
          ],
        }),
      ],
    })
  );

  // แถวหน่วยที่ 1 ถึง n
  let sumUnitHours = 0;
  let sumUnitScore = 0;
  (data.unitRows || []).forEach(u => {
    sumUnitHours += Number(u.hours) || 0;
    sumUnitScore += Number(u.score) || 0;

    unitTableRows.push(
      new TableRow({
        children: [
          makeCell(String(u.unitNumber), 800, { align: AlignmentType.CENTER }),
          makeCell(u.unitTitle, 2200),
          makeCell(u.coreConcept, 2800),
          makeCell(u.indicators, 1800),
          makeCell(String(u.hours), 700, { align: AlignmentType.CENTER }),
          makeCell(String(u.score), 700, { align: AlignmentType.CENTER }),
        ],
      })
    );
  });

  // แถวท้ายตาราง 1: การเข้าชั้นเรียน การแต่งกาย จิตพิสัย (columnSpan: 5) | affectiveScore
  unitTableRows.push(
    new TableRow({
      children: [
        new TableCell({
          width: { size: 8300, type: WidthType.DXA },
          columnSpan: 5,
          borders: tableBordersAll,
          children: [
            createParagraph('การเข้าชั้นเรียน การแต่งกาย จิตพิสัย และความร่วมมือ', {
              bold: false,
              size: 32,
              spacingBefore: 60,
              spacingAfter: 60,
            }),
          ],
        }),
        makeCell(String(data.affectiveScore ?? 10), 700, { align: AlignmentType.CENTER }),
      ],
    })
  );

  // แถวท้ายตาราง 2: สอบปลายภาค (columnSpan: 4) | finalExamHours | finalExamScore
  unitTableRows.push(
    new TableRow({
      children: [
        new TableCell({
          width: { size: 7600, type: WidthType.DXA },
          columnSpan: 4,
          borders: tableBordersAll,
          children: [
            createParagraph('สอบปลายภาค', {
              bold: false,
              size: 32,
              spacingBefore: 60,
              spacingAfter: 60,
            }),
          ],
        }),
        makeCell(String(data.finalExamHours ?? 2), 700, { align: AlignmentType.CENTER }),
        makeCell(String(data.finalExamScore ?? 20), 700, { align: AlignmentType.CENTER }),
      ],
    })
  );

  // แถวรวมสุทธิ (columnSpan: 4) | totalHours | 100
  unitTableRows.push(
    new TableRow({
      children: [
        new TableCell({
          width: { size: 7600, type: WidthType.DXA },
          columnSpan: 4,
          borders: tableBordersAll,
          children: [
            createParagraph('รวม', {
              bold: true,
              size: 32,
              alignment: AlignmentType.CENTER,
              spacingBefore: 60,
              spacingAfter: 60,
            }),
          ],
        }),
        makeCell(String(data.totalHours), 700, { bold: true, align: AlignmentType.CENTER }),
        makeCell('100', 700, { bold: true, align: AlignmentType.CENTER }),
      ],
    })
  );

  docElements.push(
    new Table({
      width: { size: CONTENT_WIDTH_DXA, type: WidthType.DXA },
      layout: TableLayoutType.FIXED,
      borders: tableBordersAll,
      rows: unitTableRows,
    })
  );

  // Page Break ระหว่างส่วนที่ 2 และส่วนที่ 3
  docElements.push(new Paragraph({ pageBreakBefore: true }));

  // ==========================================
  // ส่วนที่ 3: ตารางแผนการจัดการเรียนรู้รายสัปดาห์ (8 คอลัมน์)
  // ==========================================
  docElements.push(
    createParagraph('ตารางแผนการจัดการเรียนรู้รายสัปดาห์', {
      bold: true,
      size: 36, // 18pt
      alignment: AlignmentType.CENTER,
      spacingBefore: 120,
      spacingAfter: 120,
    })
  );

  // 8 คอลัมน์: สัปดาห์ที่ (700) | ตัวชี้วัด (1100) | หน่วย/เรื่อง (1300) | จุดประสงค์ (1200) | หัวข้อ/สาระ (1400) | วิธีสอน (1200) | สื่อ (1000) | การวัดผล (1100)
  const weeklyColWidths = [700, 1100, 1300, 1200, 1400, 1200, 1000, 1100];
  const weeklyTableRows: TableRow[] = [];

  // Header Row
  weeklyTableRows.push(
    new TableRow({
      tableHeader: true,
      children: [
        makeCell('สัปดาห์ที่', 700, { bold: true, align: AlignmentType.CENTER, shading: 'F8FAFC' }),
        makeCell('ตัวชี้วัด', 1100, { bold: true, align: AlignmentType.CENTER, shading: 'F8FAFC' }),
        makeCell('หน่วยการเรียนรู้/เรื่อง', 1300, { bold: true, align: AlignmentType.CENTER, shading: 'F8FAFC' }),
        makeCell('จุดประสงค์การเรียนรู้', 1200, { bold: true, align: AlignmentType.CENTER, shading: 'F8FAFC' }),
        makeCell('หัวข้อ/สาระสำคัญ', 1400, { bold: true, align: AlignmentType.CENTER, shading: 'F8FAFC' }),
        makeCell('วิธีจัดการเรียนรู้', 1200, { bold: true, align: AlignmentType.CENTER, shading: 'F8FAFC' }),
        makeCell('สื่อ/แหล่งเรียนรู้', 1000, { bold: true, align: AlignmentType.CENTER, shading: 'F8FAFC' }),
        makeCell('การวัดและการประเมินผล', 1100, { bold: true, align: AlignmentType.CENTER, shading: 'F8FAFC' }),
      ],
    })
  );

  (data.weeklyRows || []).forEach(w => {
    // แถวคั่นกลุ่มแผน (ถ้ามี)
    if (w.planGroupTitle && w.planGroupTitle.trim()) {
      weeklyTableRows.push(
        new TableRow({
          children: [
            new TableCell({
              width: { size: CONTENT_WIDTH_DXA, type: WidthType.DXA },
              columnSpan: 8,
              borders: tableBordersAll,
              shading: { fill: 'F1F5F9', type: ShadingType.CLEAR },
              children: [
                createParagraph(w.planGroupTitle, {
                  bold: true,
                  size: 32,
                  spacingBefore: 50,
                  spacingAfter: 50,
                }),
              ],
            }),
          ],
        })
      );
    }

    weeklyTableRows.push(
      new TableRow({
        children: [
          makeCell(String(w.weekNumber), 700, { align: AlignmentType.CENTER }),
          makeCell(w.indicators || '-', 1100),
          makeCell(w.unitAndTopic, 1300),
          makeCell(w.objectives, 1200),
          makeCell(w.coreContent, 1400),
          makeCell(w.teachingMethod, 1200),
          makeCell(w.mediaResources, 1000),
          makeCell(w.assessment, 1100),
        ],
      })
    );
  });

  docElements.push(
    new Table({
      width: { size: CONTENT_WIDTH_DXA, type: WidthType.DXA },
      layout: TableLayoutType.FIXED,
      borders: tableBordersAll,
      rows: weeklyTableRows,
    })
  );

  // Page Break ระหว่างส่วนที่ 3 และส่วนที่ 4
  docElements.push(new Paragraph({ pageBreakBefore: true }));

  // ==========================================
  // ส่วนที่ 4: ตารางวิธีจัดเก็บคะแนน (3 คอลัมน์)
  // ==========================================
  docElements.push(
    createParagraph('ตารางวิธีจัดเก็บคะแนน', {
      bold: true,
      size: 36, // 18pt
      alignment: AlignmentType.CENTER,
      spacingBefore: 120,
      spacingAfter: 120,
    })
  );

  // ลำดับที่ (1000) | วิธีจัดเก็บคะแนน (6500) | คะแนน (1500)
  const scoringTableRows: TableRow[] = [];

  scoringTableRows.push(
    new TableRow({
      tableHeader: true,
      children: [
        makeCell('ลำดับที่', 1000, { bold: true, align: AlignmentType.CENTER, shading: 'F8FAFC' }),
        makeCell('วิธีจัดเก็บคะแนน', 6500, { bold: true, align: AlignmentType.CENTER, shading: 'F8FAFC' }),
        makeCell('คะแนน', 1500, { bold: true, align: AlignmentType.CENTER, shading: 'F8FAFC' }),
      ],
    })
  );

  // หมวด 1: คะแนนระหว่างเรียน (columnSpan 3)
  scoringTableRows.push(
    new TableRow({
      children: [
        new TableCell({
          width: { size: CONTENT_WIDTH_DXA, type: WidthType.DXA },
          columnSpan: 3,
          borders: tableBordersAll,
          shading: { fill: 'F8FAFC', type: ShadingType.CLEAR },
          children: [
            createParagraph(`คะแนนระหว่างเรียน (${data.formativeScoreTotal || 80} คะแนน)`, {
              bold: true,
              size: 32,
              spacingBefore: 50,
              spacingAfter: 50,
            }),
          ],
        }),
      ],
    })
  );

  (data.formativeScoringRows || []).forEach(r => {
    scoringTableRows.push(
      new TableRow({
        children: [
          makeCell(String(r.order), 1000, { align: AlignmentType.CENTER }),
          makeCell(r.methodDescription, 6500),
          makeCell(String(r.score), 1500, { align: AlignmentType.CENTER }),
        ],
      })
    );
  });

  // หมวด 2: คะแนนสอบปลายภาค (columnSpan 3)
  scoringTableRows.push(
    new TableRow({
      children: [
        new TableCell({
          width: { size: CONTENT_WIDTH_DXA, type: WidthType.DXA },
          columnSpan: 3,
          borders: tableBordersAll,
          shading: { fill: 'F8FAFC', type: ShadingType.CLEAR },
          children: [
            createParagraph(`คะแนนสอบปลายภาค (${data.summativeScoreTotal || 20} คะแนน)`, {
              bold: true,
              size: 32,
              spacingBefore: 50,
              spacingAfter: 50,
            }),
          ],
        }),
      ],
    })
  );

  (data.summativeScoringRows || []).forEach(r => {
    scoringTableRows.push(
      new TableRow({
        children: [
          makeCell(String(r.order), 1000, { align: AlignmentType.CENTER }),
          makeCell(r.methodDescription, 6500),
          makeCell(String(r.score), 1500, { align: AlignmentType.CENTER }),
        ],
      })
    );
  });

  // สรุปคะแนนรวม 100
  scoringTableRows.push(
    new TableRow({
      children: [
        new TableCell({
          width: { size: 7500, type: WidthType.DXA },
          columnSpan: 2,
          borders: tableBordersAll,
          children: [
            createParagraph('รวม', {
              bold: true,
              size: 32,
              alignment: AlignmentType.CENTER,
              spacingBefore: 60,
              spacingAfter: 60,
            }),
          ],
        }),
        makeCell('100', 1500, { bold: true, align: AlignmentType.CENTER }),
      ],
    })
  );

  docElements.push(
    new Table({
      width: { size: CONTENT_WIDTH_DXA, type: WidthType.DXA },
      layout: TableLayoutType.FIXED,
      borders: tableBordersAll,
      rows: scoringTableRows,
    })
  );

  docElements.push(new Paragraph({ spacing: { before: 140, after: 80 } }));

  // ==========================================
  // ส่วนที่ 5: ตารางเกณฑ์การตัดสินผลการเรียน
  // ==========================================
  docElements.push(
    createParagraph('เกณฑ์การตัดสินผลการเรียน', {
      bold: true,
      size: 32, // 16pt
      spacingBefore: 100,
      spacingAfter: 60,
    })
  );

  const gradeCriteria = [
    { grade: '4', score: '80 ขึ้นไป' },
    { grade: '3.5', score: '75 - 79' },
    { grade: '3', score: '70 - 74' },
    { grade: '2.5', score: '65 - 69' },
    { grade: '2', score: '60 - 64' },
    { grade: '1.5', score: '55 - 59' },
    { grade: '1', score: '50 - 54' },
    { grade: '0', score: 'ต่ำกว่า 50' },
    { grade: 'ร', score: 'ส่งงานไม่ครบ / ยังไม่ตัดสินผลการเรียน' },
    { grade: 'มส', score: 'มีเวลาเรียนไม่ครบ 80% ของเวลาเรียนทั้งหมด' },
  ];

  const gradeTableRows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: [
        makeCell('เกรด', 3000, { bold: true, align: AlignmentType.CENTER, shading: 'F8FAFC' }),
        makeCell('ช่วงคะแนน', 6000, { bold: true, align: AlignmentType.CENTER, shading: 'F8FAFC' }),
      ],
    }),
  ];

  gradeCriteria.forEach(g => {
    gradeTableRows.push(
      new TableRow({
        children: [
          makeCell(g.grade, 3000, { bold: g.grade === '4' || g.grade === '0', align: AlignmentType.CENTER }),
          makeCell(g.score, 6000, { align: AlignmentType.CENTER }),
        ],
      })
    );
  });

  docElements.push(
    new Table({
      width: { size: CONTENT_WIDTH_DXA, type: WidthType.DXA },
      layout: TableLayoutType.FIXED,
      borders: tableBordersAll,
      rows: gradeTableRows,
    })
  );

  // สร้าง Document พร้อมตั้งค่าหน้ากระดาษ A4 ขอบ 1 นิ้วรอบด้าน
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: A4_WIDTH_DXA, height: A4_HEIGHT_DXA },
            margin: {
              top: MARGIN_1_INCH_DXA,
              bottom: MARGIN_1_INCH_DXA,
              left: MARGIN_1_INCH_DXA,
              right: MARGIN_1_INCH_DXA,
            },
          },
        },
        children: docElements,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const safeCode = (data.courseCode || 'วิชา').replace(/[/\\?%*:|"<>]/g, '_');
  const safeName = (data.courseName || 'โครงการจัดการเรียนรู้').replace(/[/\\?%*:|"<>]/g, '_');
  const fileName = `${safeCode}_${safeName}_โครงการจัดการเรียนรู้.docx`;
  saveAs(blob, fileName);
}

function makeCell(
  text: string,
  width: number,
  options: {
    bold?: boolean;
    align?: AlignmentValue;
    shading?: string;
    span?: number;
  } = {}
): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    columnSpan: options.span,
    borders: tableBordersAll,
    shading: options.shading ? { fill: options.shading, type: ShadingType.CLEAR } : undefined,
    children: [
      createParagraph(text, {
        bold: options.bold ?? false,
        size: 32,
        alignment: options.align ?? AlignmentType.LEFT,
        spacingBefore: 40,
        spacingAfter: 40,
      }),
    ],
  });
}

/**
 * ============================================================
 * คัดลอกเอกสารทั้งฉบับเป็น Rich-Text HTML สำหรับวางลง Microsoft Word
 * ============================================================
 */
export async function copyLongTermRichText(data: LongTermPlanData): Promise<boolean> {
  const html = generateLongTermRichTextHtml(data);
  const plain = generateLongTermPlainText(data);

  // กลยุทธ์ที่ 1: Modern Async Clipboard API (เขียนทั้ง text/html และ text/plain)
  if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
    try {
      const htmlBlob = new Blob([html], { type: 'text/html' });
      const textBlob = new Blob([plain], { type: 'text/plain' });
      const item = new ClipboardItem({
        'text/html': htmlBlob,
        'text/plain': textBlob,
      });
      await navigator.clipboard.write([item]);
      return true;
    } catch (err) {
      console.warn('[Clipboard] navigator.clipboard.write failed, trying live DOM selection:', err);
    }
  }

  // กลยุทธ์ที่ 2: Live DOM Selection Copy (คัดลอกโดยตรงจากหน้าพรีวิว A4 ที่แสดงผลอยู่)
  try {
    const previewEl = document.getElementById('lt-preview-content');
    if (previewEl) {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(previewEl);
      selection?.removeAllRanges();
      selection?.addRange(range);
      const successful = document.execCommand('copy');
      selection?.removeAllRanges();
      if (successful) return true;
    }
  } catch (err) {
    console.warn('[Clipboard] DOM selection copy failed, trying writeText:', err);
  }

  // กลยุทธ์ที่ 3: Plain text writeText
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(plain);
      return true;
    }
  } catch {
    // ignore
  }

  return false;
}

function escapeHtml(text: string): string {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * แปลงข้อมูลโครงการจัดการเรียนรู้เป็น Rich-Text HTML สำหรับ Microsoft Word
 */
export function generateLongTermRichTextHtml(data: LongTermPlanData): string {
  const fontStyle = 'font-family: "TH SarabunPSK", "TH Sarabun New", Sarabun, sans-serif; font-size: 16pt; color: #000000; line-height: 1.35;';
  const tableStyle = 'border-collapse: collapse; width: 100%; border: 1px solid #000000; font-family: "TH SarabunPSK", sans-serif; font-size: 16pt; margin-top: 8px; margin-bottom: 16px;';
  const thStyle = 'border: 1px solid #000000; padding: 4px 6px; text-align: center; font-weight: bold; background-color: #f2f2f2; font-family: "TH SarabunPSK", sans-serif; font-size: 16pt; color: #000000;';
  const tdStyle = 'border: 1px solid #000000; padding: 4px 6px; vertical-align: top; font-family: "TH SarabunPSK", sans-serif; font-size: 16pt; color: #000000;';
  const tdCenter = 'border: 1px solid #000000; padding: 4px 6px; vertical-align: top; text-align: center; font-family: "TH SarabunPSK", sans-serif; font-size: 16pt; color: #000000;';
  const headerTdLeft = 'padding: 2px 4px; text-align: left; border: none; font-family: "TH SarabunPSK", sans-serif; font-size: 16pt; color: #000000;';
  const headerTdRight = 'padding: 2px 4px; text-align: right; border: none; font-family: "TH SarabunPSK", sans-serif; font-size: 16pt; color: #000000;';

  const indicatorsListHtml = (data.indicatorsList || []).map(ind => `<p style="${fontStyle} margin: 2px 0 2px 28px;">${escapeHtml(ind)}</p>`).join('');

  const unitRowsHtml = (data.unitRows || []).map(u => `
    <tr>
      <td style="${tdCenter}">${escapeHtml(String(u.unitNumber))}</td>
      <td style="${tdStyle}">${escapeHtml(u.unitTitle)}</td>
      <td style="${tdStyle}">${escapeHtml(u.coreConcept)}</td>
      <td style="${tdStyle}">${escapeHtml(u.indicators)}</td>
      <td style="${tdCenter} font-weight: bold;">${escapeHtml(String(u.hours))}</td>
      <td style="${tdCenter} font-weight: bold;">${escapeHtml(String(u.score))}</td>
    </tr>
  `).join('');

  const weeklyRowsHtml = (data.weeklyRows || []).map(w => {
    let groupHeader = '';
    if (w.planGroupTitle && w.planGroupTitle.trim()) {
      groupHeader = `
        <tr>
          <td colspan="8" style="${tdStyle} font-weight: bold; background-color: #f2f2f2;">${escapeHtml(w.planGroupTitle)}</td>
        </tr>
      `;
    }
    return `
      ${groupHeader}
      <tr>
        <td style="${tdCenter} font-weight: bold;">${escapeHtml(String(w.weekNumber))}</td>
        <td style="${tdStyle}">${escapeHtml(w.indicators || '-')}</td>
        <td style="${tdStyle}">${escapeHtml(w.unitAndTopic)}</td>
        <td style="${tdStyle}">${escapeHtml(w.objectives)}</td>
        <td style="${tdStyle}">${escapeHtml(w.coreContent)}</td>
        <td style="${tdStyle}">${escapeHtml(w.teachingMethod)}</td>
        <td style="${tdStyle}">${escapeHtml(w.mediaResources)}</td>
        <td style="${tdStyle}">${escapeHtml(w.assessment)}</td>
      </tr>
    `;
  }).join('');

  const formativeRowsHtml = (data.formativeScoringRows || []).map(r => `
    <tr>
      <td style="${tdCenter}">${escapeHtml(String(r.order))}</td>
      <td style="${tdStyle}">${escapeHtml(r.methodDescription)}</td>
      <td style="${tdCenter} font-weight: bold;">${escapeHtml(String(r.score))}</td>
    </tr>
  `).join('');

  const summativeRowsHtml = (data.summativeScoringRows || []).map(r => `
    <tr>
      <td style="${tdCenter}">${escapeHtml(String(r.order))}</td>
      <td style="${tdStyle}">${escapeHtml(r.methodDescription)}</td>
      <td style="${tdCenter} font-weight: bold;">${escapeHtml(String(r.score))}</td>
    </tr>
  `).join('');

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body, p, div, td, th { font-family: "TH SarabunPSK", "TH Sarabun New", Sarabun, sans-serif; font-size: 16pt; line-height: 1.35; color: #000000; }
  h1 { font-size: 18pt; font-weight: bold; text-align: center; margin: 12pt 0 6pt 0; color: #000000; }
  h2 { font-size: 16pt; font-weight: bold; margin: 10pt 0 4pt 0; color: #000000; }
  table { border-collapse: collapse; width: 100%; font-size: 16pt; margin: 8pt 0; }
  th, td { border: 1px solid #000000; padding: 4pt 6pt; }
</style>
</head>
<body>
<!--StartFragment-->

  <!-- ส่วนที่ 1: คำอธิบายรายวิชา -->
  <h1 style="font-family: 'TH SarabunPSK', sans-serif; font-size: 18pt; font-weight: bold; text-align: center; margin: 12pt 0 6pt 0; color: #000000;">คำอธิบายรายวิชา</h1>
  <table style="width: 100%; border-collapse: collapse; margin-bottom: 8px; border: none;">
    <tr>
      <td style="${headerTdLeft}">กลุ่มสาระการเรียนรู้${escapeHtml(data.subjectGroupName)} รายวิชา${escapeHtml(data.courseName)}</td>
      <td style="${headerTdRight}">รหัสวิชา ${escapeHtml(data.courseCode)}</td>
    </tr>
    <tr>
      <td style="${headerTdLeft}">ชั้น${escapeHtml(data.gradeName)}</td>
      <td style="${headerTdRight}">จำนวน ${escapeHtml(String(data.totalHours))} ชั่วโมง</td>
    </tr>
    <tr>
      <td style="${headerTdLeft}">ภาคเรียนที่ ${escapeHtml(data.semester)} ปีการศึกษา ${escapeHtml(data.academicYear)}</td>
      <td style="${headerTdRight}">จำนวน ${escapeHtml(String(data.totalCredits))} หน่วยกิต</td>
    </tr>
  </table>

  <p style="${fontStyle} text-indent: 1.25cm; margin-top: 8px; text-align: justify;">${escapeHtml(data.courseDescriptionPara1)}</p>
  <p style="${fontStyle} text-indent: 1.25cm; text-align: justify;">${escapeHtml(data.courseDescriptionPara2)}</p>

  <h2 style="font-family: 'TH SarabunPSK', sans-serif; font-size: 16pt; font-weight: bold; margin-top: 12px; margin-bottom: 4px; color: #000000;">ตัวชี้วัด</h2>
  ${indicatorsListHtml}
  <p style="${fontStyle} font-weight: bold; margin-top: 6px;">รวม ${escapeHtml(String(data.totalIndicatorsCount || data.indicatorsList?.length || 0))} ตัวชี้วัด</p>

  <h2 style="font-family: 'TH SarabunPSK', sans-serif; font-size: 16pt; font-weight: bold; margin-top: 12px; margin-bottom: 4px; color: #000000;">จุดประสงค์ด้านการเรียนรู้</h2>
  <p style="${fontStyle} font-weight: bold;">ด้านความรู้ (K)</p>
  ${(data.kObjective || '').split('\n').filter(Boolean).map(l => `<p style="${fontStyle} margin-left: 28px;">${escapeHtml(l)}</p>`).join('')}

  <p style="${fontStyle} font-weight: bold; margin-top: 4px;">ทักษะกระบวนการ (P)</p>
  ${(data.pObjective || '').split('\n').filter(Boolean).map(l => `<p style="${fontStyle} margin-left: 28px;">${escapeHtml(l)}</p>`).join('')}

  <p style="${fontStyle} font-weight: bold; margin-top: 4px;">ด้านคุณลักษณะ (A)</p>
  ${(data.aObjective || '').split('\n').filter(Boolean).map(l => `<p style="${fontStyle} margin-left: 28px;">${escapeHtml(l)}</p>`).join('')}

  <br clear="all" style="page-break-before: always; mso-break-type: section-break;" />

  <!-- ส่วนที่ 2: โครงการจัดการเรียนรู้ระยะยาว -->
  <h1 style="font-family: 'TH SarabunPSK', sans-serif; font-size: 18pt; font-weight: bold; text-align: center; margin: 12pt 0 6pt 0; color: #000000;">โครงการจัดการเรียนรู้ระยะยาว</h1>
  <table style="width: 100%; border-collapse: collapse; margin-bottom: 8px; border: none;">
    <tr>
      <td style="${headerTdLeft}">กลุ่มสาระการเรียนรู้${escapeHtml(data.subjectGroupName)} รายวิชา${escapeHtml(data.courseName)}</td>
      <td style="${headerTdRight}">รหัสวิชา ${escapeHtml(data.courseCode)}</td>
    </tr>
    <tr>
      <td style="${headerTdLeft}">ชั้น${escapeHtml(data.gradeName)} ภาคเรียนที่ ${escapeHtml(data.semester)} ปีการศึกษา ${escapeHtml(data.academicYear)}</td>
      <td style="${headerTdRight}">จำนวน ${escapeHtml(String(data.totalHours))} ชั่วโมง</td>
    </tr>
    <tr>
      <td style="${headerTdLeft}">ผู้สอน ${escapeHtml(data.teacherName)}</td>
      <td style="${headerTdRight}">จำนวน ${escapeHtml(String(data.totalCredits))} หน่วยกิต</td>
    </tr>
  </table>

  <table border="1" cellspacing="0" cellpadding="4" style="${tableStyle}">
    <thead>
      <tr>
        <th style="${thStyle}; width: 8%;">หน่วยที่</th>
        <th style="${thStyle}; width: 24%;">ชื่อหน่วยการเรียนรู้</th>
        <th style="${thStyle}; width: 31%;">สาระสำคัญ / สาระการเรียนรู้</th>
        <th style="${thStyle}; width: 21%;">มาตรฐาน / ตัวชี้วัด</th>
        <th style="${thStyle}; width: 8%;">เวลา (ชม.)</th>
        <th style="${thStyle}; width: 8%;">คะแนน</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td colspan="6" style="${tdCenter} font-weight: bold; background-color: #f2f2f2;">ปฐมนิเทศ</td>
      </tr>
      ${unitRowsHtml}
      <tr>
        <td colspan="5" style="${tdStyle}">การเข้าชั้นเรียน การแต่งกาย จิตพิสัย และความร่วมมือ</td>
        <td style="${tdCenter} font-weight: bold;">${escapeHtml(String(data.affectiveScore ?? 10))}</td>
      </tr>
      <tr>
        <td colspan="4" style="${tdStyle}">สอบปลายภาค</td>
        <td style="${tdCenter} font-weight: bold;">${escapeHtml(String(data.finalExamHours ?? 2))}</td>
        <td style="${tdCenter} font-weight: bold;">${escapeHtml(String(data.finalExamScore ?? 20))}</td>
      </tr>
      <tr style="background-color: #f2f2f2;">
        <td colspan="4" style="${tdCenter} font-weight: bold;">รวม</td>
        <td style="${tdCenter} font-weight: bold;">${escapeHtml(String(data.totalHours))}</td>
        <td style="${tdCenter} font-weight: bold;">100</td>
      </tr>
    </tbody>
  </table>

  <br clear="all" style="page-break-before: always; mso-break-type: section-break;" />

  <!-- ส่วนที่ 3: ตารางแผนการจัดการเรียนรู้รายสัปดาห์ -->
  <h1 style="font-family: 'TH SarabunPSK', sans-serif; font-size: 18pt; font-weight: bold; text-align: center; margin: 12pt 0 6pt 0; color: #000000;">ตารางแผนการจัดการเรียนรู้รายสัปดาห์</h1>
  <table border="1" cellspacing="0" cellpadding="4" style="${tableStyle}">
    <thead>
      <tr>
        <th style="${thStyle}; width: 7%;">สัปดาห์ที่</th>
        <th style="${thStyle}; width: 12%;">ตัวชี้วัด</th>
        <th style="${thStyle}; width: 15%;">หน่วยการเรียนรู้/เรื่อง</th>
        <th style="${thStyle}; width: 14%;">จุดประสงค์การเรียนรู้</th>
        <th style="${thStyle}; width: 16%;">หัวข้อ/สาระสำคัญ</th>
        <th style="${thStyle}; width: 13%;">วิธีจัดการเรียนรู้</th>
        <th style="${thStyle}; width: 11%;">สื่อ/แหล่งเรียนรู้</th>
        <th style="${thStyle}; width: 12%;">การวัดและประเมินผล</th>
      </tr>
    </thead>
    <tbody>
      ${weeklyRowsHtml}
    </tbody>
  </table>

  <br clear="all" style="page-break-before: always; mso-break-type: section-break;" />

  <!-- ส่วนที่ 4: วิธีจัดเก็บคะแนน -->
  <h1 style="font-family: 'TH SarabunPSK', sans-serif; font-size: 18pt; font-weight: bold; text-align: center; margin: 12pt 0 6pt 0; color: #000000;">ตารางวิธีจัดเก็บคะแนน</h1>
  <table border="1" cellspacing="0" cellpadding="4" style="${tableStyle}">
    <thead>
      <tr>
        <th style="${thStyle}; width: 12%;">ลำดับที่</th>
        <th style="${thStyle}; width: 72%;">วิธีจัดเก็บคะแนน</th>
        <th style="${thStyle}; width: 16%;">คะแนน</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td colspan="3" style="${tdStyle} font-weight: bold; background-color: #f2f2f2;">คะแนนระหว่างเรียน (${escapeHtml(String(data.formativeScoreTotal || 80))} คะแนน)</td>
      </tr>
      ${formativeRowsHtml}
      <tr>
        <td colspan="3" style="${tdStyle} font-weight: bold; background-color: #f2f2f2;">คะแนนสอบปลายภาค (${escapeHtml(String(data.summativeScoreTotal || 20))} คะแนน)</td>
      </tr>
      ${summativeRowsHtml}
      <tr style="background-color: #f2f2f2;">
        <td colspan="2" style="${tdCenter} font-weight: bold;">รวม</td>
        <td style="${tdCenter} font-weight: bold;">100</td>
      </tr>
    </tbody>
  </table>

  <h2 style="font-family: 'TH SarabunPSK', sans-serif; font-size: 16pt; font-weight: bold; margin-top: 14pt; margin-bottom: 6pt; color: #000000;">เกณฑ์การตัดสินผลการเรียน</h2>
  <table border="1" cellspacing="0" cellpadding="4" style="${tableStyle}">
    <thead>
      <tr>
        <th style="${thStyle}; width: 35%;">เกรด</th>
        <th style="${thStyle}; width: 65%;">ช่วงคะแนน</th>
      </tr>
    </thead>
    <tbody>
      <tr><td style="${tdCenter} font-weight: bold;">4</td><td style="${tdCenter}">80 ขึ้นไป</td></tr>
      <tr><td style="${tdCenter}">3.5</td><td style="${tdCenter}">75 - 79</td></tr>
      <tr><td style="${tdCenter}">3</td><td style="${tdCenter}">70 - 74</td></tr>
      <tr><td style="${tdCenter}">2.5</td><td style="${tdCenter}">65 - 69</td></tr>
      <tr><td style="${tdCenter}">2</td><td style="${tdCenter}">60 - 64</td></tr>
      <tr><td style="${tdCenter}">1.5</td><td style="${tdCenter}">55 - 59</td></tr>
      <tr><td style="${tdCenter}">1</td><td style="${tdCenter}">50 - 54</td></tr>
      <tr><td style="${tdCenter} font-weight: bold;">0</td><td style="${tdCenter}">ต่ำกว่า 50</td></tr>
      <tr><td style="${tdCenter}">ร</td><td style="${tdCenter}">ส่งงานไม่ครบ / ยังไม่ตัดสินผลการเรียน</td></tr>
      <tr><td style="${tdCenter}">มส</td><td style="${tdCenter}">มีเวลาเรียนไม่ครบ 80% ของเวลาเรียนทั้งหมด</td></tr>
    </tbody>
  </table>

<!--EndFragment-->
</body>
</html>
  `.trim();
}

export function generateLongTermPlainText(data: LongTermPlanData): string {
  const lines: string[] = [];

  // ส่วนที่ 1: คำอธิบายรายวิชา
  lines.push('คำอธิบายรายวิชา');
  lines.push(`กลุ่มสาระการเรียนรู้${data.subjectGroupName} รายวิชา${data.courseName} รหัสวิชา ${data.courseCode}`);
  lines.push(`ชั้น${data.gradeName} จำนวน ${data.totalHours} ชั่วโมง`);
  lines.push(`ภาคเรียนที่ ${data.semester} ปีการศึกษา ${data.academicYear} จำนวน ${data.totalCredits} หน่วยกิต`);
  lines.push('');
  lines.push(`\t${data.courseDescriptionPara1}`);
  lines.push('');
  lines.push(`\t${data.courseDescriptionPara2}`);
  lines.push('');
  lines.push('ตัวชี้วัด');
  (data.indicatorsList || []).forEach(ind => {
    lines.push(`\t${ind}`);
  });
  lines.push(`รวม ${data.totalIndicatorsCount || data.indicatorsList?.length || 0} ตัวชี้วัด`);
  lines.push('');
  lines.push('จุดประสงค์ด้านการเรียนรู้');
  lines.push('ด้านความรู้ (K)');
  lines.push(data.kObjective);
  lines.push('');
  lines.push('ทักษะกระบวนการ (P)');
  lines.push(data.pObjective);
  lines.push('');
  lines.push('ด้านคุณลักษณะ (A)');
  lines.push(data.aObjective);
  lines.push('');
  lines.push('------------------------------------------------------------');
  lines.push('');

  // ส่วนที่ 2: โครงสร้างโครงการจัดการเรียนรู้ระยะยาว
  lines.push('โครงการจัดการเรียนรู้ระยะยาว');
  lines.push(`กลุ่มสาระการเรียนรู้${data.subjectGroupName} รายวิชา${data.courseName} รหัสวิชา ${data.courseCode}`);
  lines.push(`ชั้น${data.gradeName} ภาคเรียนที่ ${data.semester} ปีการศึกษา ${data.academicYear} จำนวน ${data.totalHours} ชั่วโมง`);
  lines.push(`ผู้สอน ${data.teacherName} จำนวน ${data.totalCredits} หน่วยกิต`);
  lines.push('');
  lines.push('หน่วยที่\tชื่อหน่วยการเรียนรู้\tสาระสำคัญ / สาระการเรียนรู้\tมาตรฐาน / ตัวชี้วัด\tเวลา (ชม.)\tคะแนน');
  lines.push('-\tปฐมนิเทศ\t-\t-\t-\t-');
  (data.unitRows || []).forEach(u => {
    lines.push(`${u.unitNumber}\t${u.unitTitle}\t${u.coreConcept}\t${u.indicators}\t${u.hours}\t${u.score}`);
  });
  lines.push(`-\tการเข้าชั้นเรียน การแต่งกาย จิตพิสัย และความร่วมมือ\t-\t-\t-\t${data.affectiveScore ?? 10}`);
  lines.push(`-\tสอบปลายภาค\t-\t-\t${data.finalExamHours ?? 2}\t${data.finalExamScore ?? 20}`);
  lines.push(`-\tรวม\t-\t-\t${data.totalHours}\t100`);
  lines.push('');
  lines.push('------------------------------------------------------------');
  lines.push('');

  // ส่วนที่ 3: ตารางแผนการจัดการเรียนรู้รายสัปดาห์
  lines.push('ตารางแผนการจัดการเรียนรู้รายสัปดาห์');
  lines.push('สัปดาห์ที่\tตัวชี้วัด\tหน่วยการเรียนรู้/เรื่อง\tจุดประสงค์การเรียนรู้\tหัวข้อ/สาระสำคัญ\tวิธีจัดการเรียนรู้\tสื่อ/แหล่งเรียนรู้\tการวัดและประเมินผล');
  (data.weeklyRows || []).forEach(w => {
    if (w.planGroupTitle) {
      lines.push(`[${w.planGroupTitle}]`);
    }
    lines.push(`${w.weekNumber}\t${w.indicators || '-'}\t${w.unitAndTopic}\t${w.objectives}\t${w.coreContent}\t${w.teachingMethod}\t${w.mediaResources}\t${w.assessment}`);
  });
  lines.push('');
  lines.push('------------------------------------------------------------');
  lines.push('');

  // ส่วนที่ 4: ตารางวิธีจัดเก็บคะแนน
  lines.push('ตารางวิธีจัดเก็บคะแนน');
  lines.push(`คะแนนระหว่างเรียน (${data.formativeScoreTotal || 80} คะแนน)`);
  lines.push('ลำดับที่\tวิธีจัดเก็บคะแนน\tคะแนน');
  (data.formativeScoringRows || []).forEach(r => {
    lines.push(`${r.order}\t${r.methodDescription}\t${r.score}`);
  });
  lines.push(`คะแนนสอบปลายภาค (${data.summativeScoreTotal || 20} คะแนน)`);
  (data.summativeScoringRows || []).forEach(r => {
    lines.push(`${r.order}\t${r.methodDescription}\t${r.score}`);
  });
  lines.push('รวม\t\t100');
  lines.push('');

  // ส่วนที่ 5: เกณฑ์การตัดสินผลการเรียน
  lines.push('เกณฑ์การตัดสินผลการเรียน');
  lines.push('เกรด\tช่วงคะแนน');
  lines.push('4\t80 ขึ้นไป');
  lines.push('3.5\t75 - 79');
  lines.push('3\t70 - 74');
  lines.push('2.5\t65 - 69');
  lines.push('2\t60 - 64');
  lines.push('1.5\t55 - 59');
  lines.push('1\t50 - 54');
  lines.push('0\tต่ำกว่า 50');
  lines.push('ร\tส่งงานไม่ครบ / ยังไม่ตัดสินผลการเรียน');
  lines.push('มส\tมีเวลาเรียนไม่ครบ 80% ของเวลาเรียนทั้งหมด');

  return lines.join('\n');
}
