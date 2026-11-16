# สรุปผลการพัฒนาระบบสร้างโครงการจัดการเรียนรู้ / แผนระยะยาว (ReviewIDE.md)
**EduPlan AI — Course Syllabus & Long-Term Plan Generator**

---

## 1. ภาพรวมการพัฒนา (System Overview)
ได้พัฒนาและติดตั้งโมดูลใหม่ **"ระบบสร้างโครงการจัดการเรียนรู้ / แผนระยะยาว (Course Syllabus & Long-Term Plan Generator)"** เข้าสู่ EduPlan AI ครบถ้วน 100% ตามข้อกำหนดใน `eduplan_ai_master_prompts.md` และดีไซน์ซิสเต็มใน `DESIGN.md`

โครงสร้างการทำงานถูกแบ่งเป็นสัดส่วนชัดเจน Clean Architecture:
1. **Data Model (`src/types.ts`)**: รองรับข้อมูลโครงการระยะยาวทั้ง 5 ส่วนมาตรฐาน
2. **AI Prompt Engine (`src/longTermTemplates.ts`)**: ระบบสร้างคำสั่ง Gemini, สังเคราะห์ K-P-A (Tier `kpa`), ประมวลผลสร้างแผน (Tier `fast` / `precision`), สั่ง AI Refine ปรับแก้โครงการภายหลัง และ Fallback Engine มาตรฐาน
3. **Document Exporter (`src/longTermExporter.ts`)**: เครื่องมือส่งออก Word (.docx) มาตรฐานราชการ 5 ส่วน ความกว้าง 9,000 DXA ฟอนต์ TH SarabunPSK พร้อมระบบแก้สระลอย/วรรคขาด (`cleanThaiText`) และสร้าง Rich-Text HTML สำหรับ Paste ลง Word ได้สมบูรณ์
4. **State Controller (`src/longTermModule.ts`)**: ตัวจัดการสถานะ Wizard 10 ขั้นตอน, คำนวณชั่วโมง/หน่วยกิตอัตโนมัติ, ระบบ Multi-select ตัวชี้วัดและวิธีสอน, การจัดเก็บ Draft ใน `localStorage`, การแสดงผลพรีวิว A4 เสมือนจริง (`contenteditable="true"`), กล่อง AI Refine และปุ่ม Export
5. **UI & Navigation (`index.html`, `src/main.ts`, `src/style.css`)**: ปรับหน้า Home เป็น 3 การ์ด (แผนการสอน, รูบริก, โครงการระยะยาว), การสลับ View, การรีเซ็ตข้อมูล และ `@media print` สำหรับพิมพ์ A4

---

## 2. การปฏิบัติตามกฎเหล็กและความปลอดภัย (Strict Constraints Verification)
- [x] **ไฟล์ `public/data/curriculum.json`**: ไม่ถูกแตะต้อง ลบ หรือแก้ไขโดยเด็ดขาด (100% Intact)
- [x] **โมดูลเดิมทั้งหมด**:
  - ระบบสร้างแผนการจัดการเรียนรู้ 11 หัวข้อ (ทั้งแบบ Wizard และ All-in-One Form) ทำงานได้ปกติ
  - ระบบวิเคราะห์และสร้างเกณฑ์รูบริกสกอร์ (.docx Upload) ทำงานได้สมบูรณ์
  - ระบบ Bring Your Own Key (BYOK) บันทึกลง `localStorage` ทำงานปกติ
  - หน้าต่าง Admin Management ลับ (SHA-256 Hash: `09032547`) เชื่อมต่อ Cloudflare KV (`CONFIG_KV`) ยังคงอยู่และทำงานได้สมบูรณ์
  - ระบบวิจัย Telemetry ส่งข้อมูลตามมาตรฐานเดิม
- [x] **การรันคำสั่งในระบบ Windows**: ใช้ `npm.cmd` ในการทดสอบและ Build ทั้งหมด

---

## 3. รายละเอียดการสร้างและแก้ไขไฟล์ (File Implementations)

### 3.1 `src/types.ts`
เพิ่ม Data Interfaces ที่เกี่ยวข้อง:
- `UnitBriefInput`: ข้อมูลย่อยรายหน่วย (หน่วยที่, ชื่อหน่วย, หัวข้อที่สอน, ชั่วโมง)
- `LongTermPlanInput`: พารามิเตอร์ Input 10 ขั้นตอนจากผู้ใช้
- `LongTermUnitRow`: โครงสร้างตารางหน่วยการเรียนรู้ 6 คอลัมน์
- `WeeklyPlanRow`: โครงสร้างตารางแผนรายสัปดาห์ 8 คอลัมน์ (รองรับแถวคั่น `planGroupTitle` colspan=8)
- `ScoringMethodRow`: โครงสร้างวิธีจัดเก็บคะแนน (ระหว่างเรียน 80 / ปลายภาค 20 รวม 100)
- `LongTermPlanData`: โครงสร้างข้อมูลโครงการจัดการเรียนรู้ฉบับสมบูรณ์ 5 ส่วน

### 3.2 `src/longTermTemplates.ts` (สร้างใหม่)
- `buildLongTermSystemInstruction()`: กำหนดบทบาท AI เป็นผู้เชี่ยวชาญการออกแบบหลักสูตรและการสอนตามมาตรฐานกระทรวงศึกษาธิการ
- `buildLongTermPlanPrompt(inputs)`: สังเคราะห์ Prompt ที่บังคับ JSON Schema ครบถ้วนทั้ง 5 ส่วน
- `buildLongTermKPAPrompt(inputs)`: วิเคราะห์ K-P-A อย่างสั้นกระชับสำหรับปุ่ม AI Draft ในขั้นตอนที่ 6
- `buildLongTermRefinePrompt(currentData, instruction)`: รองรับคำสั่งปรับแก้เพิ่มเติมจากผู้ใช้ เช่น ปรับสัดส่วนคะแนน หรือเพิ่มกิจกรรม
- `parseLongTermPlanResponse(jsonText, inputs)`: ป้องกัน JSON หลุดด้วย Sanitization และ Regex Fallback
- `generateStandardLongTermPlan(inputs)`: Fallback Engine กรณีเกิดเหตุขัดข้องทางเครือข่าย AI ช่วยสร้างโครงสร้างโครงการมาตรฐานให้ผู้ใช้ทันที ไม่มีการค้างหรือ Error

### 3.3 `src/longTermExporter.ts` (สร้างใหม่)
- **สร้างไฟล์ Word (.docx)** ตามแบบ `โครงการจัดการเรียนรู้_Template.docx`:
  1. *ส่วนที่ 1: คำอธิบายรายวิชา* (Header Table 3x2 ไร้เส้นขอบ, เนื้อหา 2 ย่อหน้า, รายการตัวชี้วัด, จุดประสงค์ K-P-A)
  2. *ส่วนที่ 2: โครงสร้างโครงการจัดการเรียนรู้ระยะยาว* (Header Table 3x2 ไร้เส้นขอบ, ตาราง 6 คอลัมน์ 9,000 DXA มีแถวปฐมนิเทศ, แถวหน่วย 1..N, จิตพิสัย, สอบปลายภาค, แถวรวมสุทธิ 100 คะแนน)
  3. *ส่วนที่ 3: ตารางแผนการจัดการเรียนรู้รายสัปดาห์* (ตาราง 8 คอลัมน์ 9,000 DXA พร้อมแถวคั่นแผนการจัดการเรียนรู้ colspan=8 สีพื้น `#F1F5F9`)
  4. *ส่วนที่ 4: ตารางวิธีจัดเก็บคะแนน* (ตาราง 3 คอลัมน์ แบ่งหมวดระหว่างเรียน 80 คะแนน และปลายภาค 20 คะแนน รวม 100 คะแนน)
  5. *ส่วนที่ 5: ตารางเกณฑ์การตัดสินผลการเรียน* (ตาราง 2 คอลัมน์ เกรด 4 ถึง 0, ร, มส)
- **ป้องกันปัญหาฟอนต์ไทยและวรรณยุกต์ลอย**:
  - กำหนด `THAI_FONT = { name: 'TH SarabunPSK', cs: 'TH SarabunPSK' }`
  - กำหนด `THAI_LANG = { value: 'th-TH', bidi: 'th-TH' }`
  - กรองทุกข้อความผ่าน `cleanThaiText()` ซึ่งรัน `normalize('NFC')` และลบอักขระ Zero-Width (`\u200B-\u200D\uFEFF`)
- **Clipboard & Rich-Text**: ฟังก์ชัน `copyLongTermRichText()` สำหรับคัดลอกลง Clipboard ไปวางใน Microsoft Word ได้ตาราง เส้นขอบ และฟอนต์ TH SarabunPSK ทันที

