/**
 * EduPlan AI — Rubric Score Generator Exporter & Clipboard
 * ============================================================
 * จัดการสร้างเอกสาร Word (.docx) และ Rich-Text Clipboard สำหรับเกณฑ์รูบริกสกอร์
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
} from 'docx';
import { saveAs } from 'file-saver';
import type { RubricData } from './types';
import { getRubricScaleInfo } from './templates';
import { copyRichText } from './exporter';

const FONT_FAMILY = 'TH SarabunPSK';
const A4_WIDTH_DXA = 11906;
const A4_HEIGHT_DXA = 16838;
const MARGIN_1_INCH_DXA = 1440; // 1 inch
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
 * สร้างตารางเกณฑ์รูบริกสำหรับเอกสาร .docx
 */
export function createRubricDocxTable(data: RubricData): Table {
  const borderSpec = {
    style: BorderStyle.SINGLE,
    size: 1, // 0.5pt
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

  const scaleInfo = getRubricScaleInfo(data.levelCount);
  const numLevels = scaleInfo.keys.length;

  // รวม 9,000 DXA พอดีพิมพ์ A4 ขอบ 1 นิ้ว
  let aspectColWidth = 2600;
  const levelColWidth = Math.floor((CONTENT_WIDTH_DXA - aspectColWidth) / numLevels);
  aspectColWidth = CONTENT_WIDTH_DXA - (levelColWidth * numLevels);

  const columnWidths = [aspectColWidth, ...Array(numLevels).fill(levelColWidth)];

  // 1. Table Header Row
  const headerCells = [
    new TableCell({
      width: { size: aspectColWidth, type: WidthType.DXA },
      borders: tableBorders,
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 80, after: 80, line: 260 },
          children: [
            new TextRun({
              text: 'ประเด็นการประเมิน',
              font: FONT_FAMILY,
              size: 32, // 16pt
              bold: true,
            }),
          ],
        }),
      ],
    }),
    ...data.scaleLabels.map((lbl) => {
      return new TableCell({
        width: { size: levelColWidth, type: WidthType.DXA },
        borders: tableBorders,
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 80, after: 80, line: 260 },
            children: [
              new TextRun({
                text: lbl,
                font: FONT_FAMILY,
                size: 32, // 16pt
                bold: true,
              }),
            ],
          }),
        ],
      });
    }),
  ];

  const headerRow = new TableRow({
    tableHeader: true,
    children: headerCells,
  });

  // 2. Data Rows
  const bodyRows = data.criteria.map(crit => {
    const aspectParagraphs = [
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { before: 60, after: 40, line: 260 },
        children: [
          new TextRun({
            text: crit.aspect,
            font: FONT_FAMILY,
            size: 32,
            bold: true,
          }),
        ],
      }),
    ];

    if (crit.target) {
      aspectParagraphs.push(
        new Paragraph({
          alignment: AlignmentType.LEFT,
          spacing: { before: 20, after: 60, line: 240 },
          children: [
            new TextRun({
              text: crit.target,
              font: FONT_FAMILY,
              size: 28, // 14pt
              italics: true,
            }),
          ],
        })
      );
    }

    const rowCells = [
      new TableCell({
        width: { size: aspectColWidth, type: WidthType.DXA },
        borders: tableBorders,
        children: aspectParagraphs,
      }),
      ...scaleInfo.keys.map(k => {
        const descText = crit.descriptors[k] || '-';
        return new TableCell({
          width: { size: levelColWidth, type: WidthType.DXA },
          borders: tableBorders,
          children: [
            new Paragraph({
              alignment: AlignmentType.LEFT,
              spacing: { before: 60, after: 60, line: 260 },
              children: [
                new TextRun({
                  text: descText,
                  font: FONT_FAMILY,
                  size: 32,
                  bold: false,
                }),
              ],
            }),
          ],
        });
      }),
    ];

    return new TableRow({
      children: rowCells,
    });
  });

  return new Table({
    width: { size: CONTENT_WIDTH_DXA, type: WidthType.DXA },
    columnWidths,
    layout: TableLayoutType.FIXED,
    borders: tableBorders,
    rows: [headerRow, ...bodyRows],
  });
}

