import { 
  TahsinPeriod, 
  TahsinSession, 
  TahsinAttempt, 
  TahsinReadingLocation, 
  TahsinCategoryScore, 
  TahsinPassingStatus,
  TahsinMonitoringStats,
  TahsinAspectScore,
  TahsinErrorCounters,
  User,
  Student
} from '../types';
import { quranService, JUZ_START_PAGES } from './quranService';
import { MUSHAF_604_PAGE_BOUNDARIES } from '../constants/mushafPageBoundaries';
import { QURAN_CHAPTERS } from '../constants';
import { supabase } from '../api';

export const TAHSIN_WEIGHTS = {
  makharij: 0.35,
  tajwid: 0.30,
  kelancaran: 0.20,
  waqaf: 0.15
} as const;

export const TAHSIN_CATEGORY_SCORES: Record<TahsinCategoryScore, number> = {
  sangat_baik: 95,
  baik: 85,
  cukup: 75,
  kurang: 65,
  sangat_kurang: 50
};

export interface TahsinCoverageRule {
  startJuz: number;
  endJuz: number;
  startPage: number;
  endPage: number;
  label: string;
}

export class TahsinService {
  private static instance: TahsinService;

  public static getInstance(): TahsinService {
    if (!TahsinService.instance) {
      TahsinService.instance = new TahsinService();
    }
    return TahsinService.instance;
  }

  // 1. Cakupan Materi Berdasarkan Kelas
  public getCoverageByClass(className: string): TahsinCoverageRule {
    const clean = (className || '').trim().toUpperCase();

    if (clean.startsWith('7') || clean.includes('VII')) {
      return { startJuz: 26, endJuz: 30, startPage: JUZ_START_PAGES[26] || 502, endPage: 604, label: 'Juz 26–30 (Kelas 7)' };
    }
    if (clean.startsWith('8') || clean.includes('VIII')) {
      return { startJuz: 21, endJuz: 30, startPage: JUZ_START_PAGES[21] || 402, endPage: 604, label: 'Juz 21–30 (Kelas 8)' };
    }
    if (clean.startsWith('9') || clean.includes('IX')) {
      return { startJuz: 16, endJuz: 30, startPage: JUZ_START_PAGES[16] || 302, endPage: 604, label: 'Juz 16–30 (Kelas 9)' };
    }
    if (clean.startsWith('10') || clean.startsWith('X') || clean.includes('KELAS 10')) {
      return { startJuz: 11, endJuz: 30, startPage: JUZ_START_PAGES[11] || 201, endPage: 604, label: 'Juz 11–30 (Kelas 10)' };
    }
    if (clean.startsWith('11') || clean.startsWith('XI') || clean.includes('KELAS 11')) {
      return { startJuz: 6, endJuz: 30, startPage: JUZ_START_PAGES[6] || 102, endPage: 604, label: 'Juz 6–30 (Kelas 11)' };
    }
    if (clean.startsWith('12') || clean.startsWith('XII') || clean.includes('KELAS 12')) {
      return { startJuz: 1, endJuz: 30, startPage: 1, endPage: 604, label: 'Juz 1–30 (Kelas 12)' };
    }

    // Default fallback
    return { startJuz: 26, endJuz: 30, startPage: 502, endPage: 604, label: 'Juz 26–30 (Default)' };
  }

  // 2. Generator Acak Bacaan Sesuai Cakupan Materi
  public generateRandomReading(
    className: string, 
    requestedPages: number = 1,
    randomizeReason?: string
  ): TahsinReadingLocation {
    const coverage = this.getCoverageByClass(className);
    const pagesSpan = Math.max(1, Math.ceil(requestedPages));
    
    // Pastikan tidak melompat melebihi halaman 604
    const maxStartPage = Math.max(coverage.startPage, coverage.endPage - pagesSpan + 1);
    const randomPage = Math.floor(Math.random() * (maxStartPage - coverage.startPage + 1)) + coverage.startPage;
    const endPage = Math.min(coverage.endPage, randomPage + pagesSpan - 1);

    const startBoundary = MUSHAF_604_PAGE_BOUNDARIES[randomPage] || {
      pageNumber: randomPage,
      startSurah: 1,
      startAyah: 1,
      endSurah: 1,
      endAyah: 7
    };

    const endBoundary = MUSHAF_604_PAGE_BOUNDARIES[endPage] || startBoundary;

    const startSurahInfo = quranService.getSurah(startBoundary.startSurah);
    const endSurahInfo = quranService.getSurah(endBoundary.endSurah);

    return {
      startSurah: startBoundary.startSurah,
      startSurahName: startSurahInfo?.name || `Surah ke-${startBoundary.startSurah}`,
      startAyah: startBoundary.startAyah,
      endSurah: endBoundary.endSurah,
      endSurahName: endSurahInfo?.name || `Surah ke-${endBoundary.endSurah}`,
      endAyah: endBoundary.endAyah,
      startPage: randomPage,
      endPage: endPage,
      pagesRead: requestedPages,
      juzNumber: quranService.getPageJuz(randomPage),
      randomizeReason
    };
  }

