# บันทึกการแก้ไขบั๊กเพิ่มรายชื่อนักเรียนไม่ซิงก์ลง Google Sheet (ReviewIDE.md)
**EduPlan Class — Custom Google Sheet Roster Sync & Auth State Fix**
- วันที่และเวลา: 2026-11-21 16:09 (UTC+7)

## สาเหตุของปัญหา
1. **ห้องที่เชื่อม Google Sheet ไฟล์กำหนดเอง (`!room.sheet.standard`) ไม่เคยเขียนรายชื่อนักเรียนลงเซลล์ใน Sheet**: ใน `SettingsTab.ts` (`saveRoster()`) โค้ดเดิมสั่ง `pushClassroom()` เฉพาะห้องไฟล์มาตรฐาน (`room.sheet.standard === true`) ส่วนไฟล์กำหนดเองยิงแค่ `syncSpreadsheetSyncMeta()` (ซ่อนใน developerMetadata) จึงไม่เพิ่มแถวนักเรียนใหม่ลง Google Sheet และทำให้เวลาเช็คชื่อ/เช็คงานเกิด Unmatched
2. **`auth` snapshot เก่าใน `SettingsTab.ts`**: ตัวแปร `const auth = getAuthState()` ถูกอ่านครั้งเดียวตอนเปิดแท็บ ทำให้หากสถานะล็อกอินเปลี่ยนทีหลัง การตรวจ `auth.signedIn` อาจคลาดเคลื่อน
3. **ลำดับการเคลียร์ `dirty` และ `render()` ใน `saveRoster()`**: เดิมเรียก `rosterDirty = false; markDirty(); render();` ก่อน `await push...` ทำให้ปุ่มหยุดหมุนก่อนส่งข้อมูลเสร็จ และเสี่ยงโดน `realtimeSync` โพลล์แทรกระหว่างกำลังซิงก์

## สรุปผลการแก้ไข (เฉพาะ `src/classroom/*`)
1. **`src/classroom/googleSheets.ts`**:
   - เพิ่ม `getFormulaValues()` (อ่านค่าแบบ `FORMULA`) เพื่อป้องกันการเขียนทับเซลล์ที่มีสูตร (`=...`)
   - เพิ่ม `splitThaiFullName()` รองรับการแยก `คำนำหน้า / ชื่อ / นามสกุล` กรณี Google Sheet แยกคอลัมน์ (`nameMode === 'split'`)
   - เพิ่ม `pushCustomRosterToSheet(classroomId, previousStudents)` และ `syncStudentsToCustomTab()`:
     - อัปเดตแท็บรายชื่อหลัก (`roster`) ก่อน เพื่อให้สูตรดึงชื่อในแท็บอื่นทำงานอัตโนมัติ จากนั้นจึงตรวจสอบแท็บ `attendance` และ `assignments` ที่แยกแท็บ (หากมีสูตรดึงชื่อแล้วจะไม่เขียนทับ)
     - จับคู่นักเรียนเดิมจากรหัส/ชื่อ (รวมถึงข้อมูลก่อนแก้จาก `previousStudents`) เพื่ออัปเดตเซลล์ที่เปลี่ยนโดยข้ามเซลล์ที่เป็นสูตร
     - เพิ่มแถวนักเรียนใหม่ต่อท้ายนักเรียนคนสุดท้าย: หากมีแถวสรุป/สูตร (เช่น แถว "รวม") ขวางอยู่ จะใช้ `insertDimension` แทรกแถวใหม่ (`inheritFromBefore: true`) เพื่อไม่ทับแถวสรุปและไม่ทำลายสูตร ส่วนแถว template ที่รันเลขที่รอไว้ล่วงหน้าจะเขียนเติมให้โดยไม่ทับสูตรเลขที่
     - ใช้ `valueInputOption: 'RAW'` และรองรับไฟล์ที่ `room.sheet.roster === null` (เดาหัวตารางด้วย `guessHeaderRow`/`guessMapping` หรือเขียนหัวตารางมาตรฐานกรณีชีตว่าง)
   - อัปเดต `pushClassroom()` ให้เรียก `pushCustomRosterToSheet()` สำหรับไฟล์กำหนดเองด้วยเมื่อกดซิงก์
2. **`src/classroom/components/SettingsTab.ts`**:
   - เปลี่ยนมาใช้ `getAuthState()` สดผ่าน `getAuth()` ทุกจุด (`rosterHtml`, `googleHtml`, `loadMeta`, `saveRoster`, `saveMapping`)
   - ปรับ `saveRoster()` ให้อ่าน `prevStudents` และ `freshRoom` ล่าสุด, เรียก `pushCustomRosterToSheet()` สำหรับไฟล์กำหนดเองพร้อมแจ้งจำนวนที่เพิ่ม/อัปเดตหรือข้อผิดพลาดชัดเจน, ล้าง `valuesCache` แล้วโหลดพรีวิวใหม่, และย้าย `rosterDirty = false; markDirty(); render();` ไปทำหลังซิงก์เสร็จ

## การตรวจสอบ (Verification)
- Isolation Check: แก้ไขเฉพาะ 2 ไฟล์ใน `src/classroom/*` (`googleSheets.ts`, `SettingsTab.ts`) ไม่แตะระบบหลัก EduPlan AI
- Build Check: `npm.cmd run build` (`tsc && vite build`) ผ่าน 100% (Exit Code 0)
- Zero Emoji Check: `0` รายการในไฟล์ที่แก้ไข
- Unit Assertions: ทดสอบ `splitThaiFullName()` ครบทุกเคสคำนำหน้าไทยและชื่อเดี่ยวผ่านทั้งหมด

---

# บันทึกการปรับ Mobile Responsive สำหรับ EduPlan Class (ReviewIDE.md)
**EduPlan Class — Mobile Full-Line Name Readability & Responsive Layout**
- วันที่และเวลา: 2026-11-19 14:08 (UTC+7)

## ปัญหาเดิมบนหน้าจอโทรศัพท์
1. ตารางเช็คชื่อ (`AttendanceTab.ts`) และตารางตรวจงาน/คะแนน (`AssignmentsTab.ts`) เรียง 4–5 คอลัมน์แนวนอนที่มีความกว้างคงที่ ทำให้ช่อง `ชื่อ-นามสกุล` ถูกบีบจนคำตกบรรทัดเป็นท่อนๆ อ่านไม่เต็มบรรทัด และต้องเลื่อนซ้าย-ขวา
2. ตารางแก้ไขรายชื่อ (`SettingsTab.ts` และ Create Wizard ใน `ClassroomHub.ts`) บีบช่อง `<input>` ชื่อจนพิมพ์/อ่านไม่เห็นเต็มบรรทัด
3. แถบ `TopBar`, `Workspace Header`, `Tabs`, `Session Bar`, และ `Sticky Footer` เรียงตัวไม่สมมาตร ซ้อนสูงเกินไปบนมือถือ และมีบาง badge ที่ตั้ง `white-space: nowrap` เสี่ยงล้นขอบจอ

## สรุปผลการแก้ไข (เฉพาะ `src/classroom/*`)
1. **เพิ่ม Semantic Classes สำหรับ Mobile Card Layout**:
   - `src/classroom/components/AttendanceTab.ts`: เพิ่ม `.cr-table-wrap--cards`, `.cr-table--att-check`, `.cr-cell-no`, `.cr-cell-code`, `.cr-cell-name`, `.cr-cell-status`
   - `src/classroom/components/AssignmentsTab.ts`: เพิ่ม `.cr-table-wrap--cards`, `.cr-table--asg-check`, `.cr-cell-no`, `.cr-cell-code`, `.cr-cell-name`, `.cr-cell-status`, `.cr-cell-score`
   - `src/classroom/components/SettingsTab.ts` และ `src/classroom/components/ClassroomHub.ts`: เพิ่ม `.cr-table-wrap--edit-cards`, `.cr-table--edit-roster`, `.cr-table--edit-wizard`, `.cr-edit-*`
   - `src/classroom/components/TopBar.ts`: เพิ่มคลาสเดียวกันให้ตารางจำลองในโหมด Tutorial
2. **ปรับ Responsive CSS (`src/classroom/classroom.css`)**:
   - **Mobile Student Cards (`<= 768px`)**: แปลงตารางเช็คชื่อและตรวจงานเป็นการ์ดรายคน โดยวางเลขที่แบบป้าย 36×36px ด้านซ้าย และขยายชื่อ-นามสกุลเต็มความกว้างที่เหลือ (`16px`, `font-weight: 700`, `word-break: keep-all`) ให้อ่านเต็มบรรทัด วางรหัสนักเรียนไว้ใต้ชื่อ (ซ่อนอัตโนมัติเมื่อว่าง) ปุ่มสถานะเต็มความกว้าง (`40px`) และแถวกรอกคะแนนแบบมีป้ายกำกับชัดเจน (`font-size: 16px` กัน iOS Safari auto-zoom)
   - **Mobile Roster Edit Cards (`<= 768px`)**: แปลงตารางแก้ไขรายชื่อเป็นการ์ด โดยจัดเลขที่/รหัส/ปุ่มจัดการไว้ด้านบน และขยายช่อง `<input>` ชื่อ-นามสกุลกว้างเต็ม 100%
   - **Mobile Layout (`<= 640px` & `<= 374px`)**:
     - เพิ่ม `overflow-x: clip` บน `body.cr-body` ป้องกันหน้าจอเลื่อนซ้าย-ขวา และปลด sticky บน `.cr-topbar` เฉพาะมือถือเพื่อเพิ่มพื้นที่มองเห็นรายชื่อ
     - จัด `.cr-ws-bar__right`, `.cr-hub-hero__actions`, `.cr-subnav`, `.cr-sticky-footer__sum` เป็น Grid 2 คอลัมน์สมมาตร (ปุ่มสุดท้ายที่อยู่เดี่ยวขยายเต็มแถว)
     - ปรับ `.cr-tabs` แสดงครบทุกแท็บในแถวเดียว (ไอคอนบน+ข้อความล่าง) ประหยัดพื้นที่แนวตั้ง
     - จัด `.cr-session-bar` เป็น Grid 2 คอลัมน์ (รอบเช็คชื่อเต็มแถว / วันที่คู่กับคาบเรียน 50-50 / โหมดหัวช่อง ตัวอย่าง และปุ่มลัดเต็มแถว)
     - ปรับ `.cr-modal`, `.cr-toasts`, `.cr-badge`, `.cr-collab-*` ให้พอดีจอมือถือทุกขนาด โดยไม่กระทบ Layout บน Desktop (`> 768px`)

