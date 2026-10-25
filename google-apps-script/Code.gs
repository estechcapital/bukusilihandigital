/**
 * =========================================================================
 * BUKU SILIHAN DIGITAL - BACKEND GOOGLE APPS SCRIPT API
 * =========================================================================
 * Backend API untuk menghubungkan web frontend Peminjaman Barang dengan Google Sheets.
 * Dilengkapi dengan:
 * - Autentikasi Admin berbasis Token & Hashing SHA-256
 * - Mode Guest (hanya membaca data & riwayat peminjaman)
 * - Manajemen Stok Otomatis (kurangi saat dipinjam, tambah saat dikembalikan)
 * - Pencegahan peminjaman melebihi stok & pencegahan pengembalian ganda
 * - LockService untuk mencegah konflik konkurensi antar pengguna
 * - JSON response standar & kompatibel CORS
 */

// Konfigurasi Nama Sheet
var CONFIG = {
  SHEET_LOANS: 'Peminjaman',
  SHEET_ITEMS: 'Barang',
  SHEET_USERS: 'Users',
  SHEET_DETAIL: 'Detail_Peminjaman',
  TOKEN_EXPIRY_DAYS: 7, // Token aktif selama 7 hari
  DEFAULT_ADMIN_EMAIL: 'admin@bolopecah.com',
  DEFAULT_ADMIN_PASS: 'admin123' // Password default saat setup pertama kali
};

// =========================================================================
// ROUTING ENTRY POINTS (doGet & doPost)
// =========================================================================

function doGet(e) {
  return handleRequest(e, 'GET');
}

function doPost(e) {
  return handleRequest(e, 'POST');
}

function handleRequest(e, method) {
  try {
    var params = {};
    
    // Parse parameter dari query string (GET)
    if (e && e.parameter) {
      for (var key in e.parameter) {
        params[key] = e.parameter[key];
      }
    }
    
    // Parse body dari POST request (JSON atau text/plain)
    if (method === 'POST' && e && e.postData && e.postData.contents) {
      try {
        var bodyData = JSON.parse(e.postData.contents);
        for (var bKey in bodyData) {
          params[bKey] = bodyData[bKey];
        }
      } catch (err) {
        // Abaikan jika bukan JSON murni
      }
    }
    
    var action = params.action || '';
    
    // Routing aksi
    switch (action) {
      case 'ping':
        return createJsonResponse({ success: true, message: 'API Google Apps Script siap digunakan.', time: new Date() });
      
      case 'setup':
        return createJsonResponse(setupDatabase());
        
      case 'login':
        return createJsonResponse(apiLogin(params.email, params.password));
        
      case 'logout':
        return createJsonResponse(apiLogout(params.token));
        
      case 'checkAuth':
        return createJsonResponse(apiCheckAuth(params.token));
        
      case 'getLoans':
        return createJsonResponse(apiGetLoans());
        
      case 'getItems':
        return createJsonResponse(apiGetItems());
        
      case 'addLoan':
        return createJsonResponse(apiAddLoan(params.loan, params.token));
        
      case 'editLoan':
        return createJsonResponse(apiEditLoan(params.id, params.data, params.token));
        
      case 'confirmReturn':
        return createJsonResponse(apiConfirmReturn(params.id, params.data, params.token));
        
      case 'deleteLoan':
        return createJsonResponse(apiDeleteLoan(params.id, params.token));
        
      case 'updateItemStock':
        return createJsonResponse(apiUpdateItemStock(params.item, params.token));
        
      default:
        return createJsonResponse({ 
          success: false, 
          error: 'Aksi tidak dikenali atau parameter action kosong.' 
        });
    }
  } catch (error) {
    return createJsonResponse({
      success: false,
      error: 'Terjadi kesalahan server: ' + error.message
    });
  }
}

// Helper Response JSON
function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// =========================================================================
// SETUP DATABASE OTOMATIS
// =========================================================================

/**
 * Jalankan fungsi ini sekali dari editor Google Apps Script atau panggil via action=setup
 * untuk membuat seluruh Sheet, kolom header, sample barang, dan akun admin default.
 */
