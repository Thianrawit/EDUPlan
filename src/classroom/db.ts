// ============================================================
// EDUPLAN Classroom — Dexie IndexedDB setup & CRUD helpers
// ============================================================
import Dexie, { type Table } from 'dexie';
import type {
  Assignment,
  AttendanceSession,
  Classroom,
  Student,
  SyncSnapshot,
  Tombstone,
} from './types';

class ClassroomDB extends Dexie {
  declare classrooms: Table<Classroom, string>;
  declare students: Table<Student, string>;
  declare sessions: Table<AttendanceSession, string>;
  declare assignments: Table<Assignment, string>;
  declare tombstones: Table<Tombstone, string>;

  constructor() {
    super('eduplan_classroom');
    this.version(1).stores({
      classrooms: 'id, updatedAt, syncMode',
      students: 'id, classroomId, order',
      sessions: 'id, classroomId, date',
      assignments: 'id, classroomId',
      tombstones: 'id, classroomId, deletedAt',
    });
  }
}

export const db = new ClassroomDB();

type ChangeListener = (classroomId: string | null) => void;
const listeners = new Set<ChangeListener>();
export function onDataChange(fn: ChangeListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(classroomId: string | null): void {
  listeners.forEach((fn) => fn(classroomId));
}

async function addTombstone(table: Tombstone['table'], recordId: string, classroomId: string): Promise<void> {
  await db.tombstones.put({ id: `${table}:${recordId}`, table, recordId, classroomId, deletedAt: Date.now() });
}

// ---------------- Classrooms ----------------
export async function listClassrooms(): Promise<Classroom[]> {
  const all = await db.classrooms.toArray();
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getClassroom(id: string): Promise<Classroom | undefined> {
  return db.classrooms.get(id);
}

export async function saveClassroom(c: Classroom): Promise<Classroom> {
  c.updatedAt = Date.now();
  await db.classrooms.put(c);
  emit(c.id);
  return c;
}

export async function deleteClassroom(id: string): Promise<void> {
  await db.transaction('rw', [db.classrooms, db.students, db.sessions, db.assignments, db.tombstones], async () => {
    const [students, sessions, assignments] = await Promise.all([
      db.students.where('classroomId').equals(id).primaryKeys(),
      db.sessions.where('classroomId').equals(id).primaryKeys(),
      db.assignments.where('classroomId').equals(id).primaryKeys(),
    ]);
    await db.students.bulkDelete(students);
    await db.sessions.bulkDelete(sessions);
    await db.assignments.bulkDelete(assignments);
    await db.classrooms.delete(id);
    await addTombstone('classrooms', id, id);
  });
  emit(null);
}

export async function countStudents(classroomId: string): Promise<number> {
  return db.students.where('classroomId').equals(classroomId).count();
}

// ---------------- Students ----------------
export async function getStudents(classroomId: string): Promise<Student[]> {
  const list = await db.students.where('classroomId').equals(classroomId).toArray();
  return list.sort((a, b) => a.order - b.order);
}

/** แทนที่รายชื่อทั้งหมดของห้อง (รายชื่อที่ถูกลบจะถูกบันทึกเป็น tombstone เพื่อซิงก์) */
export async function replaceStudents(classroomId: string, students: Student[]): Promise<void> {
  const now = Date.now();
  await db.transaction('rw', [db.students, db.tombstones, db.classrooms], async () => {
    const existing = await db.students.where('classroomId').equals(classroomId).toArray();
    const keep = new Set(students.map((s) => s.id));
    for (const s of existing) {
      if (!keep.has(s.id)) {
        await db.students.delete(s.id);
        await addTombstone('students', s.id, classroomId);
      }
    }
    const prev = new Map(existing.map((s) => [s.id, s]));
    const rows = students.map((s, i) => {
      const old = prev.get(s.id);
      const changed =
        !old || old.number !== s.number || old.studentCode !== s.studentCode || old.fullName !== s.fullName || old.order !== i;
      return { ...s, classroomId, order: i, updatedAt: changed ? now : old!.updatedAt };
    });
    await db.students.bulkPut(rows);
    await db.classrooms.update(classroomId, { updatedAt: now });
  });
  emit(classroomId);
}

// ---------------- Attendance sessions ----------------
export function getSessions(classroomId: string): Promise<AttendanceSession[]> {
  return db.sessions.where('classroomId').equals(classroomId).toArray();
}

export async function saveSession(s: AttendanceSession): Promise<AttendanceSession> {
  s.updatedAt = Date.now();
  await db.sessions.put(s);
  emit(s.classroomId);
  return s;
}

export async function deleteSession(s: AttendanceSession): Promise<void> {
  await db.sessions.delete(s.id);
  await addTombstone('sessions', s.id, s.classroomId);
  emit(s.classroomId);
}

// ---------------- Assignments ----------------
export function getAssignments(classroomId: string): Promise<Assignment[]> {
  return db.assignments.where('classroomId').equals(classroomId).toArray();
}

export async function saveAssignment(a: Assignment): Promise<Assignment> {
  a.updatedAt = Date.now();
  await db.assignments.put(a);
  emit(a.classroomId);
  return a;
}

export async function deleteAssignment(a: Assignment): Promise<void> {
  await db.assignments.delete(a.id);
  await addTombstone('assignments', a.id, a.classroomId);
  emit(a.classroomId);
}

/** อัปเดตสถานะซิงก์โดยไม่เปลี่ยน updatedAt (ไม่ถือเป็นการแก้ไขข้อมูล) */
export async function markSessionSync(id: string, patch: Partial<Pick<AttendanceSession, 'sheetColumn' | 'sheetSynced'>>): Promise<void> {
  await db.sessions.update(id, patch);
}
export async function markAssignmentSync(id: string, patch: Partial<Pick<Assignment, 'sheetColumn' | 'sheetSynced'>>): Promise<void> {
  await db.assignments.update(id, patch);
}

// ---------------- Sync snapshot (Google Drive appDataFolder) ----------------
const TOMBSTONE_TTL = 1000 * 60 * 60 * 24 * 120; // 120 วัน

export async function buildSyncSnapshot(): Promise<SyncSnapshot> {
  const classrooms = (await db.classrooms.toArray()).filter((c) => c.syncMode === 'google');
  const ids = classrooms.map((c) => c.id);
  const [students, sessions, assignments, tombstones] = await Promise.all([
    db.students.where('classroomId').anyOf(ids).toArray(),
    db.sessions.where('classroomId').anyOf(ids).toArray(),
    db.assignments.where('classroomId').anyOf(ids).toArray(),
    db.tombstones.where('deletedAt').above(Date.now() - TOMBSTONE_TTL).toArray(),
  ]);
  return { version: 1, updatedAt: Date.now(), classrooms, students, sessions, assignments, tombstones };
}

/** รวมข้อมูลจาก Drive เข้ากับเครื่อง (Last-Write-Wins ตาม updatedAt + tombstones) */
const SYNC_TABLES = new Set<Tombstone['table']>(['classrooms', 'students', 'sessions', 'assignments']);

export async function mergeSyncSnapshot(remote: SyncSnapshot): Promise<number> {
  if (!remote || typeof remote !== 'object' || remote.version !== 1) return 0;
  let changed = 0;
  await db.transaction('rw', [db.classrooms, db.students, db.sessions, db.assignments, db.tombstones], async () => {
    const localTombs = new Map((await db.tombstones.toArray()).map((t) => [t.id, t]));

    // 1) apply remote tombstones
    for (const t of Array.isArray(remote.tombstones) ? remote.tombstones : []) {
      if (!t || !SYNC_TABLES.has(t.table) || typeof t.recordId !== 'string' || typeof t.deletedAt !== 'number') continue;
      const table = db.table(t.table) as Table<{ id: string; updatedAt: number }, string>;
      const local = await table.get(t.recordId);
      if (local && local.updatedAt <= t.deletedAt) {
        await table.delete(t.recordId);
        if (t.table === 'classrooms') {
          await db.students.where('classroomId').equals(t.recordId).delete();
          await db.sessions.where('classroomId').equals(t.recordId).delete();
          await db.assignments.where('classroomId').equals(t.recordId).delete();
        }
        changed++;
      }
      const tid = typeof t.id === 'string' ? t.id : `${t.table}:${t.recordId}`;
      const lt = localTombs.get(tid);
      if (!lt || lt.deletedAt < t.deletedAt) {
        const cleanTomb: Tombstone = { id: tid, table: t.table, recordId: t.recordId, classroomId: String(t.classroomId ?? ''), deletedAt: t.deletedAt };
        await db.tombstones.put(cleanTomb);
        localTombs.set(tid, cleanTomb);
      }
    }

    // 2) apply remote records (LWW)
    const deletedRooms = new Set(
      [...localTombs.values()].filter((t) => t.table === 'classrooms').map((t) => t.recordId),
    );
    const apply = async <T extends { id: string; updatedAt: number; classroomId?: string }>(
      tableName: Tombstone['table'],
      rows: T[] | undefined,
    ): Promise<void> => {
      const table = db.table(tableName) as Table<T, string>;
      for (const r of Array.isArray(rows) ? rows : []) {
        if (!r || typeof r.id !== 'string' || typeof r.updatedAt !== 'number') continue;
        const tomb = localTombs.get(`${tableName}:${r.id}`);
        if (tomb && tomb.deletedAt >= r.updatedAt) continue;
        const roomId = tableName === 'classrooms' ? r.id : r.classroomId;
        const roomTomb = roomId && deletedRooms.has(roomId) ? localTombs.get(`classrooms:${roomId}`) : undefined;
        if (roomTomb && roomTomb.deletedAt >= r.updatedAt) continue;
        const local = await table.get(r.id);
        if (!local || r.updatedAt > local.updatedAt) {
          await table.put(r);
          changed++;
        }
      }
    };
    await apply('classrooms', remote.classrooms);
    await apply('students', remote.students);
    await apply('sessions', remote.sessions);
    await apply('assignments', remote.assignments);
  });
  if (changed) emit(null);
  return changed;
}
