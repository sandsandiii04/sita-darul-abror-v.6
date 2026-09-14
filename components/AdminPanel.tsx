import React, { useState, useRef, useMemo } from 'react';
import { User, Student, TahfidzRecord } from '../types';
import { 
  UserPlus, Trash2, Users, GraduationCap, School, Upload, 
  FileText, Download, Clipboard, ListPlus, BookOpen, Edit2,
  Search, Filter, X, ChevronDown, CheckSquare, Square, Phone,
  Eye, EyeOff, RotateCcw, ChevronLeft, ChevronRight, Check,
  ArrowUpDown, Layers, AlertCircle, Plus, MessageCircle, UserCheck, Shield
} from 'lucide-react';
import { validation } from '../api';

interface AdminPanelProps {
  users: User[];
  students: Student[];
  onAddUser: (user: User) => void;
  onDeleteUser: (id: string) => void;
  onUpdateUser?: (user: User) => void;
  onAddStudent: (student: Student) => void;
  onDeleteStudent: (id: string) => void;
  onUpdateStudent?: (student: Student) => void;
  // Bulk Props
  onBulkAddStudents: (students: Student[]) => void;
  onBulkAddUsers: (users: User[]) => void;
  onBulkAddRecords?: (records: TahfidzRecord[]) => void;
  onBulkDeleteStudents?: (ids: string[]) => void;
  onBulkUpdateStudents?: (students: Student[]) => void;
}