function setupDatabase() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. Sheet Barang (Master Stok)
  var sheetItems = getOrCreateSheet(ss, CONFIG.SHEET_ITEMS);
  if (sheetItems.getLastRow() === 0) {
    var itemHeaders = ['id', 'namaBarang', 'stokTotal', 'stokTersedia', 'satuan', 'keterangan'];
    sheetItems.appendRow(itemHeaders);
    formatHeaderRow(sheetItems, itemHeaders.length);
    
    // Data awal barang BoloPecah
    var sampleItems = [
      ['BRG-001', 'Piring Makan', 250, 250, 'pcs', 'Piring keramik putih'],
      ['BRG-002', 'Sendok Makan', 300, 300, 'pcs', 'Sendok stainless'],
      ['BRG-003', 'Garpu Makan', 300, 300, 'pcs', 'Garpu stainless'],
      ['BRG-004', 'Gelas Kaca', 250, 250, 'pcs', 'Gelas bening'],
      ['BRG-005', 'Mangkok Bakso / Sup', 150, 150, 'pcs', 'Mangkok keramik'],
      ['BRG-006', 'Cangkir + Tatakan', 60, 60, 'set', 'Set cangkir kopi/teh'],
      ['BRG-007', 'Dandang Nasi Besar', 5, 5, 'unit', 'Dandang dandangan hajat'],
      ['BRG-008', 'Wajan Besar', 6, 6, 'unit', 'Wajan masak serbaguna'],
      ['BRG-009', 'Termos Nasi / Es', 10, 10, 'unit', 'Termos 30 liter'],
      ['BRG-010', 'Meja Lipat Prasmanan', 20, 20, 'unit', 'Meja panjang lipat'],
      ['BRG-011', 'Kursi Plastik', 200, 200, 'unit', 'Kursi tamu merah/hijau'],
      ['BRG-012', 'Terpal Tenda', 8, 8, 'lembar', 'Terpal biru 4x6 meter']
    ];
    sampleItems.forEach(function(row) {
      sheetItems.appendRow(row);
    });
  }
  
  // 2. Sheet Peminjaman (Header Transaksi)
  var sheetLoans = getOrCreateSheet(ss, CONFIG.SHEET_LOANS);
  if (sheetLoans.getLastRow() === 0) {
    var loanHeaders = [
      'id', 'borrowerName', 'loanDate', 'penanggungJawab',
      'ringkasanBarang', 'itemsJson', 'returnedItemsJson',
      'isReturned', 'returnNotes', 'createdAt', 'createdBy',
      'returnedAt', 'returnedBy', 'updatedAt', 'updatedBy'
    ];
    sheetLoans.appendRow(loanHeaders);
    formatHeaderRow(sheetLoans, loanHeaders.length);
  }
  
  // 3. Sheet Detail Peminjaman (Relasional untuk pencatatan per item)
  var sheetDetail = getOrCreateSheet(ss, CONFIG.SHEET_DETAIL);
  if (sheetDetail.getLastRow() === 0) {
    var detailHeaders = [
      'id', 'loanId', 'borrowerName', 'loanDate',
      'namaBarang', 'jumlahPinjam', 'jumlahKembali', 'kurang',
      'keterangan', 'status'
    ];
    sheetDetail.appendRow(detailHeaders);
    formatHeaderRow(sheetDetail, detailHeaders.length);
  }
  
  // 4. Sheet Users (Autentikasi Admin)
  var sheetUsers = getOrCreateSheet(ss, CONFIG.SHEET_USERS);
  if (sheetUsers.getLastRow() === 0) {
    var userHeaders = ['id', 'email', 'passwordHash', 'role', 'nama', 'token', 'tokenExpiry'];
    sheetUsers.appendRow(userHeaders);
    formatHeaderRow(sheetUsers, userHeaders.length);
    
    // Akun admin default
    var defaultHash = hashPassword(CONFIG.DEFAULT_ADMIN_PASS);
    sheetUsers.appendRow([
      'USR-001',
      CONFIG.DEFAULT_ADMIN_EMAIL,
      defaultHash,
      'admin',
      'Pengurus BoloPecah',
      '',
      ''
    ]);
  }
  
  return {
    success: true,
    message: 'Struktur database Google Sheets berhasil disiapkan!',
    defaultAdmin: {
      email: CONFIG.DEFAULT_ADMIN_EMAIL,
      passwordDefault: CONFIG.DEFAULT_ADMIN_PASS
    }
  };
}

function getOrCreateSheet(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  return sheet;
}

function formatHeaderRow(sheet, numColumns) {
  var range = sheet.getRange(1, 1, 1, numColumns);
  range.setBackground('#2c3e50')
       .setFontColor('#ffffff')
       .setFontWeight('bold');
  sheet.setFrozenRows(1);
}

// =========================================================================
// MENU KHUSUS SPREADSHEET & GANTI PASSWORD ADMIN
// =========================================================================

/**
 * Menu otomatis yang muncul di toolbar Google Spreadsheet
 * Memudahkan pemilik spreadsheet untuk ganti password langsung tanpa buka kode!
 */
function onOpen() {
  try {
    var ui = SpreadsheetApp.getUi();
    ui.createMenu('⚙️ Admin BoloPecah')
      .addItem('🔑 Ganti Email & Password Admin', 'menuGantiPassword')
      .addItem('📦 Inisialisasi Ulang Struktur Database', 'setupDatabase')
      .addToUi();
  } catch (e) {
    // Abaikan jika dibuka dalam konteks non-UI (misal trigger web app)
  }
}

/**
 * Dialog interaktif untuk mengganti email dan password dari Google Sheets
 */