## การตรวจสอบ (Verification)
- `npm.cmd run build` (`tsc && vite build`): ผ่าน 100% (Exit Code 0)
- Emoji check ในไฟล์ที่แก้ไขทั้ง 6 ไฟล์: `0` รายการ
- Scope Isolation: แก้ไขเฉพาะ 6 ไฟล์ใน `src/classroom/*` ไม่แตะระบบหลัก EduPlan AI

---

# บันทึกการแก้ไขบั๊กระบบเช็คงานข้ามคอลัมน์ (ReviewIDE.md)
**EduPlan Class — Assignment Column Allocation & `assignmentStartCol` Sync Fix**
- วันที่และเวลา: 2026-11-19 12:12 (UTC+7)

## สาเหตุของปัญหา
1. `pushCustomColumn()` ใน `src/classroom/googleSheets.ts` หาคอลัมน์ถัดไปด้วย `Math.max(m.startCol - 1, ...allUsed) + 1` โดยเก็บคอลัมน์หัวตารางที่ไม่ว่างทุกตัวจนสุดแถว (`hRow.length`) ส่งผลให้หากมีคอลัมน์สรุปท้ายชีต (เช่น รวมคะแนน/เกรด คอลัมน์ W) ระบบจะกระโดดข้ามช่องว่าง F, G ไปเขียนที่คอลัมน์ X, Y ทันที
2. `firstEmptyCol()` และ `defaultMapping()` ใน `src/classroom/components/SettingsTab.ts` หา `last + 1` และบวก `+ 20` แบบ hardcode เมื่ออยู่แท็บเดียวกับการเช็คชื่อ ทำให้ค่าเริ่มต้นกระโดดไปคอลัมน์ X
3. `SettingsTab.ts` ยังไม่ได้บันทึกค่า `assignmentStartCol` (แบบ `Number`) ลง Dexie (`classrooms`) และ Google Drive `properties` (`eduplan_asg_start_col`) โดยตรง และ `AssignmentsTab.ts` ยังไม่ได้ดึงค่า `assignmentStartCol` ล่าสุดของห้องมาใช้ตอนสร้างงาน/บันทึกคะแนน รวมถึงไม่อัปเดต `a.sheetColumn` กลับเข้า object หลัง `pushAssignment()`

## สรุปผลการแก้ไข
1. **แปลงและอ่านค่าคอลัมน์แบบ Number เสมอ (`src/classroom/types.ts`)**
   - เพิ่ม `assignmentStartCol?: number` ใน `Classroom` และ `colsPerAssignment?: 1 | 2` ใน `AssignmentSheetMapping`
   - เพิ่มตัวช่วย `parseColumnIndex(raw, fallback)` รองรับทั้งตัวเลข 0-based, สตริงตัวเลข และตัวอักษร A1 (`"F"`, `"F, G"`, `"AA"`) แปลงเป็น `Number` เสมอ และ `getRoomAssignmentStartCol(room)`
2. **เปลี่ยนวิธีหาคอลัมน์ว่างเป็นสแกนจาก `startColIndex` (`src/classroom/googleSheets.ts`)**
   - เพิ่มและ export `findNextAvailableAssignmentColumn(sheetRows, headerRowIndex, startColIndex, columnsPerItem = 1, reservedCols?)` แปลง `startColIndex` เป็น `Number` และวนหาช่องว่างแรกตั้งแต่ `startColIndex` โดยไม่ใช้ `values.append` หรือ `headerRow.length` และรองรับการตรวจคู่คอลัมน์ว่าง (`col` และ `col + 1`) สำหรับโหมด 2 คอลัมน์ (สถานะ + คะแนน)
   - ปรับ `pushCustomColumn()`, `pushAssignment()`, `pushClassroom()`, `pushStandardAll()` ให้ใช้ `findNextAvailableAssignmentColumn` และเขียนลงพิกัด A1-Notation ตรงๆ ด้วย `values:batchUpdate` (`valueInputOption: 'RAW'`) รวมถึงรองรับการย้ายกลับจากคอลัมน์ที่หลุดขอบ/ถูกลบหัวตารางแล้ว
   - เพิ่ม `eduplan_asg_start_col`, `eduplan_asg_cols`, `eduplan_att_start_col` ใน `buildDrivePropertiesPayload()` และ normalize ค่าตัวเลขใน `pullClassroomFromSheet()` / `buildSharedRoomObject()` / `syncSpreadsheetSyncMeta()`
3. **การบันทึก/พรีวิวคอลัมน์และการใช้งานจริง (`src/classroom/components/SettingsTab.ts`, `src/classroom/components/AssignmentsTab.ts`)**
   - `SettingsTab.ts`: ปรับ `firstEmptyCol()`, `defaultMapping()`, `projectColumns()` ให้ใช้ `findNextAvailableAssignmentColumn()` (ตัดการหา `last + 1` และ `+ 20` ออก), แปลงค่าทุก index ด้วย `parseColumnIndex()` และใน `saveMapping()` บันทึก `room.assignmentStartCol = Number(cleanAsg.startCol)` ลง Dexie + ยิง `syncClassroomDriveProperties(room)` ลง Google Drive `properties`
   - `AssignmentsTab.ts`: เพิ่ม `resolveAssignmentStartCol()` ดึงค่าห้องล่าสุดจาก Dexie (`getClassroom`) และส่ง `{ startCol: Number(assignmentStartCol) }` ให้ `pushAssignment()` ทั้งตอนสร้าง/แก้ไขงานและบันทึกคะแนน พร้อมซิงก์ `Object.assign(a, updated)` หลัง push สำเร็จ

## การตรวจสอบ (Verification)
- Isolation Check (`git status`): แก้ไขเฉพาะ 4 ไฟล์ใน `src/classroom/*` ไม่แตะระบบหลัก EduPlan AI
- Build Check: `npm.cmd run build` (`tsc && vite build`) ผ่าน 100% (Exit code 0)
- Unit Assertions: ตรวจสอบ `parseColumnIndex` และ `findNextAvailableAssignmentColumn` ทั้งเคสคอลัมน์ท้ายชีตไม่ว่าง (W='รวมคะแนน'), โหมด 1 คอลัมน์ (F -> G) และโหมด 2 คอลัมน์ (F,G -> H,I) ผ่านทั้งหมด

---

# บันทึกการปรับ EduPlan Class สู่ Public Mode และ Privacy Policy (ReviewIDE.md)
**EduPlan AI & EduPlan Class — Public OAuth Verification Readiness**
- วันที่และเวลา: 2026-11-18 22:03 (UTC+7)

## สรุปผลการแก้ไขตามข้อกำหนด
1. **ปรับ OAuth Scopes เป็น Public-Safe (`src/classroom/googleAuth.ts`)**
   - ถอด `'https://www.googleapis.com/auth/drive.metadata.readonly'` และ `'https://www.googleapis.com/auth/spreadsheets'` ออกจาก `SCOPES` คงไว้เฉพาะ 5 Scopes ที่เปิดสาธารณะได้ไม่จำกัดผู้ใช้ (`openid`, `email`, `profile`, `https://www.googleapis.com/auth/drive.file`, `https://www.googleapis.com/auth/drive.appdata`)
   - ปรับ `SCOPE_VERSION = 4` และ `hasGrantedAllScopes(resp, SCOPES[3], SCOPES[4])`
2. **ระบบรับและซิงก์ห้องเรียนร่วมภายใต้สิทธิ์ `drive.file` (`src/classroom/googleSheets.ts`, `src/classroom/components/ClassroomHub.ts`)**
   - เพิ่มระบบจัดการไฟล์ `eduplan_shared_rooms.json` ใน `appDataFolder` ด้วยตัวช่วยใช้ร่วมกัน (`findAppDataFileByName`, `readAppDataJson`, `writeAppDataJson`, `withSharedManifestLock`, `addSharedRoomIdToAppData`, `removeSharedRoomIdFromAppData`)
   - ปรับ `importSharedRoomViaPicker()` และ `pickSpreadsheet()` ให้เปิด Google Picker (`ViewId.SPREADSHEETS` พร้อมแท็บ "แชร์กับฉัน" `setOwnedByMe(false)`) แล้วบันทึก `fileId` ลง `eduplan_shared_rooms.json` และ Dexie
   - ปรับ `fetchSharedClassroomsImpl()` ให้โหลดรายการ `fileId` จาก `eduplan_shared_rooms.json` และยิง `GET /drive/v3/files/{fileId}?fields=id,name,modifiedTime,owners(emailAddress,displayName),properties,trashed,capabilities(canEdit)` เพื่ออัปเดตสิทธิ์ (`viewer` / `assistant` / `creator`) อัตโนมัติ และลบออกทันทีเมื่อไฟล์ถูกลบ (`trashed`) หรือถูกถอนสิทธิ์ (`404` / `403`) รวมถึงลบออกจาก manifest เมื่อกด `leaveSharedClassroom()`
   - ปรับข้อความแนะนำตอน Reconnect ใน `src/classroom/components/ClassroomHub.ts` และรีเซ็ต `lastSharedFetchAt` เมื่อออกจากระบบ
3. **คำแนะนำสำหรับผู้ร่วมสอนและหน้าจอ Unverified App (`src/classroom/components/CollaboratorModal.ts`, `src/classroom/components/TopBar.ts`, `src/classroom/types.ts`, `src/classroom/classroom.css`)**
   - เพิ่มข้อความแนะนำใต้รายชื่อผู้ร่วมสอนใน `CollaboratorModal.ts` แจ้งให้ผู้ถูกเชิญกดปุ่ม `'รับห้องเรียนที่ถูกแชร์'`
   - เพิ่มไอคอน Vector SVG `bulb` ใน `src/classroom/types.ts` และข้อความคำแนะนำข้างปุ่ม Google Sign-In ใน `TopBar.ts` (กรณีขึ้นเตือน Google ยังไม่ได้ยืนยันแอปนี้) พร้อมสไตล์ใน `classroom.css`
