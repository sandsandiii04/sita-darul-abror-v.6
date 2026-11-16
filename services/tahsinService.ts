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
  TahsinSyncStatus,
  TahsinSaveResult,
  TahsinPendingSyncItem,
  TahsinAuditLogItem,
  User,
  Student
} from '../types';
import { quranService, JUZ_START_PAGES } from './quranService';
import { MUSHAF_604_PAGE_BOUNDARIES } from '../constants/mushafPageBoundaries';
import { QURAN_CHAPTERS } from '../constants';
import { supabase, safeSetLocalStorage, safeGetLocalStorage } from '../api';

const cleanTahsinId = (id: any): string => {
  if (id === null || id === undefined) return '';
  return id.toString().split(' | ')[0].trim();
};

export interface TahsinSyncStateSnapshot {
  pendingCount: number;
  otherUsersPendingCount: number;
  conflictCount: number;
  failedCount: number;
  isSyncing: boolean;
  authRequired: boolean;
  lastError: string | null;
  items: TahsinPendingSyncItem[];
}

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

export function formatTahsinPassageDisplay(reading?: TahsinReadingLocation | null): {
  surahAyahText: string;
  surahDetailText: string;
  pageText: string;
  juzText: string;
  pagesReadText: string;
  hasData: boolean;
} {
  if (!reading || (!reading.startSurah && !reading.startPage)) {
    return {
      surahAyahText: 'Data bacaan belum tercatat',
      surahDetailText: '-',
      pageText: '-',
      juzText: '-',
      pagesReadText: '-',
      hasData: false
    };
  }

  const startSurahName = reading.startSurahName || (reading.startSurah ? quranService.getSurah(reading.startSurah)?.name : '') || (reading.startSurah ? `Surah ${reading.startSurah}` : 'Surah');
  const endSurahName = reading.endSurahName || (reading.endSurah ? quranService.getSurah(reading.endSurah)?.name : '') || startSurahName;

  let surahAyahText = '';
  if (reading.startSurah && reading.endSurah && reading.startSurah !== reading.endSurah) {
    surahAyahText = `${startSurahName} (Ayat ${reading.startAyah || 1}) s.d. ${endSurahName} (Ayat ${reading.endAyah || 1})`;
  } else if (reading.startSurah) {
    if (reading.endAyah && reading.startAyah && reading.endAyah !== reading.startAyah) {
      surahAyahText = `${startSurahName} (Ayat ${reading.startAyah}–${reading.endAyah})`;
    } else if (reading.startAyah) {
      surahAyahText = `${startSurahName} (Ayat ${reading.startAyah})`;
    } else {
      surahAyahText = startSurahName;
    }
  } else {
    surahAyahText = 'Materi Belum Ditentukan';
  }

  let pageText = '-';
  if (reading.startPage) {
    if (reading.endPage && reading.endPage !== reading.startPage) {
      pageText = `Hal. ${reading.startPage}–${reading.endPage}`;
    } else {
      pageText = `Hal. ${reading.startPage}`;
    }
  }

  const startJuz = reading.juzNumber || (reading.startPage ? quranService.getPageJuz(reading.startPage) : (reading.startSurah ? quranService.getPageJuz(quranService.getAyahPage(reading.startSurah, reading.startAyah || 1)) : undefined));
  const endJuz = reading.endPage ? quranService.getPageJuz(reading.endPage) : (reading.endSurah ? quranService.getPageJuz(quranService.getAyahPage(reading.endSurah, reading.endAyah || 1)) : startJuz);

  let juzText = '-';
  if (startJuz && endJuz && startJuz !== endJuz) {
    juzText = `Juz ${startJuz}–${endJuz}`;
  } else if (startJuz) {
    juzText = `Juz ${startJuz}`;
  } else if (endJuz) {
    juzText = `Juz ${endJuz}`;
  }
  const pagesReadText = reading.pagesRead ? `${reading.pagesRead} Halaman` : '-';

  return {
    surahAyahText,
    surahDetailText: `${surahAyahText} • ${pageText} • ${juzText} (${pagesReadText})`,
    pageText,
    juzText,
    pagesReadText,
    hasData: true
  };
}

export interface TahsinCoverageRule {
  startJuz: number;
  endJuz: number;
  startPage: number;
  endPage: number;
  label: string;
}

export class TahsinService {
  private static instance: TahsinService;
  private activeSyncPromise: Promise<{
    total: number;
    succeeded: number;
    failed: number;
    conflicts: number;
    authRequired?: boolean;
    details: any[];
  }> | null = null;
  private isCurrentlySyncing: boolean = false;
  private lastSyncErrorMsg: string | null = null;
  private authRequiredFlag: boolean = false;
  private syncSubscribers: ((snapshot: TahsinSyncStateSnapshot) => void)[] = [];

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

  // 5b. Penentuan Kategori Skor Aspek (Sangat Baik, Baik, Cukup, Kurang, Sangat Kurang)
  public getCategoryFromScore(score: number): TahsinCategoryScore {
    if (score >= 90) return 'sangat_baik';
    if (score >= 80) return 'baik';
    if (score >= 70) return 'cukup';
    if (score >= 60) return 'kurang';
    return 'sangat_kurang';
  }

  // 6. Penentuan Status Kelulusan (KKM Resmi: Nilai Akhir >= 70, Makharij >= 70, Tajwid >= 70)
  public evaluatePassing(
    finalScore: number,
    makharij: number,
    tajwid: number,
    hasCriticalError: boolean,
    passingGrade: number = 70,
    minMakharij: number = 70,
    minTajwid: number = 70
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
    } catch (e) { }

    // Default seed period jika belum ada data
    const defaultPeriod: TahsinPeriod = {
      id: 'tp_2026_ganjil',
      name: 'Ujian Tahsin Semester Ganjil 2026/2027',
      academicYear: '2026/2027',
      semester: 'ganjil',
      startDate: '2026-10-01',
      endDate: '2026-12-31',
      status: 'active',
      passingGrade: 70,
      minMakharij: 70,
      minTajwid: 70,
      targetClasses: ['7A', '7B', '8A', '8B', '9A', '9B', '9C', '10A', '10B', '11A', '11B', '12A', '12B'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    return [defaultPeriod];
  }

  public saveLocalPeriods(periods: TahsinPeriod[]): boolean {
    if (typeof window === 'undefined' && typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(this.getStorageKey('periods'), JSON.stringify(periods));
        return true;
      } catch (e) {
        return false;
      }
    }
    return safeSetLocalStorage(this.getStorageKey('periods'), JSON.stringify(periods));
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

  public async savePeriod(
    period: TahsinPeriod,
    currentUser?: User
  ): Promise<{ success: boolean; data?: TahsinPeriod; message?: string }> {
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
        // Coba simpan via RPC aman save_tahsin_period_secure jika ada kredensial admin (sessionToken / password)
        const credential = currentUser?.sessionToken || currentUser?.password;
        if (currentUser?.username && credential) {
          try {
            const { data: rpcRes, error: rpcErr } = await supabase.rpc('save_tahsin_period_secure', {
              p_username: currentUser.username,
              p_password: credential,
              p_period_data: {
                id: period.id,
                name: period.name,
                academicYear: period.academicYear,
                semester: period.semester,
                startDate: period.startDate,
                endDate: period.endDate,
                status: period.status,
                passingGrade: period.passingGrade,
                minMakharij: period.minMakharij,
                minTajwid: period.minTajwid,
                targetClasses: period.targetClasses
              }
            });

            if (!rpcErr && rpcRes && rpcRes.success) {
              return { success: true, data: period, message: rpcRes.message };
            }
          } catch (rpcEx) {
            // Lanjut ke fallback
          }
        }

        // Fallback: direct upsert jika RPC belum di-deploy
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

  // ================= PENDING SYNC QUEUE & LOCAL DATA RESCUE =================
  private safeWriteStorage(key: string, value: string): boolean {
    if (typeof window !== 'undefined') {
      const ok = safeSetLocalStorage(key, value);
      if (!ok) return false;
      const readBack = safeGetLocalStorage(key);
      return readBack !== null;
    }
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(key, value);
        return localStorage.getItem(key) !== null;
      } catch (e) {
        return false;
      }
    }
    return false;
  }

