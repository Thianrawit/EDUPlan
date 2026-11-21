# MASTER PROMPT: อัปเกรดและแก้ไขระบบ EduPlan Class ฉบับสมบูรณ์ (Single-File Specification)

โปรดทำงานแบบ **Token-Saving** (กระชับ ตรงประเด็น ไม่เกริ่นนำเยิ่นเย้อ อ่านไฟล์จริงในโปรเจกต์ก่อนแก้ไขเพื่อไม่ให้ชื่อตัวแปรขัดกัน และสรุปผลการเปลี่ยนแปลงทั้งหมดลง `ReviewIDE.md` เมื่อเสร็จงาน)

---

## 1. กฎเหล็กด้านขอบเขตงานและสถาปัตยกรรมเดิม (STRICT ISOLATION & COMPATIBILITY)
1. **ห้ามแก้ไข ลบ หรือแตะต้องลอจิกของระบบหลัก `EduPlan AI` เด็ดขาด** ได้แก่ `src/main.ts`, `src/style.css`, `src/config.ts`, `src/curriculum.ts`, `src/gemini.ts`, `src/types.ts`, `src/templates.ts`, `src/exporter.ts`, `src/rubricExporter.ts`, `src/longTermExporter.ts`, `src/longTermModule.ts`, `public/data/curriculum.json`, `vite.config.ts` และ `worker/worker.js`
2. **ขอบเขตไฟล์ที่อนุญาตให้สร้าง/แก้ไข:**
   - ไฟล์ภายใน `src/classroom/*` และ `classroom.html`
   - สร้างไฟล์ใหม่ `public/privacy.html`
   - เพิ่มเฉพาะลิงก์ `<a href="./privacy.html">` ขนาดเล็กที่ส่วนท้าย (Footer) ของ `index.html` และ `classroom.html` เท่านั้น
3. **รักษาโครงสร้างเดิมของ `src/classroom/`:**
   - คงตาราง Dexie IndexedDB ทั้ง 7 ตารางใน `src/classroom/db.ts` (`rooms`, `students`, `attendance_sessions`, `attendance_records`, `assignments`, `assignment_submissions`, `meta`) โดยเพิ่มเฉพาะฟิลด์ที่จำเป็นแบบ Backward-Compatible
   - คงการใช้ **SheetJS (`xlsx`)** ใน `src/classroom/excelService.ts` ตามเดิม
   - คงการทำงานของ **InteractiveTour.ts (23 สเต็ป)** และ **Two-Tier TopBar (`TopBar.ts`)** ไม่ให้พังระหว่างรันทัวร์
   - **ความปลอดภัย (Security):** ทุกการเขียนข้อมูลลง Google Sheets ต้องกำหนด `valueInputOption: 'RAW'` เสมอ และทุก URL ภายนอกต้องผ่านฟังก์ชันกรอง `safeHttpsUrl()`

---

## 2. ปรับ OAuth Scopes เป็น Public Mode (รองรับผู้ใช้สาธารณะไม่จำกัดจำนวน)
แก้ไขใน `src/classroom/googleAuth.ts`:
1. **ลบ** `'https://www.googleapis.com/auth/drive.metadata.readonly'` ออกจาก `SCOPES` (เพราะเป็น Restricted Scope ที่จำกัดผู้ใช้ 100 คนและไม่ผ่านการตรวจแอปสาธารณะ)
2. **คงไว้เฉพาะ 5 Scopes** ที่เปิดสาธารณะได้ไม่จำกัดจำนวนผู้ใช้:
   - `'openid'`
   - `'email'`
   - `'profile'`
   - `'https://www.googleapis.com/auth/drive.file'`
   - `'https://www.googleapis.com/auth/drive.appdata'`
3. **เพิ่มคำแนะนำการเข้าสู่ระบบใน `TopBar.ts`:**
   - แสดงข้อความขนาดเล็กใกล้ปุ่มเข้าสู่ระบบ Google:
     `"💡 หากขึ้นหน้าจอ 'Google ยังไม่ได้ยืนยันแอปนี้' ให้กด ขั้นสูง (Advanced) > ไปที่ thianrawit.github.io"`