  // 3. Validasi & Navigasi Bacaan Manual
  public createManualReading(
    surahNumber: number,
    ayahNumber: number,
    pagesRead: number = 1,
    className?: string
  ): { valid: boolean; reading?: TahsinReadingLocation; message?: string } {
    if (pagesRead < 0.5) {
      return { valid: false, message: 'Panjang bacaan minimal 0.5 (setengah) halaman.' };
    }

    const startPage = quranService.getAyahPage(surahNumber, ayahNumber);
    const juz = quranService.getPageJuz(startPage);

    if (className) {
      const coverage = this.getCoverageByClass(className);
      if (juz < coverage.startJuz || juz > coverage.endJuz) {
        return { 
          valid: false, 
          message: `Bacaan berada di Juz ${juz}, di luar cakupan materi ${coverage.label}.` 
        };
      }
    }

    const pagesSpan = Math.max(1, Math.ceil(pagesRead));
    const endPage = Math.min(604, startPage + pagesSpan - 1);

    const startBoundary = MUSHAF_604_PAGE_BOUNDARIES[startPage];
    const endBoundary = MUSHAF_604_PAGE_BOUNDARIES[endPage] || startBoundary;

    const surahInfo = quranService.getSurah(surahNumber);
    const endSurahInfo = quranService.getSurah(endBoundary?.endSurah || surahNumber);

    return {
      valid: true,
      reading: {
        startSurah: surahNumber,
        startSurahName: surahInfo?.name || `Surah ${surahNumber}`,
        startAyah: ayahNumber,
        endSurah: endBoundary?.endSurah || surahNumber,
        endSurahName: endSurahInfo?.name || `Surah ${endBoundary?.endSurah || surahNumber}`,
        endAyah: endBoundary?.endAyah || ayahNumber,
        startPage,
        endPage,
        pagesRead,
        juzNumber: juz
      }
    };
  }

  // 4. Perhitungan Nilai Akhir Otomatis
  public calculateScore(
    makharij: number,
    tajwid: number,
    kelancaran: number,
    waqaf: number
  ): number {
    const raw = (makharij * TAHSIN_WEIGHTS.makharij) +
                (tajwid * TAHSIN_WEIGHTS.tajwid) +
                (kelancaran * TAHSIN_WEIGHTS.kelancaran) +
                (waqaf * TAHSIN_WEIGHTS.waqaf);
    return Math.round(raw * 100) / 100;
  }

