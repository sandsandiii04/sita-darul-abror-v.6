
import React, { useState } from 'react';
import { Database, Upload, Image, ChevronDown, ChevronRight, Copy, ExternalLink, Globe, Check } from 'lucide-react';
import { GOOGLE_SCRIPT_URL, LOGO_URL } from '../constants';

const BACKEND_SCRIPT = `function setup() {
  var doc = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. Sheet Users
  var userHeaders = ['id', 'name', 'role', 'username', 'password', 'phoneNumber', 'childId', 'email', 'avatar'];
  createSheetIfNeeded(doc, 'Users', userHeaders);
  
  // 2. Sheet Students
  var studentHeaders = ['id', 'name', 'nis', 'class', 'halaqah', 'teacherId', 'totalJuz', 'username', 'password'];
  createSheetIfNeeded(doc, 'Students', studentHeaders);
  
  // 3. Lainnya
  createSheetIfNeeded(doc, 'Records', ['id', 'studentId', 'date', 'type', 'surah', 'ayahStart', 'ayahEnd', 'grade', 'notes']);
  createSheetIfNeeded(doc, 'Attendance', ['id', 'userId', 'date', 'session', 'status', 'approvalStatus', 'type']);
  
  // 4. Exams
  createSheetIfNeeded(doc, 'Exams', ['id', 'studentId', 'date', 'category', 'score', 'examiner', 'status', 'notes', 'juz']);
  
  // Tambah Dummy Data jika kosong
  var userSheet = doc.getSheetByName('Users');
  if (userSheet.getLastRow() === 1) {
     userSheet.appendRow(['u1', 'Super Admin', 'admin', "'admin", "'123", "'6281234567890", "", "", ""]);
  }
}

function createSheetIfNeeded(doc, sheetName, headers) {
  var sheet = doc.getSheetByName(sheetName);
  if (!sheet) {
    sheet = doc.insertSheet(sheetName);
    sheet.appendRow(headers);
    var headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setFontWeight("bold");
    headerRange.setBackground("#dcfce7");
    sheet.setFrozenRows(1);
  } else {
    var currentCols = sheet.getLastColumn();
    if (currentCols < headers.length) {
       for (var i = currentCols; i < headers.length; i++) {
          sheet.getRange(1, i + 1).setValue(headers[i]);
          sheet.getRange(1, i + 1).setFontWeight("bold");
          sheet.getRange(1, i + 1).setBackground("#dcfce7");
       }
    }
  }
  return sheet;
}

function doGet(e) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch(e) {}

  var doc = SpreadsheetApp.getActiveSpreadsheet();
  var data = {
    users: getSheetData(doc, 'Users'),
    students: getSheetData(doc, 'Students'),
    records: getSheetData(doc, 'Records'),
    attendance: getSheetData(doc, 'Attendance'),
    exams: getSheetData(doc, 'Exams')
  };
  
  lock.releaseLock();
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function getSheetData(doc, sheetName) {
  var sheet = doc.getSheetByName(sheetName);
  var rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];
  var headers = rows[0];
  var result = [];
  for (var i = 1; i < rows.length; i++) {
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      var val = rows[i][j];
      if (val instanceof Date) val = Utilities.formatDate(val, Session.getScriptTimeZone(), "yyyy-MM-dd");
      obj[headers[j]] = val;
    }
    result.push(obj);
  }
  return result;
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try { lock.tryLock(50000); } catch (e) { return ContentService.createTextOutput(JSON.stringify({result: 'error'})).setMimeType(ContentService.MimeType.JSON); }

  try {
    var doc = SpreadsheetApp.getActiveSpreadsheet();
    var jsonData = JSON.parse(e.postData.contents);
    var action = jsonData.action;
    var data = jsonData.data;
    
    if (action == 'addUser') {
      doc.getSheetByName('Users').appendRow([data.id, data.name, data.role, "'" + data.username, "'" + data.password, "'" + data.phoneNumber, data.childId || '', data.email || '', '']);
    } else if (action == 'addStudent') {
      doc.getSheetByName('Students').appendRow([data.id, data.name, "'" + data.nis, data.class, data.halaqah, data.teacherId, 0, "'" + (data.username || data.nis), "'" + data.password]);
    } else if (action == 'addRecord') {
      doc.getSheetByName('Records').appendRow([data.id, data.studentId, data.date, data.type, data.surah, data.ayahStart, data.ayahEnd, data.grade, data.notes]);
    } else if (action == 'markAttendance') {
      doc.getSheetByName('Attendance').appendRow([data.id, data.userId, data.date, data.session, data.status, data.approvalStatus, data.type]);
    } else if (action == 'addExam') {
      var juzInfo = (data.details && data.details.juz) ? data.details.juz : (data.juz || '-');
      doc.getSheetByName('Exams').appendRow([data.id, data.studentId, data.date, data.category, data.score, data.examiner, data.status, data.notes, juzInfo]);
    } else if (action == 'updateUser') {
      // Basic update logic handling (avatar upload handled separately via drive function if needed, here basic string update)
       var sheetName = (data.role === 'student' || (data.role === 'parent' && data.childId === data.id)) ? 'Students' : 'Users';
       var sheet = doc.getSheetByName(sheetName);
       var values = sheet.getDataRange().getValues();
       for (var i = 1; i < values.length; i++) {
          if (values[i][0] == data.id) {
             var rowIdx = i + 1;
             if (sheetName === 'Users') {
                sheet.getRange(rowIdx, 2).setValue(data.name);
                sheet.getRange(rowIdx, 4).setValue("'" + data.username);
                sheet.getRange(rowIdx, 5).setValue("'" + data.password);
                sheet.getRange(rowIdx, 6).setValue("'" + data.phoneNumber);
                if (sheet.getLastColumn() >= 8) sheet.getRange(rowIdx, 8).setValue(data.email || '');
                // Avatar update requires complexity omitted for brevity in copy-paste block, preserving main logic
             }
             break;
          }
       }
    } else if (action == 'deleteData') {
       var sheet = doc.getSheetByName(data.sheetName);
       var values = sheet.getDataRange().getValues();
       for (var i = 1; i < values.length; i++) {
         if (values[i][0] == data.id) { sheet.deleteRow(i + 1); break; }
       }
    }
    return ContentService.createTextOutput(JSON.stringify({result: 'success'})).setMimeType(ContentService.MimeType.JSON);
  } catch (e) {
    return ContentService.createTextOutput(JSON.stringify({result: 'error', error: e.toString()})).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}`;