---

## 3. ระบบจัดการห้องเรียนร่วมและสิทธิ์ 4 ระดับ (Collaborators & RBAC — Option A)

### 3.1 โครงสร้างสิทธิ์ (`src/classroom/types.ts`)
กำหนด Type:
`export type ClassroomRole = 'owner' | 'creator' | 'assistant' | 'viewer';`
`export interface Collaborator { email: string; role: Exclude<ClassroomRole, 'owner'>; permissionId?: string; }`

บังคับสิทธิ์ใน UI ทุกจุดดังนี้:
- **`owner` (เจ้าของห้อง):** ทำได้ทุกอย่าง + กดปุ่ม `👥 จัดการผู้ร่วมสอน (X/5)` + ลบห้องเรียนถาวร
- **`creator` (ครีเอเตอร์):** แก้ไขได้ทุกอย่างเหมือนเจ้าของห้อง (รายชื่อนักเรียน, ตั้งค่าคอลัมน์, เช็คชื่อ, เช็คงาน, เพิ่ม/ลบงาน, เปิด Google Sheet ต้นฉบับ) **ยกเว้น** จัดการผู้ร่วมสอนและลบห้องเรียน (แสดงปุ่ม `🚪 ออกจากห้องร่วม` แทน)
- **`assistant` (ครูผู้ช่วย):** เช็คชื่อการมาเรียน, เช็คการส่งงาน/ใส่คะแนน, **เพิ่ม/ลบชิ้นงานได้** และ Export Excel ได้ โดย **ซ่อนแท็บตั้งค่าห้องเรียน (`SettingsTab`) และซ่อนปุ่มเปิด Google Sheet ต้นฉบับบนหน้าเว็บ** (หลังบ้านแชร์สิทธิ์ `writer` บนไฟล์ Drive เพื่อให้ API บันทึกข้อมูลได้)
- **`viewer` (ผู้ชม):** ดูข้อมูลเช็คชื่อ/เช็คงาน และ Export Excel ได้อย่างเดียว ปิดการคลิกแก้ไขทั้งหมด (`disabled`), ซ่อนปุ่มบันทึก, ซ่อนปุ่มเพิ่ม/ลบงาน, ซ่อน `SettingsTab` และซ่อนปุ่มเปิด Google Sheet ต้นฉบับ

### 3.2 การแชร์และรับห้องเรียนร่วมภายใต้สิทธิ์ `drive.file` (`googleSheets.ts`, `ClassroomHub.ts`, `CollaboratorModal.ts`)
1. **Normalize อีเมลทั้งหมดด้วย `.toLowerCase().trim()`** ทั้งตอนบันทึกและตอนตรวจสอบสิทธิ์
2. **บันทึกสิทธิ์ลง Public File `properties` ของ Google Drive** (ห้ามใช้ `appProperties` เพราะคนถูกเชิญมองไม่เห็น) แยกเก็บเป็นรายสล็อตเพื่อไม่ให้เกิน 124 bytes/key:
   - `eduplan_type`: `'classroom'`
   - `eduplan_room_name`: ชื่อห้องเรียน (ไม่เกิน 40 ตัวอักษร)
   - `eduplan_subject`: ชื่อวิชา (ไม่เกิน 40 ตัวอักษร)
   - `collab_1` ถึง `collab_5`: เก็บในรูปแบบ `"email@domain.com|role"`
