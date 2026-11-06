/**
 * EduPlan AI — Export & Clipboard Module
 * ============================================================
 * สร้างเอกสาร .docx มาตรฐานราชการ 11 หัวข้อด้วย docx library
 * ขนาดกระดาษ A4 ขอบ 1 นิ้ว ตารางล็อกความกว้างไม่ล้นหน้ากระดาษ
 * และสร้าง Rich-Text Clipboard สำหรับ Microsoft Word
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
  TabStopType,
} from 'docx';
import { saveAs } from 'file-saver';
import type { LessonPlanData, RubricData } from './types';
import { getRubricScaleInfo } from './templates';
export * from './rubricExporter';

const FONT_FAMILY = 'TH SarabunPSK';

// A4 Dimensions in DXA (Twips): 210mm x 297mm
const A4_WIDTH_DXA = 11906;
const A4_HEIGHT_DXA = 16838;
const MARGIN_1_INCH_DXA = 1440; // convertInchesToTwip(1)
// Printable content width: 11,906 - 2,880 = 9,026 DXA -> Use 9,000 DXA for safety
const CONTENT_WIDTH_DXA = 9000;

const noBorderSpec = {
  style: BorderStyle.NONE,
  size: 0,
  color: 'FFFFFF',
};

const noBorders = {
  top: noBorderSpec,
  bottom: noBorderSpec,
  left: noBorderSpec,
  right: noBorderSpec,
  insideHorizontal: noBorderSpec,
  insideVertical: noBorderSpec,
};

/**
 * สร้าง Paragraph หัวข้อย่อย (16pt Bold)
 */
function createSectionTitle(title: string): Paragraph {
  return new Paragraph({
    spacing: { before: 180, after: 80, line: 280 },
    children: [
      new TextRun({
        text: title,
        font: FONT_FAMILY,
        size: 32, // 16pt (half-points)
        bold: true,
      }),
    ],
  });
}

/**
 * สร้าง Paragraph ข้อความทั่วไป (16pt Regular)
 */
function createBodyParagraph(text: string, options: { bold?: boolean; indent?: boolean } = {}): Paragraph {
  return new Paragraph({
    spacing: { before: 40, after: 40, line: 280 },
    indent: options.indent ? { left: convertInchesToTwip(0.4) } : undefined,
    children: [
      new TextRun({
        text: text,
        font: FONT_FAMILY,
        size: 32, // 16pt
        bold: options.bold,
      }),
    ],
  });
}

/**
 * ============================================================
 * [จุดแก้ไขการ TAB ในไฟล์ Word: exporter.ts]
 * ============================================================
 * คุณครูสามารถปรับเปลี่ยนระยะ Tab ของบันทึกหลังสอน (ข้อ 11) ได้ตรงนี้:
 * - firstTabInches: ระยะ [TAB] ด้านหน้าบรรทัด (เช่น 0.4 นิ้ว หรือ 0.5 นิ้ว)
 * - secondTabInches: ตำแหน่ง [TAB] ตัวที่สอง กลางบรรทัด (เช่น ตรง "คิดเป็นร้อยละ")
 * ============================================================
 */
export const SECTION_11_TAB_CONFIG = {
  firstTabInches: 0.4,   // [แก้ระยะ Tab หน้าบรรทัด Word ที่นี่] ค่าเริ่มต้น 0.4 นิ้ว (ประมาณ 1 Tab)
  secondTabInches: 4.2,  // [แก้ตำแหน่ง Tab ตัวที่สอง Word ที่นี่] ค่าเริ่มต้น 4.2 นิ้ว (ตรงข้อความ "คิดเป็นร้อยละ")
};

function createSection11TabParagraph(text: string, hasSecondTab = false): Paragraph {
  return new Paragraph({
    spacing: { before: 30, after: 30, line: 280 },
    indent: { left: convertInchesToTwip(SECTION_11_TAB_CONFIG.firstTabInches) },
    tabStops: hasSecondTab ? [
      { type: TabStopType.LEFT, position: convertInchesToTwip(SECTION_11_TAB_CONFIG.secondTabInches) },
    ] : undefined,
    children: [
      new TextRun({
        text,
        font: FONT_FAMILY,
        size: 32, // 16pt
      }),
    ],
  });
}

/**
 * แยกข้อความหลายบรรทัดเป็น Paragraphs พร้อม Indent
 */
function createMultiLineParagraphs(text: string, options: { indent?: boolean } = {}): Paragraph[] {
  if (!text) return [createBodyParagraph('-', options)];
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return [createBodyParagraph('-', options)];
  return lines.map(line => createBodyParagraph(line, options));
}

/**
 * จัดรูปแบบกิจกรรมการเรียนรู้ (ข้อ 7) ใน Word:
 * - ขั้นการสอน: [Tab] 0.4 นิ้ว + ตัวหนา (Bold)
 * - กิจกรรมย่อย: [Tab][Tab] 0.8 นิ้ว + ตัวปกติ (Regular)
 */
function createActivitiesDocxParagraphs(text: string): Paragraph[] {
  if (!text) return [createBodyParagraph('-', { indent: true })];
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return [createBodyParagraph('-', { indent: true })];

  return lines.map(line => {
    const cleanLine = line.replace(/^[\t\s#*-]+/, '').replace(/[*_]+$/, '').trim();
    // ตรวจจับขั้นหลัก เช่น "1. ขั้น...", "2. ขั้น...", "3. ขั้น..."
    if (/^[1-9]\.\s*ขั้น/.test(cleanLine) || /^[1-9]\.\s+[^\d]/.test(cleanLine)) {
      return new Paragraph({
        spacing: { before: 180, after: 60, line: 280 },
        indent: { left: 0 },
        children: [
          new TextRun({
            text: cleanLine,
            font: FONT_FAMILY,
            size: 32,
            bold: true,
          }),
        ],
      });
    } else if (/^[1-9]\.[0-9]+/.test(cleanLine)) {
      // ข้อย่อย เช่น "1.1", "2.1", "3.2"
      return new Paragraph({
        spacing: { before: 40, after: 40, line: 280 },
        indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) },
        children: [
          new TextRun({
            text: cleanLine,
            font: FONT_FAMILY,
            size: 32,
            bold: false,
          }),
        ],
      });
    } else {
      // บรรทัดอธิบายทั่วไป
      return new Paragraph({
        spacing: { before: 40, after: 40, line: 280 },
        indent: { left: convertInchesToTwip(0.5) },
        children: [
          new TextRun({
            text: cleanLine,
            font: FONT_FAMILY,
            size: 32,
            bold: false,
          }),
        ],
      });
    }
  });
}