const TutorialGuide: React.FC = () => {
  const [activeSection, setActiveSection] = useState<string | null>('database');
  const [copied, setCopied] = useState(false);

  const toggleSection = (section: string) => {
    setActiveSection(activeSection === section ? null : section);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(BACKEND_SCRIPT);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-fade-in pb-20">
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">Panduan Sistem & Instalasi</h1>
        <p className="text-gray-500">
          Ikuti langkah-langkah di bawah ini untuk menghubungkan aplikasi ke Google Sheets, mengganti logo, dan mengonlinekan aplikasi.
        </p>
      </div>

      {/* 1. DATABASE SETUP */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <button 
          onClick={() => toggleSection('database')}
          className="w-full flex items-center justify-between p-6 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
        >
          <div className="flex items-center gap-4">
            <div className="p-3 bg-green-100 text-green-700 rounded-lg">
              <Database size={24} />
            </div>
            <div>
              <h2 className="font-bold text-lg text-gray-800">1. Setup Database (Google Sheets)</h2>
              <p className="text-sm text-gray-500">Menghubungkan aplikasi ke Google Spreadsheet</p>
            </div>
          </div>
          {activeSection === 'database' ? <ChevronDown /> : <ChevronRight />}
        </button>
        
        {activeSection === 'database' && (
          <div className="p-6 space-y-6 text-sm text-gray-700 border-t">
            <div className="space-y-4">
              <div className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-gray-800 text-white flex items-center justify-center flex-shrink-0 font-bold">1</div>
                <div>
                  <p className="font-bold">Buka Google Sheets Baru</p>
                  <p>Buat spreadsheet baru di Google Drive Anda, beri nama (misal: "Database Tahfidz").</p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-gray-800 text-white flex items-center justify-center flex-shrink-0 font-bold">2</div>
                <div>
                  <p className="font-bold">Buka Apps Script</p>
                  <p>Di menu Google Sheets, klik <span className="font-mono bg-gray-100 px-1 rounded">Ekstensi</span> &gt; <span className="font-mono bg-gray-100 px-1 rounded">Apps Script</span>.</p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-gray-800 text-white flex items-center justify-center flex-shrink-0 font-bold">3</div>
                <div className="flex-1">
                  <p className="font-bold">Copy Script Backend</p>
                  <p className="mb-2">Hapus semua kode di file <code>Code.gs</code>, lalu salin kode berikut:</p>
                  <div className="relative">
                      <textarea 
                        readOnly 
                        value={BACKEND_SCRIPT} 
                        className="w-full h-48 p-3 text-xs font-mono bg-gray-800 text-emerald-300 rounded-lg border border-gray-700 focus:outline-none"
                      />
                      <button 
                        onClick={handleCopy}
                        className="absolute top-2 right-2 bg-white/10 hover:bg-white/20 text-white px-3 py-1 rounded text-xs font-bold flex items-center gap-1 transition-colors backdrop-blur-sm"
                      >
                        {copied ? <Check size={12}/> : <Copy size={12} />} {copied ? 'Tersalin' : 'Salin Kode'}
                      </button>
                  </div>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-gray-800 text-white flex items-center justify-center flex-shrink-0 font-bold">4</div>
                <div>
                  <p className="font-bold">Deploy sebagai Web App</p>
                  <ul className="list-disc ml-4 mt-2 space-y-1 text-gray-600">
                    <li>Klik tombol biru <b>Deploy</b> (Terapkan) &gt; <b>New Deployment</b>.</li>
                    <li>Pilih type: <b>Web App</b>.</li>
                    <li>Description: "Versi 1".</li>
                    <li>Execute as: <b>Me</b> (Saya).</li>
                    <li>Who has access: <b>Anyone</b> (Siapa saja) <span className="text-red-500 font-bold">*PENTING</span>.</li>
                    <li>Klik <b>Deploy</b>. Berikan izin akses (Authorize Access) jika diminta.</li>
                  </ul>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-gray-800 text-white flex items-center justify-center flex-shrink-0 font-bold">5</div>
                <div>
                  <p className="font-bold">Simpan URL</p>
                  <p>Salin URL yang berakhiran <span className="font-mono text-xs">/exec</span>.</p>
                  <p className="mt-2">Paste URL tersebut ke dalam file <span className="font-mono bg-gray-100 px-1 rounded">constants.ts</span> pada variabel <code>GOOGLE_SCRIPT_URL</code>.</p>
                  <div className="mt-2 p-3 bg-gray-800 text-white rounded font-mono text-xs break-all">
                     export const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbx.../exec";
                  </div>
                  <div className="mt-2">
                     <p className="text-xs text-gray-500">URL Saat Ini di Aplikasi:</p>
                     <p className={`text-xs font-mono font-bold ${GOOGLE_SCRIPT_URL ? 'text-green-600' : 'text-red-500'}`}>
                        {GOOGLE_SCRIPT_URL || "(Belum disetting - Mode Offline)"}
                     </p>
                  </div>
                </div>
              </div>

              <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg text-yellow-800 text-sm">
                <strong>Tips:</strong> Setelah paste kode, jalankan fungsi <code>setup()</code> di Apps Script sekali saja untuk membuat header kolom di Google Sheets secara otomatis.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 2. LOGO SETUP */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <button 
          onClick={() => toggleSection('logo')}
          className="w-full flex items-center justify-between p-6 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
        >
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-100 text-blue-700 rounded-lg">
              <Image size={24} />
            </div>
            <div>
              <h2 className="font-bold text-lg text-gray-800">2. Mengganti Logo (Dashboard & Login)</h2>
              <p className="text-sm text-gray-500">Kustomisasi identitas aplikasi</p>
            </div>
          </div>
          {activeSection === 'logo' ? <ChevronDown /> : <ChevronRight />}
        </button>
        
        {activeSection === 'logo' && (
          <div className="p-6 space-y-6 text-sm text-gray-700 border-t">
             <div className="flex flex-col md:flex-row gap-6">
                <div className="flex-1 space-y-4">
                   <h3 className="font-bold text-base">Metode 1: Ganti File (Direkomendasikan)</h3>
                   <p>
                      Aplikasi ini memuat logo dari file <span className="font-mono bg-gray-100 px-1 rounded">/public/logo.png</span>.
                   </p>
                   <ol className="list-decimal ml-4 space-y-2">
                      <li>Siapkan file logo Anda (format PNG transparan lebih baik).</li>
                      <li>Ubah nama file menjadi <code>logo.png</code>.</li>
                      <li>Ganti/Timpa file <code>logo.png</code> yang ada di folder <code>public</code> project ini.</li>
                      <li>Refresh aplikasi.</li>
                   </ol>

                   <h3 className="font-bold text-base mt-6">Metode 2: Menggunakan URL Eksternal</h3>
                   <p>
                      Jika logo Anda sudah dihosting online (misal: Imgur, Google Drive, Website Sekolah):
                   </p>
                   <ol className="list-decimal ml-4 space-y-2">
                      <li>Buka file <span className="font-mono bg-gray-100 px-1 rounded">constants.ts</span>.</li>
                      <li>Cari variabel <code>LOGO_URL</code>.</li>
                      <li>Ganti isinya dengan URL lengkap gambar Anda.</li>
                   </ol>
                   <div className="mt-2 p-3 bg-gray-800 text-white rounded font-mono text-xs break-all">
                     export const LOGO_URL = "https://sekolahanda.com/images/logo.png";
                  </div>
                </div>
                <div className="w-full md:w-1/3 flex flex-col items-center justify-center bg-gray-50 rounded-xl border border-dashed border-gray-300 p-6">
                    <p className="text-xs font-bold text-gray-400 mb-2">Logo Saat Ini</p>
                    <img src={LOGO_URL} alt="Current Logo" className="w-32 h-32 object-contain" />
                    <p className="text-xs text-gray-400 mt-2 break-all text-center">{LOGO_URL}</p>
                </div>
             </div>
          </div>
        )}
      </div>

      {/* 3. DEPLOY */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <button 
          onClick={() => toggleSection('deploy')}
          className="w-full flex items-center justify-between p-6 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
        >
          <div className="flex items-center gap-4">
            <div className="p-3 bg-purple-100 text-purple-700 rounded-lg">
              <Globe size={24} />
            </div>
            <div>
              <h2 className="font-bold text-lg text-gray-800">3. Deploy Aplikasi (Online)</h2>
              <p className="text-sm text-gray-500">Mengonlinekan aplikasi agar bisa diakses Wali Santri</p>
            </div>
          </div>
          {activeSection === 'deploy' ? <ChevronDown /> : <ChevronRight />}
        </button>
        
        {activeSection === 'deploy' && (
          <div className="p-6 space-y-6 text-sm text-gray-700 border-t">
            <p>Untuk membuat aplikasi ini bisa diakses lewat internet (HP/Laptop manapun), Anda bisa menggunakan layanan gratis seperti <strong>Netlify</strong> atau <strong>Vercel</strong>.</p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
               <div className="border rounded-lg p-4">
                  <h3 className="font-bold text-lg mb-2 flex items-center gap-2">Opsi A: Netlify Drop (Paling Mudah)</h3>
                  <ol className="list-decimal ml-4 space-y-2 text-gray-600">
                     <li>Di komputer Anda, buka terminal/cmd di folder project ini.</li>
                     <li>Jalankan perintah: <span className="font-mono bg-gray-100 px-1 font-bold text-black">npm run build</span>.</li>
                     <li>Tunggu hingga muncul folder baru bernama <code>dist</code>.</li>
                     <li>Buka website <a href="https://app.netlify.com/drop" target="_blank" className="text-blue-600 underline">Netlify Drop</a>.</li>
                     <li>Drag & Drop folder <code>dist</code> tersebut ke area upload Netlify.</li>
                     <li>Aplikasi langsung online! Anda akan dapat URL (misal: <code>random-name.netlify.app</code>).</li>
                  </ol>
               </div>

               <div className="border rounded-lg p-4">
                  <h3 className="font-bold text-lg mb-2 flex items-center gap-2">Opsi B: Vercel (Disarankan)</h3>
                  <ol className="list-decimal ml-4 space-y-2 text-gray-600">
                     <li>Upload source code ini ke GitHub Repository Anda.</li>
                     <li>Buka <a href="https://vercel.com" target="_blank" className="text-blue-600 underline">Vercel.com</a> dan Login.</li>
                     <li>Klik "Add New Project" dan Import dari GitHub tadi.</li>
                     <li>Framework Preset: Pilih <strong>Vite</strong>.</li>
                     <li>Klik <strong>Deploy</strong>.</li>
                     <li>Setiap kali Anda update code di GitHub, Vercel akan otomatis update websitenya.</li>
                  </ol>
               </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg text-blue-800 text-sm mt-4">
               <strong>Catatan Penting:</strong> <br/>
               Pastikan <code>GOOGLE_SCRIPT_URL</code> di file <code>constants.ts</code> sudah diisi dengan URL Deployment Apps Script (langkah no 1) SEBELUM Anda melakukan build/deploy ke Netlify/Vercel.
            </div>
          </div>
        )}
      </div>

    </div>
  );
};

export default TutorialGuide;
