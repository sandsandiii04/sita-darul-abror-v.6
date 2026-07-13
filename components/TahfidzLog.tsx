
import React, { useState, useEffect } from 'react';
import { User, Student, TahfidzRecord, Grade } from '../types';
import { SURAH_LIST, QURAN_CHAPTERS } from '../constants';
import { PlusCircle, Search, Filter, Trash2, X, Calendar, BookOpen, Layers, RotateCcw } from 'lucide-react';

interface TahfidzLogProps {
  user: User;
  students: Student[];
  records: TahfidzRecord[];
  onAddRecord: (record: TahfidzRecord) => void;
  onDeleteRecord: (id: string) => void;
  defaultTab?: 'sabaq' | 'sabqi' | 'manzil';
  allowedTabs?: ('sabaq' | 'sabqi' | 'manzil')[];
}

const TahfidzLog: React.FC<TahfidzLogProps> = ({ 
  user, 
  students, 
  records, 
  onAddRecord, 
  onDeleteRecord,
  defaultTab = 'sabaq',
  allowedTabs = ['sabaq', 'sabqi', 'manzil']
}) => {
  const [activeTab, setActiveTab] = useState<'sabaq' | 'sabqi' | 'manzil'>(defaultTab);

  useEffect(() => {
    setActiveTab(defaultTab);
  }, [defaultTab]);

  useEffect(() => {
    if (activeTab === 'manzil') {
      setSelectedSurah('Juz 1');
    } else {
      setSelectedSurah(SURAH_LIST[0]);
    }
  }, [activeTab]);

  const [searchTerm, setSearchTerm] = useState('');
  
  // Advanced Filters State
  const [showFilters, setShowFilters] = useState(false);
  const [filterDateStart, setFilterDateStart] = useState('');
  const [filterDateEnd, setFilterDateEnd] = useState('');
  const [filterClass, setFilterClass] = useState('');
  const [filterJuz, setFilterJuz] = useState('');
  const [filterSurah, setFilterSurah] = useState('');

  // Form State
  const [selectedStudent, setSelectedStudent] = useState('');
  const [selectedSurah, setSelectedSurah] = useState(SURAH_LIST[0]);
  const [ayahStart, setAyahStart] = useState(1);
  const [ayahEnd, setAyahEnd] = useState(1);
  const [grade, setGrade] = useState<string>('100');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [pagesCount, setPagesCount] = useState<string>('1');

  // PERMISSIONS
  const canAdd = user.role === 'teacher';
  const canDelete = user.role === 'teacher' || user.role === 'admin';

  // Derived Data for Filters
  const distinctClasses = Array.from(new Set(students.map(s => s.class))).sort();
  const availableStudents = user.role === 'teacher' 
    ? students.filter(s => s.teacherId === user.id)
    : user.role === 'parent' && user.childId
      ? students.filter(s => s.id === user.childId)
      : students;

  // Helper: Estimate Juz from Surah
  const getJuzFromSurahName = (surahName: string): number => {
    const chapter = QURAN_CHAPTERS.find(c => c[1] === surahName);
    if (!chapter) return 0;
    // Simple estimation: 1 Juz approx 20 pages. 
    const juz = Math.ceil(chapter[2] / 20);
    return juz > 30 ? 30 : juz;
  };

  const filteredRecords = records
    .filter(r => {
      if (activeTab === 'sabaq') return r.type === 'sabaq' || r.type === 'ziyadah';
      if (activeTab === 'sabqi') return r.type === 'sabqi';
      if (activeTab === 'manzil') return r.type === 'manzil' || r.type === 'murojaah';
      return false;
    })
    // 1. Role Based Filtering
    .filter(r => {
        if(user.role === 'parent' && user.childId) return r.studentId === user.childId;
        if(user.role === 'teacher') return students.find(s => s.id === r.studentId)?.teacherId === user.id;
        return true;
    })
    // 2. Text Search (Student Name)
    .filter(r => {
        const student = students.find(s => s.id === r.studentId);
        return student?.name.toLowerCase().includes(searchTerm.toLowerCase());
    })
    // 3. Advanced Filters
    .filter(r => {
        const rDate = new Date(r.date);
        const sDate = filterDateStart ? new Date(filterDateStart) : null;
        const eDate = filterDateEnd ? new Date(filterDateEnd) : null;
        const student = students.find(s => s.id === r.studentId);
        
        // Handle Juz estimation for standard records, and direct parsing for Manzil records
        const recordJuz = r.surah.startsWith('Juz ')
          ? (parseInt(r.surah.replace('Juz ', '')) || 0)
          : getJuzFromSurahName(r.surah);

        if (filterClass && student?.class !== filterClass) return false;
        if (filterSurah && r.surah !== filterSurah) return false;
        if (filterJuz && recordJuz !== parseInt(filterJuz)) return false;
        if (sDate && rDate < sDate) return false;
        if (eDate && rDate > eDate) return false;

        return true;
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStudent && user.role !== 'parent') return;

    // Fix bug pendataan: memastikan nilai ayat valid dan ayat akhir tidak lebih kecil dari ayat awal
    const validAyahStart = activeTab === 'manzil' ? 0 : (ayahStart || 1);
    const validAyahEnd = activeTab === 'manzil' ? 0 : Math.max(validAyahStart, ayahEnd || 1);

    const newRecord: TahfidzRecord = {
      id: Math.random().toString(36).substr(2, 9),
      studentId: user.role === 'parent' ? user.childId! : selectedStudent,
      date: new Date().toISOString().split('T')[0],
      type: activeTab,
      surah: selectedSurah,
      ayahStart: validAyahStart,
      ayahEnd: validAyahEnd,
      grade,
      notes: activeTab === 'manzil' && pagesCount ? `${pagesCount} Halaman` : undefined
    };

    onAddRecord(newRecord);
    setIsFormOpen(false);
    setAyahStart(1);
    setAyahEnd(1);
    setPagesCount('1');
    setGrade('100');
  };

  const clearFilters = () => {
    setFilterDateStart('');
    setFilterDateEnd('');
    setFilterClass('');
    setFilterJuz('');
    setFilterSurah('');
    setSearchTerm('');
  };

  const isFilterActive = searchTerm !== '' || filterDateStart !== '' || filterDateEnd !== '' || filterClass !== '' || filterJuz !== '' || filterSurah !== '';

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 space-y-4">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          {allowedTabs.length > 1 && (
            <div className="flex bg-gray-100 p-1 rounded-lg flex-wrap gap-1">
              {allowedTabs.includes('sabaq') && (
                <button
                  onClick={() => setActiveTab('sabaq')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                    activeTab === 'sabaq' ? 'bg-white text-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Sabaq
                </button>
              )}
              {allowedTabs.includes('sabqi') && (
                <button
                  onClick={() => setActiveTab('sabqi')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                    activeTab === 'sabqi' ? 'bg-white text-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Sabqi
                </button>
              )}
              {allowedTabs.includes('manzil') && (
                <button
                  onClick={() => setActiveTab('manzil')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                    activeTab === 'manzil' ? 'bg-white text-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Manzil
                </button>
              )}
            </div>
          )}

          <div className="flex gap-2 w-full md:w-auto">
             <button 
                onClick={() => setShowFilters(!showFilters)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${showFilters ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
             >
                <Filter size={18} /> Filter
             </button>
             
             {isFilterActive && (
               <button 
                  onClick={clearFilters}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors"
               >
                  <RotateCcw size={18} />
                  <span className="hidden md:inline">Reset</span>
               </button>
             )}

             {canAdd && (
              <button
                onClick={() => setIsFormOpen(!isFormOpen)}
                className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg hover:bg-emerald-800 transition-colors shadow-sm ml-auto md:ml-0"
              >
                <PlusCircle size={18} />
                <span className="hidden md:inline">{isFormOpen ? 'Tutup' : 'Tambah'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Advanced Filter Panel */}
        {showFilters && (
          <div className="pt-4 border-t grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3 animate-fade-in">
             <div className="space-y-1">
                <label className="text-xs font-bold text-gray-500 flex items-center gap-1"><Calendar size={12}/> Tgl Mulai</label>
                <input type="date" value={filterDateStart} onChange={e => setFilterDateStart(e.target.value)} className="w-full text-sm border rounded-lg p-2 bg-gray-50"/>
             </div>
             <div className="space-y-1">
                <label className="text-xs font-bold text-gray-500 flex items-center gap-1"><Calendar size={12}/> Tgl Akhir</label>
                <input type="date" value={filterDateEnd} onChange={e => setFilterDateEnd(e.target.value)} className="w-full text-sm border rounded-lg p-2 bg-gray-50"/>
             </div>
             <div className="space-y-1">
                <label className="text-xs font-bold text-gray-500 flex items-center gap-1"><Layers size={12}/> Kelas</label>
                <select value={filterClass} onChange={e => setFilterClass(e.target.value)} className="w-full text-sm border rounded-lg p-2 bg-gray-50">
                   <option value="">Semua Kelas</option>
                   {distinctClasses.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
             </div>
             <div className="space-y-1">
                <label className="text-xs font-bold text-gray-500 flex items-center gap-1"><BookOpen size={12}/> Juz</label>
                <select value={filterJuz} onChange={e => setFilterJuz(e.target.value)} className="w-full text-sm border rounded-lg p-2 bg-gray-50">
                   <option value="">Semua Juz</option>
                   {Array.from({length: 30}, (_, i) => i + 1).map(j => (
                     <option key={j} value={j}>Juz {j}</option>
                   ))}
                </select>
             </div>
             <div className="space-y-1">
                <label className="text-xs font-bold text-gray-500">Nama Surat</label>
                <select value={filterSurah} onChange={e => setFilterSurah(e.target.value)} className="w-full text-sm border rounded-lg p-2 bg-gray-50">
                   <option value="">Semua Surat</option>
                   {SURAH_LIST.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
             </div>
          </div>
        )}
      </div>

      {/* Input Form */}
      {isFormOpen && canAdd && (
        <div className="bg-white p-6 rounded-xl shadow-md border border-emerald-100 animate-fade-in">
          <h3 className="font-bold text-gray-800 mb-4">Input Setoran {activeTab === 'sabaq' ? 'Sabaq (Baru)' : activeTab === 'sabqi' ? 'Sabqi (Ulang Baru)' : 'Manzil (Ulang Pekan)'}</h3>

          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-500">Nama Santri</label>
              <select 
                value={selectedStudent} 
                onChange={(e) => setSelectedStudent(e.target.value)}
                className="w-full p-2.5 border rounded-lg bg-gray-50 focus:ring-2 focus:ring-primary focus:border-primary outline-none"
                required
              >
                <option value="">Pilih Santri...</option>
                {availableStudents.map(s => (
                  <option key={s.id} value={s.id}>{s.name} ({s.class})</option>
                ))}
              </select>
            </div>

            {activeTab === 'manzil' ? (
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-500">Pilih Juz</label>
                <select 
                  value={selectedSurah} 
                  onChange={(e) => setSelectedSurah(e.target.value)}
                  className="w-full p-2.5 border rounded-lg bg-gray-50 outline-none font-medium"
                >
                  {Array.from({length: 30}, (_, i) => i + 1).map(j => (
                    <option key={j} value={`Juz ${j}`}>Juz {j}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-500">Nama Surat</label>
                <select 
                  value={selectedSurah} 
                  onChange={(e) => setSelectedSurah(e.target.value)}
                  className="w-full p-2.5 border rounded-lg bg-gray-50 outline-none"
                >
                  {SURAH_LIST.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            )}

            {activeTab !== 'manzil' && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-500">Ayat Mulai</label>
                  <input 
                    type="number" 
                    min="1"
                    value={ayahStart || ''}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      setAyahStart(isNaN(val) ? 0 : val);
                      if (!isNaN(val) && ayahEnd < val) setAyahEnd(val);
                    }}
                    className="w-full p-2.5 border rounded-lg bg-gray-50 outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-500">Ayat Akhir</label>
                  <input 
                    type="number" 
                    min={ayahStart || 1}
                    value={ayahEnd || ''}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      setAyahEnd(isNaN(val) ? 0 : val);
                    }}
                    className="w-full p-2.5 border rounded-lg bg-gray-50 outline-none"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-500">Nilai (0 - 100)</label>
              <input 
                type="number" 
                min="0"
                max="100"
                value={grade}
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  if (isNaN(val)) {
                    setGrade('');
                  } else {
                    setGrade(Math.min(100, Math.max(0, val)).toString());
                  }
                }}
                className="w-full p-2.5 border rounded-lg bg-gray-50 outline-none font-medium"
                required
              />
            </div>

            {activeTab === 'manzil' && (
              <div className="space-y-1 animate-fade-in">
                <label className="text-xs font-semibold text-gray-500">Jumlah Halaman</label>
                <input 
                  type="text" 
                  value={pagesCount}
                  onChange={(e) => {
                    let val = e.target.value.replace(/[^0-9,]/g, '');
                    const parts = val.split(',');
                    if (parts.length > 2) {
                      val = parts[0] + ',' + parts.slice(1).join('');
                    }
                    setPagesCount(val);
                  }}
                  placeholder="Contoh: 2,5"
                  className="w-full p-2.5 border rounded-lg bg-gray-50 outline-none font-medium"
                  required
                />
              </div>
            )}

            <div className="md:col-span-2 lg:col-span-4 flex justify-end">
              <button 
                type="submit" 
                className="bg-primary hover:bg-emerald-800 text-white px-8 py-2.5 rounded-lg font-medium transition-colors"
              >
                Simpan Data
              </button>
            </div>
          </form>
        </div>
      )}

      {/* List / Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 border-b flex items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input 
              type="text"
              placeholder="Cari nama santri..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:border-primary text-sm"
            />
          </div>
          <div className="text-xs text-gray-400">
             Total: {filteredRecords.length} Data
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 text-gray-600 text-sm">
                <th className="p-4 font-semibold">Tanggal</th>
                <th className="p-4 font-semibold">Nama Santri</th>
                <th className="p-4 font-semibold">Surat & Ayat</th>
                <th className="p-4 font-semibold">Kualitas</th>
                {canDelete && <th className="p-4 font-semibold text-center">Aksi</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={canDelete ? 5 : 4} className="p-8 text-center text-gray-400">
                    Tidak ada data yang sesuai filter.
                  </td>
                </tr>
              ) : (
                filteredRecords.map((record) => {
                  const student = students.find(s => s.id === record.studentId);
                  const juz = getJuzFromSurahName(record.surah);
                  return (
                    <tr key={record.id} className="hover:bg-gray-50 transition-colors">
                      <td className="p-4 text-sm text-gray-600">
                        {new Date(record.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </td>
                      <td className="p-4">
                        <div className="font-medium text-gray-800">{student?.name || 'Unknown'}</div>
                        <div className="text-xs text-gray-500">{student?.halaqah} - {student?.class}</div>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                           <span className="bg-emerald-50 text-emerald-700 px-2 py-1 rounded text-xs font-semibold border border-emerald-100">
                              {record.surah}
                           </span>
                           {record.ayahStart > 0 && (
                             <span className="text-[10px] text-gray-400 border px-1 rounded">Juz {juz}</span>
                           )}
                           {record.notes && (
                             <span className="bg-purple-50 text-purple-700 px-2.5 py-1 rounded text-xs font-bold border border-purple-100">
                               {record.notes}
                             </span>
                           )}
                        </div>
                        {record.ayahStart > 0 && (
                          <div className="text-sm text-gray-600 mt-1">
                            Ayat {record.ayahStart}-{record.ayahEnd}
                          </div>
                        )}
                      </td>
                      <td className="p-4">
                        {(() => {
                          const score = parseFloat(record.grade);
                          if (!isNaN(score)) {
                            let arabic = 'راسب';
                            if (score >= 90) arabic = 'ممتاز';
                            else if (score >= 80) arabic = 'جيد جداً';
                            else if (score >= 70) arabic = 'جيد';
                            else if (score >= 60) arabic = 'مقبول';
                            
                            return (
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-gray-800">{score}</span>
                                <span className={`px-2 py-0.5 rounded text-xs font-bold border ${
                                  score >= 90 ? 'bg-green-100 text-green-700 border-green-200' :
                                  score >= 80 ? 'bg-blue-100 text-blue-700 border-blue-200' :
                                  score >= 70 ? 'bg-yellow-100 text-yellow-700 border-yellow-200' :
                                  score >= 60 ? 'bg-orange-100 text-orange-700 border-orange-200' :
                                  'bg-red-100 text-red-700 border-red-200'
                                }`}>
                                  {arabic}
                                </span>
                              </div>
                            );
                          }
                          return (
                            <span className={`px-2 py-1 rounded text-xs font-medium
                              ${record.grade === 'Lancar' ? 'bg-green-100 text-green-700' : 
                                record.grade === 'Lancar Bersyarat' ? 'bg-yellow-100 text-yellow-700' :
                                record.grade === 'Ulang' ? 'bg-red-100 text-red-700' :
                                'bg-gray-100 text-gray-700'
                              }
                            `}>
                              {record.grade}
                            </span>
                          );
                        })()}
                      </td>
                      {canDelete && (
                        <td className="p-4 text-center">
                          <button 
                            onClick={() => onDeleteRecord(record.id)}
                            className="text-gray-400 hover:text-red-500 transition-colors"
                          >
                            <Trash2 size={18} />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default TahfidzLog;
