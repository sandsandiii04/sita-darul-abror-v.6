import { 
  FluencyEventType, 
  TajwidEventType, 
  MakhrajEventType, 
  UTSAssessmentEvent, 
  ExamQuestionAssessment, 
  UTSScoringConfig 
} from '../types';

/**
 * Baseline static configuration for default 5-question / 20-point UTS
 */
export const UTS_SCORING_CONFIG: UTSScoringConfig = {
  maxFluency: 12,
  maxTajwid: 4,
  maxMakhraj: 4,
  maxQuestionScore: 20,
  totalQuestions: 5,
  maxTotalScore: 100
};

export interface CounterButtonDef<T> {
  type: T;
  label: string;
  shortLabel: string;
  deduction: number;
  description: string;
  badgeClass: string;
  btnClass: string;
}

export interface QuestionRubricConfig {
  questionMax: number;
  fluencyMax: number;
  tajwidMax: number;
  makhrajMax: number;
  scale: number;
}

/**
 * Menghitung rubrik skor per butir soal secara deterministik (Exact 60% / 20% / 20%).
 * Menjamin: fluencyMax + tajwidMax + makhrajMax === questionMax.
 */
export function getQuestionRubricConfig(questionMax: number = 20): QuestionRubricConfig {
  const qMax = Math.round(questionMax * 100) / 100;
  const scale = qMax / 20.00;
  const fluencyMax = Math.round(qMax * 0.60 * 100) / 100;
  const tajwidMax = Math.round(qMax * 0.20 * 100) / 100;
  // Sisa selisih dialokasikan ke makhraj agar penjumlahan tepat sama dengan qMax tanpa floating error
  const makhrajMax = Math.round((qMax - fluencyMax - tajwidMax) * 100) / 100;

  return {
    questionMax: qMax,
    fluencyMax,
    tajwidMax,
    makhrajMax,
    scale
  };
}

/**
 * Tombol Kelancaran Dinamis berdasarkan Bobot Soal
 */
export function getFluencyButtons(questionMax: number = 20): CounterButtonDef<FluencyEventType>[] {
  const scale = questionMax / 20.00;
  return [
    {
      type: 'self_correction',
      label: 'Koreksi Mandiri',
      shortLabel: 'Koreksi Mandiri',
      deduction: Math.round(0.5 * scale * 1000) / 1000,
      description: 'Santri memperbaiki kesalahan sendiri secara spontan tanpa teguran',
      badgeClass: 'bg-amber-100 text-amber-800 border-amber-300',
      btnClass: 'border-amber-300 hover:bg-amber-50 text-amber-900 active:bg-amber-100'
    },
    {
      type: 'reminder',
      label: 'Diingatkan',
      shortLabel: 'Diingatkan',
      deduction: Math.round(1.0 * scale * 1000) / 1000,
      description: 'Penguji memberikan teguran atau ketukan tanpa membaca lafaz',
      badgeClass: 'bg-orange-100 text-orange-800 border-orange-300',
      btnClass: 'border-orange-300 hover:bg-orange-50 text-orange-900 active:bg-orange-100'
    },
    {
      type: 'prompt',
      label: 'Bantuan Lafaz',
      shortLabel: 'Bantuan Lafaz',
      deduction: Math.round(2.0 * scale * 1000) / 1000,
      description: 'Penguji membacakan 1-2 kata pemandu karena santri terhenti',
      badgeClass: 'bg-rose-100 text-rose-800 border-rose-300',
      btnClass: 'border-rose-300 hover:bg-rose-50 text-rose-900 active:bg-rose-100'
    },
    {
      type: 'unable',
      label: 'Tidak Mampu',
      shortLabel: 'Tidak Mampu',
      deduction: Math.round(4.0 * scale * 1000) / 1000,
      description: 'Santri tidak mampu melanjutkan bacaan meski telah dipandu',
      badgeClass: 'bg-red-200 text-red-900 border-red-400',
      btnClass: 'border-red-400 hover:bg-red-50 text-red-950 active:bg-red-200'
    }
  ];
}

/**
 * Tombol Tajwid Dinamis berdasarkan Bobot Soal
 */
export function getTajwidButtons(questionMax: number = 20): CounterButtonDef<TajwidEventType>[] {
  const scale = questionMax / 20.00;
  return [
    {
      type: 'minor',
      label: 'Ringan',
      shortLabel: 'Ringan',
      deduction: Math.round(0.5 * scale * 1000) / 1000,
      description: 'Kesalahan tajwid ringan (ghunnah kurang panjang, ikhfa kurang samar)',
      badgeClass: 'bg-indigo-100 text-indigo-800 border-indigo-300',
      btnClass: 'border-indigo-300 hover:bg-indigo-50 text-indigo-900 active:bg-indigo-100'
    },
    {
      type: 'major',
      label: 'Lahn',
      shortLabel: 'Lahn',
      deduction: Math.round(1.0 * scale * 1000) / 1000,
      description: 'Kesalahan tajwid fatal (perubahan harakat, mad ashli dibaca pendek)',
      badgeClass: 'bg-purple-100 text-purple-800 border-purple-300',
      btnClass: 'border-purple-300 hover:bg-purple-50 text-purple-900 active:bg-purple-100'
    }
  ];
}