4. **สร้าง Privacy Policy และเพิ่มลิงก์ Footer (`public/privacy.html`, `index.html`, `classroom.html`)**
   - สร้าง `public/privacy.html` ธีม `EDUPlan` (ฟอนต์ `Sarabun`, `#F8FAFC`, `#FFFFFF`, `#E2E8F0`, `#2563EB`) เนื้อหาครบทั้งภาษาไทยและภาษาอังกฤษ ตรงตาม 5 OAuth Scopes, Zero-Server Storage, ข้อความมาตรฐาน `Google API Services User Data Policy (Limited Use)`, ลิงก์เพิกถอนสิทธิ์ `https://myaccount.google.com/permissions` และอีเมลติดต่อ `thianrawit.9347@gmail.com`
   - เพิ่ม `<a href="./privacy.html">นโยบายความเป็นส่วนตัว (Privacy Policy)</a>` ที่ Footer ของ `index.html` และ `classroom.html`
5. **การตรวจสอบความถูกต้องและขอบเขต (Strict Isolation & Build Verification)**
   - ไม่มีการแก้ไขไฟล์ระบบหลัก `EduPlan AI` (`src/main.ts`, `src/config.ts`, `src/curriculum.ts`, `src/gemini.ts`, `src/types.ts`, `src/templates.ts`, `src/exporter.ts`, `src/rubricExporter.ts`, `src/longTermExporter.ts`, `src/longTermModule.ts`, `public/data/curriculum.json`, `vite.config.ts`, `worker/worker.js`)
   - คง `valueInputOption: 'RAW'`, `safeHttpsUrl()` และฟังก์ชัน Tutorial (`startTutorialTour` / `maybeShowFirstVisitTutorial`) ครบถ้วน
   - สแกนอีโมจิใน `src/classroom/*` และ `classroom.html` = `0` รายการ
   - รัน `npx.cmd tsc --noEmit` และ `npm.cmd run build` ผ่านสมบูรณ์ (`Exit Code 0`, สร้าง `dist/privacy.html` เรียบร้อย)

---

# บันทึกการส่งมอบงานและการ Push โค้ดขึ้น GitHub (ReviewIDE.md)
**EduPlan AI — Production Git Synchronization**
- วันที่และเวลา: 2026-11-18 21:49 (UTC+7)
- Remote Repository: `https://github.com/Thianrawit/EDUPlan.git`
- Branch: `main`

---

## 1. ผลการตรวจเช็คและการ Push โค้ด (Git Sync)
- ตรวจสอบ `git status` พบไฟล์ `public/googled1de89f0001188ac.html` (Google Search Console Site Verification)
- ทำการ commit และ push ขึ้น remote `origin/main` เรียบร้อย:
  - Commit hash: `cd9429b` (`chore: add Google Search Console site verification file`)
  - Commit ล่าสุดก่อนหน้า: `1d9adde` (`feat(batch): add docx course structure parser, BYOK fast batch queue, zip export, and XSS hardening`)
- ตรวจสอบ `git status`: Working tree clean, up to date with `origin/main`.

---

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

---

## 20. สรุปสาเหตุและแนวทางแก้ไข Google Client ID บน GitHub Pages

### 20.1 สาเหตุที่แท้จริง
- Vite ประมวลผลตัวแปรแวดล้อม (`import.meta.env.VITE_*`) แบบ Static Replacement ในขั้นตอน `npm run build`
- บนเครื่อง Local มีไฟล์ `.env` ทำให้รันในเครื่องได้ปกติ แต่ไฟล์ `.env` ถูกกันไว้ด้วย `.gitignore` เพื่อความปลอดภัย
- เมื่อ GitHub Actions ดึงโค้ดไป Build บน Ubuntu Runner จึงไม่มีไฟล์ `.env` ส่งผลให้ `VITE_GOOGLE_CLIENT_ID` มีค่าว่าง (`""`)
- ระบบ `googleAuth.ts` ได้วางมาตรการ Graceful Fallback ดักจับกรณีนี้ไว้ โดยเปลี่ยนปุ่มเป็นสถานะแจ้งเตือน *"ยังไม่ได้ตั้งค่า Google Client ID (ใช้งานโหมดในเครื่องได้ปกติ)"* แทนการทำให้แอปล่ม

### 20.2 การกำหนดค่าความปลอดภัยที่แนะนำ (Zero Secret Leak & Restricted Origin)
1. **OAuth 2.0 Web Client ID**:
   - เป็น Public Identifier ของ Client Application
   - ควบคุมความปลอดภัยผ่าน Google Cloud Console ด้วย **Authorized JavaScript origins** (`https://thianrawit.github.io`)
2. **Google API Key**:
   - ควบคุมผ่าน **Application restrictions** (HTTP Referrers: `https://thianrawit.github.io/*`)
   - ควบคุมผ่าน **API restrictions** (จำกัดเฉพาะ `Google Sheets API`, `Google Picker API`, `Google Drive API`)
3. **GitHub Repository Environment Variables**:
   - ตั้งค่าผ่าน GitHub Repo `Settings > Secrets and variables > Actions > Variables`
   - ตัวแปร: `VITE_GOOGLE_CLIENT_ID` และ `VITE_GOOGLE_API_KEY`
   - GitHub Workflow (`.github/workflows/deploy.yml`) รองรับการ Inject ตัวแปรทั้งจาก `secrets` และ `vars` เข้าไปในขั้นตอน Build โดยอัตโนมัติ

---

## 21. อัปเดตเอกสารสรุประบบ can.md ฉบับสมบูรณ์ (Version 3.0.0)

### 21.1 การปรับปรุงโครงสร้างเอกสาร can.md
- ทำการปรับปรุงเอกสาร `can.md` ใหม่ทั้งหมด 100% ให้ครอบคลุมทุกโมดูลที่พัฒนาเพิ่มขึ้นมาจนถึงปัจจุบัน (เวอร์ชัน 3.0.0 พฤศจิกายน 2026):
  1. **สถาปัตยกรรมระดับสูง (System Architecture)**: Client-Side Heavy (Zero-Database) + Dexie IndexedDB + SheetJS + Google Identity Services (GIS) + Google Drive/Sheets Sync + Cloudflare Worker Serverless AI Gateway (Multi-Key 1-10, Waterfall Fallback)
  2. **หน้าหลัก 2x2 Grid Hub**: แถวที่ 1 `[สร้างแผนการสอน วPA, สร้างเกณฑ์รูบริก]` / แถวที่ 2 `[สร้างโครงการระยะยาว, EduPlan Class]`
  3. **โมดูล 1: แผนการสอน 11 หัวข้อ วPA**: Dual-Mode Input (Wizard 10 ขั้น / All-in-One Form), `curriculum.json` 2,598 ตัวชี้วัด, หน้าพรีวิว A4 เสมือนจริง ฟอนต์ TH SarabunPSK 16pt, Contenteditable, AI Refine, Word Export 9,000 DXA
  4. **โมดูล 2: เกณฑ์รูบริกสกอร์ (Rubric)**: สกัด `.docx` บนเบราว์เซอร์ด้วย `mammoth.js`, สังเคราะห์ K-P-A Descriptors 3-5 ระดับ, ตารางเกณฑ์คะแนนไร้ขอบ, Word Export
  5. **โมดูล 3: โครงการจัดการเรียนรู้ / แผนระยะยาว (Course Syllabus)**: Wizard 10 ขั้น, เอกสารราชการ 5 ส่วนมาตรฐาน (คำอธิบายรายวิชา, โครงสร้างรายวิชา, แผนรายสัปดาห์, วิธีเก็บคะแนน 80/20, เกณฑ์ตัดสินผลการเรียน), Word Export พร้อมฟังก์ชันล้างสระลอยวรรคขาด `cleanThaiText()`
  6. **โมดูล 4: EduPlan Class (ระบบจัดการห้องเรียน classroom.html)**:
     - Offline-First Dexie IndexedDB (7 ตาราง)
     - นำเข้า/ส่งออก Excel (.xlsx) และ Smart Column Mapper แบบแยกสี 6 เฉดสี
     - เช็คชื่อรายวัน/รายคาบ และระบบตรวจงานรายคนพร้อมแถบ Progress Bar
     - Master Roster Editor พร้อมปุ่มรันเลขที่ใหม่อัตโนมัติ (1-N)
     - Google OAuth & Real-time Sheets Sync ป้องกัน Formula Injection (`RAW`)
     - Spotlight Interactive Tour 23 สเต็ป บน Dummy Sandbox Stage
     - Two-Tier TopBar & Contextual Back Navigation
  7. **สถาปัตยกรรมความปลอดภัย**: Zero Hardcoded Secret, Authorized JavaScript Origins, HTTP Referrers & Scope Restrictions, Sanitization ป้องกัน XSS
  8. **ผังไฟล์ในโปรเจกต์ (Project Directory & Inventory)**: แจกแจงไฟล์ทั้งหมดใน `src/`, `src/classroom/`, `worker/`, `public/`
  9. **การวิเคราะห์ทางเทคนิค**: แจกแจงข้อดี 5 ข้อ, ข้อจำกัด 3 ข้อ และข้อแนะนำในอนาคต (PWA, Chunk หลักสูตร, ดึง Google Classroom) 4 ข้อ

### 21.2 ผลการตรวจสอบ
- รัน `npm.cmd run build` ผ่านสมบูรณ์ (Exit code: 0) ทั้ง `dist/index.html` และ `dist/classroom.html`

---

## 22. อัปเกรด EduPlan Class (v3.0.0) — ระบบจัดการห้องเรียนร่วม (Collaborators & RBAC) และ Real-time Sync

### 22.1 การตรวจสอบกฎเหล็ก (Strict Isolation & Compatibility)
- **ไฟล์ระบบหลัก EduPlan AI ไม่ถูกแตะต้อง 100%**: `index.html`, `src/main.ts`, `src/style.css`, `src/config.ts`, `src/curriculum.ts`, `src/gemini.ts`, `src/types.ts`, `src/templates.ts`, `src/exporter.ts`, `src/rubricExporter.ts`, `src/longTermExporter.ts`, `src/longTermModule.ts`, `public/data/curriculum.json`, `vite.config.ts`, `worker/worker.js`
- **รักษาโครงสร้างเดิมของ `src/classroom/`**: คงตาราง Dexie IndexedDB แบบ Backward-Compatible, คงการใช้ SheetJS (`xlsx`), คงการทำงานของ Spotlight Tutorial 23 สเต็ป และ Two-Tier TopBar, และบังคับ `valueInputOption: 'RAW'` กับ `safeHttpsUrl()` ทุกจุด

