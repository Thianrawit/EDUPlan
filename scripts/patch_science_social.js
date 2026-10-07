import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { scienceStandards } from './data_science.js';
import { socialStandards } from './data_social.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const curriculumPath = path.join(__dirname, '..', 'public', 'data', 'curriculum.json');
const rawData = fs.readFileSync(curriculumPath, 'utf8');
const curriculum = JSON.parse(rawData);

// 1. กรองเอาเฉพาะ science และ social เดิมออก คงวิชาอื่นไว้ 100% (thai, math, english, art, health, career, physics, chemistry, biology, earth_astronomy)
const preservedStandards = curriculum.standards.filter(
  s => s.subjectId !== 'science' && s.subjectId !== 'social'
);

// 2. แทรกมาตรฐานวิทยาศาสตร์และเทคโนโลยี (10 มาตรฐาน) และสังคมศึกษาฯ (11 มาตรฐาน) ใหม่เข้าไป
curriculum.standards = [
  ...preservedStandards,
  ...scienceStandards,
  ...socialStandards
];

// 3. คำนวณนับ meta.totalIndicators และ meta.totalStandards ใหม่
let totalIndicators = 0;
const subjectCounts = {};

for (const std of curriculum.standards) {
  let stdIndCount = 0;
  if (std.gradeLevels) {
    for (const grade of Object.keys(std.gradeLevels)) {
      stdIndCount += std.gradeLevels[grade].length;
    }
  }
  totalIndicators += stdIndCount;
  subjectCounts[std.subjectId] = (subjectCounts[std.subjectId] || 0) + stdIndCount;
}

curriculum.meta.totalStandards = curriculum.standards.length;
curriculum.meta.totalIndicators = totalIndicators;
curriculum.meta.lastUpdated = new Date().toISOString();

// 4. บันทึกทับไฟล์เดิมด้วย UTF-8 Indent 2 ช่อง
fs.writeFileSync(curriculumPath, JSON.stringify(curriculum, null, 2), 'utf8');

console.log('✅ Patched Science and Social Studies curriculum standards successfully!');
console.log(`Total Standards: ${curriculum.meta.totalStandards}`);
console.log(`Total Indicators: ${curriculum.meta.totalIndicators}`);
console.log('\n📊 Indicators Summary by Subject:');
for (const [sub, count] of Object.entries(subjectCounts)) {
  console.log(` - ${sub}: ${count} indicators`);
}
