
function setup() {
  var doc = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. Sheet Users
  var userHeaders = ['id', 'name', 'role', 'username', 'password', 'phoneNumber', 'childId', 'email', 'avatar'];
  createSheetIfNeeded(doc, 'Users', userHeaders);
  
  // 2. Sheet Students
  var studentHeaders = ['id', 'name', 'nis', 'class', 'halaqah', 'teacherId', 'totalJuz', 'username', 'password'];
  createSheetIfNeeded(doc, 'Students', studentHeaders);
  
  // 3. Records (Tambahkan kolom class untuk kemudahan filter di spreadsheet)
  createSheetIfNeeded(doc, 'Records', ['id', 'studentId', 'date', 'type', 'surah', 'ayahStart', 'ayahEnd', 'grade', 'notes', 'class']);
  
  // 4. Attendance
  createSheetIfNeeded(doc, 'Attendance', ['id', 'userId', 'date', 'session', 'status', 'approvalStatus', 'type', 'class', 'lateReason']);
  
  // 4b. Attendance Open Requests
  createSheetIfNeeded(doc, 'AttendanceOpenRequests', ['id', 'teacherId', 'date', 'session', 'type', 'status', 'lateReason']);
  
  // 5. Exams (Ditambahkan StudentName dan class)
  createSheetIfNeeded(doc, 'Exams', ['id', 'studentId', 'StudentName', 'date', 'category', 'score', 'examiner', 'status', 'notes', 'juz', 'class']);
  
  // Tambah Dummy Data jika kosong
  var userSheet = doc.getSheetByName('Users');
  if (userSheet.getLastRow() === 1) {
     userSheet.appendRow(['u1', 'Super Admin', 'admin', "'admin", "'123", "'6281383237720", "", "", ""]);
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
    exams: getSheetData(doc, 'Exams'),
    openRequests: getSheetData(doc, 'AttendanceOpenRequests')
  };
  lock.releaseLock();
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function getSheetData(doc, sheetName) {
  var sheet = doc.getSheetByName(sheetName);
  if (!sheet) return [];
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
  try { lock.tryLock(30000); } catch (e) { return ContentService.createTextOutput(JSON.stringify({result: 'error', message: 'Locked'})).setMimeType(ContentService.MimeType.JSON); }
  try {
    var doc = SpreadsheetApp.getActiveSpreadsheet();
    var jsonData = JSON.parse(e.postData.contents);
    
    // Detect Fonnte / WhatsApp Webhook
    if (jsonData.sender && jsonData.message) {
      return handleFonnteWebhook(doc, jsonData);
    }
    
    var action = jsonData.action;
    var data = jsonData.data;
    
    if (action == 'addUser') {
      doc.getSheetByName('Users').appendRow([data.id, data.name, data.role, "'" + data.username, "'" + data.password, "'" + data.phoneNumber, data.childId || '', data.email || '', '']);
    } else if (action == 'updateUser') {
      var sheet = doc.getSheetByName('Users');
      if (sheet) {
        var values = sheet.getDataRange().getValues();
        for (var i = 1; i < values.length; i++) {
          if (values[i][0] == data.id) { sheet.deleteRow(i + 1); break; }
        }
      }
      sheet.appendRow([data.id, data.name, data.role, "'" + data.username, "'" + data.password, "'" + data.phoneNumber, data.childId || '', data.email || '', data.avatar || '']);
    } else if (action == 'addStudent') {
      doc.getSheetByName('Students').appendRow([data.id, data.name, "'" + data.nis, data.class, data.halaqah, data.teacherId, 0, "'" + (data.username || data.nis), "'" + data.password]);
    } else if (action == 'addRecord') {
      doc.getSheetByName('Records').appendRow([data.id, data.studentId, data.date, data.type, data.surah, data.ayahStart, data.ayahEnd, data.grade, data.notes, data.class || '']);
    } else if (action == 'markAttendance') {
      doc.getSheetByName('Attendance').appendRow([data.id, data.userId, data.date, data.session, data.status, data.approvalStatus, data.type, data.class || '', data.lateReason || '']);
    } else if (action == 'addAttendanceOpenRequest') {
      var sheet = doc.getSheetByName('AttendanceOpenRequests');
      if (sheet) {
        var values = sheet.getDataRange().getValues();
        for (var i = 1; i < values.length; i++) {
          if (values[i][0] == data.id) { sheet.deleteRow(i + 1); break; }
        }
      }
      sheet.appendRow([data.id, data.teacherId, data.date, data.session, data.type, data.status, data.lateReason]);
    } else if (action == 'addExam') {
      var juzInfo = data.juz || (data.details && data.details.juz) || '-';
      doc.getSheetByName('Exams').appendRow([data.id, data.studentId, data.studentName || '-', data.date, data.category, data.score, data.examiner, data.status, data.notes, juzInfo, data.class || '']);
    } else if (action == 'deleteData') {
       var sheet = doc.getSheetByName(data.sheetName);
       if (sheet) {
         var values = sheet.getDataRange().getValues();
         for (var i = 1; i < values.length; i++) {
           if (values[i][0] == data.id) { sheet.deleteRow(i + 1); break; }
         }
       }
    }
    return ContentService.createTextOutput(JSON.stringify({result: 'success'})).setMimeType(ContentService.MimeType.JSON);
  } catch (e) {
    return ContentService.createTextOutput(JSON.stringify({result: 'error', error: e.toString()})).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

// Function to handle WhatsApp Webhook (Fonnte)
function handleFonnteWebhook(doc, payload) {
  var sender = payload.sender.replace(/\D/g, '');
  var message = payload.message.trim().toLowerCase();
  
  // Ambil nomor Admin dari Sheet Users atau gunakan nomor default
  var adminNumber = "6281383237720"; // Admin utama
  if (sender !== adminNumber) {
    return ContentService.createTextOutput(JSON.stringify({result: 'error', message: 'Unauthorized sender'})).setMimeType(ContentService.MimeType.JSON);
  }
  
  // Format teks: "ok #id" atau "tidak #id" (case-insensitive)
  var match = message.match(/(ok|tidak)\s+#([a-z0-9_]+)/);
  if (!match) {
    return ContentService.createTextOutput(JSON.stringify({result: 'error', message: 'Invalid message format'})).setMimeType(ContentService.MimeType.JSON);
  }
  
  var action = match[1]; // "ok" atau "tidak"
  var id = match[2]; // ID record
  
  var newStatus = (action === 'ok') ? 'approved' : 'rejected';
  
  if (id.indexOf('req_') === 0) {
    // Ini permohonan buka absen (AttendanceOpenRequests)
    var sheet = doc.getSheetByName('AttendanceOpenRequests');
    if (!sheet) return ContentService.createTextOutput(JSON.stringify({result: 'error', message: 'Sheet not found'})).setMimeType(ContentService.MimeType.JSON);
    
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] == id) {
        sheet.getRange(i + 1, 6).setValue(newStatus); // Kolom status (F)
        return ContentService.createTextOutput(JSON.stringify({result: 'success', info: 'Request ' + id + ' updated to ' + newStatus})).setMimeType(ContentService.MimeType.JSON);
      }
    }
  } else {
    // Ini izin/sakit guru (Attendance)
    var sheet = doc.getSheetByName('Attendance');
    if (!sheet) return ContentService.createTextOutput(JSON.stringify({result: 'error', message: 'Sheet not found'})).setMimeType(ContentService.MimeType.JSON);
    
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] == id) {
        sheet.getRange(i + 1, 6).setValue(newStatus); // Kolom approvalStatus (F)
        return ContentService.createTextOutput(JSON.stringify({result: 'success', info: 'Attendance ' + id + ' updated to ' + newStatus})).setMimeType(ContentService.MimeType.JSON);
      }
    }
  }
  
  return ContentService.createTextOutput(JSON.stringify({result: 'error', message: 'ID not found'})).setMimeType(ContentService.MimeType.JSON);
}
