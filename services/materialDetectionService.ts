import { TahfidzRecord, ExamMaterialSnapshot, AcademicTerm, ExamPeriod, MemorizationDirection, MaterialSnapshotStatus } from '../types';
import { SURAH_LIST } from '../constants';
import { quranService, SURAH_TOTAL_AYAHS } from './quranService';

export interface DetectionResult {
  snapshot: Omit<ExamMaterialSnapshot, 'id' | 'createdAt' | 'updatedAt'>;
  recordsAnalyzed: TahfidzRecord[];
  furthestPosition?: { surah: number; ayah: number; surahName: string };
  lastRecordPosition?: { surah: number; ayah: number; surahName: string };
}

export class MaterialDetectionService {
  /**
   * Convert surah name to 1-based index (1..114)
   */
  public getSurahNumber(surahName: string): number {
    if (!surahName) return 1;
    const clean = surahName.trim().toLowerCase().replace(/['’`\s-]/g, '');

    // 1. Direct match in SURAH_LIST
    const idx = SURAH_LIST.findIndex(s => {
      const sClean = s.toLowerCase().replace(/['’`\s-]/g, '');
      return sClean === clean;
    });
    if (idx !== -1) return idx + 1;

    // 2. Special aliases common in Indonesian madrasah
    if (clean.includes('fatihah')) return 1;
    if (clean.includes('baqarah') || clean.includes('baqoro')) return 2;
    if (clean.includes('imran') || clean.includes('aliimran')) return 3;
    if (clean.includes('nisa')) return 4;
    if (clean.includes('maidah')) return 5;
    if (clean.includes('anam')) return 6;
    if (clean.includes('araf')) return 7;
    if (clean.includes('anfal')) return 8;
    if (clean.includes('taubah') || clean.includes('baraah')) return 9;
    if (clean.includes('insyirah') || clean.includes('sarh') || clean.includes('syarh')) return 94;
    if (clean.includes('mulk') || clean.includes('tabarak')) return 67;
    if (clean.includes('naba') || clean.includes('amma')) return 78;
    if (clean.includes('naziat')) return 79;
    if (clean.includes('abasa')) return 80;
    if (clean.includes('ikhlas')) return 112;
    if (clean.includes('falaq')) return 113;
    if (clean.includes('nas')) return 114;

    return 1;
  }

  /**
   * Get surah display name from surah number
   */
  public getSurahName(surahNumber: number): string {
    if (surahNumber < 1 || surahNumber > 114) return `Surat ${surahNumber}`;
    return SURAH_LIST[surahNumber - 1] || `Surat ${surahNumber}`;
  }

  /**
   * Filter records belonging to the student and the semester time window
   */
  public filterRelevantRecords(
    records: TahfidzRecord[],
    studentId: string,
    startDate: string,
    cutoffDate: string
  ): TahfidzRecord[] {
    return records.filter(r => {
      if (r.studentId !== studentId) return false;
      // Only hafalan baru (sabaq / ziyadah)
      if (r.type !== 'sabaq' && r.type !== 'ziyadah') return false;
      if (!r.date) return false;
      // Strict date window: from academic_term.start_date to exam_period.material_cutoff_date
      if (r.date < startDate) return false;
      if (r.date > cutoffDate) return false;
      return true;
    }).sort((a, b) => {
      const comp = a.date.localeCompare(b.date);
      if (comp !== 0) return comp;
      return (a.id || '').localeCompare(b.id || '');
    });
  }

  /**
   * Hardened Material Detection Algorithm:
   * 1. Uses actual ayah_start of first semester record.
   * 2. Determines pedagogical direction strictly from actual step-by-step sequence (no hardcoded Juz 30 assumption).
   * 3. Separates furthest verified progress from the last chronological record.
   * 4. Detects and isolates single-record outliers / typos without corrupting main progress.
   * 5. Flags impossible ayahs and inverted ranges as needs_review.
   */
  public analyzeStudentMaterial(
    studentId: string,
    periodId: string,
    term: AcademicTerm,
    period: ExamPeriod,
    allRecords: TahfidzRecord[]
  ): DetectionResult {
    const studentRecords = this.filterRelevantRecords(
      allRecords,
      studentId,
      term.startDate,
      period.materialCutoffDate
    );

    // CASE 1: Belum ada setoran pada periode semester ini
    if (studentRecords.length === 0) {
      return {
        snapshot: {
          examPeriodId: periodId,
          studentId,
          sourceType: 'automatic',
          startSurah: 1,
          startAyah: 1,
          endSurah: 1,
          endAyah: 1,
          startPage: 1,
          endPage: 1,
          startJuz: 1,
          endJuz: 1,
          estimatedPages: 0,
          startSurahName: 'Al-Fatihah',
          endSurahName: 'Al-Fatihah',
          firstRecordDate: null,
          lastRecordDate: null,
          totalRecordsAnalyzed: 0,
          memorizationDirection: 'unknown',
          status: 'not_ready',
          reviewReason: 'Belum ditemukan setoran sabaq/ziyadah pada rentang tanggal semester ini.',
          overrideReason: null,
          verifiedBy: null,
          verifiedAt: null,
          finalizedBy: null,
          finalizedAt: null
        },
        recordsAnalyzed: []
      };
    }

    // CASE 2: Ada setoran - Lakukan audit kontinuitas & progres riil
    const anomalies: string[] = [];

    // Validasi dasar per-record (impossible ayah & inverted range)
    const validRecords: TahfidzRecord[] = [];
    studentRecords.forEach(r => {
      const sNum = this.getSurahNumber(r.surah);
      const maxAyahs = SURAH_TOTAL_AYAHS[sNum] || 286;
      let hasError = false;

      if (r.ayahStart > r.ayahEnd && r.ayahEnd > 0) {
        anomalies.push(`Ayat terbalik pada setoran ${r.date} (${r.surah} ${r.ayahStart}-${r.ayahEnd})`);
        hasError = true;
      }
      if (r.ayahEnd > maxAyahs) {
        anomalies.push(`Ayat melebihi total ayat ${r.surah} pada setoran ${r.date} (ayat ${r.ayahEnd} > max ${maxAyahs})`);
        hasError = true;
      }

      // Record tetap dimasukkan untuk kalkulasi, tapi ditandai
      validRecords.push(r);
    });

    // 1. Tentukan Arah Progresi secara dinamis dari histori langkah aktual
    let forwardSteps = 0;
    let backwardSteps = 0;

    for (let i = 1; i < validRecords.length; i++) {
      const prevSurah = this.getSurahNumber(validRecords[i - 1].surah);
      const currSurah = this.getSurahNumber(validRecords[i].surah);
      if (currSurah > prevSurah) forwardSteps++;
      else if (currSurah < prevSurah) backwardSteps++;
    }

    let direction: MemorizationDirection = 'single_surah';
    const firstSurahNum = this.getSurahNumber(validRecords[0].surah);
    const lastRecSurahNum = this.getSurahNumber(validRecords[validRecords.length - 1].surah);

    if (forwardSteps > backwardSteps) {
      direction = 'forward';
    } else if (backwardSteps > forwardSteps) {
      direction = 'backward';
    } else {
      // Jika langkah seimbang atau 0 (misal dalam 1 surat atau loncatan seimbang)
      if (firstSurahNum < lastRecSurahNum) direction = 'forward';
      else if (firstSurahNum > lastRecSurahNum) direction = 'backward';
      else direction = 'single_surah';
    }

    // 2. Deteksi Isolated Outliers (record typo tunggal yang menyimpang jauh dari jalur utama)
    // Contoh: Santri menghafal Az-Zariyat (51), At-Tur (52), An-Najm (53), tiba-tiba ada 1 record Ali 'Imran (3)
    const mainSequenceRecords: TahfidzRecord[] = [];
    for (let i = 0; i < validRecords.length; i++) {
      const r = validRecords[i];
      const sNum = this.getSurahNumber(r.surah);

      if (validRecords.length >= 4) {
        const isSurahIsolated = (
          (i > 0 && i < validRecords.length - 1) &&
          Math.abs(sNum - this.getSurahNumber(validRecords[i - 1].surah)) > 10 &&
          Math.abs(sNum - this.getSurahNumber(validRecords[i + 1].surah)) > 10
        );

        if (isSurahIsolated) {
          anomalies.push(`Terdapat setoran terisolasi/anomali pada ${r.date}: ${r.surah} ayat ${r.ayahStart}-${r.ayahEnd} di tengah sekuens surat lain.`);
          // Jangan sertakan outlier dalam batas materi utama agar rentang ujian tidak rusak
          continue;
        }
      }
      mainSequenceRecords.push(r);
    }

    const effectiveRecords = mainSequenceRecords.length > 0 ? mainSequenceRecords : validRecords;
    const firstRecord = effectiveRecords[0];
    const lastRecord = effectiveRecords[effectiveRecords.length - 1];

    // 3. Titik Awal Materi: Menggunakan AYAT AWAL AKTUAL dari setoran pertama semester
    const startSurah = this.getSurahNumber(firstRecord.surah);
    const startAyah = Math.max(1, firstRecord.ayahStart || 1);

    // 4. Pisahkan LAST RECORD dengan FURTHEST PROGRESS
    const lastRecordPosition = {
      surah: this.getSurahNumber(lastRecord.surah),
      ayah: Math.max(1, lastRecord.ayahEnd || 1),
      surahName: this.getSurahName(this.getSurahNumber(lastRecord.surah))
    };

    let furthestSurah = startSurah;
    let furthestAyah = startAyah;

    if (direction === 'forward' || direction === 'single_surah') {
      // Progresi Maju: Furthest = nomor surat tertinggi, dan jika surat sama, ayah_end tertinggi
      effectiveRecords.forEach(r => {
        const s = this.getSurahNumber(r.surah);
        const endA = Math.max(1, r.ayahEnd || 1);
        if (s > furthestSurah) {
          furthestSurah = s;
          furthestAyah = endA;
        } else if (s === furthestSurah && endA > furthestAyah) {
          furthestAyah = endA;
        }
      });
    } else {
      // Progresi Mundur (misal Juz 30 dari An-Nas ke An-Naba'):
      // Furthest = nomor surat terendah, dan jika surat sama, capaian terjauh
      furthestSurah = startSurah;
      furthestAyah = Math.max(1, firstRecord.ayahEnd || 1);

      effectiveRecords.forEach(r => {
        const s = this.getSurahNumber(r.surah);
        const endA = Math.max(1, r.ayahEnd || 1);
        if (s < furthestSurah) {
          furthestSurah = s;
          furthestAyah = endA;
        } else if (s === furthestSurah) {
          furthestAyah = Math.max(furthestAyah, endA);
        }
      });
    }

    // Tetapkan batas akhir materi ke FURTHEST PROGRESS (bukan diturunkan jika setoran terakhir sekadar mengulang)
    let endSurah = furthestSurah;
    let endAyah = furthestAyah;

    // Deteksi jika record terakhir mundur dari furthest progress
    const isLastRecordBehindFurthest = (
      ((direction === 'forward' || direction === 'single_surah') && 
       (lastRecordPosition.surah < furthestSurah || (lastRecordPosition.surah === furthestSurah && lastRecordPosition.ayah < furthestAyah))) ||
      (direction === 'backward' && 
       (lastRecordPosition.surah > furthestSurah || (lastRecordPosition.surah === furthestSurah && lastRecordPosition.ayah < furthestAyah)))
    );

    if (isLastRecordBehindFurthest) {
      anomalies.push(`Setoran terakhir (${lastRecord.date}: ${lastRecord.surah} ayat ${lastRecord.ayahStart}-${lastRecord.ayahEnd}) mengulang/mundur dari capaian terjauh (${this.getSurahName(furthestSurah)} ayat ${furthestAyah}). Batas materi tetap dipertahankan pada capaian terjauh.`);
    }

    // 5. Estimasi Halaman & Juz Standar Mushaf Madinah (Tepat per ayat)
    const coverage = quranService.calculateMaterialCoverage(startSurah, startAyah, endSurah, endAyah, direction);
    const startPage = coverage.startPage;
    const endPage = coverage.endPage;
    const startJuz = coverage.startJuz;
    const endJuz = coverage.endJuz;
    const estimatedPages = coverage.estimatedPages;

    // 6. Tentukan Status & Review Reason
    let status: MaterialSnapshotStatus = 'ready';
    let reviewReason: string | null = null;

    if (anomalies.length > 0) {
      status = 'needs_review';
      reviewReason = anomalies.join('; ');
    }

    return {
      snapshot: {
        examPeriodId: periodId,
        studentId,
        sourceType: 'automatic',
        startSurah,
        startAyah,
        endSurah,
        endAyah,
        startPage,
        endPage,
        startJuz,
        endJuz,
        estimatedPages,
        startSurahName: this.getSurahName(startSurah),
        endSurahName: this.getSurahName(endSurah),
        firstRecordDate: firstRecord.date,
        lastRecordDate: lastRecord.date,
        totalRecordsAnalyzed: studentRecords.length,
        memorizationDirection: direction,
        status,
        reviewReason,
        overrideReason: null,
        verifiedBy: null,
        verifiedAt: null,
        finalizedBy: null,
        finalizedAt: null
      },
      recordsAnalyzed: studentRecords,
      furthestPosition: { surah: furthestSurah, ayah: furthestAyah, surahName: this.getSurahName(furthestSurah) },
      lastRecordPosition
    };
  }
}

export const materialDetectionService = new MaterialDetectionService();