/**
 * Tombol Makhraj & Sifat Huruf Dinamis berdasarkan Bobot Soal
 */
export function getMakhrajButtons(questionMax: number = 20): CounterButtonDef<MakhrajEventType>[] {
  const scale = questionMax / 20.00;
  return [
    {
      type: 'minor',
      label: 'Kurang Tepat',
      shortLabel: 'Kurang Tepat',
      deduction: Math.round(0.5 * scale * 1000) / 1000,
      description: 'Sifat huruf kurang sempurna (hams kurang, qalqalah tipis, tafkhim kurang tebal)',
      badgeClass: 'bg-teal-100 text-teal-800 border-teal-300',
      btnClass: 'border-teal-300 hover:bg-teal-50 text-teal-900 active:bg-teal-100'
    },
    {
      type: 'major',
      label: 'Tertukar',
      shortLabel: 'Tertukar',
      deduction: Math.round(1.0 * scale * 1000) / 1000,
      description: 'Huruf tertukar (e.g. Sin dengan Shad, Ta dengan Tha, Ha dengan Kha)',
      badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300',
      btnClass: 'border-emerald-300 hover:bg-emerald-50 text-emerald-900 active:bg-emerald-100'
    }
  ];
}

// Default export buttons untuk baseline 20 poin (Backward Compatibility)
export const FLUENCY_BUTTONS: CounterButtonDef<FluencyEventType>[] = getFluencyButtons(20);
export const TAJWID_BUTTONS: CounterButtonDef<TajwidEventType>[] = getTajwidButtons(20);
export const MAKHRAJ_BUTTONS: CounterButtonDef<MakhrajEventType>[] = getMakhrajButtons(20);

/**
 * Kalkulasi Nilai Kelancaran Dinamis
 */
export function calculateFluencyScore(events: UTSAssessmentEvent[], questionMax: number = 20): { score: number; deduction: number } {
  const rubric = getQuestionRubricConfig(questionMax);
  let deduction = 0;
  for (const ev of events) {
    if (ev.type === 'self_correction') deduction += 0.5 * rubric.scale;
    else if (ev.type === 'reminder') deduction += 1.0 * rubric.scale;
    else if (ev.type === 'prompt') deduction += 2.0 * rubric.scale;
    else if (ev.type === 'unable') deduction += 4.0 * rubric.scale;
    else if (typeof ev.deduction === 'number') deduction += ev.deduction;
  }
  const score = Math.max(0, Math.round((rubric.fluencyMax - deduction) * 100) / 100);
  return {
    score,
    deduction: Math.round(deduction * 100) / 100
  };
}

/**
 * Kalkulasi Nilai Tajwid Dinamis
 */
export function calculateTajwidScore(events: UTSAssessmentEvent[], questionMax: number = 20): { score: number; deduction: number } {
  const rubric = getQuestionRubricConfig(questionMax);
  let deduction = 0;
  for (const ev of events) {
    if (ev.type === 'minor') deduction += 0.5 * rubric.scale;
    else if (ev.type === 'major') deduction += 1.0 * rubric.scale;
    else if (typeof ev.deduction === 'number') deduction += ev.deduction;
  }
  const score = Math.max(0, Math.round((rubric.tajwidMax - deduction) * 100) / 100);
  return {
    score,
    deduction: Math.round(deduction * 100) / 100
  };
}

/**
 * Kalkulasi Nilai Makhraj Dinamis
 */
export function calculateMakhrajScore(events: UTSAssessmentEvent[], questionMax: number = 20): { score: number; deduction: number } {
  const rubric = getQuestionRubricConfig(questionMax);
  let deduction = 0;
  for (const ev of events) {
    if (ev.type === 'minor') deduction += 0.5 * rubric.scale;
    else if (ev.type === 'major') deduction += 1.0 * rubric.scale;
    else if (typeof ev.deduction === 'number') deduction += ev.deduction;
  }
  const score = Math.max(0, Math.round((rubric.makhrajMax - deduction) * 100) / 100);
  return {
    score,
    deduction: Math.round(deduction * 100) / 100
  };
}

/**
 * Kalkulasi Nilai Akhir Butir Soal (Lantai 0 dan Plafon questionMax)
 */
export function calculateQuestionScore(fluency: number, tajwid: number, makhraj: number, questionMax: number = 20): number {
  const total = fluency + tajwid + makhraj;
  return Math.round(Math.min(questionMax, Math.max(0, total)) * 100) / 100;
}

/**
 * Menjumlahkan Skor Seluruh Butir Soal dalam Sesi Ujian (Maksimal 100.00)
 */
export function calculateAttemptTotalScore(assessments: ExamQuestionAssessment[]): number {
  let sum = 0;
  for (const a of assessments) {
    sum += (a.questionScore || 0);
  }
  return Math.round(Math.min(100.00, Math.max(0, sum)) * 100) / 100;
}

export function generateEventId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
}
