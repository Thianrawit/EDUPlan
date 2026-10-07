# EduPlan AI (ระบบสร้างแผนการจัดการเรียนรู้อัจฉริยะ)

ระบบช่วยคุณครูสร้างแผนการจัดการเรียนรู้ตามมาตรฐานและตัวชี้วัด หลักสูตรแกนกลางการศึกษาขั้นพื้นฐาน พ.ศ. 2551 (ฉบับปรับปรุง พ.ศ. 2560) ครบถ้วนทุกกลุ่มสาระการเรียนรู้ และระดับการศึกษาปฐมวัย พร้อมระบบช่วยร่าง K-P-A อัจฉริยะด้วย AI และส่งออกเป็นเอกสาร Microsoft Word (.docx) มาตรฐานทันที

---

## 🌟 ฟีเจอร์หลัก (Key Features)

- **ฐานข้อมูลหลักสูตรแกนกลางครบถ้วน 100%**:
  - รองรับครบทั้ง 8 กลุ่มสาระการเรียนรู้ (ภาษาไทย, คณิตศาสตร์, วิทยาศาสตร์และเทคโนโลยี, สังคมศึกษาฯ, สุขศึกษาและพลศึกษา, ศิลปะ, การงานอาชีพ, ภาษาต่างประเทศ) และระดับปฐมวัย
  - ครอบคลุมทุกระดับชั้นตั้งแต่ ปฐมวัย, ประถมศึกษา (ป.1 - ป.6) จนถึง มัธยมศึกษา (ม.1 - ม.6) รวมกว่า 70 มาตรฐาน และ 2,598 ตัวชี้วัด
  - ค้นหาและเลือกตัวชี้วัดได้ง่าย กรองตามกลุ่มสาระ ระดับชั้น และรหัสตัวชี้วัด
- **ระบบร่าง K-P-A อัจฉริยะ (AI-Powered Drafting)**:
  - วิเคราะห์ระดับชั้น, ชื่อเรื่อง/เนื้อหา, กลุ่มสาระ, และมาตรฐานตัวชี้วัดเพื่อสร้างจุดประสงค์การเรียนรู้ K (ความรู้), P (ทักษะกระบวนการ), และ A (คุณลักษณะอันพึงประสงค์) ให้ตรงตามหลักสูตรอย่างแม่นยำ
  - มีระบบแยกส่วนเนื้อหาอัตโนมัติ นำเข้าข้อมูลได้อย่างสะดวก
- **โหมดการกรอกข้อมูล 2 รูปแบบ**:
  - **Step-by-Step Wizard**: กรอกทีละขั้นตอน เหมาะสำหรับผู้เริ่มต้น
  - **All-in-One Form**: กรอกทุกหัวข้อในหน้าเดียว พร้อมระบบคำนวณและดูตัวอย่างแบบ Realtime
- **ระบบ Export คุณภาพสูง**:
  - ส่งออกไฟล์ Microsoft Word (.docx) ฟอร์แมตสวยงาม ถูกต้องตามแบบแผนราชการ
  - ฝังฟอนต์มาตรฐาน TH Sarabun PSK / New
- **AI Proxy Gateway**:
  - มี Cloudflare Worker รองรับ Waterfall Model Cascading และ Multi-Key Failover ป้องกันปัญหา Rate Limit

---

## 🛠️ เทคโนโลยีที่ใช้ (Tech Stack)

- **Frontend**: HTML5, TypeScript, Tailwind CSS, Vite
- **Document Generation**: `docx`, `file-saver`
- **Data Engine**: JSON-based Thai Core Curriculum Database
- **Backend / Proxy**: Cloudflare Worker (JavaScript ES Module)

---

## 🚀 การติดตั้งและเริ่มใช้งาน (Getting Started)

### ข้อกำหนดเบื้องต้น
- [Node.js](https://nodejs.org/) (เวอร์ชัน 18 ขึ้นไป)
- `npm`

### ขั้นตอนการรันโปรเจกต์

1. **ติดตั้ง Dependencies**:
   ```bash
   npm install
   # หรือบน Windows:
   npm.cmd install
   ```

2. **รันเซิร์ฟเวอร์สำหรับพัฒนา (Development Server)**:
   ```bash
   npm run dev
   # หรือบน Windows:
   npm.cmd run dev
   ```

3. **สร้าง Production Build**:
   ```bash
   npm run build
   # หรือบน Windows:
   npm.cmd run build
   ```

---

## 📁 โครงสร้างโปรเจกต์ (Project Structure)

```text
├── public/
│   ├── data/
│   │   └── curriculum.json     # ฐานข้อมูลมาตรฐานและตัวชี้วัดหลักสูตรแกนกลาง
│   ├── fonts/                  # ฟอนต์ TH Sarabun สำหรับการแสดงผลและส่งออก
│   └── templates/              # แม่แบบไฟล์ Word (.docx)
├── scripts/                    # ชุดสคริปต์ Data Patching หลักสูตร
├── src/
│   ├── config.ts               # การตั้งค่าระบบและ API Endpoints
│   ├── curriculum.ts           # Service จัดการและค้นหาข้อมูลหลักสูตร
│   ├── exporter.ts             # Service สร้างและส่งออกเอกสาร Word (.docx)
│   ├── gemini.ts               # Client เรียกใช้งาน AI ผ่าน Worker Proxy
│   ├── main.ts                 # Controller หลัก จัดการ UI และ Form Interactions
│   ├── templates.ts            # แม่แบบแผนการสอนและ AI Prompt Logic
│   ├── types.ts                # TypeScript Interfaces & Types
│   └── style.css               # สไตล์และธีม Tailwind CSS
├── worker/
│   ├── worker.js               # Cloudflare Worker Proxy (AI Gateway)
│   └── wrangler.toml           # การตั้งค่า Wrangler สำหรับ Worker
├── index.html                  # หน้าเว็บแอปพลิเคชัน
└── package.json
```

---

## 📄 ใบอนุญาต (License)

โปรเจกต์นี้พัฒนาขึ้นเพื่อส่งเสริมและสนับสนุนการจัดการเรียนการสอนของคุณครูไทย