### 22.2 รายการไฟล์ที่สร้างใหม่และแก้ไขใน `src/classroom/`
1. **`src/classroom/types.ts`**:
   - เพิ่ม `ClassroomRole = 'owner' | 'creator' | 'assistant' | 'viewer'` และ `Collaborator`
   - เพิ่มฟิลด์ `role`, `ownerEmail`, `collaborators`, `myPermissionId`, `lastModifiedTime` ใน `Classroom`
   - เพิ่ม `ROLE_BADGE_LABEL`, `COLLAB_ROLE_OPTIONS`, และ `getEffectiveRole()`
2. **`src/classroom/db.ts`**:
   - เพิ่ม `replaceClassroomCache()` สำหรับแคชโครงสร้างและข้อมูลล่าสุดจาก Google Sheet ลง Dexie
   - เพิ่ม `purgeStaleSharedClassrooms()` ลบแคชห้องร่วมที่ถูกถอนสิทธิ์แล้ว
   - ปรับ `buildSyncSnapshot()` ให้สำรองเฉพาะห้องที่ผู้ใช้เป็น `owner` ลง `appDataFolder`
3. **`src/classroom/googleSheets.ts`**:
   - **Drive Public `properties` & Permissions API v3**:
     - `truncateDriveProperty()` ป้องกัน UTF-8 byte เกิน 124 bytes สำหรับภาษาไทย
     - `syncClassroomDriveProperties()` บันทึก `eduplan_type='classroom'`, `eduplan_room_name`, `eduplan_subject`, และ `collab_1`..`collab_5` (`"email|role"`)
     - `fetchRoomCollaborators()`, `addCollaborator()` (จำกัดสูงสุด 5 คน, `sendNotificationEmail=false`, `reader` สำหรับ `viewer` และ `writer` สำหรับ `assistant`/`creator`), `updateCollaboratorRole()`, `removeCollaborator()`
     - `fetchSharedClassroomsFromDrive()` ค้นหาห้องร่วมด้วย `sharedWithMe = true and trashed = false and properties has { key='eduplan_type' and value='classroom' }` และตรวจสอบสิทธิ์จาก `collab_1`..`collab_5`
     - `leaveSharedClassroom()` ถอนสิทธิ์ตัวเอง (`DELETE /drive/v3/files/{fileId}/permissions/{myPermissionId}`) และลบออกจากคลังทันที
     - `pullClassroomFromSheet()` ดึงรายชื่อ รอบเช็คชื่อ และชิ้นงานล่าสุดจาก Google Sheet มาแคชลง Dexie
   - **Partial Batch Update**:
     - ปรับ `pushAttendanceSession()` และ `pushAssignment()` ให้ใช้ `POST .../values:batchUpdate` (`valueInputOption: 'RAW'`) อัปเดตเฉพาะคอลัมน์ของวันที่หรือชิ้นงานนั้นๆ โดยไม่เขียนทับทั้งแผ่นงาน
4. **`src/classroom/realtimeSync.ts` (สร้างใหม่)**:
   - โพลลิ่งทุก 12 วินาทีเมื่อเปิดหน้าห้องเรียนที่ซิงก์ Google Sheet และแท็บเบราว์เซอร์เปิดอยู่ (`!document.hidden`)
   - ตรวจสอบ `modifiedTime` และ `lastModifyingUser`:
     - กรณี `!isDirty`: ดึงข้อมูลล่าสุดจาก Google Sheet อัปเดตตารางทันที พร้อมแสดง Toast `"🔄 ข้อมูลถูกอัปเดตล่าสุดโดย {email}"`
     - กรณี `isDirty`: ไม่รีเฟรชทับข้อมูลที่กำลังทำค้างไว้ แต่แสดงแถบแจ้งเตือนด้านบนสุดของตาราง `"⚠️ มีการบันทึกข้อมูลใหม่จาก {email} [คลิกเพื่อโหลดข้อมูลล่าสุด]"`
5. **`src/classroom/components/CollaboratorModal.ts` (สร้างใหม่)**:
   - หน้าต่างจัดการผู้ร่วมสอนสำหรับ `owner` (`👥 จัดการผู้ร่วมสอน (X/5)`)
   - รองรับการเพิ่มอีเมล เลือกสิทธิ์ 3 ระดับ (`ผู้ชม`, `ครูผู้ช่วย`, `ครีเอเตอร์`) เปลี่ยนสิทธิ์รายคน และลบออก (ล็อกปุ่มเชิญเมื่อครบ 5 คน)
   - แสดงป้ายแจ้งเตือนหากเป็นห้อง Local Only ว่าต้องเชื่อมต่อ Google Sheet ก่อนจึงจะเชิญผู้ร่วมสอนได้
6. **`src/classroom/components/ClassroomHub.ts`, `AttendanceTab.ts`, `AssignmentsTab.ts`, `SettingsTab.ts`, `main.ts`, `classroom.css`**:
   - แสดงป้ายสิทธิ์บนการ์ดห้องเรียน (`👑 เจ้าของห้อง`, `👁️ ผู้ชม`, `📋 ครูผู้ช่วย`, `🛠️ ครีเอเตอร์`), บรรทัด `เจ้าของห้อง: {ownerEmail}`, และปุ่ม `🚪 ออกจากห้องร่วม`
   - บังคับสิทธิ์ RBAC ครบทุกบทบาท (`viewer` เป็น Read-only, `assistant` ซ่อน `SettingsTab` และซ่อนปุ่มเปิด Google Sheet, `creator` แก้ไขได้ทั้งหมดแต่ไม่เห็นปุ่มจัดการผู้ร่วมสอน, `owner` มีสิทธิ์เต็ม)

### 22.3 วิธีทดสอบระบบ
1. รัน `npx.cmd tsc --noEmit` และ `npm.cmd run build` (ผ่าน 100% Exit Code 0)
2. เปิดหน้า `classroom.html` ล็อกอิน Google สร้างห้องเรียนที่ซิงก์กับ Google Sheet
3. กดปุ่ม **`👥 จัดการผู้ร่วมสอน (0/5)`** ทดสอบเชิญอีเมลด้วยสิทธิ์ `ผู้ชม`, `ครูผู้ช่วย`, หรือ `ครีเอเตอร์` ทดสอบเปลี่ยนสิทธิ์และลบออก
4. ล็อกอินด้วยบัญชีที่ถูกเชิญที่หน้า `ClassroomHub` จะพบการ์ดห้องเรียนที่ถูกเชิญแสดงป้ายสิทธิ์ บรรทัด `เจ้าของห้อง: ...` และปุ่ม `🚪 ออกจากห้องร่วม`
5. ทดสอบเปิดห้องเรียนเดียวกันพร้อมกัน 2 หน้าต่าง เมื่อฝั่งหนึ่งบันทึกการเช็คชื่อหรือคะแนนงาน อีกฝั่งจะอัปเดตอัตโนมัติภายใน 12 วินาที (หรือขึ้นแถบแจ้งเตือน Conflict หากกำลังแก้ไขค้างไว้)

---

## 23. แก้ไขบั๊ก Shared Classroom Discovery & เปลี่ยนไอคอนเป็น Vector SVG 100%

### 23.1 รายการแก้ไขระบบ Shared Classroom Discovery
1. **`src/classroom/googleAuth.ts`**:
   - เพิ่ม Scope `'https://www.googleapis.com/auth/drive.metadata.readonly'` ใน `SCOPES` เพื่อให้ผู้ใช้ที่ถูกเชิญมองเห็นไฟล์ที่ถูกแชร์ (`sharedWithMe = true`) และอ่าน Public `properties` ของไฟล์ได้ทันที
   - เพิ่ม `SCOPE_VERSION = 2` ใน Session Storage Token และตรวจสอบ `hasGrantedAllScopes(resp, SCOPES[3], SCOPES[4], SCOPES[5])` พร้อมขอ `prompt: 'consent'` เมื่อเชื่อมต่อใหม่เพื่ออัปเกรดสิทธิ์อัตโนมัติ
2. **`src/classroom/googleSheets.ts`**:
   - Normalize อีเมลทั้งหมดด้วย `.toLowerCase().trim()` ทั้งตอนบันทึก `collab_1`..`collab_5` ลง `properties` และตอนตรวจสอบสิทธิ์ผู้ใช้ที่ล็อกอินอยู่
   - ปรับ `syncClassroomDriveProperties()` และ `addCollaborator` (`inviteCollaborator`) ให้ยิงทั้ง `POST /permissions?sendNotificationEmail=false` และ `PATCH /drive/v3/files/{fileId}` อัปเดต `properties` พร้อมตรวจสอบ `res.ok` และ `console.error` ชัดเจนหากอัปเดตไม่สำเร็จ
   - ปรับ `fetchSharedClassrooms` (export ทั้ง `fetchSharedClassrooms` และ `fetchSharedClassroomsFromDrive`) ให้ใช้ Query `sharedWithMe = true and trashed = false and mimeType = 'application/vnd.google-apps.spreadsheet'` แล้วกรอง `properties?.eduplan_type === 'classroom'` และ `collab_1`..`collab_5` ฝั่ง JavaScript (พร้อมรักษาห้องที่นำเข้าผ่าน Picker ตราบเท่าที่ยังไม่ถูกถอนสิทธิ์จริง)
   - เพิ่มฟังก์ชัน `importSharedRoomViaPicker()` เปิด Google Picker (`google.picker.ViewId.SPREADSHEETS` พร้อม View `sharedOnly`) ดึง Metadata รวม `capabilities(canEdit)` และกำหนดสิทธิ์จาก `properties` หรือ `capabilities.canEdit` (`assistant` / `viewer`) นำเข้าเป็นห้องร่วมลง Dexie ทันที
   - อัปเดต `fullSync()` ให้เรียก `fetchSharedClassrooms()` ด้วยทุกครั้งที่กด "ซิงก์ข้อมูล" และป้องกันไม่ให้บทบาท `viewer` push ข้อมูลทับ