### 3.4 `src/longTermModule.ts` (สร้างใหม่ & อัปเดต UI/UX)
- ควบคุมโฟลว์ Wizard 10 ขั้นตอน
- หน้าพรีวิวเสมือนจริง A4 Paper Card (`contenteditable="true"` แก้ไขได้ทุกจุด)
- กล่องสั่ง AI Refine ปรับแต่งโครงการเพิ่มเติม
- บันทึกและกู้คืนร่างผ่าน `localStorage` คีย์ `eduplan_longterm_draft`

---

## 4. รายละเอียดการปรับปรุงตามฟีดแบ็กล่าสุด (Latest Refinements)
1. **การเลือกกลุ่มสาระการเรียนรู้แบบการ์ด (Card-based Subject Selector)**:
   - เปลี่ยนจาก Dropdown `<select>` ใน Step 2 เป็น Grid การ์ด 9 กลุ่มสาระ (`.lt-subject-card`) ในรูปแบบเดียวกับหน้าสร้างแผนการสอน
   - แสดงสถานะ Active Highlight พร้อมผูกอัปเดตข้อมูลและ Refresh ตัวชี้วัดอัตโนมัติ
2. **การเลือกมาตรฐานและตัวชี้วัดผ่าน Popup Drawer (Standard Cards & Indicator Popup)**:
   - ปรับ Step 5 ให้แสดงการ์ดมาตรฐาน (`.lt-standard-card`) ใน Grid 2 คอลัมน์
   - คลิกการ์ดมาตรฐานเพื่อเปิด Popup Modal Drawer (`#lt-indicator-modal-overlay`) แสดงรายการตัวชี้วัดพร้อม Checkbox
   - มีปุ่มยกเลิกตัวชี้วัดของมาตรฐานนั้น และปุ่มบันทึก "เรียบร้อย"
   - แสดง Badge จำนวนตัวชี้วัดที่เลือกบนตัวการ์ดมาตรฐาน (`เลือกแล้ว X ข้อ`) ทันที
3. **เปลี่ยนมาใช้ Vector SVG แทนอีโมจิ (Vector Icons Everywhere)**:
   - การ์ดนำทางทั้ง 3 บนหน้าแรก (Home Hub)
   - การ์ดวิธีการจัดการเรียนรู้ใน Step 7 (Active Learning, PBL, 5E, STEM, Design Thinking ฯลฯ)
   - การ์ดวิธีจัดเก็บคะแนนใน Step 8 (แบบทดสอบ, ภาระงาน, ชิ้นงาน, สังเกตพฤติกรรม ฯลฯ)
   - ปุ่มคำสั่ง Fast Mode, Precision Mode, AI Refine, คัดลอก Word, พิมพ์ PDF และปุ่มนำทางย้อนกลับ/ถัดไป
4. **แสดงชื่อขั้นตอนใน Title หลัก (Step Title Prominence)**:
   - ปรับหัวของ Wizard ให้แสดงชื่อขั้นตอนหลักและคำอธิบายย่อยอย่างโดดเด่น (`#lt-wizard-step-title` และ `#lt-wizard-step-subtitle`)
   - อัปเดตเปลี่ยนชื่อขั้นตอนและคำแนะนำอัตโนมัติตาม Step 1 ถึง 10
5. **ย้ายจุดไข่ปลา / แถบความคืบหน้ามาไว้ด้านล่าง (Bottom Progress Dots)**:
   - ย้ายจุดนำทางไข่ปลา 10 จุด (`.lt-wizard-dot`) และตัวนับสเต็ป (`#lt-wizard-step-counter`) ลงมาอยู่ด้านล่างสุดของฟอร์ม ติดกับปุ่ม [ ย้อนกลับ ] และ [ ถัดไป ]

---

## 5. ผลการทดสอบ (Verification Results)
- **TypeScript & Production Build**:
  - รันคำสั่ง `npm.cmd run build` สำเร็จ 100% (Exit Code: 0)
  - ไม่มีข้อผิดพลาด TypeScript (`tsc`)
- **Data Integrity**:
  - ตรวจสอบผ่าน `git status` ไฟล์ `public/data/curriculum.json` ไม่มีการเปลี่ยนแปลง 100%

---

## 6. รายละเอียดการแก้ไขเพิ่มเติม 4 รายการสำคัญ (Latest Bugfixes & Layout Enhancements)

### 6.1 กำจัดแท็ก `#lt-preview-content` ที่แสดงค้างทุกหน้า
- **สาเหตุ**: มีบล็อก `<div id="lt-preview-content">` เกินมานอกแท็กปิด `</section>` ของ `#longterm-section` (ใน `index.html`) ทำให้อยู่ตรงระดับ `<main>` ซึ่งไม่ถูกซ่อนเมื่อสลับไปหน้าอื่น (Home, Lesson Plan, Rubric)
- **การแก้ไข**: ลบโค้ดแท็กซ้ำดังกล่าวออกทั้งหมด ตรวจสอบพบว่าเหลือ `#lt-preview-content` เพียงจุดเดียวในระบบภายใน `#longterm-section` เรียบร้อยแล้ว

### 6.2 แสดงหน้าพรีวิว A4 ต่อท้ายด้านล่างของ Wizard Form ทันทีที่สั่งเจน
- **การแก้ไข**: 
  - ปรับปรุงฟังก์ชัน `switchView` ใน `src/longTermModule.ts` โดยไม่ซ่อน `#lt-wizard-view` แต่เปิดการแสดงผล `#lt-preview-view` ต่อท้ายด้านล่าง
  - เมื่อสั่งสร้างเสร็จ ระบบจะเรียก `scrollIntoView({ behavior: 'smooth', block: 'start' })` เลื่อนหน้าจอลงมายังพรีวิว A4 ด้านล่างอย่างนุ่มนวล
  - เพิ่มเส้นประคั่น `border-t-2 border-dashed border-emerald-300 pt-8` แยกส่วน Wizard และพรีวิวชัดเจน
  - ปรับปุ่มเครื่องมือเป็น "เลื่อนขึ้นไปแก้ไขข้อมูล" พร้อมไอคอนลูกศรชี้ขึ้น ให้ผู้ใช้เลื่อนจอกลับขึ้นไปปรับข้อมูลด้านบนได้สะดวก

### 6.3 แก้ไขการสังเคราะห์ชื่อหน่วยการเรียนรู้ (ตัด "ตอนที่ 1 / ตอนที่ 2" ออก 100%)
- **สาเหตุ**: ใน `src/longTermTemplates.ts` ฟังก์ชันเดิมมี Fallback hardcoded คำว่า `หน่วยที่ ${i} เรื่อง ${input.courseName} เบื้องต้น (ตอนที่ ${i})` และ `(กิจกรรมที่ ${...})`
- **การแก้ไข**:
  1. เพิ่มกฎเหล็กและคำสั่งเชิงลึกใน `buildLongTermSystemInstruction` และ `buildLongTermPlanPrompt` ห้ามคำว่า "(ตอนที่ 1)", "(ตอนที่ 2)", "(พาร์ท 1)" หรือการนำชื่อวิชามาต่อท้ายด้วย ตอนที่... เด็ดขาด
  2. สั่งให้ AI วิเคราะห์จากคำอธิบายภาพรวมโครงการ (`courseOverviewPrompt`), ชื่อรายวิชา (`courseName`) และมาตรฐาน/ตัวชี้วัด เพื่อสังเคราะห์ชื่อหน่วยเฉพาะทางวิชาการ (เช่น หลักการสำคัญและการคิดเชิงออกแบบ, กระบวนการสร้างสรรค์ชิ้นงาน, การแก้ปัญหาและประยุกต์ใช้)
  3. ปรับปรุง Fallback Engine (`generateDefaultUnitRows` และ `generateDefaultWeeklyRows`) ให้ดึงหัวข้อจากภาพรวมโครงการมาตั้งเป็นชื่อหน่วย หรือใช้ลำดับขั้นการเรียนรู้เชิงวิชาการมาตรฐานไทย (Pedagogical Progression) และสังเคราะห์กิจกรรมรายสัปดาห์ตามเฟสการเรียนรู้จริง
  4. เพิ่มฟังก์ชัน `tryRepairTruncatedJSON` ใน `parseLongTermPlanResponse` ช่วยซ่อมแซม JSON กรณีเกิดการตัดทอน ป้องกันการตกไปใช้ Fallback โดยไม่จำเป็น
  5. เสริมระบบ Sanitization ล้างคำว่า "ตอนที่ \d+" ออกจากทั้งชื่อหน่วยและหัวข้อรายสัปดาห์อัตโนมัติ