3. **การเชิญ / เปลี่ยนสิทธิ์ / ลบผู้ร่วมสอน (`CollaboratorModal.ts` — สูงสุด 5 คนต่อห้อง, เฉพาะห้องที่ซิงก์ Sheet แล้ว):**
   - เชิญใหม่: ยิง `POST /drive/v3/files/{fileId}/permissions?sendNotificationEmail=false` (`reader` สำหรับ `viewer`, `writer` สำหรับ `assistant` และ `creator`) แล้ว `PATCH /drive/v3/files/{fileId}` อัปเดต `properties`
   - เปลี่ยนสิทธิ์: `PATCH /drive/v3/files/{fileId}/permissions/{permissionId}` และอัปเดต `properties`
   - ลบออก: หา `permissionId` ของอีเมลนั้นแล้วสั่ง `DELETE /drive/v3/files/{fileId}/permissions/{permissionId}` พร้อมล้างค่าสล็อต `collab_X` ใน `properties`
   - แสดงข้อความแนะนำใน Modal ว่า: *"แจ้งผู้ถูกเชิญให้ล็อกอินแล้วกดปุ่ม '📥 รับห้องเรียนที่ถูกแชร์' เพื่อเลือกไฟล์ของห้องนี้เข้าสู่หน้าหลัก"*
4. **การรับห้องเรียนที่ถูกแชร์ (`📥 รับห้องเรียนที่ถูกแชร์` via Google Picker):**
   - เพิ่มปุ่ม **`📥 รับห้องเรียนที่ถูกแชร์`** ข้างปุ่ม `+ เพิ่มห้องเรียน` ใน `ClassroomHub.ts` (แสดงเมื่อล็อกอิน Google แล้ว)
   - เมื่อคลิก ให้เปิด Google Picker (`google.picker.ViewId.SPREADSHEETS`) เพื่อให้ผู้ใช้จิ้มเลือกไฟล์จากแท็บ "แชร์กับฉัน" (สิทธิ์ `drive.file` จะปลดล็อกให้อ่าน/เขียนไฟล์นั้นทันที)
   - อ่าน `properties` เพื่อระบุ `role` และ `ownerEmail` บันทึกลงตาราง `rooms` ใน Dexie และเก็บรายการ `sharedRoomIds` ไว้ใน `appDataFolder` (`eduplan_shared_rooms.json`) เพื่อให้เปิดครั้งถัดไปโหลด Card ห้องเรียนร่วมขึ้นหน้าหลักอัตโนมัติ (หากไฟล์ถูกลบหรือโดนถอนสิทธิ์ ให้ลบออกจากรายการอัตโนมัติ)
   - บน Card ห้องเรียนร่วมใน `ClassroomHub.ts`: แสดงป้ายสัญลักษณ์ตามสิทธิ์ (`👁️ ผู้ชม`, `📋 ครูผู้ช่วย`, `🛠️ ครีเอเตอร์`), แสดง **`เจ้าของห้อง: {ownerEmail}`**, และมีปุ่ม **`🚪 ออกจากห้องร่วม`** (กดแล้วสั่ง `DELETE` permission ของตัวเองออกจากไฟล์)

---

## 4. ระบบอัปเดตอัตโนมัติแบบ Real-time (`src/classroom/realtimeSync.ts`)
1. **Smart Polling ทุก 12 วินาที:** ทำงานเฉพาะตอนเปิด Workspace ห้องเรียนที่ซิงก์ Google Sheet และหน้าแท็บเบราว์เซอร์เปิดอยู่ (`!document.hidden`)
2. ยิง `GET https://www.googleapis.com/drive/v3/files/{fileId}?fields=modifiedTime,lastModifyingUser(emailAddress,displayName)` เทียบกับ `lastKnownModifiedTime`:
   - **กรณี `!isDirty` (ไม่ได้กำลังติ๊กเช็คชื่อหรือพิมพ์คะแนนค้างไว้):** ดึงข้อมูลล่าสุดจาก Sheet มาอัปเดตหน้าจอทันที พร้อมเด้ง Toast: `"🔄 ข้อมูลถูกอัปเดตล่าสุดโดย {lastModifyingUser.emailAddress}"`
   - **กรณี `isDirty` (กำลังแก้ไขค้างไว้ยังไม่กด Save):** ห้ามรีเฟรชทับข้อมูลที่กำลังทำอยู่ แต่แสดงแถบแจ้งเตือนด้านบนสุดของตาราง: `"⚠️ มีการบันทึกข้อมูลใหม่จาก {lastModifyingUser.emailAddress} [คลิกเพื่อโหลดข้อมูลล่าสุด]"`