3. **`src/classroom/types.ts`, `src/classroom/db.ts`, `src/classroom/components/ClassroomHub.ts`, `src/classroom/components/TopBar.ts`, `src/classroom/main.ts`**:
   - เพิ่มฟิลด์ Backward-Compatible `isSharedWithMe`, `importedViaPicker`, `sheetId` ใน `Classroom`
   - ปรับ `purgeStaleSharedClassrooms()` และ `buildSyncSnapshot()` ให้รองรับ `isSharedWithMe` และ `importedViaPicker`
   - เพิ่มปุ่มลัด **`รับห้องเรียนที่ถูกแชร์`** ข้างปุ่ม `+ เพิ่มห้องเรียน` ใน `ClassroomHub.ts` (แสดงเมื่อล็อกอิน Google แล้ว)

### 23.2 เปลี่ยนอิโมจิทั้งหมดเป็นระบบ Vector SVG Icon (`Zero Emoji`)
- เพิ่ม Vector SVG Paths ใน `src/classroom/types.ts`: `crown` (`เจ้าของห้อง`), `wrench` (`ครีเอเตอร์`), `eye` (`ผู้ชม`), `download` (`รับห้องเรียนที่ถูกแชร์`) คู่กับ `clipboard` (`ครูผู้ช่วย`), `users` (`จัดการผู้ร่วมสอน`), `logout` (`ออกจากห้องร่วม`), `warning` / `refresh` (`Real-time Sync Toast & Conflict Banner`)
- เพิ่มฟังก์ชัน `roleBadgeHtml()` และรองรับ `titleIcon` / `toastIcon` ใน `src/classroom/components/ColumnMapperModal.ts` และ CSS alignment ใน `src/classroom/classroom.css`
- ยืนยันการสแกนทั้งโฟลเดอร์ `src/classroom/` ด้วย Script พบจำนวนอิโมจิคงเหลือ `0` รายการ (`Emoji hits: 0`)

### 23.3 ผลการตรวจสอบและวิธีทดสอบ
1. **Isolated Scope Check**: ตรวจสอบ `git status` ไม่มีการแก้ไขไฟล์ในระบบหลัก `EduPlan AI` (`index.html`, `src/main.ts`, `public/data/curriculum.json`, `worker/*` ฯลฯ) แม้แต่ไฟล์เดียว
2. **TypeCheck & Production Build**: รัน `npx.cmd tsc --noEmit` และ `npm.cmd run build` ผ่านสมบูรณ์ Exit Code `0`
3. **วิธีทดสอบฝั่ง Shared Discovery**:
   - เจ้าของห้อง: กดปุ่มจัดการผู้ร่วมสอน เชิญอีเมลด้วยรูปแบบตัวพิมพ์ใหญ่/ช่องว่าง ระบบจะ Normalize เป็นตัวพิมพ์เล็ก แล้วยิง `POST permissions` + `PATCH properties`
   - ผู้ถูกเชิญ: ล็อกอินด้วย Google (หรือกดยินยอมสิทธิ์ `drive.metadata.readonly` เพิ่มเติม) การ์ดห้องเรียนที่ถูกเชิญจะแสดงทันทีใน `ClassroomHub` หรือทดสอบกดปุ่ม **`รับห้องเรียนที่ถูกแชร์`** เพื่อเลือกไฟล์ผ่าน Google Picker ได้โดยตรง

---

## 24. แก้ไข Error HTTP 404 เมื่อเปิดห้องเรียนร่วม (`Requested entity was not found`)

### 24.1 สาเหตุที่แท้จริง (Root Cause)
- Scope `drive.metadata.readonly` อนุญาตให้อ่านเฉพาะ Metadata ของไฟล์ใน `GET /drive/v3/files` (จึงมองเห็นการ์ดห้องร่วมได้)
- แต่ Scope `drive.file` จำกัดให้ Google Sheets API v4 อ่าน/เขียนข้อมูลในตาราง (`GET /v4/spreadsheets/{id}`) ได้เฉพาะไฟล์ที่ผู้ใช้นั้นสร้างเองหรือเลือกผ่าน Google Picker เท่านั้น เมื่อผู้ถูกเชิญกดเปิดการ์ดห้องร่วมที่ค้นพบอัตโนมัติโดยตรง Google Sheets API จึงตอบกลับ **HTTP 404: Requested entity was not found**

### 24.2 การแก้ไขเชิงสถาปัตยกรรม (Dual-Layer Fix)
1. **เพิ่ม Google Sheets Scope ใน `src/classroom/googleAuth.ts`**:
   - เพิ่ม `'https://www.googleapis.com/auth/spreadsheets'` ใน `SCOPES` และปรับ `SCOPE_VERSION = 3` พร้อมรองรับ `signIn(forceConsent)` เพื่อให้บัญชีผู้ถูกเชิญอ่าน/เขียนตาราง Google Sheets ที่ได้รับแชร์ได้ทันทีโดยไม่ติด Error 404 และไม่ต้องเปิด Google Picker ซ้ำทุกไฟล์
2. **เพิ่ม Smart 404 Recovery & Type-Safe Error Handling**:
   - สร้างคลาส `GoogleApiError` และ `isGoogleNotFoundError()` ใน `src/classroom/googleSheets.ts` และให้ `leaveSharedClassroom()` ข้าม Error 404 ของ Permissions API ได้อย่างปลอดภัย
   - เพิ่ม Banner แจ้งเตือนเชื่อมต่อสิทธิ์ใหม่ (`data-hub-reconnect`) และระบบ Fallback เปิด Google Picker 1 คลิกเมื่อพบ HTTP 404 ระหว่างเปิดห้องเรียนร่วมใน `src/classroom/components/ClassroomHub.ts`
3. **ผลการตรวจสอบ**:
   - `Emoji hits: 0` (ปลอดอิโมจิ 100%), `npx.cmd tsc --noEmit` และ `npm.cmd run build` ผ่าน Exit Code `0`

---

## 25. แก้ไขตารางและข้อมูลระหว่างผู้ถูกเชิญกับเจ้าของห้องไม่ตรงกัน (`eduplan_sync_meta` & Exact Row/Mapping Sync)

### 25.1 สาเหตุที่ทำให้ตารางของผู้ถูกเชิญไม่ตรงกับเจ้าของห้อง
1. **การตั้งค่าคอลัมน์ (`SheetMapping`) ไม่ถูกแชร์ข้ามบัญชี**: สำหรับ Google Sheet ที่เชื่อมจากไฟล์เดิมของครู (`standard: false`) เจ้าของห้องเก็บตำแหน่งแถวหัวตาราง (`headerRow`), โหมดแยกชื่อ (`single`/`split`), แท็บและคอลัมน์เช็คชื่อ/ส่งงานไว้เฉพาะใน `appDataFolder` ส่วนตัว ทำให้ฝั่งผู้ถูกเชิญเดาค่าเริ่มต้น (`headerRow = 0`, แท็บ `'การมาเรียน'`/`'การส่งงาน'`) ซึ่งไม่ตรงกับชีตจริงและอ่านหัวตารางติดมาเป็นรายชื่อนักเรียน
2. **การจับคู่แถวแบบลำดับ (`hRowIdx + 1 + i`) แทน Key Tracking**: กรณีตารางกำหนดจับคู่ด้วยรหัสนักเรียน (`code`), เลขที่ (`number`), หรือชื่อ (`name`) ตอนดึงข้อมูล `pullClassroomFromSheet()` เดิมอ่านตามลำดับบรรทัดแทนการจับคู่ด้วยคีย์
3. **การต่อชื่อแบบ Split & ข้อมูลงาน (Metadata)**: ฝั่งผู้ถูกเชิญต่อคำนำหน้า+ชื่อต่างจาก `applyMapping()` ใน `excelService.ts` และขาดวันที่สั่ง กำหนดส่ง คะแนนเต็ม รวมถึง Master Roster

### 25.2 การแก้ไขใน `src/classroom/googleSheets.ts`, `SettingsTab.ts`, `ClassroomHub.ts`, `main.ts`
1. **แชร์คอนฟิกผ่าน Google Sheets `developerMetadata` (`visibility: 'DOCUMENT'`)**:
   - เพิ่มฟังก์ชัน `syncSpreadsheetSyncMeta()` และ `parseSpreadsheetSyncMeta()` บันทึกคีย์ `eduplan_sync_meta` (ขนาดกะทัดรัด ปลอดแท็บขยะ และอ่านได้จากทุกสิทธิ์รวมถึง `viewer`) เก็บ `name`, `subject`, `term`, `academicYear`, `standard`, `roster`, `attendance`, `assignments`, `students` (Master Roster), `sessions`, และ `assignmentsMeta`
   - อัปเดต Metadata อัตโนมัติเมื่อเจ้าของห้องบันทึกเช็คชื่อ/งาน (`pushAttendanceSession`, `pushAssignment`, `pushClassroom`, `upgradeToStandardSheet`), เชิญผู้ร่วมสอน (`addCollaborator`), แก้ไขข้อมูลห้อง/รายชื่อ/คอลัมน์ (`SettingsTab.ts`), สร้างห้อง (`ClassroomHub.ts`), และซิงก์ห้องเดิมอัตโนมัติครั้งแรกเมื่อเจ้าของห้องเปิดห้อง (`main.ts`)
2. **ปรับปรุง `pullClassroomFromSheet()` ให้ตรงกับเจ้าของห้อง 100%**:
   - กู้คืน `SheetMapping`, `term`, `academicYear`, และ `Master Roster` จาก `eduplan_sync_meta` โดยตรง (หากเป็นไฟล์เก่าที่ยังไม่มี `syncMeta` และไม่ใช่ไฟล์มาตรฐาน 3 แท็บ จะตั้ง `standard = false`, ใช้ `guessHeaderRow` + `guessMapping` แทนค่าเดิมที่ผิด และตัดแท็บที่ไม่มีจริงออก)
   - ใช้ `applyMapping()` จาก `excelService.ts` เป็นมาตรฐานเดียวกัน และตัด positional fallback ที่เสี่ยงสลับคนออก
   - เพิ่ม `buildGridRowMap()` จับคู่แถวตาม `keyType`/`keyCol` เหมือนฝั่งเขียน (`resolveRows()`) และคืนค่าวันที่สั่ง/กำหนดส่ง/คะแนนเต็มของงานทุกชิ้น
3. **ผลการตรวจสอบ**: `Emoji hits: 0`, `npx.cmd tsc --noEmit` และ `npm.cmd run build` ผ่าน Exit Code `0`

---