### 6.4 แก้ไขปัญหาการพิมพ์ PDF / Print ตัดตกขอบ (Clipped Print Margins)
- **สาเหตุ**:
  1. `.a4-paper table` เดิมถูกตั้ง `page-break-inside: avoid` ทำให้ตาราง 20 สัปดาห์ซึ่งยาวเกิน 1 หน้า A4 ไม่สามารถตัดแบ่งหน้าได้และถูกขอบล่างของกระดาษตัดทิ้ง
  2. คอนเทนเนอร์ `#lt-preview-content` ติด `min-w-[750px]` และ `.overflow-x-auto` ซึ่งกว้างเกินความกว้างพิมพ์ได้ของ A4 Portrait (ประมาณ 175-185 มม.) ทำให้ขอบขวาของตาราง 8 คอลัมน์ถูกตัดขาด
  3. สไตล์ Print เดิมบังคับ `#preview-section { display: block !important }` ทำให้เกิดการทับซ้อนกับหน้าแผนการสอนเดิม
- **การแก้ไขใน `src/style.css` (`@media print`)**:
  - เปลี่ยนตารางเป็น `page-break-inside: auto !important` และให้แถว `tr` เป็น `page-break-inside: avoid !important` ช่วยให้เนื้อหาแบ่งหน้าได้ตามความสูงกระดาษ A4 อย่างสมบูรณ์
  - กำหนด `thead { display: table-header-group !important }` ให้หัวตารางวนซ้ำอัตโนมัติทุกหน้าที่แบ่ง
  - บังคับ `#lt-preview-content`, `.a4-paper`, `.a4-sheet` ให้มี `min-width: 0 !important; width: 100% !important; max-width: 100% !important;`
  - ปรับความกว้างตารางเป็น `table-layout: fixed !important; width: 100% !important;` พร้อมตั้ง `word-break: break-word !important;` ขนาดฟอนต์ 10pt และ Padding 2.5pt 3.5pt ให้คอลัมน์ทั้ง 8 พอดีกับหน้ากระดาษ
  - ตั้งระยะขอบหน้ากระดาษ `@page { size: A4 portrait; margin: 1.2cm 1cm 1.2cm 1.5cm; }` มาตรฐานงานพิมพ์ราชการไทย
  - ป้องกันการพิมพ์ชนกันโดยสั่ง `#preview-section.hidden { display: none !important }` อย่างเคร่งครัด

---

## 7. รายละเอียดการแก้ไขระบบคัดลอก Word และจัดสไตล์ A4 Sarabun 16pt (Word Fidelity & Complete Clipboard Fix)

### 7.1 แก้ไขปุ่ม "คัดลอกทั้งแผน (สำหรับ Word)" ได้ข้อความไม่ครบ
- **สาเหตุของปัญหา**:
  1. ใน `generateLongTermPlainText` เดิมเขียนโค้ดไว้เฉพาะ "ส่วนที่ 1: คำอธิบายรายวิชา" เท่านั้น ขาดส่วนที่ 2, 3, 4, 5 ทั้งหมด ทำให้เมื่อแอปปลายทางหรือการ Paste ดึงฟอร์แมต Plain text ข้อมูลจึงหายไปกว่า 80%
  2. โค้ด HTML เดิมใน `generateLongTermRichTextHtml` ขาด Inline Font Style (TH SarabunPSK 16pt) ในแท็กต่างๆ และไม่มี `<!--StartFragment-->` กับ `<!--EndFragment-->` ทำให้ Word บน Windows ตีความเอกสารผิดพลาดและตัดทอนตาราง
  3. ฟังก์ชัน `getPlanDataFromDOM` เดิมอ่านข้อมูลกลับมาเฉพาะคำอธิบายและหน่วย ไม่ได้อ่านตัวชี้วัด, ตารางรายสัปดาห์ และวิธีเก็บคะแนนที่มีการแก้ไขใน DOM กลับมา
  4. ตัว Fallback ของคลิปบอร์ดเดิมสร้าง div หลุดจอพิกัด `-9999px` ซึ่งเบราว์เซอร์ยุคใหม่บล็อกการคัดลอกจากเอลิเมนต์ที่อยู่นอกจอ
- **การแก้ไขใน `src/longTermExporter.ts` และ `src/longTermModule.ts`**:
  - อัปเดต `generateLongTermPlainText` ให้มีข้อมูลครบถ้วน 100% ทั้ง 5 ส่วน โดยจัดตารางด้วย Tab-Separated Values (`\t`) ที่ Microsoft Word และ Excel แปลงเป็นตารางได้ทันที
  - อัปเดต `generateLongTermRichTextHtml` ฝัง Inline CSS สไตล์ฟอนต์ TH SarabunPSK 16pt บนทุกเอลิเมนต์ พร้อมเส้นขอบตาราง `border="1"` สีดำสนิท และตัวแบ่งหน้า `mso-break-type: section-break` ครอบด้วย `<!--StartFragment-->...<!--EndFragment-->`
  - ปรับระบบคัดลอก `copyLongTermRichText` เป็น 3 ระดับ (3-Tier Strategy):
    1. Async Clipboard API ส่ง Blob ทั้ง `text/html` และ `text/plain`
    2. หาก API หลักล้มเหลว จะสลับไปใช้ **Live DOM Selection Copy** คัดลอกจากกล่อง `#lt-preview-content` บนหน้าจอจริงโดยตรง ได้ทั้งโครงสร้างตารางและตัวหนังสือ 100%
    3. หากเบราว์เซอร์ไม่อนุญาต จะใช้ `navigator.clipboard.writeText(plain)` สำรอง
  - อัปเดต `getPlanDataFromDOM` ให้อ่านกลับข้อมูลครบถ้วนทุกส่วน ทั้งย่อหน้า, ตัวชี้วัด, ตารางหน่วย, ตารางรายสัปดาห์ 8 คอลัมน์ และวิธีจัดเก็บคะแนน

### 7.2 ปรับแต่ง `#lt-preview-content` เป็นขนาด 16pt เสมือนเปิดไฟล์ Microsoft Word จริง
- **การแก้ไขใน `src/style.css`, `src/longTermModule.ts` และ `index.html`**:
  - บังคับฟอนต์ `TH SarabunPSK` ขนาด `16pt !important` ครอบคลุมทุกเอลิเมนต์ใน `#lt-preview-content` (ข้อความเนื้อหา, ย่อหน้า, รายการตัวชี้วัด, เซลล์ตารางทุกตาราง)
  - กำหนดหัวข้อใหญ่ `h1` เป็น 18pt หนาตรงกลาง และหัวข้อย่อย `h2` เป็น 16pt หนา
  - ลบคลาส Tailwind ที่ย่อขนาดตัวอักษร เช่น `text-sm`, `text-xs` ออกจากตารางทั้งหมด ให้ตัวหนังสือคมชัดขนาด 16pt เท่ากับ Word จริง
  - ปรับเส้นขอบตารางเป็นสีดำสนิท `1px solid #000000` หัวตารางพื้นหลังสีเทาอ่อน `#f2f2f2` แบบตารางทางการใน Microsoft Word
  - เพิ่มเส้นแบ่งหน้าเอกสาร `.word-page-break` (`─── ตัวแบ่งหน้า (Page Break) ───`) จำลองการแบ่งหน้า A4 ของ Word
  - ปรับกรอบ A4 Sheet ให้มีมาร์จิ้นภายในมาตรฐาน Word (2.5cm / 2cm) พร้อมเงาตกกระทบแบบเอกสารจริง

---

## 8. การเปลี่ยนไอคอนหลักและการเปลี่ยนผ่านสู่อีโมจิเป็น Vector SVG (Heroicons Migration)

### 8.1 การติดตั้ง Primary Website Icon
- เปลี่ยน Favicon ในแท็ก `<head>` ของ `index.html` ให้ชี้ไปยัง `./icons/icon.png` (`<link rel="icon" type="image/png" href="./icons/icon.png">`)
- เปลี่ยนไอคอน Brand Logo ด้านบนซ้ายของ Navbar จากกล่องสีน้ำเงินข้อความ "EP" เดิม มาเป็นโลโก้ภาพจริง `<img src="./icons/icon.png" alt="EduPlan AI" class="w-9 h-9 rounded-xl shadow-xs object-cover" />`

### 8.2 การแปลง Emoji ทั้งหมดเป็น Vector SVG (Heroicons & Clean UI)
ได้ทำการค้นหาและแทนที่ Emoji ทั้งหมดในโปรเจกต์ด้วย Heroicons SVG Vector และ Clean UI Indicators:
1. **หน้าหลัก & การ์ดระบบ (`index.html`)**:
   - `✨` (Hero Badge) → Heroicons `sparkles`
   - `✓` (Checklist ฟีเจอร์ในการ์ด 1, 2, 3) → Heroicons `check` (สีเขียว emerald และสีม่วง purple)
2. **ปุ่มสร้างแผนและโหมดประมวลผล (`index.html`)**:
   - `⚡` (โหมดด่วน) → Heroicons `bolt` SVG
   - `🎯` (โหมดละเอียด วPA) → Heroicons `sparkles` SVG