  private safeReadStorage(key: string): string | null {
    if (typeof window !== 'undefined') {
      return safeGetLocalStorage(key);
    }
    if (typeof localStorage !== 'undefined') {
      try {
        return localStorage.getItem(key);
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  public getRawPendingSyncQueue(): TahsinPendingSyncItem[] {
    try {
      const raw = this.safeReadStorage(this.getStorageKey('pending_sync'));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) { }
    return [];
  }

  // Menyelamatkan sesi lokal yang sudah selesai diuji tetapi belum masuk antrean pending_sync
  // serta menormalisasi format data lokal dari versi frontend sebelumnya.
  public reconcileAndRescueLocalSessions(): TahsinPendingSyncItem[] {
    const queue = this.getRawPendingSyncQueue();
    const sessions = this.getLocalSessions();
    let changed = false;

    // 1. Normalisasi item yang sudah ada di antrean
    queue.forEach(item => {
      const cleanedExaminerId = cleanTahsinId(item.examinerId || item.payload?.attempt?.examinerId || item.payload?.session?.examinerId);
      if (cleanedExaminerId && item.examinerId !== cleanedExaminerId) {
        item.examinerId = cleanedExaminerId;
        changed = true;
      }
      if (item.lastError && item.lastError.toLowerCase().includes('konflik')) {
        item.conflictDetected = true;
      }
      if (item.lastError && (item.lastError.toLowerCase().includes('autentikasi gagal') || item.lastError.toLowerCase().includes('sesi tidak valid') || item.lastError.toLowerCase().includes('kredensial'))) {
        item.authError = true;
      }
    });

    // 2. Scan seluruh sesi lokal untuk menyelamatkan attempt finalized yang belum synced_server
    sessions.forEach(sess => {
      if (!sess || !sess.id) return;
      const isSessUnsynced =
        sess.syncStatus === 'pending_sync' ||
        sess.syncStatus === 'sync_failed' ||
        (!sess.syncStatus && (sess.status === 'completed' || sess.status === 'remedial_needed'));

      const finalizedAttempts = (sess.attempts || []).filter(a => a && a.status === 'finalized');
      finalizedAttempts.forEach(att => {
        const isAttUnsynced =
          att.syncStatus === 'pending_sync' ||
          att.syncStatus === 'sync_failed' ||
          (isSessUnsynced && att.syncStatus !== 'synced_server');

        if (!isAttUnsynced) return;

        const alreadyQueued = queue.some(
          q => q.attemptId === att.id || (q.sessionId === sess.id && q.attemptNumber === (att.attemptNumber || 1))
        );

        if (!alreadyQueued) {
          const exId = cleanTahsinId(att.examinerId || sess.examinerId || sess.lastUpdatedBy);
          if (!exId) return;

          queue.push({
            id: `ps_${att.id}`,
            sessionId: sess.id,
            attemptId: att.id,
            studentId: sess.studentId,
            studentName: sess.studentNameSnapshot || 'Santri',
            periodId: sess.periodId,
            examinerId: exId,
            examinerName: att.examinerName,
            attemptNumber: att.attemptNumber || 1,
            attemptType: att.attemptType || 'utama',
            finalScore: Number(att.finalScore ?? sess.finalScore ?? 0),
            predikat: att.predikat || sess.predikat || 'Jayyid',
            passingStatus: att.passingStatus || sess.passingStatus || 'lulus',
            payload: {
              session: {
                ...sess,
                version: sess.version || 1,
                syncStatus: sess.syncStatus || 'pending_sync'
              },
              attempt: {
                ...att,
                syncStatus: att.syncStatus || 'pending_sync'
              }
            },
            retryCount: 0,
            lastAttemptAt: sess.updatedAt || new Date().toISOString(),
            createdAt: att.createdAt || sess.createdAt || new Date().toISOString()
          });
          changed = true;
        }
      });
    });

    if (changed) {
      this.savePendingSyncQueue(queue);
    }
    return queue;
  }

  public getPendingSyncQueue(): TahsinPendingSyncItem[] {
    return this.reconcileAndRescueLocalSessions();
  }

  public savePendingSyncQueue(queue: TahsinPendingSyncItem[]): boolean {
    const ok = this.safeWriteStorage(this.getStorageKey('pending_sync'), JSON.stringify(queue));
    this.notifySyncSubscribers();
    return ok;
  }

  public getPendingSyncCount(examinerId?: string): number {
    return this.getPendingSyncItems(examinerId).length;
  }

  public getPendingSyncItems(examinerId?: string): TahsinPendingSyncItem[] {
    const queue = this.getPendingSyncQueue();
    if (examinerId) {
      const cleanTarget = cleanTahsinId(examinerId);
      return queue.filter(q => cleanTahsinId(q.examinerId) === cleanTarget);
    }
    return queue;
  }

  public getSyncStateSnapshot(currentUser?: User | null): TahsinSyncStateSnapshot {
    const allItems = this.getPendingSyncQueue();
    let userItems = allItems;
    let otherCount = 0;

    if (currentUser && currentUser.role !== 'admin') {
      const myId = cleanTahsinId(currentUser.id);
      userItems = allItems.filter(q => cleanTahsinId(q.examinerId) === myId || (q.examinerUsername && q.examinerUsername === currentUser.username));
      otherCount = allItems.length - userItems.length;
    }

    const conflictCount = userItems.filter(i => i.conflictDetected || (i.lastError && i.lastError.toLowerCase().includes('konflik'))).length;
    const failedCount = userItems.filter(i => i.lastError && !i.conflictDetected).length;
    const hasAuthErr = this.authRequiredFlag || userItems.some(i => i.authError) || Boolean(userItems.length > 0 && currentUser && !currentUser.sessionToken && !currentUser.password);
    const firstErr = this.lastSyncErrorMsg || userItems.find(i => i.lastError)?.lastError || null;

    return {
      pendingCount: userItems.length,
      otherUsersPendingCount: otherCount,
      conflictCount,
      failedCount,
      isSyncing: this.isCurrentlySyncing,
      authRequired: hasAuthErr,
      lastError: firstErr,
      items: userItems
    };
  }

  public subscribeSync(cb: (snapshot: TahsinSyncStateSnapshot) => void, currentUser?: User | null): () => void {
    this.syncSubscribers.push(cb);
    try {
      cb(this.getSyncStateSnapshot(currentUser));
    } catch (e) { }
    return () => {
      this.syncSubscribers = this.syncSubscribers.filter(sub => sub !== cb);
    };
  }

  private notifySyncSubscribers(currentUser?: User | null): void {
    let activeUser = currentUser;
    if (!activeUser && typeof window !== 'undefined') {
      try {
        const raw = this.safeReadStorage('sita_current_user_v1');
        if (raw) activeUser = JSON.parse(raw);
      } catch (e) { }
    }
    const snap = this.getSyncStateSnapshot(activeUser);
    this.syncSubscribers.forEach(cb => {
      try {
        cb(snap);
      } catch (e) { }
    });
  }

  public exportPendingSyncBackup(examinerId?: string): string {
    const items = this.getPendingSyncItems(examinerId);
    const allSessions = this.getLocalSessions();
    const relevantSessionIds = new Set(items.map(i => i.sessionId));
    const sessions = examinerId
      ? allSessions.filter(s => relevantSessionIds.has(s.id) || cleanTahsinId(s.examinerId) === cleanTahsinId(examinerId))
      : allSessions;

    return JSON.stringify({
      backupVersion: 'sita_tahsin_recovery_v1',
      exportedAt: new Date().toISOString(),
      examinerId: examinerId || 'all',
      pendingCount: items.length,
      pendingSyncItems: items,
      localSessions: sessions
    }, null, 2);
  }

  public addToPendingSync(item: TahsinPendingSyncItem): boolean {
    const queue = this.getRawPendingSyncQueue();
    const normalizedItem: TahsinPendingSyncItem = {
      ...item,
      examinerId: cleanTahsinId(item.examinerId)
    };
    const idx = queue.findIndex(q => q.attemptId === normalizedItem.attemptId || (q.sessionId === normalizedItem.sessionId && q.attemptNumber === normalizedItem.attemptNumber));
    if (idx >= 0) {
      queue[idx] = normalizedItem;
    } else {
      queue.push(normalizedItem);
    }
    return this.savePendingSyncQueue(queue);
  }

  public removeFromPendingSync(attemptId: string, sessionId?: string, attemptNumber?: number): void {
    const queue = this.getRawPendingSyncQueue().filter(q => {
      if (q.attemptId === attemptId) return false;
      if (sessionId && attemptNumber !== undefined && q.sessionId === sessionId && q.attemptNumber === attemptNumber) return false;
      return true;
    });
    this.savePendingSyncQueue(queue);
  }

  // Menggabungkan sesi dari server dengan progres lokal secara aman (Owner-First & Server-Finalized Priority)
  private mergeServerAndLocalSession(
    serverSession: TahsinSession,
    localSession: TahsinSession
  ): TahsinSession {
    const serverAttempts = serverSession.attempts || [];
    const serverIsFinalized =
      serverSession.status === 'completed' ||
      serverSession.status === 'remedial_needed' ||
      serverAttempts.some(a => a.status === 'finalized');

    // Jika server belum memiliki hasil resmi sama sekali, pertahankan progres lokal yang sedang pending/draft
    if (!serverIsFinalized) {
      return {
        ...localSession,
        version: serverSession.version || localSession.version || 1,
        syncStatus: localSession.syncStatus || 'pending_sync'
      };
    }

    // Server SUDAH memiliki hasil resmi (completed / remedial_needed / finalized).
    // Nilai resmi di server TIDAK BOHLEH ditimpa oleh draft lokal atau pending_sync dari perangkat lain.
    const serverMaxAttemptNum = serverAttempts.reduce(
      (max, a) => Math.max(max, a.attemptNumber || 1),
      serverSession.latestAttemptNumber || 1
    );

    const mergedAttempts = [...serverAttempts];
    const pendingQueue = this.getRawPendingSyncQueue();

    (localSession.attempts || []).forEach(localAtt => {
      // Cek kecocokan berdasarkan ID atau berdasarkan (attemptNumber + examinerId + finalScore yang sama)
      const matchById = serverAttempts.find(
        sa =>
          sa.id === localAtt.id ||
          (sa.status === 'finalized' &&
            sa.attemptNumber === localAtt.attemptNumber &&
            cleanTahsinId(sa.examinerId) === cleanTahsinId(localAtt.examinerId) &&
            Math.abs(Number(sa.finalScore) - Number(localAtt.finalScore)) < 0.01)
      );
      if (matchById && matchById.status === 'finalized') {
        // Attempt ini sudah berhasil tersinkronisasi di server (idempoten) -> bersihkan dari antrean pending jika masih ada
        this.removeFromPendingSync(localAtt.id, localSession.id, localAtt.attemptNumber);
        return;
      }

      // Jika ada attempt lokal dengan nomor attempt lebih tinggi (misal remedial baru saat offline),
      // tambahkan ke daftar attempts dengan status pending_sync tanpa mengubah status/nilai resmi sesi server
      if (
        (localAtt.syncStatus === 'pending_sync' || localAtt.syncStatus === 'sync_failed' || localAtt.status === 'draft') &&
        localAtt.attemptNumber > serverMaxAttemptNum
      ) {
        if (!mergedAttempts.some(ma => ma.id === localAtt.id)) {
          mergedAttempts.push({
            ...localAtt,
            syncStatus: localAtt.status === 'draft' ? 'draft_local' : (localAtt.syncStatus || 'pending_sync')
          });
        }
      } else if (
        (localAtt.syncStatus === 'pending_sync' || localAtt.syncStatus === 'sync_failed') &&
        !matchById
      ) {
        // Konflik dua perangkat pada nomor attempt yang sama: tandai di antrean pending agar peringatan tampil dan tidak menghapus nilai server
        const qItem = pendingQueue.find(q => q.attemptId === localAtt.id || (q.sessionId === localSession.id && q.attemptNumber === localAtt.attemptNumber));
        if (qItem && !qItem.lastError?.includes('Konflik')) {
          qItem.lastError = 'Konflik dua perangkat: Nilai resmi untuk santri ini telah disahkan di server oleh perangkat lain.';
          qItem.conflictDetected = true;
          this.addToPendingSync(qItem);
        }
      }
    });

    return {
      ...serverSession,
      attempts: mergedAttempts
    };
  }

  // Sesi Ujian (Sessions & Attempts)
  public getLocalSessions(): TahsinSession[] {
    try {
      const raw = this.safeReadStorage(this.getStorageKey('sessions'));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) { }
    return [];
  }

  public saveLocalSessions(sessions: TahsinSession[]): boolean {
    return this.safeWriteStorage(this.getStorageKey('sessions'), JSON.stringify(sessions));
  }

  private getActiveUserWithCredential(currentUser?: User): { user?: User; credential?: string } {
    let activeUser = currentUser;
    let storedUser: User | undefined;
    if (typeof window !== 'undefined' || typeof localStorage !== 'undefined') {
      try {
        const raw = this.safeReadStorage('sita_current_user_v1') || this.safeReadStorage('sita_user');
        if (raw) storedUser = JSON.parse(raw);
      } catch (e) { }
    }
    if (!activeUser && storedUser) {
      activeUser = storedUser;
    } else if (activeUser && !activeUser.sessionToken && !activeUser.password && storedUser && storedUser.username === activeUser.username) {
      activeUser = {
        ...activeUser,
        sessionToken: storedUser.sessionToken || activeUser.sessionToken,
        password: storedUser.password || activeUser.password
      };
    }
    const credential = activeUser?.sessionToken || activeUser?.password;
    return { user: activeUser, credential };
  }

  public async fetchSessions(periodId?: string, currentUser?: User): Promise<TahsinSession[]> {
    try {
      if (supabase && periodId) {
        const { user: activeUser, credential } = this.getActiveUserWithCredential(currentUser);

        if (activeUser?.username && credential) {
          try {
            const { data: rpcRes, error: rpcErr } = await supabase.rpc('get_tahsin_sessions_secure', {
              p_username: activeUser.username,
              p_password: credential,
              p_period_id: periodId
            });

            if (rpcErr) {
              console.warn('RPC get_tahsin_sessions_secure error:', rpcErr);
              throw rpcErr;
            }

            if (rpcRes && rpcRes.success && Array.isArray(rpcRes.data)) {
              this.authRequiredFlag = false;
              const mapped: TahsinSession[] = rpcRes.data.map((d: any) => ({
                id: d.id,
                periodId: d.periodId || d.period_id,
                studentId: d.studentId || d.student_id,
                examinerId: d.examinerId || d.examiner_id,
                studentNameSnapshot: d.studentNameSnapshot || d.student_name_snapshot,
                classSnapshot: d.classSnapshot || d.class_snapshot,
                halaqahSnapshot: d.halaqahSnapshot || d.halaqah_snapshot,
                targetJuzStart: d.targetJuzStart ?? d.target_juz_start,
                targetJuzEnd: d.targetJuzEnd ?? d.target_juz_end,
                status: d.status,
                finalScore: (d.finalScore !== null && d.finalScore !== undefined)
                  ? Number(d.finalScore)
                  : ((d.final_score !== null && d.final_score !== undefined) ? Number(d.final_score) : undefined),
                predikat: d.predikat,
                passingStatus: d.finalStatus || d.final_status,
                syncStatus: 'synced_server',
                version: d.version || 1,
                lastUpdatedBy: d.lastUpdatedBy || d.last_updated_by,
                latestAttemptNumber: d.latestAttemptNumber || d.latest_attempt_number || 1,
                attempts: (d.attempts || []).map((a: any) => this.mapAttemptFromDb(a)),
                auditLogs: Array.isArray(d.auditLogs || d.audit_logs)
                  ? (d.auditLogs || d.audit_logs).map((al: any) => ({
                      id: al.id,
                      sessionId: al.sessionId || al.session_id,
                      attemptId: al.attemptId || al.attempt_id,
                      changedBy: al.changedBy || al.changed_by,
                      changedByName: al.changedByName || al.changed_by_name || al.changedBy || al.changed_by,
                      changeType: al.changeType || al.change_type,
                      oldScore: al.oldScore !== null && al.oldScore !== undefined ? Number(al.oldScore) : (al.old_score !== null && al.old_score !== undefined ? Number(al.old_score) : null),
                      newScore: al.newScore !== null && al.newScore !== undefined ? Number(al.newScore) : (al.new_score !== null && al.new_score !== undefined ? Number(al.new_score) : null),
                      oldStatus: al.oldStatus || al.old_status,
                      newStatus: al.newStatus || al.new_status,
                      reason: al.reason,
                      createdAt: al.createdAt || al.created_at
                    }))
                  : undefined,
                createdAt: d.createdAt || d.created_at,
                updatedAt: d.updatedAt || d.updated_at
              }));

              // Proteksi Local Draft & Pending Sync
              const localSessions = this.getLocalSessions();
              const otherPeriodSessions = localSessions.filter(s => s.periodId !== periodId);
              const pendingQueue = this.getPendingSyncQueue();
              const merged: TahsinSession[] = [...mapped];

              localSessions.filter(s => s.periodId === periodId).forEach(ls => {
                const hasPending = pendingQueue.some(pq => pq.sessionId === ls.id);
                if (hasPending || ls.syncStatus === 'pending_sync' || ls.syncStatus === 'sync_failed' || ls.syncStatus === 'draft_local') {
                  const idx = merged.findIndex(m => m.id === ls.id || m.studentId === ls.studentId);
                  if (idx >= 0) {
                    merged[idx] = this.mergeServerAndLocalSession(merged[idx], ls);
                  } else if (hasPending || ls.syncStatus === 'pending_sync' || ls.syncStatus === 'sync_failed') {
                    merged.unshift(ls);
                  }
                }
              });

              this.saveLocalSessions([...otherPeriodSessions, ...merged]);
              this.notifySyncSubscribers(activeUser);
              return merged;
            } else if (rpcRes && !rpcRes.success) {
              const msg = rpcRes.message || 'Gagal memuat sesi ujian dari server.';
              if (msg.toLowerCase().includes('autentikasi') || msg.toLowerCase().includes('sesi tidak valid') || msg.toLowerCase().includes('kredensial')) {
                this.authRequiredFlag = true;
                this.lastSyncErrorMsg = 'Sesi login Anda perlu diperbarui (token keamanan tidak valid/kedaluwarsa). Silakan masukkan kembali password Anda.';
                this.notifySyncSubscribers(activeUser);
              }
              console.warn('RPC get_tahsin_sessions_secure gagal:', msg);
              throw new Error(msg);
            }
          } catch (rpcEx: any) {
            console.warn('Gagal memuat via RPC get_tahsin_sessions_secure:', rpcEx);
            throw rpcEx;
          }
        } else if (activeUser?.username && !credential) {
          this.authRequiredFlag = true;
          this.lastSyncErrorMsg = 'Sesi keamanan login Anda berasal dari versi lama dan belum memiliki token server. Silakan masukkan password Anda untuk menyinkronkan data.';
          this.notifySyncSubscribers(activeUser);
        }
      }
    } catch (e: any) {
      console.warn('Gagal fetchSessions dari Supabase:', e);
      throw e;
    }

    const local = this.getLocalSessions();
    if (periodId) {
      return local.filter(s => s.periodId === periodId);
    }
    return local;
  }

  private mapAttemptFromDb(a: any): TahsinAttempt {
    const finalScoreNum = (a.finalScore !== null && a.finalScore !== undefined)
      ? Number(a.finalScore)
      : Number(a.final_score || 0);

    const startSurah = a.reading?.startSurah ?? a.startSurah ?? a.start_surah;
    const endSurah = a.reading?.endSurah ?? a.endSurah ?? a.end_surah ?? startSurah;
    const startAyah = a.reading?.startAyah ?? a.startAyah ?? a.start_ayah;
    const endAyah = a.reading?.endAyah ?? a.endAyah ?? a.end_ayah;
    const startPage = a.reading?.startPage ?? a.startPage ?? a.start_page;
    const endPage = a.reading?.endPage ?? a.endPage ?? a.end_page ?? startPage;
    const pagesRead = Number(a.reading?.pagesRead ?? a.pagesRead ?? a.pages_read ?? 1);

    const startSurahInfo = startSurah ? quranService.getSurah(startSurah) : null;
    const endSurahInfo = endSurah ? quranService.getSurah(endSurah) : null;

    const startSurahName = a.reading?.startSurahName || a.surah_name_display || a.startSurahName || startSurahInfo?.name || (startSurah ? `Surah ${startSurah}` : 'Surah');
    const endSurahName = a.reading?.endSurahName || a.endSurahName || endSurahInfo?.name || (endSurah && endSurah !== startSurah ? `Surah ${endSurah}` : startSurahName);

    const juzNumber = a.reading?.juzNumber ?? a.juz_number ?? a.juzNumber ?? (startPage ? quranService.getPageJuz(startPage) : (startSurah ? quranService.getPageJuz(quranService.getAyahPage(startSurah, startAyah || 1)) : undefined));

    return {
      id: a.id,
      sessionId: a.sessionId || a.session_id,
      attemptNumber: a.attemptNumber || a.attempt_number || 1,
      attemptType: a.attemptType || a.attempt_type || 'utama',
      examinerId: a.examinerId || a.examiner_id,
      examinerName: a.examinerName || a.examiner_name_snapshot || 'Penguji',
      examDate: a.examDate || a.exam_date,
      reading: {
        startSurah,
        startSurahName,
        startAyah,
        endSurah,
        endSurahName,
        endAyah,
        startPage,
        endPage,
        pagesRead,
        juzNumber,
        randomizeReason: a.reading?.randomizeReason || a.randomize_reason || a.randomizeReason
      },
      makharij: a.makharij ? a.makharij : {
        score: Number(a.score_makharij || 0),
        category: (a.category_makharij || 'cukup') as TahsinCategoryScore,
        isCustomScore: Boolean(a.is_custom_makharij)
      },
      tajwid: a.tajwid ? a.tajwid : {
        score: Number(a.score_tajwid || 0),
        category: (a.category_tajwid || 'cukup') as TahsinCategoryScore,
        isCustomScore: Boolean(a.is_custom_tajwid)
      },
      kelancaran: a.kelancaran ? a.kelancaran : {
        score: Number(a.score_kelancaran || 0),
        category: (a.category_kelancaran || 'cukup') as TahsinCategoryScore,
        isCustomScore: Boolean(a.is_custom_kelancaran)
      },
      waqaf: a.waqaf ? a.waqaf : {
        score: Number(a.score_waqaf || 0),
        category: (a.category_waqaf || 'cukup') as TahsinCategoryScore,
        isCustomScore: Boolean(a.is_custom_waqaf)
      },
      finalScore: finalScoreNum,
      predikat: a.predikat || this.getPredikat(finalScoreNum).predikat,
      predikatArabic: a.predikatArabic || this.getPredikat(finalScoreNum).arabic,
      hasCriticalError: a.hasCriticalError ?? Boolean(a.has_critical_error),
      criticalErrorReason: a.criticalErrorReason || a.critical_error_reason,
      passingStatus: a.passingStatus || a.passing_status,
      errorCounts: a.errorCounts || a.error_counts || undefined,
      coachingNotes: a.coachingNotes || a.coaching_notes,
      status: a.status,
      syncStatus: 'synced_server',
      version: a.version || 1,
      finalizedAt: a.finalizedAt || a.finalized_at,
      createdAt: a.createdAt || a.created_at,
      updatedAt: a.updatedAt || a.updated_at
    };
  }
  // Pemeriksaan Idempoten ke Server Sebelum / Saat Retry Sinkronisasi
  private async inspectServerSessionState(
    periodId: string,
    sessionId: string,
    studentId: string,
    activeUser?: User,
    credential?: string
  ): Promise<TahsinSession | null> {
    if (!supabase || !activeUser?.username || !credential) return null;
    try {
      const { data: rpcRes, error: rpcErr } = await supabase.rpc('get_tahsin_sessions_secure', {
        p_username: activeUser.username,
        p_password: credential,
        p_period_id: periodId
      });
      if (rpcErr || !rpcRes || !rpcRes.success || !Array.isArray(rpcRes.data)) return null;
      const found = rpcRes.data.find(
        (d: any) => d.id === sessionId || (d.studentId || d.student_id) === studentId
      );
      if (!found) return null;
      return {
        id: found.id,
        periodId: found.periodId || found.period_id,
        studentId: found.studentId || found.student_id,
        examinerId: found.examinerId || found.examiner_id,
        studentNameSnapshot: found.studentNameSnapshot || found.student_name_snapshot,
        classSnapshot: found.classSnapshot || found.class_snapshot,
        halaqahSnapshot: found.halaqahSnapshot || found.halaqah_snapshot,
        targetJuzStart: found.targetJuzStart ?? found.target_juz_start,
        targetJuzEnd: found.targetJuzEnd ?? found.target_juz_end,
        status: found.status,
        finalScore: (found.finalScore !== null && found.finalScore !== undefined)
          ? Number(found.finalScore)
          : ((found.final_score !== null && found.final_score !== undefined) ? Number(found.final_score) : undefined),
        predikat: found.predikat,
        passingStatus: found.finalStatus || found.final_status,
        syncStatus: 'synced_server',
        version: found.version || 1,
        lastUpdatedBy: found.lastUpdatedBy || found.last_updated_by,
        latestAttemptNumber: found.latestAttemptNumber || found.latest_attempt_number || 1,
        attempts: (found.attempts || []).map((a: any) => this.mapAttemptFromDb(a)),
        createdAt: found.createdAt || found.created_at,
        updatedAt: found.updatedAt || found.updated_at
      };
    } catch (e) {
      return null;
    }
  }

  // Menyimpan Percobaan Ujian (Draft atau Final) secara Aman & Idempoten
  public async saveAttempt(
    session: TahsinSession,
    attempt: TahsinAttempt,
    isFinalize: boolean = false,
    currentUser?: User
  ): Promise<TahsinSaveResult> {
    let baseVersion = session.version || 1;
    let nextVersion = baseVersion + 1;
    let syncStatus: TahsinSyncStatus = isFinalize ? 'pending_sync' : 'draft_local';
    let savedToServer = false;
    let conflictDetected = false;
    let returnMessage = isFinalize
      ? 'Menyimpan ujian tahsin...'
      : 'Draft ujian berhasil disimpan di perangkat lokal.';

    const hasOfficialServerAttempt = (session.attempts || []).some(
      a => a.status === 'finalized' &&
           a.syncStatus !== 'draft_local' &&
           a.syncStatus !== 'pending_sync' &&
           a.syncStatus !== 'sync_failed'
    );

    const updatedAttempt: TahsinAttempt = {
      ...attempt,
      examinerId: cleanTahsinId(attempt.examinerId || currentUser?.id),
      status: isFinalize ? 'finalized' : 'draft',
      syncStatus,
      version: baseVersion,
      finalizedAt: isFinalize ? (attempt.finalizedAt || new Date().toISOString()) : undefined,
      updatedAt: new Date().toISOString()
    };

    const existingAttempts = session.attempts ? [...session.attempts] : [];
    const attIdx = existingAttempts.findIndex(
      a => a.id === updatedAttempt.id || (a.attemptNumber === updatedAttempt.attemptNumber && a.status !== 'finalized')
    );
    if (attIdx >= 0) {
      // Jangan timpa attempt yang sudah resmi tersinkron di server dengan draft lokal
      const priorAtt = existingAttempts[attIdx];
      if (!isFinalize && priorAtt.status === 'finalized' && priorAtt.syncStatus === 'synced_server') {
        return {
          success: false,
          savedToServer: false,
          syncStatus: 'synced_server',
          session,
          attempt: priorAtt,
          message: 'Hasil ujian sudah resmi disahkan di server dan tidak dapat ditimpa oleh draft lokal.'
        };
      }
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
      examinerId: cleanTahsinId(session.examinerId || updatedAttempt.examinerId || currentUser?.id),
      status: sessionStatus,
      passingStatus,
      finalScore,
      predikat,
      syncStatus: (!isFinalize && hasOfficialServerAttempt) ? (session.syncStatus || 'synced_server') : syncStatus,
      version: baseVersion,
      lastUpdatedBy: cleanTahsinId(currentUser?.id || updatedAttempt.examinerId),
      latestAttemptNumber: Math.max(session.latestAttemptNumber || 1, updatedAttempt.attemptNumber),
      attempts: existingAttempts,
      updatedAt: new Date().toISOString()
    };

    // 1. Simpan ke LocalStorage terlebih dahulu dan verifikasi keberhasilannya (Requirement A.14)
    const sessions = this.getLocalSessions();
    const sIdx = sessions.findIndex(s => s.id === updatedSession.id);
    if (sIdx >= 0) {
      sessions[sIdx] = updatedSession;
    } else {
      sessions.unshift(updatedSession);
    }
    const localSessionSaved = this.saveLocalSessions(sessions);

    let localQueueSaved = true;
    if (isFinalize) {
      localQueueSaved = this.addToPendingSync({
        id: `ps_${updatedAttempt.id}`,
        sessionId: updatedSession.id,
        attemptId: updatedAttempt.id,
        studentId: updatedSession.studentId,
        studentName: updatedSession.studentNameSnapshot,
        periodId: updatedSession.periodId,
        examinerId: cleanTahsinId(updatedAttempt.examinerId || currentUser?.id),
        examinerUsername: currentUser?.username,
        examinerName: updatedAttempt.examinerName || currentUser?.name,
        attemptNumber: updatedAttempt.attemptNumber,
        attemptType: updatedAttempt.attemptType,
        finalScore: updatedAttempt.finalScore,
        predikat: updatedAttempt.predikat,
        passingStatus: updatedAttempt.passingStatus,
        payload: {
          session: updatedSession,
          attempt: updatedAttempt
        },
        retryCount: 0,
        lastAttemptAt: new Date().toISOString(),
        createdAt: new Date().toISOString()
      });
    }

    if (!localSessionSaved || !localQueueSaved) {
      return {
        success: false,
        savedToServer: false,
        localSaveFailed: true,
        syncStatus: 'sync_failed',
        session: updatedSession,
        attempt: updatedAttempt,
        message: 'PERINGATAN KRITIS: Penyimpanan memori browser (localStorage) penuh atau diblokir. Mohon jangan tutup halaman ini dan pastikan koneksi internet aktif untuk menyimpan langsung ke server.'
      };
    }

    // 2. Coba Sinkronisasi ke Supabase Server (Jangan mengandalkan navigator.onLine semata, verifikasi via respons server)
    try {
      if (supabase) {
        const { user: activeUser, credential } = this.getActiveUserWithCredential(currentUser);

        if (!activeUser?.username || !credential) {
          this.authRequiredFlag = true;
          const authMsg = 'Sesi keamanan login Anda perlu diperbarui (token belum tersedia/kedaluwarsa). Silakan masukkan kembali password akun Anda agar nilai otomatis dikirim ke server.';
          this.lastSyncErrorMsg = authMsg;
          if (isFinalize) {
            const qItem = this.getRawPendingSyncQueue().find(q => q.attemptId === updatedAttempt.id);
            if (qItem) {
              qItem.lastError = authMsg;
              qItem.authError = true;
              this.addToPendingSync(qItem);
            }
          }
          throw new Error(authMsg);
        }

        const attemptPayload = {
          sessionData: {
            periodId: updatedSession.periodId,
            studentId: updatedSession.studentId,
            studentNameSnapshot: updatedSession.studentNameSnapshot,
            classSnapshot: updatedSession.classSnapshot,
            halaqahSnapshot: updatedSession.halaqahSnapshot,
            targetJuzStart: updatedSession.targetJuzStart,
            targetJuzEnd: updatedSession.targetJuzEnd
          },
          finalScore: updatedAttempt.finalScore,
          predikat: updatedAttempt.predikat,
          passingStatus: updatedAttempt.passingStatus,
          attemptNumber: updatedAttempt.attemptNumber,
          attemptType: updatedAttempt.attemptType,
          examDate: updatedAttempt.examDate,
          reading: updatedAttempt.reading,
          makharij: updatedAttempt.makharij,
          tajwid: updatedAttempt.tajwid,
          kelancaran: updatedAttempt.kelancaran,
          waqaf: updatedAttempt.waqaf,
          hasCriticalError: updatedAttempt.hasCriticalError,
          criticalErrorReason: updatedAttempt.criticalErrorReason,
          errorCounts: updatedAttempt.errorCounts || {},
          coachingNotes: updatedAttempt.coachingNotes
        };

        let { data: rpcRes, error: rpcErr } = await supabase.rpc('save_tahsin_attempt_secure', {
          p_username: activeUser.username,
          p_password: credential,
          p_session_id: updatedSession.id,
          p_attempt_id: updatedAttempt.id,
          p_expected_version: baseVersion,
          p_is_finalize: isFinalize,
          p_attempt_data: attemptPayload
        });

        if (rpcErr) {
          throw rpcErr;
        }

        // Pemeriksaan Idempoten & Rekonsiliasi Versi Otomatis jika Server melaporkan conflict / sudah lulus / sudah disahkan
        if (rpcRes && !rpcRes.success) {
          const errMsgLower = (rpcRes.message || '').toLowerCase();
          const mayBeIdempotentOrDraftVersion =
            rpcRes.conflict ||
            errMsgLower.includes('lulus') ||
            errMsgLower.includes('disahkan') ||
            errMsgLower.includes('konflik');

          if (mayBeIdempotentOrDraftVersion) {
            const serverSess = await this.inspectServerSessionState(
              updatedSession.periodId,
              updatedSession.id,
              updatedSession.studentId,
              activeUser,
              credential
            );

            if (serverSess) {
              const matchingServerAtt = (serverSess.attempts || []).find(
                sa =>
                  sa.status === 'finalized' &&
                  (sa.id === updatedAttempt.id ||
                    (sa.attemptNumber === updatedAttempt.attemptNumber &&
                      cleanTahsinId(sa.examinerId) === cleanTahsinId(updatedAttempt.examinerId))) &&
                  Math.abs(Number(sa.finalScore) - Number(updatedAttempt.finalScore)) < 0.01
              );

              // KASUS A: Attempt ini sebenarnya SUDAH TERSIMPAN & FINALIZED di server dengan skor yang sama pada request sebelumnya yang timeout!
              if (matchingServerAtt && matchingServerAtt.status === 'finalized') {
                savedToServer = true;
                syncStatus = 'synced_server';
                updatedSession.syncStatus = 'synced_server';
                updatedSession.version = serverSess.version || nextVersion;
                updatedAttempt.id = matchingServerAtt.id;
                updatedAttempt.syncStatus = 'synced_server';
                updatedAttempt.version = matchingServerAtt.version || serverSess.version || nextVersion;
                updatedSession.attempts = (updatedSession.attempts || []).map(a =>
                  a.id === attempt.id || a.id === matchingServerAtt.id ? updatedAttempt : a
                );

                const finalSessions = this.getLocalSessions();
                const fIdx = finalSessions.findIndex(s => s.id === updatedSession.id);
                if (fIdx >= 0) {
                  finalSessions[fIdx] = updatedSession;
                  this.saveLocalSessions(finalSessions);
                }

                this.removeFromPendingSync(attempt.id, updatedSession.id, updatedAttempt.attemptNumber);
                this.removeFromPendingSync(matchingServerAtt.id, updatedSession.id, updatedAttempt.attemptNumber);

                this.authRequiredFlag = false;
                this.lastSyncErrorMsg = null;
                this.notifySyncSubscribers(activeUser);

                return {
                  success: true,
                  savedToServer: true,
                  syncStatus: 'synced_server',
                  session: updatedSession,
                  attempt: updatedAttempt,
                  message: 'Ujian Tahsin terverifikasi telah tersimpan resmi di server database (Cloud OK)!'
                };
              }

              // KASUS B: Sesi di server masih berstatus draft / not_started (belum ada attempt finalized),
              // tetapi versinya lebih tinggi (misal karena simpan draft sebelumnya). Sesuaikan expected_version dan kirim ulang!
              const serverHasFinalized =
                serverSess.status === 'completed' ||
                serverSess.status === 'remedial_needed' ||
                (serverSess.attempts || []).some(sa => sa.status === 'finalized' && sa.attemptNumber === updatedAttempt.attemptNumber);

              if (!serverHasFinalized && serverSess.version && serverSess.version !== baseVersion) {
                baseVersion = serverSess.version;
                nextVersion = baseVersion + 1;
                const retryRpc = await supabase.rpc('save_tahsin_attempt_secure', {
                  p_username: activeUser.username,
                  p_password: credential,
                  p_session_id: updatedSession.id,
                  p_attempt_id: updatedAttempt.id,
                  p_expected_version: baseVersion,
                  p_is_finalize: isFinalize,
                  p_attempt_data: attemptPayload
                });
                if (!retryRpc.error && retryRpc.data) {
                  rpcRes = retryRpc.data;
                }
              }
            }
          }
        }

        if (rpcRes) {
          if (rpcRes.conflict) {
            conflictDetected = true;
            syncStatus = 'sync_failed';
            const conflictMsg = rpcRes.message || 'Konflik dua perangkat terdeteksi: Nilai santri telah diperbarui di server oleh perangkat lain.';
            updatedSession.syncStatus = hasOfficialServerAttempt ? 'synced_server' : 'sync_failed';
            updatedAttempt.syncStatus = 'sync_failed';

            const restoredSession = hasOfficialServerAttempt ? session : updatedSession;
            this.saveLocalSessions(this.getLocalSessions().map(s => s.id === updatedSession.id ? restoredSession : s));

            const qItem = this.getRawPendingSyncQueue().find(q => q.attemptId === updatedAttempt.id);
            if (qItem) {
              qItem.lastError = conflictMsg;
              qItem.conflictDetected = true;
              this.addToPendingSync(qItem);
            }

            return {
              success: false,
              savedToServer: false,
              syncStatus: 'sync_failed',
              conflictDetected: true,
              serverVersion: rpcRes.server_version || rpcRes.version,
              session: restoredSession,
              attempt: updatedAttempt,
              message: conflictMsg
            };
          }

          if (rpcRes.success) {
            savedToServer = true;
            syncStatus = 'synced_server';
            const confirmedVersion = rpcRes.server_version || rpcRes.version || nextVersion;
            updatedSession.syncStatus = 'synced_server';
            updatedSession.version = confirmedVersion;
            updatedAttempt.syncStatus = 'synced_server';
            updatedAttempt.version = confirmedVersion;
            updatedSession.attempts = (updatedSession.attempts || []).map(a =>
              a.id === updatedAttempt.id ? updatedAttempt : a
            );

            // Simpan status synced_server ke localSessions TERLEBIH DAHULU sebelum memicu removeFromPendingSync -> notifySyncSubscribers
            const finalSessions = this.getLocalSessions();
            const fIdx = finalSessions.findIndex(s => s.id === updatedSession.id);
            if (fIdx >= 0) {
              finalSessions[fIdx] = updatedSession;
              this.saveLocalSessions(finalSessions);
            } else {
              finalSessions.unshift(updatedSession);
              this.saveLocalSessions(finalSessions);
            }
            this.removeFromPendingSync(updatedAttempt.id, updatedSession.id, updatedAttempt.attemptNumber);

            this.authRequiredFlag = false;
            this.lastSyncErrorMsg = null;
            this.notifySyncSubscribers(activeUser);

            return {
              success: true,
              savedToServer: true,
              syncStatus: 'synced_server',
              session: updatedSession,
              attempt: updatedAttempt,
              message: rpcRes.message || 'Ujian Tahsin berhasil disahkan dan tersimpan di database server!'
            };
          }

          const rpcErrMsg = rpcRes.message || 'Gagal menyimpan ujian ke server.';
          if (rpcErrMsg.toLowerCase().includes('autentikasi') || rpcErrMsg.toLowerCase().includes('sesi tidak valid') || rpcErrMsg.toLowerCase().includes('kredensial')) {
            this.authRequiredFlag = true;
            this.lastSyncErrorMsg = rpcErrMsg;
          }
          throw new Error(rpcErrMsg);
        }
      }
    } catch (e: any) {
      console.warn('Gagal sinkronisasi ke Supabase server:', e);
      const errMsg = e?.message || 'Koneksi ke server terputus';
      const isAuthErr = errMsg.toLowerCase().includes('autentikasi') || errMsg.toLowerCase().includes('sesi') || errMsg.toLowerCase().includes('kredensial') || errMsg.toLowerCase().includes('password');
      if (isAuthErr) {
        this.authRequiredFlag = true;
      }
      this.lastSyncErrorMsg = errMsg;

      syncStatus = isFinalize ? 'sync_failed' : 'draft_local';
      updatedSession.syncStatus = (!isFinalize && hasOfficialServerAttempt) ? 'synced_server' : syncStatus;
      updatedAttempt.syncStatus = syncStatus;

      const localSessions = this.getLocalSessions();
      const lIdx = localSessions.findIndex(s => s.id === updatedSession.id);
      if (lIdx >= 0) {
        localSessions[lIdx] = updatedSession;
        this.saveLocalSessions(localSessions);
      }

      if (isFinalize) {
        const qItem = this.getRawPendingSyncQueue().find(q => q.attemptId === updatedAttempt.id);
        if (qItem) {
          qItem.lastError = errMsg;
          qItem.authError = isAuthErr;
          this.addToPendingSync(qItem);
        }
      }

      returnMessage = isFinalize
        ? `Gagal menyimpan ke server database (${errMsg}). Nilai tersimpan 100% AMAN di perangkat ini dan akan disinkronkan ke server.`
        : 'Draft ujian tersimpan di perangkat lokal (koneksi server tidak tersedia).';

      this.notifySyncSubscribers(currentUser);

      return {
        success: !isFinalize,
        savedToServer: false,
        authRequired: isAuthErr,
        syncStatus,
        session: updatedSession,
        attempt: updatedAttempt,
        message: returnMessage
      };
    }

    return {
      success: !isFinalize,
      savedToServer: false,
      syncStatus: isFinalize ? 'pending_sync' : 'draft_local',
      session: updatedSession,
      attempt: updatedAttempt,
      message: returnMessage
    };
  }

  // [P2] FITUR EDIT NILAI (Koreksi / Revisi Hasil Ujian yang Sudah Disahkan dengan Audit Trail & Optimistic Locking)
  public async reviseAttempt(
    session: TahsinSession,
    revisedAttempt: TahsinAttempt,
    reason: string,
    currentUser: User,
    period?: TahsinPeriod,
    student?: Student
  ): Promise<TahsinSaveResult> {
    // 1. Pastikan hasil ujian bukan dalam status Belum Sync
    if (
      session.syncStatus === 'pending_sync' ||
      session.syncStatus === 'sync_failed' ||
      session.syncStatus === 'draft_local' ||
      revisedAttempt.syncStatus === 'pending_sync' ||
      revisedAttempt.syncStatus === 'sync_failed'
    ) {
      return {
        success: false,
        savedToServer: false,
        syncStatus: session.syncStatus || 'pending_sync',
        session,
        attempt: revisedAttempt,
        message: 'Hasil ujian ini masih berstatus Belum Sync. Selesaikan sinkronisasi ke server terlebih dahulu sebelum melakukan koreksi nilai resmi.'
      };
    }

    // 2. Wajib mengisi alasan perubahan nilai
    const cleanReason = (reason || '').trim();
    if (!cleanReason) {
      return {
        success: false,
        savedToServer: false,
        syncStatus: session.syncStatus || 'synced_server',
        session,
        attempt: revisedAttempt,
        message: 'Alasan perubahan nilai wajib diisi sebelum menyimpan koreksi.'
      };
    }

    // 3. Validasi Owner-First (Guru hanya boleh mengedit santri binaannya sendiri berdasarkan students.teacher_id)
    if (currentUser.role !== 'admin') {
      const ownerTeacherId = cleanTahsinId(student?.teacherId || (student as any)?.teacher_id || session.examinerId);
      const currentUserId = cleanTahsinId(currentUser.id);
      if (!ownerTeacherId || ownerTeacherId !== currentUserId) {
        return {
          success: false,
          savedToServer: false,
          syncStatus: session.syncStatus || 'synced_server',
          session,
          attempt: revisedAttempt,
          message: 'Akses ditolak: Anda hanya berwenang mengedit nilai santri binaan halaqah Anda sendiri.'
        };
      }
      if (period && period.status !== 'active') {
        return {
          success: false,
          savedToServer: false,
          syncStatus: session.syncStatus || 'synced_server',
          session,
          attempt: revisedAttempt,
          message: 'Periode ujian telah ditutup. Perubahan nilai pada periode tertutup memerlukan persetujuan Admin.'
        };
      }
    }

    if (!supabase) {
      return {
        success: false,
        savedToServer: false,
        syncStatus: session.syncStatus || 'synced_server',
        session,
        attempt: revisedAttempt,
        message: 'Koneksi database server tidak tersedia. Revisi nilai resmi harus dilakukan saat terhubung ke server.'
      };
    }

    const { user: activeUser, credential } = this.getActiveUserWithCredential(currentUser);
    if (!activeUser?.username || !credential) {
      this.authRequiredFlag = true;
      this.notifySyncSubscribers(currentUser);
      return {
        success: false,
        savedToServer: false,
        authRequired: true,
        syncStatus: session.syncStatus || 'synced_server',
        session,
        attempt: revisedAttempt,
        message: 'Sesi login Anda perlu diperbarui. Silakan masukkan kembali password Anda sebelum menyimpan koreksi nilai.'
      };
    }

    // 4. Hitung ulang Nilai Akhir, Predikat, dan Status Kelulusan secara otomatis
    const mScore = Number(revisedAttempt.makharij.score);
    const tScore = Number(revisedAttempt.tajwid.score);
    const kScore = Number(revisedAttempt.kelancaran.score);
    const wScore = Number(revisedAttempt.waqaf.score);

    const recalculatedFinalScore = this.calculateScore(mScore, tScore, kScore, wScore);
    const predikatInfo = this.getPredikat(recalculatedFinalScore);
    const recalculatedPassingStatus = this.evaluatePassing(
      recalculatedFinalScore,
      mScore,
      tScore,
      Boolean(revisedAttempt.hasCriticalError),
      period?.passingGrade || 70,
      period?.minMakharij || 70,
      period?.minTajwid || 70
    );

    const expectedVersion = session.version || 1;
    const priorAttempt = (session.attempts || []).find(a => a.id === revisedAttempt.id) || revisedAttempt;
    const oldScore = priorAttempt.finalScore;
    const oldStatus = priorAttempt.passingStatus;

    try {
      const { data: rpcRes, error: rpcErr } = await supabase.rpc('save_tahsin_attempt_secure', {
        p_username: activeUser.username,
        p_password: credential,
        p_session_id: session.id,
        p_attempt_id: revisedAttempt.id,
        p_expected_version: expectedVersion,
        p_is_finalize: true,
        p_attempt_data: {
          sessionData: {
            periodId: session.periodId,
            studentId: session.studentId,
            studentNameSnapshot: session.studentNameSnapshot,
            classSnapshot: session.classSnapshot,
            halaqahSnapshot: session.halaqahSnapshot,
            targetJuzStart: session.targetJuzStart,
            targetJuzEnd: session.targetJuzEnd
          },
          finalScore: recalculatedFinalScore,
          predikat: predikatInfo.predikat,
          passingStatus: recalculatedPassingStatus,
          attemptNumber: revisedAttempt.attemptNumber || 1,
          attemptType: revisedAttempt.attemptType || 'utama',
          examDate: revisedAttempt.examDate,
          reading: revisedAttempt.reading,
          makharij: {
            ...revisedAttempt.makharij,
            score: mScore,
            category: revisedAttempt.makharij.category || this.getCategoryFromScore(mScore)
          },
          tajwid: {
            ...revisedAttempt.tajwid,
            score: tScore,
            category: revisedAttempt.tajwid.category || this.getCategoryFromScore(tScore)
          },
          kelancaran: {
            ...revisedAttempt.kelancaran,
            score: kScore,
            category: revisedAttempt.kelancaran.category || this.getCategoryFromScore(kScore)
          },
          waqaf: {
            ...revisedAttempt.waqaf,
            score: wScore,
            category: revisedAttempt.waqaf.category || this.getCategoryFromScore(wScore)
          },
          hasCriticalError: Boolean(revisedAttempt.hasCriticalError),
          criticalErrorReason: revisedAttempt.criticalErrorReason,
          errorCounts: revisedAttempt.errorCounts || {},
          coachingNotes: revisedAttempt.coachingNotes
        },
        p_reason: cleanReason
      });

      if (rpcErr) {
        throw rpcErr;
      }

      if (rpcRes?.conflict) {
        return {
          success: false,
          savedToServer: false,
          conflictDetected: true,
          serverVersion: rpcRes.server_version || rpcRes.version,
          syncStatus: 'synced_server',
          session,
          attempt: priorAttempt,
          message: rpcRes.message || 'Konflik dua perangkat: Nilai santri ini telah diubah pada perangkat lain. Silakan muat ulang data terbaru.'
        };
      }

      if (!rpcRes || !rpcRes.success) {
        return {
          success: false,
          savedToServer: false,
          syncStatus: 'synced_server',
          session,
          attempt: priorAttempt,
          message: rpcRes?.message || 'Server menolak perubahan nilai.'
        };
      }

      // Server telah mengonfirmasi revisi nilai! Perbarui objek attempt, session, dan auditLogs
      const newVersion = rpcRes.server_version || rpcRes.version || expectedVersion + 1;
      const nowIso = rpcRes.updated_at || new Date().toISOString();

      const finalizedRevision: TahsinAttempt = {
        ...revisedAttempt,
        finalScore: recalculatedFinalScore,
        predikat: predikatInfo.predikat,
        predikatArabic: predikatInfo.arabic,
        passingStatus: recalculatedPassingStatus,
        status: 'finalized',
        syncStatus: 'synced_server',
        version: (priorAttempt.version || 1) + 1,
        updatedAt: nowIso
      };

      const updatedAttempts = (session.attempts || []).map(a =>
        a.id === finalizedRevision.id ? finalizedRevision : a
      );

      const isLatestAttempt = finalizedRevision.attemptNumber >= (session.latestAttemptNumber || 1);
      const newAuditEntry: TahsinAuditLogItem = {
        id: `tal_${Date.now()}`,
        sessionId: session.id,
        attemptId: finalizedRevision.id,
        changedBy: activeUser.id,
        changedByName: activeUser.name,
        changeType: 'revision_score',
        oldScore,
        newScore: recalculatedFinalScore,
        oldStatus,
        newStatus: recalculatedPassingStatus,
        reason: `${cleanReason} [Oleh: ${activeUser.name} | Skor Lama: ${oldScore.toFixed(2)} -> Skor Baru: ${recalculatedFinalScore.toFixed(2)}]`,
        createdAt: nowIso
      };

      const updatedSession: TahsinSession = {
        ...session,
        status: isLatestAttempt
          ? (recalculatedPassingStatus === 'lulus' ? 'completed' : 'remedial_needed')
          : session.status,
        finalScore: isLatestAttempt ? recalculatedFinalScore : session.finalScore,
        predikat: isLatestAttempt ? predikatInfo.predikat : session.predikat,
        passingStatus: isLatestAttempt ? recalculatedPassingStatus : session.passingStatus,
        version: newVersion,
        lastUpdatedBy: activeUser.id,
        lastUpdatedByName: activeUser.name,
        syncStatus: 'synced_server',
        attempts: updatedAttempts,
        auditLogs: [newAuditEntry, ...(session.auditLogs || [])],
        updatedAt: nowIso
      };

      // Simpan ke local cache hanya SETELAH dikonfirmasi server
      const localSessions = this.getLocalSessions();
      const sIdx = localSessions.findIndex(s => s.id === updatedSession.id);
      if (sIdx >= 0) {
        localSessions[sIdx] = updatedSession;
      } else {
        localSessions.unshift(updatedSession);
      }
      this.saveLocalSessions(localSessions);

      return {
        success: true,
        savedToServer: true,
        syncStatus: 'synced_server',
        session: updatedSession,
        attempt: finalizedRevision,
        message: rpcRes.message || 'Perubahan nilai Ujian Tahsin berhasil disimpan dan tercatat di audit log server!'
      };
    } catch (err: any) {
      return {
        success: false,
        savedToServer: false,
        syncStatus: 'synced_server',
        session,
        attempt: priorAttempt,
        message: err?.message || 'Gagal menghubungi server untuk menyimpan perubahan nilai.'
      };
    }
  }

  // Sinkronisasi Ulang Antrean Tertunda (Otomatis maupun Manual, dengan Mutual Exclusion Lock & Tanpa Batas Trap Permanen)
  public async syncPendingAttempts(
    currentUser?: User,
    options?: { forceManual?: boolean }
  ): Promise<{ total: number; succeeded: number; failed: number; conflicts: number; authRequired?: boolean; details: any[] }> {
    // 1. Cegah eksekusi paralel bersamaan (Requirement A.12: Race Condition Guard)
    if (this.activeSyncPromise) {
      return this.activeSyncPromise;
    }

    this.activeSyncPromise = this._executeSyncPendingAttempts(currentUser, options);
    try {
      return await this.activeSyncPromise;
    } finally {
      this.activeSyncPromise = null;
    }
  }

  private async _executeSyncPendingAttempts(
    currentUser?: User,
    options?: { forceManual?: boolean }
  ): Promise<{ total: number; succeeded: number; failed: number; conflicts: number; authRequired?: boolean; details: any[] }> {
    const forceManual = Boolean(options?.forceManual);
    const { user: activeUser, credential } = this.getActiveUserWithCredential(currentUser);

    const allQueue = this.getPendingSyncQueue();
    // 2. Isolasi Ketat Antarakun (Requirement A.11: Data lokal Guru A TIDAK BOLEH disinkronkan menggunakan akun Guru B)
    const userQueue = activeUser
      ? allQueue.filter(item => {
          const itemExaminerId = cleanTahsinId(item.examinerId);
          const myId = cleanTahsinId(activeUser.id);
          if (itemExaminerId && myId) {
            return itemExaminerId === myId;
          }
          if (item.examinerUsername && activeUser.username) {
            return item.examinerUsername === activeUser.username;
          }
          return false;
        })
      : [];

    const result = {
      total: userQueue.length,
      succeeded: 0,
      failed: 0,
      conflicts: 0,
      authRequired: false,
      details: [] as any[]
    };

    if (userQueue.length === 0 || !supabase) {
      this.notifySyncSubscribers(activeUser);
      return result;
    }

    if (!activeUser?.username || !credential) {
      this.authRequiredFlag = true;
      this.lastSyncErrorMsg = 'Sesi keamanan login perlu diperbarui untuk menyinkronkan nilai lokal ke server.';
      result.authRequired = true;
      result.failed = userQueue.length;
      this.notifySyncSubscribers(activeUser);
      return result;
    }

    this.isCurrentlySyncing = true;
    this.notifySyncSubscribers(activeUser);

    try {
      for (const item of userQueue) {
        // Jika terjadi konflik dua perangkat, jangan otomatis menimpa nilai server (Requirement A.10)
        if (item.conflictDetected && !forceManual) {
          result.conflicts++;
          result.details.push({ id: item.attemptId, status: 'conflict', message: item.lastError });
          continue;
        }

        // Pada mode otomatis (bukan klik manual), terapkan exponential backoff yang aman
        if (!forceManual && item.retryCount > 0 && item.lastAttemptAt) {
          const elapsedMs = Date.now() - new Date(item.lastAttemptAt).getTime();
          const backoffMs = Math.min(180000, 3000 * Math.pow(2, Math.min(item.retryCount - 1, 5)));
          if (elapsedMs < backoffMs) {
            result.details.push({ id: item.attemptId, status: 'backoff_waiting' });
            continue;
          }
        }

        // Jika pengguna klik "Sinkronkan Sekarang" (forceManual), buka kembali batas retryCount agar tidak terjebak permanen (Requirement A.13)
        if (forceManual && item.retryCount >= 5) {
          item.retryCount = 0;
          item.conflictDetected = false;
          item.authError = false;
        } else if (!forceManual && item.retryCount >= 10) {
          result.failed++;
          result.details.push({ id: item.attemptId, status: 'awaiting_manual_sync', error: item.lastError });
          continue;
        }

        try {
          const res = await this.saveAttempt(
            item.payload.session,
            item.payload.attempt,
            true,
            activeUser
          );

          if (res.savedToServer) {
            result.succeeded++;
            result.details.push({ id: item.attemptId, status: 'synced' });
          } else if (res.conflictDetected) {
            result.conflicts++;
            item.conflictDetected = true;
            item.lastAttemptAt = new Date().toISOString();
            item.lastError = res.message;
            this.addToPendingSync(item);
            result.details.push({ id: item.attemptId, status: 'conflict', message: res.message });
          } else {
            result.failed++;
            item.retryCount = (item.retryCount || 0) + 1;
            item.lastAttemptAt = new Date().toISOString();
            item.lastError = res.message;
            if (res.authRequired) {
              item.authError = true;
              result.authRequired = true;
            }
            this.addToPendingSync(item);
            result.details.push({ id: item.attemptId, status: 'failed', error: res.message });
            if (res.authRequired) {
              // Hentikan loop jika token tidak valid agar tidak menaikkan retryCount item berikutnya
              break;
            }
          }
        } catch (err: any) {
          result.failed++;
          item.retryCount = (item.retryCount || 0) + 1;
          item.lastAttemptAt = new Date().toISOString();
          item.lastError = err?.message || 'Network error';
          this.addToPendingSync(item);
          result.details.push({ id: item.attemptId, status: 'exception', error: err?.message });
        }
      }
    } finally {
      this.isCurrentlySyncing = false;
      this.notifySyncSubscribers(activeUser);
    }

    return result;
  }

  // Generate / Inisialisasi Peserta Ujian untuk Satu Periode
  public initializeSessionsForPeriod(
    period: TahsinPeriod,
    students: Student[],
    teachers?: User[],
    serverSessions?: TahsinSession[]
  ): TahsinSession[] {
    const local = this.getLocalSessions().filter(s => s.periodId === period.id);

    // Gabungkan serverSessions (jika disediakan) dengan local sessions secara aman
    const sourceSessions: TahsinSession[] = [...(serverSessions || [])];
    local.forEach(ls => {
      const idx = sourceSessions.findIndex(s => s.studentId === ls.studentId || s.id === ls.id);
      if (idx === -1) {
        sourceSessions.push(ls);
      } else if (ls.syncStatus === 'pending_sync' || ls.syncStatus === 'sync_failed' || ls.syncStatus === 'draft_local') {
        sourceSessions[idx] = this.mergeServerAndLocalSession(sourceSessions[idx], ls);
      }
    });

    const existingMap = new Map(sourceSessions.map(s => [s.studentId, s]));

    const targetClassesSet = new Set((period.targetClasses || []).map(c => c.trim().toUpperCase()));
    const isPilotDummyPeriod = period.id === 'tp_pilot_test' || targetClassesSet.has('7-UJI');

    // Filter santri yang masuk dalam kelas target (pisahkan santri dummy 7-UJI dari periode resmi)
    const eligibleStudents = students.filter(s => {
      const cls = (s.class || '').trim().toUpperCase();
      const isDummyStudent =
        cls === '7-UJI' ||
        s.id === 'student_dummy_pilot_01' ||
        (s.name || '').toUpperCase().includes('(DUMMY)');
      if (isDummyStudent && !isPilotDummyPeriod) {
        return false;
      }
      if (targetClassesSet.size === 0) return true;
      return targetClassesSet.has(cls);
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

    // Pertahankan juga sesi yang sudah ada di existing tapi santrinya tidak masuk di eligibleStudents
    // Namun tetap cegah sesi santri dummy 7-UJI masuk ke periode resmi
    const mappedIds = new Set(newSessions.map(s => s.id));
    const extraExisting = sourceSessions.filter(s => {
      if (mappedIds.has(s.id)) return false;
      const cls = (s.classSnapshot || '').trim().toUpperCase();
      const isDummy =
        cls === '7-UJI' ||
        s.studentId === 'student_dummy_pilot_01' ||
        (s.studentNameSnapshot || '').toUpperCase().includes('(DUMMY)');
      if (isDummy && !isPilotDummyPeriod) return false;
      return true;
    });
    const allCombined = [...newSessions, ...extraExisting];

    // Simpan hasil gabungan ke local storage
    const otherSessions = this.getLocalSessions().filter(s => s.periodId !== period.id);
    this.saveLocalSessions([...allCombined, ...otherSessions]);

    return allCombined;
  }

  // Helper menentukan apakah sebuah sesi sudah selesai diuji secara resmi (bukan draft atau pending_sync)
  public isSessionTested(s: TahsinSession): boolean {
    if (!s) return false;
    // Status not_started atau draft tidak pernah dihitung sebagai ujian resmi yang selesai
    if (s.status === 'not_started' || s.status === 'draft') return false;

    // Cek attempt yang sudah disahkan secara resmi (bukan draft_local / pending_sync / sync_failed)
    const officialAttempts = (s.attempts || []).filter(
      a => a.status === 'finalized' &&
           a.syncStatus !== 'draft_local' &&
           a.syncStatus !== 'pending_sync' &&
           a.syncStatus !== 'sync_failed'
    );
    if (officialAttempts.length > 0) return true;

    // Jika sesi sendiri masih berstatus belum tersinkron ke server dan tidak punya attempt resmi, jangan dihitung sebagai hasil resmi
    if (
      s.syncStatus === 'draft_local' ||
      s.syncStatus === 'pending_sync' ||
      s.syncStatus === 'sync_failed'
    ) {
      return false;
    }

    // Jika ada attempts tetapi semuanya masih belum resmi (misal draft), jangan hitung
    if (s.attempts && s.attempts.length > 0 && officialAttempts.length === 0) {
      return false;
    }

    // Sesi completed / remedial_needed atau passingStatus terisi resmi
    return s.status === 'completed' ||
      s.status === 'remedial_needed' ||
      s.passingStatus === 'lulus' ||
      s.passingStatus === 'remedial' ||
      (s.finalScore !== undefined && s.finalScore !== null && !isNaN(Number(s.finalScore)));
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
      if (!this.isSessionTested(s)) return;

      // Ambil attempt terakhir yang disahkan secara resmi (bukan pending_sync / draft_local)
      const finalizedAttempts = (s.attempts || []).filter(
        a => a.status === 'finalized' &&
             a.syncStatus !== 'draft_local' &&
             a.syncStatus !== 'pending_sync' &&
             a.syncStatus !== 'sync_failed'
      );
      if (finalizedAttempts.length > 0) {
        testedCount++;
        const latestAttempt = finalizedAttempts.sort((a, b) => b.attemptNumber - a.attemptNumber)[0];

        sumFinalScore += latestAttempt.finalScore || 0;
        sumMakharij += latestAttempt.makharij?.score || 0;
        sumTajwid += latestAttempt.tajwid?.score || 0;
        sumKelancaran += latestAttempt.kelancaran?.score || 0;
        sumWaqaf += latestAttempt.waqaf?.score || 0;

        const isLulus = latestAttempt.passingStatus === 'lulus' || 
          (!latestAttempt.passingStatus && (latestAttempt.finalScore || 0) >= 70);
        if (isLulus) {
          passedCount++;
          if (finalizedAttempts.length > 1) {
            remedialCompletedCount++;
          }
        } else {
          remedialNeededCount++;
        }
      } else {
        testedCount++;
        const score = Number(s.finalScore || 0);
        sumFinalScore += score;
        if (s.passingStatus === 'lulus' || s.status === 'completed') {
          passedCount++;
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

