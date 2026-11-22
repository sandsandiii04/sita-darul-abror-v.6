export interface SessionExaminerEntry {
  id?: string;
  name: string;
}

export interface SessionExaminerSource {
  examinerHistory?: unknown;
  examiner_history?: unknown;
  actualExaminerId?: string | null;
  actual_examiner_id?: string | null;
  actualExaminerName?: string | null;
  actual_examiner_name?: string | null;
}

function normalizeId(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeName(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function normalizeNameKey(name: string): string {
  return name.toLowerCase();
}

function parseExaminerHistory(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Mengambil seluruh daftar penguji aktual yang terverifikasi pada satu sesi UAS
 * dari `examiner_history` dan `actual_examiner_name` server.
 *
 * - Tidak pernah menggunakan Guru Halaqah sebagai fallback.
 * - Deduplikasi berdasarkan ID guru stabil jika tersedia, atau nama ternormalisasi jika ID tidak tersedia.
 * - Mempertahankan urutan kemunculan sesuai riwayat yang tercatat.
 */
export function getSessionExaminers(source?: SessionExaminerSource | null): SessionExaminerEntry[] {
  if (!source) return [];

  const result: SessionExaminerEntry[] = [];
  const indexById = new Map<string, number>();
  const indexByNameKey = new Map<string, number>();

  const pushExaminer = (rawId: unknown, rawName: unknown) => {
    const name = normalizeName(rawName);
    if (!name) return;

    const id = normalizeId(rawId);
    const nameKey = normalizeNameKey(name);

    if (id && indexById.has(id)) {
      return;
    }

    if (!id && indexByNameKey.has(nameKey)) {
      return;
    }

    if (id && indexByNameKey.has(nameKey)) {
      const existingIdx = indexByNameKey.get(nameKey)!;
      if (!result[existingIdx].id) {
        result[existingIdx] = { id, name: result[existingIdx].name };
        indexById.set(id, existingIdx);
        return;
      }
    }

    const nextIdx = result.length;
    result.push(id ? { id, name } : { name });
    if (id) indexById.set(id, nextIdx);
    if (!indexByNameKey.has(nameKey)) indexByNameKey.set(nameKey, nextIdx);
  };

  const historyList = parseExaminerHistory(source.examinerHistory ?? source.examiner_history);
  for (const entry of historyList) {
    if (typeof entry === 'string') {
      pushExaminer('', entry);
      continue;
    }
    if (entry && typeof entry === 'object') {
      const rec = entry as Record<string, unknown>;
      const rawId = rec.examinerId ?? rec.examiner_id ?? rec.teacherId ?? rec.teacher_id ?? rec.id;
      const rawName = rec.examinerName ?? rec.examiner_name ?? rec.teacherName ?? rec.teacher_name ?? rec.name;
      pushExaminer(rawId, rawName);
    }
  }

  const actualId = source.actualExaminerId ?? source.actual_examiner_id;
  const actualName = source.actualExaminerName ?? source.actual_examiner_name;
  pushExaminer(actualId, actualName);

  return result;
}