3. **ระบบพรีวิวและคัดลอกแผน (`index.html`, `src/main.ts`)**:
   - `📋` (ปุ่มคัดลอกทั้งแผน) → Heroicons `clipboard-document` SVG
   - `📋 คัดลอกหัวข้อนี้` (11 หัวข้อในแผนการสอน) → Heroicons `clipboard-document` SVG พร้อมข้อความ
4. **โมดูลรูบริกสกอร์ (`index.html`, `src/main.ts`)**:
   - `📊` (Rubric Tag) → Heroicons `chart-bar` SVG
   - `✓` (Radio Dot 4 ระดับ) → Heroicons `check` SVG ในวงกลมสีม่วง
   - `📄` (Dropzone อัปโหลด) → Heroicons `document-arrow-up` SVG
   - `✓` (กล่องไฟล์ที่เลือก) → Heroicons `check` SVG
   - `ℹ️` (กล่องคำแนะนำ) → Heroicons `information-circle` SVG
   - `⚡` (ปุ่มสร้างรูบริก) → Heroicons `bolt` SVG
   - `📋` (ปุ่มคัดลอกตาราง) → Heroicons `clipboard-document` SVG
   - `💾` (ปุ่มดาวน์โหลด .docx) → Heroicons `arrow-down-tray` SVG
5. **หน้าต่างโมดอล & ระบบตั้งค่า (`index.html`, `src/main.ts`)**:
   - `✕` (ปุ่มปิด Modal ทุกหน้าต่าง: Indicator, Settings, Admin) → Heroicons `x-mark` SVG
   - `⚙️` (หัวข้อ Settings & Admin) → Heroicons `cog-6-tooth` SVG
   - `💡` (หัวข้อ Step Carousel) → Heroicons `light-bulb` SVG
   - `↗️` (ลิงก์ AI Studio) → Heroicons `arrow-top-right-on-square` SVG
   - `เสร็จสิ้น ✓` (ปุ่มจบคารูเซล) → ข้อความ "เสร็จสิ้น" พร้อม Heroicons `check` SVG
   - `🟢`, `🟡`, `🔴` (Status Badges ของ BYOK & Admin) → แปลงเป็น CSS Dot Indicators (`w-2 h-2 rounded-full`) สีเขียว/ส้ม/แดง สะอาดตาสไตล์โมเดิร์น
   - `🔄` (ปุ่มคืนค่าเริ่มต้น Worker) → Heroicons `arrow-path` SVG
   - `💾` (ปุ่มบันทึกระบบ Admin) → Heroicons `check` SVG
   - `🎯` (ปุ่ม/ไอคอน Precision Quota Modal) → Heroicons `sparkles` SVG
   - `⚠️` (ไอคอน Error Retry Modal) → Heroicons `exclamation-triangle` SVG
   - `🔄` (ปุ่มลองใหม่อีกครั้ง) → Heroicons `arrow-path` SVG
   - `⏱️` (Stopwatch หน้า Loading) → Heroicons `clock` SVG พร้อมแอนิเมชันหมุน
6. **โมดูลโครงการจัดการเรียนรู้ (`src/longTermModule.ts`)**:
   - `➖` / `➕` (ปุ่ม Toggle รายละเอียดแยกหน่วย) → Heroicons minus / plus SVG
   - `⚡` (ปุ่ม AI ร่างจุดประสงค์ K-P-A) → Heroicons `bolt` SVG พร้อม Spinner หมุนขณะกำลังประมวลผล
7. **Gemini Service (`src/gemini.ts`)**:
   - ถอดรหัส Emoji ออกจากข้อความสถานะคงเหลือเฉพาะข้อความทางการ
8. **ความปลอดภัยของฐานข้อมูล**:
   - ตรวจสอบ `git status` ยืนยันไฟล์ `public/data/curriculum.json` ไม่ถูกแตะต้อง 100%
   - ทดสอบ Build ด้วย `npm.cmd run build` ผ่านสมบูรณ์ไม่มี Error



---

## 9. การพัฒนาระบบจัดการห้องเรียน (EDUPLAN Classroom — Standalone Page)

### 9.1 การปฏิบัติตามกฎเหล็กด้านขอบเขตงาน (Critical Isolation Verification)
- [x] **ไม่แตะต้องไฟล์เดิมของโปรเจกต์ `EDUPLAN`**: ไม่ได้แก้ไขหรือลบ `index.html`, `src/main.ts`, `src/style.css`, `src/config.ts`, `src/gemini.ts`, `src/types.ts`, `src/templates.ts`, `src/exporter.ts`, `src/rubricExporter.ts`, `src/longTermExporter.ts`, `vite.config.ts` และ `public/data/curriculum.json` โดยเด็ดขาด
- [x] **ไม่สร้างปุ่มหรือลิงก์เชื่อมจาก `index.html`**: แยกเป็นหน้า Standalone อิสระที่ `classroom.html` (`http://localhost:5173/classroom.html`)
- [x] **ทำงานฝั่ง Client 100% (Zero-Server-Storage)**: ใช้ IndexedDB (`dexie`) ร่วมกับ Google Identity Services (GIS) และ Google REST APIs (Google Sheets API v4, Google Drive API v3 `appDataFolder`, Google Picker API) โดยไม่ยุ่งกับ Cloudflare Worker

### 9.2 โครงสร้างไฟล์ที่สร้างใหม่ (Strict File Tree)
1. `classroom.html` — หน้า Entry Point แยกอิสระ โหลดฟอนต์ Google Fonts `Sarabun` และสคริปต์ `/src/classroom/main.ts`
2. `.env.example` — ตัวอย่างการตั้งค่า `VITE_GOOGLE_CLIENT_ID` และ `VITE_GOOGLE_API_KEY`
3. `src/classroom/main.ts` — ตัวเริ่มทำงานของระบบ, Hash Router (`#/` และ `#/room/:id/:tab`), ระบบป้องกันการออกจากหน้าเมื่อมีข้อมูลยังไม่ได้บันทึก (`dirty` state guard) และปุ่มส่งออก Excel (`.xlsx`)
4. `src/classroom/classroom.css` — สไตล์เฉพาะระบบจัดการห้องเรียนตาม `DESIGN.md` (พื้นหลัง `#F8FAFC`, การ์ด `#FFFFFF`, เส้นขอบ `#E2E8F0`, ปุ่มหลัก `#2563EB` Hover `#1D4ED8`, ขอบมนปุ่ม/Input `8.5px`, ขอบมนการ์ด/Modal `20px`)
5. `src/classroom/types.ts` — Data Schema (`Classroom`, `Student`, `AttendanceSession`, `Assignment`, `SheetMapping`, `ColumnMapping`, `SyncSnapshot`, `Tombstone`) และฟังก์ชันช่วยเหลือวันที่ไทย/คอลัมน์ A-Z
6. `src/classroom/db.ts` — ฐานข้อมูล `Dexie` (`eduplan_classroom`) พร้อม CRUD helpers และระบบรวมข้อมูล `mergeSyncSnapshot` แบบ Last-Write-Wins + Tombstones
7. `src/classroom/googleAuth.ts` — ระบบล็อกอิน Google Identity Services (GIS), จำสถานะใน `localStorage`/`sessionStorage`, Silent Token Refresh อัตโนมัติ, ปุ่มออกจากระบบพร้อม Revoke Token และการแจ้งเตือนอย่างสุภาพเมื่อยังไม่ได้ตั้งค่า `VITE_GOOGLE_CLIENT_ID`
8. `src/classroom/googleSheets.ts` — ระบบเชื่อมต่อ Google Sheets API v4 (สร้างไฟล์มาตรฐานแบบ A แยก 3 แท็บ `รายชื่อนักเรียน`, `การมาเรียน`, `การส่งงาน` และอัปเดตคอลัมน์ในไฟล์เดิมของครู), ซิงก์ `eduplan_classrooms.json` ใน `appDataFolder` ของ Google Drive และเปิด Google Picker เลือกไฟล์จาก Drive
9. `src/classroom/excelService.ts` — อ่านไฟล์ `.xlsx` ทุกแท็บด้วย `ExcelJS` พร้อมระบบเดาแถวหัวตาราง/คอลัมน์อัตโนมัติ และส่งออกไฟล์ `.xlsx` 3 แท็บ (`รายชื่อนักเรียน`, `สรุปการมาเรียน`, `สรุปคะแนนและการส่งงาน`) จัดรูปแบบตารางและคำนวณสรุปท้ายตารางครบถ้วน
10. `src/classroom/components/TopBar.ts` — แถบนำทางด้านบน แสดงป้ายสถานะโหมดในเครื่อง/โปรไฟล์ครู ปุ่มซิงก์ข้อมูล และปุ่มออกจากระบบ
11. `src/classroom/components/ClassroomHub.ts` — หน้าคลังห้องเรียน แสดงการ์ดห้องเรียนทั้งหมด และ Wizard เพิ่มห้องเรียน 3 วิธี (พิมพ์เอง / นำเข้า Excel `.xlsx` / เชื่อมจาก Google Sheet ที่มีอยู่แล้ว) พร้อมตัวเลือกสร้างไฟล์ Google Sheet ใหม่และซิงก์อัตโนมัติ
12. `src/classroom/components/ColumnMapperModal.ts` — Modal เลือกแท็บ คลิกเลือกแถวหัวตาราง (15 แถวแรก) และจับคู่คอลัมน์ (`เลขที่`, `รหัสนักเรียน`, `ชื่อ-สกุล` เดี่ยวหรือแยก `คำนำหน้า` + `ชื่อ` + `นามสกุล`) พร้อม Real-time Preview
13. `src/classroom/components/AttendanceTab.ts` — หน้าเช็คชื่อรายบุคคล (สร้างรอบใหม่หรือแก้ไขย้อนหลัง, ปุ่มลัดเช็คมาเรียนทั้งหมด, สถานะ `มา` / `ลา/ขาด` / `มาสาย`, Sticky Summary Footer สรุปยอด Real-time และซิงก์ Google Sheet อัตโนมัติ)
14. `src/classroom/components/AssignmentsTab.ts` — หน้าติดตามการส่งงานและคะแนน (Sync Guard ตรวจสอบการตั้งค่าคอลัมน์, มุมมองการ์ดงานพร้อมแถบความคืบหน้า, Modal เพิ่ม/แก้ไขงาน และตารางตรวจงาน `ส่งแล้ว` / `ยังไม่ส่ง` + ช่องกรอกคะแนน)
15. `src/classroom/components/SettingsTab.ts` — หน้าตั้งค่าห้องเรียน จัดการ Master Roster (เพิ่ม/ลบ/เลื่อนลำดับ/อัปโหลด Excel ใหม่/ดึงจาก Google Sheet) และตั้งค่าแท็บ/คอลัมน์ Google Sheet พร้อมตารางจำลอง Real-time Mapping Preview (`A, B, C...`)