export function getHeaderDisplayValues(data: LessonPlanData) {
  // แถว 1 ซ้าย: [รายวิชา {ชื่อรายวิชา}]
  let courseText = 'รายวิชา ........................................';
  if (data.course_name && data.course_name.trim()) {
    const raw = data.course_name.trim();
    courseText = raw.startsWith('รายวิชา') ? raw : `รายวิชา ${raw}`;
  }

  // แถว 1 ขวา: [ชั้น{ระดับชั้น}]
  let gradeText = 'ชั้น........................';
  if (data.grade && data.grade.trim()) {
    const raw = data.grade.trim();
    gradeText = raw.startsWith('ชั้น') ? raw : `ชั้น${raw}`;
  }

  // แถว 2 ซ้าย: [{หน่วยการเรียนรู้}]
  let unitText = 'หน่วยการเรียนรู้ ........................................';
  if (data.unit && data.unit.trim()) {
    const raw = data.unit.trim();
    unitText = raw.startsWith('หน่วย') ? raw : `หน่วยการเรียนรู้ ${raw}`;
  }

  // แถว 3 ซ้าย: [{แผนการจัดการเรียนรู้}]
  let planText = 'แผนการจัดการเรียนรู้ ........................................';
  if (data.plan_name && data.plan_name.trim()) {
    const raw = data.plan_name.trim();
    planText = raw.startsWith('แผน') ? raw : `แผนการจัดการเรียนรู้ ${raw}`;
  } else if (data.topic && data.topic.trim()) {
    planText = `แผนการจัดการเรียนรู้ เรื่อง ${data.topic.trim()}`;
  }

  // แถว 3 ขวา: [จำนวน {จำนวนชั่วโมง} ชั่วโมง]
  let hoursText = 'จำนวน ...... ชั่วโมง';
  if (data.hours_text && data.hours_text.trim()) {
    const raw = data.hours_text.trim();
    if (raw.includes('ชั่วโมง') || raw.includes('นาที')) {
      hoursText = raw.startsWith('จำนวน') ? raw : `จำนวน ${raw}`;
    } else {
      hoursText = `จำนวน ${raw} ชั่วโมง`;
    }
  }

  // แถว 4 ซ้าย: [กลุ่มสาระการเรียนรู้ {ชื่อกลุ่มสาระวิชา}]
  let subjectText = 'กลุ่มสาระการเรียนรู้ ........................................';
  if (data.subject && data.subject.trim()) {
    const raw = data.subject.trim();
    subjectText = raw.startsWith('กลุ่มสาระ') ? raw : `กลุ่มสาระการเรียนรู้ ${raw}`;
  }

  // แถว 4 ขวา: [ภาคเรียนที่ {ภาคเรียน}]
  let semesterText = 'ภาคเรียนที่ ......';
  if (data.semester && data.semester.trim()) {
    const raw = data.semester.trim();
    semesterText = raw.startsWith('ภาคเรียนที่') ? raw : `ภาคเรียนที่ ${raw}`;
  }

  // แถว 5 ซ้าย: [ปีการศึกษา {ปีการศึกษา} วันที่ {วันที่} {เดือน} พ.ศ. {ปี}]
  const yearPart = (data.year && data.year.trim()) ? data.year.trim() : '............';
  const datePart = (data.date && data.date.trim()) ? data.date.trim() : '......';
  const monthPart = (data.month && data.month.trim()) ? data.month.trim() : '..................';
  const byearPart = (data.buddhist_year && data.buddhist_year.trim()) ? data.buddhist_year.trim() : '............';
  const dateFullText = `ปีการศึกษา ${yearPart} วันที่ ${datePart} ${monthPart} พ.ศ. ${byearPart}`;

  // แถว 5 ขวา: [{ชื่อโรงเรียน}]
  let schoolText = 'โรงเรียน........................................';
  if (data.school && data.school.trim()) {
    const raw = data.school.trim();
    schoolText = raw.startsWith('โรงเรียน') ? raw : `โรงเรียน${raw}`;
  }

  return {
    courseText,
    gradeText,
    unitText,
    planText,
    hoursText,
    subjectText,
    semesterText,
    dateFullText,
    schoolText,
  };
}

/**
 * สร้างตารางหัวแผนการสอน 5 แถว 2 คอลัมน์ ไร้ขอบ (ความกว้างรวม 9,000 DXA)
 * คอลัมน์ 1 ชิดซ้ายสุด (5,600 DXA)
 * คอลัมน์ 2 ชิดขวาสุด (3,400 DXA)
 */
function createHeaderDocxTable(data: LessonPlanData): Table {
  const h = getHeaderDisplayValues(data);
  const COL_WIDTHS = [5600, 3400];

  const rows = [
    // แถวที่ 1: [รายวิชา {ชื่อรายวิชา}] | [ชั้น{ระดับชั้น}]
    new TableRow({
      children: [
        new TableCell({
          width: { size: COL_WIDTHS[0], type: WidthType.DXA },
          borders: noBorders,
          children: [
            new Paragraph({
              alignment: AlignmentType.LEFT,
              spacing: { before: 20, after: 20, line: 280 },
              children: [new TextRun({ text: h.courseText, font: FONT_FAMILY, size: 32, bold: true })],
            }),
          ],
        }),
        new TableCell({
          width: { size: COL_WIDTHS[1], type: WidthType.DXA },
          borders: noBorders,
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              spacing: { before: 20, after: 20, line: 280 },
              children: [new TextRun({ text: h.gradeText, font: FONT_FAMILY, size: 32, bold: true })],
            }),
          ],
        }),
      ],
    }),
    // แถวที่ 2: [{หน่วยการเรียนรู้}] | ว่าง
    new TableRow({
      children: [
        new TableCell({
          width: { size: COL_WIDTHS[0], type: WidthType.DXA },
          borders: noBorders,
          children: [
            new Paragraph({
              alignment: AlignmentType.LEFT,
              spacing: { before: 20, after: 20, line: 280 },
              children: [new TextRun({ text: h.unitText, font: FONT_FAMILY, size: 32, bold: true })],
            }),
          ],
        }),
        new TableCell({
          width: { size: COL_WIDTHS[1], type: WidthType.DXA },
          borders: noBorders,
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              spacing: { before: 20, after: 20, line: 280 },
              children: [new TextRun({ text: '', font: FONT_FAMILY, size: 32 })],
            }),
          ],
        }),
      ],
    }),
    // แถวที่ 3: [{แผนการจัดการเรียนรู้}] | [จำนวน {จำนวนชั่วโมง} ชั่วโมง]
    new TableRow({
      children: [
        new TableCell({
          width: { size: COL_WIDTHS[0], type: WidthType.DXA },
          borders: noBorders,
          children: [
            new Paragraph({
              alignment: AlignmentType.LEFT,
              spacing: { before: 20, after: 20, line: 280 },
              children: [new TextRun({ text: h.planText, font: FONT_FAMILY, size: 32, bold: true })],
            }),
          ],
        }),
        new TableCell({
          width: { size: COL_WIDTHS[1], type: WidthType.DXA },
          borders: noBorders,
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              spacing: { before: 20, after: 20, line: 280 },
              children: [new TextRun({ text: h.hoursText, font: FONT_FAMILY, size: 32, bold: true })],
            }),
          ],
        }),
      ],
    }),
    // แถวที่ 4: [กลุ่มสาระการเรียนรู้ {ชื่อกลุ่มสาระวิชา}] | [ภาคเรียนที่ {ภาคเรียน}]
    new TableRow({
      children: [
        new TableCell({
          width: { size: COL_WIDTHS[0], type: WidthType.DXA },
          borders: noBorders,
          children: [
            new Paragraph({
              alignment: AlignmentType.LEFT,
              spacing: { before: 20, after: 20, line: 280 },
              children: [new TextRun({ text: h.subjectText, font: FONT_FAMILY, size: 32, bold: true })],
            }),
          ],
        }),
        new TableCell({
          width: { size: COL_WIDTHS[1], type: WidthType.DXA },
          borders: noBorders,
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              spacing: { before: 20, after: 20, line: 280 },
              children: [new TextRun({ text: h.semesterText, font: FONT_FAMILY, size: 32, bold: true })],
            }),
          ],
        }),
      ],
    }),
    // แถวที่ 5: [ปีการศึกษา {ปีการศึกษา} วันที่ {วันที่} {เดือน} พ.ศ. {ปี}] | [{ชื่อโรงเรียน}]
    new TableRow({
      children: [
        new TableCell({
          width: { size: COL_WIDTHS[0], type: WidthType.DXA },
          borders: noBorders,
          children: [
            new Paragraph({
              alignment: AlignmentType.LEFT,
              spacing: { before: 20, after: 20, line: 280 },
              children: [new TextRun({ text: h.dateFullText, font: FONT_FAMILY, size: 32 })],
            }),
          ],
        }),
        new TableCell({
          width: { size: COL_WIDTHS[1], type: WidthType.DXA },
          borders: noBorders,
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              spacing: { before: 20, after: 20, line: 280 },
              children: [new TextRun({ text: h.schoolText, font: FONT_FAMILY, size: 32 })],
            }),
          ],
        }),
      ],
    }),
  ];

  return new Table({
    width: { size: CONTENT_WIDTH_DXA, type: WidthType.DXA },
    columnWidths: COL_WIDTHS,
    layout: TableLayoutType.FIXED,
    borders: noBorders,
    rows,
  });
}