## 26. แก้ไขผู้ถูกเชิญกดเข้าห้องเรียนช้าและต้องกดย้ำหลายครั้ง (Single-Click Instant Open & Render Queue Fix)

### 26.1 สาเหตุที่ทำให้กดเข้าห้องเรียนครั้งเดียวไม่ได้และช้า
1. **Race Condition ใน `render()` (`src/classroom/main.ts`)**: ฟังก์ชัน `render()` เดิมใช้ `if (rendering) return;` ทำให้เมื่อ `onDataChange` หรือการซิงก์พื้นหลังบน Hub สั่งเรนเดอร์ค้างอยู่ แล้วผู้ใช้คลิกเข้าห้องเรียน (`ctx.openRoom(targetId)` -> `navigate()`) คำสั่งเปิดห้องจะถูกทิ้งกลางคันและหน้าจอค้างอยู่บน Hub ต้องกดย้ำอีกครั้ง
2. **การบล็อกการนำทางด้วย `await pullClassroomFromSheet(room)` (`src/classroom/components/ClassroomHub.ts`)**: เดิมผู้ถูกเชิญกดการ์ดแล้วต้องรอเครือข่าย Google API ดึงข้อมูลทุกแท็บแบบ Sequential จนเสร็จก่อนจึงจะสลับหน้า ทำให้เกิดอาการหน่วงและยิ่งเพิ่มโอกาสชนกับ `onDataChange` ของ `replaceClassroomCache()` ที่เด้งกลับมาเรนเดอร์ Hub ซ้ำระหว่างรอ
3. **Hub Re-render Storm & Duplicate Drive Queries (`src/classroom/googleSheets.ts` & `ClassroomHub.ts`)**: `fetchSharedClassrooms()` เดิมเรียก `saveClassroom(room)` ทุกครั้งแม้ข้อมูลห้องร่วมใน IndexedDB จะไม่เปลี่ยน ทำให้ `emit(room.id)` สั่งรื้อ DOM หน้า Hub ซ้ำไปมา รวมถึง `bootstrap()` และ `renderHub()` ต่างคนต่างยิง `fetchSharedClassrooms()` พร้อมกัน

### 26.2 การแก้ไขที่ทำ
1. **คิวเรนเดอร์ที่ไม่ทิ้งการนำทาง (`src/classroom/main.ts`)**:
   - เปลี่ยน `render()` จากการทิ้งคำสั่ง (`if (rendering) return;`) เป็น `do { ... } while (renderQueued)` พร้อมตรวจสอบ `snapshotRoute` ให้สลับไปยังหน้าปลายทางล่าสุดทันทีเมื่อรอบก่อนหน้าจบลง ไม่ตกหล่นคลิกอีกต่อไป
2. **เปิดห้องทันที 0ms + ซิงก์พื้นหลังไม่ซ้ำซ้อน (`ClassroomHub.ts` & `main.ts`)**:
   - ให้คลิกการ์ด `[data-open]` บน Hub เรียก `ctx.openRoom(card.dataset.open!)` ทันทีโดยไม่รอ Network ก่อนเปลี่ยนหน้า
   - ย้ายการดึงข้อมูลห้องร่วม (`ensureSharedPull()`) เข้ามาจัดการภายใน `renderRoomWorkspace()` แบบ Deduplicate ด้วย `activeSharedPulls` และคูลดาวน์ `SHARED_PULL_COOLDOWN_MS` (5 วินาที) พร้อมรองรับ Error 404 เปิด Google Picker 1 คลิก:
     - หากมีข้อมูลแคชแล้ว (`students.length > 0`): แสดงตารางทันทีและขึ้นป้ายสถานะ `[data-shared-sync-pill]` (`กำลังอัปเดตข้อมูล...`) จากนั้นรีเฟรชอัตโนมัติอย่างปลอดภัย (หรือขึ้นแบนเนอร์เตือนถ้ากำลังแก้ไข)
     - หากยังไม่มีข้อมูลในเครื่อง (`students.length === 0`): เปิดหน้าห้องพร้อมแท็บและสปินเนอร์ `.cr-empty` / `.cr-spinner` ทันทีแล้วแสดงผลเมื่อดึงข้อมูลสำเร็จ
3. **ลดการยิง API และลดการเขียน Dexie เกินจำเป็น (`googleSheets.ts` & `ClassroomHub.ts`)**:
   - เพิ่ม `inFlightSharedFetch` ใน `fetchSharedClassrooms()` เพื่อรวมคำขอที่ยิงพร้อมกันเป็น 1 ครั้ง และเพิ่ม `sharedRoomMetaChanged()` + `collabsEqual()` ข้าม `saveClassroom()` หากข้อมูล Metadata ไม่เปลี่ยน
   - ขนานการดึงแท็บ `rosterTab`, `attMap.sheetTitle`, `asgMap.sheetTitle` ใน `pullClassroomFromSheet()` ด้วย `Promise.all` พร้อมเพิ่มคูลดาวน์ `SHARED_FETCH_COOLDOWN_MS` (10 วินาที) ใน `renderHub()`
4. **ผลการตรวจสอบ**:
   - `Emoji hits: 0` (ปลอดอิโมจิ 100%)
   - `npx.cmd tsc --noEmit` ผ่าน Exit Code `0`
   - `npm.cmd run build` ผ่าน Exit Code `0` (สร้าง `dist/classroom.html` และ `dist/index.html` สำเร็จ)

---

## 27. เพิ่มตัวเลือกรูปแบบชื่อหัวคอลัมน์เช็คชื่อ (วันที่ / คาบเรียน-รอบ / ทั้ง 2 แบบ 2 บรรทัด)

### 27.1 การแก้ไขเชิงโครงสร้างข้อมูลและ UI (`types.ts`, `AttendanceTab.ts`, `classroom.css`)
1. **สคีมาและฟังก์ชันจัดรูปแบบใน `src/classroom/types.ts`**:
   - เพิ่ม Type `SessionHeaderMode = 'both' | 'date' | 'period'`
   - เพิ่มฟิลด์ `Classroom.attendanceHeaderMode?: SessionHeaderMode` (จำค่าล่าสุดของห้องเพื่อนำไปใช้ต่อในรอบถัดไป) และ `AttendanceSession.headerMode?: SessionHeaderMode` (รองรับข้อมูลเดิมย้อนหลังแบบ Backward Compatible)
   - เพิ่ม `sessionHeaderText()` สำหรับสร้างข้อความลงเซลล์/หัวคอลัมน์จริง โดยโหมด `'both'` จะขึ้น 2 บรรทัดให้ **คาบเรียนอยู่บรรทัดบน และวันที่ (พ.ศ.) อยู่บรรทัดล่าง** (`${periodText}\n${dateText}`), `'period'` แสดงแค่คาบ, `'date'` แสดงแค่วันที่ และอัปเดต `sessionLabel()` สำหรับการแสดงผลแบบบรรทัดเดียวใน Dropdown/Dialog
2. **ตัวเลือกในหน้าเช็คชื่อและตัวอย่างสด (`src/classroom/components/AttendanceTab.ts` & `classroom.css`)**:
   - เพิ่มกลุ่มปุ่ม `ชื่อหัวช่อง (Sheet / Excel)` (`data-header-mode="both" | "period" | "date"`) ไว้ใน `.cr-session-bar` ต่อจากช่อง `วันที่` และ `คาบเรียน / รอบ` พร้อมกล่อง **ตัวอย่างในช่อง** (`data-header-preview`, `.cr-header-preview`) อัปเดตแบบเรียลไทม์ขณะพิมพ์ชื่อคาบ เปลี่ยนวันที่ หรือสลับรูปแบบ
   - เมื่อเลือกโหมดใหม่จะจำค่าลง `room.attendanceHeaderMode` ใน Dexie (`saveClassroom`) และส่งซิงก์ `scheduleAppDataSync()` เพื่อให้รอบใหม่ของห้องนั้นใช้รูปแบบเดิมต่อเนื่องทันที
   - เพิ่มการตรวจสอบกรณีเลือก `แค่คาบ` แต่ยังไม่ได้กรอกช่อง `คาบเรียน / รอบ` รวมถึงตรวจเช็กรูปแบบหัวช่องซ้ำก่อนบันทึก

### 27.2 การซิงก์ Google Sheets, ตัวอย่างตาราง Settings และ Export Excel
1. **Google Sheets (`src/classroom/googleSheets.ts`)**:
   - อัปเดต `pushStandardAll()`, `pushAttendanceSession()`, และ `pushClassroom()` ให้เขียนหัวคอลัมน์ด้วย `sessionHeaderText()` (คงค่า `\n` 2 บรรทัดผ่าน `valueInputOption: 'RAW'`)
   - ป้องกันคอลัมน์ชนกันใน `pushCustomColumn()` ด้วย `usedLocalSet` กรณีหลายรอบมีชื่อหัวคอลัมน์แสดงเหมือนกัน (เช่น เลือกแสดง `แค่วันที่` ในวันเดียวกันหลายคาบ)
   - อัปเดต `SheetSyncMetaPayload`, `syncSpreadsheetSyncMeta()`, `buildSharedRoomObject()`, `parseSessionHeaderLabel()`, และ `pullClassroomFromSheet()` ให้รองรับการอ่าน-เขียนหัวตารางทั้งแบบ 2 บรรทัด (`คาบ\ndd/mm/yyyy`) คาบอย่างเดียว และวันที่อย่างเดียว รวมถึงจำค่า `attendanceHeaderMode` ข้ามผู้ร่วมสอนได้ครบถ้วน
2. **Excel (.xlsx) & Settings Preview (`excelService.ts`, `SettingsTab.ts`)**:
   - `exportClassroomXlsx()` ใช้ `sessionHeaderText()` ในแท็บ `สรุปการมาเรียน` พร้อมปรับ `ws2.getRow(2).height = 42` เมื่อมีหัวตาราง 2 บรรทัด เพื่อไม่ให้ข้อความถูกตัด
   - `SettingsTab.ts` (`projectColumns`, `previewHtml`, `standardPreview`) แสดงหัวตารางจำลองเป็น 2 บรรทัดด้วย `<br>` และเปรียบเทียบ Conflict กับหัวตารางจริงได้ตรงกัน
3. **ผลการตรวจสอบ**:
   - `Emoji hits: 0` (ปลอดอิโมจิ 100%)
   - `npx.cmd tsc --noEmit` ผ่าน Exit Code `0`
   - `npm.cmd run build` ผ่าน Exit Code `0` (`dist/classroom.html` และ `dist/index.html`)