### 9.3 ผลการตรวจสอบ Build
- ติดตั้งแพ็กเกจ `dexie` และ `exceljs` ผ่าน `npm.cmd install` เรียบร้อย
- ทดสอบ `npm.cmd run build` (`tsc && vite build`) ผ่านสมบูรณ์ Exit Code `0` ไม่มีข้อผิดพลาด

---

## 10. การแก้ไขบั๊กและยกระดับ UI/UX ของระบบจัดการห้องเรียน (Classroom Refinements)

### 10.1 แก้ไขบั๊กกดปุ่ม "+ เพิ่มงาน" แล้วเด้งหน้าต่าง "เพิ่มห้องเรียน"
- **สาเหตุ**: ใน `ClassroomHub.ts` เดิมผูก `root.onclick` ไว้บน `#classroom-app` (`appEl`) โดยดักจับ `[data-add]` เมื่อสลับเข้าสู่หน้าห้องเรียนและกดปุ่ม `+ เพิ่มงาน` (ซึ่งใช้ `data-add` เช่นกัน) Event จึง Bubble ขึ้นไปเรียก `openCreateWizard` ที่ค้างอยู่บน `appEl`
- **การแก้ไข**:
  1. ล้าง `appEl.onclick`, `appEl.onkeydown`, `appEl.onchange`, `appEl.oninput`, `appEl.onsubmit` ทุกครั้งใน `src/classroom/main.ts` ก่อนเปลี่ยน View
  2. ผูก Event ของหน้าคลังห้องเรียนไว้เฉพาะที่ `[data-hub-page]` ภายใน `ClassroomHub.ts`
  3. แยกชื่อ Attribute ชัดเจนเป็น `data-add-room` และ `data-add-assignment` พร้อม `e.stopPropagation()`

### 10.2 เพิ่มปุ่ม "เรียงลำดับใหม่" รันเลขที่นักเรียนอัตโนมัติ (1–N)
- เพิ่มปุ่ม **`เรียงลำดับใหม่`** (`data-r-renumber`) ในส่วน **รายชื่อนักเรียน (Master Roster)** ของ `SettingsTab.ts` (และในตารางพิมพ์รายชื่อเองของ `ClassroomHub.ts`)
- เมื่อกดปุ่ม ระบบจะรันเลขที่ `1, 2, 3, ..., N` ให้อัตโนมัติตามลำดับแถวของรายชื่อนักเรียนทันที พร้อมแจ้งสถานะให้กดบันทึกรายชื่อ

### 10.3 เปลี่ยนไอคอนทั้งหมดเป็น Vector SVG 100% (ไร้ Emoji)
- สร้างระบบไอคอน `icon(name, size)` ใน `src/classroom/types.ts` และแทนที่ Emoji ทั้งหมดใน `TopBar.ts`, `ClassroomHub.ts`, `ColumnMapperModal.ts`, `AttendanceTab.ts`, `AssignmentsTab.ts`, `SettingsTab.ts` และ `main.ts` ด้วย Vector SVG และจุดสถานะ CSS (`.cr-dot`)

### 10.4 ปรับขนาดปุ่มและโครงสร้างการจัดวางให้สมมาตรเท่ากันทั้งหมด
- ห่อคลาสทั้งหมดใน `src/classroom/classroom.css` ด้วย `@layer components` เพื่อไม่ให้ทับซ้อนกับคลาส Tailwind (`hidden`, `w-24`, `ml-auto` ฯลฯ)
- กำหนดความสูงมาตรฐานเท่ากัน (`height: 40px` สำหรับ `.cr-btn` และ `.cr-input`, `36px` สำหรับ `.cr-btn--sm` และองค์ประกอบบน TopBar)
- ปรับปุ่ม **"เปิด Google Sheet"** และ **"ส่งออก Excel (.xlsx)"** ในแถบหัวห้องเรียน (`main.ts`) ให้ใช้ขนาด `.cr-btn` เท่ากันทุกประการ

### 10.5 ลดความแออัดของข้อความ แยกหมวดหมู่ย่อย และทำ Accordion ย่อ/หดได้
- เพิ่มแถบเมนูย่อย (`.cr-subnav`: `แสดงทั้งหมด` | `รายชื่อนักเรียน` | `Google Sheet & คอลัมน์` | `ข้อมูลห้องเรียน`) ในหน้าตั้งค่า (`SettingsTab.ts`)
- ปรับส่วน **ข้อมูลพื้นฐานห้องเรียน**, **คอลัมน์สำหรับการมาเรียน** และ **คอลัมน์สำหรับการส่งงาน** ให้เป็น **Collapsible Cards (ย่อ/ขยายได้)** พร้อมแสดงป้ายสรุปสถานะการตั้งค่าเมื่อพับเก็บ

### 10.6 เพิ่ม Edge Line / Stroke และแสดงเซลล์ที่ Merge ตามไฟล์จริงใน Real-time Mapping Preview
- **การอ่านและแสดง Merged Cells ตามไฟล์จริง**:
  - ใน `src/classroom/excelService.ts`: อ่าน `cell.isMerged` และ `cell.master` จาก `ExcelJS` เพื่อสร้างรายการ `merges: SheetMerge[]` ของทุกแท็บ
  - ใน `src/classroom/googleSheets.ts`: ดึง `sheets.merges` จาก Google Sheets API v4
  - ใช้ฟังก์ชัน `buildMergeLayout` และ `getMergedCellValue` ใน `src/classroom/types.ts` เพื่อเรนเดอร์ `<td rowspan="..." colspan="...">` พร้อมป้ายกำกับช่วงเซลล์รวม (`.cr-merge-tag` เช่น `A1:D1`) ทั้งใน `ColumnMapperModal.ts` และ `SettingsTab.ts`
- **การแสดง Edge Line / Stroke ชัดเจน**:
  - แถวหัวตาราง: ตีกรอบสีน้ำเงินเข้ม (`2.5px solid #2563EB`) รอบทั้งแถวพร้อมป้าย `หัวตาราง`
  - คอลัมน์จับคู่นักเรียน: ตีกรอบสีส้ม (`2.5px solid #D97706`) ยาวตลอดคอลัมน์
  - คอลัมน์เริ่มเขียนและเซลล์เริ่มต้น: ตีกรอบสีเขียว (`2.5px–3px solid #15803D`) พร้อมป้ายพิกัดเซลล์เริ่มต้น (เช่น `D1`) และไฮไลต์อัตโนมัติเมื่อโฟกัสช่องตั้งค่า หรือคลิกเลือกคอลัมน์/แถวจากตารางพรีวิวโดยตรง

---

## 11. การจัดระเบียบ Layout, Whitespace และ Responsive ตาม `DESIGN.md`

