/**
 * EduPlan AI — Batch Lesson Plan Exporter (.zip & single .docx)
 * ============================================================
 * บีบอัดแผนการจัดการเรียนรู้ที่สร้างเสร็จแล้วทั้งหมดเป็นไฟล์ .zip เดียวด้วย PizZip
 * และรองรับการดาวน์โหลดแยกเป็นรายแผน (.docx) มาตรฐานราชการ 11 หัวข้อ
 * ============================================================
 */

import PizZip from 'pizzip';
import { saveAs } from 'file-saver';
import { generateLessonPlanDocxBlob } from './exporter';
import type { CourseStructureBatchJob, ExtractedPlanItem } from './structureParser';
import type { LessonPlanData } from './types';

/**
 * ทำความสะอาดชื่อไฟล์ให้ปลอดภัยบนทุกระบบปฏิบัติการ
 */
export function sanitizeFilename(name: string): string {
  return (name || 'แผนการสอน')
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 65) || 'แผนการสอน';
}

/**
 * ซิงก์ข้อมูลส่วนหัวล่าสุดจาก CourseStructureBatchJob เข้าสู่ LessonPlanData ของแต่ละแผนก่อนส่งออก
 */
export function syncPlanHeaderWithJob(plan: ExtractedPlanItem, job: CourseStructureBatchJob): LessonPlanData {
  const base = plan.generatedPlan!;
  const courseDisplay = [job.courseCode?.trim(), job.courseName?.trim()].filter(Boolean).join(' ');
  const teachingDateRaw = (job.teachingDate || '').trim();

  let datePart = base.date || '…………';
  let monthPart = base.month || '……………………';
  let byearPart = base.buddhist_year || job.academicYear || '…………';

  if (teachingDateRaw && !/^[.…_-\s]+$/.test(teachingDateRaw)) {
    const parts = teachingDateRaw.split(/[\s/]+/).filter(Boolean);
    if (parts.length >= 3) {
      datePart = parts[0];
      monthPart = parts[1];
      byearPart = parts[2];
    } else {
      datePart = teachingDateRaw;
      monthPart = '…………';
      byearPart = job.academicYear || base.buddhist_year || '…………';
    }
  } else {
    datePart = '…………';
    monthPart = '……………………';
    byearPart = job.academicYear || base.buddhist_year || '…………';
  }

  return {
    ...base,
    course_name: courseDisplay || base.course_name || job.courseName,
    subject: job.subjectGroup || base.subject,
    grade: job.grade || base.grade,
    unit: plan.unit || base.unit,
    plan_name: `แผนการจัดการเรียนรู้ที่ ${plan.planNumber} เรื่อง ${plan.topic}`,
    topic: plan.topic || base.topic,
    hours_text: `${plan.hours} ชั่วโมง`,
    semester: job.semester || base.semester || '1',
    year: job.academicYear || base.year,
    date: datePart,
    month: monthPart,
    buddhist_year: byearPart,
    school: job.schoolName || base.school || '……………………………………………',
    teacher_name: job.teacherName || base.teacher_name || '……………………………………………………',
    teacher_position: job.teacherPosition || base.teacher_position || 'ครู',
  };
}

/**
 * ดาวน์โหลดไฟล์ .docx ของแผนเดี่ยวในชุด
 */
export async function exportSingleBatchPlanDocx(
  job: CourseStructureBatchJob,
  plan: ExtractedPlanItem
): Promise<void> {
  if (!plan.generatedPlan) {
    throw new Error('ยังไม่มีข้อมูลแผนการสอนที่สร้างเสร็จสำหรับแผนนี้');
  }
  const syncedData = syncPlanHeaderWithJob(plan, job);
  const blob = await generateLessonPlanDocxBlob(syncedData);
  const numStr = String(plan.planNumber).padStart(2, '0');
  const fileName = `แผนที่_${numStr}_${sanitizeFilename(plan.topic)}.docx`;
  saveAs(blob, fileName);
}

/**
 * บีบอัดแผนทั้งหมดที่สร้างเสร็จแล้ว (status === 'completed') เป็นไฟล์ .zip เดียวและสั่งดาวน์โหลดทันที
 */
export async function exportBatchPlansAsZip(job: CourseStructureBatchJob): Promise<number> {
  const completedPlans = job.plans.filter(p => p.status === 'completed' && p.generatedPlan);
  if (completedPlans.length === 0) {
    throw new Error('ยังไม่มีแผนการจัดการเรียนรู้ที่สร้างเสร็จสมบูรณ์สำหรับดาวน์โหลด');
  }

  const zip = new PizZip();
  const usedNames = new Set<string>();

  for (const plan of completedPlans) {
    const syncedData = syncPlanHeaderWithJob(plan, job);
    const docxBlob = await generateLessonPlanDocxBlob(syncedData);
    const arrayBuffer = await docxBlob.arrayBuffer();

    const numStr = String(plan.planNumber).padStart(2, '0');
    let entryName = `แผนที่_${numStr}_${sanitizeFilename(plan.topic)}.docx`;
    if (usedNames.has(entryName)) {
      entryName = `แผนที่_${numStr}_${sanitizeFilename(plan.topic)}_${plan.id.slice(-4)}.docx`;
    }
    usedNames.add(entryName);

    zip.file(entryName, arrayBuffer);
  }

  const zipBlob = zip.generate({
    type: 'blob',
    mimeType: 'application/zip',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  const codePart = sanitizeFilename(job.courseCode || 'แผนการจัดการเรียนรู้');
  const namePart = sanitizeFilename(job.courseName || 'รายวิชา');
  const zipFileName = `${codePart}_${namePart}_รวม_${completedPlans.length}_แผน.zip`;
  saveAs(zipBlob, zipFileName);

  return completedPlans.length;
}
