
import React, { useState, useRef } from 'react';
import { User, Student, TahfidzRecord, Grade } from '../types';
import { UserPlus, Trash2, Users, GraduationCap, School, Upload, FileText, Download, Clipboard, ListPlus, BookOpen, Edit2 } from 'lucide-react';

interface AdminPanelProps {
  users: User[];
  students: Student[];
  onAddUser: (user: User) => void;
  onDeleteUser: (id: string) => void;
  onUpdateUser?: (user: User) => void;
  onAddStudent: (student: Student) => void;
  onDeleteStudent: (id: string) => void;
  onUpdateStudent?: (student: Student) => void;
  // New Bulk Props
  onBulkAddStudents: (students: Student[]) => void;
  onBulkAddUsers: (users: User[]) => void;
  onBulkAddRecords?: (records: TahfidzRecord[]) => void;
}

const AdminPanel: React.FC<AdminPanelProps> = ({ 
  users, students, onAddUser, onDeleteUser, onUpdateUser, onAddStudent, onDeleteStudent, onUpdateStudent,
  onBulkAddStudents, onBulkAddUsers, onBulkAddRecords
}) => {
  const [activeTab, setActiveTab] = useState<'santri' | 'guru' | 'hafalan'>('santri');
  const [inputMode, setInputMode] = useState<'single' | 'bulk'>('single');
  const [bulkText, setBulkText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // State untuk edit modal
  const [editingTeacher, setEditingTeacher] = useState<User | null>(null);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);

  // Form States
  const [newStudent, setNewStudent] = useState({ name: '', nis: '', class: '', halaqah: '', teacherId: '', username: '', password: '' });
  const [newUser, setNewUser] = useState({ name: '', username: '', password: '', childId: '', phoneNumber: '' });

  const teachers = users.filter(u => u.role === 'teacher');

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const csv = event.target?.result as string;
      processBulkData(csv);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const processBulkData = (rawData: string) => {
    const lines = rawData.split('\n');
    let successCount = 0;
    
    // Arrays to hold batch data
    const batchStudents: Student[] = [];
    const batchUsers: User[] = [];
    const batchRecords: TahfidzRecord[] = [];
    
    // Filter empty lines
    const dataRows = lines.filter(line => line.trim() !== '');

    // Skip header if it looks like a header (contains 'Nama' or 'Username')
    const startIdx = (dataRows[0]?.toLowerCase().includes('nama') || dataRows[0]?.toLowerCase().includes('username')) ? 1 : 0;

    dataRows.slice(startIdx).forEach(row => {
      // Split by comma, semicolon, OR tab (for Excel copy-paste)
      const cols = row.split(/[,;\t]/).map(c => c.trim().replace(/^"|"$/g, ''));
      
      if (cols.length < 2) return; // Skip invalid rows

      if (activeTab === 'santri') {
        // Format: Nama, NIS, Kelas, Halaqah, UsernameGuru, (Optional: Password)
        if (cols.length >= 2) {
            // Find teacher by username, or default to first teacher, or admin
            const teacherUsername = cols[4];
            const teacher = teachers.find(t => t.username === teacherUsername);
            
            const student: Student = {
                id: 's' + Math.random().toString(36).substr(2, 9) + Math.random().toString(36).substr(2, 5),
                name: cols[0] || 'Tanpa Nama',
                nis: cols[1] || '-',
                class: cols[2] || '-',
                halaqah: cols[3] || '-',
                teacherId: teacher ? teacher.id : (teachers[0]?.id || 'admin'),
                totalJuz: 0,
                // Default credential is NIS if not provided
                username: cols[1] || `user${Math.floor(Math.random()*1000)}`,
                password: cols[5] || '123'
            };
            batchStudents.push(student);
            successCount++;
        }
      } else if (activeTab === 'guru') {
        // Format: Nama, Username, Password, NoHP
        if (cols.length >= 3) {
          const teacher: User = {
            id: 'u' + Math.random().toString(36).substr(2, 9) + Math.random().toString(36).substr(2, 5),
            name: cols[0],
            role: 'teacher',
            username: cols[1],
            password: cols[2],
            phoneNumber: cols[3] || ''
          };
          batchUsers.push(teacher);
          successCount++;
        }
      } else if (activeTab === 'hafalan') {
        // Format: NIS, Tanggal, Tipe(ziyadah/murojaah), Surah, Ayat Mulai, Ayat Selesai, Nilai(Lancar/Lancar Bersyarat/Belum Lancar/Ulang), Catatan
        if (cols.length >= 7) {
          const student = students.find(s => s.nis === cols[0]);
          if (student) {
             const record: TahfidzRecord = {
                 id: 'r' + Math.random().toString(36).substr(2, 9),
                 studentId: student.id,
                 date: cols[1],
                 type: (['sabaq', 'sabqi', 'manzil', 'murojaah', 'ziyadah'].includes(cols[2].toLowerCase()) 
                   ? (cols[2].toLowerCase() as any) 
                   : 'sabaq'),
                 surah: cols[3],
                 ayahStart: parseInt(cols[4]) || 1,
                 ayahEnd: parseInt(cols[5]) || 1,
                 grade: cols[6] ? cols[6].trim() : '100',
                 notes: cols[7] || ''
             };
             batchRecords.push(record);
             successCount++;
          }
        }
      }
    });

    // Perform Batch Update
    if (activeTab === 'santri' && batchStudents.length > 0) {
        onBulkAddStudents(batchStudents);
    } else if (activeTab === 'guru' && batchUsers.length > 0) {
        onBulkAddUsers(batchUsers);
    } else if (activeTab === 'hafalan' && batchRecords.length > 0 && onBulkAddRecords) {
        onBulkAddRecords(batchRecords);
    }

    if (successCount > 0) {
        alert(`Berhasil menambahkan ${successCount} data ${activeTab}. Data akan tampil di tabel sesaat lagi.`);
        setBulkText('');
    } else {
        alert("Gagal memproses data. Pastikan format sesuai.");
    }
  };

  const handleBulkSubmit = () => {
      if (!bulkText.trim()) return;
      processBulkData(bulkText);
  };

  const getTemplateFormat = () => {
    if (activeTab === 'santri') return 'Nama | NIS | Kelas | Halaqah | Username_Guru | Password (Opsional)';
    if (activeTab === 'guru') return 'Nama | Username | Password | No_HP';
    if (activeTab === 'hafalan') return 'NIS | Tanggal(YYYY-MM-DD) | Tipe(sabaq/sabqi/manzil) | Surah | Ayat Mulai | Ayat Selesai | Nilai | Catatan';
    return '';
  };

  const getExampleData = () => {
    if (activeTab === 'santri') return 'Ahmad Fulan\t202401\t7A\tHalaqah 1\tguru1\t12345';
    if (activeTab === 'guru') return 'Ust. Budi\tguru_budi\t123456\t62812345678';
    if (activeTab === 'hafalan') return '2024001\t2024-03-25\tsabaq\tAl-Baqarah\t1\t5\tLancar\tBagus';
    return '';
  };

  const getCSVTemplate = () => {
    let content = '';
    let filename = '';
    
    if (activeTab === 'santri') {
      content = 'Nama,NIS,Kelas,Halaqah,Username_Guru,Password\nAhmad Fulan,2024001,7A,Halaqah 1,guru1,123';
      filename = 'template_santri.csv';
    } else if (activeTab === 'guru') {
      content = 'Nama,Username,Password,NoHP\nUst. Fulan,guru1,12345,6281234567890';
      filename = 'template_guru.csv';
    } else if (activeTab === 'hafalan') {
      content = 'NIS,Tanggal,Tipe(sabaq/sabqi/manzil),Surah,Ayat_Mulai,Ayat_Selesai,Nilai,Catatan\n2024001,2024-03-25,sabaq,Al-Baqarah,1,5,Lancar,-';
      filename = 'template_hafalan.csv';
    }

    const blob = new Blob([content], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  };

  const handleAddStudent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStudent.name || !newStudent.teacherId) return alert("Mohon lengkapi data");
    
    const student: Student = {
      id: 's' + Date.now(),
      name: newStudent.name,
      nis: newStudent.nis,
      class: newStudent.class,
      halaqah: newStudent.halaqah,
      teacherId: newStudent.teacherId,
      totalJuz: 0,
      username: newStudent.username || newStudent.nis, // Fallback to NIS
      password: newStudent.password || '123'
    };
    onAddStudent(student);
    setNewStudent({ name: '', nis: '', class: '', halaqah: '', teacherId: '', username: '', password: '' });
    alert("Santri berhasil ditambahkan");
  };

  const handleAddTeacher = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUser.name || !newUser.username || !newUser.password) return alert("Mohon lengkapi data");

    const teacher: User = {
      id: 'u' + Date.now(),
      name: newUser.name,
      role: 'teacher',
      username: newUser.username,
      password: newUser.password,
      phoneNumber: newUser.phoneNumber
    };
    onAddUser(teacher);
    setNewUser({ name: '', username: '', password: '', childId: '', phoneNumber: '' });
    alert("Guru berhasil ditambahkan");
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Top Tabs */}
      <div className="flex bg-white rounded-xl shadow-sm border border-gray-100 p-1">
        <button
          onClick={() => setActiveTab('santri')}
          className={`flex-1 py-3 px-2 rounded-lg flex items-center justify-center gap-2 font-medium transition-all text-sm ${activeTab === 'santri' ? 'bg-emerald-50 text-emerald-700 shadow-sm' : 'text-gray-500 hover:bg-gray-50'}`}
        >
          <GraduationCap size={18} /> Data Santri
        </button>
        <button
          onClick={() => setActiveTab('guru')}
          className={`flex-1 py-3 px-2 rounded-lg flex items-center justify-center gap-2 font-medium transition-all text-sm ${activeTab === 'guru' ? 'bg-emerald-50 text-emerald-700 shadow-sm' : 'text-gray-500 hover:bg-gray-50'}`}
        >
          <School size={18} /> Data Guru
        </button>
        <button
          onClick={() => { setActiveTab('hafalan'); setInputMode('bulk'); }}
          className={`flex-1 py-3 px-2 rounded-lg flex items-center justify-center gap-2 font-medium transition-all text-sm ${activeTab === 'hafalan' ? 'bg-emerald-50 text-emerald-700 shadow-sm' : 'text-gray-500 hover:bg-gray-50'}`}
        >
          <BookOpen size={18} /> Data Hafalan
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Input Panel */}
        <div className="lg:col-span-1 bg-white p-6 rounded-xl shadow-sm border border-gray-100 h-fit">
          <div className="flex justify-between items-center mb-6">
             <h3 className="font-bold text-lg text-gray-800 flex items-center gap-2">
                {inputMode === 'single' ? <UserPlus className="text-emerald-600" size={20} /> : <ListPlus className="text-emerald-600" size={20} />}
                {inputMode === 'single' ? 'Input Satuan' : 'Input Massal'}
             </h3>
             <div className="flex bg-gray-100 p-0.5 rounded-lg text-xs">
                {activeTab !== 'hafalan' && (
                  <button 
                    onClick={() => setInputMode('single')}
                    className={`px-3 py-1.5 rounded-md font-medium transition-all ${inputMode === 'single' ? 'bg-white shadow text-gray-800' : 'text-gray-500'}`}
                  >
                    Satuan
                  </button>
                )}
                <button 
                  onClick={() => setInputMode('bulk')}
                  className={`px-3 py-1.5 rounded-md font-medium transition-all ${inputMode === 'bulk' ? 'bg-white shadow text-gray-800' : 'text-gray-500'}`}
                >
                  Massal
                </button>
             </div>
          </div>
          
          {inputMode === 'bulk' ? (
            <div className="space-y-4 animate-fade-in">
                <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 text-sm">
                    <p className="font-bold text-blue-800 mb-1 flex items-center gap-2">
                        <Clipboard size={14}/> Cara Penggunaan:
                    </p>
                    <p className="text-blue-700 mb-2">
                        Copy data dari Excel lalu Paste di kolom bawah.
                    </p>
                    <div className="bg-white p-2 rounded border border-blue-200 font-mono text-xs text-gray-500 overflow-x-auto">
                        Format: {getTemplateFormat()}
                    </div>
                </div>

                <textarea
                    value={bulkText}
                    onChange={(e) => setBulkText(e.target.value)}
                    placeholder={`Contoh (Excel):\n${getExampleData()}`}
                    className="w-full h-48 p-3 border rounded-lg text-sm font-mono focus:ring-2 focus:ring-emerald-500 outline-none resize-none"
                />

                <button 
                    onClick={handleBulkSubmit}
                    disabled={!bulkText.trim()}
                    className="w-full bg-emerald-600 text-white py-2.5 rounded-lg font-bold text-sm hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                >
                    Proses Data Massal
                </button>

                <div className="relative flex py-2 items-center">
                    <div className="flex-grow border-t border-gray-200"></div>
                    <span className="flex-shrink-0 mx-4 text-xs text-gray-400">Atau upload file</span>
                    <div className="flex-grow border-t border-gray-200"></div>
                </div>

                <div className="flex gap-2">
                    <button onClick={getCSVTemplate} className="flex-1 bg-white border border-gray-300 text-gray-600 text-xs py-2 rounded hover:bg-gray-50 flex items-center justify-center gap-1">
                        <Download size={14} /> Template CSV
                    </button>
                    <button onClick={() => fileInputRef.current?.click()} className="flex-1 bg-gray-100 text-gray-700 border border-gray-300 text-xs py-2 rounded hover:bg-gray-200 flex items-center justify-center gap-1">
                        <Upload size={14} /> Upload CSV
                    </button>
                    <input type="file" accept=".csv" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
                </div>
            </div>
          ) : (
            <div className="animate-fade-in">
                {activeTab === 'santri' && (
                    <form onSubmit={handleAddStudent} className="space-y-3">
                    <div><label className="text-xs font-bold text-gray-500">Nama Lengkap</label><input type="text" className="w-full border rounded-lg p-2 text-sm" value={newStudent.name} onChange={e => setNewStudent({...newStudent, name: e.target.value})} required placeholder="Contoh: Ahmad Fulan" /></div>
                    <div><label className="text-xs font-bold text-gray-500">NIS</label><input type="text" className="w-full border rounded-lg p-2 text-sm" value={newStudent.nis} onChange={e => setNewStudent({...newStudent, nis: e.target.value})} placeholder="2024001" /></div>
                    <div className="grid grid-cols-2 gap-2">
                        <div><label className="text-xs font-bold text-gray-500">Kelas</label><input type="text" className="w-full border rounded-lg p-2 text-sm" value={newStudent.class} onChange={e => setNewStudent({...newStudent, class: e.target.value})} placeholder="7A" /></div>
                        <div><label className="text-xs font-bold text-gray-500">Halaqah</label><input type="text" className="w-full border rounded-lg p-2 text-sm" value={newStudent.halaqah} onChange={e => setNewStudent({...newStudent, halaqah: e.target.value})} placeholder="Halaqah 1" /></div>
                    </div>
                    <div><label className="text-xs font-bold text-gray-500">Guru Pembimbing</label><select className="w-full border rounded-lg p-2 text-sm bg-white" value={newStudent.teacherId} onChange={e => setNewStudent({...newStudent, teacherId: e.target.value})} required><option value="">Pilih Guru...</option>{teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
                    <div className="pt-2 border-t mt-2">
                        <p className="text-xs font-bold text-emerald-600 mb-2">Akun Login Santri/Wali</p>
                        <div className="space-y-2">
                            <div><label className="text-xs font-bold text-gray-500">Username</label><input type="text" className="w-full border rounded-lg p-2 text-sm bg-gray-50" value={newStudent.username} onChange={e => setNewStudent({...newStudent, username: e.target.value})} placeholder="Kosongkan untuk pakai NIS" /></div>
                            <div><label className="text-xs font-bold text-gray-500">Password</label><input type="text" className="w-full border rounded-lg p-2 text-sm bg-gray-50" value={newStudent.password} onChange={e => setNewStudent({...newStudent, password: e.target.value})} placeholder="Default: 123" /></div>
                        </div>
                    </div>
                    <button type="submit" className="w-full bg-emerald-600 text-white py-2 rounded-lg font-bold text-sm hover:bg-emerald-700 mt-2">Simpan Data Santri</button>
                    </form>
                )}

                {activeTab === 'guru' && (
                    <form onSubmit={handleAddTeacher} className="space-y-3">
                    <div><label className="text-xs font-bold text-gray-500">Nama Guru</label><input type="text" className="w-full border rounded-lg p-2 text-sm" value={newUser.name} onChange={e => setNewUser({...newUser, name: e.target.value})} required placeholder="Ust. Fulan" /></div>
                    <div><label className="text-xs font-bold text-gray-500">Username</label><input type="text" className="w-full border rounded-lg p-2 text-sm" value={newUser.username} onChange={e => setNewUser({...newUser, username: e.target.value})} required /></div>
                    <div><label className="text-xs font-bold text-gray-500">Password</label><input type="text" className="w-full border rounded-lg p-2 text-sm" value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})} required /></div>
                    <div><label className="text-xs font-bold text-gray-500">WhatsApp (628..)</label><input type="text" className="w-full border rounded-lg p-2 text-sm" value={newUser.phoneNumber} onChange={e => setNewUser({...newUser, phoneNumber: e.target.value})} placeholder="6281234567890" /></div>
                    <button type="submit" className="w-full bg-emerald-600 text-white py-2 rounded-lg font-bold text-sm hover:bg-emerald-700 mt-2">Simpan Data Guru</button>
                    </form>
                )}
            </div>
          )}
        </div>

        {/* Right Column: List Table */}
        <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-sm border border-gray-100">
           <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg text-gray-800">
                {activeTab === 'santri' ? 'Daftar Santri' : activeTab === 'guru' ? 'Daftar Guru Halaqah' : 'Informasi Upload Hafalan'}
              </h3>
              {activeTab !== 'hafalan' && (
                <div className="text-xs text-gray-400">Total: {activeTab === 'santri' ? students.length : users.filter(u => u.role === 'teacher').length} Data</div>
              )}
           </div>
           
           <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
             {activeTab === 'hafalan' ? (
                <div className="text-center py-12 text-gray-500">
                   <BookOpen className="mx-auto mb-4 text-gray-300" size={48} />
                   <p>Data hafalan tidak ditampilkan di tabel ini.</p>
                   <p className="text-sm mt-2">Untuk melihat atau mengedit data hafalan, silakan gunakan menu <b>Hafalan Santri</b> di panel utama.</p>
                </div>
             ) : (
             <table className="w-full text-left border-collapse">
               <thead className="sticky top-0 bg-gray-50 z-10 shadow-sm">
                 <tr className="text-gray-600 text-sm">
                   <th className="p-3">Nama</th>
                   <th className="p-3">{activeTab === 'santri' ? 'Kelas' : 'Kontak'}</th>
                   <th className="p-3">{activeTab === 'santri' ? 'Guru' : 'Login'}</th>
                   <th className="p-3 text-center">Aksi</th>
                 </tr>
               </thead>
               <tbody className="divide-y divide-gray-100 text-sm">
                 {activeTab === 'santri' ? (
                   students.map(student => (
                     <tr key={student.id} className="hover:bg-gray-50">
                       <td className="p-3 font-medium">{student.name} <span className="text-xs text-gray-400 block">{student.nis}</span></td>
                       <td className="p-3">{student.class} / {student.halaqah}</td>
                       <td className="p-3">
                           <div className="text-emerald-600 mb-1">{users.find(u => u.id === student.teacherId)?.name || '-'}</div>
                           <div className="text-xs text-gray-400 bg-gray-50 px-1 rounded inline-block">User: {student.username || student.nis}</div>
                       </td>
                       <td className="p-3">
                         <div className="flex items-center justify-center gap-2.5">
                           <button onClick={() => setEditingStudent(student)} className="text-gray-400 hover:text-emerald-600" title="Edit Profil"><Edit2 size={16} /></button>
                           <button onClick={() => onDeleteStudent(student.id)} className="text-gray-400 hover:text-red-500" title="Hapus"><Trash2 size={16} /></button>
                         </div>
                       </td>
                     </tr>
                   ))
                 ) : (
                   users.filter(u => u.role === 'teacher').map(user => (
                     <tr key={user.id} className="hover:bg-gray-50">
                       <td className="p-3 font-medium">{user.name}</td>
                       <td className="p-3 text-gray-600">
                           <div className="text-xs text-green-600">{user.phoneNumber || '-'}</div>
                       </td>
                       <td className="p-3 font-mono text-xs">
                         {user.username}
                       </td>
                       <td className="p-3">
                         <div className="flex items-center justify-center gap-2.5">
                           <button onClick={() => setEditingTeacher(user)} className="text-gray-400 hover:text-emerald-600" title="Edit Profil"><Edit2 size={16} /></button>
                           <button onClick={() => onDeleteUser(user.id)} className="text-gray-400 hover:text-red-500" title="Hapus"><Trash2 size={16} /></button>
                         </div>
                       </td>
                     </tr>
                   ))
                 )}
               </tbody>
             </table>
             )}
           </div>
        </div>
      </div>

      {/* Modal Edit Guru */}
      {editingTeacher && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-xl relative">
            <h3 className="font-bold text-lg text-gray-800 mb-4">Edit Profil Guru</h3>
            <form onSubmit={(e) => {
              e.preventDefault();
              if (onUpdateUser) onUpdateUser(editingTeacher);
              setEditingTeacher(null);
              alert("Profil guru berhasil diperbarui");
            }} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-gray-500">Nama Guru</label>
                <input 
                  type="text" 
                  value={editingTeacher.name} 
                  onChange={e => setEditingTeacher({...editingTeacher, name: e.target.value})} 
                  className="w-full border rounded-lg p-2 text-sm" 
                  required 
                />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500">Username</label>
                <input 
                  type="text" 
                  value={editingTeacher.username || ''} 
                  onChange={e => setEditingTeacher({...editingTeacher, username: e.target.value})} 
                  className="w-full border rounded-lg p-2 text-sm" 
                  required 
                />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500">Password</label>
                <input 
                  type="text" 
                  value={editingTeacher.password} 
                  onChange={e => setEditingTeacher({...editingTeacher, password: e.target.value})} 
                  className="w-full border rounded-lg p-2 text-sm" 
                  required 
                />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500">WhatsApp (628..)</label>
                <input 
                  type="text" 
                  value={editingTeacher.phoneNumber || ''} 
                  onChange={e => setEditingTeacher({...editingTeacher, phoneNumber: e.target.value})} 
                  className="w-full border rounded-lg p-2 text-sm" 
                  placeholder="6281234..." 
                />
              </div>
              <div className="flex gap-2 justify-end pt-4 border-t">
                <button 
                  type="button" 
                  onClick={() => setEditingTeacher(null)} 
                  className="px-4 py-2 border rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50"
                >
                  Batal
                </button>
                <button 
                  type="submit" 
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-bold shadow-sm"
                >
                  Simpan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Edit Santri */}
      {editingStudent && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-xl relative">
            <h3 className="font-bold text-lg text-gray-800 mb-4">Edit Profil Santri</h3>
            <form onSubmit={(e) => {
              e.preventDefault();
              if (onUpdateStudent) onUpdateStudent(editingStudent);
              setEditingStudent(null);
              alert("Profil santri berhasil diperbarui");
            }} className="space-y-3">
              <div>
                <label className="text-xs font-bold text-gray-500">Nama Lengkap</label>
                <input 
                  type="text" 
                  value={editingStudent.name} 
                  onChange={e => setEditingStudent({...editingStudent, name: e.target.value})} 
                  className="w-full border rounded-lg p-2 text-sm" 
                  required 
                />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500">NIS</label>
                <input 
                  type="text" 
                  value={editingStudent.nis} 
                  onChange={e => setEditingStudent({...editingStudent, nis: e.target.value})} 
                  className="w-full border rounded-lg p-2 text-sm" 
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-bold text-gray-500">Kelas</label>
                  <input 
                    type="text" 
                    value={editingStudent.class} 
                    onChange={e => setEditingStudent({...editingStudent, class: e.target.value})} 
                    className="w-full border rounded-lg p-2 text-sm" 
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500">Halaqah</label>
                  <input 
                    type="text" 
                    value={editingStudent.halaqah} 
                    onChange={e => setEditingStudent({...editingStudent, halaqah: e.target.value})} 
                    className="w-full border rounded-lg p-2 text-sm" 
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500">Guru Pembimbing</label>
                <select 
                  value={editingStudent.teacherId} 
                  onChange={e => setEditingStudent({...editingStudent, teacherId: e.target.value})} 
                  className="w-full border rounded-lg p-2 text-sm bg-white" 
                  required
                >
                  <option value="">Pilih Guru...</option>
                  {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div className="pt-2 border-t mt-2">
                <p className="text-xs font-bold text-emerald-600 mb-2">Akun Login Santri/Wali</p>
                <div className="space-y-2">
                  <div>
                    <label className="text-xs font-bold text-gray-500">Username</label>
                    <input 
                      type="text" 
                      value={editingStudent.username || ''} 
                      onChange={e => setEditingStudent({...editingStudent, username: e.target.value})} 
                      className="w-full border rounded-lg p-2 text-sm" 
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-500">Password</label>
                    <input 
                      type="text" 
                      value={editingStudent.password} 
                      onChange={e => setEditingStudent({...editingStudent, password: e.target.value})} 
                      className="w-full border rounded-lg p-2 text-sm" 
                    />
                  </div>
                </div>
              </div>
              <div className="flex gap-2 justify-end pt-4 border-t">
                <button 
                  type="button" 
                  onClick={() => setEditingStudent(null)} 
                  className="px-4 py-2 border rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50"
                >
                  Batal
                </button>
                <button 
                  type="submit" 
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-bold shadow-sm"
                >
                  Simpan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminPanel;