function menuGantiPassword() {
  var ui = SpreadsheetApp.getUi();
  
  var emailPrompt = ui.prompt('Ganti Akun Admin', 'Masukkan Email Admin Baru (contoh: ketua@bolopecah.com):', ui.ButtonSet.OK_CANCEL);
  if (emailPrompt.getSelectedButton() !== ui.Button.OK) return;
  var emailBaru = emailPrompt.getResponseText().trim();
  if (!emailBaru) {
    ui.alert('Peringatan', 'Email tidak boleh kosong!', ui.ButtonSet.OK);
    return;
  }
  
  var passPrompt = ui.prompt('Ganti Akun Admin', 'Masukkan Password Baru:', ui.ButtonSet.OK_CANCEL);
  if (passPrompt.getSelectedButton() !== ui.Button.OK) return;
  var passBaru = passPrompt.getResponseText();
  if (!passBaru) {
    ui.alert('Peringatan', 'Password tidak boleh kosong!', ui.ButtonSet.OK);
    return;
  }
  
  var namaPrompt = ui.prompt('Ganti Akun Admin', 'Masukkan Nama Tampilan Pengurus (Opsional, tekan OK untuk default):', ui.ButtonSet.OK_CANCEL);
  var namaBaru = namaPrompt.getSelectedButton() === ui.Button.OK ? namaPrompt.getResponseText().trim() : '';
  if (!namaBaru) namaBaru = 'Pengurus BoloPecah';
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SHEET_USERS);
  if (!sheet) {
    ui.alert('Error', 'Sheet "Users" belum ditemukan. Jalankan menu inisialisasi terlebih dahulu.', ui.ButtonSet.OK);
    return;
  }
  
  var newHash = hashPassword(passBaru);
  var data = sheet.getDataRange().getValues();
  
  if (data.length <= 1) {
    sheet.appendRow(['USR-001', emailBaru, newHash, 'admin', namaBaru, '', '']);
  } else {
    // Update baris admin pertama (baris ke-2)
    sheet.getRange(2, 2).setValue(emailBaru);
    sheet.getRange(2, 3).setValue(newHash);
    sheet.getRange(2, 5).setValue(namaBaru);
    sheet.getRange(2, 6).setValue(''); // Reset token lama
    sheet.getRange(2, 7).setValue('');
  }
  
  ui.alert('✅ Berhasil!', 'Akun admin berhasil diubah:\n- Email: ' + emailBaru + '\n- Nama: ' + namaBaru + '\n\nSilakan gunakan email dan password baru ini untuk login pada web app!', ui.ButtonSet.OK);
}

/**
 * FUNGSI ALTERNATIF: Jalankan fungsi ini dari editor Apps Script jika ingin ganti lewat script
 */
function gantiAkunAdminScript() {
  // Masukkan email dan password baru Anda di sini:
  var emailBaru = "admin@bolopecah.com";
  var passwordBaru = "password_baru_anda";
  var namaBaru = "Pengurus BoloPecah";
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SHEET_USERS);
  if (!sheet) {
    Logger.log("Error: Sheet Users tidak ditemukan.");
    return;
  }
  
  var newHash = hashPassword(passwordBaru);
  sheet.getRange(2, 2).setValue(emailBaru);
  sheet.getRange(2, 3).setValue(newHash);
  sheet.getRange(2, 5).setValue(namaBaru);
  sheet.getRange(2, 6).setValue('');
  sheet.getRange(2, 7).setValue('');
  
  Logger.log("BERHASIL! Akun admin telah diperbarui.");
  Logger.log("Email: " + emailBaru);
  Logger.log("Password hash tersimpan dengan aman.");
}

// =========================================================================
// AUTENTIKASI & KEAMANAN
// =========================================================================

function hashPassword(str) {
  var rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(str), Utilities.Charset.UTF_8);
  var txtHash = '';
  for (var i = 0; i < rawHash.length; i++) {
    var hashVal = rawHash[i];
    if (hashVal < 0) hashVal += 256;
    var byteString = hashVal.toString(16);
    if (byteString.length == 1) byteString = '0' + byteString;
    txtHash += byteString;
  }
  return txtHash;
}

function apiLogin(email, password) {
  if (!email || !password) {
    return { success: false, error: 'Email dan password harus diisi.' };
  }
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SHEET_USERS);
  if (!sheet) {
    return { success: false, error: 'Database users belum disiapkan. Jalankan setup terlebih dahulu.' };
  }
  
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) {
    return { success: false, error: 'Belum ada akun admin terdaftar.' };
  }
  
  var cleanEmail = String(email).trim().toLowerCase();
  var passHash = hashPassword(password);
  
  // Kolom: [0: id, 1: email, 2: passwordHash, 3: role, 4: nama, 5: token, 6: tokenExpiry]
  for (var i = 1; i < data.length; i++) {
    var rowEmail = String(data[i][1]).trim().toLowerCase();
    var rowHash = String(data[i][2]);
    
    if (rowEmail === cleanEmail && rowHash === passHash) {
      // Generate new token & expiry
      var token = Utilities.getUuid();
      var expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + CONFIG.TOKEN_EXPIRY_DAYS);
      var expiryIso = expiryDate.toISOString();
      
      // Update token & expiry di sheet
      sheet.getRange(i + 1, 6).setValue(token);
      sheet.getRange(i + 1, 7).setValue(expiryIso);
      
      return {
        success: true,
        token: token,
        user: {
          email: data[i][1],
          role: data[i][3] || 'admin',
          nama: data[i][4] || 'Admin'
        }
      };
    }
  }
  
  return { success: false, error: 'Email atau password salah.' };
}

function apiLogout(token) {
  if (!token) return { success: true };
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SHEET_USERS);
  if (!sheet) return { success: true };
  
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][5] === token) {
      sheet.getRange(i + 1, 6).setValue('');
      sheet.getRange(i + 1, 7).setValue('');
      break;
    }
  }
  return { success: true, message: 'Logout berhasil.' };
}

function verifyUserToken(token) {
  if (!token) return null;
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SHEET_USERS);
  if (!sheet) return null;
  
  var data = sheet.getDataRange().getValues();
  var now = new Date();
  
  for (var i = 1; i < data.length; i++) {
    var rowToken = data[i][5];
    var rowExpiry = data[i][6];
    
    if (rowToken === token) {
      if (rowExpiry) {
        var expDate = new Date(rowExpiry);
        if (expDate < now) {
          return null; // Token kadaluarsa
        }
      }
      return {
        email: data[i][1],
        role: data[i][3] || 'admin',
        nama: data[i][4] || 'Admin'
      };
    }
  }
  return null;
}