---

## 28. ตรวจสอบความปลอดภัยก่อนอัปโหลดขึ้น GitHub (Security Audit & GitHub Push)

### 28.1 ผลการตรวจสอบความปลอดภัย
1. **การป้องกันความลับและตัวแปรแวดล้อม (`.env` / CI)**:
   - ยืนยันผ่าน `git check-ignore -v .env .env.local dist` พบว่า `.gitignore` บล็อก `.env`, `.env.*` และ `dist/` ครบถ้วน ไม่มีไฟล์ความลับถูก Track ใน Git (`git ls-files`)
   - สแกนทั้งไฟล์ที่ Track แล้ว (`git grep`) และไฟล์ที่แก้ไข/เพิ่มใหม่ (`Select-String`) ไม่พบการฝัง Key/Token ลับ (`AIza...`, `GOCSPX-...`, `ghp_`, `github_pat_`, `sk-`, Private Key) ในโค้ดหรือเอกสาร
   - `.github/workflows/deploy.yml` ดึงเฉพาะ `VITE_GOOGLE_CLIENT_ID` และ `VITE_GOOGLE_API_KEY` ผ่าน `${{ secrets.* || vars.* }}` และ `vite.config.ts` ปิด Source Map (`sourcemap: false`)
2. **XSS / Open Redirect / Data Injection / Auth**:
   - ตรวจสอบ Sink อันตราย (`eval`, `new Function`, `document.write`, `insertAdjacentHTML`, `outerHTML`, `javascript:`, `data:text/html`) ใน `src/classroom/**/*.ts`: ไม่พบ (`0 matches`)
   - ลิงก์ภายนอกทั้งหมดผ่าน `safeHttpsUrl()` และใส่ `rel="noopener noreferrer"` ครบทุกจุด (`ClassroomHub.ts`, `SettingsTab.ts`, `main.ts`) และข้อความผู้ใช้/ชีตผ่าน `escapeHtml()`
   - การเขียนลง Google Sheets ใช้ `valueInputOption: 'RAW'` (`googleSheets.ts:301`) และการยืนยันตัวตนใน `googleAuth.ts` เก็บ Access Token ชั่วคราวใน `sessionStorage` พร้อมตรวจสอบ Scope (`hasGrantedAllScopes`) และเรียก `revoke()` เมื่อออกจากระบบ
3. **Dependency Audit (`npm.cmd audit --omit=dev`)**:
   - พบ Moderate 2 รายการใน `uuid <11.1.1` (Transient dependency ของ `exceljs` ที่มีอยู่เดิม โดย `npm audit fix --force` จะดาวน์เกรด `exceljs@3.4.0` ซึ่งเป็น Breaking change จึงคงเวอร์ชันเดิมไว้ไม่กระทบระบบหลัก)

### 28.2 สถานะการเตรียมอัปโหลดขึ้น GitHub (`origin/main`)
- ไฟล์ที่ปรับปรุงครอบคลุมเฉพาะโมดูล `src/classroom/*` พร้อมเอกสาร `can.md`, `eduplan_ai_master_prompts.md` และ `ReviewIDE.md` (ไม่ได้แก้ไขโค้ดระบบหลัก `EduPlan AI`)
- ตรวจสอบซ้ำ: `Emoji hits: 0`, `npx.cmd tsc --noEmit` (Exit Code `0`), `npm.cmd run build` (Exit Code `0`)

---

## 29. เพิ่มระบบวิเคราะห์โครงสร้างรายวิชา (.docx) และสร้างแผนการจัดการเรียนรู้แบบชุด (Batch Lesson Plan Generator — BYOK Fast Mode Only)

### 29.1 สถาปัตยกรรมและไฟล์ที่สร้าง/อัปเดต
1. **จุดเข้าเมนูบน Home Hub และด่านบังคับ BYOK (`index.html`, `src/main.ts`, `src/batchStructureView.ts`)**:
   - เพิ่มการ์ดเมนู `สร้างแผนจากโครงสร้างรายวิชา (.docx)` พร้อมป้าย `BYOK • โหมดด่วน` และปุ่ม `สร้างแผนจากโครงสร้าง →` (`#btn-nav-batch-structure`) บนหน้าแรกอย่างสมดุล
   - สร้างด่าน `checkByokAndEnter()` และ `#bs-byok-gatekeeper-modal` ตรวจสอบ `eduplan_use_byok` และ `eduplan_user_api_key` ทันทีที่คลิก หากยังไม่เปิดหรือยังไม่มีคีย์จะแสดง Popup แจ้งเตือนพร้อมปุ่ม `ตั้งค่าระบบ & ใส่ Gemini API Key` ที่เปิด `#settings-modal-overlay`, เปิดสวิตช์ `#byok-toggle` และโฟกัส `#byok-key-input` ทันที
2. **ระบบวิเคราะห์ไฟล์ Word โครงสร้างรายวิชาแบบ 2 ชั้น (`src/structureParser.ts`)**:
   - ใช้ `mammoth.convertToHtml({ arrayBuffer }, { convertImage: ... })` แปลงตารางใน `.docx` เป็น HTML โดยตัดรูปภาพออก
   - **ชั้นที่ 1 (Zero-Token DOM Parser)**: ใช้ `DOMParser` ดึงข้อมูลส่วนหัวรายวิชา (`กลุ่มสาระ`, `รายวิชา`, `รหัสวิชา`, `ชั้น`, `จำนวนชั่วโมง`, `ภาคเรียน`, `ปีการศึกษา`, `ผู้สอน`), ตรวจจับตารางแผนรายสัปดาห์ 8 คอลัมน์, **ยุบรวมแผนที่มีหมายเลขแผนเดียวกันหรือลงท้ายด้วย `(ต่อ)` ข้ามสัปดาห์เข้าด้วยกันอัตโนมัติ** (บวกชั่วโมงรวม, อัปเดต `weekLabel` เช่น `สัปดาห์ที่ 2-3`, รวมหัวข้อ/สาระสำคัญ/วิธีสอน/สื่อ/การวัดผลโดยตัดข้อความซ้ำ), แยกจุดประสงค์ `K:`, `P:`, `A:` และดึงคำอธิบายมาตรฐานการเรียนรู้จาก `public/data/curriculum.json` มาเติมลงใน `standards`
   - **ชั้นที่ 2 (AI Smart Extractor Fallback — Fast Mode Only)**: หากไฟล์ `.docx` ไม่ตรงกับตารางมาตรฐาน 8 คอลัมน์ จะแปลง HTML เป็นตารางข้อความกระชับแล้วยิงผ่าน `callGeminiByokFastOnly()` (`responseMimeType: 'application/json'`) เพื่อสกัดรายการแผนทั้งหมด
3. **หน้าสรุปผล ตรวจสอบ/แก้ไขรายละเอียด และพรีวิว A4 (`src/batchStructureView.ts`)**:
   - แสดงป้ายบอกวิธีวิเคราะห์ (`0 Token` หรือ `AI โหมดด่วน`), สรุปจำนวนแผน, และฟอร์มค่าเริ่มต้นส่วนหัวแผน (ดึงค่าที่เคยกรอกค้างไว้จาก `eduplan_ai_draft` และ `eduplan_longterm_draft` ใน `localStorage`)
   - แถบเครื่องมือ Batch Action: `เลือกทั้งหมด`, `ไม่เลือกทั้งหมด`, `ข้ามแผนปฐมนิเทศ / สอบ`, `สั่งเจนแผนที่เลือกทั้งหมด (Y แผน) • โหมดด่วน`, และ `ดาวน์โหลดทั้งหมดเป็นไฟล์ .zip`
   - หน้าต่าง Inspector Modal (`#bs-inspector-modal`) เปิดดูและแก้ไขข้อมูลตั้งต้นครบทั้ง 9 หมวดรายแผน พร้อมปุ่ม `บันทึกการแก้ไข` และ `บันทึก & เจนแผนนี้ทันที`
   - หน้าต่างพรีวิวกระดาษ A4 มาตรฐาน 11 หัวข้อ (`#bs-a4-preview-modal`) แก้ไขข้อความสด (`contenteditable="true"`) ซิงก์ลง IndexedDB, คัดลอกแยกหัวข้อ 1–11, คัดลอกทั้งแผนสำหรับวางใน Word, และดาวน์โหลด `.docx` รายแผน
4. **ระบบคิวเบื้องหลังและแถบสถานะลอยตัว (`src/batchQueue.ts`, `src/gemini.ts`)**:
   - เพิ่ม `callGeminiByokFastOnly()` ใน `src/gemini.ts` ที่ยิงตรงด้วย API Key ส่วนตัว (BYOK) ในกลุ่มโมเดล `fast` tier เท่านั้น โดยไม่ผ่าน Cloudflare Worker ส่วนกลาง
   - ประมวลผลทีละ 1 แผนตามลำดับคิว หน่วงเวลาพัก 2.5 วินาทีระหว่างแผน, มีระบบ **Auto-Resume เมื่อเจอ HTTP 429** (พักรอ 15 วินาทีพร้อมแสดงเวลานับถอยหลังแล้วทำแผนเดิมต่ออัตโนมัติ), ป้องกันการปิดแท็บด้วย `beforeunload`, และบันทึกผลลง IndexedDB (`eduplan_batch_structure_db`) ทันทีที่เสร็จทีละแผน
   - รองรับการย่อหน้าต่างไปทำงานหน้าอื่นพร้อมแสดง **Persistent Floating Status Bar** (`#batch-floating-status-bar`) มุมขวาล่างของหน้าจอ
5. **ระบบส่งออกไฟล์รวม `.zip` (`src/batchExporter.ts`, `src/exporter.ts`)**:
   - แยกฟังก์ชัน `generateLessonPlanDocxBlob()` ใน `src/exporter.ts` เพื่อใช้สร้างไฟล์ `.docx` มาตรฐานราชการ 11 หัวข้อ (ฟอนต์ `TH SarabunPSK` ขอบ 1 นิ้ว) ร่วมกัน
   - ใช้ `PizZip` และ `file-saver` บีบอัดแผนที่สร้างเสร็จทั้งหมดเป็นไฟล์ `.zip` เดียวในรูปแบบ `แผนที่_01_...docx`