### 11.1 แก้ไขปัญหาคลาส `.cr-body` / `.cr-main` / `.cr-modal--*` ถูก Tailwind Purge
- **สาเหตุ**: การห่อคลาส `.cr-*` ไว้ใน `@layer components` ทำให้ Tailwind CSS ลบคลาสที่ไม่ได้ถูกเขียนแบบ Static ในไฟล์ที่อยู่ใน `tailwind.config.js` (`classroom.html` ไม่ได้อยู่ใน `content` เนื่องจากกฎห้ามแก้ไฟล์เดิม และคลาสแบบ Dynamic เช่น `cr-modal--${size}`, `cr-seg__btn--${k}`, `is-${status}`) ส่งผลให้ `.cr-main` สูญเสีย `max-width` และ `padding` จนหน้าเว็บขยายชิดขอบจอ
- **การแก้ไข**:
  1. นำคลาส `.cr-*` ทั้งหมดออกจากการครอบ `@layer components` มาเป็น Top-level CSS Rules ปกติ เพื่อให้ทุกคลาสคงอยู่ 100% โดยไม่ถูก Tree-shake ทิ้ง
  2. ย้าย `@tailwind utilities;` ไปไว้ท้ายสุดของไฟล์ `src/classroom/classroom.css` พร้อมกำหนด `.cr-table th.text-center`, `.cr-input.w-24`, `.cr-input.w-36`, `.hidden` เพื่อไม่ให้ Specificity ของตารางหรือ Input ทับคลาสจัดตำแหน่ง

### 11.2 ปรับโครงสร้าง Container, ระยะห่าง (Spacing Scale) และ Typography ตาม `DESIGN.md`
- **Container & Whitespace**:
  - กำหนดความกว้างหลักของ `.cr-topbar__inner` และ `.cr-main` ที่ `max-width: 1040px` (`margin: 0 auto`) สอดคล้องกับหน้าหลักของ EduPlan AI
  - เพิ่มระยะห่างขอบหน้าจอ `padding: 36px 24px 112px` บน Desktop และ `24px 16px 96px` บน Mobile
- **Card Grid & Elevation**:
  - ปรับ `.cr-room-grid` และ `.cr-asg-grid` เป็น **2-Column Layout** (`grid-template-columns: repeat(2, minmax(0, 1fr))` บนจอ `> 768px` และ `1fr` บน Mobile) พร้อม `gap: 24px` ตามมาตรฐาน `DESIGN.md` Section 5 & 7
  - ปรับ Padding ภายในของการ์ดและพาเนลเป็น `24px 28px`, ขอบมน `20px` (`--cr-radius-md`), เส้นขอบ `1px solid #E2E8F0` และเงา Micro Shadow `rgba(0, 0, 0, 0.05) 0px 1px 2px 0px`
- **Button, Input & Tab Rhythm**:
  - ปรับความสูงปุ่มหลัก Input และ Tab เป็น `42px` เท่ากัน (`36px` สำหรับปุ่มย่อย `.cr-btn--sm`) ขอบมน `8.5px` (`--cr-radius-xs`) พร้อม Focus Ring `rgba(37, 99, 235, 0.15) 0px 0px 0px 3px`

---

## 12. การเพิ่มระบบแจ้งเตือนโหมดในเครื่อง, Interactive Tutorial Overlay, สีสันการ์ดเมนู และแบรนด์ EduPlan Class

### 12.1 เปลี่ยนโลโก้เป็น `public/icons/icon.png` และชื่อเว็บไซต์เป็น `EduPlan Class`
- อัปเดต `classroom.html` และ `src/classroom/components/TopBar.ts` ให้แสดงโลโก้ `<img src="./icons/icon.png" alt="EduPlan Class" class="cr-brand__logo" />` คู่กับชื่อแบรนด์ **EduPlan Class** (`ระบบเช็คชื่อและติดตามงาน`)

### 12.2 แบนเนอร์แจ้งเตือนโหมดในเครื่อง (Local Mode Advisory Banner) บนหน้าคลังห้องเรียน
- ใน `src/classroom/components/ClassroomHub.ts` แสดงกล่องแจ้งเตือน `.cr-local-advisory` ทุกครั้งที่อยู่ในหน้าคลังห้องเรียนโดยยังไม่ได้เข้าสู่ระบบ Google:
  > *"โหมดในเครื่อง (Local) จะเป็นการเก็บข้อมูลแค่ภายในเครื่องนี้เท่านั้น หากต้องการใช้งานห้องเรียนที่คุณสร้างในหลายอุปกรณ์ **ควรเข้าสู่ระบบด้วย Google** เพื่อซิงก์ข้อมูลอัตโนมัติ"*
- มีปุ่มลัด **เข้าสู่ระบบด้วย Google** บนแบนเนอร์ให้เชื่อมต่อได้ทันที

### 12.3 ระบบ Interactive Tutorial Overlay แนะนำการใช้งานทีละขั้นตอน (เฉพาะครั้งแรกที่เข้า `classroom.html`)
- ใน `src/classroom/components/TopBar.ts` (`maybeShowFirstVisitTutorial` และ `startTutorialTour`):
  1. ตรวจสอบคีย์ `eduplan_classroom_tutorial_seen_v1` ใน `localStorage` เพื่อแสดงหน้าต่างต้อนรับเฉพาะครั้งแรกที่เข้าสู่ `classroom.html` เท่านั้น
  2. หน้าต่างต้อนรับแจ้งเตือนเรื่องโหมดเก็บข้อมูลในเครื่อง (Local) vs Google Sync และให้ผู้ใช้เลือกว่าจะ **"ข้ามคำแนะนำ"** หรือ **"สอนการใช้งานทีละขั้นตอน"**
  3. เมื่อเลือกสอนต่อ จะเปิด Overlay แนะนำการใช้งาน 5 ขั้นตอน (1. โหมดการทำงาน & Google Sync, 2. การสร้างห้องเรียน 3 วิธี, 3. การเช็คชื่อรายวัน & แก้ไขย้อนหลัง, 4. การติดตามงาน & ให้คะแนน, 5. การรันเลขที่ใหม่ ตั้งค่าคอลัมน์ & ส่งออก Excel) พร้อม Spotlight ไฮไลต์จุดสำคัญบนหน้าจอ และมีปุ่ม **"วิธีใช้งาน"** บน TopBar สำหรับเปิดดูซ้ำได้ทุกเมื่อ

### 12.4 เติมสีสันให้การ์ดเมนู "เพิ่มห้องเรียนใหม่" และการ์ดห้องเรียน
- การ์ดเมนูใน Modal **เพิ่มห้องเรียนใหม่** (`.cr-method--blue`, `.cr-method--emerald`, `.cr-method--purple`):
  - **พิมพ์รายชื่อเอง**: โทนสีฟ้า-คราม (`#2563EB` → `#4F46E5`) พร้อมป้าย `ทำได้ทันที`
  - **นำเข้าจากไฟล์ Excel (.xlsx)**: โทนสีเขียวมรกต (`#16A34A` → `#059669`) พร้อมป้าย `นิยมใช้`
  - **เชื่อมกับ Google Sheet ที่มีอยู่**: โทนสีม่วง (`#9333EA` → `#4F46E5`) พร้อมป้าย `ซิงก์ออนไลน์`
- การ์ดห้องเรียนในหน้าคลังห้องเรียน (`.cr-room-card--blue`, `purple`, `emerald`, `indigo`) มีแถบสีด้านบนและไอคอนประจำการ์ดแยกสีอย่างชัดเจน

---

## 13. ปรับโหมดสอนใช้งาน (วิธีใช้งาน) เป็นแบบ Spotlight Cutout ทีละปุ่ม + กล่องคำอธิบายชิดขอบจอ

### 13.1 แก้ไขปัญหาปุ่มที่สอนถูกเบลอทับหรือเปลี่ยนเป็นพื้นหลังสีขาว
- **สาเหตุ**:
  1. `.cr-tut-spotlight-target` เดิมกำหนด `background-color: #ffffff` ไปทับปุ่มสีน้ำเงิน (`.cr-btn--primary` ซึ่งตัวอักษรเป็นสีขาว `#ffffff`) ทำให้ปุ่ม `+ เพิ่มห้องเรียน` กลายเป็นกล่องขาวทึบมองไม่เห็นข้อความ
  2. `.cr-overlay` เดิมใช้ `backdrop-filter: blur(4px)` เต็มจอ ซึ่งมี `z-index: 50` สูงกว่า Stacking Context ของ `<header class="cr-topbar">` (`z-index: 30`) ทำให้ปุ่มบนแถบเมนูด้านบนถูกเบลอทับทั้งหมด