function apiCheckAuth(token) {
  var user = verifyUserToken(token);
  if (user) {
    return { success: true, user: user };
  }
  return { success: false, error: 'Token tidak valid atau telah kadaluarsa.' };
}

// =========================================================================
// OPERASI DATA BARANG (ITEMS & STOK)
// =========================================================================

function apiGetItems() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SHEET_ITEMS);
  if (!sheet) return { success: true, data: [] };
  
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { success: true, data: [] };
  
  var items = [];
  // Kolom: [0: id, 1: namaBarang, 2: stokTotal, 3: stokTersedia, 4: satuan, 5: keterangan]
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (row[1]) {
      items.push({
        id: row[0],
        namaBarang: String(row[1]).trim(),
        stokTotal: Number(row[2]) || 0,
        stokTersedia: Number(row[3]) || 0,
        satuan: row[4] || 'pcs',
        keterangan: row[5] || ''
      });
    }
  }
  return { success: true, data: items };
}

function apiUpdateItemStock(itemData, token) {
  var user = verifyUserToken(token);
  if (!user) {
    return { success: false, error: 'Akses ditolak. Silakan login sebagai admin.' };
  }
  
  if (!itemData || !itemData.namaBarang) {
    return { success: false, error: 'Nama barang wajib diisi.' };
  }
  
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEET_ITEMS);
    if (!sheet) return { success: false, error: 'Sheet barang tidak ditemukan.' };
    
    var data = sheet.getDataRange().getValues();
    var cleanName = String(itemData.namaBarang).trim().toLowerCase();
    var foundIndex = -1;
    
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][1]).trim().toLowerCase() === cleanName) {
        foundIndex = i + 1;
        break;
      }
    }
    
    if (foundIndex > 0) {
      // Update
      if (itemData.stokTotal !== undefined) sheet.getRange(foundIndex, 3).setValue(Number(itemData.stokTotal));
      if (itemData.stokTersedia !== undefined) sheet.getRange(foundIndex, 4).setValue(Number(itemData.stokTersedia));
      if (itemData.satuan !== undefined) sheet.getRange(foundIndex, 5).setValue(itemData.satuan);
      if (itemData.keterangan !== undefined) sheet.getRange(foundIndex, 6).setValue(itemData.keterangan);
    } else {
      // Tambah baru
      var newId = 'BRG-' + String(data.length).padStart(3, '0');
      var total = Number(itemData.stokTotal) || 0;
      var tersedia = itemData.stokTersedia !== undefined ? Number(itemData.stokTersedia) : total;
      sheet.appendRow([
        newId,
        String(itemData.namaBarang).trim(),
        total,
        tersedia,
        itemData.satuan || 'pcs',
        itemData.keterangan || ''
      ]);
    }
    
    return { success: true, message: 'Data stok barang berhasil diperbarui.' };
  } catch (e) {
    return { success: false, error: 'Gagal update stok: ' + e.message };
  } finally {
    lock.releaseLock();
  }
}

// =========================================================================
// OPERASI DATA PEMINJAMAN (LOANS CRUD)
// =========================================================================

function apiGetLoans() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SHEET_LOANS);
  if (!sheet) return { success: true, data: [] };
  
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { success: true, data: [] };
  
  var loans = [];
  // Header:
  // 0: id, 1: borrowerName, 2: loanDate, 3: penanggungJawab,
  // 4: ringkasanBarang, 5: itemsJson, 6: returnedItemsJson,
  // 7: isReturned, 8: returnNotes, 9: createdAt, 10: createdBy,
  // 11: returnedAt, 12: returnedBy, 13: updatedAt, 14: updatedBy
  
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[0]) continue;
    
    var items = [];
    var returnedItems = [];
    
    try {
      items = row[5] ? JSON.parse(row[5]) : [];
    } catch (e) {
      items = [];
    }
    
    try {
      returnedItems = row[6] ? JSON.parse(row[6]) : [];
    } catch (e) {
      returnedItems = [];
    }
    
    var isReturned = false;
    if (typeof row[7] === 'boolean') {
      isReturned = row[7];
    } else if (String(row[7]).toUpperCase() === 'TRUE') {
      isReturned = true;
    }
    
    loans.push({
      id: String(row[0]),
      borrowerName: String(row[1] || ''),
      loanDate: formatDateString(row[2]),
      penanggungJawab: String(row[3] || ''),
      items: items,
      returnedItems: returnedItems,
      isReturned: isReturned,
      returnNotes: String(row[8] || ''),
      createdAt: row[9] ? String(row[9]) : '',
      createdBy: String(row[10] || ''),
      returnedAt: row[11] ? String(row[11]) : '',
      returnedBy: String(row[12] || ''),
      updatedAt: row[13] ? String(row[13]) : '',
      updatedBy: String(row[14] || '')
    });
  }
  
  // Sort descending berdasarkan createdAt / row terbaru
  loans.reverse();
  
  return { success: true, data: loans };
}