const AdminPanel: React.FC<AdminPanelProps> = ({ 
  users, students, onAddUser, onDeleteUser, onUpdateUser, onAddStudent, onDeleteStudent, onUpdateStudent,
  onBulkAddStudents, onBulkAddUsers, onBulkAddRecords, onBulkDeleteStudents, onBulkUpdateStudents
}) => {
  const [activeTab, setActiveTab] = useState<'santri' | 'guru' | 'hafalan'>('santri');
  const [inputMode, setInputMode] = useState<'single' | 'bulk'>('single');
  const [bulkText, setBulkText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Modals
  const [editingTeacher, setEditingTeacher] = useState<User | null>(null);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [isBulkReassignOpen, setIsBulkReassignOpen] = useState(false);
  const [viewingTeacherStudents, setViewingTeacherStudents] = useState<User | null>(null);

  // Form States - Santri
  const [newStudent, setNewStudent] = useState({ 
    name: '', 
    nis: '', 
    class: '', 
    halaqah: '', 
    teacherId: '', 
    username: '', 
    password: '' 
  });

  // Form States - Guru
  const [newUser, setNewUser] = useState({ 
    name: '', 
    username: '', 
    password: '', 
    childId: '', 
    phoneNumber: '', 
    gender: '' 
  });

  // Password Visibility Toggles
  const [showTeacherPass, setShowTeacherPass] = useState(false);
  const [showEditTeacherPass, setShowEditTeacherPass] = useState(false);
  const [showEditStudentPass, setShowEditStudentPass] = useState(false);

  // --- FILTER & SEARCH STATE (SANTRI) ---
  const [searchSantri, setSearchSantri] = useState('');
  const [filterClass, setFilterClass] = useState('all');
  const [filterHalaqah, setFilterHalaqah] = useState('all');
  const [filterTeacher, setFilterTeacher] = useState('all');
  const [sortSantriBy, setSortSantriBy] = useState<'name-asc' | 'name-desc' | 'nis-asc' | 'nis-desc' | 'class-asc' | 'juz-desc' | 'juz-asc'>('name-asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);

  // Bulk Reassign Form
  const [bulkReassignForm, setBulkReassignForm] = useState({
    targetClass: '',
    targetHalaqah: '',
    targetTeacherId: ''
  });

  // --- FILTER & SEARCH STATE (GURU) ---
  const [searchGuru, setSearchGuru] = useState('');
  const [filterTeacherGender, setFilterTeacherGender] = useState('all');
  const [filterTeacherLoad, setFilterTeacherLoad] = useState<'all' | 'has_students' | 'no_students'>('all');
  const [sortTeacherBy, setSortTeacherBy] = useState<'name-asc' | 'name-desc' | 'students-desc' | 'students-asc'>('name-asc');

  const teachers = useMemo(() => users.filter(u => u.role === 'teacher'), [users]);

  // Distinct Classes and Halaqahs for filter dropdowns & auto-complete
  const uniqueClasses = useMemo(() => {
    const set = new Set<string>();
    students.forEach(s => {
      if (s.class && s.class.trim() && s.class.trim() !== '-') set.add(s.class.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [students]);

  const uniqueHalaqahs = useMemo(() => {
    const set = new Set<string>();
    students.forEach(s => {
      if (s.halaqah && s.halaqah.trim() && s.halaqah.trim() !== '-') set.add(s.halaqah.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [students]);

  // Auto-suggest Halaqah based on teacher selection in Add Student Form
  const handleTeacherChange = (tId: string) => {
    let suggestedHalaqah = newStudent.halaqah;
    if (!suggestedHalaqah && tId) {
      const teacherStudents = students.filter(s => s.teacherId === tId && s.halaqah && s.halaqah !== '-');
      if (teacherStudents.length > 0) {
        // Cari halaqah terbanyak yang diampu guru ini
        const counts: Record<string, number> = {};
        teacherStudents.forEach(st => counts[st.halaqah] = (counts[st.halaqah] || 0) + 1);
        const topHalaqah = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
        if (topHalaqah) suggestedHalaqah = topHalaqah;
      }
    }
    setNewStudent(prev => ({ ...prev, teacherId: tId, halaqah: suggestedHalaqah }));
  };

  // Smart helper for adding Guru: auto detect Gender and suggest Username
  const handleTeacherNameChange = (name: string) => {
    let detectedGender = newUser.gender;
    const lower = name.toLowerCase();
    if (lower.includes('ustz') || lower.includes('ustadzah') || lower.includes('ummi') || lower.includes('ibu') || lower.includes('nyai')) {
      detectedGender = 'P';
    } else if (lower.includes('ust') || lower.includes('ustadz') || lower.includes('pak') || lower.includes('kyai')) {
      detectedGender = 'L';
    }

    let autoUsername = newUser.username;
    if (!autoUsername) {
      const clean = name.replace(/^(ust\.\s*|ustz\.\s*|ustadz\s*|ustadzah\s*|ummi\s*|pak\s*|ibu\s*)/gi, '').trim();
      if (clean) {
        autoUsername = clean.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').slice(0, 15);
      }
    }

    setNewUser(prev => ({
      ...prev,
      name,
      gender: detectedGender,
      username: autoUsername
    }));
  };

  // Phone helper (auto 628)
  const handlePhoneChange = (val: string) => {
    let cleaned = val.replace(/[^0-9]/g, '');
    if (cleaned.startsWith('08')) {
      cleaned = '628' + cleaned.substring(2);
    }
    setNewUser(prev => ({ ...prev, phoneNumber: cleaned }));
  };

  // --- FILTERED SANTRI ---
  const filteredStudents = useMemo(() => {
    return students.filter(student => {
      // Search
      if (searchSantri.trim()) {
        const q = searchSantri.toLowerCase().trim();
        const matchName = (student.name || '').toLowerCase().includes(q);
        const matchNis = (student.nis || '').toLowerCase().includes(q);
        const matchUser = (student.username || '').toLowerCase().includes(q);
        const matchHalaqah = (student.halaqah || '').toLowerCase().includes(q);
        const matchClass = (student.class || '').toLowerCase().includes(q);
        if (!matchName && !matchNis && !matchUser && !matchHalaqah && !matchClass) {
          return false;
        }
      }

      // Filter Kelas
      if (filterClass !== 'all' && student.class !== filterClass) {
        return false;
      }

      // Filter Halaqah
      if (filterHalaqah !== 'all' && student.halaqah !== filterHalaqah) {
        return false;
      }

      // Filter Guru
      if (filterTeacher !== 'all') {
        if (filterTeacher === 'no_teacher') {
          const teacherExists = teachers.some(t => t.id === student.teacherId);
          if (teacherExists && student.teacherId) return false;
        } else if (student.teacherId !== filterTeacher) {
          return false;
        }
      }

      return true;
    }).sort((a, b) => {
      switch (sortSantriBy) {
        case 'name-asc':
          return (a.name || '').localeCompare(b.name || '');
        case 'name-desc':
          return (b.name || '').localeCompare(a.name || '');
        case 'nis-asc':
          return (a.nis || '').localeCompare(b.nis || '', undefined, { numeric: true });
        case 'nis-desc':
          return (b.nis || '').localeCompare(a.nis || '', undefined, { numeric: true });
        case 'class-asc':
          return (a.class || '').localeCompare(b.class || '', undefined, { numeric: true });
        case 'juz-desc':
          return (b.totalJuz || 0) - (a.totalJuz || 0);
        case 'juz-asc':
          return (a.totalJuz || 0) - (b.totalJuz || 0);
        default:
          return 0;
      }
    });
  }, [students, searchSantri, filterClass, filterHalaqah, filterTeacher, sortSantriBy, teachers]);

  // Santri Pagination
  const totalSantriItems = filteredStudents.length;
  const totalSantriPages = perPage > 0 ? Math.ceil(totalSantriItems / perPage) : 1;
  const safeSantriPage = Math.min(Math.max(1, currentPage), totalSantriPages || 1);

  const paginatedStudents = useMemo(() => {
    if (perPage <= 0) return filteredStudents;
    const start = (safeSantriPage - 1) * perPage;
    return filteredStudents.slice(start, start + perPage);
  }, [filteredStudents, safeSantriPage, perPage]);

  // --- FILTERED GURU ---
  const filteredTeachers = useMemo(() => {
    return teachers.filter(t => {
      if (searchGuru.trim()) {
        const q = searchGuru.toLowerCase().trim();
        const matchName = (t.name || '').toLowerCase().includes(q);
        const matchUser = (t.username || '').toLowerCase().includes(q);
        const matchPhone = (t.phoneNumber || '').toLowerCase().includes(q);
        if (!matchName && !matchUser && !matchPhone) return false;
      }

      if (filterTeacherGender !== 'all' && t.gender !== filterTeacherGender) {
        return false;
      }

      const studentCount = students.filter(s => s.teacherId === t.id).length;
      if (filterTeacherLoad === 'has_students' && studentCount === 0) return false;
      if (filterTeacherLoad === 'no_students' && studentCount > 0) return false;

      return true;
    }).sort((a, b) => {
      const countA = students.filter(s => s.teacherId === a.id).length;
      const countB = students.filter(s => s.teacherId === b.id).length;
      switch (sortTeacherBy) {
        case 'name-asc':
          return (a.name || '').localeCompare(b.name || '');
        case 'name-desc':
          return (b.name || '').localeCompare(a.name || '');
        case 'students-desc':
          return countB - countA;
        case 'students-asc':
          return countA - countB;
        default:
          return 0;
      }
    });
  }, [teachers, students, searchGuru, filterTeacherGender, filterTeacherLoad, sortTeacherBy]);

  // Reset Filters
  const resetSantriFilters = () => {
    setSearchSantri('');
    setFilterClass('all');
    setFilterHalaqah('all');
    setFilterTeacher('all');
    setSortSantriBy('name-asc');
    setCurrentPage(1);
  };

  const isSantriFilterActive = searchSantri.trim() !== '' || filterClass !== 'all' || filterHalaqah !== 'all' || filterTeacher !== 'all' || sortSantriBy !== 'name-asc';

  const resetGuruFilters = () => {
    setSearchGuru('');
    setFilterTeacherGender('all');
    setFilterTeacherLoad('all');
    setSortTeacherBy('name-asc');
  };

  const isGuruFilterActive = searchGuru.trim() !== '' || filterTeacherGender !== 'all' || filterTeacherLoad !== 'all' || sortTeacherBy !== 'name-asc';

  // Multi-selection Handlers
  const handleSelectAllOnPage = () => {
    const pageIds = paginatedStudents.map(s => s.id);
    const isAllSelected = pageIds.every(id => selectedStudentIds.includes(id));
    if (isAllSelected) {
      setSelectedStudentIds(prev => prev.filter(id => !pageIds.includes(id)));
    } else {
      setSelectedStudentIds(prev => Array.from(new Set([...prev, ...pageIds])));
    }
  };

  const handleSelectAllFiltered = () => {
    setSelectedStudentIds(filteredStudents.map(s => s.id));
  };

  const handleToggleSelectStudent = (id: string) => {
    setSelectedStudentIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  // Bulk Delete
  const handleExecuteBulkDelete = () => {
    if (selectedStudentIds.length === 0) return;
    if (onBulkDeleteStudents) {
      onBulkDeleteStudents(selectedStudentIds);
      setSelectedStudentIds([]);
    } else {
      if (confirm(`Yakin ingin menghapus ${selectedStudentIds.length} santri terpilih?`)) {
        selectedStudentIds.forEach(id => onDeleteStudent(id));
        setSelectedStudentIds([]);
      }
    }
  };

  // Bulk Reassign Execute
  const handleExecuteBulkReassign = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedStudentIds.length === 0) return;

    const { targetClass, targetHalaqah, targetTeacherId } = bulkReassignForm;
    if (!targetClass && !targetHalaqah && !targetTeacherId) {
      alert("Pilih setidaknya satu perubahan (Kelas, Halaqah, atau Guru).");
      return;
    }

    const updatedStudentsList: Student[] = [];
    students.forEach(s => {
      if (selectedStudentIds.includes(s.id)) {
        const updated: Student = {
          ...s,
          class: targetClass.trim() !== '' ? targetClass.trim() : s.class,
          halaqah: targetHalaqah.trim() !== '' ? targetHalaqah.trim() : s.halaqah,
          teacherId: targetTeacherId !== '' ? targetTeacherId : s.teacherId
        };
        updatedStudentsList.push(updated);
      }
    });

    if (onBulkUpdateStudents) {
      onBulkUpdateStudents(updatedStudentsList);
    } else if (onUpdateStudent) {
      updatedStudentsList.forEach(s => onUpdateStudent(s));
    }

    alert(`Berhasil memperbarui data untuk ${updatedStudentsList.length} santri.`);
    setIsBulkReassignOpen(false);
    setSelectedStudentIds([]);
    setBulkReassignForm({ targetClass: '', targetHalaqah: '', targetTeacherId: '' });
  };

  // Single Add Handlers
  const handleAddStudent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStudent.name || !newStudent.nis || !newStudent.teacherId) {
      return alert("Mohon lengkapi data wajib (Nama, NIS, dan Guru Pembimbing).");
    }

    const nameCheck = validation.validateName(newStudent.name);
    if (!nameCheck.isValid) return alert(nameCheck.error);

    if (!/^\d+$/.test(newStudent.nis)) {
      return alert("NIS harus berupa angka saja.");
    }

    if (students.some(s => s.nis === newStudent.nis)) {
      return alert("NIS sudah terdaftar untuk santri lain.");
    }

    const studentUsername = (newStudent.username || newStudent.nis).trim();
    if (students.some(s => s.username?.toLowerCase() === studentUsername.toLowerCase()) || 
        users.some(u => u.username?.toLowerCase() === studentUsername.toLowerCase())) {
      return alert("Username sudah digunakan oleh santri atau guru lain.");
    }
    
    const student: Student = {
      id: 's' + Date.now(),
      name: newStudent.name.trim(),
      nis: newStudent.nis.trim(),
      class: newStudent.class.trim() || '-',
      halaqah: newStudent.halaqah.trim() || '-',
      teacherId: newStudent.teacherId,
      totalJuz: 0,
      username: studentUsername,
      password: newStudent.password || '123'
    };

    onAddStudent(student);
    setNewStudent({ name: '', nis: '', class: '', halaqah: '', teacherId: '', username: '', password: '' });
    alert(`Santri "${student.name}" berhasil ditambahkan.`);
  };

  const handleAddTeacher = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUser.name || !newUser.username || !newUser.password) {
      return alert("Mohon lengkapi data (Nama, Username, dan Password wajib diisi).");
    }

    const nameCheck = validation.validateName(newUser.name);
    if (!nameCheck.isValid) return alert(nameCheck.error);

    if (users.some(u => u.username?.toLowerCase() === newUser.username.toLowerCase()) || 
        students.some(s => s.username?.toLowerCase() === newUser.username.toLowerCase())) {
      return alert("Username sudah digunakan oleh guru atau santri lain.");
    }

    const phoneCheck = validation.validatePhone(newUser.phoneNumber);
    if (!phoneCheck.isValid) return alert(phoneCheck.error);

    const teacher: User = {
      id: 'u' + Date.now(),
      name: newUser.name.trim(),
      role: 'teacher',
      username: newUser.username.trim(),
      password: newUser.password,
      phoneNumber: phoneCheck.formatted,
      gender: (newUser.gender as 'L' | 'P') || undefined
    };

    onAddUser(teacher);
    setNewUser({ name: '', username: '', password: '', childId: '', phoneNumber: '', gender: '' });
    alert(`Guru "${teacher.name}" berhasil ditambahkan.`);
  };

  // Single Delete Teacher with safety check
  const handleDeleteTeacherClick = (teacher: User) => {
    const studentCount = students.filter(s => s.teacherId === teacher.id).length;
    if (studentCount > 0) {
      if (!confirm(`⚠️ PERHATIAN:\n\nUst./Ustz. "${teacher.name}" saat ini mengampu ${studentCount} orang santri.\n\nJika guru ini dihapus, santri-santri tersebut akan menjadi tanpa guru pembimbing.\n\nApakah Anda yakin ingin tetap menghapus guru ini?`)) {
        return;
      }
    }
    onDeleteUser(teacher.id);
  };

  // Bulk File & CSV Processing
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
    
    const batchStudents: Student[] = [];
    const batchUsers: User[] = [];
    const batchRecords: TahfidzRecord[] = [];
    
    const dataRows = lines.filter(line => line.trim() !== '');
    const startIdx = (dataRows[0]?.toLowerCase().includes('nama') || dataRows[0]?.toLowerCase().includes('username') || dataRows[0]?.toLowerCase().includes('nis')) ? 1 : 0;

    const errors: string[] = [];

    dataRows.slice(startIdx).forEach((row, index) => {
      const lineNum = startIdx + index + 1;
      const cols = row.split(/[,;\t]/).map(c => c.trim().replace(/^"|"$/g, ''));
      
      if (cols.length < 2) return;

      if (activeTab === 'santri') {
        const name = cols[0];
        const nis = cols[1];
        if (!name || name.length < 2) {
          errors.push(`Baris ${lineNum}: Nama santri '${name}' minimal 2 karakter.`);
          return;
        }
        const nameCheck = validation.validateName(name);
        if (!nameCheck.isValid) {
          errors.push(`Baris ${lineNum}: ${nameCheck.error}`);
          return;
        }
        if (!nis || !/^\d+$/.test(nis)) {
          errors.push(`Baris ${lineNum}: NIS '${nis}' harus berupa angka.`);
          return;
        }

        if (students.some(s => s.nis === nis) || batchStudents.some(s => s.nis === nis)) {
          errors.push(`Baris ${lineNum}: NIS '${nis}' sudah terdaftar.`);
          return;
        }

        const studentUsername = cols[1];
        if (students.some(s => s.username?.toLowerCase() === studentUsername.toLowerCase()) || 
            users.some(u => u.username?.toLowerCase() === studentUsername.toLowerCase()) ||
            batchStudents.some(s => s.username?.toLowerCase() === studentUsername.toLowerCase())) {
          errors.push(`Baris ${lineNum}: Username/NIS '${studentUsername}' sudah terdaftar.`);
          return;
        }

        const teacherInput = (cols[4] || '').trim().toLowerCase();
        const stripPrefix = (str: string) => str.replace(/^(ust\.\s*|ustz\.\s*|ustadz\s*|ustadzah\s*|ummi\s*)/gi, '').trim();
        const cleanInput = stripPrefix(teacherInput);

        const teacher = teachers.find(t => {
          const tUsername = (t.username || '').toLowerCase();
          const tName = t.name.toLowerCase();
          const cleanName = stripPrefix(tName);
          return tUsername === teacherInput || tName === teacherInput || cleanName === cleanInput;
        });
        
        const student: Student = {
          id: 's' + Math.random().toString(36).substr(2, 9) + Math.random().toString(36).substr(2, 5),
          name,
          nis,
          class: cols[2] || '-',
          halaqah: cols[3] || '-',
          teacherId: teacher ? teacher.id : (teachers[0]?.id || 'admin'),
          totalJuz: 0,
          username: studentUsername,
          password: cols[5] || '123'
        };
        batchStudents.push(student);
        successCount++;

      } else if (activeTab === 'guru') {
        const name = cols[0];
        const username = cols[1];
        const password = cols[2];
        const rawPhone = cols[3] || '';

        if (!name || name.length < 2) {
          errors.push(`Baris ${lineNum}: Nama guru '${name}' minimal 2 karakter.`);
          return;
        }
        const nameCheck = validation.validateName(name);
        if (!nameCheck.isValid) {
          errors.push(`Baris ${lineNum}: ${nameCheck.error}`);
          return;
        }
        if (!username || username.length < 2) {
          errors.push(`Baris ${lineNum}: Username '${username}' minimal 2 karakter.`);
          return;
        }
        if (!password || password.length < 3) {
          errors.push(`Baris ${lineNum}: Password harus minimal 3 karakter.`);
          return;
        }

        let phoneFormatted = '';
        if (rawPhone) {
          const phoneCheck = validation.validatePhone(rawPhone);
          if (!phoneCheck.isValid) {
            errors.push(`Baris ${lineNum}: ${phoneCheck.error}`);
            return;
          }
          phoneFormatted = phoneCheck.formatted;
        }

        const teacher: User = {
          id: 'u' + Math.random().toString(36).substr(2, 9) + Math.random().toString(36).substr(2, 5),
          name,
          role: 'teacher',
          username,
          password,
          phoneNumber: phoneFormatted
        };
        batchUsers.push(teacher);
        successCount++;

      } else if (activeTab === 'hafalan') {
        const nis = cols[0];
        const dateVal = cols[1];
        const typeVal = cols[2]?.toLowerCase() || '';
        const surah = cols[3];
        const start = parseInt(cols[4]);
        const end = parseInt(cols[5]);

        if (!nis) {
          errors.push(`Baris ${lineNum}: NIS kosong.`);
          return;
        }
        const student = students.find(s => s.nis === nis);
        if (!student) {
          errors.push(`Baris ${lineNum}: Santri dengan NIS '${nis}' tidak ditemukan.`);
          return;
        }
        if (!dateVal || !/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
          errors.push(`Baris ${lineNum}: Format tanggal '${dateVal}' salah (harus YYYY-MM-DD).`);
          return;
        }
        if (!['sabaq', 'sabqi', 'manzil', 'murojaah', 'ziyadah'].includes(typeVal)) {
          errors.push(`Baris ${lineNum}: Tipe hafalan '${typeVal}' tidak valid. Harus sabaq/sabqi/manzil/murojaah/ziyadah.`);
          return;
        }
        if (!surah) {
          errors.push(`Baris ${lineNum}: Nama surat kosong.`);
          return;
        }
        if (isNaN(start) || start <= 0) {
          errors.push(`Baris ${lineNum}: Ayat Mulai harus berupa angka positif.`);
          return;
        }
        if (isNaN(end) || end < start) {
          errors.push(`Baris ${lineNum}: Ayat Akhir tidak boleh lebih kecil dari Ayat Mulai.`);
          return;
        }

        const record: TahfidzRecord = {
          id: 'r' + Math.random().toString(36).substr(2, 9),
          studentId: student.id,
          date: dateVal,
          type: typeVal as any,
          surah,
          ayahStart: start,
          ayahEnd: end,
          grade: cols[6] ? cols[6].trim() : '100',
          notes: cols[7] || ''
        };
        batchRecords.push(record);
        successCount++;
      }
    });

    if (errors.length > 0) {
      alert(`Ditemukan ${errors.length} kesalahan format pada data massal:\n\n` + errors.slice(0, 5).join('\n') + (errors.length > 5 ? `\n...dan ${errors.length - 5} baris bermasalah lainnya.` : '') + `\n\nImpor dibatalkan demi keamanan database.`);
      return;
    }

    if (activeTab === 'santri' && batchStudents.length > 0) {
      onBulkAddStudents(batchStudents);
    } else if (activeTab === 'guru' && batchUsers.length > 0) {
      onBulkAddUsers(batchUsers);
    } else if (activeTab === 'hafalan' && batchRecords.length > 0 && onBulkAddRecords) {
      onBulkAddRecords(batchRecords);
    }

    if (successCount > 0) {
      alert(`Berhasil mengimpor ${successCount} data ${activeTab}.`);
      setBulkText('');
    } else {
      alert("Gagal memproses data. Pastikan format kolom sesuai.");
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

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      {/* Top Navigation Tabs */}
      <div className="flex bg-white rounded-xl shadow-sm border border-gray-100 p-1.5 gap-1.5">
        <button
          onClick={() => { setActiveTab('santri'); setSelectedStudentIds([]); }}
          className={`flex-1 py-3 px-3 rounded-lg flex items-center justify-center gap-2 font-semibold transition-all text-sm ${
            activeTab === 'santri' 
              ? 'bg-emerald-600 text-white shadow-md' 
              : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          <GraduationCap size={18} />
          <span>Data Santri</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
            activeTab === 'santri' ? 'bg-emerald-700 text-white' : 'bg-gray-100 text-gray-600'
          }`}>
            {students.length}
          </span>
        </button>

        <button
          onClick={() => { setActiveTab('guru'); }}
          className={`flex-1 py-3 px-3 rounded-lg flex items-center justify-center gap-2 font-semibold transition-all text-sm ${
            activeTab === 'guru' 
              ? 'bg-emerald-600 text-white shadow-md' 
              : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          <School size={18} />
          <span>Data Guru Halaqah</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
            activeTab === 'guru' ? 'bg-emerald-700 text-white' : 'bg-gray-100 text-gray-600'
          }`}>
            {teachers.length}
          </span>
        </button>

        <button
          onClick={() => { setActiveTab('hafalan'); setInputMode('bulk'); }}
          className={`flex-1 py-3 px-3 rounded-lg flex items-center justify-center gap-2 font-semibold transition-all text-sm ${
            activeTab === 'hafalan' 
              ? 'bg-emerald-600 text-white shadow-md' 
              : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          <BookOpen size={18} />
          <span>Data Hafalan (Massal)</span>
        </button>
      </div>

      {/* Datalists for Auto-Complete */}
      <datalist id="classListOptions">
        {uniqueClasses.map(cls => <option key={cls} value={cls} />)}
      </datalist>
      <datalist id="halaqahListOptions">
        {uniqueHalaqahs.map(hal => <option key={hal} value={hal} />)}
      </datalist>

      {/* Main Grid: Form Left, List & Filters Right */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        
        {/* ================= LEFT COLUMN: INPUT / FORM PANEL ================= */}
        <div className="xl:col-span-4 bg-white p-5 lg:p-6 rounded-2xl shadow-sm border border-gray-100 h-fit">
          <div className="flex justify-between items-center mb-5 pb-3 border-b border-gray-100">
            <div>
              <h3 className="font-bold text-gray-800 flex items-center gap-2 text-base">
                {inputMode === 'single' ? <UserPlus className="text-emerald-600" size={19} /> : <ListPlus className="text-emerald-600" size={19} />}
                <span>{inputMode === 'single' ? 'Tambah Data Baru' : 'Impor Data Massal'}</span>
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {activeTab === 'santri' ? 'Santri' : activeTab === 'guru' ? 'Guru Halaqah' : 'Hafalan'}
              </p>
            </div>

            <div className="flex bg-gray-100 p-1 rounded-lg text-xs font-semibold">
              {activeTab !== 'hafalan' && (
                <button 
                  onClick={() => setInputMode('single')}
                  className={`px-3 py-1.5 rounded-md transition-all ${
                    inputMode === 'single' ? 'bg-white shadow-sm text-emerald-700' : 'text-gray-500 hover:text-gray-800'
                  }`}
                >
                  Satuan
                </button>
              )}
              <button 
                onClick={() => setInputMode('bulk')}
                className={`px-3 py-1.5 rounded-md transition-all ${
                  inputMode === 'bulk' ? 'bg-white shadow-sm text-emerald-700' : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                Massal
              </button>
            </div>
          </div>
          
          {inputMode === 'bulk' ? (
            <div className="space-y-4 animate-fade-in">
              <div className="bg-emerald-50/70 p-3.5 rounded-xl border border-emerald-100 text-xs">
                <p className="font-bold text-emerald-800 mb-1 flex items-center gap-1.5">
                  <Clipboard size={14}/> Petunjuk Input Massal:
                </p>
                <p className="text-emerald-700 mb-2">
                  Salin (Copy) data dari Excel atau Google Sheets lalu Tempel (Paste) di bawah.
                </p>
                <div className="bg-white p-2 rounded-lg border border-emerald-200 font-mono text-[11px] text-gray-600 overflow-x-auto leading-relaxed">
                  Format: {getTemplateFormat()}
                </div>
              </div>

              <div>
                <textarea
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder={`Contoh data Excel:\n${getExampleData()}`}
                  className="w-full h-48 p-3 border border-gray-200 rounded-xl text-xs font-mono focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none resize-none leading-relaxed"
                />
              </div>

              <button 
                onClick={handleBulkSubmit}
                disabled={!bulkText.trim()}
                className="w-full bg-emerald-600 text-white py-2.5 rounded-xl font-bold text-sm hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-emerald-600/20 transition-all"
              >
                Proses & Simpan Data Massal
              </button>

              <div className="relative flex py-1 items-center">
                <div className="flex-grow border-t border-gray-200"></div>
                <span className="flex-shrink-0 mx-3 text-xs text-gray-400">atau gunakan berkas CSV</span>
                <div className="flex-grow border-t border-gray-200"></div>
              </div>

              <div className="flex gap-2">
                <button 
                  onClick={getCSVTemplate} 
                  className="flex-1 bg-white border border-gray-200 text-gray-700 text-xs py-2 rounded-xl hover:bg-gray-50 flex items-center justify-center gap-1.5 font-medium transition-all"
                >
                  <Download size={14} className="text-emerald-600" /> Unduh Template
                </button>
                <button 
                  onClick={() => fileInputRef.current?.click()} 
                  className="flex-1 bg-gray-50 text-gray-700 border border-gray-200 text-xs py-2 rounded-xl hover:bg-gray-100 flex items-center justify-center gap-1.5 font-medium transition-all"
                >
                  <Upload size={14} className="text-blue-600" /> Unggah CSV
                </button>
                <input type="file" accept=".csv" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
              </div>
            </div>
          ) : (
            <div className="animate-fade-in">
              {/* Form Tambah Santri */}
              {activeTab === 'santri' && (
                <form onSubmit={handleAddStudent} className="space-y-3.5">
                  <div>
                    <label className="text-xs font-bold text-gray-700 block mb-1">
                      Nama Lengkap Santri <span className="text-red-500">*</span>
                    </label>
                    <input 
                      type="text" 
                      className="w-full border border-gray-300 rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all" 
                      value={newStudent.name} 
                      onChange={e => setNewStudent({...newStudent, name: e.target.value})} 
                      required 
                      placeholder="Contoh: Muhammad Ali" 
                    />
                  </div>

                  <div>
                    <label className="text-xs font-bold text-gray-700 block mb-1">
                      NIS (Nomor Induk Santri) <span className="text-red-500">*</span>
                    </label>
                    <input 
                      type="text" 
                      inputMode="numeric"
                      className="w-full border border-gray-300 rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all" 
                      value={newStudent.nis} 
                      onChange={e => setNewStudent({...newStudent, nis: e.target.value.replace(/[^0-9]/g, '')})} 
                      required 
                      placeholder="Contoh: 2024001" 
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="text-xs font-bold text-gray-700 block mb-1">Kelas</label>
                      <input 
                        type="text" 
                        list="classListOptions"
                        className="w-full border border-gray-300 rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all" 
                        value={newStudent.class} 
                        onChange={e => setNewStudent({...newStudent, class: e.target.value})} 
                        placeholder="7A, 8B..." 
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-gray-700 block mb-1">Halaqah</label>
                      <input 
                        type="text" 
                        list="halaqahListOptions"
                        className="w-full border border-gray-300 rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all" 
                        value={newStudent.halaqah} 
                        onChange={e => setNewStudent({...newStudent, halaqah: e.target.value})} 
                        placeholder="Halaqah 1..." 
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-gray-700 block mb-1">
                      Guru Pembimbing <span className="text-red-500">*</span>
                    </label>
                    <select 
                      className="w-full border border-gray-300 rounded-xl p-2.5 text-sm bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all" 
                      value={newStudent.teacherId} 
                      onChange={e => handleTeacherChange(e.target.value)} 
                      required
                    >
                      <option value="">Pilih Guru Halaqah...</option>
                      {teachers.map(t => (
                        <option key={t.id} value={t.id}>
                          {t.name} {t.gender ? `(${t.gender === 'L' ? 'Ust.' : 'Ustz.'})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="pt-3 border-t border-gray-100 bg-gray-50/70 p-3 rounded-xl space-y-2.5">
                    <p className="text-xs font-bold text-emerald-800 flex items-center gap-1.5">
                      <Shield size={14} /> Akun Login Santri / Wali
                    </p>
                    <div>
                      <label className="text-[11px] font-medium text-gray-500">Username (Opsional)</label>
                      <input 
                        type="text" 
                        className="w-full border border-gray-300 rounded-lg p-2 text-xs bg-white focus:ring-2 focus:ring-emerald-500 outline-none" 
                        value={newStudent.username} 
                        onChange={e => setNewStudent({...newStudent, username: e.target.value})} 
                        placeholder="Default otomatis sama dengan NIS" 
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-gray-500">Password (Opsional)</label>
                      <input 
                        type="text" 
                        className="w-full border border-gray-300 rounded-lg p-2 text-xs bg-white focus:ring-2 focus:ring-emerald-500 outline-none" 
                        value={newStudent.password} 
                        onChange={e => setNewStudent({...newStudent, password: e.target.value})} 
                        placeholder="Default: 123" 
                      />
                    </div>
                  </div>

                  <button 
                    type="submit" 
                    className="w-full bg-emerald-600 text-white py-2.5 rounded-xl font-bold text-sm hover:bg-emerald-700 shadow-md shadow-emerald-600/20 transition-all flex items-center justify-center gap-2 mt-2"
                  >
                    <Plus size={16} /> Simpan Data Santri
                  </button>
                </form>
              )}

              {/* Form Tambah Guru */}
              {activeTab === 'guru' && (
                <form onSubmit={handleAddTeacher} className="space-y-3.5">
                  <div>
                    <label className="text-xs font-bold text-gray-700 block mb-1">
                      Nama Guru / Ustadz / Ustadzah <span className="text-red-500">*</span>
                    </label>
                    <input 
                      type="text" 
                      className="w-full border border-gray-300 rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all" 
                      value={newUser.name} 
                      onChange={e => handleTeacherNameChange(e.target.value)} 
                      required 
                      placeholder="Contoh: Ust. Ahmad Fauzi" 
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="text-xs font-bold text-gray-700 block mb-1">Gender</label>
                      <select 
                        value={newUser.gender || ''} 
                        onChange={e => setNewUser({...newUser, gender: e.target.value})} 
                        className="w-full border border-gray-300 rounded-xl p-2.5 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                      >
                        <option value="">Deteksi Otomatis</option>
                        <option value="L">Laki-laki (Ust.)</option>
                        <option value="P">Perempuan (Ustz.)</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-xs font-bold text-gray-700 block mb-1">WhatsApp</label>
                      <input 
                        type="text" 
                        inputMode="numeric"
                        className="w-full border border-gray-300 rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none transition-all" 
                        value={newUser.phoneNumber} 
                        onChange={e => handlePhoneChange(e.target.value)} 
                        placeholder="0812... / 628..." 
                      />
                    </div>
                  </div>

                  <div className="pt-2 border-t border-gray-100 space-y-3">
                    <div>
                      <label className="text-xs font-bold text-gray-700 block mb-1">
                        Username Login <span className="text-red-500">*</span>
                      </label>
                      <input 
                        type="text" 
                        className="w-full border border-gray-300 rounded-xl p-2.5 text-sm font-mono focus:ring-2 focus:ring-emerald-500 outline-none transition-all" 
                        value={newUser.username} 
                        onChange={e => setNewUser({...newUser, username: e.target.value})} 
                        required 
                        placeholder="guru_ahmad" 
                      />
                    </div>

                    <div>
                      <label className="text-xs font-bold text-gray-700 block mb-1">
                        Password <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <input 
                          type={showTeacherPass ? "text" : "password"} 
                          className="w-full border border-gray-300 rounded-xl p-2.5 text-sm pr-10 focus:ring-2 focus:ring-emerald-500 outline-none transition-all" 
                          value={newUser.password} 
                          onChange={e => setNewUser({...newUser, password: e.target.value})} 
                          required 
                          placeholder="Minimal 3 karakter" 
                        />
                        <button
                          type="button"
                          onClick={() => setShowTeacherPass(!showTeacherPass)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        >
                          {showTeacherPass ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </div>
                  </div>

                  <button 
                    type="submit" 
                    className="w-full bg-emerald-600 text-white py-2.5 rounded-xl font-bold text-sm hover:bg-emerald-700 shadow-md shadow-emerald-600/20 transition-all flex items-center justify-center gap-2 mt-3"
                  >
                    <Plus size={16} /> Simpan Data Guru
                  </button>
                </form>
              )}
            </div>
          )}
        </div>

        {/* ================= RIGHT COLUMN: DATA LIST & FILTERS ================= */}
        <div className="xl:col-span-8 space-y-4">
          
          {/* TAB SANTRI CONTENT */}
          {activeTab === 'santri' && (
            <div className="bg-white p-5 lg:p-6 rounded-2xl shadow-sm border border-gray-100 space-y-4">
              
              {/* Header & Stats Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-gray-100">
                <div>
                  <h3 className="font-bold text-lg text-gray-800 flex items-center gap-2">
                    <GraduationCap className="text-emerald-600" size={22} />
                    <span>Daftar Data Santri</span>
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Kelola data, filter berdasarkan kelas / halaqah, dan ubah guru pembimbing santri
                  </p>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <span className="bg-gray-100 text-gray-700 px-2.5 py-1 rounded-lg font-medium">
                    Total: <b>{students.length}</b>
                  </span>
                  <span className="bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-lg font-medium">
                    Tersaring: <b>{filteredStudents.length}</b>
                  </span>
                </div>
              </div>

              {/* FILTER TOOLBAR */}
              <div className="bg-gray-50/80 p-3.5 rounded-xl border border-gray-200/80 space-y-3">
                {/* Search Bar & Sort */}
                <div className="flex flex-col sm:flex-row gap-2.5">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                    <input 
                      type="text"
                      value={searchSantri}
                      onChange={e => { setSearchSantri(e.target.value); setCurrentPage(1); }}
                      placeholder="Cari nama santri, NIS, username, kelas, halaqah..."
                      className="w-full pl-9 pr-8 py-2 bg-white border border-gray-200 rounded-lg text-xs md:text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                    />
                    {searchSantri && (
                      <button 
                        onClick={() => { setSearchSantri(''); setCurrentPage(1); }}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        <X size={15} />
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-600">
                      <ArrowUpDown size={14} className="text-gray-400" />
                      <select 
                        value={sortSantriBy}
                        onChange={e => setSortSantriBy(e.target.value as any)}
                        className="bg-transparent font-medium outline-none cursor-pointer text-xs"
                      >
                        <option value="name-asc">Nama (A - Z)</option>
                        <option value="name-desc">Nama (Z - A)</option>
                        <option value="nis-asc">NIS (Urut)</option>
                        <option value="class-asc">Kelas</option>
                        <option value="juz-desc">Capaian Juz (Tertinggi)</option>
                        <option value="juz-asc">Capaian Juz (Terendah)</option>
                      </select>
                    </div>

                    {isSantriFilterActive && (
                      <button 
                        onClick={resetSantriFilters}
                        title="Reset Filter"
                        className="p-2 bg-white border border-amber-200 text-amber-600 hover:bg-amber-50 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all shadow-sm"
                      >
                        <RotateCcw size={14} />
                        <span className="hidden sm:inline">Reset</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Filter Dropdowns */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                  {/* Filter Kelas */}
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block mb-1">
                      Filter Kelas
                    </label>
                    <select
                      value={filterClass}
                      onChange={e => { setFilterClass(e.target.value); setCurrentPage(1); }}
                      className={`w-full p-2 rounded-lg text-xs border transition-all ${
                        filterClass !== 'all' 
                          ? 'border-emerald-500 bg-emerald-50/50 text-emerald-800 font-bold' 
                          : 'border-gray-200 bg-white text-gray-700'
                      }`}
                    >
                      <option value="all">Semua Kelas ({uniqueClasses.length})</option>
                      {uniqueClasses.map(cls => (
                        <option key={cls} value={cls}>Kelas {cls}</option>
                      ))}
                    </select>
                  </div>

                  {/* Filter Halaqah */}
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block mb-1">
                      Filter Halaqah
                    </label>
                    <select
                      value={filterHalaqah}
                      onChange={e => { setFilterHalaqah(e.target.value); setCurrentPage(1); }}
                      className={`w-full p-2 rounded-lg text-xs border transition-all ${
                        filterHalaqah !== 'all' 
                          ? 'border-emerald-500 bg-emerald-50/50 text-emerald-800 font-bold' 
                          : 'border-gray-200 bg-white text-gray-700'
                      }`}
                    >
                      <option value="all">Semua Halaqah ({uniqueHalaqahs.length})</option>
                      {uniqueHalaqahs.map(hal => (
                        <option key={hal} value={hal}>{hal}</option>
                      ))}
                    </select>
                  </div>

                  {/* Filter Guru Pembimbing */}
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block mb-1">
                      Filter Guru Pembimbing
                    </label>
                    <select
                      value={filterTeacher}
                      onChange={e => { setFilterTeacher(e.target.value); setCurrentPage(1); }}
                      className={`w-full p-2 rounded-lg text-xs border transition-all ${
                        filterTeacher !== 'all' 
                          ? 'border-emerald-500 bg-emerald-50/50 text-emerald-800 font-bold' 
                          : 'border-gray-200 bg-white text-gray-700'
                      }`}
                    >
                      <option value="all">Semua Guru ({teachers.length})</option>
                      <option value="no_teacher">⚠️ Belum Ada Guru</option>
                      {teachers.map(t => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({students.filter(s => s.teacherId === t.id).length} santri)
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* MULTI-SELECT BULK ACTIONS BAR */}
              {selectedStudentIds.length > 0 && (
                <div className="bg-emerald-700 text-white p-3 rounded-xl flex flex-wrap items-center justify-between gap-3 shadow-lg animate-fade-in">
                  <div className="flex items-center gap-3">
                    <span className="bg-emerald-900/60 text-white text-xs px-2.5 py-1 rounded-lg font-bold">
                      {selectedStudentIds.length} Santri Terpilih
                    </span>
                    {selectedStudentIds.length < filteredStudents.length && (
                      <button 
                        onClick={handleSelectAllFiltered}
                        className="text-xs text-emerald-200 hover:text-white underline"
                      >
                        Pilih semua {filteredStudents.length} santri hasil filter
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setIsBulkReassignOpen(true)}
                      className="bg-white text-emerald-800 hover:bg-emerald-50 px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm"
                    >
                      <Layers size={14} /> Pindah Kelas / Halaqah / Guru
                    </button>
                    <button
                      onClick={handleExecuteBulkDelete}
                      className="bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm"
                    >
                      <Trash2 size={14} /> Hapus Terpilih
                    </button>
                    <button
                      onClick={() => setSelectedStudentIds([])}
                      className="bg-emerald-800 hover:bg-emerald-900 text-white px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
                    >
                      Batal
                    </button>
                  </div>
                </div>
              )}

              {/* TABLE CONTAINER */}
              <div className="overflow-x-auto border border-gray-100 rounded-xl">
                <table className="w-full text-left border-collapse min-w-[640px]">
                  <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 text-xs">
                    <tr>
                      <th className="p-3 w-10 text-center">
                        <button 
                          onClick={handleSelectAllOnPage}
                          className="text-gray-400 hover:text-emerald-600 transition-colors"
                          title="Pilih Semua di Halaman Ini"
                        >
                          {paginatedStudents.length > 0 && paginatedStudents.every(s => selectedStudentIds.includes(s.id)) ? (
                            <CheckSquare size={18} className="text-emerald-600" />
                          ) : (
                            <Square size={18} />
                          )}
                        </button>
                      </th>
                      <th className="p-3 font-semibold">Nama Santri & NIS</th>
                      <th className="p-3 font-semibold">Kelas / Halaqah</th>
                      <th className="p-3 font-semibold">Guru Pembimbing</th>
                      <th className="p-3 font-semibold">Capaian Juz</th>
                      <th className="p-3 font-semibold">Akun Login</th>
                      <th className="p-3 font-semibold text-center w-24">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-xs">
                    {paginatedStudents.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-8 text-center text-gray-400">
                          <AlertCircle className="mx-auto mb-2 text-gray-300" size={36} />
                          <p className="font-semibold text-gray-600">Tidak ada santri yang sesuai</p>
                          <p className="text-xs text-gray-400 mt-1">Coba sesuaikan kata kunci pencarian atau ubah filter.</p>
                          {isSantriFilterActive && (
                            <button 
                              onClick={resetSantriFilters}
                              className="mt-3 inline-flex items-center gap-1.5 text-xs text-emerald-600 hover:text-emerald-700 font-bold bg-emerald-50 px-3 py-1.5 rounded-lg"
                            >
                              <RotateCcw size={13} /> Reset Semua Filter
                            </button>
                          )}
                        </td>
                      </tr>
                    ) : (
                      paginatedStudents.map(student => {
                        const isSelected = selectedStudentIds.includes(student.id);
                        const teacher = teachers.find(u => u.id === student.teacherId);

                        return (
                          <tr 
                            key={student.id} 
                            className={`hover:bg-emerald-50/40 transition-colors ${
                              isSelected ? 'bg-emerald-50/60' : ''
                            }`}
                          >
                            {/* Checkbox */}
                            <td className="p-3 text-center">
                              <button 
                                onClick={() => handleToggleSelectStudent(student.id)}
                                className="text-gray-400 hover:text-emerald-600 transition-colors"
                              >
                                {isSelected ? (
                                  <CheckSquare size={17} className="text-emerald-600" />
                                ) : (
                                  <Square size={17} />
                                )}
                              </button>
                            </td>

                            {/* Nama & NIS */}
                            <td className="p-3">
                              <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs shrink-0">
                                  {student.name.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                  <span className="font-bold text-gray-800 block text-xs md:text-sm">
                                    {student.name}
                                  </span>
                                  <span className="text-[11px] text-gray-400 font-mono">
                                    NIS: {student.nis}
                                  </span>
                                </div>
                              </div>
                            </td>

                            {/* Kelas / Halaqah */}
                            <td className="p-3">
                              <div className="flex flex-col gap-1 items-start">
                                <span className="inline-block bg-blue-50 text-blue-700 text-[11px] font-semibold px-2 py-0.5 rounded-md border border-blue-100">
                                  Kelas {student.class || '-'}
                                </span>
                                <span className="inline-block bg-gray-100 text-gray-700 text-[11px] font-medium px-2 py-0.5 rounded-md">
                                  {student.halaqah || '-'}
                                </span>
                              </div>
                            </td>

                            {/* Guru Pembimbing */}
                            <td className="p-3">
                              {teacher ? (
                                <div>
                                  <span className="font-semibold text-emerald-700 block">
                                    {teacher.name}
                                  </span>
                                  {teacher.phoneNumber && (
                                    <span className="text-[10px] text-gray-400">
                                      {teacher.phoneNumber}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="inline-block bg-amber-50 text-amber-700 text-[10px] font-bold px-2 py-0.5 rounded-md border border-amber-200">
                                  ⚠️ Belum Ditugaskan
                                </span>
                              )}
                            </td>

                            {/* Capaian Juz */}
                            <td className="p-3">
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-gray-700 bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-md text-xs font-mono">
                                  {student.totalJuz || 0} Juz
                                </span>
                              </div>
                            </td>

                            {/* Akun Login */}
                            <td className="p-3">
                              <div className="space-y-0.5">
                                <div className="text-[11px] text-gray-600 font-mono">
                                  user: <b>{student.username || student.nis}</b>
                                </div>
                                <div className="text-[10px] text-gray-400 font-mono">
                                  pass: {student.password || '123'}
                                </div>
                              </div>
                            </td>

                            {/* Aksi */}
                            <td className="p-3 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <button 
                                  onClick={() => setEditingStudent(student)} 
                                  className="p-1.5 text-gray-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-all" 
                                  title="Edit Santri"
                                >
                                  <Edit2 size={15} />
                                </button>
                                <button 
                                  onClick={() => onDeleteStudent(student.id)} 
                                  className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all" 
                                  title="Hapus Santri"
                                >
                                  <Trash2 size={15} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* PAGINATION CONTROLS */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 text-xs text-gray-500">
                <div className="flex items-center gap-2">
                  <span>Tampilkan per halaman:</span>
                  <select
                    value={perPage}
                    onChange={e => { setPerPage(parseInt(e.target.value)); setCurrentPage(1); }}
                    className="border border-gray-200 rounded-lg p-1.5 bg-white text-xs outline-none font-semibold"
                  >
                    <option value={20}>20</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={0}>Semua ({filteredStudents.length})</option>
                  </select>
                  <span>
                    Menampilkan <b>{filteredStudents.length > 0 ? (perPage > 0 ? (safeSantriPage - 1) * perPage + 1 : 1) : 0}</b> - <b>{perPage > 0 ? Math.min(safeSantriPage * perPage, filteredStudents.length) : filteredStudents.length}</b> dari <b>{filteredStudents.length}</b> santri
                  </span>
                </div>

                {perPage > 0 && totalSantriPages > 1 && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                      disabled={safeSantriPage <= 1}
                      className="p-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Halaman Sebelumnya"
                    >
                      <ChevronLeft size={16} />
                    </button>

                    <span className="px-3 py-1 font-bold text-gray-700 bg-gray-100 rounded-lg">
                      {safeSantriPage} / {totalSantriPages}
                    </span>

                    <button
                      onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalSantriPages))}
                      disabled={safeSantriPage >= totalSantriPages}
                      className="p-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Halaman Berikutnya"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB GURU CONTENT */}
          {activeTab === 'guru' && (
            <div className="bg-white p-5 lg:p-6 rounded-2xl shadow-sm border border-gray-100 space-y-4">
              
              {/* Header & Stats Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-gray-100">
                <div>
                  <h3 className="font-bold text-lg text-gray-800 flex items-center gap-2">
                    <School className="text-emerald-600" size={22} />
                    <span>Daftar Guru Halaqah</span>
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Kelola data pengampu halaqah, akun login, dan pantau jumlah santri yang diampu
                  </p>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <span className="bg-gray-100 text-gray-700 px-2.5 py-1 rounded-lg font-medium">
                    Total: <b>{teachers.length}</b> Guru
                  </span>
                  <span className="bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-lg font-medium">
                    Santri Terbimbing: <b>{students.filter(s => s.teacherId && s.teacherId !== 'admin').length}</b>
                  </span>
                </div>
              </div>

              {/* FILTER TOOLBAR GURU */}
              <div className="bg-gray-50/80 p-3.5 rounded-xl border border-gray-200/80 space-y-3">
                <div className="flex flex-col sm:flex-row gap-2.5">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                    <input 
                      type="text"
                      value={searchGuru}
                      onChange={e => setSearchGuru(e.target.value)}
                      placeholder="Cari nama guru, username, nomor WhatsApp..."
                      className="w-full pl-9 pr-8 py-2 bg-white border border-gray-200 rounded-lg text-xs md:text-sm focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                    />
                    {searchGuru && (
                      <button 
                        onClick={() => setSearchGuru('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        <X size={15} />
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-600">
                      <ArrowUpDown size={14} className="text-gray-400" />
                      <select 
                        value={sortTeacherBy}
                        onChange={e => setSortTeacherBy(e.target.value as any)}
                        className="bg-transparent font-medium outline-none cursor-pointer text-xs"
                      >
                        <option value="name-asc">Nama (A - Z)</option>
                        <option value="name-desc">Nama (Z - A)</option>
                        <option value="students-desc">Santri (Terbanyak)</option>
                        <option value="students-asc">Santri (Tersedikit)</option>
                      </select>
                    </div>

                    {isGuruFilterActive && (
                      <button 
                        onClick={resetGuruFilters}
                        title="Reset Filter"
                        className="p-2 bg-white border border-amber-200 text-amber-600 hover:bg-amber-50 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all shadow-sm"
                      >
                        <RotateCcw size={14} />
                        <span className="hidden sm:inline">Reset</span>
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block mb-1">
                      Filter Gender
                    </label>
                    <select
                      value={filterTeacherGender}
                      onChange={e => setFilterTeacherGender(e.target.value)}
                      className={`w-full p-2 rounded-lg text-xs border transition-all ${
                        filterTeacherGender !== 'all' 
                          ? 'border-emerald-500 bg-emerald-50/50 text-emerald-800 font-bold' 
                          : 'border-gray-200 bg-white text-gray-700'
                      }`}
                    >
                      <option value="all">Semua Gender</option>
                      <option value="L">Laki-laki (Ustadz)</option>
                      <option value="P">Perempuan (Ustadzah)</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block mb-1">
                      Filter Beban Halaqah
                    </label>
                    <select
                      value={filterTeacherLoad}
                      onChange={e => setFilterTeacherLoad(e.target.value as any)}
                      className={`w-full p-2 rounded-lg text-xs border transition-all ${
                        filterTeacherLoad !== 'all' 
                          ? 'border-emerald-500 bg-emerald-50/50 text-emerald-800 font-bold' 
                          : 'border-gray-200 bg-white text-gray-700'
                      }`}
                    >
                      <option value="all">Semua Status</option>
                      <option value="has_students">Sedang Mengampu Santri</option>
                      <option value="no_students">Belum Ada Santri</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* TABLE GURU */}
              <div className="overflow-x-auto border border-gray-100 rounded-xl">
                <table className="w-full text-left border-collapse min-w-[560px]">
                  <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 text-xs">
                    <tr>
                      <th className="p-3 font-semibold">Nama Guru</th>
                      <th className="p-3 font-semibold">WhatsApp</th>
                      <th className="p-3 font-semibold">Akun Login</th>
                      <th className="p-3 font-semibold text-center">Santri Diampu</th>
                      <th className="p-3 font-semibold text-center w-24">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-xs">
                    {filteredTeachers.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-8 text-center text-gray-400">
                          <AlertCircle className="mx-auto mb-2 text-gray-300" size={36} />
                          <p className="font-semibold text-gray-600">Tidak ada guru yang sesuai</p>
                          <p className="text-xs text-gray-400 mt-1">Coba sesuaikan kata kunci pencarian.</p>
                        </td>
                      </tr>
                    ) : (
                      filteredTeachers.map(teacher => {
                        const assignedStudents = students.filter(s => s.teacherId === teacher.id);

                        return (
                          <tr key={teacher.id} className="hover:bg-emerald-50/40 transition-colors">
                            {/* Nama & Gender */}
                            <td className="p-3 font-medium">
                              <div className="flex items-center gap-2.5">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                                  teacher.gender === 'P' ? 'bg-pink-100 text-pink-700' : 'bg-emerald-100 text-emerald-700'
                                }`}>
                                  {teacher.name.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-bold text-gray-800 text-xs md:text-sm">
                                      {teacher.name}
                                    </span>
                                    {teacher.gender && (
                                      <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded uppercase ${
                                        teacher.gender === 'L' ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-pink-50 text-pink-700 border border-pink-200'
                                      }`}>
                                        {teacher.gender === 'L' ? 'Ust.' : 'Ustz.'}
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-[11px] text-gray-400 font-mono">
                                    ID: {teacher.id}
                                  </span>
                                </div>
                              </div>
                            </td>

                            {/* WhatsApp */}
                            <td className="p-3">
                              {teacher.phoneNumber ? (
                                <a 
                                  href={`https://wa.me/${teacher.phoneNumber}`} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-emerald-600 hover:text-emerald-700 hover:underline font-mono text-xs font-semibold bg-emerald-50 px-2 py-1 rounded-md"
                                  title="Buka WhatsApp"
                                >
                                  <MessageCircle size={13} /> {teacher.phoneNumber}
                                </a>
                              ) : (
                                <span className="text-gray-400">-</span>
                              )}
                            </td>

                            {/* Login */}
                            <td className="p-3">
                              <div className="space-y-0.5">
                                <div className="text-[11px] font-mono text-gray-700">
                                  user: <b>{teacher.username}</b>
                                </div>
                                <div className="text-[10px] font-mono text-gray-400">
                                  pass: {teacher.password}
                                </div>
                              </div>
                            </td>

                            {/* Santri Diampu */}
                            <td className="p-3 text-center">
                              <button
                                onClick={() => setViewingTeacherStudents(teacher)}
                                className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-bold transition-all ${
                                  assignedStudents.length > 0 
                                    ? 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200' 
                                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                                }`}
                                title="Klik untuk melihat santri binaan guru ini"
                              >
                                <Users size={12} />
                                <span>{assignedStudents.length} Santri</span>
                              </button>
                            </td>

                            {/* Aksi */}
                            <td className="p-3 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <button 
                                  onClick={() => setEditingTeacher(teacher)} 
                                  className="p-1.5 text-gray-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-all" 
                                  title="Edit Profil Guru"
                                >
                                  <Edit2 size={15} />
                                </button>
                                <button 
                                  onClick={() => handleDeleteTeacherClick(teacher)} 
                                  className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all" 
                                  title="Hapus Guru"
                                >
                                  <Trash2 size={15} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB HAFALAN CONTENT */}
          {activeTab === 'hafalan' && (
            <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 text-center space-y-4">
              <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto shadow-sm">
                <BookOpen size={32} />
              </div>
              <div className="max-w-md mx-auto">
                <h3 className="font-bold text-lg text-gray-800">Impor Data Hafalan Massal</h3>
                <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                  Gunakan form di sebelah kiri untuk mengunggah atau menempelkan data hafalan dari berkas Excel/CSV. Data yang berhasil diimpor akan langsung tersimpan ke database.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ================= MODAL: EDIT SANTRI ================= */}
      {editingStudent && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden">
            <div className="bg-emerald-700 text-white p-4 flex items-center justify-between">
              <h3 className="font-bold text-base flex items-center gap-2">
                <Edit2 size={18} /> Edit Profil Santri
              </h3>
              <button 
                onClick={() => setEditingStudent(null)} 
                className="text-white/80 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={(e) => {
              e.preventDefault();
              if (!editingStudent.name || !editingStudent.nis) {
                return alert("Nama Lengkap dan NIS wajib diisi.");
              }

              const nameCheck = validation.validateName(editingStudent.name);
              if (!nameCheck.isValid) return alert(nameCheck.error);

              if (!/^\d+$/.test(editingStudent.nis)) {
                return alert("NIS harus berupa angka saja.");
              }

              if (students.some(s => s.id !== editingStudent.id && s.nis === editingStudent.nis)) {
                return alert("NIS sudah terdaftar untuk santri lain.");
              }

              const studentUsername = (editingStudent.username || editingStudent.nis).trim();
              if (students.some(s => s.id !== editingStudent.id && s.username?.toLowerCase() === studentUsername.toLowerCase()) || 
                  users.some(u => u.username?.toLowerCase() === studentUsername.toLowerCase())) {
                return alert("Username sudah digunakan oleh santri atau guru lain.");
              }

              const updated: Student = {
                ...editingStudent,
                name: editingStudent.name.trim(),
                nis: editingStudent.nis.trim(),
                class: editingStudent.class.trim() || '-',
                halaqah: editingStudent.halaqah.trim() || '-',
                username: studentUsername,
                totalJuz: Math.max(0, Math.min(30, editingStudent.totalJuz || 0))
              };

              if (onUpdateStudent) onUpdateStudent(updated);
              setEditingStudent(null);
              alert("Data profil santri berhasil diperbarui.");
            }} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
              
              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">
                  Nama Lengkap Santri <span className="text-red-500">*</span>
                </label>
                <input 
                  type="text" 
                  value={editingStudent.name} 
                  onChange={e => setEditingStudent({...editingStudent, name: e.target.value})} 
                  className="w-full border border-gray-300 rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" 
                  required 
                />
              </div>

              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">
                  NIS <span className="text-red-500">*</span>
                </label>
                <input 
                  type="text" 
                  inputMode="numeric"
                  value={editingStudent.nis} 
                  onChange={e => setEditingStudent({...editingStudent, nis: e.target.value.replace(/[^0-9]/g, '')})} 
                  className="w-full border border-gray-300 rounded-xl p-2.5 text-sm font-mono focus:ring-2 focus:ring-emerald-500 outline-none" 
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-1">Kelas</label>
                  <input 
                    type="text" 
                    list="classListOptions"
                    value={editingStudent.class} 
                    onChange={e => setEditingStudent({...editingStudent, class: e.target.value})} 
                    className="w-full border border-gray-300 rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" 
                    placeholder="7A, 8B..."
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-1">Halaqah</label>
                  <input 
                    type="text" 
                    list="halaqahListOptions"
                    value={editingStudent.halaqah} 
                    onChange={e => setEditingStudent({...editingStudent, halaqah: e.target.value})} 
                    className="w-full border border-gray-300 rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" 
                    placeholder="Halaqah 1..."
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">
                  Guru Pembimbing <span className="text-red-500">*</span>
                </label>
                <select 
                  value={editingStudent.teacherId} 
                  onChange={e => setEditingStudent({...editingStudent, teacherId: e.target.value})} 
                  className="w-full border border-gray-300 rounded-xl p-2.5 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none" 
                  required
                >
                  <option value="">Pilih Guru...</option>
                  {teachers.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name} {t.gender ? `(${t.gender === 'L' ? 'Ust.' : 'Ustz.'})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Capaian Juz */}
              <div className="bg-emerald-50/60 p-3.5 rounded-xl border border-emerald-100 space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-bold text-emerald-800">
                    Total Capaian Hafalan (Juz)
                  </label>
                  <span className="text-xs font-mono font-bold text-emerald-700">
                    {editingStudent.totalJuz || 0} Juz
                  </span>
                </div>
                <div className="flex gap-2">
                  <input 
                    type="number" 
                    step="0.1" 
                    min="0" 
                    max="30" 
                    value={editingStudent.totalJuz ?? 0} 
                    onChange={e => setEditingStudent({...editingStudent, totalJuz: parseFloat(e.target.value) || 0})} 
                    className="w-28 border border-gray-300 rounded-lg p-2 text-sm bg-white font-mono font-bold outline-none" 
                    required 
                  />
                  <div className="flex items-center gap-1.5 flex-wrap text-xs">
                    <button
                      type="button"
                      onClick={() => setEditingStudent(prev => prev ? ({...prev, totalJuz: Math.min(30, Math.round(((prev.totalJuz || 0) + 0.5) * 10) / 10)}) : null)}
                      className="bg-white border border-emerald-200 text-emerald-700 px-2 py-1.5 rounded-md hover:bg-emerald-50 font-bold"
                    >
                      +0.5
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingStudent(prev => prev ? ({...prev, totalJuz: Math.min(30, Math.round(((prev.totalJuz || 0) + 1.0) * 10) / 10)}) : null)}
                      className="bg-white border border-emerald-200 text-emerald-700 px-2 py-1.5 rounded-md hover:bg-emerald-50 font-bold"
                    >
                      +1.0
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingStudent(prev => prev ? ({...prev, totalJuz: 0}) : null)}
                      className="bg-white border border-gray-200 text-gray-500 px-2 py-1.5 rounded-md hover:bg-gray-50 font-medium"
                    >
                      Reset 0
                    </button>
                  </div>
                </div>
              </div>

              {/* Akun Login */}
              <div className="pt-2 border-t border-gray-100 bg-gray-50/70 p-3.5 rounded-xl space-y-3">
                <p className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
                  <Shield size={14} className="text-emerald-600" /> Akun Login Santri / Wali
                </p>
                <div>
                  <label className="text-[11px] font-medium text-gray-500 block mb-1">Username</label>
                  <input 
                    type="text" 
                    value={editingStudent.username || ''} 
                    onChange={e => setEditingStudent({...editingStudent, username: e.target.value})} 
                    className="w-full border border-gray-300 rounded-lg p-2 text-xs bg-white font-mono outline-none" 
                    placeholder="Sama dengan NIS jika dikosongkan"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-gray-500 block mb-1">Password</label>
                  <div className="relative">
                    <input 
                      type={showEditStudentPass ? "text" : "password"} 
                      value={editingStudent.password || ''} 
                      onChange={e => setEditingStudent({...editingStudent, password: e.target.value})} 
                      className="w-full border border-gray-300 rounded-lg p-2 text-xs bg-white pr-9 font-mono outline-none" 
                    />
                    <button
                      type="button"
                      onClick={() => setShowEditStudentPass(!showEditStudentPass)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showEditStudentPass ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-3 border-t border-gray-100">
                <button 
                  type="button" 
                  onClick={() => setEditingStudent(null)} 
                  className="px-4 py-2.5 border border-gray-200 rounded-xl text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-all"
                >
                  Batal
                </button>
                <button 
                  type="submit" 
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/20 transition-all"
                >
                  Simpan Perubahan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL: EDIT GURU ================= */}
      {editingTeacher && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden">
            <div className="bg-emerald-700 text-white p-4 flex items-center justify-between">
              <h3 className="font-bold text-base flex items-center gap-2">
                <Edit2 size={18} /> Edit Profil Guru Halaqah
              </h3>
              <button 
                onClick={() => setEditingTeacher(null)} 
                className="text-white/80 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={(e) => {
              e.preventDefault();
              const nameCheck = validation.validateName(editingTeacher.name);
              if (!nameCheck.isValid) return alert(nameCheck.error);

              if (users.some(u => u.id !== editingTeacher.id && u.username?.toLowerCase() === editingTeacher.username?.toLowerCase()) ||
                  students.some(s => s.username?.toLowerCase() === editingTeacher.username?.toLowerCase())) {
                return alert("Username sudah digunakan oleh guru atau santri lain.");
              }

              const phoneCheck = validation.validatePhone(editingTeacher.phoneNumber || '');
              if (!phoneCheck.isValid) return alert(phoneCheck.error);

              const updated = {
                ...editingTeacher,
                name: editingTeacher.name.trim(),
                phoneNumber: phoneCheck.formatted
              };
              if (onUpdateUser) onUpdateUser(updated);
              setEditingTeacher(null);
              alert("Profil guru berhasil diperbarui.");
            }} className="p-6 space-y-4">
              
              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">
                  Nama Guru <span className="text-red-500">*</span>
                </label>
                <input 
                  type="text" 
                  value={editingTeacher.name} 
                  onChange={e => setEditingTeacher({...editingTeacher, name: e.target.value})} 
                  className="w-full border border-gray-300 rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" 
                  required 
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-1">Gender</label>
                  <select 
                    value={editingTeacher.gender || ''} 
                    onChange={e => setEditingTeacher({...editingTeacher, gender: e.target.value as 'L' | 'P'})} 
                    className="w-full border border-gray-300 rounded-xl p-2.5 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
                  >
                    <option value="">Deteksi Otomatis</option>
                    <option value="L">Laki-laki (Ust.)</option>
                    <option value="P">Perempuan (Ustz.)</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-1">WhatsApp</label>
                  <input 
                    type="text" 
                    value={editingTeacher.phoneNumber || ''} 
                    onChange={e => {
                      let cleaned = e.target.value.replace(/[^0-9]/g, '');
                      if (cleaned.startsWith('08')) cleaned = '628' + cleaned.substring(2);
                      setEditingTeacher({...editingTeacher, phoneNumber: cleaned});
                    }} 
                    className="w-full border border-gray-300 rounded-xl p-2.5 text-sm font-mono focus:ring-2 focus:ring-emerald-500 outline-none" 
                    placeholder="6281234..." 
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">
                  Username <span className="text-red-500">*</span>
                </label>
                <input 
                  type="text" 
                  value={editingTeacher.username || ''} 
                  onChange={e => setEditingTeacher({...editingTeacher, username: e.target.value})} 
                  className="w-full border border-gray-300 rounded-xl p-2.5 text-sm font-mono focus:ring-2 focus:ring-emerald-500 outline-none" 
                  required 
                />
              </div>

              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">
                  Password <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input 
                    type={showEditTeacherPass ? "text" : "password"} 
                    value={editingTeacher.password || ''} 
                    onChange={e => setEditingTeacher({...editingTeacher, password: e.target.value})} 
                    className="w-full border border-gray-300 rounded-xl p-2.5 text-sm pr-10 font-mono focus:ring-2 focus:ring-emerald-500 outline-none" 
                    required 
                  />
                  <button
                    type="button"
                    onClick={() => setShowEditTeacherPass(!showEditTeacherPass)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showEditTeacherPass ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-3 border-t border-gray-100">
                <button 
                  type="button" 
                  onClick={() => setEditingTeacher(null)} 
                  className="px-4 py-2.5 border border-gray-200 rounded-xl text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-all"
                >
                  Batal
                </button>
                <button 
                  type="submit" 
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/20 transition-all"
                >
                  Simpan Perubahan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL: BULK REASSIGN (PINDAH KELAS / HALAQAH / GURU) ================= */}
      {isBulkReassignOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden">
            <div className="bg-emerald-700 text-white p-4 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base flex items-center gap-2">
                  <Layers size={18} /> Pindah Kelas / Halaqah / Guru Massal
                </h3>
                <p className="text-xs text-emerald-100 mt-0.5">
                  Mengubah data untuk <b>{selectedStudentIds.length} santri terpilih</b> sekaligus
                </p>
              </div>
              <button 
                onClick={() => setIsBulkReassignOpen(false)} 
                className="text-white/80 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleExecuteBulkReassign} className="p-6 space-y-4">
              <div className="bg-blue-50 text-blue-800 p-3 rounded-xl text-xs leading-relaxed border border-blue-100">
                💡 <b>Petunjuk:</b> Isi hanya kolom yang ingin Anda ubah. Kolom yang dikosongkan tidak akan mengubah data santri yang bersangkutan.
              </div>

              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">
                  Pindah ke Kelas Baru
                </label>
                <input 
                  type="text"
                  list="classListOptions"
                  value={bulkReassignForm.targetClass}
                  onChange={e => setBulkReassignForm({...bulkReassignForm, targetClass: e.target.value})}
                  placeholder="Kosongkan jika tidak ingin mengubah kelas"
                  className="w-full border border-gray-300 rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">
                  Pindah ke Halaqah Baru
                </label>
                <input 
                  type="text"
                  list="halaqahListOptions"
                  value={bulkReassignForm.targetHalaqah}
                  onChange={e => setBulkReassignForm({...bulkReassignForm, targetHalaqah: e.target.value})}
                  placeholder="Kosongkan jika tidak ingin mengubah halaqah"
                  className="w-full border border-gray-300 rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">
                  Ganti Guru Pembimbing
                </label>
                <select
                  value={bulkReassignForm.targetTeacherId}
                  onChange={e => setBulkReassignForm({...bulkReassignForm, targetTeacherId: e.target.value})}
                  className="w-full border border-gray-300 rounded-xl p-2.5 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
                >
                  <option value="">[ Jangan Ubah Guru Pembimbing ]</option>
                  {teachers.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({students.filter(s => s.teacherId === t.id).length} santri)
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-2 justify-end pt-4 border-t border-gray-100">
                <button 
                  type="button" 
                  onClick={() => setIsBulkReassignOpen(false)} 
                  className="px-4 py-2.5 border border-gray-200 rounded-xl text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-all"
                >
                  Batal
                </button>
                <button 
                  type="submit" 
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/20 transition-all flex items-center gap-1.5"
                >
                  <Check size={16} /> Terapkan ke {selectedStudentIds.length} Santri
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL: LIHAT SANTRI BINAAN GURU ================= */}
      {viewingTeacherStudents && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="bg-emerald-700 text-white p-4 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base flex items-center gap-2">
                  <Users size={18} /> Santri Binaan: {viewingTeacherStudents.name}
                </h3>
                <p className="text-xs text-emerald-100 mt-0.5">
                  Total {students.filter(s => s.teacherId === viewingTeacherStudents.id).length} orang santri terdaftar di halaqah ini
                </p>
              </div>
              <button 
                onClick={() => setViewingTeacherStudents(null)} 
                className="text-white/80 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1">
              {students.filter(s => s.teacherId === viewingTeacherStudents.id).length === 0 ? (
                <div className="text-center py-10 text-gray-400">
                  <Users size={36} className="mx-auto mb-2 text-gray-300" />
                  <p>Belum ada santri yang ditugaskan ke guru ini.</p>
                </div>
              ) : (
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-gray-50 border-b border-gray-200 text-gray-600">
                      <tr>
                        <th className="p-2.5 font-semibold">No</th>
                        <th className="p-2.5 font-semibold">Nama Santri</th>
                        <th className="p-2.5 font-semibold">NIS</th>
                        <th className="p-2.5 font-semibold">Kelas</th>
                        <th className="p-2.5 font-semibold">Halaqah</th>
                        <th className="p-2.5 font-semibold text-right">Capaian</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {students
                        .filter(s => s.teacherId === viewingTeacherStudents.id)
                        .map((st, idx) => (
                          <tr key={st.id} className="hover:bg-gray-50">
                            <td className="p-2.5 text-gray-400 font-mono">{idx + 1}</td>
                            <td className="p-2.5 font-bold text-gray-800">{st.name}</td>
                            <td className="p-2.5 text-gray-500 font-mono">{st.nis}</td>
                            <td className="p-2.5">{st.class || '-'}</td>
                            <td className="p-2.5">{st.halaqah || '-'}</td>
                            <td className="p-2.5 text-right font-mono font-bold text-emerald-600">
                              {st.totalJuz || 0} Juz
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="p-3 border-t border-gray-100 bg-gray-50 flex justify-end">
              <button 
                onClick={() => setViewingTeacherStudents(null)} 
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-xl text-xs font-semibold"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default AdminPanel;