/**
 * สร้างตารางลงชื่อผู้เขียนแผน ไร้ขอบ จัดชิดขวาของเอกสาร แต่ละแถวกึ่งกลางในตาราง
 * 4 แถว:
 * 1. [..........] ไว้ใช้ในการเซ็น
 * 2. [{ชื่อผู้สอน}]
 * 3. [ตำแหน่ง {ตำแหน่งผู้สอน}]
 * 4. [{วันที่}/{เดือน}/{ปี พ.ศ.}]
 */
function createSignatureDocxTable(data: LessonPlanData): Table {
  const teacherName = data.teacher_name || '……………………………………………………';
  const teacherPos = data.teacher_position || 'ครูผู้ช่วย / ครู';
  const dateStr = (data.date && data.month && data.buddhist_year)
    ? `วันที่ ${data.date} / ${data.month} / ${data.buddhist_year}`
    : 'วันที่ ............ / ............ / ............';

  const SIGN_WIDTH = 4500; // DXA

  const rows = [
    new TableRow({
      children: [
        new TableCell({
          width: { size: SIGN_WIDTH, type: WidthType.DXA },
          borders: noBorders,
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 140, after: 30, line: 280 },
              children: [new TextRun({ text: 'ลงชื่อ.................................................................', font: FONT_FAMILY, size: 32 })],
            }),
          ],
        }),
      ],
    }),
    new TableRow({
      children: [
        new TableCell({
          width: { size: SIGN_WIDTH, type: WidthType.DXA },
          borders: noBorders,
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 30, after: 30, line: 280 },
              children: [new TextRun({ text: `( ${teacherName} )`, font: FONT_FAMILY, size: 32 })],
            }),
          ],
        }),
      ],
    }),
    new TableRow({
      children: [
        new TableCell({
          width: { size: SIGN_WIDTH, type: WidthType.DXA },
          borders: noBorders,
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 30, after: 30, line: 280 },
              children: [new TextRun({ text: `ตำแหน่ง ${teacherPos}`, font: FONT_FAMILY, size: 32 })],
            }),
          ],
        }),
      ],
    }),
    new TableRow({
      children: [
        new TableCell({
          width: { size: SIGN_WIDTH, type: WidthType.DXA },
          borders: noBorders,
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 30, after: 80, line: 280 },
              children: [new TextRun({ text: dateStr, font: FONT_FAMILY, size: 32 })],
            }),
          ],
        }),
      ],
    }),
  ];

  return new Table({
    width: { size: SIGN_WIDTH, type: WidthType.DXA },
    columnWidths: [SIGN_WIDTH],
    alignment: AlignmentType.RIGHT,
    layout: TableLayoutType.FIXED,
    borders: noBorders,
    rows,
  });
}

/**
 * สร้างตารางการวัดและประเมินผล 4 คอลัมน์ (ข้อ 9) ขนาด 9,000 DXA
 * กำหนด columnWidths และ layout: TableLayoutType.FIXED ชัดเจน
 * เพื่อล็อกขนาดไม่ให้ขยายเกินขอบกระดาษ A4 ใน Microsoft Word
 */