function formatDateString(val) {
  if (!val) return '';
  if (val instanceof Date) {
    var y = val.getFullYear();
    var m = String(val.getMonth() + 1).padStart(2, '0');
    var d = String(val.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }
  return String(val);
}

// -------------------------------------------------------------------------
// TAMBAH PINJAMAN BARU (DENGAN PENGECEKAN & PENGURANGAN STOK)
// -------------------------------------------------------------------------

function apiAddLoan(loan, token) {
  var user = verifyUserToken(token);
  if (!user) {
    return { success: false, error: 'Akses ditolak. Silakan login sebagai admin.' };
  }
  
  if (!loan || !loan.borrowerName || !loan.items || loan.items.length === 0) {
    return { success: false, error: 'Data peminjaman tidak lengkap.' };
  }
  
  var lock = LockService.getScriptLock();
  try {
    // Kunci proses selama maksimal 30 detik untuk mencegah race condition
    lock.waitLock(30000);
    
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetLoans = ss.getSheetByName(CONFIG.SHEET_LOANS);
    var sheetItems = ss.getSheetByName(CONFIG.SHEET_ITEMS);
    var sheetDetail = ss.getSheetByName(CONFIG.SHEET_DETAIL);
    
    if (!sheetLoans || !sheetItems) {
      return { success: false, error: 'Database belum siap. Jalankan setup terlebih dahulu.' };
    }
    
    // Baca seluruh master barang untuk validasi stok
    var itemsData = sheetItems.getDataRange().getValues();
    var itemsMap = {}; // key: lowercase name -> { rowIndex, rowData }
    for (var i = 1; i < itemsData.length; i++) {
      var nameKey = String(itemsData[i][1]).trim().toLowerCase();
      itemsMap[nameKey] = {
        rowIndex: i + 1,
        id: itemsData[i][0],
        nama: itemsData[i][1],
        stokTotal: Number(itemsData[i][2]) || 0,
        stokTersedia: Number(itemsData[i][3]) || 0,
        satuan: itemsData[i][4] || 'pcs'
      };
    }
    
    // 1. Validasi kecukupan stok untuk SEMUA barang yang diminta
    for (var j = 0; j < loan.items.length; j++) {
      var itemReq = loan.items[j];
      var reqName = String(itemReq.name || '').trim();
      var reqKey = reqName.toLowerCase();
      var reqQty = parseInt(itemReq.quantity, 10) || 0;
      
      if (reqQty <= 0) {
        return { success: false, error: 'Jumlah barang "' + reqName + '" harus lebih dari 0.' };
      }
      
      if (itemsMap[reqKey]) {
        var available = itemsMap[reqKey].stokTersedia;
        if (reqQty > available) {
          return { 
            success: false, 
            error: 'Stok tidak mencukupi untuk "' + reqName + '". Tersedia: ' + available + ' ' + itemsMap[reqKey].satuan + ', diminta: ' + reqQty + '.' 
          };
        }
      }
    }
    
    // 2. Eksekusi pemotongan stok pada master barang
    for (var k = 0; k < loan.items.length; k++) {
      var itemDeduct = loan.items[k];
      var dKey = String(itemDeduct.name || '').trim().toLowerCase();
      var dQty = parseInt(itemDeduct.quantity, 10) || 0;
      
      if (itemsMap[dKey]) {
        var targetRow = itemsMap[dKey].rowIndex;
        var newTersedia = itemsMap[dKey].stokTersedia - dQty;
        sheetItems.getRange(targetRow, 4).setValue(newTersedia);
        itemsMap[dKey].stokTersedia = newTersedia; // update in-memory
      } else {
        // Jika barang belum terdaftar di master barang, otomatis daftarkan
        var newBrgId = 'BRG-' + String(sheetItems.getLastRow()).padStart(3, '0');
        sheetItems.appendRow([
          newBrgId,
          String(itemDeduct.name).trim(),
          dQty,
          0, // Tersedia 0 karena semua langsung dipinjam
          'pcs',
          'Didaftarkan otomatis dari peminjaman'
        ]);
      }
    }
    
    // 3. Simpan data transaksi peminjaman ke sheet Peminjaman
    var nowIso = new Date().toISOString();
    var loanId = loan.id || generateInvoiceId();
    
    var summaryArray = [];
    loan.items.forEach(function(it) {
      summaryArray.push(it.name + ' (' + it.quantity + ')');
    });
    var ringkasan = summaryArray.join(', ');
    
    sheetLoans.appendRow([
      loanId,
      loan.borrowerName,
      loan.loanDate,
      loan.penanggungJawab || '-',
      ringkasan,
      JSON.stringify(loan.items),
      JSON.stringify(loan.returnedItems || []),
      false, // isReturned
      loan.returnNotes || '',
      nowIso,
      user.email,
      '', // returnedAt
      '', // returnedBy
      '', // updatedAt
      ''  // updatedBy
    ]);
    
    // 4. Catat ke sheet Detail Peminjaman (relasional) jika sheet ada
    if (sheetDetail) {
      loan.items.forEach(function(it, idx) {
        sheetDetail.appendRow([
          'DET-' + loanId + '-' + (idx + 1),
          loanId,
          loan.borrowerName,
          loan.loanDate,
          it.name,
          it.quantity,
          0, // jumlahKembali
          it.quantity, // kurang
          it.note || '',
          'Dipinjam'
        ]);
      });
    }
    
    return {
      success: true,
      id: loanId,
      message: 'Data peminjaman berhasil disimpan dan stok barang telah dikurangi.'
    };
  } catch (e) {
    return { success: false, error: 'Gagal memproses peminjaman: ' + e.message };
  } finally {
    lock.releaseLock();
  }
}

// -------------------------------------------------------------------------
// KONFIRMASI PENGEMBALIAN BARANG (DENGAN PENGEMBALIAN STOK KE GUDANG)
// -------------------------------------------------------------------------

function apiConfirmReturn(id, returnData, token) {
  var user = verifyUserToken(token);
  if (!user) {
    return { success: false, error: 'Akses ditolak. Silakan login sebagai admin.' };
  }
  
  if (!id) {
    return { success: false, error: 'ID peminjaman wajib disertakan.' };
  }
  
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetLoans = ss.getSheetByName(CONFIG.SHEET_LOANS);
    var sheetItems = ss.getSheetByName(CONFIG.SHEET_ITEMS);
    var sheetDetail = ss.getSheetByName(CONFIG.SHEET_DETAIL);
    
    if (!sheetLoans || !sheetItems) {
      return { success: false, error: 'Database belum siap.' };
    }
    
    var loansData = sheetLoans.getDataRange().getValues();
    var targetRow = -1;
    var currentLoanRow = null;
    
    for (var i = 1; i < loansData.length; i++) {
      if (String(loansData[i][0]) === String(id)) {
        targetRow = i + 1;
        currentLoanRow = loansData[i];
        break;
      }
    }
    
    if (targetRow === -1) {
      return { success: false, error: 'Data peminjaman dengan ID "' + id + '" tidak ditemukan.' };
    }
    
    // Cek apakah sudah pernah dikembalikan (cegah pengembalian stok ganda)
    var alreadyReturned = false;
    if (typeof currentLoanRow[7] === 'boolean') {
      alreadyReturned = currentLoanRow[7];
    } else if (String(currentLoanRow[7]).toUpperCase() === 'TRUE') {
      alreadyReturned = true;
    }
    
    if (alreadyReturned) {
      return { success: false, error: 'Peminjaman ini sudah pernah dikonfirmasi sebelumnya. Pengembalian stok ganda dicegah.' };
    }
    
    // Parse daftar barang asli dan barang yang dikembalikan
    var originalItems = [];
    try {
      originalItems = JSON.parse(currentLoanRow[5]);
    } catch (e) {
      originalItems = [];
    }
    
    var returnedItems = returnData.returnedItems || [];
    var returnNotes = returnData.returnNotes || '';
    
    // Map master barang untuk pengembalian stok
    var itemsData = sheetItems.getDataRange().getValues();
    var itemsRowMap = {};
    for (var m = 1; m < itemsData.length; m++) {
      var nKey = String(itemsData[m][1]).trim().toLowerCase();
      itemsRowMap[nKey] = {
        rowIndex: m + 1,
        stokTotal: Number(itemsData[m][2]) || 0,
        stokTersedia: Number(itemsData[m][3]) || 0
      };
    }
    
    // 1. Kembalikan stok fisik ke master barang sesuai jumlah yang benar-benar kembali (returned)
    for (var j = 0; j < originalItems.length; j++) {
      var orig = originalItems[j];
      var oKey = String(orig.name || '').trim().toLowerCase();
      var retObj = returnedItems[j] || { returned: orig.quantity, kurang: 0 };
      var qtyReturned = parseInt(retObj.returned, 10) || 0;
      
      if (qtyReturned > 0 && itemsRowMap[oKey]) {
        var rowIdx = itemsRowMap[oKey].rowIndex;
        var currentTersedia = itemsRowMap[oKey].stokTersedia;
        var maxTotal = itemsRowMap[oKey].stokTotal;
        var newTersedia = Math.min(maxTotal, currentTersedia + qtyReturned);
        
        sheetItems.getRange(rowIdx, 4).setValue(newTersedia);
        itemsRowMap[oKey].stokTersedia = newTersedia;
      }
    }
    
    // 2. Update status peminjaman di sheet Peminjaman
    var nowIso = new Date().toISOString();
    sheetLoans.getRange(targetRow, 7).setValue(JSON.stringify(returnedItems)); // returnedItemsJson
    sheetLoans.getRange(targetRow, 8).setValue(true); // isReturned
    sheetLoans.getRange(targetRow, 9).setValue(returnNotes); // returnNotes
    sheetLoans.getRange(targetRow, 12).setValue(nowIso); // returnedAt
    sheetLoans.getRange(targetRow, 13).setValue(user.email); // returnedBy
    
    // 3. Update status pada sheet Detail Peminjaman
    if (sheetDetail) {
      var detailData = sheetDetail.getDataRange().getValues();
      for (var d = 1; d < detailData.length; d++) {
        if (String(detailData[d][1]) === String(id)) {
          var itemIndex = -1;
          for (var o = 0; o < originalItems.length; o++) {
            if (String(originalItems[o].name).trim().toLowerCase() === String(detailData[d][4]).trim().toLowerCase()) {
              itemIndex = o;
              break;
            }
          }
          if (itemIndex >= 0 && returnedItems[itemIndex]) {
            var rQty = returnedItems[itemIndex].returned;
            var kQty = returnedItems[itemIndex].kurang;
            var stText = kQty > 0 ? 'Kurang ' + kQty : 'Lengkap';
            sheetDetail.getRange(d + 1, 7).setValue(rQty); // jumlahKembali
            sheetDetail.getRange(d + 1, 8).setValue(kQty); // kurang
            sheetDetail.getRange(d + 1, 10).setValue(stText); // status
          }
        }
      }
    }
    
    return {
      success: true,
      message: 'Konfirmasi pengembalian berhasil dicatat dan stok barang telah dikembalikan ke sistem.'
    };
  } catch (e) {
    return { success: false, error: 'Gagal konfirmasi pengembalian: ' + e.message };
  } finally {
    lock.releaseLock();
  }
}