- **การแก้ไขใน `src/classroom/components/TopBar.ts` และ `src/classroom/classroom.css`**:
  1. เปลี่ยนเป็นระบบ **True Spotlight Cutout Window (`.cr-tour-spotlight`)** ที่เจาะช่องโปร่งใส (`background: transparent`) ตรงพิกัดจริงของปุ่ม (`getBoundingClientRect()`) แล้วทำฉากหลังมืดรอบนอกด้วย `box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.64)` พร้อมเส้นขอบเรืองแสงสีฟ้า (`#3B82F6`) และป้ายกำกับลำดับจุดที่ชี้ ทำให้ปุ่มที่กำลังสอนสว่าง คมชัด 100% และคงสีเดิมของปุ่มจริงโดยไม่ถูกเบลอ
  2. ย้ายกล่องคำอธิบายไปเป็น **Edge-Docked Coachmark Box (`.cr-tour-dock`)** ที่มุมขวาล่างของหน้าจอ (และสลับไปมุมซ้ายล่างอัตโนมัติหากปุ่มที่ไฮไลต์อยู่บริเวณมุมขวาล่าง) แทนการวางการ์ดขนาดใหญ่บังกลางหน้าจอ
  3. รองรับการสอนทีละปุ่มทั้งในหน้าแรก (คลังห้องเรียน) และภายในหน้าห้องเรียน (ปุ่มกลับคลังห้องเรียน, ปุ่มส่งออก Excel, แท็บการมาเรียน, แท็บการส่งงาน, แท็บตั้งค่าตารางและคอลัมน์)

---

## 14. ระบบสอนใช้งานผ่านหน้าจำลอง Dummy Sandbox ครบทุกฟีเจอร์ (23 จุด 9 หน้าจำลอง)

### 14.1 โครงสร้าง Dummy Sandbox Stage (`.cr-tour-sandbox`)
- เมื่อเริ่มโหมด **วิธีใช้งาน** (`startTutorialTour()` ใน `src/classroom/components/TopBar.ts`) ระบบจะซ่อนเนื้อหาจริงของ `#classroom-app` ชั่วคราวด้วย `.cr-tour-hidden-real` และสร้างพื้นที่จำลอง `.cr-tour-sandbox` ขึ้นมาแทนโดย **ไม่แตะต้องฐานข้อมูล IndexedDB จริงของผู้ใช้**
- เมื่อกดปิดหรือจบการสาธิต ระบบจะลบ `.cr-tour-sandbox` ทิ้งและคืนหน้าจริงกลับมาทันที 100%

### 14.2 รายละเอียด 9 หน้าจำลอง (Dummy Scenes) และ 23 จุดสอนทีละปุ่ม
1. **หมวด 1 — คลังห้องเรียน & บัญชี (`hub`)**:
   - ป้ายสถานะโหมดเก็บข้อมูล (`โหมดในเครื่อง Local`), ปุ่ม `เข้าสู่ระบบด้วย Google`, ปุ่ม `+ เพิ่มห้องเรียน`, และการ์ดห้องเรียนตัวอย่าง
2. **หมวด 2 — เพิ่มห้องเรียน & นำเข้ารายชื่อ (`wizard-methods`, `wizard-manual`, `mapper-preview`)**:
   - การ์ดเลือกวิธีตั้งต้นรายชื่อ 3 รูปแบบ (พิมพ์เอง / นำเข้า Excel `.xlsx` / เชื่อม Google Sheet)
   - ฟอร์มกรอกข้อมูลพื้นฐานของห้องเรียน และตารางพิมพ์รายชื่อนักเรียนพร้อมปุ่ม `+ เพิ่มแถว` และ `เรียงลำดับใหม่`
   - ตัวเลือกติ๊กสร้างไฟล์ Google Sheet มาตรฐาน 3 แท็บอัตโนมัติ
   - หน้าต่างคลิกเลือกแถวหัวตาราง (แสดงเซลล์รวม Merge ตามไฟล์จริง) และจับคู่คอลัมน์ เลขที่ / รหัสนักเรียน / ชื่อ-สกุล
3. **หมวด 3 — เช็คชื่อการมาเรียน (`attendance`)**:
   - แถบเลือกรอบเช็คชื่อใหม่หรือแก้ไขย้อนหลัง, ปุ่มลัด `เช็คมาเรียนทั้งหมด`, ปุ่มสถานะรายคน (`มา` / `ลา/ขาด` / `มาสาย`), และแถบสรุปยอดด้านล่างพร้อมปุ่ม `บันทึกการมาเรียน`
4. **หมวด 4 — เพิ่มงาน & ตรวจให้คะแนน (`assignments-cards`, `assignments-grading`)**:
   - ปุ่ม `+ เพิ่มงาน`, การ์ดชิ้นงานพร้อมแถบความคืบหน้าและปุ่มแก้ไข/ลบงาน, ตารางตรวจงานรายคน (เลือก `ส่งแล้ว` / `ยังไม่ส่ง` + ช่องกรอกคะแนน), และปุ่ม `บันทึกการส่งงาน`
5. **หมวด 5 — แก้ไขห้องเรียน แก้ไขรายชื่อ ตั้งค่า Sheet & ส่งออก Excel (`settings-roster`, `settings-sheet`)**:
   - การแก้ไขข้อมูลพื้นฐานของห้องเรียน (วิชา, ชั้น/ห้อง, ภาคเรียน, ปีการศึกษา)
   - ปุ่ม `เรียงลำดับใหม่` (รันเลขที่ 1–N อัตโนมัติ) และปุ่ม `อัปโหลด Excel (.xlsx)`
   - ตารางแก้ไขรายชื่อนักเรียน (Master Roster) รายคน (แก้ไขข้อความ, เลื่อนลำดับขึ้น-ลง, ลบแถว, `+ เพิ่มนักเรียน`, `บันทึกรายชื่อ`)
   - การตั้งค่าคอลัมน์ Google Sheet & ตารางจำลอง Real-time Mapping Preview ที่ตีกรอบสีส้ม/เขียวชัดเจน
   - ปุ่ม `ส่งออก Excel (.xlsx)` สรุปครบ 3 แท็บ
- มี Dropdown เลือกหมวดหมู่ (`[data-tour-chapter]`) บนกล่องคำอธิบายมุมจอเพื่อให้ครูเลือกข้ามไปดูหัวข้อที่ต้องการได้ทันที

---

## 15. แยกสีการจับคู่คอลัมน์ (Multi-Color Column Mapping) ในหน้าต่างเลือกแถวหัวตารางและจับคู่คอลัมน์

### 15.1 ระบบสีแยกตามประเภทคอลัมน์ (`ColumnMapperModal.ts`, `TopBar.ts`, `classroom.css`)
- เปลี่ยนจากการใช้สีน้ำเงินสีเดียวในทุกคอลัมน์ที่จับคู่ มาเป็นการแยกสีเฉพาะตัวให้เห็นความแตกต่างของแต่ละคอลัมน์อย่างชัดเจน (ทั้งเส้นขอบคอลัมน์ พื้นหลังเซลล์ ป้ายกำกับหัวคอลัมน์ ป้ายสถานะด้านบน และกรอบของช่อง Dropdown เลือกคอลัมน์):
  1. **แถวหัวตาราง (`is-header`)**: โทนสีน้ำเงิน (`#2563EB`)
  2. **เลขที่ (`role-number`)**: โทนสีส้มทอง Amber (`#D97706` ขอบ / `#FEF3C7` พื้นหลัง)
  3. **รหัสนักเรียน (`role-code`)**: โทนสีม่วง Purple (`#9333EA` ขอบ / `#F3E8FF` พื้นหลัง)
  4. **ชื่อ-สกุล / ชื่อ (`role-name`)**: โทนสีเขียวมรกต Emerald (`#16A34A` ขอบ / `#DCFCE7` พื้นหลัง)
  5. **คำนำหน้า (`role-prefix` กรณีแยกคอลัมน์)**: โทนสีฟ้าอมเขียว Cyan (`#0891B2` ขอบ / `#CFFAFE` พื้นหลัง)
  6. **นามสกุล (`role-last` กรณีแยกคอลัมน์)**: โทนสีชมพูเข้ม Rose (`#E11D48` ขอบ / `#FFE4E6` พื้นหลัง)

---

## 16. การเชื่อมเมนู EduPlan Class (เบต้า) เข้ากับหน้าหลัก EduPlan AI (2x2 Grid) และปุ่มย้อนกลับหน้าหลัก

### 16.1 เพิ่มการ์ดเมนู "EduPlan Class ระบบจัดการห้องเรียน (เบต้า)" บนหน้าหลัก (`index.html`)
- ปรับ Grid หน้าแรก (`#home-section` ใน `index.html`) เป็น 2 คอลัมน์ (`grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto`) แบ่งเป็นแถวละ 2 เมนู:
  - **แถวที่ 1**: `[สร้างแผนการจัดการเรียนรู้ , สร้างเกณฑ์รูบริกสกอร์]`
  - **แถวที่ 2**: `[สร้างโครงการจัดการเรียนรู้ , EduPlan Class (ระบบจัดการห้องเรียน เบต้า)]`