/**
 * สร้างตารางเกณฑ์การให้คะแนนแบบไร้เส้นขอบ (Invisible/Borderless Table) สำหรับ .docx
 */
export function createScoringGuideDocxTable(data: RubricData): Table {
  const scaleInfo = getRubricScaleInfo(data.levelCount);
  const GUIDE_WIDTHS = [2000, 1500, 5500]; // Total 9,000 DXA

  const titleRow = new TableRow({
    children: [
      new TableCell({
        width: { size: CONTENT_WIDTH_DXA, type: WidthType.DXA },
        columnSpan: 3,
        borders: noBorders,
        children: [
          new Paragraph({
            alignment: AlignmentType.LEFT,
            spacing: { before: 140, after: 40, line: 280 },
            children: [
              new TextRun({
                text: 'เกณฑ์การให้คะแนน',
                font: FONT_FAMILY,
                size: 32,
                bold: true,
              }),
            ],
          }),
        ],
      }),
    ],
  });

  const itemRows = scaleInfo.guideEntries.map(entry => {
    return new TableRow({
      children: [
        new TableCell({
          width: { size: GUIDE_WIDTHS[0], type: WidthType.DXA },
          borders: noBorders,
          children: [
            new Paragraph({
              alignment: AlignmentType.LEFT,
              indent: { left: convertInchesToTwip(0.3) },
              spacing: { before: 20, after: 20, line: 260 },
              children: [
                new TextRun({
                  text: `คะแนน ${entry.score}`,
                  font: FONT_FAMILY,
                  size: 32,
                }),
              ],
            }),
          ],
        }),
        new TableCell({
          width: { size: GUIDE_WIDTHS[1], type: WidthType.DXA },
          borders: noBorders,
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 20, after: 20, line: 260 },
              children: [
                new TextRun({
                  text: 'หมายถึง',
                  font: FONT_FAMILY,
                  size: 32,
                }),
              ],
            }),
          ],
        }),
        new TableCell({
          width: { size: GUIDE_WIDTHS[2], type: WidthType.DXA },
          borders: noBorders,
          children: [
            new Paragraph({
              alignment: AlignmentType.LEFT,
              spacing: { before: 20, after: 20, line: 260 },
              children: [
                new TextRun({
                  text: entry.label,
                  font: FONT_FAMILY,
                  size: 32,
                  bold: true,
                }),
              ],
            }),
          ],
        }),
      ],
    });
  });

  return new Table({
    width: { size: CONTENT_WIDTH_DXA, type: WidthType.DXA },
    columnWidths: GUIDE_WIDTHS,
    layout: TableLayoutType.FIXED,
    borders: noBorders,
    rows: [titleRow, ...itemRows],
  });
}

/**
 * ส่งออกไฟล์ Word (.docx) เกณฑ์รูบริกสกอร์ พร้อมจัดรูปแบบมาตรฐานราชการ
 */
export async function exportRubricToDocx(data: RubricData): Promise<void> {
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
              right: MARGIN_1_INCH_DXA,
              bottom: MARGIN_1_INCH_DXA,
              left: MARGIN_1_INCH_DXA,
            },
          },
        },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: 240, line: 280 },
            children: [
              new TextRun({
                text: data.title || 'เกณฑ์การประเมินการเรียนรู้ (Rubric Assessment)',
                font: FONT_FAMILY,
                size: 36, // 18pt
                bold: true,
              }),
            ],
          }),
          createRubricDocxTable(data),
          new Paragraph({
            spacing: { before: 120, after: 60, line: 260 },
            children: [],
          }),
          createScoringGuideDocxTable(data),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const cleanTitle = (data.title || 'Rubric_Assessment')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
    .substring(0, 50);
  saveAs(blob, `${cleanTitle}.docx`);
}

/**
 * สร้าง HTML สำหรับวางลงใน Microsoft Word ผ่าน Clipboard
 */
