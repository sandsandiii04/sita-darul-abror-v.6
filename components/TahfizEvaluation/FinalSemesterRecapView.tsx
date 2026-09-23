// components/TahfizEvaluation/FinalSemesterRecapView.tsx
// Modul TAHAP 7D: REKAP FINAL, MONITORING & EXPORT
// SITA — Darul Abror Islamic Boarding School

import React, { useState, useEffect, useMemo } from 'react';
import { 
  User, 
  AcademicTerm, 
  FinalSemesterRecapItem, 
  FinalSemesterMonitoringStats,
  FinalSemesterRecapResponse 
} from '../../types';
import { api } from '../../api';
import { 
  Award, 
  BookOpen, 
  Calendar, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  Search, 
  Filter, 
  SlidersHorizontal, 
  X, 
  AlertTriangle,
  RotateCcw,
  RefreshCw,
  Layers,
  ChevronDown,
  Eye,
  ShieldCheck,
  FileSpreadsheet,
  Download,
  Info,
  Users
} from 'lucide-react';
import { 
  generateFinalRecapCSV, 
  generateFinalRecapSpreadsheetXML, 
  downloadExportFile 
} from '../../services/finalRecapExportService';
import { StudentEvaluationDetailModal } from './StudentEvaluationDetailModal';

interface FinalSemesterRecapViewProps {
  user: User;
}

type StatusFilterOption = 
  | 'ALL' 
  | 'TUNTAS' 
  | 'TUNTAS_VIA_REMEDIAL' 
  | 'PERLU_REMEDIAL' 
  | 'SEDANG_REMEDIAL' 
  | 'BELUM_TUNTAS_SETELAH_REMEDIAL' 
  | 'BELUM_LENGKAP';

