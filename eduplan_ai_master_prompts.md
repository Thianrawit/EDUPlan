# PROMPT: แก้ไขบั๊ก Card ห้องเรียนที่ถูกแชร์ไม่แสดงผลฝั่งผู้ถูกเชิญ (Shared Classroom Discovery Fix)

โปรดทำงานแบบ Token-Saving (กระชับ ตรงประเด็น แก้ไขเฉพาะไฟล์ใน `src/classroom/*` ไม่เกริ่นนำ และสรุปการแก้ไขลง `ReviewIDE.MD` เมื่อเสร็จงาน)

## 1. กฎเหล็กด้านขอบเขตงาน (STRICT ISOLATION)

- **ห้ามแก้ไข ลบ หรือแตะต้องไฟล์ระบบหลัก `EduPlan AI`** (`index.html`, `src/main.ts`, `src/style.css`, `src/config.ts`, `src/curriculum.ts`, `src/gemini.ts`, `src/types.ts`, `src/templates.ts`, `src/exporter.ts`, `src/rubricExporter.ts`, `src/longTermExporter.ts`, `src/longTermModule.ts`, `public/data/curriculum.json`, `vite.config.ts`, `worker/worker.js`)
- แก้ไขเฉพาะไฟล์ภายใน `src/classroom/*` เท่านั้น และคงการทำงานของ `InteractiveTour.ts`, `safeHttpsUrl()`, และ `valueInputOption: 'RAW'` ไว้ครบถ้วน

---

## 2. สาเหตุที่ต้องแก้ไขและรายละเอียดการแก้โค้ด

### 2.1 เพิ่ม Scope `drive.metadata.readonly` ใน `src/classroom/googleAuth.ts`

- **ปัญหา:** เดิมใช้แค่ `drive.file` ซึ่ง Google Drive API v3 บล็อกไม่ให้มองเห็นไฟล์ที่ผู้อื่นแชร์มาให้ (`sharedWithMe = true`) จนกว่าผู้ใช้จะเปิดไฟล์นั้นผ่าน Picker
- **วิธีแก้:** เพิ่ม `'https://www.googleapis.com/auth/drive.metadata.readonly'` เข้าไปในรายการ `SCOPES` ของ `googleAuth.ts` เพื่อให้คำสั่งค้นหาไฟล์ที่ถูกแชร์ (`sharedWithMe = true`) สามารถอ่านรายชื่อไฟล์และ `properties` ของห้องเรียนที่ถูกเชิญได้ทันทีโดยอัตโนมัติ

### 2.2 แก้ไขระบบบันทึกและค้นหาห้องเรียนร่วมใน `src/classroom/googleSheets.ts`

1. **Normalize อีเมลทั้งหมดด้วย `.toLowerCase().trim()`:**
   - ทั้งตอนบันทึก `collab_1` ถึง `collab_5` ลง `properties` (รูปแบบ `"email@domain.com|role"`) และตอนตรวจสอบอีเมลของผู้ใช้ที่ล็อกอินอยู่ ให้แปลงเป็นตัวพิมพ์เล็กและตัดช่องว่างหัวท้ายเสมอ
   - ตรวจสอบให้แน่ใจว่าตอนเจ้าของห้องกดเชิญผู้ร่วมสอน (`inviteCollaborator`) มีการยิงทั้ง:
     - `POST /drive/v3/files/{fileId}/permissions?sendNotificationEmail=false` (`reader` สำหรับ `viewer`, `writer` สำหรับ `assistant` และ `creator`)
     - `PATCH /drive/v3/files/{fileId}` อัปเดต `properties` (`eduplan_type: 'classroom'`, `eduplan_room_name`, `eduplan_subject`, `collab_1`..`collab_5`) และตรวจสอบ `response.ok` พร้อม Log Error ชัดเจนหากอัปเดตไม่สำเร็จ