function createEvaluationDocxTable(data: LessonPlanData): Table {
  const borderSpec = {
    style: BorderStyle.SINGLE,
    size: 1,
    color: '000000',
  };

  const tableBorders = {
    top: borderSpec,
    bottom: borderSpec,
    left: borderSpec,
    right: borderSpec,
    insideHorizontal: borderSpec,
    insideVertical: borderSpec,
  };

  // รวม 9,000 DXA พอดีพิมพ์ A4 (ขอบ 1 นิ้ว = 9,026 DXA)
  const COL_WIDTHS = [2700, 2100, 2100, 2100];

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      new TableCell({
        width: { size: COL_WIDTHS[0], type: WidthType.DXA },
        borders: tableBorders,
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 60, after: 60, line: 260 },
            children: [new TextRun({ text: 'จุดประสงค์การเรียนรู้', font: FONT_FAMILY, size: 32, bold: true })],
          }),
        ],
      }),
      new TableCell({
        width: { size: COL_WIDTHS[1], type: WidthType.DXA },
        borders: tableBorders,
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 60, after: 60, line: 260 },
            children: [new TextRun({ text: 'วิธีการวัด', font: FONT_FAMILY, size: 32, bold: true })],
          }),
        ],
      }),
      new TableCell({
        width: { size: COL_WIDTHS[2], type: WidthType.DXA },
        borders: tableBorders,
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 60, after: 60, line: 260 },
            children: [new TextRun({ text: 'เครื่องมือวัด', font: FONT_FAMILY, size: 32, bold: true })],
          }),
        ],
      }),
      new TableCell({
        width: { size: COL_WIDTHS[3], type: WidthType.DXA },
        borders: tableBorders,
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 60, after: 60, line: 260 },
            children: [new TextRun({ text: 'เกณฑ์การวัด', font: FONT_FAMILY, size: 32, bold: true })],
          }),
        ],
      }),
    ],
  });

  const bodyRows: TableRow[] = [];
  const rows = data.evaluation_rows && data.evaluation_rows.length > 0
    ? data.evaluation_rows
    : [
        { dimension: 'ด้านความรู้ (K)', objective: data.k_objective, method: 'ตรวจใบงาน', tool: 'แบบประเมินใบงาน', criteria: 'ผ่านเกณฑ์ร้อยละ 70' },
        { dimension: 'ด้านทักษะและกระบวนการ (P)', objective: data.p_objective, method: 'สังเกตพฤติกรรม', tool: 'แบบสังเกตพฤติกรรม', criteria: 'ระดับคุณภาพ 2 ขึ้นไป' },
        { dimension: 'ด้านคุณลักษณะอันพึงประสงค์ (A)', objective: data.a_objective, method: 'สังเกตพฤติกรรม', tool: 'แบบประเมินคุณลักษณะ', criteria: 'ระดับคุณภาพ 2 ขึ้นไป' },
      ];

  rows.forEach(r => {
    bodyRows.push(
      new TableRow({
        children: [
          new TableCell({
            width: { size: COL_WIDTHS[0], type: WidthType.DXA },
            borders: tableBorders,
            children: [
              new Paragraph({
                spacing: { before: 60, after: 30, line: 260 },
                children: [
                  new TextRun({ text: r.dimension, font: FONT_FAMILY, size: 30, bold: true }),
                  new TextRun({ text: `\n${r.objective}`, font: FONT_FAMILY, size: 30 }),
                ],
              }),
            ],
          }),
          new TableCell({
            width: { size: COL_WIDTHS[1], type: WidthType.DXA },
            borders: tableBorders,
            children: [
              new Paragraph({
                spacing: { before: 60, after: 30, line: 260 },
                children: [new TextRun({ text: r.method, font: FONT_FAMILY, size: 30 })],
              }),
            ],
          }),
          new TableCell({
            width: { size: COL_WIDTHS[2], type: WidthType.DXA },
            borders: tableBorders,
            children: [
              new Paragraph({
                spacing: { before: 60, after: 30, line: 260 },
                children: [new TextRun({ text: r.tool, font: FONT_FAMILY, size: 30 })],
              }),
            ],
          }),
          new TableCell({
            width: { size: COL_WIDTHS[3], type: WidthType.DXA },
            borders: tableBorders,
            children: [
              new Paragraph({
                spacing: { before: 60, after: 30, line: 260 },
                children: [new TextRun({ text: r.criteria, font: FONT_FAMILY, size: 30 })],
              }),
            ],
          }),
        ],
      })
    );
  });

  return new Table({
    width: { size: CONTENT_WIDTH_DXA, type: WidthType.DXA },
    columnWidths: COL_WIDTHS,
    layout: TableLayoutType.FIXED,
    borders: tableBorders,
    rows: [headerRow, ...bodyRows],
  });
}

/**
 * ดาวน์โหลดไฟล์ .docx มาตรฐาน 11 หัวข้อ
 */
export async function exportToDocx(data: LessonPlanData): Promise<void> {
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: {
              width: A4_WIDTH_DXA,
              height: A4_HEIGHT_DXA,
            },
            margin: {
              top: MARGIN_1_INCH_DXA,
              bottom: MARGIN_1_INCH_DXA,
              left: MARGIN_1_INCH_DXA,
              right: MARGIN_1_INCH_DXA,
            },
          },
        },
        children: [
          // ส่วนหัวแผน: คำว่า "แผนจัดการเรียนรู้" กึ่งกลาง
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: 80, line: 300 },
            children: [
              new TextRun({
                text: 'แผนจัดการเรียนรู้',
                font: FONT_FAMILY,
                size: 40, // 20pt Bold
                bold: true,
              }),
            ],
          }),

          // หัวแผนการสอน ตาราง 3 แถว 2 คอลัมน์ ไร้ขอบ
          createHeaderDocxTable(data),

          // เส้นคั่นประ
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 60, after: 140, line: 240 },
            children: [
              new TextRun({
                text: '……………………………………………………………………………………………………………………………………………………',
                font: FONT_FAMILY,
                size: 24,
                color: '888888',
              }),
            ],
          }),

          // 1. มาตรฐานการเรียนรู้
          createSectionTitle('1. มาตรฐานการเรียนรู้'),
          ...createMultiLineParagraphs(data.standards, { indent: true }),

          // 2. ตัวชี้วัด
          createSectionTitle('2. ตัวชี้วัด'),
          ...createMultiLineParagraphs(data.indicators, { indent: true }),

          // 3. สาระสำคัญ
          createSectionTitle('3. สาระสำคัญ'),
          ...createMultiLineParagraphs(data.concept, { indent: true }),

          // 4. จุดประสงค์รายวิชา
          createSectionTitle('4. จุดประสงค์รายวิชา'),
          createBodyParagraph('ความรู้ (K):', { bold: true }),
          ...createMultiLineParagraphs(data.k_objective, { indent: true }),
          createBodyParagraph('ทักษะและกระบวนการ (P):', { bold: true }),
          ...createMultiLineParagraphs(data.p_objective, { indent: true }),
          createBodyParagraph('คุณลักษณะอันพึงประสงค์ (A):', { bold: true }),
          ...createMultiLineParagraphs(data.a_objective, { indent: true }),

          // 5. สาระการเรียนรู้
          createSectionTitle('5. สาระการเรียนรู้'),
          ...createMultiLineParagraphs(data.learning_content, { indent: true }),

          // 6. สมรรถนะสำคัญของผู้เรียน
          createSectionTitle('6. สมรรถนะสำคัญของผู้เรียน'),
          ...createMultiLineParagraphs(data.competencies, { indent: true }),

          // 7. กิจกรรมการเรียนรู้ (จัดย่อหน้า Tab ตามลำดับขั้น)
          createSectionTitle(`7. กิจกรรมการเรียนรู้ (รูปแบบการสอนแบบ ${data.teaching_model})`),
          ...createActivitiesDocxParagraphs(data.activities),

          // 8. สื่อและแหล่งการเรียนรู้
          createSectionTitle('8. สื่อและแหล่งการเรียนรู้'),
          ...createMultiLineParagraphs(data.media_resources, { indent: true }),

          // 9. การวัดผลประเมินผล (ตาราง 4 คอลัมน์)
          createSectionTitle('9. การวัดผลประเมินผล'),
          createEvaluationDocxTable(data),

          // 10. กิจกรรมเสนอแนะ/งานที่มอบหมาย
          createSectionTitle('10. กิจกรรมเสนอแนะ/งานที่มอบหมาย'),
          createBodyParagraph('1. กิจกรรมเสนอแนะ:', { bold: true }),
          ...createMultiLineParagraphs(data.suggestions, { indent: true }),
          createBodyParagraph('2. งานที่มอบหมาย:', { bold: true }),
          ...createMultiLineParagraphs(data.assignments, { indent: true }),

          // 11. บันทึกหลังกระบวนการจัดการเรียนรู้
          createSectionTitle('11. บันทึกหลังกระบวนการจัดการเรียนรู้'),
          createBodyParagraph('ผลการจัดการเรียนการสอน', { bold: true }),
          createSection11TabParagraph('นักเรียนจำนวน................คน'),
          createSection11TabParagraph('ผ่านจุดประสงค์การเรียนรู้................คน\tคิดเป็นร้อยละ...............', true),
          createSection11TabParagraph('ไม่ผ่านจุดประสงค์การเรียนรู้................คน\tคิดเป็นร้อยละ...............', true),

          createBodyParagraph('ด้านความรู้ (K)', { bold: true }),
          createSection11TabParagraph('............................................................................................................................................................................................................'),

          createBodyParagraph('ด้านทักษะและกระบวนการ (P)', { bold: true }),
          createSection11TabParagraph('............................................................................................................................................................................................................'),

          createBodyParagraph('ด้านคุณลักษณะอันพึงประสงค์ (A)', { bold: true }),
          createSection11TabParagraph('............................................................................................................................................................................................................'),

          createBodyParagraph('ปัญหา / อุปสรรค', { bold: true }),
          createSection11TabParagraph('............................................................................................................................................................................................................'),

          createBodyParagraph('ข้อเสนอแนะ / แนวทางแก้ไข', { bold: true }),
          createSection11TabParagraph('............................................................................................................................................................................................................'),

          // ตารางลงชื่อผู้เขียนแผนจัดขวาสุด กึ่งกลาง
          createSignatureDocxTable(data),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const filename = `แผนจัดการเรียนรู้_${(data.topic || 'บทเรียน').replace(/\s+/g, '_')}_${data.grade}.docx`;
  saveAs(blob, filename);
}

