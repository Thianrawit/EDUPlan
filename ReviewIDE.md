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