// -------------------------------------------------------------------------
// EDIT PEMINJAMAN (DENGAN PENYESUAIAN SELISIH STOK)
// -------------------------------------------------------------------------

function apiEditLoan(id, editData, token) {
  var user = verifyUserToken(token);
  if (!user) {
    return { success: false, error: 'Akses ditolak. Silakan login sebagai admin.' };
  }
  
  if (!id || !editData) {
    return { success: false, error: 'Parameter edit tidak lengkap.' };
  }
  
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetLoans = ss.getSheetByName(CONFIG.SHEET_LOANS);
    var sheetItems = ss.getSheetByName(CONFIG.SHEET_ITEMS);
    var sheetDetail = ss.getSheetByName(CONFIG.SHEET_DETAIL);
    
    if (!sheetLoans || !sheetItems) {
      return { success: false, error: 'Database belum siap.' };
    }
    
    var loansData = sheetLoans.getDataRange().getValues();
    var targetRow = -1;
    var currentLoanRow = null;
    
    for (var i = 1; i < loansData.length; i++) {
      if (String(loansData[i][0]) === String(id)) {
        targetRow = i + 1;
        currentLoanRow = loansData[i];
        break;
      }
    }
    
    if (targetRow === -1) {
      return { success: false, error: 'Data peminjaman tidak ditemukan.' };
    }
    
    var isReturned = false;
    if (typeof currentLoanRow[7] === 'boolean') {
      isReturned = currentLoanRow[7];
    } else if (String(currentLoanRow[7]).toUpperCase() === 'TRUE') {
      isReturned = true;
    }
    
    var oldItems = [];
    try {
      oldItems = JSON.parse(currentLoanRow[5]);
    } catch (e) {
      oldItems = [];
    }
    
    var newItems = editData.items || oldItems;
    
    // Jika pinjaman BELUM dikembalikan, sesuaikan perbedaan stok
    if (!isReturned) {
      var itemsData = sheetItems.getDataRange().getValues();
      var itemsMap = {};
      for (var m = 1; m < itemsData.length; m++) {
        var nKey = String(itemsData[m][1]).trim().toLowerCase();
        itemsMap[nKey] = {
          rowIndex: m + 1,
          nama: itemsData[m][1],
          stokTotal: Number(itemsData[m][2]) || 0,
          stokTersedia: Number(itemsData[m][3]) || 0,
          satuan: itemsData[m][4] || 'pcs'
        };
      }
      
      // Hitung kuantitas lama per barang
      var oldQtyMap = {};
      oldItems.forEach(function(it) {
        var k = String(it.name).trim().toLowerCase();
        oldQtyMap[k] = (oldQtyMap[k] || 0) + (parseInt(it.quantity, 10) || 0);
      });
      
      // Hitung kuantitas baru per barang
      var newQtyMap = {};
      newItems.forEach(function(it) {
        var k = String(it.name).trim().toLowerCase();
        newQtyMap[k] = (newQtyMap[k] || 0) + (parseInt(it.quantity, 10) || 0);
      });
      
      // Gabungkan seluruh jenis barang untuk hitung selisih
      var allKeys = {};
      for (var ok in oldQtyMap) allKeys[ok] = true;
      for (var nk in newQtyMap) allKeys[nk] = true;
      
      // Validasi: jika penambahan kuantitas melebihi stok yang ada
      for (var kKey in allKeys) {
        var oldQ = oldQtyMap[kKey] || 0;
        var newQ = newQtyMap[kKey] || 0;
        var diff = newQ - oldQ; // Jika positif -> butuh tambahan stok
        
        if (diff > 0 && itemsMap[kKey]) {
          var curAvailable = itemsMap[kKey].stokTersedia;
          if (diff > curAvailable) {
            return {
              success: false,
              error: 'Stok tambahan untuk "' + itemsMap[kKey].nama + '" tidak mencukupi! Butuh tambahan ' + diff + ' ' + itemsMap[kKey].satuan + ', tersedia: ' + curAvailable + '.'
            };
          }
        }
      }
      
      // Terapkan penyesuaian stok
      for (var aKey in allKeys) {
        var oldVal = oldQtyMap[aKey] || 0;
        var newVal = newQtyMap[aKey] || 0;
        var delta = newVal - oldVal;
        
        if (itemsMap[aKey] && delta !== 0) {
          var rIdx = itemsMap[aKey].rowIndex;
          var updatedTersedia = itemsMap[aKey].stokTersedia - delta;
          sheetItems.getRange(rIdx, 4).setValue(updatedTersedia);
          itemsMap[aKey].stokTersedia = updatedTersedia;
        }
      }
    }
    
    // Update data di sheet Peminjaman
    var nowIso = new Date().toISOString();
    var sumArr = [];
    newItems.forEach(function(it) {
      sumArr.push(it.name + ' (' + it.quantity + ')');
    });
    var ringkasanBarang = sumArr.join(', ');
    
    if (editData.borrowerName) sheetLoans.getRange(targetRow, 2).setValue(editData.borrowerName);
    if (editData.loanDate) sheetLoans.getRange(targetRow, 3).setValue(editData.loanDate);
    if (editData.penanggungJawab) sheetLoans.getRange(targetRow, 4).setValue(editData.penanggungJawab);
    sheetLoans.getRange(targetRow, 5).setValue(ringkasanBarang);
    sheetLoans.getRange(targetRow, 6).setValue(JSON.stringify(newItems));
    if (editData.returnNotes !== undefined) sheetLoans.getRange(targetRow, 9).setValue(editData.returnNotes);
    sheetLoans.getRange(targetRow, 14).setValue(nowIso); // updatedAt
    sheetLoans.getRange(targetRow, 15).setValue(user.email); // updatedBy
    
    return {
      success: true,
      message: 'Perubahan data peminjaman berhasil disimpan.'
    };
  } catch (e) {
    return { success: false, error: 'Gagal memperbarui data: ' + e.message };
  } finally {
    lock.releaseLock();
  }
}

