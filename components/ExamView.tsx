import React, { useState, useEffect } from 'react';
import { User, Student, Exam } from '../types';
import { QURAN_CHAPTERS, MANDATORY_QUESTIONS, JUZ_QUESTIONS, Question } from '../constants';
import { Award, Play, ChevronLeft, ChevronRight, Maximize2, Minimize2, Sun, ZoomIn, ZoomOut, Save, Trash2, Search, Filter, RotateCcw, Download } from 'lucide-react';

interface ExamViewProps {
  user: User;
  students: Student[];
  exams: Exam[];
  onAddExam: (exam: Exam) => void;
  onDeleteExam?: (id: string) => void;
}

type ViewMode = 'list' | 'setup' | 'live';
type ExamMode = 'halaman' | 'surat' | 'acak';

interface ExamHistoryState {
  score: number;
  mistakes: { dibantu: number; ditegur: number; berhenti: number };
}

const ExamView: React.FC<ExamViewProps> = ({ user, students, exams, onAddExam, onDeleteExam }) => {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedClass, setSelectedClass] = useState('');
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [examMode, setExamMode] = useState<ExamMode>('halaman');
  const [startPage, setStartPage] = useState<number>(1);
  const [packetSize, setPacketSize] = useState<number>(10);
  const [selectedSurah, setSelectedSurah] = useState<string>('1');

  // Filter and Search for history
  const [historySearchTerm, setHistorySearchTerm] = useState('');
  const [historyFilterClass, setHistoryFilterClass] = useState('');

  const [currentSession, setCurrentSession] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState<number>(0);
  const [score, setScore] = useState<number>(100);
  const [mistakes, setMistakes] = useState({ dibantu: 0, ditegur: 0, berhenti: 0 });
  const [examHistory, setExamHistory] = useState<ExamHistoryState[]>([]); // Fitur Undo
  const [imgLoading, setImgLoading] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [imageBrightness, setImageBrightness] = useState(100);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [acakScores, setAcakScores] = useState<number[]>([]);

  useEffect(() => {
    const savedSession = localStorage.getItem('sita_live_exam_session_v1');
    if (savedSession) {
      try {
        const data = JSON.parse(savedSession);
        const studentExists = students.find(s => s.id === data.currentSession?.student?.id);
        if (data.viewMode === 'live' && data.currentSession && studentExists) {
            setCurrentSession(data.currentSession);
            setCurrentPage(data.currentPage);
            setScore(data.score);
            setMistakes(data.mistakes);
            setExamHistory(data.examHistory || []);
            setExamMode(data.examMode);
            setIsFullScreen(data.isFullScreen);
            setImageBrightness(data.imageBrightness || 100);
            setZoomLevel(data.zoomLevel || 1);
            setAcakScores(data.acakScores || []);
            setViewMode('live');
        } else localStorage.removeItem('sita_live_exam_session_v1');
      } catch (e) { localStorage.removeItem('sita_live_exam_session_v1'); }
    }
  }, [students]);

  useEffect(() => {
    if (viewMode === 'live' && currentSession) {
      localStorage.setItem('sita_live_exam_session_v1', JSON.stringify({
        viewMode, currentSession, currentPage, score, mistakes, examHistory, examMode, isFullScreen, imageBrightness, zoomLevel, acakScores
      }));
    } else if (viewMode === 'list') localStorage.removeItem('sita_live_exam_session_v1');
  }, [viewMode, currentSession, currentPage, score, mistakes, examHistory, examMode, isFullScreen, imageBrightness, zoomLevel, acakScores]);

  const shuffleArray = (array: any[]) => {
      let shuffled = [...array];
      for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
  };

  const handleStartExam = () => {
    if (!selectedStudentId) return alert("Pilih santri");
    const student = students.find(s => s.id === selectedStudentId);
    let start = 0, end = 0, label = '';
    let questions: Question[] = [];

    if (examMode === 'acak') {
        const classNum = parseInt(student?.class.replace(/\D/g, '') || '7');
        let targetJuz: number[] = [];
        if (classNum === 7) targetJuz = [29, 30];
        else if (classNum === 8) targetJuz = [27, 28];
        else targetJuz = [25, 26];

        const wajib = shuffleArray(MANDATORY_QUESTIONS).slice(0, 2);
        let availableAcak: Question[] = [];
        targetJuz.forEach(juz => {
            if (JUZ_QUESTIONS[juz]) availableAcak = availableAcak.concat(JUZ_QUESTIONS[juz]);
        });
        const acak = shuffleArray(availableAcak).slice(0, 7);
        questions = [...wajib, ...acak];
        label = `Soal Acak Kelas ${classNum}`;
        end = 8; // 9 questions (0 to 8)
    } else if (examMode === 'halaman') {
      start = startPage;
      end = Math.min(604, startPage + packetSize - 1);
      label = `Hal ${start} - ${end}`;
    } else {
      const surahIdx = parseInt(selectedSurah);
      const surahData = QURAN_CHAPTERS.find(s => s[0] === surahIdx);
      if (surahData) { start = surahData[2]; end = Math.min(604, start + 2); label = `QS. ${surahData[1]}`; }
    }
    
    setCurrentSession({ student, mode: examMode, start, end, label, questions });
    setCurrentPage(start);
    
    if (examMode === 'acak') {
       const initialScores = questions.map(q => q.type === 'Wajib' ? 15 : 10);
       setAcakScores(initialScores);
       setScore(initialScores.reduce((a, b) => a + b, 0));
    } else {
       setScore(100);
    }
    
    setMistakes({ dibantu: 0, ditegur: 0, berhenti: 0 });
    setExamHistory([]);
    setIsFullScreen(false);
    setZoomLevel(1);
    setViewMode('live');
  };

  const handleMistake = (type: 'dibantu' | 'ditegur' | 'berhenti') => {
    // Simpan keadaan sekarang ke history sebelum diubah
    setExamHistory(prev => [...prev, { score, mistakes: { ...mistakes } }]);
    
    const newMistakes = { ...mistakes, [type]: mistakes[type] + 1 };
    setMistakes(newMistakes);
    const penalty = (newMistakes.dibantu * 2) + (newMistakes.ditegur * 1) + (newMistakes.berhenti * 0.5);
    setScore(Math.max(0, 100 - penalty));
  };

  const handleUndo = () => {
    if (examHistory.length === 0) return;
    
    const lastState = examHistory[examHistory.length - 1];
    setScore(lastState.score);
    setMistakes(lastState.mistakes);
    setExamHistory(prev => prev.slice(0, -1));
  };

  const handleFinishExam = () => {
    if (!confirm("Simpan Nilai?")) return;
    const finalScore = parseFloat(score.toFixed(1));
    const status = finalScore >= 70 ? 'pass' : 'fail';
    const juzString = examMode === 'acak' ? `Acak` : `Juz ${Math.ceil(currentSession.start / 20)}`;
    
    onAddExam({
      id: Math.random().toString(36).substr(2, 9),
      studentId: currentSession.student.id,
      date: new Date().toISOString().split('T')[0],
      category: `${currentSession.label}`,
      score: finalScore,
      examiner: user.name,
      status: status,
      notes: JSON.stringify(mistakes),
      juz: juzString,
      class: currentSession.student.class,
      details: { juz: juzString, surat: examMode === 'surat' ? currentSession.label : (examMode === 'acak' ? 'Soal Acak' : `Hal ${currentSession.start}`), halaman: examMode === 'acak' ? '1-9' : `${currentSession.start}-${currentSession.end}`, mistakes }
    });
    localStorage.removeItem('sita_live_exam_session_v1');
    setCurrentSession(null);
    setViewMode('list');
  };

  // Derived filtered exams for history list
  const filteredExams = exams
    .filter(e => {
        const student = students.find(s => s.id === e.studentId);
        const matchesSearch = student?.name.toLowerCase().includes(historySearchTerm.toLowerCase()) || 
                              e.studentId.toLowerCase().includes(historySearchTerm.toLowerCase());
        const matchesClass = !historyFilterClass || (student?.class === historyFilterClass);
        return matchesSearch && matchesClass;
    })
    .sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Function to download CSV
  const handleDownloadCSV = () => {
    if (filteredExams.length === 0) return alert("Tidak ada data untuk diunduh.");

    const headers = ["Tanggal", "Nama Santri", "Kelas", "Juz", "Materi Ujian", "Nilai", "Status", "Penguji", "Detail Kesalahan (Bantu/Tegur/Stop)"];
    
    const rows = filteredExams.map(exam => {
      const s = students.find(st => st.id === exam.studentId);
      let mistakesObj = exam.details?.mistakes;
      if (!mistakesObj && exam.notes && exam.notes.startsWith('{')) {
          try { mistakesObj = JSON.parse(exam.notes); } catch(e){}
      }
      const mistakesStr = mistakesObj 
        ? `${mistakesObj.dibantu}/${mistakesObj.ditegur}/${mistakesObj.berhenti}` 
        : '-';
      
      return [
        exam.date,
        `"${s?.name || '-'}"`, // Quote to handle commas in names
        s?.class || '-',
        exam.juz || '-',
        `"${exam.category}"`,
        exam.score.toString().replace('.', ','), // Excel Indonesia standard usually uses comma for decimals
        exam.status === 'pass' ? 'Lulus' : 'Belum Lulus',
        `"${exam.examiner}"`,
        mistakesStr
      ].join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Rekap_Ujian_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const renderLiveExam = () => {
    const imageUrl = `https://android.quran.com/data/width_1024/page${currentPage.toString().padStart(3, '0')}.png`;
    
    const ScoringButtons = () => {
      if (currentSession.mode === 'acak') {
         const q = currentSession.questions[currentPage];
         const maxScore = q.type === 'Wajib' ? 15 : 10;
         const currentQScore = acakScores[currentPage] || 0;
         
         const updateQScore = (val: number) => {
             const newScores = [...acakScores];
             newScores[currentPage] = Math.max(0, Math.min(maxScore, val));
             setAcakScores(newScores);
             setScore(newScores.reduce((a,b)=>a+b, 0));
         };

         return (
             <div className="w-full relative bg-white p-4 rounded-xl border border-gray-100 flex flex-col items-center justify-center gap-3">
                 <div className="text-xs font-bold text-gray-500 uppercase">Input Nilai Soal Ini</div>
                 <div className="flex items-center gap-4">
                     <button onClick={() => updateQScore(currentQScore - 1)} className="w-12 h-12 rounded-full bg-white border shadow-sm text-2xl font-bold text-red-500 hover:bg-red-50 active:scale-95 flex items-center justify-center">-</button>
                     <div className="text-4xl font-black text-primary w-20 text-center">{currentQScore}</div>
                     <button onClick={() => updateQScore(currentQScore + 1)} className="w-12 h-12 rounded-full bg-white border shadow-sm text-2xl font-bold text-emerald-500 hover:bg-emerald-50 active:scale-95 flex items-center justify-center">+</button>
                 </div>
                 <div className="text-xs text-gray-400">Nilai Maksimal: {maxScore}</div>
             </div>
         );
      }

      return (
         <div className="grid grid-cols-3 gap-3 w-full md:flex-1 relative">
            <button onClick={() => handleMistake('dibantu')} className="flex flex-col items-center p-2 rounded-lg border bg-white shadow-sm hover:bg-red-50 active:scale-95 transition-all">
                <span className="text-xl font-bold text-gray-800">{mistakes.dibantu}</span>
                <span className="text-[10px] text-red-500 uppercase font-bold">DIBANTU (-2)</span>
            </button>
            <button onClick={() => handleMistake('ditegur')} className="flex flex-col items-center p-2 rounded-lg border bg-white shadow-sm hover:bg-yellow-50 active:scale-95 transition-all">
                <span className="text-xl font-bold text-gray-800">{mistakes.ditegur}</span>
                <span className="text-[10px] text-yellow-600 uppercase font-bold">DITEGUR (-1)</span>
            </button>
            <button onClick={() => handleMistake('berhenti')} className="flex flex-col items-center p-2 rounded-lg border bg-white shadow-sm hover:bg-gray-50 active:scale-95 transition-all">
                <span className="text-xl font-bold text-gray-800">{mistakes.berhenti}</span>
                <span className="text-[10px] text-gray-500 uppercase font-bold">STOP (-0.5)</span>
            </button>
            
            {/* UNDO BUTTON FLOATING */}
            {examHistory.length > 0 && (
              <button 
                onClick={handleUndo}
                className="absolute -top-4 -right-2 bg-gray-800 text-white p-2 rounded-full shadow-lg hover:bg-black transition-all animate-bounce"
                title="Urungkan penilaian terakhir"
              >
                <RotateCcw size={14} />
              </button>
            )}
        </div>
      );
    };

    const NavigationButtons = () => (
      <div className="flex gap-2 w-full">
        <button onClick={() => { if (currentPage > currentSession.start) { setImgLoading(true); setCurrentPage(c => c - 1); }}} disabled={currentPage <= currentSession.start} className="flex-1 flex items-center justify-center gap-2 py-3 bg-gray-100 text-gray-600 rounded-lg disabled:opacity-50"><ChevronLeft size={20} /> <span className="hidden md:inline">Sebelumnya</span></button>
        {currentPage < currentSession.end ? (
          <button onClick={() => { setImgLoading(true); setCurrentPage(c => c + 1); }} className="flex-[2] flex items-center justify-center gap-2 py-3 bg-primary text-white rounded-lg shadow-sm hover:bg-emerald-700">Lanjut <ChevronRight size={20} /></button>
        ) : (
          <button onClick={handleFinishExam} className="flex-[2] flex items-center justify-center gap-2 py-3 bg-green-600 text-white rounded-lg font-bold shadow-lg hover:bg-green-700"><Save size={20} /> SELESAI</button>
        )}
      </div>
    );

    const renderQuestionContent = () => {
       if (currentSession.mode === 'acak') {
           const q = currentSession.questions[currentPage];
           return (
               <div className="w-full max-w-2xl mx-auto flex flex-col items-center justify-center min-h-full p-8 text-center space-y-6">
                   <div className="bg-emerald-50 text-emerald-700 px-4 py-1.5 rounded-full text-xs font-bold border border-emerald-200 shadow-sm">
                      SOAL {currentPage + 1} DARI 9 ({q.type.toUpperCase()})
                   </div>
                   <h3 className="text-xl md:text-2xl font-bold text-gray-800 leading-relaxed">
                      {q.text}
                   </h3>
                   <div className="text-4xl md:text-5xl font-arabic text-primary leading-[1.8] mt-6 p-6 bg-white rounded-2xl shadow-sm border border-emerald-100 w-full" dir="rtl">
                      {q.arabic}
                   </div>
                   <div className="text-sm font-medium text-gray-500 bg-gray-100 px-4 py-2 rounded-lg mt-4">
                      {q.detail}
                   </div>
               </div>
           );
       }
       return (
          <>
            {imgLoading && <div className="absolute inset-0 flex items-center justify-center z-10 bg-white/80"><div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div></div>}
            <div style={{ width: `${zoomLevel * 100}%`, maxWidth: 'none', transition: 'width 0.2s ease-out' }} className="flex justify-center min-h-full">
               <img src={imageUrl} alt={`Page ${currentPage}`} className="w-full h-auto shadow-lg bg-white" onLoad={() => { setImgLoading(false); }} onError={() => { setImgLoading(false); }} style={{ filter: `brightness(${imageBrightness}%) contrast(1.1)` }} />
            </div>
          </>
       );
    };

    if (isFullScreen) {
      return (
        <div className="fixed inset-0 z-50 bg-white flex flex-col h-[100dvh] animate-fade-in">
          <div className="bg-white/95 backdrop-blur shadow-sm border-b px-4 py-2 flex justify-between items-center z-20 shrink-0">
             <div className="flex items-center gap-3">
                 <div>
                    <h2 className="font-bold text-gray-800 text-lg leading-none truncate max-w-[150px]">{currentSession.student.name}</h2>
                    <p className="text-[10px] text-gray-500 mt-1 uppercase font-bold">{currentSession.mode === 'acak' ? `SOAL ${currentPage + 1}` : `HALAMAN ${currentPage}`}</p>
                 </div>
                 <div className="bg-emerald-100 px-3 py-1 rounded-lg border border-emerald-200 relative">
                    <div className="text-[10px] text-emerald-800 font-bold leading-none">NILAI</div>
                    <div className="text-xl font-black text-emerald-700 leading-none">{score.toFixed(1)}</div>
                    {examHistory.length > 0 && currentSession.mode !== 'acak' && (
                      <button 
                        onClick={handleUndo}
                        className="absolute -bottom-2 -right-2 bg-red-500 text-white p-1 rounded-full shadow-md hover:bg-red-600"
                        title="Urungkan"
                      >
                        <RotateCcw size={10} />
                      </button>
                    )}
                 </div>
             </div>
             
             <div className="flex items-center gap-2">
                 {currentSession.mode !== 'acak' && (
                     <>
                        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 mr-2">
                            <button onClick={() => setZoomLevel(z => Math.max(0.5, z - 0.1))} className="p-1 hover:bg-white rounded"><ZoomOut size={16} /></button>
                            <span className="text-xs font-mono w-8 text-center">{Math.round(zoomLevel * 100)}%</span>
                            <button onClick={() => setZoomLevel(z => Math.min(3, z + 0.1))} className="p-1 hover:bg-white rounded"><ZoomIn size={16} /></button>
                        </div>
                        <div className="hidden md:flex items-center gap-2 bg-gray-100 px-3 py-1 rounded-full"><Sun size={14} className="text-gray-400" /><input type="range" min="80" max="150" value={imageBrightness} onChange={(e) => setImageBrightness(parseInt(e.target.value))} className="w-20 h-1.5 bg-gray-300 rounded-lg appearance-none cursor-pointer" /></div>
                     </>
                 )}
                 <button onClick={() => setIsFullScreen(false)} className="bg-gray-100 text-gray-700 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-gray-200"><Minimize2 size={16} /></button>
             </div>
          </div>
          <div className="flex-1 relative overflow-auto bg-gray-50 flex items-start justify-center p-4">
             {renderQuestionContent()}
          </div>
          <div className="bg-white border-t p-3 md:p-4 pb-8 md:pb-6 z-20 shrink-0 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] relative">
             <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center gap-4">
                <ScoringButtons />
                <div className="w-full md:w-80"><NavigationButtons /></div>
             </div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col lg:flex-row h-[calc(100vh-160px)] gap-4 animate-fade-in">
        <div className="relative bg-amber-50 rounded-xl overflow-hidden shadow-inner border border-amber-100 flex-1 flex flex-col group">
          <button onClick={() => setIsFullScreen(true)} className="absolute top-4 right-4 z-20 bg-white/90 backdrop-blur p-2 rounded-full shadow-md text-gray-700 hover:text-primary transition-colors"><Maximize2 size={20} /></button>
          <div className="flex-1 overflow-y-auto flex items-start justify-center p-4 relative">
             {renderQuestionContent()}
          </div>
          <div className="bg-white p-3 border-t text-center text-sm font-bold text-gray-500">{currentSession.mode === 'acak' ? `Soal ${currentPage + 1} dari 9` : `Halaman ${currentPage}`}</div>
        </div>
        <div className="w-full lg:w-96 bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col shrink-0">
          <div className="p-4 border-b bg-gray-50 rounded-t-xl flex justify-between items-center">
            <div><h2 className="font-bold text-gray-800 leading-tight">{currentSession.student.name}</h2><p className="text-xs text-gray-500 mt-1">{currentSession.label}</p></div>
            <div className="text-right">
              <div className="text-[10px] text-gray-400 font-bold">NILAI</div>
              <div className="text-3xl font-black text-primary">{score.toFixed(1)}</div>
              {examHistory.length > 0 && currentSession.mode !== 'acak' && (
                <button onClick={handleUndo} className="text-[10px] text-red-500 flex items-center gap-1 hover:underline ml-auto mt-1 font-bold">
                  <RotateCcw size={10} /> URUNGKAN
                </button>
              )}
            </div>
          </div>
          <div className="p-4 space-y-4">
             <ScoringButtons />
          </div>
          <div className="flex-1"></div>
          <div className="p-4 border-t space-y-3"><NavigationButtons /><button onClick={() => { if(confirm("Batal?")) setViewMode('list'); }} className="w-full text-xs text-red-500 hover:text-red-700">Batalkan Ujian</button></div>
        </div>
      </div>
    );
  };

  const renderSetup = () => (
    <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-sm border border-gray-100 p-6 animate-fade-in">
      <div className="flex justify-between items-center mb-6 border-b pb-4"><h3 className="text-xl font-bold text-gray-800">Mulai Ujian Baru</h3><button onClick={() => setViewMode('list')} className="text-gray-500">Batal</button></div>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div><label className="block text-sm font-medium mb-1">Kelas</label><select className="w-full border rounded-lg p-2.5 bg-gray-50" value={selectedClass} onChange={(e) => setSelectedClass(e.target.value)}><option value="">Pilih...</option>{Array.from(new Set(students.map(s => s.class))).map(c => <option key={c} value={c}>{c}</option>)}</select></div>
          <div><label className="block text-sm font-medium mb-1">Santri</label><select className="w-full border rounded-lg p-2.5 bg-gray-50" value={selectedStudentId} onChange={(e) => setSelectedStudentId(e.target.value)}><option value="">Pilih...</option>{students.filter(s => !selectedClass || s.class === selectedClass).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        </div>
        <div className="bg-gray-100 p-1 rounded-lg flex"><button className={`flex-1 py-2 rounded-md text-sm font-medium ${examMode === 'halaman' ? 'bg-white shadow text-primary' : 'text-gray-500'}`} onClick={() => setExamMode('halaman')}>Halaman</button><button className={`flex-1 py-2 rounded-md text-sm font-medium ${examMode === 'surat' ? 'bg-white shadow text-primary' : 'text-gray-500'}`} onClick={() => setExamMode('surat')}>Surat</button><button className={`flex-1 py-2 rounded-md text-sm font-medium ${examMode === 'acak' ? 'bg-white shadow text-primary' : 'text-gray-500'}`} onClick={() => setExamMode('acak')}>Soal Acak</button></div>
        {examMode === 'halaman' ? (
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-sm font-medium">Halaman</label><input type="number" min="1" max="604" className="w-full border rounded-lg p-2.5" value={startPage} onChange={(e) => setStartPage(parseInt(e.target.value) || 1)} /></div>
            <div><label className="text-sm font-medium">Paket</label><select className="w-full border rounded-lg p-2.5" value={packetSize} onChange={(e) => setPacketSize(parseInt(e.target.value))}><option value={10}>10 Hal</option><option value={20}>20 Hal</option></select></div>
          </div>
        ) : examMode === 'surat' ? (
          <div><label className="text-sm font-medium">Pilih Surat</label><select className="w-full border rounded-lg p-2.5 bg-gray-50" value={selectedSurah} onChange={(e) => setSelectedSurah(e.target.value)}>{QURAN_CHAPTERS.map(q => <option key={q[0]} value={q[0]}>{q[0]}. {q[1]}</option>)}</select></div>
        ) : (
          <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-lg text-emerald-800 text-sm">
             <p className="font-bold mb-1">Informasi Soal Acak:</p>
             <ul className="list-disc list-inside space-y-1">
                <li>Sistem akan men-generate otomatis <strong>9 soal</strong> (2 Soal Wajib & 7 Soal Acak).</li>
                <li>Materi soal disesuaikan otomatis dengan Juz dari kelas santri.</li>
                <li>Setiap soal akan diberi nilai manual (Wajib maks 15 poin, Acak maks 10 poin).</li>
             </ul>
          </div>
        )}
        <button onClick={handleStartExam} className="w-full py-3 bg-primary text-white rounded-lg font-bold flex items-center justify-center gap-2 mt-4">MULAI UJIAN <Award size={20} /></button>
      </div>
    </div>
  );

  const distinctExamClasses = Array.from(new Set(students.map(s => s.class))).sort();

  return <div className="min-h-[500px]">{viewMode === 'list' && (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div><h2 className="text-xl font-bold text-gray-800">Riwayat Ujian</h2></div>
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          {/* SEARCH BOX */}
          <div className="relative flex-1 md:w-56">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input 
              type="text" 
              placeholder="Cari santri..." 
              value={historySearchTerm}
              onChange={(e) => setHistorySearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border rounded-lg text-sm focus:ring-primary focus:border-primary outline-none"
            />
          </div>
          {/* CLASS FILTER */}
          <div className="relative w-full md:w-36">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <select 
              value={historyFilterClass}
              onChange={(e) => setHistoryFilterClass(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border rounded-lg text-sm focus:ring-primary focus:border-primary outline-none bg-white"
            >
              <option value="">Semua Kelas</option>
              {distinctExamClasses.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          
          {/* DOWNLOAD BUTTON FOR ADMIN ONLY */}
          {user.role === 'admin' && (
             <button 
               onClick={handleDownloadCSV}
               className="bg-gray-800 text-white px-4 py-2 rounded-lg flex items-center gap-2 shadow-sm hover:bg-black transition-colors text-sm"
               title="Download Hasil Ujian (CSV)"
             >
               <Download size={16} /> <span className="hidden md:inline">Download</span>
             </button>
          )}

          {user.role === 'teacher' && <button onClick={() => setViewMode('setup')} className="bg-primary text-white px-5 py-2 rounded-lg flex items-center gap-2 shadow-sm hover:bg-emerald-800 transition-colors text-sm"><Play size={16} /> Mulai Ujian</button>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredExams.length === 0 ? <div className="col-span-full text-center py-12 text-gray-400">Belum ada data atau tidak ditemukan.</div> : filteredExams.map(exam => {
            const s = students.find(st => st.id === exam.studentId);
            const juzLabel = exam.juz || (exam.details?.juz) || 'Juz -';
            const displayTitle = `${s?.class || '-'} | ${juzLabel}, ${exam.category}`;
            
            return (
              <div key={exam.id} className="bg-white rounded-xl overflow-hidden shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                <div className={`h-1.5 w-full ${exam.score >= 70 ? 'bg-green-500' : 'bg-red-500'}`}></div>
                <div className="p-5">
                  <div className="flex justify-between items-start mb-2">
                      <div>
                          <h3 className="font-bold text-gray-800 text-lg">{s?.name || 'Santri'}</h3>
                          <p className="text-sm font-medium text-primary mt-0.5">{displayTitle}</p>
                      </div>
                      <div className={`text-right font-black text-2xl ${exam.score >= 70 ? 'text-green-600' : 'text-red-600'}`}>{exam.score}</div>
                  </div>
                  <div className="text-xs text-gray-500 flex justify-between mt-4 border-t pt-3">
                      <span>{new Date(exam.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                      <span>{exam.examiner}</span>
                  </div>
                  {(user.role === 'admin' || user.role === 'teacher') && onDeleteExam && (
                      <button onClick={() => onDeleteExam(exam.id)} className="w-full mt-3 pt-2 border-t border-dashed text-xs text-red-500 text-center flex items-center justify-center gap-1 hover:text-red-700 transition-colors">
                          <Trash2 size={12}/> Hapus Data
                      </button>
                  )}
                </div>
              </div>
            );
        })}
      </div>
    </div>
  )}{viewMode === 'setup' && renderSetup()}{viewMode === 'live' && renderLiveExam()}</div>;
};

export default ExamView;