/**
 * ฟังก์ชันสร้าง Rich-Text Table เป็น HTML
 */
function buildEvaluationHtmlTable(data: LessonPlanData): string {
  const rows = data.evaluation_rows && data.evaluation_rows.length > 0
    ? data.evaluation_rows
    : [
        { dimension: 'ด้านความรู้ (K)', objective: data.k_objective, method: 'ตรวจใบงาน', tool: 'แบบประเมินใบงาน', criteria: 'ผ่านเกณฑ์ร้อยละ 70' },
        { dimension: 'ด้านทักษะและกระบวนการ (P)', objective: data.p_objective, method: 'สังเกตพฤติกรรม', tool: 'แบบสังเกตพฤติกรรม', criteria: 'ระดับคุณภาพ 2 ขึ้นไป' },
        { dimension: 'ด้านคุณลักษณะอันพึงประสงค์ (A)', objective: data.a_objective, method: 'สังเกตพฤติกรรม', tool: 'แบบประเมินคุณลักษณะ', criteria: 'ระดับคุณภาพ 2 ขึ้นไป' },
      ];

  let trs = '';
  rows.forEach(r => {
    trs += `
      <tr>
        <td style="border:1px solid #000; padding:6px 8px; font-family:'TH SarabunPSK',Sarabun; font-size:16pt; vertical-align:top; width:30%;">
          <strong>${r.dimension}</strong><br/>${escapeHtml(r.objective).replace(/\n/g, '<br/>')}
        </td>
        <td style="border:1px solid #000; padding:6px 8px; font-family:'TH SarabunPSK',Sarabun; font-size:16pt; vertical-align:top; width:24%;">
          ${escapeHtml(r.method).replace(/\n/g, '<br/>')}
        </td>
        <td style="border:1px solid #000; padding:6px 8px; font-family:'TH SarabunPSK',Sarabun; font-size:16pt; vertical-align:top; width:24%;">
          ${escapeHtml(r.tool).replace(/\n/g, '<br/>')}
        </td>
        <td style="border:1px solid #000; padding:6px 8px; font-family:'TH SarabunPSK',Sarabun; font-size:16pt; vertical-align:top; width:22%;">
          ${escapeHtml(r.criteria).replace(/\n/g, '<br/>')}
        </td>
      </tr>
    `;
  });

  return `
    <table border="1" style="border-collapse:collapse; width:100%; border:1px solid #000; margin:12px 0;">
      <thead>
        <tr style="background-color:#f1f5f9;">
          <th style="border:1px solid #000; padding:6px 8px; font-family:'TH SarabunPSK',Sarabun; font-size:16pt; text-align:center; width:30%;">จุดประสงค์การเรียนรู้</th>
          <th style="border:1px solid #000; padding:6px 8px; font-family:'TH SarabunPSK',Sarabun; font-size:16pt; text-align:center; width:24%;">วิธีการวัด</th>
          <th style="border:1px solid #000; padding:6px 8px; font-family:'TH SarabunPSK',Sarabun; font-size:16pt; text-align:center; width:24%;">เครื่องมือวัด</th>
          <th style="border:1px solid #000; padding:6px 8px; font-family:'TH SarabunPSK',Sarabun; font-size:16pt; text-align:center; width:22%;">เกณฑ์การวัด</th>
        </tr>
      </thead>
      <tbody>
        ${trs}
      </tbody>
    </table>
  `;
}

/**
 * แปลงกิจกรรมการเรียนรู้เป็น HTML ที่มี Indent และตัวหนาสำหรับ Word
 */
