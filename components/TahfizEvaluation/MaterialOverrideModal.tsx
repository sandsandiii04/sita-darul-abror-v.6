import React, { useState } from 'react';
import { ExamMaterialSnapshot, Student, User } from '../../types';
import { SURAH_LIST } from '../../constants';
import { quranService, SURAH_TOTAL_AYAHS } from '../../services/quranService';
import { materialDetectionService } from '../../services/materialDetectionService';
import { X, Edit3, AlertCircle, Save, CheckCircle } from 'lucide-react';

interface MaterialOverrideModalProps {
  user: User;
  student: Student;
  snapshot: ExamMaterialSnapshot;
  onClose: () => void;
  onSaved: (updatedData: Partial<ExamMaterialSnapshot>, reason: string) => void;
}

export const MaterialOverrideModal: React.FC<MaterialOverrideModalProps> = ({
  user,
  student,
  snapshot,
  onClose,
  onSaved
}) => {
  const [startSurah, setStartSurah] = useState<number>(snapshot.startSurah || 1);
  const [startAyah, setStartAyah] = useState<number>(snapshot.startAyah || 1);
  const [endSurah, setEndSurah] = useState<number>(snapshot.endSurah || 1);
  const [endAyah, setEndAyah] = useState<number>(snapshot.endAyah || 1);
  const [reason, setReason] = useState<string>(snapshot.overrideReason || '');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const startSurahMaxAyah = SURAH_TOTAL_AYAHS[startSurah] || 286;
  const endSurahMaxAyah = SURAH_TOTAL_AYAHS[endSurah] || 286;

  // Recalculate pages
  const startSurahInfo = quranService.getSurah(startSurah);
  const endSurahInfo = quranService.getSurah(endSurah);
  const startPage = startSurahInfo?.startPage || 1;
  const endPage = endSurahInfo?.startPage || 1;
  const startJuz = quranService.getPageJuz(startPage);
  const endJuz = quranService.getPageJuz(endPage);
  const estimatedPages = Math.max(1, Math.abs(endPage - startPage) + 1);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (startAyah < 1 || startAyah > startSurahMaxAyah) {
      setErrorMessage(`Ayat awal tidak valid (Maksimal ${startSurahMaxAyah} ayat untuk ${SURAH_LIST[startSurah - 1]}).`);
      return;
    }

    if (endAyah < 1 || endAyah > endSurahMaxAyah) {
      setErrorMessage(`Ayat akhir tidak valid (Maksimal ${endSurahMaxAyah} ayat untuk ${SURAH_LIST[endSurah - 1]}).`);
      return;
    }

    setErrorMessage(null);

    const updatedData: Partial<ExamMaterialSnapshot> = {
      sourceType: 'manual_override',
      startSurah,
      startAyah,
      endSurah,
      endAyah,
      startPage,
      endPage,
      startJuz,
      endJuz,
      estimatedPages,
      startSurahName: SURAH_LIST[startSurah - 1],
      endSurahName: SURAH_LIST[endSurah - 1],
      overrideReason: reason.trim() || 'Koreksi manual',
      status: 'ready'
    };

    onSaved(updatedData, reason.trim() || 'Koreksi manual');
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full overflow-hidden border border-slate-100 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-600 to-amber-700 px-6 py-4 flex items-center justify-between text-white">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-white/10 rounded-xl">
              <Edit3 size={20} className="text-amber-100" />
            </div>
            <div>
              <h3 className="font-bold text-base">Koreksi Materi Ujian Manual</h3>
              <p className="text-xs text-amber-100">
                {student.name} &bull; Kelas {student.class} &bull; {student.halaqah}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-amber-100 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="p-3 bg-amber-50/70 border border-amber-200/80 rounded-xl text-xs text-amber-900 leading-relaxed">
            <strong>Perhatian:</strong> Koreksi manual ini <em>tidak akan mengubah data setoran aktual</em> di tabel riwayat, melainkan hanya menyesuaikan snapshot materi evaluasi santri bersangkutan untuk periode ujian ini.
          </div>

          {/* Start Surah & Ayah */}
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/80 space-y-3">
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Batas Awal Materi
            </h4>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Surat Awal
                </label>
                <select
                  value={startSurah}
                  onChange={(e) => {
                    const s = Number(e.target.value);
                    setStartSurah(s);
                    setStartAyah(1);
                  }}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none bg-white font-semibold"
                >
                  {SURAH_LIST.map((name, idx) => (
                    <option key={idx + 1} value={idx + 1}>
                      {idx + 1}. {name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Ayat Awal
                </label>
                <input
                  type="number"
                  min="1"
                  max={startSurahMaxAyah}
                  value={startAyah}
                  onChange={(e) => setStartAyah(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none font-bold"
                  required
                />
              </div>
            </div>
          </div>

          {/* End Surah & Ayah */}
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/80 space-y-3">
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Batas Akhir Materi
            </h4>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Surat Akhir
                </label>
                <select
                  value={endSurah}
                  onChange={(e) => {
                    const s = Number(e.target.value);
                    setEndSurah(s);
                    const max = SURAH_TOTAL_AYAHS[s] || 1;
                    setEndAyah(max);
                  }}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none bg-white font-semibold"
                >
                  {SURAH_LIST.map((name, idx) => (
                    <option key={idx + 1} value={idx + 1}>
                      {idx + 1}. {name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Ayat Akhir
                </label>
                <input
                  type="number"
                  min="1"
                  max={endSurahMaxAyah}
                  value={endAyah}
                  onChange={(e) => setEndAyah(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none font-bold"
                  required
                />
              </div>
            </div>
          </div>

          {/* Computed pages preview */}
          <div className="px-4 py-2.5 bg-emerald-50 rounded-xl border border-emerald-200/80 flex items-center justify-between text-xs text-emerald-900">
            <span>Estimasi Cakupan: <strong>Halaman {startPage} s/d {endPage}</strong> (Juz {startJuz} - {endJuz})</span>
            <span className="font-bold px-2 py-0.5 bg-emerald-200/60 rounded-lg">{estimatedPages} Halaman</span>
          </div>

          {/* Reason Input (Optional) */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Alasan Koreksi Manual <span className="text-slate-400 font-normal text-[11px]">(Opsional)</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Contoh: Santri izin sakit 2 pekan, materi disesuaikan dengan capaian halaqah terakhir."
              rows={3}
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
            />
          </div>

          {/* Footer Actions */}
          <div className="pt-3 flex items-center justify-end gap-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
            >
              Batal
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 active:bg-amber-800 rounded-xl shadow-md shadow-amber-600/20 transition-all flex items-center gap-2"
            >
              <Save size={15} />
              <span>Simpan Koreksi Manual</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
