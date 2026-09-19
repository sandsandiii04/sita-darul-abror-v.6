import { 
  FluencyEventType, 
  TajwidEventType, 
  MakhrajEventType, 
  UTSAssessmentEvent, 
  ExamQuestionAssessment, 
  UTSScoringConfig 
} from '../types';

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

export const FLUENCY_BUTTONS: CounterButtonDef<FluencyEventType>[] = [
  {
    type: 'self_correction',
    label: 'Koreksi Mandiri',
    shortLabel: 'Koreksi',
    deduction: 0.5,
    description: 'Santri salah kata namun langsung memperbaiki sendiri tanpa teguran',
    badgeClass: 'bg-amber-100 text-amber-800 border-amber-300',
    btnClass: 'border-amber-300 hover:bg-amber-50 text-amber-900 active:bg-amber-100'
  },
  {
    type: 'reminder',
    label: 'Ditegur / Diingatkan',
    shortLabel: 'Ditegur',
    deduction: 1.0,
    description: 'Penguji mengetuk meja/memberikan teguran tanpa membaca lafazh',
    badgeClass: 'bg-orange-100 text-orange-800 border-orange-300',
    btnClass: 'border-orange-300 hover:bg-orange-50 text-orange-900 active:bg-orange-100'
  },
  {
    type: 'prompt',
    label: 'Pancingan Lafazh',
    shortLabel: 'Pancingan',
    deduction: 2.0,
    description: 'Penguji membacakan 1-2 kata pemandu karena santri macet',
    badgeClass: 'bg-rose-100 text-rose-800 border-rose-300',
    btnClass: 'border-rose-300 hover:bg-rose-50 text-rose-900 active:bg-rose-100'
  },
  {
    type: 'unable',
    label: 'Tidak Bisa / Terhenti',
    shortLabel: 'Gagal',
    deduction: 4.0,
    description: 'Santri benar-benar tidak mampu melanjutkan meskipun dipandu',
    badgeClass: 'bg-red-200 text-red-900 border-red-400',
    btnClass: 'border-red-400 hover:bg-red-50 text-red-950 active:bg-red-200'
  }
];

export const TAJWID_BUTTONS: CounterButtonDef<TajwidEventType>[] = [
  {
    type: 'minor',
    label: 'Tajwid Ringan',
    shortLabel: 'Ringan',
    deduction: 0.5,
    description: 'Kesalahan ghunnah kurang panjang, ikhfa kurang samar, mad far\'i kurang',
    badgeClass: 'bg-indigo-100 text-indigo-800 border-indigo-300',
    btnClass: 'border-indigo-300 hover:bg-indigo-50 text-indigo-900 active:bg-indigo-100'
  },
  {
    type: 'major',
    label: 'Tajwid Nyata / Lahn Jali',
    shortLabel: 'Mayor / Jali',
    deduction: 1.0,
    description: 'Perubahan harakat, mad ashli dibaca pendek, huruf tertinggal',
    badgeClass: 'bg-purple-100 text-purple-800 border-purple-300',
    btnClass: 'border-purple-300 hover:bg-purple-50 text-purple-900 active:bg-purple-100'
  }
];

export const MAKHRAJ_BUTTONS: CounterButtonDef<MakhrajEventType>[] = [
  {
    type: 'minor',
    label: 'Makhraj Kurang Tepat',
    shortLabel: 'Kurang Pas',
    deduction: 0.5,
    description: 'Sifat huruf kurang sempurna (hams kurang, qalqalah tipis, tafkhim kurang tebal)',
    badgeClass: 'bg-teal-100 text-teal-800 border-teal-300',
    btnClass: 'border-teal-300 hover:bg-teal-50 text-teal-900 active:bg-teal-100'
  },
  {
    type: 'major',
    label: 'Makhraj Tertukar',
    shortLabel: 'Tertukar',
    deduction: 1.0,
    description: 'Huruf tertukar (e.g., Sin dengan Shad, Ta dengan Tha, Ha dengan Kha, Ain dengan Hamzah)',
    badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    btnClass: 'border-emerald-300 hover:bg-emerald-50 text-emerald-900 active:bg-emerald-100'
  }
];

export function calculateFluencyScore(events: UTSAssessmentEvent[]): { score: number; deduction: number } {
  let deduction = 0;
  for (const ev of events) {
    if (ev.type === 'self_correction') deduction += 0.5;
    else if (ev.type === 'reminder') deduction += 1.0;
    else if (ev.type === 'prompt') deduction += 2.0;
    else if (ev.type === 'unable') deduction += 4.0;
    else if (typeof ev.deduction === 'number') deduction += ev.deduction;
  }
  const score = Math.max(0, UTS_SCORING_CONFIG.maxFluency - deduction);
  return {
    score: Math.round(score * 100) / 100,
    deduction: Math.round(deduction * 100) / 100
  };
}

export function calculateTajwidScore(events: UTSAssessmentEvent[]): { score: number; deduction: number } {
  let deduction = 0;
  for (const ev of events) {
    if (ev.type === 'minor') deduction += 0.5;
    else if (ev.type === 'major') deduction += 1.0;
    else if (typeof ev.deduction === 'number') deduction += ev.deduction;
  }
  const score = Math.max(0, UTS_SCORING_CONFIG.maxTajwid - deduction);
  return {
    score: Math.round(score * 100) / 100,
    deduction: Math.round(deduction * 100) / 100
  };
}

export function calculateMakhrajScore(events: UTSAssessmentEvent[]): { score: number; deduction: number } {
  let deduction = 0;
  for (const ev of events) {
    if (ev.type === 'minor') deduction += 0.5;
    else if (ev.type === 'major') deduction += 1.0;
    else if (typeof ev.deduction === 'number') deduction += ev.deduction;
  }
  const score = Math.max(0, UTS_SCORING_CONFIG.maxMakhraj - deduction);
  return {
    score: Math.round(score * 100) / 100,
    deduction: Math.round(deduction * 100) / 100
  };
}

export function calculateQuestionScore(fluency: number, tajwid: number, makhraj: number): number {
  const total = fluency + tajwid + makhraj;
  return Math.round(Math.min(UTS_SCORING_CONFIG.maxQuestionScore, Math.max(0, total)) * 100) / 100;
}

export function calculateAttemptTotalScore(assessments: ExamQuestionAssessment[]): number {
  let sum = 0;
  for (const a of assessments) {
    sum += a.questionScore;
  }
  return Math.round(Math.min(UTS_SCORING_CONFIG.maxTotalScore, Math.max(0, sum)) * 100) / 100;
}

export function generateEventId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
}