3. **Partial Batch Update:** ทุกครั้งที่บันทึกการมาเรียนหรือบันทึกการส่งงาน ให้ใช้ `POST https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}/values:batchUpdate` (`valueInputOption: 'RAW'`) อัปเดตเฉพาะคอลัมน์ของวันที่หรือชิ้นงานนั้นๆ ห้ามเขียนทับทั้งแผ่นงาน

---

## 5. แก้ไขบั๊ก 1: ระบบเช็คงานเขียนข้อมูลข้ามไปคอลัมน์ X, Y แทนที่จะเริ่มที่คอลัมน์ F, G
แก้ไขใน `src/classroom/googleSheets.ts`, `SettingsTab.ts` และ `AssignmentsTab.ts`:
1. **สาเหตุที่ต้องแก้:** ห้ามใช้ `values.append` และห้ามใช้ `headerRow.length` (ซึ่งชีตเปล่ามีความยาว 26 ช่อง A–Z) ในการหาคอลัมน์ถัดไป รวมถึงต้องแปลงค่าคอลัมน์เริ่มต้นเป็น `Number` เสมอ (ป้องกัน String Concatenation เช่น `"5" + 1 = "51"`)
2. **ฟังก์ชัน `findNextAvailableAssignmentColumn(sheetRows, headerRowIndex, startColIndex)`:**
   - แปลง `startColIndex = Number(startColIndex)` เสมอ (เช่น คอลัมน์ `F` = index `5`)
   - วนลูปตรวจสอบตั้งแต่ `col = startColIndex` เป็นต้นไป หาคอลัมน์แรกที่เซลล์หัวตาราง (`sheetRows[headerRowIndex][col]`) เป็นค่าว่าง (`""` หรือ `undefined`)
   - หาก 1 งานใช้ 2 คอลัมน์ (เช่น F และ G) ให้ตรวจสอบว่าทั้ง `col` และ `col + 1` ว่างทั้งคู่ แล้วเขียนลงพิกัด A1-Notation ตรงๆ ด้วย `values:batchUpdate` (`valueInputOption: 'RAW'`)
   - ตรวจสอบให้แน่ใจว่าค่า `assignmentStartCol` ที่ตั้งไว้ใน `SettingsTab.ts` ถูกบันทึกและดึงมาใช้จริงทุกครั้งใน `AssignmentsTab.ts`

---

## 6. แก้ไขบั๊ก 2: เพิ่ม/แก้ไขรายชื่อนักเรียนในหน้าเว็บแล้วไม่ซิงก์ลง Google Sheet
แก้ไขใน `src/classroom/googleSheets.ts` และ `src/classroom/components/SettingsTab.ts`:
1. **สร้างฟังก์ชัน `syncStudentsToGoogleSheet(room, students)` ใน `googleSheets.ts`:**
   - เมื่อห้องเรียนมีการเชื่อมต่อ Google Sheet (`room.sheetId` มีค่า) และผู้ใช้มีสิทธิ์ `owner` หรือ `creator`:
   - อัปเดตรายชื่อนักเรียน (`เลขที่`, `รหัสนักเรียน`, `ชื่อ-นามสกุล`) ลงใน Google Sheet เริ่มตั้งแต่แถวถัดจาก `headerRowIndex` โดยใช้ `valueInputOption: 'RAW'`
   - **กรณีโครงสร้างมาตรฐาน 3 แท็บ (`รายชื่อนักเรียน`, `การมาเรียน`, `การส่งงาน`):** ให้อัปเดตคอลัมน์ `A:C` (`เลขที่`, `รหัสนักเรียน`, `ชื่อ-สกุล`) ให้ตรงกันทั้ง 3 แท็บ เพื่อไม่ให้แถวนักเรียนใหม่เยื้องกับข้อมูลเช็คชื่อและการส่งงาน
   - หากจำนวนนักเรียนใหม่น้อยกว่าจำนวนแถวเดิมใน Sheet (กรณีลบนักเรียนออก) ให้สั่ง `values:clear` เคลียร์เศษแถวเก่าด้านล่างออกด้วย