function formatActivitiesHtml(text: string): string {
  if (!text) return '<p style="padding-left: 24pt;">-</p>';
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  return lines.map(line => {
    const rawClean = line.replace(/^[\t\s#*-]+/, '').replace(/[*_]+$/, '').trim();
    const clean = escapeHtml(rawClean);
    if (/^[1-9]\.\s*ขั้น/.test(rawClean) || /^[1-9]\.\s+[^\d]/.test(rawClean)) {
      return `<p style="margin: 8pt 0 2pt 0; padding-left: 0; font-weight: bold; font-family: 'TH SarabunPSK', Sarabun; font-size: 16pt;">${clean}</p>`;
    } else if (/^[1-9]\.[0-9]+/.test(rawClean)) {
      return `<p style="margin: 2pt 0; padding-left: 24pt; font-family: 'TH SarabunPSK', Sarabun; font-size: 16pt;">${clean}</p>`;
    } else {
      return `<p style="margin: 2pt 0; padding-left: 24pt; font-family: 'TH SarabunPSK', Sarabun; font-size: 16pt;">${clean}</p>`;
    }
  }).join('\n');
}

/**
 * จัดรูปแบบกิจกรรมการเรียนรู้สำหรับ Plain Text (Tab สำหรับขั้น และ Tab Tab สำหรับกิจกรรมย่อย)
 */
function formatActivitiesPlainText(text: string): string {
  if (!text) return '-';
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  return lines.map(line => {
    const clean = line.replace(/^[\t\s#*-]+/, '').replace(/[*_]+$/, '').trim();
    if (/^[1-9]\.\s*ขั้น/.test(clean) || /^[1-9]\.\s+[^\d]/.test(clean)) {
      return clean;
    } else if (/^[1-9]\.[0-9]+/.test(clean)) {
      return `\t${clean}`;
    } else {
      return `\t${clean}`;
    }
  }).join('\n');
}

export function buildFullPlanHtml(data: LessonPlanData): string {
  const teacherName = data.teacher_name || '……………………………………………………';
  const teacherPos = data.teacher_position || 'ครูผู้ช่วย / ครู';
  const hoursDisplay = data.hours_text.includes('ชั่วโมง') || data.hours_text.includes('นาที')
    ? data.hours_text
    : `${data.hours_text} ชั่วโมง`;
  const formatText = (t: string) => escapeHtml(t).replace(/\n/g, '<br/>');

  const signDateStr = (data.date && data.month && data.buddhist_year)
    ? `วันที่ ${escapeHtml(data.date)} / ${escapeHtml(data.month)} / ${escapeHtml(data.buddhist_year)}`
    : 'วันที่ ............ / ............ / ............';

  const h = getHeaderDisplayValues(data);

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body, p, div, td, th { font-family: 'TH SarabunPSK', 'Sarabun', sans-serif; font-size: 16pt; line-height: 1.4; color: #000; }
  h1 { font-size: 20pt; font-weight: bold; text-align: center; margin: 0 0 4pt 0; }
  h2 { font-size: 16pt; font-weight: bold; margin: 12pt 0 4pt 0; }
  .center { text-align: center; }
  .divider { color: #888; text-align: center; margin: 6pt 0 12pt 0; }
  table { border-collapse: collapse; width: 100%; font-size: 16pt; }
</style>
</head>
<body>
  <h1>แผนจัดการเรียนรู้</h1>
  <table style="width:100%; border-collapse:collapse; border:none; margin:4pt 0 8pt 0;">
    <tr>
      <td style="border:none; padding:2pt 0; text-align:left; font-weight:bold; font-family:'TH SarabunPSK',Sarabun; font-size:16pt; width:62%;">
        ${escapeHtml(h.courseText)}
      </td>
      <td style="border:none; padding:2pt 0; text-align:right; font-weight:bold; font-family:'TH SarabunPSK',Sarabun; font-size:16pt; width:38%;">
        ${escapeHtml(h.gradeText)}
      </td>
    </tr>
    <tr>
      <td style="border:none; padding:2pt 0; text-align:left; font-weight:bold; font-family:'TH SarabunPSK',Sarabun; font-size:16pt;">
        ${escapeHtml(h.unitText)}
      </td>
      <td style="border:none; padding:2pt 0; text-align:right; font-family:'TH SarabunPSK',Sarabun; font-size:16pt;">
      </td>
    </tr>
    <tr>
      <td style="border:none; padding:2pt 0; text-align:left; font-weight:bold; font-family:'TH SarabunPSK',Sarabun; font-size:16pt;">
        ${escapeHtml(h.planText)}
      </td>
      <td style="border:none; padding:2pt 0; text-align:right; font-weight:bold; font-family:'TH SarabunPSK',Sarabun; font-size:16pt;">
        ${escapeHtml(h.hoursText)}
      </td>
    </tr>
    <tr>
      <td style="border:none; padding:2pt 0; text-align:left; font-weight:bold; font-family:'TH SarabunPSK',Sarabun; font-size:16pt;">
        ${escapeHtml(h.subjectText)}
      </td>
      <td style="border:none; padding:2pt 0; text-align:right; font-weight:bold; font-family:'TH SarabunPSK',Sarabun; font-size:16pt;">
        ${escapeHtml(h.semesterText)}
      </td>
    </tr>
    <tr>
      <td style="border:none; padding:2pt 0; text-align:left; font-family:'TH SarabunPSK',Sarabun; font-size:16pt;">
        ${escapeHtml(h.dateFullText)}
      </td>
      <td style="border:none; padding:2pt 0; text-align:right; font-family:'TH SarabunPSK',Sarabun; font-size:16pt;">
        ${escapeHtml(h.schoolText)}
      </td>
    </tr>
  </table>
  <p class="divider">……………………………………………………………………………………………………………………………………………………</p>

  <h2>1. มาตรฐานการเรียนรู้</h2>
  <p style="text-indent: 24pt;">${formatText(data.standards)}</p>

  <h2>2. ตัวชี้วัด</h2>
  <p style="text-indent: 24pt;">${formatText(data.indicators)}</p>

  <h2>3. สาระสำคัญ</h2>
  <p style="text-indent: 24pt;">${formatText(data.concept)}</p>

  <h2>4. จุดประสงค์รายวิชา</h2>
  <p><strong>ความรู้ (K):</strong></p>
  <p style="text-indent: 24pt;">${formatText(data.k_objective)}</p>
  <p><strong>ทักษะและกระบวนการ (P):</strong></p>
  <p style="text-indent: 24pt;">${formatText(data.p_objective)}</p>
  <p><strong>คุณลักษณะอันพึงประสงค์ (A):</strong></p>
  <p style="text-indent: 24pt;">${formatText(data.a_objective)}</p>

  <h2>5. สาระการเรียนรู้</h2>
  <p style="text-indent: 24pt;">${formatText(data.learning_content)}</p>

  <h2>6. สมรรถนะสำคัญของผู้เรียน</h2>
  <p style="text-indent: 24pt;">${formatText(data.competencies)}</p>

  <h2>7. กิจกรรมการเรียนรู้ (รูปแบบการสอนแบบ ${escapeHtml(data.teaching_model)})</h2>
  ${formatActivitiesHtml(data.activities)}

  <h2>8. สื่อและแหล่งการเรียนรู้</h2>
  <p style="text-indent: 24pt;">${formatText(data.media_resources)}</p>

  <h2>9. การวัดผลประเมินผล</h2>
  ${buildEvaluationHtmlTable(data)}

  <h2>10. กิจกรรมเสนอแนะ/งานที่มอบหมาย</h2>
  <p><strong>1. กิจกรรมเสนอแนะ</strong></p>
  <p style="text-indent: 24pt;">${formatText(data.suggestions)}</p>
  <p><strong>2. งานที่มอบหมาย</strong></p>
  <p style="text-indent: 24pt;">${formatText(data.assignments)}</p>

  <h2>11. บันทึกหลังกระบวนการจัดการเรียนรู้</h2>
  <p><strong>ผลการจัดการเรียนการสอน</strong></p>
  <p style="text-indent: 24pt; margin: 2pt 0;">นักเรียนจำนวน................คน</p>
  <p style="text-indent: 24pt; margin: 2pt 0;">ผ่านจุดประสงค์การเรียนรู้................คน&emsp;&emsp;&emsp;&emsp;คิดเป็นร้อยละ...............</p>
  <p style="text-indent: 24pt; margin: 2pt 0;">ไม่ผ่านจุดประสงค์การเรียนรู้................คน&emsp;&emsp;&emsp;&emsp;คิดเป็นร้อยละ...............</p>

  <p><strong>ด้านความรู้ (K)</strong></p>
  <p style="text-indent: 24pt; margin: 2pt 0;">............................................................................................................................................................................................................</p>

  <p><strong>ด้านทักษะและกระบวนการ (P)</strong></p>
  <p style="text-indent: 24pt; margin: 2pt 0;">............................................................................................................................................................................................................</p>

  <p><strong>ด้านคุณลักษณะอันพึงประสงค์ (A)</strong></p>
  <p style="text-indent: 24pt; margin: 2pt 0;">............................................................................................................................................................................................................</p>

  <p><strong>ปัญหา / อุปสรรค</strong></p>
  <p style="text-indent: 24pt; margin: 2pt 0;">............................................................................................................................................................................................................</p>

  <p><strong>ข้อเสนอแนะ / แนวทางแก้ไข</strong></p>
  <p style="text-indent: 24pt; margin: 2pt 0;">............................................................................................................................................................................................................</p>

  <!-- ตารางลงชื่อผู้เขียนแผน 4 แถว จัดกึ่งกลาง ชิดขวาสุด ไร้เส้น -->
  <table style="width:340px; margin-left:auto; margin-right:0; border:none; border-collapse:collapse; text-align:center; margin-top:20pt;">
    <tr>
      <td style="border:none; padding:3pt 0; text-align:center; font-family:'TH SarabunPSK',Sarabun; font-size:16pt;">
        ลงชื่อ.................................................................
      </td>
    </tr>
    <tr>
      <td style="border:none; padding:3pt 0; text-align:center; font-family:'TH SarabunPSK',Sarabun; font-size:16pt;">
        ( ${escapeHtml(teacherName)} )
      </td>
    </tr>
    <tr>
      <td style="border:none; padding:3pt 0; text-align:center; font-family:'TH SarabunPSK',Sarabun; font-size:16pt;">
        ตำแหน่ง ${escapeHtml(teacherPos)}
      </td>
    </tr>
    <tr>
      <td style="border:none; padding:3pt 0; text-align:center; font-family:'TH SarabunPSK',Sarabun; font-size:16pt;">
        ${signDateStr}
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * สร้าง Plain Text ทั้งแผนสำหรับ Clipboard สำรอง
 */
export function buildFullPlanPlainText(data: LessonPlanData): string {
  const teacherName = data.teacher_name || '……………………………………………………';
  const teacherPos = data.teacher_position || 'ครูผู้ช่วย / ครู';
  const hoursDisplay = data.hours_text.includes('ชั่วโมง') || data.hours_text.includes('นาที')
    ? data.hours_text
    : `${data.hours_text} ชั่วโมง`;

  const signDateStr = (data.date && data.month && data.buddhist_year)
    ? `วันที่ ${data.date} / ${data.month} / ${data.buddhist_year}`
    : 'วันที่ ............ / ............ / ............';

  let evalText = '9. การวัดผลประเมินผล:\n';
  (data.evaluation_rows || []).forEach(r => {
    evalText += `[${r.dimension}] จุดประสงค์: ${r.objective} | วิธีวัด: ${r.method} | เครื่องมือ: ${r.tool} | เกณฑ์: ${r.criteria}\n`;
  });

  const h = getHeaderDisplayValues(data);

  return `แผนจัดการเรียนรู้
${h.courseText}\t\t${h.gradeText}
${h.unitText}
${h.planText}\t\t${h.hoursText}
${h.subjectText}\t\t${h.semesterText}
${h.dateFullText}\t\t${h.schoolText}
……………………………………………………………………………………………………………………………………………………

1. มาตรฐานการเรียนรู้:
${data.standards}

2. ตัวชี้วัด:
${data.indicators}

3. สาระสำคัญ:
${data.concept}

4. จุดประสงค์รายวิชา:
ความรู้ (K):
${data.k_objective}
ทักษะและกระบวนการ (P):
${data.p_objective}
คุณลักษณะอันพึงประสงค์ (A):
${data.a_objective}

5. สาระการเรียนรู้:
${data.learning_content}

6. สมรรถนะสำคัญของผู้เรียน:
${data.competencies}

7. กิจกรรมการเรียนรู้ (รูปแบบการสอนแบบ ${data.teaching_model}):
${formatActivitiesPlainText(data.activities)}

8. สื่อและแหล่งการเรียนรู้:
${data.media_resources}

${evalText}
10. กิจกรรมเสนอแนะ/งานที่มอบหมาย:
1. กิจกรรมเสนอแนะ:
${data.suggestions}
2. งานที่มอบหมาย:
${data.assignments}

11. บันทึกหลังกระบวนการจัดการเรียนรู้:
ผลการจัดการเรียนการสอน
\tนักเรียนจำนวน................คน
\tผ่านจุดประสงค์การเรียนรู้................คน\tคิดเป็นร้อยละ...............
\tไม่ผ่านจุดประสงค์การเรียนรู้................คน\tคิดเป็นร้อยละ...............

ด้านความรู้ (K)
\t............................................................................................................................................................................................................
ด้านทักษะและกระบวนการ (P)
\t............................................................................................................................................................................................................
ด้านคุณลักษณะอันพึงประสงค์ (A)
\t............................................................................................................................................................................................................

ปัญหา / อุปสรรค
\t............................................................................................................................................................................................................
ข้อเสนอแนะ / แนวทางแก้ไข
\t............................................................................................................................................................................................................

\t\t\t\tลงชื่อ.................................................................
\t\t\t\t( ${teacherName} )
\t\t\t\tตำแหน่ง ${teacherPos}
\t\t\t\t${signDateStr}
`;
}

/**
 * คัดลอก Rich-Text ลง Clipboard (Word วางแล้วตารางและฟอนต์ไม่แตก)
 */
export async function copyRichText(html: string, plainText: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.ClipboardItem) {
      const blobHtml = new Blob([html], { type: 'text/html' });
      const blobText = new Blob([plainText], { type: 'text/plain' });
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': blobHtml,
          'text/plain': blobText,
        }),
      ]);
      return true;
    }
  } catch (_e) {
    // fallback
  }

  try {
    await navigator.clipboard.writeText(plainText);
    return true;
  } catch (_e) {
    return false;
  }
}

/**
 * ดึงข้อมูลเฉพาะหัวข้อสำหรับปุ่ม "📋 คัดลอกหัวข้อนี้"
 */
export function getSectionCopyContent(secNumber: number, data: LessonPlanData): { html: string; text: string } {
  const formatText = (t: string) => escapeHtml(t).replace(/\n/g, '<br/>');

  switch (secNumber) {
    case 1:
      return {
        html: `<h3>1. มาตรฐานการเรียนรู้</h3><p style="font-family:'TH SarabunPSK',Sarabun; font-size:16pt; text-indent:24pt;">${formatText(data.standards)}</p>`,
        text: `1. มาตรฐานการเรียนรู้\n${data.standards}`,
      };
    case 2:
      return {
        html: `<h3>2. ตัวชี้วัด</h3><p style="font-family:'TH SarabunPSK',Sarabun; font-size:16pt; text-indent:24pt;">${formatText(data.indicators)}</p>`,
        text: `2. ตัวชี้วัด\n${data.indicators}`,
      };
    case 3:
      return {
        html: `<h3>3. สาระสำคัญ</h3><p style="font-family:'TH SarabunPSK',Sarabun; font-size:16pt; text-indent:24pt;">${formatText(data.concept)}</p>`,
        text: `3. สาระสำคัญ\n${data.concept}`,
      };
    case 4:
      return {
        html: `
          <h3>4. จุดประสงค์รายวิชา</h3>
          <p><strong>ความรู้ (K):</strong><br/><span style="padding-left:24pt; display:inline-block;">${formatText(data.k_objective)}</span></p>
          <p><strong>ทักษะและกระบวนการ (P):</strong><br/><span style="padding-left:24pt; display:inline-block;">${formatText(data.p_objective)}</span></p>
          <p><strong>คุณลักษณะอันพึงประสงค์ (A):</strong><br/><span style="padding-left:24pt; display:inline-block;">${formatText(data.a_objective)}</span></p>
        `,
        text: `4. จุดประสงค์รายวิชา\nความรู้ (K):\n${data.k_objective}\nทักษะและกระบวนการ (P):\n${data.p_objective}\nคุณลักษณะอันพึงประสงค์ (A):\n${data.a_objective}`,
      };
    case 5:
      return {
        html: `<h3>5. สาระการเรียนรู้</h3><p style="font-family:'TH SarabunPSK',Sarabun; font-size:16pt; text-indent:24pt;">${formatText(data.learning_content)}</p>`,
        text: `5. สาระการเรียนรู้\n${data.learning_content}`,
      };
    case 6:
      return {
        html: `<h3>6. สมรรถนะสำคัญของผู้เรียน</h3><p style="font-family:'TH SarabunPSK',Sarabun; font-size:16pt; text-indent:24pt;">${formatText(data.competencies)}</p>`,
        text: `6. สมรรถนะสำคัญของผู้เรียน\n${data.competencies}`,
      };
    case 7:
      return {
        html: `<h3>7. กิจกรรมการเรียนรู้ (รูปแบบการสอนแบบ ${escapeHtml(data.teaching_model)})</h3>${formatActivitiesHtml(data.activities)}`,
        text: `7. กิจกรรมการเรียนรู้ (รูปแบบการสอนแบบ ${data.teaching_model})\n${formatActivitiesPlainText(data.activities)}`,
      };
    case 8:
      return {
        html: `<h3>8. สื่อและแหล่งการเรียนรู้</h3><p style="font-family:'TH SarabunPSK',Sarabun; font-size:16pt; text-indent:24pt;">${formatText(data.media_resources)}</p>`,
        text: `8. สื่อและแหล่งการเรียนรู้\n${data.media_resources}`,
      };
    case 9:
      return {
        html: `<h3>9. การวัดผลประเมินผล</h3>${buildEvaluationHtmlTable(data)}`,
        text: `9. การวัดผลประเมินผล\n` + (data.evaluation_rows || []).map(r => `[${r.dimension}] ${r.objective} | วิธีวัด: ${r.method} | เครื่องมือ: ${r.tool} | เกณฑ์: ${r.criteria}`).join('\n'),
      };
    case 10:
      return {
        html: `
          <h3>10. กิจกรรมเสนอแนะ/งานที่มอบหมาย</h3>
          <p><strong>1. กิจกรรมเสนอแนะ:</strong><br/><span style="padding-left:24pt; display:inline-block;">${formatText(data.suggestions)}</span></p>
          <p><strong>2. งานที่มอบหมาย:</strong><br/><span style="padding-left:24pt; display:inline-block;">${formatText(data.assignments)}</span></p>
        `,
        text: `10. กิจกรรมเสนอแนะ/งานที่มอบหมาย\n1. กิจกรรมเสนอแนะ: ${data.suggestions}\n2. งานที่มอบหมาย: ${data.assignments}`,
      };
    case 11:
      const teacherName = data.teacher_name || '……………………………………………………';
      const teacherPos = data.teacher_position || 'ครูผู้ช่วย / ครู';
      const signDateStr = (data.date && data.month && data.buddhist_year)
        ? `วันที่ ${escapeHtml(data.date)} / ${escapeHtml(data.month)} / ${escapeHtml(data.buddhist_year)}`
        : 'วันที่ ............ / ............ / ............';
      return {
        html: `
          <h3>11. บันทึกหลังกระบวนการจัดการเรียนรู้</h3>
          <p><strong>ผลการจัดการเรียนการสอน</strong></p>
          <p style="text-indent:24pt; font-size:16pt; margin:2pt 0;">นักเรียนจำนวน................คน</p>
          <p style="text-indent:24pt; font-size:16pt; margin:2pt 0;">ผ่านจุดประสงค์การเรียนรู้................คน&emsp;&emsp;&emsp;&emsp;คิดเป็นร้อยละ...............</p>
          <p style="text-indent:24pt; font-size:16pt; margin:2pt 0;">ไม่ผ่านจุดประสงค์การเรียนรู้................คน&emsp;&emsp;&emsp;&emsp;คิดเป็นร้อยละ...............</p>

          <p><strong>ด้านความรู้ (K)</strong></p>
          <p style="text-indent:24pt; font-size:16pt; margin:2pt 0;">............................................................................................................................................................................................................</p>

          <p><strong>ด้านทักษะและกระบวนการ (P)</strong></p>
          <p style="text-indent:24pt; font-size:16pt; margin:2pt 0;">............................................................................................................................................................................................................</p>

          <p><strong>ด้านคุณลักษณะอันพึงประสงค์ (A)</strong></p>
          <p style="text-indent:24pt; font-size:16pt; margin:2pt 0;">............................................................................................................................................................................................................</p>

          <p><strong>ปัญหา / อุปสรรค</strong></p>
          <p style="text-indent:24pt; font-size:16pt; margin:2pt 0;">............................................................................................................................................................................................................</p>

          <p><strong>ข้อเสนอแนะ / แนวทางแก้ไข</strong></p>
          <p style="text-indent:24pt; font-size:16pt; margin:2pt 0;">............................................................................................................................................................................................................</p>
          <table style="width:340px; margin-left:auto; margin-right:0; border:none; border-collapse:collapse; text-align:center; margin-top:16pt;">
            <tr><td style="border:none; padding:2pt 0; text-align:center; font-family:'TH SarabunPSK',Sarabun; font-size:16pt;">ลงชื่อ.................................................................</td></tr>
            <tr><td style="border:none; padding:2pt 0; text-align:center; font-family:'TH SarabunPSK',Sarabun; font-size:16pt;">( ${escapeHtml(teacherName)} )</td></tr>
            <tr><td style="border:none; padding:2pt 0; text-align:center; font-family:'TH SarabunPSK',Sarabun; font-size:16pt;">ตำแหน่ง ${escapeHtml(teacherPos)}</td></tr>
            <tr><td style="border:none; padding:2pt 0; text-align:center; font-family:'TH SarabunPSK',Sarabun; font-size:16pt;">${signDateStr}</td></tr>
          </table>
        `,
        text: `11. บันทึกหลังกระบวนการจัดการเรียนรู้\nผลการจัดการเรียนการสอน\n\tนักเรียนจำนวน................คน\n\tผ่านจุดประสงค์การเรียนรู้................คน\tคิดเป็นร้อยละ...............\n\tไม่ผ่านจุดประสงค์การเรียนรู้................คน\tคิดเป็นร้อยละ...............\n\nด้านความรู้ (K)\n\t............................................................................................................................................................................................................\nด้านทักษะและกระบวนการ (P)\n\t............................................................................................................................................................................................................\nด้านคุณลักษณะอันพึงประสงค์ (A)\n\t............................................................................................................................................................................................................\n\nปัญหา / อุปสรรค\n\t............................................................................................................................................................................................................\nข้อเสนอแนะ / แนวทางแก้ไข\n\t............................................................................................................................................................................................................\n\n\t\t\t\tลงชื่อ.................................................................\n\t\t\t\t( ${teacherName} )\n\t\t\t\tตำแหน่ง ${teacherPos}\n\t\t\t\t${signDateStr}`,
      };
    default:
      return { html: '', text: '' };
  }
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