2. **ปรับปรุงฟังก์ชันดึงห้องเรียนที่ถูกเชิญ (`fetchSharedClassrooms`):**
   - ค้นหาด้วย Query:
     `sharedWithMe = true and trashed = false and mimeType = 'application/vnd.google-apps.spreadsheet'`
     (ใช้การกรอง `properties?.eduplan_type === 'classroom'` ในฝั่ง JavaScript ควบคู่ไปด้วย เพื่อแก้ปัญหา Google Drive Search Index ล่าช้าเวลาเพิ่งกดแชร์ใหม่ๆ)
   - ดึงฟิลด์ให้ครบ: `files(id,name,modifiedTime,owners(emailAddress,displayName),properties)`
   - ตรวจสอบอีเมลผู้ใช้ปัจจุบัน (`.toLowerCase().trim()`) เทียบกับ `properties.collab_1`..`collab_5` หากตรงกันให้คืนค่า Metadata ของห้องเรียนพร้อม `role` และ `ownerEmail`
3. **เพิ่มฟังก์ชันรับห้องเรียนผ่าน Google Picker (`importSharedRoomViaPicker`):**
   - เปิด Google Picker (`google.picker.ViewId.SPREADSHEETS`) ให้ผู้ใช้เลือกไฟล์ Sheet ที่ถูกแชร์มา
   - เมื่อผู้ใช้เลือกไฟล์ ให้ดึง Metadata (`GET /drive/v3/files/{fileId}?fields=id,name,modifiedTime,owners(emailAddress,displayName),properties`)
   - ตรวจสอบสิทธิ์จาก `properties` (หรือหากไม่มี `properties` ให้เช็กสิทธิ์ `capabilities.canEdit` บนไฟล์ Drive เพื่อกำหนดเป็น `'assistant'` หรือ `'viewer'` อัตโนมัติ) แล้วนำเข้าเป็นห้องเรียนร่วมทันที

### 2.3 อัปเดต State & UI ใน `src/classroom/ClassroomHub.ts` และ `src/classroom/db.ts`

1. **Merge ห้องเรียนที่ถูกเชิญเข้าสู่รายการแสดงผลของ `ClassroomHub`:**
   - ทุกครั้งที่โหลดหน้า `ClassroomHub` (เมื่อล็อกอิน Google แล้ว) หรือกดปุ่มซิงก์ข้อมูล ให้เรียก `fetchSharedClassrooms()`
   - นำห้องเรียนที่ถูกเชิญมาบันทึก/อัปเดตลงตาราง `rooms` ใน Dexie (ระบุ `role`, `ownerEmail`, `isSharedWithMe: true`, `sheetId`) และลบห้องร่วมที่ถูกเจ้าของถอนสิทธิ์ออกแล้วออกจาก Dexie
   - แสดง Card ห้องเรียนที่ถูกเชิญรวมใน Grid หน้าหลัก พร้อมป้ายสัญลักษณ์ตามสิทธิ์ (`👁️ ผู้ชม`, `📋 ครูผู้ช่วย`, `🛠️ ครีเอเตอร์`), แสดง **`เจ้าของห้อง: {ownerEmail}`**, และปุ่ม **`🚪 ออกจากห้องร่วม`**
2. **เพิ่มปุ่มลัดรับห้องเรียนที่ถูกแชร์ใน `ClassroomHub.ts`:**
   - เพิ่มปุ่ม **`📥 รับห้องเรียนที่ถูกแชร์`** ข้างปุ่ม `+ เพิ่มห้องเรียน` (แสดงเมื่อล็อกอิน Google แล้ว) เมื่อคลิกจะเรียก `importSharedRoomViaPicker()` เพื่อเปิด Google Drive Picker ให้เลือกไฟล์ที่เพื่อนแชร์มาได้ทันที

---

## 3. การตรวจสอบและส่งมอบงาน

1. ตรวจสอบว่าไม่มีการแก้ไขไฟล์นอก `src/classroom/*`
2. รัน `npm run build` ต้องผ่าน 100% ปราศจาก TypeScript Error
3. สรุปไฟล์ที่แก้ไขและขั้นตอนการทดสอบลงใน `ReviewIDE.MD`