6. **ผลการตรวจสอบ**:
   - `New batch files emoji hits: 0` (ใช้ Vector SVG ทั้งหมด)
   - `npx.cmd tsc --noEmit` ผ่าน Exit Code `0`
   - `npm.cmd run build` ผ่าน Exit Code `0` (`✓ built in 11.61s`)

---

## 30. แก้ไขตัวแยกจุดประสงค์การเรียนรู้ K-P-A กรณีอยู่ในช่องตารางเดียวกัน (`splitKpaObjectives` Fix)

### 30.1 สาเหตุของบั๊ก
- ใน `splitKpaObjectives()` เดิม (`src/structureParser.ts`) เมื่อวนลูปตรวจแต่ละบรรทัดแล้วพบ `K:` ตั้งแต่ต้นบรรทัด Regex `^(?:...K)\s*[:：\-]\s*(.*)$` ได้กวาดข้อความทั้งหมดจนจบแถว รวมถึง `P:` และ `A:` ที่อยู่บรรทัดเดียวกันไปเก็บลงใน `kLines` แล้วสั่ง `continue` จึงไม่เคยไปตรวจ `P:` / `A:` ต่อ (ส่งผลให้ K-P-A ไปกองรวมกันในช่อง K ช่องเดียว)

### 30.2 การแก้ไขที่ทำ
1. **อัปเกรด `splitKpaObjectives()` (`src/structureParser.ts`)**:
   - เปลี่ยนมาใช้ Global Marker Scan ด้วย `markerRegex` ค้นหาตำแหน่งของหมวด K, P, A ทั้งหมดตลอดข้อความ (รองรับทั้งรูปแบบอยู่ในบรรทัดเดียวกัน `[K: ... P: ... A: ...]`, คั่นด้วย `|` หรือช่องว่าง, ไม่มีเว้นวรรคหลังอักษรไทย, รูปแบบภาษาไทย `ด้านความรู้ (K)` / `ด้านทักษะกระบวนการ (P)` / `ด้านคุณลักษณะอันพึงประสงค์ (A)` และแบบแยกหลายบรรทัด) แล้วตัดข้อความระหว่าง Marker ลง `k`, `p`, `a` แยกกันอย่างแม่นยำโดยไม่สับสนกับคำย่อภาษาอังกฤษ เช่น `IP:` หรือ `HTTP:`
2. **กู้คืนข้อมูลแคชเดิมอัตโนมัติ (`src/structureParser.ts` & `src/batchStructureView.ts`)**:
   - ส่งออก (`export`) `splitKpaObjectives()` นำไปแยกซ้ำหาก AI Fallback หรือแคชเดิมที่บันทึกอยู่ใน IndexedDB (`loadLatestBatchJobFromDb`) ยังมี K-P-A รวมอยู่ใน `k_objective` โดยที่ `p_objective`/`a_objective` เป็น `-` ให้แยกออกเป็น 3 ช่องให้อัตโนมัติเมื่อเปิดหน้าเว็บ
3. **ผลการตรวจสอบ**:
   - ทดสอบกับข้อมูลตัวอย่าง K-P-A แบบอยู่ช่องเดียวกัน, คั่นด้วย `|`, หลายบรรทัด และแบบติดกันไม่มีเว้นวรรค: แยกครบทั้ง K, P, A ถูกต้อง
   - `npx.cmd tsc --noEmit` และ `npm.cmd run build` ผ่าน Exit Code `0` (`✓ 423 modules transformed`, `✓ built in 9.34s`)

---

## 31. แก้ไขปัญหา `BYOK_FAILED_404`, HTTP 503 และการค้นหาโมเดล BYOK โหมดด่วนอัตโนมัติ (`src/gemini.ts` & `src/batchQueue.ts`)

### 31.1 สาเหตุที่ทำให้ขึ้น `BYOK_FAILED_404`
1. **ไม่ค้นหาโมเดลจริงที่ API Key นั้นใช้งานได้**: เดิม `callGeminiDirectBYOK()` ไล่ลองเฉพาะรายชื่อโมเดลตายตัว (`gemini-3.5-flash`, `gemini-flash-latest`, `gemini-2.5-flash`, `gemini-2.0-flash`, `gemini-1.5-flash`) ซึ่งโมเดลเก่าบางตัวถูก Google ปิดแล้ว (`404`)
2. **Error 404 จากโมเดลสำรองไปทับสาเหตุจริง (HTTP 503 / Network Error)**: เมื่อโมเดลหลักอย่าง `gemini-3.5-flash` ตอบ `503` (เซิร์ฟเวอร์หนาแน่นชั่วคราว) หรือเกิด `ERR_CONNECTION_CLOSED` / `ERR_NAME_NOT_RESOLVED` ระบบวนไปเจอ `404` ของโมเดลถัดไปแล้วนำ `lastStatus = 404` ไปแสดงเป็น `BYOK_FAILED_404` ทำให้ดูเหมือนคีย์ไม่มีโมเดลและไม่ทำการกู้คิว
3. **`batchQueue.ts` กู้คิวเฉพาะ HTTP 429**: เมื่อเจอ `503` หรือเน็ต/DNS สะดุดชั่วคราว แผนจึงหลุดเป็นสถานะ `error` ทันทีโดยไม่หน่วงรอและลองใหม่

### 31.2 การแก้ไขที่ทำ
1. **Dynamic Model Discovery & Session 404 Cache (`src/gemini.ts`)**:
   - เพิ่ม `discoverModelsForKey()` เรียกใช้ `fetchTextOutModels()` ดึงรายการโมเดลจริงที่ Key ของผู้ใช้มีสิทธิ์ใช้งานจาก Google `/v1beta/models` (แคชในหน่วยความจำ 10 นาที และกรองเฉพาะโมเดลตระกูล `flash` สำหรับโหมดด่วนโดยตัด `pro` และ `thinking` ออก)
   - เพิ่ม `dead404ModelsCache` จำโมเดลที่เคยตอบ `404` ต่อ Key เพื่อข้ามทันทีไม่ยิงซ้ำให้เสียเวลา
   - แยก Flag สถานะ `saw503`, `saw429`, `sawNetworkError`, `saw404` อย่างอิสระ ไม่ให้ `404` จากโมเดลสำรองมาทับข้อความ Error จริงของ `503` / `429` / Network Drop พร้อมเข้ารหัส `encodeURIComponent` ของ Key และ Model URL อย่างถูกต้อง
2. **Smart Auto-Resume สำหรับ 429 / 503 / Network Blip (`src/batchQueue.ts`)**:
   - ปรับ `startBatchGeneration()` ให้กู้คืนและลองใหม่อัตโนมัติ (สูงสุด 4 ครั้งต่อแผน) เมื่อเจอทั้ง `429` (พัก 15 วินาที), `503` (พัก 8 วินาที), และ Network/DNS Error ชั่วคราว (พัก 8 วินาที) พร้อมแสดงสาเหตุและเวลานับถอยหลังบนแถบสถานะลอยตัว (`pauseReason`)
3. **ผลการตรวจสอบ**:
   - `Emoji hits: 0`
   - `npx.cmd tsc --noEmit` และ `npm.cmd run build` ผ่าน Exit Code `0` (`✓ 423 modules transformed`, `✓ built in 9.53s`)

---

## 32. ตรวจสอบความปลอดภัยและแก้ไขช่องโหว่ XSS / DoS ก่อนอัปโหลดขึ้น GitHub (Security Audit & Push)

### 32.1 ช่องโหว่ที่พบและแก้ไขทันทีก่อน Push
1. **XSS Protection ใน Floating Status Bar (`src/batchQueue.ts`)**:
   - พบการแทรกตัวแปรจากไฟล์ที่อัปโหลด (`activePlanTopic`, `courseName`, `courseCode`, `pauseReason`) ลงใน `bar.innerHTML` โดยตรง จึงเพิ่มฟังก์ชัน `escapeHtml()` และครอบค่าทุกช่องใน `renderFloatingStatusBar()` ครบ 100%
2. **XSS Protection ใน A4 Preview (`src/batchStructureView.ts`)**:
   - เปลี่ยนการแสดงกิจกรรมการเรียนรู้บนหน้า A4 จาก `formatActivitiesToHtml(data.activities)` เป็น `formatActivitiesToHtml(escapeHtml(data.activities))` เนื่องจาก `formatActivitiesToHtml()` ใน `templates.ts` เดิมไม่ Escape HTML Tag
3. **Upload Size Limit DoS Guard (`src/structureParser.ts`)**:
   - เพิ่มการตรวจขนาดไฟล์ `.docx` สูงสุด `15 MB` (`MAX_DOCX_BYTES`) ใน `parseCourseStructureDocx()` ป้องกันแท็บเบราว์เซอร์ค้างหรือหน่วยความจำเต็มจากไฟล์ขนาดใหญ่ผิดปกติ

### 32.2 ผลการตรวจสอบความปลอดภัยทั้งหมด
- **Secret & Env Protection**: `git check-ignore -v .env .env.local dist` ยืนยัน `.gitignore` บล็อกครบทุกไฟล์ สแกนไฟล์โค้ดและเอกสาร (`AIza...`, `AQ...`, `GOCSPX-`, `ghp_`, `github_pat_`, `sk-`, Private Keys) ไม่พบ Key จริงหลุดเข้าซอร์สโค้ด
- **Strict BYOK Fast Mode Boundary**: `callGeminiByokFastOnly()` ยิงตรงไป Google API ด้วย Key ส่วนตัวของผู้ใช้ในกลุ่ม Fast Mode เท่านั้น ไม่ผ่าน Cloudflare Worker ส่วนกลาง และไม่แตะ `curriculum.json` / `Template_EDUPlan.docx` / `worker/worker.js` / `src/classroom/*`
- **Dependency Audit (`npm.cmd audit --omit=dev`)**: คงพบเฉพาะ Moderate 2 รายการใน `uuid <11.1.1` (ติดมาจาก `exceljs` ที่มีอยู่เดิมของโปรเจกต์) ไม่มีช่องโหว่ใหม่จากการติดตั้ง `pizzip`
- **Build & Type Check**: `Emoji hits: 0`, `npx.cmd tsc --noEmit` (Exit Code `0`), `npm.cmd run build` (Exit Code `0`, `✓ 423 modules transformed`, `✓ built in 9.78s`)







