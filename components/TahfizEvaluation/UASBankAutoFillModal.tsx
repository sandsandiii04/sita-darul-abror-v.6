import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ExamUASSession, QuestionBankItem, User } from '../../types';
import { api } from '../../api';
import { UASEligibilityItem } from '../../services/uasBulkEligibilityService';
import {
  buildAutoCandidatesFromQuran,
  DraftFillCandidate,
  NewAutoFillCandidate,
  planUASBankFill,
  UASBankFillPlan
} from '../../services/uasBankAutoFillService';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  X
} from 'lucide-react';

interface UASBankAutoFillModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessions: ExamUASSession[];
  eligibilityItems: UASEligibilityItem[];
  bankQuestions: QuestionBankItem[];
  user: User;
  onActivated: () => Promise<void>;
}

export const UASBankAutoFillModal: React.FC<UASBankAutoFillModalProps> = ({
  isOpen,
  onClose,
  sessions,
  eligibilityItems,
  bankQuestions,
  user,
  onActivated
}) => {
  const isAdmin = user.role === 'admin';

  // Snapshot plan saat modal dibuka (tidak berubah-ubah saat proses simpan berlangsung)
  const [plan, setPlan] = useState<UASBankFillPlan | null>(null);
  const [autoCandidates, setAutoCandidates] = useState<NewAutoFillCandidate[]>([]);
  const [loadingTexts, setLoadingTexts] = useState(false);
  const [loadProgress, setLoadProgress] = useState<{ loaded: number; total: number }>({ loaded: 0, total: 0 });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [rejectedIds, setRejectedIds] = useState<Set<string>>(new Set());

  const [isActivating, setIsActivating] = useState(false);
  const [saveProgress, setSaveProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [activationSummary, setActivationSummary] = useState<{
    savedCount: number;
    failedItems: Array<{ id: string; label: string; reason: string }>;
  } | null>(null);

  const inFlightRef = useRef(false);
  const cancelledRef = useRef(false);

  const runPlanAndLoad = async () => {
    cancelledRef.current = false;
    setActivationSummary(null);
    setRejectedIds(new Set());
    setSavedIds(new Set());

    const computedPlan = planUASBankFill({
      sessions,
      eligibilityItems,
      bankQuestions
    });
    setPlan(computedPlan);

    const initialSelected = new Set<string>(
      computedPlan.validDraftCandidates.filter(d => d.readiness === 'ready').map(d => d.id)
    );
    setSelectedIds(initialSelected);

    if (computedPlan.newVerseTargets.length === 0) {
      setAutoCandidates([]);
      setLoadingTexts(false);
      return;
    }

    setLoadingTexts(true);
    setLoadProgress({ loaded: 0, total: computedPlan.newVerseTargets.length });
    try {
      const built = await buildAutoCandidatesFromQuran({
        targets: computedPlan.newVerseTargets,
        existingBankQuestions: bankQuestions,
        onProgress: (loaded, total) => {
          if (!cancelledRef.current) setLoadProgress({ loaded, total });
        }
      });
      if (cancelledRef.current) return;
      setAutoCandidates(built);
      setSelectedIds(prev => {
        const next = new Set(prev);
        built.forEach(c => {
          if (c.readiness === 'ready') next.add(c.id);
        });
        return next;
      });
    } finally {
      if (!cancelledRef.current) setLoadingTexts(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    runPlanAndLoad();
    return () => {
      cancelledRef.current = true;
    };
    // Sengaja hanya dijalankan ulang saat modal dibuka
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const visibleDrafts = useMemo<DraftFillCandidate[]>(() => {
    if (!plan) return [];
    return plan.validDraftCandidates.filter(d => !rejectedIds.has(d.id));
  }, [plan, rejectedIds]);

  const visibleAuto = useMemo<NewAutoFillCandidate[]>(() => {
    return autoCandidates.filter(c => !rejectedIds.has(c.id));
  }, [autoCandidates, rejectedIds]);

  const readyDraftsCount = visibleDrafts.filter(d => d.readiness === 'ready').length;
  const readyAutoCount = visibleAuto.filter(c => c.readiness === 'ready').length;
  const notReadyAutoCount = visibleAuto.filter(c => c.readiness === 'not_ready').length;

  const selectedReadyItems = useMemo(() => {
    const items: Array<{ id: string; label: string; question: QuestionBankItem; kind: 'existing_draft' | 'new_auto' }> = [];
    for (const d of visibleDrafts) {
      if (d.readiness === 'ready' && selectedIds.has(d.id) && !savedIds.has(d.id)) {
        items.push({
          id: d.id,
          label: `Draft Juz ${d.juzNumber} • ${d.surahLabel} (Hal ${d.actualStartPage})`,
          question: { ...d.question, status: 'active' },
          kind: 'existing_draft'
        });
      }
    }
    for (const c of visibleAuto) {
      if (c.readiness === 'ready' && c.question && selectedIds.has(c.id) && !savedIds.has(c.id)) {
        items.push({
          id: c.id,
          label: `Baru Juz ${c.juzNumber} • ${c.surahLabel} (Hal ${c.pageNumber})`,
          question: { ...c.question, status: 'active', createdBy: user.id || user.username || 'admin' },
          kind: 'new_auto'
        });
      }
    }
    return items;
  }, [visibleDrafts, visibleAuto, selectedIds, savedIds]);

  const estimatedHelpedSummary = useMemo(() => {
    const sessSet = new Set<string>();
    const stuSet = new Set<string>();
    for (const d of visibleDrafts) {
      if (selectedIds.has(d.id)) {
        d.helpedSessionKeys.forEach(k => sessSet.add(k));
        d.helpedStudentIds.forEach(s => stuSet.add(s));
      }
    }
    for (const c of visibleAuto) {
      if (c.readiness === 'ready' && selectedIds.has(c.id)) {
        c.helpedSessionKeys.forEach(k => sessSet.add(k));
        c.helpedStudentIds.forEach(s => stuSet.add(s));
      }
    }
    return { sessions: sessSet.size, students: stuSet.size };
  }, [visibleDrafts, visibleAuto, selectedIds]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const rejectItem = (id: string) => {
    setRejectedIds(prev => new Set(prev).add(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const selectAllValid = () => {
    const next = new Set<string>();
    visibleDrafts.forEach(d => { if (d.readiness === 'ready') next.add(d.id); });
    visibleAuto.forEach(c => { if (c.readiness === 'ready') next.add(c.id); });
    setSelectedIds(next);
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  const handleBatchActivate = async () => {
    if (!isAdmin || inFlightRef.current || selectedReadyItems.length === 0) return;
    inFlightRef.current = true;
    setIsActivating(true);
    setActivationSummary(null);
    setSaveProgress({ done: 0, total: selectedReadyItems.length });

    let savedCount = 0;
    const failedItems: Array<{ id: string; label: string; reason: string }> = [];
    const newlySaved = new Set<string>();

    try {
      for (let i = 0; i < selectedReadyItems.length; i++) {
        const entry = selectedReadyItems[i];
        try {
          // Menggunakan mekanisme resmi api.saveQuestionBankItem (RPC upsert_question_bank_item — Admin-only, RLS-safe, idempoten by ID)
          const res = await api.saveQuestionBankItem(entry.question, user);
          if (res.success && !res.isDraftSaved) {
            savedCount++;
            newlySaved.add(entry.id);
          } else {
            failedItems.push({
              id: entry.id,
              label: entry.label,
              reason: res.message || 'Gagal menyimpan ke server Supabase (tersimpan lokal saja).'
            });
          }
        } catch (err: any) {
          failedItems.push({
            id: entry.id,
            label: entry.label,
            reason: err?.message || 'Timeout / gangguan jaringan saat menyimpan.'
          });
        }
        setSaveProgress({ done: i + 1, total: selectedReadyItems.length });
      }

      if (newlySaved.size > 0) {
        setSavedIds(prev => new Set([...Array.from(prev), ...Array.from(newlySaved)]));
        await onActivated();
      }
      setActivationSummary({ savedCount, failedItems });
    } finally {
      inFlightRef.current = false;
      setIsActivating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[65] bg-slate-900/65 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 bg-gradient-to-r from-teal-700 to-emerald-700 text-white flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-2xl bg-white/15 shrink-0">
              <Sparkles size={20} />
            </div>
            <div className="min-w-0">
              <h3 className="font-black text-sm sm:text-base truncate">
                Siapkan Kandidat Soal Otomatis (Review &amp; Aktivasi Massal)
              </h3>
              <p className="text-[11px] sm:text-xs text-teal-100 truncate">
                Teks Utsmani diambil langsung dari sumber Mushaf 604 halaman resmi — tidak disimpan sebelum Admin menyetujui.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={isActivating}
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-white/15 text-white/90 disabled:opacity-40"
          >
            <X size={20} />
          </button>
        </div>

        {/* Summary Strip */}
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <div className="p-2.5 rounded-xl bg-white border border-slate-200">
            <div className="text-[10px] font-bold uppercase text-slate-500">Draft Valid Tersedia</div>
            <div className="text-base font-black text-indigo-700">{readyDraftsCount} soal</div>
          </div>
          <div className="p-2.5 rounded-xl bg-white border border-slate-200">
            <div className="text-[10px] font-bold uppercase text-slate-500">Kandidat Baru Siap</div>
            <div className="text-base font-black text-teal-700">
              {loadingTexts ? `${loadProgress.loaded}/${loadProgress.total} hal...` : `${readyAutoCount} soal`}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-white border border-slate-200">
            <div className="text-[10px] font-bold uppercase text-slate-500">Belum Siap / Manual</div>
            <div className={`text-base font-black ${notReadyAutoCount > 0 ? 'text-amber-700' : 'text-slate-600'}`}>
              {notReadyAutoCount} titik
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200">
            <div className="text-[10px] font-bold uppercase text-emerald-700">Estimasi Terbantu</div>
            <div className="text-base font-black text-emerald-800">
              {estimatedHelpedSummary.students} santri ({estimatedHelpedSummary.sessions} sesi)
            </div>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
          {!isAdmin && (
            <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 font-bold">
              Akses terbatas: Hanya Admin yang dapat mengaktifkan soal ke Bank Soal produksi.
            </div>
          )}

          {activationSummary && (
            <div
              className={`p-3.5 rounded-2xl border space-y-2 ${
                activationSummary.failedItems.length === 0
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-amber-50 border-amber-200 text-amber-900'
              }`}
            >
              <div className="font-extrabold flex items-center gap-2">
                <CheckCircle2 size={16} className="shrink-0" />
                <span>
                  {activationSummary.savedCount} soal berhasil diaktifkan ke Bank Soal dan kesiapan sesi sudah diperbarui.
                  {activationSummary.failedItems.length > 0 && ` (${activationSummary.failedItems.length} soal gagal — klik tombol aktivasi lagi untuk retry aman tanpa duplikasi.)`}
                </span>
              </div>
              {activationSummary.failedItems.length > 0 && (
                <ul className="list-disc pl-5 text-[11px] space-y-0.5 text-rose-800">
                  {activationSummary.failedItems.map(f => (
                    <li key={f.id}>
                      <strong>{f.label}:</strong> {f.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* BAGIAN 1: DRAFT VALID YANG SUDAH ADA */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="font-extrabold text-sm text-indigo-950 flex items-center gap-1.5">
                <ShieldCheck size={16} className="text-indigo-600" />
                <span>Bagian 1 — Draft Bank Soal yang Sudah Ada &amp; Layak Diaktifkan ({visibleDrafts.length})</span>
              </div>
              <span className="text-[11px] text-slate-500">Hanya menampilkan draft minimal yang benar-benar menutup zona kosong</span>
            </div>

            {visibleDrafts.length === 0 ? (
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-500">
                Tidak ada soal draft tambahan yang diperlukan untuk zona yang kurang saat ini.
              </div>
            ) : (
              <div className="space-y-2">
                {visibleDrafts.map(d => {
                  const isSaved = savedIds.has(d.id);
                  const isChecked = selectedIds.has(d.id);
                  return (
                    <div
                      key={d.id}
                      className={`p-3 rounded-2xl border transition-colors ${
                        isSaved
                          ? 'bg-emerald-50/70 border-emerald-200'
                          : isChecked
                            ? 'bg-indigo-50/40 border-indigo-200'
                            : 'bg-white border-slate-200'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <label className="flex items-start gap-2.5 cursor-pointer min-w-0 flex-1">
                          <input
                            type="checkbox"
                            disabled={isSaved || isActivating}
                            checked={isChecked || isSaved}
                            onChange={() => toggleSelect(d.id)}
                            className="mt-0.5 rounded border-slate-300 text-indigo-600"
                          />
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-800 font-bold text-[10px]">
                                DRAFT EXISTING
                              </span>
                              <span className="font-extrabold text-slate-900">
                                Juz {d.juzNumber} • {d.surahLabel}
                              </span>
                              <span className="text-[11px] text-slate-600">
                                (Hal. {d.actualStartPage}{d.actualEndPage !== d.actualStartPage ? `–${d.actualEndPage}` : ''})
                              </span>
                              <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px]">
                                Membantu {d.helpedSessionKeys.length} sesi ({d.helpedStudentIds.length} santri)
                              </span>
                              {isSaved && (
                                <span className="px-2 py-0.5 rounded-full bg-emerald-600 text-white font-bold text-[10px]">
                                  Aktif ✓
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              Menutup: {d.zoneLabels.join(', ')}
                            </div>
                            {(d.question.promptText || d.question.answerText) && (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                                <div className="p-2 rounded-xl bg-white border border-slate-200">
                                  <div className="text-[10px] font-bold text-slate-400 mb-0.5">Pertanyaan (Prompt)</div>
                                  <div dir="rtl" className="font-arabic text-base leading-loose text-slate-900">
                                    {d.question.promptText || '-'}
                                  </div>
                                </div>
                                <div className="p-2 rounded-xl bg-white border border-slate-200">
                                  <div className="text-[10px] font-bold text-slate-400 mb-0.5">Jawaban (Sambungan)</div>
                                  <div dir="rtl" className="font-arabic text-base leading-loose text-emerald-900">
                                    {d.question.answerText || '-'}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </label>
                        {!isSaved && !isActivating && (
                          <button
                            type="button"
                            onClick={() => rejectItem(d.id)}
                            title="Tolak kandidat ini"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 shrink-0"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* BAGIAN 2: KANDIDAT SOAL BARU OTOMATIS */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-extrabold text-sm text-teal-950 flex items-center gap-1.5">
                <BookOpen size={16} className="text-teal-600" />
                <span>Bagian 2 — Kandidat Soal Baru Otomatis dari Teks Mushaf Resmi ({visibleAuto.length})</span>
              </div>
              {!loadingTexts && notReadyAutoCount > 0 && (
                <button
                  type="button"
                  onClick={runPlanAndLoad}
                  className="px-2.5 py-1 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold text-[11px] inline-flex items-center gap-1"
                >
                  <RefreshCw size={12} /> Muat Ulang Teks Mushaf
                </button>
              )}
            </div>

            {loadingTexts ? (
              <div className="p-6 rounded-2xl border border-teal-200 bg-teal-50/50 flex flex-col items-center justify-center gap-2 text-teal-900">
                <Loader2 size={22} className="animate-spin text-teal-700" />
                <div className="font-bold">
                  Mengambil teks Utsmani resmi dari Mushaf ({loadProgress.loaded}/{loadProgress.total} halaman)...
                </div>
                <div className="text-[11px] text-teal-700">
                  Tidak ada ayat yang dikarang; sistem hanya menyusun kandidat dari kata/ayat terverifikasi.
                </div>
              </div>
            ) : visibleAuto.length === 0 ? (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 font-semibold">
                Tidak ada kandidat soal baru yang perlu dibuat.
              </div>
            ) : (
              <div className="space-y-2">
                {visibleAuto.map(c => {
                  const isSaved = savedIds.has(c.id);
                  const isChecked = selectedIds.has(c.id);
                  const isReady = c.readiness === 'ready' && Boolean(c.question);
                  return (
                    <div
                      key={c.id}
                      className={`p-3 rounded-2xl border transition-colors ${
                        !isReady
                          ? 'bg-amber-50/70 border-amber-300'
                          : isSaved
                            ? 'bg-emerald-50/70 border-emerald-200'
                            : isChecked
                              ? 'bg-teal-50/35 border-teal-200'
                              : 'bg-white border-slate-200'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <label className={`flex items-start gap-2.5 min-w-0 flex-1 ${isReady ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
                          <input
                            type="checkbox"
                            disabled={!isReady || isSaved || isActivating}
                            checked={isReady && (isChecked || isSaved)}
                            onChange={() => isReady && toggleSelect(c.id)}
                            className="mt-0.5 rounded border-slate-300 text-teal-600 disabled:opacity-40"
                          />
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                className={`px-2 py-0.5 rounded-md font-bold text-[10px] ${
                                  isReady ? 'bg-teal-100 text-teal-800' : 'bg-amber-200 text-amber-950'
                                }`}
                              >
                                {isReady ? 'BARU OTOMATIS' : 'BELUM SIAP'}
                              </span>
                              <span className="font-extrabold text-slate-900">
                                Juz {c.juzNumber} • {c.surahLabel}
                              </span>
                              <span className="text-[11px] text-slate-600">(Hal. {c.pageNumber})</span>
                              <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px]">
                                Membantu {c.helpedSessionKeys.length} sesi ({c.helpedStudentIds.length} santri)
                              </span>
                              {isSaved && (
                                <span className="px-2 py-0.5 rounded-full bg-emerald-600 text-white font-bold text-[10px]">
                                  Tersimpan &amp; Aktif ✓
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              Menutup: {c.zoneLabels.join(', ')}
                            </div>

                            {!isReady && c.notReadyReason && (
                              <div className="p-2 rounded-xl bg-amber-100/70 border border-amber-300 text-amber-950 font-semibold flex items-center gap-1.5 text-[11px]">
                                <AlertTriangle size={13} className="shrink-0" />
                                <span>{c.notReadyReason}</span>
                              </div>
                            )}

                            {isReady && c.question && (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                                <div className="p-2 rounded-xl bg-white border border-slate-200">
                                  <div className="text-[10px] font-bold text-slate-400 mb-0.5">
                                    Pertanyaan ({c.question.promptStart.surahNumber}:{c.question.promptStart.ayahNumber} kata {c.question.promptStart.wordPosition}–{c.question.promptEnd.wordPosition})
                                  </div>
                                  <div dir="rtl" className="font-arabic text-base leading-loose text-slate-900">
                                    {c.question.promptText}
                                  </div>
                                </div>
                                <div className="p-2 rounded-xl bg-white border border-slate-200">
                                  <div className="text-[10px] font-bold text-slate-400 mb-0.5">
                                    Jawaban ({c.question.answerStart.surahNumber}:{c.question.answerStart.ayahNumber} s.d. {c.question.answerEnd.surahNumber}:{c.question.answerEnd.ayahNumber})
                                  </div>
                                  <div dir="rtl" className="font-arabic text-base leading-loose text-emerald-900">
                                    {c.question.answerText}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </label>
                        {!isSaved && !isActivating && (
                          <button
                            type="button"
                            onClick={() => rejectItem(c.id)}
                            title="Tolak kandidat ini"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 shrink-0"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={loadingTexts || isActivating}
              onClick={selectAllValid}
              className="px-3 py-2 rounded-xl bg-white border border-slate-300 text-slate-700 font-bold hover:bg-slate-100 disabled:opacity-40"
            >
              Pilih Semua Valid ({readyDraftsCount + readyAutoCount})
            </button>
            <button
              type="button"
              disabled={loadingTexts || isActivating}
              onClick={clearSelection}
              className="px-3 py-2 rounded-xl bg-white border border-slate-300 text-slate-600 font-bold hover:bg-slate-100 disabled:opacity-40"
            >
              Batal Pilih
            </button>
          </div>

          <div className="flex items-center gap-2">
            {activationSummary && activationSummary.savedCount > 0 && selectedReadyItems.length === 0 ? (
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold inline-flex items-center gap-1.5"
              >
                <CheckCircle2 size={15} />
                <span>Tutup &amp; Lanjut Generate Paket Massal</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={isActivating}
                  onClick={onClose}
                  className="px-3.5 py-2.5 rounded-xl bg-white border border-slate-300 text-slate-700 font-bold disabled:opacity-40"
                >
                  Tutup
                </button>
                <button
                  type="button"
                  disabled={!isAdmin || loadingTexts || isActivating || selectedReadyItems.length === 0}
                  onClick={handleBatchActivate}
                  className="px-4 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-extrabold inline-flex items-center gap-2 disabled:opacity-40"
                >
                  {isActivating ? (
                    <>
                      <Loader2 size={15} className="animate-spin" />
                      <span>Mengaktifkan ({saveProgress.done}/{saveProgress.total})...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={15} />
                      <span>Setujui &amp; Aktifkan {selectedReadyItems.length} Soal Terpilih</span>
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
