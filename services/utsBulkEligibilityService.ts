import { ExamParticipant, ExamMaterialSnapshot } from '../types';
import { utsQuestionGenerator } from './utsQuestionGenerator';

export type UTSEligibilityStatus = 
  | 'READY'
  | 'ALREADY_GENERATED'
  | 'MATERIAL_NOT_FINAL'
  | 'INSUFFICIENT_MATERIAL'
  | 'STALE'
  | 'INVALID_MATERIAL';

export interface UTSEligibilityItem {
  studentId: string;
  studentName: string;
  studentClass: string;
  halaqah: string;
  status: UTSEligibilityStatus;
  statusLabel: string;
  reason: string;
  estimatedPages: number;
  questionSetVersion?: number;
  snapshot?: ExamMaterialSnapshot;
}

export interface UTSEligibilitySummary {
  total: number;
  ready: number;
  alreadyGenerated: number;
  materialNotFinal: number;
  insufficientMaterial: number;
  stale: number;
  invalidMaterial: number;
  items: UTSEligibilityItem[];
}

export const UTS_ELIGIBILITY_LABELS: Record<UTSEligibilityStatus, string> = {
  READY: 'Siap Dibuat',
  ALREADY_GENERATED: 'Sudah Dibuat',
  MATERIAL_NOT_FINAL: 'Materi Belum Final',
  INSUFFICIENT_MATERIAL: 'Materi Tidak Cukup',
  STALE: 'Perlu Ditinjau',
  INVALID_MATERIAL: 'Materi Tidak Valid'
};

/**
 * Evaluasi Kelayakan Pembuatan Soal UTS secara Read-Only (DB Delta = 0).
 * Menilai kesiapan materi santri terhadap konfigurasi jumlah soal (N).
 */
export function evaluateUTSEligibility(params: {
  participants: ExamParticipant[];
  snapshots: ExamMaterialSnapshot[];
  questionSetMap: Map<string, { status: string; version: number; id: string }>;
  targetQCount: number; // 5, 10, 15, 20
  classFilter?: string;
  halaqahFilter?: string;
}): UTSEligibilitySummary {
  const { 
    participants, 
    snapshots, 
    questionSetMap, 
    targetQCount, 
    classFilter = 'all', 
    halaqahFilter = 'all' 
  } = params;

  // Filter peserta sesuai scope
  const filteredParticipants = participants.filter(p => {
    if (classFilter !== 'all' && p.class !== classFilter) return false;
    if (halaqahFilter !== 'all' && p.halaqah !== halaqahFilter) return false;
    return true;
  });

  const snapshotMap = new Map<string, ExamMaterialSnapshot>();
  snapshots.forEach(s => snapshotMap.set(s.studentId, s));

  const items: UTSEligibilityItem[] = [];
  let readyCount = 0;
  let alreadyGeneratedCount = 0;
  let materialNotFinalCount = 0;
  let insufficientMaterialCount = 0;
  let staleCount = 0;
  let invalidMaterialCount = 0;

  for (const p of filteredParticipants) {
    const snap = snapshotMap.get(p.studentId);
    const qInfo = questionSetMap.get(p.studentId);

    let status: UTSEligibilityStatus;
    let reason: string;
    const estPages = snap?.estimatedPages || 0;

    // 1. Validasi Keberadaan Snapshot
    if (!snap) {
      status = 'INVALID_MATERIAL';
      reason = 'Belum ada usulan materi sabaq untuk santri ini.';
      invalidMaterialCount++;
    }
    // 2. Validasi Status Materi Wajib FINAL
    else if (snap.status !== 'finalized') {
      status = 'MATERIAL_NOT_FINAL';
      reason = 'Materi belum difinalisasi.';
      materialNotFinalCount++;
    }
    // 3. Cek Apakah Soal Sudah Pernah Dibuat
    else if (qInfo) {
      if (qInfo.status === 'stale') {
        status = 'STALE';
        reason = 'Materi berubah dan perlu ditinjau kembali.';
        staleCount++;
      } else {
        // Soal sudah aktif & terkunci
        status = 'ALREADY_GENERATED';
        reason = 'Soal sudah dibuat.';
        alreadyGeneratedCount++;
      }
    }
    // 4. Validasi Kecukupan Materi untuk Target N Soal
    else {
      try {
        const path = utsQuestionGenerator.buildMaterialPath(snap);
        const minRequiredAyahs = targetQCount;

        if (path.nodes.length === 0) {
          status = 'INVALID_MATERIAL';
          reason = 'Rentang materi santri kosong atau tidak valid.';
          invalidMaterialCount++;
        } else if (path.nodes.length < minRequiredAyahs) {
          status = 'INSUFFICIENT_MATERIAL';
          reason = `Materi belum cukup untuk membuat ${targetQCount} soal.`;
          insufficientMaterialCount++;
        } else {
          status = 'READY';
          reason = `Materi final dan memenuhi syarat untuk ${targetQCount} soal.`;
          readyCount++;
        }
      } catch (err: any) {
        status = 'INVALID_MATERIAL';
        reason = err?.message || 'Gagal mengevaluasi rentang materi.';
        invalidMaterialCount++;
      }
    }

    items.push({
      studentId: p.studentId,
      studentName: p.studentName,
      studentClass: p.class,
      halaqah: p.halaqah,
      status,
      statusLabel: UTS_ELIGIBILITY_LABELS[status],
      reason,
      estimatedPages: estPages,
      questionSetVersion: qInfo?.version,
      snapshot: snap
    });
  }

  return {
    total: filteredParticipants.length,
    ready: readyCount,
    alreadyGenerated: alreadyGeneratedCount,
    materialNotFinal: materialNotFinalCount,
    insufficientMaterial: insufficientMaterialCount,
    stale: staleCount,
    invalidMaterial: invalidMaterialCount,
    items
  };
}