export const FinalSemesterRecapView: React.FC<FinalSemesterRecapViewProps> = ({ user }) => {
  const [academicTerms, setAcademicTerms] = useState<AcademicTerm[]>([]);
  const [selectedTermId, setSelectedTermId] = useState<string>('');
  
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Recap & Monitoring state
  const [recapData, setRecapData] = useState<FinalSemesterRecapResponse | null>(null);

  // Filters & Search
  const [selectedClass, setSelectedClass] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<StatusFilterOption>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Student Detail Modal state
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [selectedStudentName, setSelectedStudentName] = useState<string | undefined>();

  // Export dropdown / state
  const [isExporting, setIsExporting] = useState<boolean>(false);

  // Load initial terms
  useEffect(() => {
    loadAcademicTerms();
  }, []);

  // Reload recap whenever term changes
  useEffect(() => {
    if (selectedTermId) {
      loadFinalRecap();
    }
  }, [selectedTermId, selectedClass, selectedStatus]);

  const loadAcademicTerms = async () => {
    setIsLoading(true);
    try {
      const res = await api.getAcademicTerms(user);
      const terms = res.data || [];
      if (terms.length > 0) {
        setAcademicTerms(terms);
        const active = terms.find(t => t.status === 'active') || terms[0];
        setSelectedTermId(active ? active.id : '');
      } else {
        setAcademicTerms([]);
        setErrorMessage('Belum ada data semester akademik.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Gagal memuat daftar semester.');
    } finally {
      setIsLoading(false);
    }
  };

  const loadFinalRecap = async (refresh = false) => {
    if (refresh) setIsRefreshing(true);
    else setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await api.getSemesterFinalRecap({
        academicTermId: selectedTermId,
        class: selectedClass !== 'ALL' ? selectedClass : undefined,
        status: selectedStatus !== 'ALL' ? selectedStatus : undefined,
        search: searchQuery.trim() || undefined
      }, user);

      if (res.success) {
        setRecapData(res);
      } else {
        setRecapData(null);
        setErrorMessage(res.message || 'Gagal memuat rekap evaluasi final semester.');
      }
    } catch (err: any) {
      setRecapData(null);
      setErrorMessage(err.message || 'Terjadi kesalahan sistem saat memuat rekap final.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  // Client-side instant search filter over the loaded set
  const filteredRecap = useMemo(() => {
    if (!recapData?.recap) return [];
    if (!searchQuery.trim()) return recapData.recap;
    const q = searchQuery.toLowerCase().trim();
    return recapData.recap.filter(item => 
      item.studentName.toLowerCase().includes(q) || 
      item.nis.toLowerCase().includes(q)
    );
  }, [recapData?.recap, searchQuery]);

  // Unique classes list from loaded data
  const availableClasses = useMemo(() => {
    const set = new Set<string>();
    if (recapData?.recap) {
      recapData.recap.forEach(r => {
        if (r.class) set.add(r.class);
      });
    }
    return Array.from(set).sort();
  }, [recapData?.recap]);

  // Export handlers
  const handleExportCSV = () => {
    if (!filteredRecap || filteredRecap.length === 0) {
      alert('Tidak ada data yang dapat diekspor.');
      return;
    }
    setIsExporting(true);
    try {
      const csv = generateFinalRecapCSV(filteredRecap, recapData?.summary, recapData?.config);
      const filename = `Rekap_Final_Tahfiz_${recapData?.config?.academicYear || 'Semester'}_${Date.now()}.csv`;
      downloadExportFile(csv, filename, 'text/csv;charset=utf-8;');
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportExcel = () => {
    if (!filteredRecap || filteredRecap.length === 0) {
      alert('Tidak ada data yang dapat diekspor.');
      return;
    }
    setIsExporting(true);
    try {
      const xml = generateFinalRecapSpreadsheetXML(filteredRecap, recapData?.summary, recapData?.config);
      const filename = `Rekap_Final_Tahfiz_${recapData?.config?.academicYear || 'Semester'}_${Date.now()}.xls`;
      downloadExportFile(xml, filename, 'application/vnd.ms-excel;charset=utf-8;');
    } finally {
      setIsExporting(false);
    }
  };

  const getStatusBadge = (status?: string, hasRemedial?: boolean) => {
    switch (status) {
      case 'TUNTAS':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {hasRemedial ? 'Tuntas (via Remedial)' : 'Tuntas'}
          </span>
        );
      case 'PERLU_REMEDIAL':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">
            <AlertTriangle className="w-3.5 h-3.5" />
            Perlu Remedial
          </span>
        );
      case 'SEDANG_REMEDIAL':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-300">
            <Clock className="w-3.5 h-3.5" />
            Sedang Remedial
          </span>
        );
      case 'BELUM_TUNTAS_SETELAH_REMEDIAL':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-300">
            <AlertTriangle className="w-3.5 h-3.5" />
            Belum Tuntas (Remedial)
          </span>
        );
      case 'BELUM_LENGKAP':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-700 border border-gray-300">
            <Info className="w-3.5 h-3.5" />
            Belum Lengkap
          </span>
        );
    }
  };

  const summary = recapData?.summary;
  const config = recapData?.config;

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      
      {/* Header Halaman */}
      <div className="bg-gradient-to-r from-teal-800 via-teal-900 to-emerald-900 text-white rounded-2xl p-6 sm:p-8 shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 translate-x-8 -translate-y-8 w-64 h-64 bg-white/5 rounded-full blur-2xl pointer-events-none" />
        
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-500/20 text-teal-200 text-xs font-semibold border border-teal-400/30">
              <ShieldCheck className="w-3.5 h-3.5" />
              Rekapitulasi Final & Monitoring
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Rekap Nilai Tahfiz Semester
            </h1>
            <p className="text-sm text-teal-100 max-w-2xl leading-relaxed">
              Pusat monitoring otoritatif evaluasi semester tahfiz Al-Qur'an. Menyatukan nilai asli UTS & UAS, riwayat remedial, nilai efektif, dan status kelulusan akhir secara terpadu.
            </p>
          </div>

          {/* Action Buttons: Export */}
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              onClick={handleExportCSV}
              disabled={isExporting || isLoading || filteredRecap.length === 0}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold border border-white/20 backdrop-blur-md shadow-sm transition-all disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              Ekspor CSV
            </button>
            <button
              onClick={handleExportExcel}
              disabled={isExporting || isLoading || filteredRecap.length === 0}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md hover:shadow-lg transition-all disabled:opacity-50"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Ekspor Excel (XLS)
            </button>
            <button
              onClick={() => loadFinalRecap(true)}
              disabled={isRefreshing || isLoading}
              className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/20 transition-all disabled:opacity-50"
              title="Muat Ulang Data"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Filter & Controls Bar */}
      <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          
          {/* Semester Akademik */}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5">
              Semester Akademik
            </label>
            <select
              value={selectedTermId}
              onChange={e => setSelectedTermId(e.target.value)}
              className="w-full text-xs rounded-xl border-gray-300 shadow-sm focus:border-teal-500 focus:ring-teal-500 p-2.5 bg-gray-50 font-medium"
            >
              {academicTerms.map(t => (
                <option key={t.id} value={t.id}>
                  {t.academicYear} — Semester {t.semester === 'ganjil' ? 'Ganjil' : 'Genap'} {t.status === 'active' ? '(Aktif)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Filter Kelas */}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5">
              Filter Kelas
            </label>
            <select
              value={selectedClass}
              onChange={e => setSelectedClass(e.target.value)}
              className="w-full text-xs rounded-xl border-gray-300 shadow-sm focus:border-teal-500 focus:ring-teal-500 p-2.5 bg-gray-50 font-medium"
            >
              <option value="ALL">Semua Kelas</option>
              {availableClasses.map(c => (
                <option key={c} value={c}>Kelas {c}</option>
              ))}
            </select>
          </div>

          {/* Filter Status Kelulusan */}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5">
              Status Kelulusan
            </label>
            <select
              value={selectedStatus}
              onChange={e => setSelectedStatus(e.target.value as StatusFilterOption)}
              className="w-full text-xs rounded-xl border-gray-300 shadow-sm focus:border-teal-500 focus:ring-teal-500 p-2.5 bg-gray-50 font-medium"
            >
              <option value="ALL">Semua Status</option>
              <option value="TUNTAS">Tuntas (Semua)</option>
              <option value="TUNTAS_VIA_REMEDIAL">Tuntas via Remedial</option>
              <option value="PERLU_REMEDIAL">Perlu Remedial</option>
              <option value="SEDANG_REMEDIAL">Sedang Remedial</option>
              <option value="BELUM_TUNTAS_SETELAH_REMEDIAL">Belum Tuntas Setelah Remedial</option>
              <option value="BELUM_LENGKAP">Belum Lengkap</option>
            </select>
          </div>

          {/* Search Santri */}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5">
              Cari Santri
            </label>
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Nama santri atau NIS..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full text-xs rounded-xl border-gray-300 pl-9 pr-3 py-2.5 bg-gray-50 shadow-sm focus:border-teal-500 focus:ring-teal-500"
              />
            </div>
          </div>

        </div>

        {/* Informasi Pasangan Periode & Bobot */}
        {config && (
          <div className="pt-3 border-t border-gray-100 flex flex-wrap items-center justify-between text-xs text-gray-600 gap-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-teal-900">Konfigurasi:</span>
              <span>{config.name || 'Standar Semester'}</span>
              <span className="text-gray-300">|</span>
              <span>UTS: <strong>{config.utsPeriodName}</strong> (KKM {config.utsKkm})</span>
              <span className="text-gray-300">|</span>
              <span>UAS: <strong>{config.uasPeriodName}</strong> (KKM {config.uasKkm})</span>
            </div>
            <div className="bg-teal-50 px-3 py-1 rounded-lg text-teal-800 font-bold border border-teal-100">
              Bobot Otoritatif: UTS {config.utsWeight}% | UAS {config.uasWeight}%
            </div>
          </div>
        )}
      </div>

      {/* Monitoring Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
            <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Total Santri</div>
            <div className="text-2xl font-extrabold text-gray-900 mt-1">{summary.totalStudents}</div>
            <div className="text-[10px] text-gray-400 mt-0.5">Peserta evaluasi</div>
          </div>

          <div className="bg-emerald-50/70 p-4 rounded-xl border border-emerald-200 shadow-sm">
            <div className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Tuntas
            </div>
            <div className="text-2xl font-extrabold text-emerald-900 mt-1">{summary.tuntasCount}</div>
            <div className="text-[10px] text-emerald-700 mt-0.5">KKM terpenuhi</div>
          </div>

          <div className="bg-teal-50/70 p-4 rounded-xl border border-teal-200 shadow-sm">
            <div className="text-[11px] font-bold text-teal-800 uppercase tracking-wider flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Via Remedial
            </div>
            <div className="text-2xl font-extrabold text-teal-900 mt-1">{summary.tuntasViaRemedialCount}</div>
            <div className="text-[10px] text-teal-700 mt-0.5">Tuntas lewat perbaikan</div>
          </div>

          <div className="bg-amber-50/70 p-4 rounded-xl border border-amber-200 shadow-sm">
            <div className="text-[11px] font-bold text-amber-800 uppercase tracking-wider flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Perlu Remedial
            </div>
            <div className="text-2xl font-extrabold text-amber-900 mt-1">{summary.perluRemedialCount}</div>
            <div className="text-[10px] text-amber-700 mt-0.5">Belum dijadwalkan</div>
          </div>

          <div className="bg-blue-50/70 p-4 rounded-xl border border-blue-200 shadow-sm">
            <div className="text-[11px] font-bold text-blue-800 uppercase tracking-wider flex items-center gap-1">
              <Clock className="w-3 h-3" /> Sedang Remedial
            </div>
            <div className="text-2xl font-extrabold text-blue-900 mt-1">{summary.sedangRemedialCount}</div>
            <div className="text-[10px] text-blue-700 mt-0.5">Dalam pelaksanaan</div>
          </div>

          <div className="bg-rose-50/70 p-4 rounded-xl border border-rose-200 shadow-sm">
            <div className="text-[11px] font-bold text-rose-800 uppercase tracking-wider flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Belum Tuntas
            </div>
            <div className="text-2xl font-extrabold text-rose-900 mt-1">{summary.belumTuntasSetelahRemedialCount}</div>
            <div className="text-[10px] text-rose-700 mt-0.5">Setelah remedial</div>
          </div>

          <div className="bg-gray-100/70 p-4 rounded-xl border border-gray-300 shadow-sm">
            <div className="text-[11px] font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1">
              <Info className="w-3 h-3" /> Belum Lengkap
            </div>
            <div className="text-2xl font-extrabold text-gray-900 mt-1">{summary.belumLengkapCount}</div>
            <div className="text-[10px] text-gray-500 mt-0.5">Belum selesai UTS/UAS</div>
          </div>
        </div>
      )}

      {/* Main Table Container */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="py-24 text-center space-y-3">
            <RefreshCw className="w-10 h-10 text-teal-600 animate-spin mx-auto" />
            <p className="text-sm font-semibold text-gray-600">Memuat rekapitulasi nilai final semester...</p>
          </div>
        ) : errorMessage ? (
          <div className="p-8 text-center space-y-3">
            <div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-gray-900">Gagal Memuat Data</h3>
            <p className="text-xs text-rose-600 max-w-md mx-auto">{errorMessage}</p>
            <button
              onClick={() => loadFinalRecap()}
              className="mt-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-semibold"
            >
              Coba Lagi
            </button>
          </div>
        ) : filteredRecap.length === 0 ? (
          <div className="py-20 text-center space-y-2">
            <Users className="w-10 h-10 text-gray-300 mx-auto" />
            <h3 className="text-sm font-bold text-gray-700">Tidak Ada Data Santri</h3>
            <p className="text-xs text-gray-400">Tidak ada data evaluasi yang sesuai dengan filter yang dipilih.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-gray-700">
              <thead className="bg-gradient-to-r from-teal-800 to-emerald-900 text-white font-bold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="p-3.5 text-center w-10">No</th>
                  <th className="p-3.5">NIS</th>
                  <th className="p-3.5">Nama Santri</th>
                  <th className="p-3.5 text-center">Kelas</th>
                  <th className="p-3.5 text-center bg-teal-950/40">UTS Asli</th>
                  <th className="p-3.5 text-center bg-teal-950/40">UTS Rem</th>
                  <th className="p-3.5 text-center bg-teal-950/60">UTS Efektif</th>
                  <th className="p-3.5 text-center bg-emerald-950/40">UAS Asli</th>
                  <th className="p-3.5 text-center bg-emerald-950/40">UAS Rem</th>
                  <th className="p-3.5 text-center bg-emerald-950/60">UAS Efektif</th>
                  <th className="p-3.5 text-center bg-teal-900/80 font-extrabold text-amber-200">Nilai Semester</th>
                  <th className="p-3.5 text-center">Status Kelulusan</th>
                  <th className="p-3.5 text-center w-24">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredRecap.map((item, idx) => (
                  <tr 
                    key={item.studentId}
                    className="hover:bg-teal-50/40 transition-colors"
                  >
                    <td className="p-3.5 text-center font-medium text-gray-500">{idx + 1}</td>
                    <td className="p-3.5 font-mono text-gray-600">{item.nis}</td>
                    <td className="p-3.5 font-semibold text-gray-900">{item.studentName}</td>
                    <td className="p-3.5 text-center">
                      <span className="px-2 py-0.5 bg-gray-100 text-gray-800 rounded font-medium text-[11px]">
                        {item.class}
                      </span>
                    </td>
                    
                    {/* UTS columns */}
                    <td className="p-3.5 text-center bg-teal-50/30 font-medium">
                      {item.utsOriginalScore !== null ? Number(item.utsOriginalScore).toFixed(2) : '-'}
                    </td>
                    <td className="p-3.5 text-center bg-teal-50/30 font-semibold text-teal-700">
                      {item.utsRemedialScore !== null ? Number(item.utsRemedialScore).toFixed(2) : '-'}
                    </td>
                    <td className="p-3.5 text-center bg-teal-50/60 font-bold text-teal-900">
                      {item.utsEffectiveScore !== null ? Number(item.utsEffectiveScore).toFixed(2) : '-'}
                    </td>

                    {/* UAS columns */}
                    <td className="p-3.5 text-center bg-emerald-50/30 font-medium">
                      {item.uasOriginalScore !== null ? Number(item.uasOriginalScore).toFixed(2) : '-'}
                    </td>
                    <td className="p-3.5 text-center bg-emerald-50/30 font-semibold text-emerald-700">
                      {item.uasRemedialScore !== null ? Number(item.uasRemedialScore).toFixed(2) : '-'}
                    </td>
                    <td className="p-3.5 text-center bg-emerald-50/60 font-bold text-emerald-900">
                      {item.uasEffectiveScore !== null ? Number(item.uasEffectiveScore).toFixed(2) : '-'}
                    </td>

                    {/* Nilai Akhir Semester */}
                    <td className="p-3.5 text-center font-extrabold text-sm bg-teal-50 text-teal-950">
                      {item.semesterFinalScore !== null ? Number(item.semesterFinalScore).toFixed(2) : '-'}
                    </td>

                    {/* Status Kelulusan */}
                    <td className="p-3.5 text-center whitespace-nowrap">
                      {getStatusBadge(item.semesterStatus, item.hasRemedial)}
                    </td>

                    {/* Aksi Detail */}
                    <td className="p-3.5 text-center">
                      <button
                        onClick={() => {
                          setSelectedStudentId(item.studentId);
                          setSelectedStudentName(item.studentName);
                        }}
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-teal-50 hover:bg-teal-100 text-teal-700 rounded-lg text-xs font-semibold border border-teal-200 transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Detail
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Detail Santri */}
      {selectedStudentId && (
        <StudentEvaluationDetailModal
          studentId={selectedStudentId}
          studentName={selectedStudentName}
          academicTermId={selectedTermId}
          configId={config?.id}
          user={user}
          onClose={() => {
            setSelectedStudentId(null);
            setSelectedStudentName(undefined);
          }}
        />
      )}

    </div>
  );
};