// -------------------------------------------------------------------------
// HAPUS PEMINJAMAN (KEMBALIKAN STOK JIKA BELUM PERNAH DIKEMBALIKAN)
// -------------------------------------------------------------------------

function apiDeleteLoan(id, token) {
  var user = verifyUserToken(token);
  if (!user) {
    return { success: false, error: 'Akses ditolak. Silakan login sebagai admin.' };
  }
  
  if (!id) {
    return { success: false, error: 'ID peminjaman wajib disertakan.' };
  }
  
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetLoans = ss.getSheetByName(CONFIG.SHEET_LOANS);
    var sheetItems = ss.getSheetByName(CONFIG.SHEET_ITEMS);
    var sheetDetail = ss.getSheetByName(CONFIG.SHEET_DETAIL);
    
    if (!sheetLoans) return { success: false, error: 'Sheet peminjaman tidak ditemukan.' };
    
    var loansData = sheetLoans.getDataRange().getValues();
    var targetRow = -1;
    var targetLoan = null;
    
    for (var i = 1; i < loansData.length; i++) {
      if (String(loansData[i][0]) === String(id)) {
        targetRow = i + 1;
        targetLoan = loansData[i];
        break;
      }
    }
    
    if (targetRow === -1) {
      return { success: false, error: 'Data peminjaman tidak ditemukan.' };
    }
    
    var isReturned = false;
    if (typeof targetLoan[7] === 'boolean') {
      isReturned = targetLoan[7];
    } else if (String(targetLoan[7]).toUpperCase() === 'TRUE') {
      isReturned = true;
    }
    
    // Jika data pinjaman yang dihapus BELUM kembali, kembalikan stok barang yang dipinjam ke stok tersedia
    if (!isReturned && sheetItems) {
      var items = [];
      try {
        items = JSON.parse(targetLoan[5]);
      } catch (e) {
        items = [];
      }
      
      var itemsData = sheetItems.getDataRange().getValues();
      var itemsMap = {};
      for (var m = 1; m < itemsData.length; m++) {
        var nKey = String(itemsData[m][1]).trim().toLowerCase();
        itemsMap[nKey] = {
          rowIndex: m + 1,
          stokTotal: Number(itemsData[m][2]) || 0,
          stokTersedia: Number(itemsData[m][3]) || 0
        };
      }
      
      items.forEach(function(it) {
        var k = String(it.name || '').trim().toLowerCase();
        var q = parseInt(it.quantity, 10) || 0;
        if (itemsMap[k] && q > 0) {
          var rIdx = itemsMap[k].rowIndex;
          var restored = Math.min(itemsMap[k].stokTotal, itemsMap[k].stokTersedia + q);
          sheetItems.getRange(rIdx, 4).setValue(restored);
          itemsMap[k].stokTersedia = restored;
        }
      });
    }
    
    // Hapus baris dari sheet Peminjaman
    sheetLoans.deleteRow(targetRow);
    
    // Hapus juga baris terkait dari sheet Detail Peminjaman jika ada
    if (sheetDetail) {
      var detailData = sheetDetail.getDataRange().getValues();
      for (var d = detailData.length - 1; d >= 1; d--) {
        if (String(detailData[d][1]) === String(id)) {
          sheetDetail.deleteRow(d + 1);
        }
      }
    }
    
    return {
      success: true,
      message: 'Data peminjaman berhasil dihapus.' + (!isReturned ? ' Stok barang yang belum kembali telah dipulihkan.' : '')
    };
  } catch (e) {
    return { success: false, error: 'Gagal menghapus data: ' + e.message };
  } finally {
    lock.releaseLock();
  }
}

// -------------------------------------------------------------------------
// HELPER GENERATE INVOICE ID
// -------------------------------------------------------------------------
function generateInvoiceId() {
  var now = new Date();
  var y = now.getFullYear();
  var m = String(now.getMonth() + 1).padStart(2, '0');
  var d = String(now.getDate()).padStart(2, '0');
  var h = String(now.getHours()).padStart(2, '0');
  var min = String(now.getMinutes()).padStart(2, '0');
  var s = String(now.getSeconds()).padStart(2, '0');
  var ms = String(now.getMilliseconds()).padStart(3, '0');
  return 'NOTA-' + y + m + d + '-' + h + min + s + ms;
}