export function buildRubricClipboardHtml(data: RubricData): string {
  const scaleInfo = getRubricScaleInfo(data.levelCount);

  const headerCells = [
    '<th style="border: 1px solid #000; padding: 6px 8px; font-weight: bold; text-align: center; background-color: #f8fafc; width: 25%;">ประเด็นการประเมิน</th>',
    ...data.scaleLabels.map(lbl => `<th style="border: 1px solid #000; padding: 6px 8px; font-weight: bold; text-align: center; background-color: #f8fafc;">${escapeHtml(lbl)}</th>`),
  ].join('');

  const bodyRows = data.criteria.map(crit => {
    const targetHtml = crit.target ? `<br/><span style="font-size: 14pt; color: #475569; font-style: italic;">${escapeHtml(crit.target)}</span>` : '';
    const descCells = scaleInfo.keys.map(k => {
      const desc = crit.descriptors[k] || '-';
      return `<td style="border: 1px solid #000; padding: 6px 8px; vertical-align: top; text-align: left;">${escapeHtml(desc)}</td>`;
    }).join('');

    return `
      <tr>
        <td style="border: 1px solid #000; padding: 6px 8px; vertical-align: top; font-weight: bold; text-align: left;">
          ${escapeHtml(crit.aspect)}${targetHtml}
        </td>
        ${descCells}
      </tr>
    `;
  }).join('');

  const guideRows = scaleInfo.guideEntries.map(entry => {
    return `
      <tr>
        <td style="border: none; padding: 2px 8px; width: 120px;">คะแนน ${entry.score}</td>
        <td style="border: none; padding: 2px 8px; width: 80px; text-align: center;">หมายถึง</td>
        <td style="border: none; padding: 2px 8px; font-weight: bold;">${escapeHtml(entry.label)}</td>
      </tr>
    `;
  }).join('');

  return `
    <div style="font-family: 'TH SarabunPSK', 'TH Sarabun PSK', Sarabun, sans-serif; font-size: 16pt; color: #000;">
      <h2 style="text-align: center; font-size: 18pt; font-weight: bold; margin-bottom: 16px;">
        ${escapeHtml(data.title || 'เกณฑ์การประเมินการเรียนรู้ (Rubric Assessment)')}
      </h2>
      <table style="border-collapse: collapse; width: 100%; border: 1px solid #000; font-family: 'TH SarabunPSK', 'TH Sarabun PSK', Sarabun, sans-serif; font-size: 16pt;">
        <thead>
          <tr>${headerCells}</tr>
        </thead>
        <tbody>
          ${bodyRows}
        </tbody>
      </table>
      <div style="margin-top: 16px;">
        <p style="font-weight: bold; margin-bottom: 6px;">เกณฑ์การให้คะแนน</p>
        <table style="border-collapse: collapse; border: none; font-family: 'TH SarabunPSK', 'TH Sarabun PSK', Sarabun, sans-serif; font-size: 16pt; margin-left: 16px;">
          <tbody>
            ${guideRows}
          </tbody>
        </table>
      </div>
    </div>
  `.trim();
}

/**
 * สร้าง Plain Text สำหรับคัดลอกลง Clipboard
 */
export function buildRubricPlainText(data: RubricData): string {
  const scaleInfo = getRubricScaleInfo(data.levelCount);

  let text = `${data.title || 'เกณฑ์การประเมินการเรียนรู้ (Rubric Assessment)'}\n\n`;
  text += `ประเด็นการประเมิน\t${data.scaleLabels.join('\t')}\n`;

  data.criteria.forEach(crit => {
    const descList = scaleInfo.keys.map(k => crit.descriptors[k] || '-');
    const aspectText = crit.target ? `${crit.aspect} (${crit.target})` : crit.aspect;
    text += `${aspectText}\t${descList.join('\t')}\n`;
  });

  text += '\nเกณฑ์การให้คะแนน\n';
  scaleInfo.guideEntries.forEach(entry => {
    text += `  คะแนน ${entry.score}\tหมายถึง\t${entry.label}\n`;
  });

  return text;
}

/**
 * คัดลอกตารางรูบริกและเกณฑ์คะแนนเข้า Clipboard แบบ Rich-Text
 */
export async function copyRubricToClipboard(data: RubricData): Promise<boolean> {
  const html = buildRubricClipboardHtml(data);
  const plainText = buildRubricPlainText(data);
  return copyRichText(html, plainText);
}