- ปุ่ม `#btn-nav-classroom` เชื่อมไปยัง `./classroom.html`

### 16.2 เพิ่มปุ่ม "กลับหน้าหลัก" บนแถบนำทางด้านบนของ `classroom.html` (`TopBar.ts`)
- เพิ่มปุ่ม `<a href="./index.html" data-back-eduplan>กลับหน้าหลัก</a>` ที่ด้านซ้ายบนของ TopBar ใน `src/classroom/components/TopBar.ts` เพื่อให้ผู้ใช้กดย้อนกลับมายังหน้าหลักของ EduPlan AI ได้ทันที พร้อมเพิ่มจุดสอนปุ่มนี้ในโหมดวิธีใช้งาน

---

## 17. การจัดเรียง TopBar ใหม่ และระบบปุ่มย้อนกลับอัจฉริยะ (Contextual Back Navigation)

### 17.1 การทำงานของปุ่ม `[ย้อนกลับ / กลับหน้าหลัก]` ตามลำดับหน้า (`TopBar.ts`, `main.ts`)
1. **เมื่ออยู่ในหน้าตรวจงานรายชิ้น**: กดปุ่ม `ย้อนกลับ` บน TopBar จะย้อนกลับไปหน้ารวมการ์ดงานของห้องนั้น
2. **เมื่ออยู่ในหน้าห้องเรียน (`#/room/...`)**: ปุ่มจะแสดงข้อความ `ย้อนกลับ` เมื่อกดจะย้อนกลับไปยังหน้า **คลังห้องเรียน (`#/`)**
3. **เมื่ออยู่ที่หน้าคลังห้องเรียน (`#/`)**: ปุ่มจะแสดงข้อความ `กลับหน้าหลัก` เมื่อกดจะย้อนกลับไปยังหน้าหลักของ **EduPlan AI (`./index.html`)**

### 17.2 โครงสร้างการจัดวาง TopBar ใหม่ (`TopBar.ts`, `classroom.css`)
- **ฝั่งซ้ายสุด (`.cr-topbar__left`)**: `[Logo EduPlan Class เบต้า]` | `[ปุ่ม ย้อนกลับ / กลับหน้าหลัก]` | `[ป้าย ซิงก์ล่าสุด / โหมดในเครื่อง]`
- **ฝั่งขวาสุด (`.cr-topbar__right`)**: `[ปุ่ม ตั้งค่า]` | `[โปรไฟล์ครู (หรือปุ่มเข้าสู่ระบบด้วย Google)]` | `[ปุ่ม ออกจากระบบ]`
- **เมนูย่อยภายในปุ่ม `ตั้งค่า` (`.cr-settings-dropdown`)**:
  - **วิธีใช้งาน** — เปิดโหมดสาธิตสอนการใช้งานทีละปุ่ม (หน้าจำลอง Dummy)
  - **ซิงก์ข้อมูล** — ซิงก์ห้องเรียนกับ Google Drive และส่งข้อมูลขึ้น Google Sheet


---

## 18. ปรับโครงสร้าง TopBar เป็น 2 บรรทัด (`TopBar.ts`, `classroom.css`)

### 18.1 โครงสร้าง TopBar แบบ 2 แถว
- **บรรทัดที่ 1 (`.cr-topbar__row1`)**: แสดงเฉพาะ `[Logo EduPlan Class (เบต้า) — ระบบเช็คชื่อและติดตามงาน]` ด้านบน แยกสัดส่วนด้วยเส้นคั่นบาง (`#F1F5F9`)
- **บรรทัดที่ 2 (`.cr-topbar__row2`)**:
  - **ฝั่งซ้ายสุด (`.cr-topbar__left`)**: `[ปุ่ม ย้อนกลับ / กลับหน้าหลัก]` + `[ป้าย ซิงก์ล่าสุด / โหมดในเครื่อง (Local)]`
  - **ฝั่งขวาสุด (`.cr-topbar__right`)**: `[ปุ่ม ตั้งค่า (มีเมนูย่อย วิธีใช้งาน & ซิงก์ข้อมูล)]` + `[โปรไฟล์ครู (หรือปุ่มเข้าสู่ระบบด้วย Google)]` + `[ปุ่ม ออกจากระบบ]`
- ปรับระยะของ `.cr-tour-banner` ให้วางตรงมุมขวาของบรรทัดที่ 1 และ `.cr-tour-dock.is-top-right` ลงมาที่ `top: 126px` เพื่อไม่ให้บังแถวปุ่มทั้ง 2 บรรทัด รวมถึงรองรับการปิดเมนูตั้งค่าด้วยปุ่ม `Escape` และการจัดเรียงบนหน้าจอมือถือ (`<= 640px`)

### 18.2 ผลการตรวจสอบ Build
- รัน `npx.cmd tsc --noEmit` และ `npm.cmd run build` ผ่านเรียบร้อย Exit Code `0`


---

## 19. การตรวจสอบความปลอดภัย (Security Audit), แก้ไข Build MPA และอัปโหลดขึ้น GitHub

### 19.1 ผลการตรวจสอบการรั่วไหลของ API Keys และ Secrets
- **`.env` & `.gitignore`**:
  - ยืนยันว่าไฟล์ `.env` (ซึ่งเก็บ `VITE_GOOGLE_CLIENT_ID` และ `VITE_GOOGLE_API_KEY`) ถูกปิดกั้นใน `.gitignore` (`git check-ignore -v .env`) และไม่ถูก Track ใน Git โดยเด็ดขาด
  - สร้าง `.env.example` ที่มีเพียงตัวแปรว่างพร้อมคำแนะนำสำหรับนักพัฒนา
  - ตรวจสอบทุกไฟล์ที่จะ Commit และประวัติ Git ทั้งหมด ไม่พบการ Hardcode Gemini API Key (`AIza...`), Google Client Secret (`GOCSPX-...`), หรือ Private Key ใดๆ ในโค้ด Frontend (พบเฉพาะข้อความตัวอย่าง Placeholder ในเอกสาร/UI)
- **Cloudflare Worker (`worker/worker.js` / `worker/wrangler.toml`)**:
  - Gemini API Keys ทั้งหมดถูกจัดเก็บบน Cloudflare Worker Secrets (`GEMINI_KEY_1..3` / `GEMINI_API_KEYS`) ไม่มีการฝังลงฝั่ง Client
- **Google OAuth & Client Security (`src/classroom/`)**:
  - ใช้ Google Identity Services (GIS) แบบไม่มี Client Secret บนฝั่ง Browser, เก็บ Access Token เฉพาะใน `sessionStorage` + Memory และ Revoke Token ทันทีเมื่อออกจากระบบ
  - เพิ่ม `safeHttpsUrl()` ใน `src/classroom/types.ts` กรองเฉพาะ `https://` สำหรับลิงก์ Google Sheet (`spreadsheetUrl`) และรูปโปรไฟล์ (`picture`) พร้อม `rel="noopener noreferrer"` ป้องกัน `javascript:` URL injection
  - ปรับ `mergeSyncSnapshot()` ใน `src/classroom/db.ts` ให้ตรวจสอบ Whitelist ของชื่อตาราง (`SYNC_TABLES`) และชนิดข้อมูลก่อนเขียนลง IndexedDB ป้องกันข้อมูลผิดรูปจาก Sync Snapshot
  - `googleSheets.ts` ใช้ `valueInputOption: 'RAW'` ป้องกัน Spreadsheet Formula Injection

### 19.2 การปรับโครงสร้าง Build สำหรับ GitHub Pages (`vite.config.ts`, `.github/workflows/deploy.yml`)
- **`vite.config.ts`**: เพิ่ม `build.rollupOptions.input` ให้ Build ทั้ง `index.html` และ `classroom.html` ลงโฟลเดอร์ `dist/` พร้อมกัน (ป้องกัน Error 404 เมื่อเปิดหน้า `classroom.html` บน GitHub Pages)
- **`.github/workflows/deploy.yml`**: อ่านค่า `VITE_GOOGLE_CLIENT_ID` และ `VITE_GOOGLE_API_KEY` จาก GitHub Repository `secrets` / `vars` ตอน Build โดยไม่เก็บ Key ไว้ใน Repository

### 19.3 ผลการตรวจสอบและ Push ขึ้น GitHub
- รัน `npx.cmd tsc --noEmit` และ `npm.cmd run build` ผ่านสมบูรณ์ (`dist/index.html` และ `dist/classroom.html` ถูกสร้างครบถ้วน)
- ทำการ Commit และ Push ขึ้น Remote `origin/main` (`https://github.com/Thianrawit/EDUPlan.git`)