  // 5. Penentuan Predikat Nilai
  public getPredikat(score: number): {
    predikat: string;
    arabic: string;
    color: string;
    bg: string;
    border: string;
  } {
    if (score >= 90) {
      return { predikat: 'Mumtaz', arabic: 'ممتاز', color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' };
    }
    if (score >= 80) {
      return { predikat: 'Jayyid Jiddan', arabic: 'جيد جداً', color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200' };
    }
    if (score >= 70) {
      return { predikat: 'Jayyid', arabic: 'جيد', color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200' };
    }
    if (score >= 60) {
      return { predikat: 'Maqbul', arabic: 'مقبول', color: 'text-orange-700', bg: 'bg-orange-50', border: 'border-orange-200' };
    }
    return { predikat: 'Perlu Pembinaan', arabic: 'بحاجة إلى متابعة', color: 'text-rose-700', bg: 'bg-rose-50', border: 'border-rose-200' };
  }

  // 6. Penentuan Status Kelulusan
  public evaluatePassing(
    finalScore: number,
    makharij: number,
    tajwid: number,
    hasCriticalError: boolean,
    passingGrade: number = 80,
    minMakharij: number = 75,
    minTajwid: number = 75
  ): TahsinPassingStatus {
    if (
      finalScore >= passingGrade &&
      makharij >= minMakharij &&
      tajwid >= minTajwid &&
      !hasCriticalError
    ) {
      return 'lulus';
    }
    return 'remedial';
  }

  // ================= STORAGE & SYNC API =================
  private getStorageKey(sub: string) {
    return `sita_tahsin_${sub}_v1`;
  }

  // Periode Ujian
  public getLocalPeriods(): TahsinPeriod[] {
    try {
      const raw = localStorage.getItem(this.getStorageKey('periods'));
      if (raw) return JSON.parse(raw);
    } catch (e) {}

    // Default seed period jika belum ada data
    const defaultPeriod: TahsinPeriod = {
      id: 'tp_2026_ganjil',
      name: 'Ujian Tahsin Semester Ganjil 2026/2027',
      academicYear: '2026/2027',
      semester: 'ganjil',
      startDate: '2026-10-01',
      endDate: '2026-12-31',
      status: 'active',
      passingGrade: 80,
      minMakharij: 75,
      minTajwid: 75,
      targetClasses: ['7A', '7B', '8A', '8B', '9A', '9B', '10', '11', '12'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    return [defaultPeriod];
  }

  public saveLocalPeriods(periods: TahsinPeriod[]) {
    localStorage.setItem(this.getStorageKey('periods'), JSON.stringify(periods));
  }

  public async fetchPeriods(): Promise<TahsinPeriod[]> {
    try {
      if (supabase) {
        const { data, error } = await supabase.from('tahsin_periods').select('*').order('created_at', { ascending: false });
        if (!error && data && data.length > 0) {
          const mapped: TahsinPeriod[] = data.map((d: any) => ({
            id: d.id,
            name: d.name,
            academicYear: d.academic_year,
            semester: d.semester,
            startDate: d.start_date,
            endDate: d.end_date,
            status: d.status,
            passingGrade: Number(d.passing_grade || 80),
            minMakharij: Number(d.min_makharij || 75),
            minTajwid: Number(d.min_tajwid || 75),
            targetClasses: d.target_classes || [],
            createdBy: d.created_by,
            createdAt: d.created_at,
            updatedAt: d.updated_at
          }));
          this.saveLocalPeriods(mapped);
          return mapped;
        }
      }
    } catch (e) {
      console.warn('Gagal memuat tahsin_periods dari cloud, menggunakan local cache:', e);
    }
    return this.getLocalPeriods();
  }

  public async savePeriod(period: TahsinPeriod): Promise<{ success: boolean; data?: TahsinPeriod; message?: string }> {
    const list = this.getLocalPeriods();
    const idx = list.findIndex(p => p.id === period.id);
    if (idx >= 0) {
      list[idx] = { ...period, updatedAt: new Date().toISOString() };
    } else {
      list.unshift({ ...period, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    }
    this.saveLocalPeriods(list);

    try {
      if (supabase) {
        await supabase.from('tahsin_periods').upsert({
          id: period.id,
          name: period.name,
          academic_year: period.academicYear,
          semester: period.semester,
          start_date: period.startDate,
          end_date: period.endDate,
          status: period.status,
          passing_grade: period.passingGrade,
          min_makharij: period.minMakharij,
          min_tajwid: period.minTajwid,
          target_classes: period.targetClasses,
          created_by: period.createdBy,
          updated_at: new Date().toISOString()
        });
      }
    } catch (e) {
      console.warn('Gagal sync period ke Supabase:', e);
    }

    return { success: true, data: period };
  }

  // Sesi Ujian (Sessions & Attempts)
  public getLocalSessions(): TahsinSession[] {
    try {
      const raw = localStorage.getItem(this.getStorageKey('sessions'));
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return [];
  }

  public saveLocalSessions(sessions: TahsinSession[]) {
    localStorage.setItem(this.getStorageKey('sessions'), JSON.stringify(sessions));
  }

  public async fetchSessions(periodId?: string): Promise<TahsinSession[]> {
    try {
      if (supabase) {
        let query = supabase.from('tahsin_sessions').select('*, attempts:tahsin_attempts(*)');
        if (periodId) {
          query = query.eq('period_id', periodId);
        }
        const { data, error } = await query.order('created_at', { ascending: false });
        if (!error && data && data.length > 0) {
          const mapped: TahsinSession[] = data.map((d: any) => ({
            id: d.id,
            periodId: d.period_id,
            studentId: d.student_id,
            examinerId: d.examiner_id,
            studentNameSnapshot: d.student_name_snapshot,
            classSnapshot: d.class_snapshot,
            halaqahSnapshot: d.halaqah_snapshot,
            targetJuzStart: d.target_juz_start,
            targetJuzEnd: d.target_juz_end,
            status: d.status,
            finalScore: d.final_score ? Number(d.final_score) : undefined,
            predikat: d.predikat,
            passingStatus: d.final_status,
            latestAttemptNumber: d.latest_attempt_number || 1,
            attempts: (d.attempts || []).map((a: any) => this.mapAttemptFromDb(a)),
            createdAt: d.created_at,
            updatedAt: d.updated_at
          }));
          this.saveLocalSessions(mapped);
          return mapped;
        }
      }
    } catch (e) {
      console.warn('Gagal memuat tahsin_sessions dari cloud, menggunakan local cache:', e);
    }

    const local = this.getLocalSessions();
    if (periodId) {
      return local.filter(s => s.periodId === periodId);
    }
    return local;
  }

  private mapAttemptFromDb(a: any): TahsinAttempt {
    return {
      id: a.id,
      sessionId: a.session_id,
      attemptNumber: a.attempt_number,
      attemptType: a.attempt_type,
      examinerId: a.examiner_id,
      examinerName: a.examiner_name_snapshot || 'Penguji',
      examDate: a.exam_date,
      reading: {
        startSurah: a.start_surah,
        startSurahName: a.surah_name_display || `Surah ${a.start_surah}`,
        startAyah: a.start_ayah,
        endSurah: a.end_surah,
        endSurahName: a.surah_name_display || `Surah ${a.end_surah}`,
        endAyah: a.end_ayah,
        startPage: a.start_page,
        endPage: a.end_page,
        pagesRead: Number(a.pages_read || 1),
        randomizeReason: a.randomize_reason
      },
      makharij: {
        score: Number(a.score_makharij || 0),
        category: a.category_makharij as TahsinCategoryScore
      },
      tajwid: {
        score: Number(a.score_tajwid || 0),
        category: a.category_tajwid as TahsinCategoryScore
      },
      kelancaran: {
        score: Number(a.score_kelancaran || 0),
        category: a.category_kelancaran as TahsinCategoryScore
      },
      waqaf: {
        score: Number(a.score_waqaf || 0),
        category: a.category_waqaf as TahsinCategoryScore
      },
      finalScore: Number(a.final_score || 0),
      predikat: a.predikat || 'Perlu Pembinaan',
      predikatArabic: this.getPredikat(Number(a.final_score || 0)).arabic,
      hasCriticalError: Boolean(a.has_critical_error),
      criticalErrorReason: a.critical_error_reason,
      passingStatus: a.passing_status,
      errorCounts: a.error_counts || undefined,
      coachingNotes: a.coaching_notes,
      status: a.status,
      finalizedAt: a.finalized_at,
      createdAt: a.created_at,
      updatedAt: a.updated_at
    };
  }

  // Menyimpan Percobaan Ujian (Draft atau Final)
  public async saveAttempt(
    session: TahsinSession,
    attempt: TahsinAttempt,
    isFinalize: boolean = false
  ): Promise<{ success: boolean; session: TahsinSession; attempt: TahsinAttempt }> {
    const updatedAttempt: TahsinAttempt = {
      ...attempt,
      status: isFinalize ? 'finalized' : 'draft',
      finalizedAt: isFinalize ? (attempt.finalizedAt || new Date().toISOString()) : undefined,
      updatedAt: new Date().toISOString()
    };

    const existingAttempts = session.attempts ? [...session.attempts] : [];
    const attIdx = existingAttempts.findIndex(a => a.id === updatedAttempt.id);
    if (attIdx >= 0) {
      existingAttempts[attIdx] = updatedAttempt;
    } else {
      existingAttempts.push(updatedAttempt);
    }

    let sessionStatus = session.status;
    let passingStatus = session.passingStatus;
    let finalScore = session.finalScore;
    let predikat = session.predikat;

    if (isFinalize) {
      sessionStatus = updatedAttempt.passingStatus === 'lulus' ? 'completed' : 'remedial_needed';
      passingStatus = updatedAttempt.passingStatus;
      finalScore = updatedAttempt.finalScore;
      predikat = updatedAttempt.predikat;
    } else {
      if (sessionStatus === 'not_started') {
        sessionStatus = 'draft';
      }
    }

    const updatedSession: TahsinSession = {
      ...session,
      status: sessionStatus,
      passingStatus,
      finalScore,
      predikat,
      latestAttemptNumber: Math.max(session.latestAttemptNumber || 1, updatedAttempt.attemptNumber),
      attempts: existingAttempts,
      updatedAt: new Date().toISOString()
    };

    // Update Local Cache
    const sessions = this.getLocalSessions();
    const sIdx = sessions.findIndex(s => s.id === updatedSession.id);
    if (sIdx >= 0) {
      sessions[sIdx] = updatedSession;
    } else {
      sessions.unshift(updatedSession);
    }
    this.saveLocalSessions(sessions);

    // Sync to Supabase
    try {
      if (supabase) {
        // Upsert session
        await supabase.from('tahsin_sessions').upsert({
          id: updatedSession.id,
          period_id: updatedSession.periodId,
          student_id: updatedSession.studentId,
          examiner_id: updatedAttempt.examinerId || updatedSession.examinerId,
          student_name_snapshot: updatedSession.studentNameSnapshot,
          class_snapshot: updatedSession.classSnapshot,
          halaqah_snapshot: updatedSession.halaqahSnapshot,
          target_juz_start: updatedSession.targetJuzStart,
          target_juz_end: updatedSession.targetJuzEnd,
          status: updatedSession.status,
          final_score: updatedSession.finalScore,
          predikat: updatedSession.predikat,
          final_status: updatedSession.passingStatus,
          latest_attempt_number: updatedSession.latestAttemptNumber,
          updated_at: new Date().toISOString()
        });

        // Upsert attempt
        await supabase.from('tahsin_attempts').upsert({
          id: updatedAttempt.id,
          session_id: updatedSession.id,
          attempt_number: updatedAttempt.attemptNumber,
          attempt_type: updatedAttempt.attemptType,
          examiner_id: updatedAttempt.examinerId,
          examiner_name_snapshot: updatedAttempt.examinerName,
          exam_date: updatedAttempt.examDate,
          start_surah: updatedAttempt.reading.startSurah,
          start_ayah: updatedAttempt.reading.startAyah,
          end_surah: updatedAttempt.reading.endSurah,
          end_ayah: updatedAttempt.reading.endAyah,
          start_page: updatedAttempt.reading.startPage,
          end_page: updatedAttempt.reading.endPage,
          pages_read: updatedAttempt.reading.pagesRead,
          surah_name_display: `${updatedAttempt.reading.startSurahName} (${updatedAttempt.reading.startAyah}-${updatedAttempt.reading.endAyah})`,
          randomize_reason: updatedAttempt.reading.randomizeReason,
          score_makharij: updatedAttempt.makharij.score,
          category_makharij: updatedAttempt.makharij.category,
          score_tajwid: updatedAttempt.tajwid.score,
          category_tajwid: updatedAttempt.tajwid.category,
          score_kelancaran: updatedAttempt.kelancaran.score,
          category_kelancaran: updatedAttempt.kelancaran.category,
          score_waqaf: updatedAttempt.waqaf.score,
          category_waqaf: updatedAttempt.waqaf.category,
          final_score: updatedAttempt.finalScore,
          predikat: updatedAttempt.predikat,
          has_critical_error: updatedAttempt.hasCriticalError,
          critical_error_reason: updatedAttempt.criticalErrorReason,
          passing_status: updatedAttempt.passingStatus,
          error_counts: updatedAttempt.errorCounts || {},
          coaching_notes: updatedAttempt.coachingNotes,
          status: updatedAttempt.status,
          finalized_at: updatedAttempt.finalizedAt,
          updated_at: new Date().toISOString()
        });
      }
    } catch (e) {
      console.warn('Gagal sync attempt ke Supabase:', e);
    }

    return { success: true, session: updatedSession, attempt: updatedAttempt };
  }

  // Generate / Inisialisasi Peserta Ujian untuk Satu Periode
  public initializeSessionsForPeriod(
    period: TahsinPeriod,
    students: Student[],
    teachers?: User[]
  ): TahsinSession[] {
    const existing = this.getLocalSessions().filter(s => s.periodId === period.id);
    const existingMap = new Map(existing.map(s => [s.studentId, s]));

    const targetClassesSet = new Set((period.targetClasses || []).map(c => c.trim().toUpperCase()));
    
    // Filter santri yang masuk dalam kelas target
    const eligibleStudents = students.filter(s => {
      if (targetClassesSet.size === 0) return true;
      return targetClassesSet.has((s.class || '').trim().toUpperCase());
    });

    const newSessions: TahsinSession[] = eligibleStudents.map(student => {
      if (existingMap.has(student.id)) {
        return existingMap.get(student.id)!;
      }

      const coverage = this.getCoverageByClass(student.class);

      return {
        id: `ts_${period.id}_${student.id}`,
        periodId: period.id,
        studentId: student.id,
        examinerId: student.teacherId,
        studentNameSnapshot: student.name,
        classSnapshot: student.class,
        halaqahSnapshot: student.halaqah,
        targetJuzStart: coverage.startJuz,
        targetJuzEnd: coverage.endJuz,
        status: 'not_started',
        latestAttemptNumber: 1,
        attempts: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    });

    // Simpan hasil gabungan ke local storage
    const otherSessions = this.getLocalSessions().filter(s => s.periodId !== period.id);
    this.saveLocalSessions([...newSessions, ...otherSessions]);

    return newSessions;
  }

  // 7. Hitung Statistik Monitoring & Dashboard
  public calculateMonitoringStats(sessions: TahsinSession[]): TahsinMonitoringStats {
    const totalParticipants = sessions.length;
    let testedCount = 0;
    let passedCount = 0;
    let remedialNeededCount = 0;
    let remedialCompletedCount = 0;

    let sumFinalScore = 0;
    let sumMakharij = 0;
    let sumTajwid = 0;
    let sumKelancaran = 0;
    let sumWaqaf = 0;

    sessions.forEach(s => {
      // Ambil attempt terakhir yang disahkan
      const finalizedAttempts = (s.attempts || []).filter(a => a.status === 'finalized');
      if (finalizedAttempts.length > 0) {
        testedCount++;
        const latestAttempt = finalizedAttempts.sort((a, b) => b.attemptNumber - a.attemptNumber)[0];

        sumFinalScore += latestAttempt.finalScore;
        sumMakharij += latestAttempt.makharij.score;
        sumTajwid += latestAttempt.tajwid.score;
        sumKelancaran += latestAttempt.kelancaran.score;
        sumWaqaf += latestAttempt.waqaf.score;

        if (latestAttempt.passingStatus === 'lulus') {
          passedCount++;
          if (finalizedAttempts.length > 1) {
            remedialCompletedCount++;
          }
        } else {
          remedialNeededCount++;
        }
      }
    });

    const untestedCount = totalParticipants - testedCount;
    const passRate = testedCount > 0 ? Math.round((passedCount / testedCount) * 100) : 0;

    return {
      totalParticipants,
      testedCount,
      untestedCount,
      passedCount,
      remedialNeededCount,
      remedialCompletedCount,
      passRate,
      averageFinalScore: testedCount > 0 ? Math.round((sumFinalScore / testedCount) * 100) / 100 : 0,
      averageMakharij: testedCount > 0 ? Math.round((sumMakharij / testedCount) * 100) / 100 : 0,
      averageTajwid: testedCount > 0 ? Math.round((sumTajwid / testedCount) * 100) / 100 : 0,
      averageKelancaran: testedCount > 0 ? Math.round((sumKelancaran / testedCount) * 100) / 100 : 0,
      averageWaqaf: testedCount > 0 ? Math.round((sumWaqaf / testedCount) * 100) / 100 : 0
    };
  }
}

export const tahsinService = TahsinService.getInstance();