2. **เชื่อมต่อใน `SettingsTab.ts`:**
   - ทุกครั้งที่ครูกดเพิ่มแถวนักเรียน แก้ไขชื่อ/เลขที่ เรียงลำดับใหม่ หรือกดบันทึกใน Master Roster และห้องนั้นเปิดซิงก์ Google Sheet อยู่ ให้เรียก `syncStudentsToGoogleSheet()` ทันที พร้อมอัปเดต `lastKnownModifiedTime` และแสดง Toast แจ้งเตือนว่าบันทึกและซิงก์ลง Google Sheet สำเร็จ

---

## 7. สร้างหน้านโยบายความเป็นส่วนตัว (`public/privacy.html`) และลิงก์ Footer
1. **สร้างไฟล์ `public/privacy.html`** (เพื่อให้ Vite คัดลอกไปที่ `./privacy.html` ตอน Build บน GitHub Pages) คุมธีม `EDUPlan` (ฟอนต์ `Sarabun`, พื้นหลัง `#F8FAFC`, การ์ด `#FFFFFF`, ขอบ `#E2E8F0`, ปุ่ม/ลิงก์ `#2563EB`) มีเนื้อหาครบทั้ง **ภาษาไทยและภาษาอังกฤษ**:
   - **ชื่อแอปและเว็บไซต์:** `EDUPlan` (`https://thianrawit.github.io/EDUPlan/`)
   - **ข้อมูล Google User Data ที่เข้าถึง (ตรงตาม 5 Scopes จริง):** `openid`, `email`, `profile`, `drive.file`, `drive.appdata`
   - **การจัดเก็บข้อมูล (Zero-Server Storage):** ข้อมูลรายชื่อนักเรียน การเช็คชื่อ และคะแนนทั้งหมดถูกเก็บเฉพาะในเบราว์เซอร์ของผู้ใช้ (IndexedDB) และ Google Drive / Google Sheets ส่วนตัวของผู้ใช้เท่านั้น ไม่มีการจัดเก็บ ขาย หรือส่งต่อข้อมูลส่วนบุคคลให้บุคคลที่สาม
   - **Google API Services User Data Policy:** ระบุข้อความมาตรฐาน *"EDUPlan's use and transfer to any other app of information received from Google APIs will adhere to Google API Services User Data Policy, including the Limited Use requirements."*
   - **การเพิกถอนสิทธิ์:** แจ้งวิธีถอดสิทธิ์แอปผ่าน `https://myaccount.google.com/permissions` และแสดงอีเมลติดต่อผู้พัฒนา
2. **เพิ่มลิงก์ใน Footer ของ `index.html` และ `classroom.html`:**
   - เพิ่ม `<a href="./privacy.html">นโยบายความเป็นส่วนตัว (Privacy Policy)</a>` ไว้ที่ส่วนท้ายสุดของทั้ง 2 หน้า

---

## 8. การตรวจสอบและส่งมอบงาน
1. ตรวจสอบว่าไฟล์ระบบหลักของ `EduPlan AI` (`src/main.ts`, `public/data/curriculum.json`, `worker/worker.js` ฯลฯ) ไม่ถูกแก้ไข
2. รัน `npm run build` ต้องผ่าน 100% ปราศจาก TypeScript Error และมีไฟล์ `dist/privacy.html` สร้างออกมาเรียบร้อย
3. บันทึกสรุปไฟล์ที่สร้าง/แก้ไขและวิธีทดสอบทั้งหมดลงใน `ReviewIDE.md`