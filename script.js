// =========================================================================
// BUKU SILIHAN DIGITAL - Google Sheets & Apps Script Version
// =========================================================================

// Application State
let loans = [];
let inventoryItems = [];
let currentFilter = { search: '', date: '' };
let currentUser = null;
let autoRefreshTimer = null;

// =========================================================================
// MODERN TOAST NOTIFICATIONS
// =========================================================================

function showToast(message, type = 'success') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    
    const icons = {
        success: '✓',
        error: '✕',
        warning: '⚠',
        info: 'ℹ'
    };
    
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.innerHTML = '<span class="toast-icon">' + (icons[type] || 'ℹ') + '</span>' +
        '<span class="toast-message">' + escapeHtml(message) + '</span>' +
        '<button class="toast-close" onclick="this.parentElement.remove()">×</button>';
    
    container.appendChild(toast);
    
    // Auto remove after 4 seconds
    setTimeout(function() {
        if (toast.parentElement) {
            toast.classList.add('toast-exit');
            setTimeout(function() {
                if (toast.parentElement) toast.remove();
            }, 300);
        }
    }, 4000);
}

// =========================================================================
// MODERN CONFIRM DIALOG
// =========================================================================

function showConfirm(title, message, onConfirm, onCancel, type = 'warning') {
    const existing = document.querySelector('.confirm-overlay');
    if (existing) existing.remove();
    
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    
    const icons = {
        warning: '⚠',
        success: '✓',
        danger: '✕'
    };
    
    const titles = {
        warning: title || 'Konfirmasi',
        success: title || 'Berhasil',
        danger: title || 'Hapus Data'
    };
    
    overlay.innerHTML = '<div class="confirm-dialog">' +
        '<div class="confirm-icon ' + type + '">' + (icons[type] || '⚠') + '</div>' +
        '<div class="confirm-title">' + titles[type] + '</div>' +
        '<div class="confirm-message">' + message + '</div>' +
        '<div class="confirm-buttons">' +
        '<button class="confirm-btn cancel" id="confirmCancel">Batal</button>' +
        '<button class="confirm-btn confirm ' + (type === 'danger' ? 'danger' : 'primary') + '" id="confirmOk">Ya, Lanjutkan</button>' +
        '</div></div>';
    
    document.body.appendChild(overlay);
    
    document.getElementById('confirmCancel').onclick = function() {
        overlay.remove();
        if (onCancel) onCancel();
    };
    
    document.getElementById('confirmOk').onclick = function() {
        overlay.remove();
        if (onConfirm) onConfirm();
    };
    
    overlay.onclick = function(e) {
        if (e.target === overlay) {
            overlay.remove();
            if (onCancel) onCancel();
        }
    };
    
    document.addEventListener('keydown', function escHandler(e) {
        if (e.key === 'Escape') {
            overlay.remove();
            document.removeEventListener('keydown', escHandler);
            if (onCancel) onCancel();
        }
    });
}

// =========================================================================
// GOOGLE APPS SCRIPT API CLIENT
// =========================================================================

function getSessionToken() {
    return sessionStorage.getItem(API_CONFIG.STORAGE_KEY_TOKEN) || 
           localStorage.getItem(API_CONFIG.STORAGE_KEY_TOKEN);
}

function getStoredUser() {
    const raw = sessionStorage.getItem(API_CONFIG.STORAGE_KEY_USER) || 
                localStorage.getItem(API_CONFIG.STORAGE_KEY_USER);
    try {
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

function setSession(token, user) {
    if (token) {
        sessionStorage.setItem(API_CONFIG.STORAGE_KEY_TOKEN, token);
        sessionStorage.setItem(API_CONFIG.STORAGE_KEY_USER, JSON.stringify(user));
        localStorage.setItem(API_CONFIG.STORAGE_KEY_TOKEN, token);
        localStorage.setItem(API_CONFIG.STORAGE_KEY_USER, JSON.stringify(user));
    } else {
        sessionStorage.removeItem(API_CONFIG.STORAGE_KEY_TOKEN);
        sessionStorage.removeItem(API_CONFIG.STORAGE_KEY_USER);
        localStorage.removeItem(API_CONFIG.STORAGE_KEY_TOKEN);
        localStorage.removeItem(API_CONFIG.STORAGE_KEY_USER);
    }
}

async function callApi(action, data = {}) {
    const url = API_CONFIG.SCRIPT_URL;
    if (!url || url.includes('EXAMPLE_REPLACE_ME')) {
        throw new Error('URL Google Apps Script belum dikonfigurasi. Silakan periksa api-config.js.');
    }
    
    const token = getSessionToken();
    const payload = Object.assign({}, data, {
        action: action,
        token: token
    });
    
    // Gunakan text/plain untuk mencegah CORS preflight OPTIONS request pada Google Apps Script
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'text/plain;charset=utf-8'
        },
        body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
        throw new Error('Server merespons status HTTP ' + response.status);
    }
    
    const result = await response.json();
    if (!result.success) {
        throw new Error(result.error || 'Terjadi kesalahan sistem');
    }
    
    return result;
}

// =========================================================================
// INITIALIZATION
// =========================================================================

document.addEventListener('DOMContentLoaded', async function() {
    setupEventListeners();
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    
    // Default dates
    setDefaultDates();

    // Check stored user session
    const storedUser = getStoredUser();
    const token = getSessionToken();

    if (storedUser && token) {
        currentUser = storedUser;
        updateUIForAuth(currentUser);
        // Validasi token di latar belakang
        validateSessionToken();
    } else {
        currentUser = null;
        updateUIForAuth(null);
    }

    // Memuat data dari Google Sheets API
    await loadInitialData();

    // Setup periodic auto-refresh jika diaktifkan
    if (API_CONFIG.AUTO_REFRESH_INTERVAL && API_CONFIG.AUTO_REFRESH_INTERVAL > 0) {
        autoRefreshTimer = setInterval(function() {
            silentSyncData();
        }, API_CONFIG.AUTO_REFRESH_INTERVAL);
    }
});

async function validateSessionToken() {
    try {
        const res = await callApi('checkAuth');
        if (res.user) {
            currentUser = res.user;
            setSession(getSessionToken(), currentUser);
            updateUIForAuth(currentUser);
        }
    } catch (e) {
        // Jika token invalid/expired, reset ke guest mode
        console.warn('Sesi kadaluarsa:', e.message);
        setSession(null, null);
        currentUser = null;
        updateUIForAuth(null);
    }
}

async function loadInitialData() {
    try {
        await Promise.all([
            loadLoansFromApi(),
            loadItemsFromApi()
        ]);
    } catch (err) {
        console.error('Error saat inisialisasi data:', err);
        showToast('Gagal terhubung ke Google Sheets: ' + err.message, 'error');
    }
}

async function silentSyncData() {
    try {
        const loansRes = await callApi('getLoans');
        if (loansRes.data) {
            loans = loansRes.data;
            renderHistory();
        }
        const itemsRes = await callApi('getItems');
        if (itemsRes.data) {
            inventoryItems = itemsRes.data;
            populateBarangDatalist();
        }
    } catch (e) {
        // Silent background error, jangan ganggu user
    }
}

// =========================================================================
// UI & AUTHENTICATION STATE
// =========================================================================

function showLoginPage() {
    const loginPage = document.getElementById('loginPage');
    if (loginPage) loginPage.style.display = 'flex';
}

function closeLoginPage() {
    const loginPage = document.getElementById('loginPage');
    const errorDiv = document.getElementById('loginError');
    const loginForm = document.getElementById('loginForm');

    if (loginPage) loginPage.style.display = 'none';
    if (errorDiv) {
        errorDiv.textContent = '';
        errorDiv.classList.remove('show');
    }
    if (loginForm) loginForm.reset();
}

function showMainApp(user) {
    document.getElementById('loginPage').style.display = 'none';
    document.getElementById('mainApp').style.display = 'block';
    setDefaultDates();
}

function updateUIForAuth(user) {
    const isAdmin = !!user;

    // Show main app and hide login modal
    showMainApp(user);

    // Header buttons
    const btnLogin = document.getElementById('btnLogin');
    const btnLogout = document.getElementById('btnLogout');

    if (btnLogin) btnLogin.style.display = isAdmin ? 'none' : 'inline-flex';
    if (btnLogout) btnLogout.style.display = isAdmin ? 'inline-flex' : 'none';

    // Display user info
    const userEmailEl = document.getElementById('userEmail');
    if (userEmailEl) userEmailEl.textContent = isAdmin ? (user.nama || user.email) : '_______';

    // Enable or disable admin CRUD functionality
    setAdminMode(isAdmin);

    // Re-render list so admin actions appear/disappear immediately
    renderHistory();
}

function setAdminMode(isAdmin) {
    const formSection = document.getElementById('loanFormSection');
    if (formSection) {
        formSection.style.display = isAdmin ? 'block' : 'none';
    }

    // Toggle admin-only elements
    document.querySelectorAll('.admin-only').forEach(function(el) {
        el.style.display = isAdmin ? '' : 'none';
    });
}

function setupEventListeners() {
    document.getElementById('loanForm').addEventListener('submit', handleFormSubmit);
    document.getElementById('searchInput').addEventListener('input', handleSearch);
    
    window.onclick = function(event) {
        const loginPage = document.getElementById('loginPage');
        const detailModal = document.getElementById('detailModal');
        const confirmModal = document.getElementById('confirmReturnModal');
        const aboutModal = document.getElementById('aboutModal');
        const editModal = document.getElementById('editModal');
        const stockModal = document.getElementById('stockModal');

        if (event.target === loginPage) closeLoginPage();
        if (event.target === detailModal) closeModal();
        if (event.target === confirmModal) closeConfirmReturnModal();
        if (event.target === aboutModal) closeAboutModal();
        if (event.target === editModal) closeEditModal();
        if (event.target === stockModal) closeStockModal();
    };
}

function setDefaultDates() {
    const today = new Date().toISOString().split('T')[0];
    const loanDateInput = document.getElementById('loanDate');
    if (loanDateInput) loanDateInput.value = today;
}

// =========================================================================
// AUTHENTICATION HANDLERS
// =========================================================================

async function handleLogin(e) {
    e.preventDefault();
    
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const loginButton = e.target.querySelector('.btn-login');
    const errorDiv = document.getElementById('loginError');
    
    errorDiv.classList.remove('show');
    errorDiv.textContent = '';
    
    loginButton.disabled = true;
    loginButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Memproses...';
    
    try {
        const res = await callApi('login', { email: email, password: password });
        setSession(res.token, res.user);
        currentUser = res.user;
        
        closeLoginPage();
        updateUIForAuth(currentUser);
        showToast('Login berhasil! Sugeng rawuh, ' + (res.user.nama || 'Admin') + '.', 'success');
        
        // Refresh data terbaru setelah login
        loadLoansFromApi();
        loadItemsFromApi();
    } catch (error) {
        errorDiv.textContent = error.message || 'Login gagal. Periksa email dan password.';
        errorDiv.classList.add('show');
    } finally {
        loginButton.disabled = false;
        loginButton.innerHTML = '<i class="fas fa-sign-in-alt"></i> Login';
    }
}

async function logout() {
    try {
        await callApi('logout');
    } catch (e) {
        // Abaikan error logout jaringan
    }
    setSession(null, null);
    currentUser = null;
    updateUIForAuth(null);
    showToast('Logout berhasil! Kembali ke mode tamu.', 'success');
}

// =========================================================================
// DATA BARANG & STOK (INVENTORY)
// =========================================================================

async function loadItemsFromApi() {
    try {
        const res = await callApi('getItems');
        inventoryItems = res.data || [];
        populateBarangDatalist();
    } catch (e) {
        console.error('Error memuat data barang:', e);
    }
}

function populateBarangDatalist() {
    const datalist = document.getElementById('barangList');
    if (!datalist) return;
    
    datalist.innerHTML = inventoryItems.map(function(item) {
        return '<option value="' + escapeHtml(item.namaBarang) + '">' +
            'Sisa Stok: ' + item.stokTersedia + ' ' + (item.satuan || 'pcs') +
            '</option>';
    }).join('');
}

function findInventoryItem(name) {
    if (!name) return null;
    const clean = name.trim().toLowerCase();
    return inventoryItems.find(function(it) {
        return it.namaBarang.trim().toLowerCase() === clean;
    });
}

function handleItemInputChange(input) {
    const row = input.closest('tr') || input.closest('.edit-item-row');
    if (!row) return;
    
    const qtyInput = row.querySelector('.item-quantity') || row.querySelector('.edit-item-quantity');
    const matched = findInventoryItem(input.value);
    
    if (matched && qtyInput) {
        qtyInput.title = 'Stok tersedia: ' + matched.stokTersedia + ' ' + (matched.satuan || 'pcs');
        qtyInput.max = matched.stokTersedia;
        if (matched.stokTersedia <= 0) {
            showToast('Perhatian: Stok "' + matched.namaBarang + '" lagi entek! (0).', 'warning');
        }
    }
}

function handleItemQtyChange(input) {
    const row = input.closest('tr') || input.closest('.edit-item-row');
    if (!row) return;
    
    const nameInput = row.querySelector('.item-name') || row.querySelector('.edit-item-name');
    if (!nameInput) return;
    
    const matched = findInventoryItem(nameInput.value);
    if (matched) {
        const qty = parseInt(input.value, 10) || 0;
        if (qty > matched.stokTersedia) {
            showToast('Peringatan: Nyilihmu iki (' + qty + ') kokehan bolo (' + matched.stokTersedia + ')!', 'warning');
        }
    }
}

// Modal Melihat Stok Barang
function openStockModal() {
    const modal = document.getElementById('stockModal');
    const content = document.getElementById('stockContent');
    if (!modal || !content) return;
    
    if (inventoryItems.length === 0) {
        content.innerHTML = '<div class="empty-state"><i class="fas fa-box-open"></i><p>Belum ada data barang di database.</p></div>';
    } else {
        let rowsHtml = inventoryItems.map(function(it, idx) {
            const dipinjam = Math.max(0, it.stokTotal - it.stokTersedia);
            const statusBadge = it.stokTersedia <= 0 
                ? '<span style="color: #e74c3c; font-weight: bold;">✕ Entek</span>'
                : (it.stokTersedia < 2 
                    ? '<span style="color: #f39c12; font-weight: bold;">⚠ Gari sitik</span>' 
                    : '<span style="color: #27ae60; font-weight: bold;">✓ Ready</span>');
            
            return '<tr>' +
                '<td style="text-align: center;">' + (idx + 1) + '</td>' +
                '<td><strong>' + escapeHtml(it.namaBarang) + '</strong><br><small style="color: #7f8c8d;">' + escapeHtml(it.keterangan || '-') + '</small></td>' +
                '<td style="text-align: center;">' + it.stokTotal + ' ' + (it.satuan || 'pcs') + '</td>' +
                '<td style="text-align: center; font-weight: bold; color: #27ae60;">' + it.stokTersedia + '</td>' +
                '<td style="text-align: center; color: #e67e22;">' + dipinjam + '</td>' +
                '<td style="text-align: center;">' + statusBadge + '</td>' +
                '</tr>';
        }).join('');
        
        content.innerHTML = '<table class="detail-table">' +
            '<thead>' +
            '<tr>' +
            '<th style="width: 40px; text-align: center;">No</th>' +
            '<th>Nama Barang</th>' +
            '<th style="text-align: center;">Total</th>' +
            '<th style="text-align: center;">Tersedia</th>' +
            '<th style="text-align: center;">Dipinjam</th>' +
            '<th style="text-align: center;">Status</th>' +
            '</tr>' +
            '</thead>' +
            '<tbody>' + rowsHtml + '</tbody>' +
            '</table>' +
            '<div style="margin-top: 15px; font-size: 0.85rem; color: #7f8c8d; text-align: right;">' +
            'Total ' + inventoryItems.length + ' jenis barang dapat berubah sewaktu waktu!' +
            '</div>';
    }
    
    modal.style.display = 'block';
}

function closeStockModal() {
    const modal = document.getElementById('stockModal');
    if (modal) modal.style.display = 'none';
}

// =========================================================================
// DATA PEMINJAMAN (LOANS CRUD API)
// =========================================================================

async function loadLoansFromApi() {
    try {
        const res = await callApi('getLoans');
        loans = res.data || [];
        renderHistory();
    } catch (error) {
        console.error('Error loading loans:', error);
        showToast('Gagal memuat data silihan: ' + error.message, 'error');
    }
}

// =========================================================================
// FORM HANDLING
// =========================================================================

function generateInvoiceNumber() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
    return 'NOTA-' + year + month + day + '-' + hours + minutes + seconds + milliseconds;
}

function addItemRow() {
    if (!currentUser) {
        showToast('Silakan login sebagai admin untuk menambah barang.', 'warning');
        return;
    }

    const tbody = document.getElementById('itemsBody');
    const newRow = document.createElement('tr');
    newRow.className = 'item-row';
    newRow.innerHTML = '<td><input type="text" class="item-name" list="barangList" placeholder="Barang" required oninput="handleItemInputChange(this)"></td>' +
        '<td><input type="number" class="item-quantity" placeholder="Jml" min="1" value="1" required oninput="handleItemQtyChange(this)"></td>' +
        '<td><input type="text" class="item-note" placeholder="Ket"></td>' +
        '<td><button type="button" class="btn-remove-item" onclick="removeItemRow(this)"><i class="fas fa-trash"></i></button></td>';
    tbody.appendChild(newRow);
}

function removeItemRow(button) {
    if (!currentUser) {
        showToast('Silakan login sebagai admin untuk menghapus baris barang.', 'warning');
        return;
    }

    const tbody = document.getElementById('itemsBody');
    const rows = tbody.querySelectorAll('.item-row');
    if (rows.length > 1) {
        button.closest('tr').remove();
    } else {
        showToast('Minimal harus ada satu barang!', 'warning');
    }
}

async function handleFormSubmit(e) {
    e.preventDefault();

    if (!currentUser) {
        showToast('Silakan login sebagai admin untuk menambahkan data.', 'warning');
        return;
    }
    
    const borrowerName = document.getElementById('borrowerName').value.trim();
    const loanDate = document.getElementById('loanDate').value;
    const penanggungJawab = document.getElementById('penanggungJawab').value.trim();
    
    if (!borrowerName) {
        showToast('Mohon isi nama peminjam!', 'warning');
        return;
    }
    
    if (!penanggungJawab) {
        showToast('Mohon isi nama penanggung jawab!', 'warning');
        return;
    }
    
    const itemRows = document.querySelectorAll('.item-row');
    const items = [];
    
    for (let i = 0; i < itemRows.length; i++) {
        const row = itemRows[i];
        const name = row.querySelector('.item-name').value.trim();
        const quantity = parseInt(row.querySelector('.item-quantity').value, 10);
        const note = row.querySelector('.item-note').value.trim();
        
        if (name) {
            // Validasi lokal terhadap stok yang diketahui
            const matched = findInventoryItem(name);
            if (matched && quantity > matched.stokTersedia) {
                showToast('Stok "' + name + '" tidak mencukupi! Tersedia: ' + matched.stokTersedia + ', diminta: ' + quantity, 'error');
                return;
            }
            items.push({ name: name, quantity: quantity, note: note });
        }
    }
    
    if (items.length === 0) {
        showToast('Mohon isi setidaknya satu barang!', 'warning');
        return;
    }
    
    const loan = {
        id: generateInvoiceNumber(),
        borrowerName: borrowerName,
        loanDate: loanDate,
        penanggungJawab: penanggungJawab,
        items: items,
        returnedItems: [],
        returnNotes: '',
        isReturned: false,
        createdBy: currentUser.email
    };
    
    const btnSave = document.getElementById('btnSaveLoan');
    if (btnSave) {
        btnSave.disabled = true;
        btnSave.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Menyimpan...';
    }
    
    try {
        const res = await callApi('addLoan', { loan: loan });
        showToast(res.message || 'Data peminjaman berhasil disimpan!', 'success');
        
        // Reset formulir
        document.getElementById('loanForm').reset();
        setDefaultDates();
        
        const tbody = document.getElementById('itemsBody');
        tbody.innerHTML = '<tr class="item-row">' +
            '<td><input type="text" class="item-name" list="barangList" placeholder="Barang" required oninput="handleItemInputChange(this)"></td>' +
            '<td><input type="number" class="item-quantity" placeholder="Jml" min="1" value="1" required oninput="handleItemQtyChange(this)"></td>' +
            '<td><input type="text" class="item-note" placeholder="Ket"></td>' +
            '<td><button type="button" class="btn-remove-item" onclick="removeItemRow(this)"><i class="fas fa-trash"></i></button></td></tr>';
            
        // Sinkronisasi data terbaru
        await Promise.all([
            loadLoansFromApi(),
            loadItemsFromApi()
        ]);
    } catch (err) {
        showToast('Gagal menyimpan silihan: ' + err.message, 'error');
    } finally {
        if (btnSave) {
            btnSave.disabled = false;
            btnSave.innerHTML = '<i class="fas fa-save"></i> Simpan';
        }
    }
}

// =========================================================================
// HISTORY & SEARCH
// =========================================================================

function renderHistory() {
    const historyList = document.getElementById('historyList');
    if (!historyList) return;
    
    let filteredLoans = loans.slice();
    
    if (currentFilter.search) {
        filteredLoans = filteredLoans.filter(function(loan) {
            return loan.borrowerName.toLowerCase().includes(currentFilter.search.toLowerCase());
        });
    }
    
    if (currentFilter.date) {
        filteredLoans = filteredLoans.filter(function(loan) {
            return loan.loanDate === currentFilter.date;
        });
    }
    
    if (filteredLoans.length === 0) {
        historyList.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><p>' + 
            (loans.length === 0 ? 'Belum ada data peminjaman' : 'Tidak ada hasil pencarian') + '</p></div>';
        return;
    }
    
    const isAdmin = !!currentUser;
    
    historyList.innerHTML = filteredLoans.map(function(loan) {
        const formattedLoanDate = formatDate(loan.loanDate);
        const totalItems = (loan.items || []).reduce(function(sum, item) { return sum + (Number(item.quantity) || 0); }, 0);
        
        let totalReturned = 0;
        let totalKurang = 0;
        if (loan.returnedItems && loan.returnedItems.length > 0) {
            loan.returnedItems.forEach(function(item) {
                totalReturned += (Number(item.returned) || 0);
                totalKurang += (Number(item.kurang) || 0);
            });
        }
        
        const statusText = loan.isReturned 
            ? '<span style="color: #27ae60; font-weight: 600;">✓ Sudah ulih-ulih</span>' 
            : '<span style="color: #f39c12; font-weight: 600;">⟳ Urung ulih-ulih</span>';
        
        return '<div class="history-item" data-id="' + loan.id + '">' +
            '<div class="history-header">' +
            '<div class="history-info">' +
            '<h3>' + escapeHtml(loan.borrowerName) + '</h3>' +
            '<p><i class="fas fa-user-shield"></i> PJ: ' + escapeHtml(loan.penanggungJawab || '-') + '</p>' +
            '<p><i class="fas fa-calendar"></i> ' + formattedLoanDate + '</p>' +
            '<p><i class="fas fa-box"></i> ' + (loan.items ? loan.items.length : 0) + ' jenis barang (' + totalItems + ' total)</p>' +
            '<p><i class="fas fa-hashtag"></i> ' + loan.id + '</p>' +
            (loan.isReturned ? '<p><i class="fas fa-check-circle"></i> Total Dikembalikan: ' + totalReturned + ' | Kurang: ' + totalKurang + '</p>' : '') +
            '</div>' +
            '<div>' + statusText + '</div></div>' +
            '<div class="history-actions">' +
            '<button class="btn-detail" onclick="showDetail(\'' + loan.id + '\')"><i class="fas fa-eye"></i> Lihat Detail</button>' +
            '<button class="btn-pdf" onclick="downloadPDF(\'' + loan.id + '\')"><i class="fas fa-file-pdf"></i> Download PDF</button>' +
            (isAdmin ? '<button class="btn-edit" onclick="editLoan(\'' + loan.id + '\')"><i class="fas fa-edit"></i> Edit Pinjaman</button>' : '') +
            (isAdmin && !loan.isReturned ? '<button class="btn-confirm" onclick="confirmReturn(\'' + loan.id + '\')"><i class="fas fa-check-circle"></i> Konfirmasi Kembali</button>' : '') +
            (isAdmin ? '<button class="btn-delete" onclick="deleteLoan(\'' + loan.id + '\')"><i class="fas fa-trash"></i> Hapus Data</button>' : '') +
            '</div></div>';
    }).join('');
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    try {
        const options = { day: 'numeric', month: 'long', year: 'numeric' };
        return new Date(dateStr).toLocaleDateString('id-ID', options);
    } catch (e) {
        return dateStr;
    }
}

function escapeHtml(text) {
    if (!text && text !== 0) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function handleSearch(e) {
    currentFilter.search = e.target.value;
    renderHistory();
}

function filterByDate() {
    const filterDate = document.getElementById('filterDate').value;
    currentFilter.date = filterDate;
    renderHistory();
}

function resetFilter() {
    document.getElementById('searchInput').value = '';
    document.getElementById('filterDate').value = '';
    currentFilter.search = '';
    currentFilter.date = '';
    renderHistory();
}

// =========================================================================
// MODAL ACTIONS (DETAIL, RETURN, ABOUT)
// =========================================================================

function showDetail(id) {
    const loan = loans.find(function(l) { return l.id === id; });
    if (!loan) {
        showToast('Data tidak ditemukan!', 'error');
        return;
    }
    
    const modal = document.getElementById('detailModal');
    const content = document.getElementById('detailContent');
    
    let itemsHtml = (loan.items || []).map(function(item, index) {
        let returnedQty = '-';
        let kurangQty = '-';
        
        if (loan.returnedItems && loan.returnedItems[index]) {
            returnedQty = loan.returnedItems[index].returned;
            kurangQty = loan.returnedItems[index].kurang;
        }
        
        return '<tr><td>' + (index + 1) + '</td><td>' + escapeHtml(item.name) + '</td><td>' + 
            item.quantity + '</td><td>' + returnedQty + '</td><td>' + kurangQty + '</td></tr>';
    }).join('');
    
    const statusText = loan.isReturned 
        ? '<span style="color: #27ae60; font-weight: 600;">✓ Sudah ulih-ulih</span>' 
        : '<span style="color: #f39c12; font-weight: 600;">⟳ Kapan ulih-ulih?</span>';
    
    content.innerHTML = '<div class="detail-header"><h2>Detail Peminjaman</h2><p><strong>Nomor Nota:</strong> ' + loan.id + '</p></div>' +
        '<table class="detail-table"><tr><th>Nama Peminjam</th><td>' + escapeHtml(loan.borrowerName) + '</td></tr>' +
        '<tr><th>Penanggung Jawab</th><td>' + escapeHtml(loan.penanggungJawab || '-') + '</td></tr>' +
        '<tr><th>Tanggal Pinjam</th><td>' + formatDate(loan.loanDate) + '</td></tr>' +
        '<tr><th>Status</th><td>' + statusText + '</td></tr>' +
        (loan.returnNotes ? '<tr><th>Catatan</th><td>' + escapeHtml(loan.returnNotes) + '</td></tr>' : '') +
        '</table><h3 style="margin: 20px 0 15px 0;">Daftar Barang</h3>' +
        '<table class="detail-table"><thead><tr><th>No</th><th>Nama Barang</th><th>Jml Pinjam</th><th>Jml Kembali</th><th>Kurang</th></tr></thead><tbody>' + 
        itemsHtml + '</tbody></table>' +
        '<div style="margin-top: 20px; text-align: right;"><button class="btn-pdf" onclick="closeModal(); downloadPDF(\'' + loan.id + '\');"><i class="fas fa-file-pdf"></i> Download PDF</button></div>';
    
    modal.style.display = 'block';
}

function closeModal() {
    document.getElementById('detailModal').style.display = 'none';
}

function deleteLoan(id) {
    if (!currentUser) {
        showToast('Silakan login sebagai admin untuk menghapus data.', 'warning');
        return;
    }

    const loan = loans.find(function(l) { return l.id === id; });
    if (!loan) {
        showToast('Data tidak ditemukan!', 'error');
        return;
    }
    
    showConfirm(
        'Hapus Data?',
        'Yakin data pinjaman beliau ini akan dihapus: "' + escapeHtml(loan.borrowerName) + '"? Seng ilang yo ben ilang.',
        async function() {
            try {
                showToast('Menghapus data...', 'info');
                const res = await callApi('deleteLoan', { id: id });
                showToast(res.message || 'Data berhasil dihapus!', 'success');
                await Promise.all([
                    loadLoansFromApi(),
                    loadItemsFromApi()
                ]);
            } catch (err) {
                showToast('Gagal menghapus: ' + err.message, 'error');
            }
        },
        function() {},
        'danger'
    );
}

// =========================================================================
// PDF GENERATION (JSPDF)
// =========================================================================

function downloadPDF(id) {
    const loan = loans.find(function(l) { return l.id === id; });
    if (!loan) {
        showToast('Data tidak ditemukan!', 'error');
        return;
    }
    
    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        doc.setFont('helvetica');
        
        doc.setFontSize(18);
        doc.setFont(undefined, 'bold');
        doc.text('NOTA PEMINJAMAN BARANG', 105, 20, { align: 'center' });
        
        doc.setFontSize(10);
        doc.setFont(undefined, 'normal');
        doc.text('Nomor Nota: ' + loan.id, 20, 35);
        doc.text('Tanggal Cetak: ' + formatDate(new Date().toISOString()), 20, 42);
        
        doc.setFont(undefined, 'bold');
        doc.text('Nama Peminjam:', 20, 55);
        doc.setFont(undefined, 'normal');
        doc.text(loan.borrowerName, 60, 55);
        
        doc.setFont(undefined, 'bold');
        doc.text('Penanggung Jawab:', 20, 62);
        doc.setFont(undefined, 'normal');
        doc.text(loan.penanggungJawab || '-', 60, 62);
        
        doc.setFont(undefined, 'bold');
        doc.text('Tanggal Pinjam:', 20, 69);
        doc.setFont(undefined, 'normal');
        doc.text(formatDate(loan.loanDate), 60, 69);
        
        doc.setFont(undefined, 'bold');
        doc.text('Status:', 20, 76);
        doc.setFont(undefined, 'normal');
        doc.text(loan.isReturned ? 'Sudah Dikembalikan' : 'Menunggu Konfirmasi', 60, 76);
        
        let yPos = 85;
        doc.setFillColor(240, 240, 240);
        doc.rect(20, yPos - 5, 170, 10, 'F');
        doc.setFont(undefined, 'bold');
        doc.setFontSize(9);
        
        var headers = ['No', 'Nama Barang', 'Jml Pinjam', 'Jml Kembali', 'Kurang', 'Keterangan'];
        var colWidths = [15, 60, 25, 25, 20, 25];
        var xPos = 22;
        
        headers.forEach(function(header, i) {
            doc.text(header, xPos, yPos);
            xPos += colWidths[i];
        });
        
        doc.setFont(undefined, 'normal');
        doc.setFontSize(9);
        yPos += 10;
        
        (loan.items || []).forEach(function(item, index) {
            xPos = 22;
            
            var returnedQty = '-';
            var kurangQty = '-';
            if (loan.returnedItems && loan.returnedItems[index]) {
                returnedQty = String(loan.returnedItems[index].returned);
                kurangQty = String(loan.returnedItems[index].kurang);
            }
            
            var rowData = [
                String(index + 1),
                item.name.substring(0, 25),
                String(item.quantity),
                returnedQty,
                kurangQty,
                (item.note || '-').substring(0, 15)
            ];
            
            rowData.forEach(function(cell, i) {
                doc.text(cell, xPos, yPos);
                xPos += colWidths[i];
            });
            
            yPos += 8;
        });
        
        yPos = Math.max(yPos + 20, 220);
        doc.line(20, yPos, 90, yPos);
        doc.line(110, yPos, 180, yPos);
        
        doc.setFontSize(9);
        doc.text('Penanggung Jawab:', 35, yPos + 8, { align: 'center' });
        doc.text('Peminjam:', 145, yPos + 8, { align: 'center' });
        
        doc.save(loan.id + '.pdf');
        showToast('PDF berhasil diunduh!', 'success');
        
    } catch (e) {
        console.error('PDF Error:', e);
        showToast('Gagal generate PDF: ' + e.message, 'error');
    }
}

// =========================================================================
// RETURN CONFIRMATION
// =========================================================================

function confirmReturn(id) {
    if (!currentUser) {
        showToast('Silakan login sebagai admin untuk mengonfirmasi pengembalian.', 'warning');
        return;
    }

    const loan = loans.find(function(l) { return l.id === id; });
    if (!loan) {
        showToast('Data tidak ditemukan!', 'error');
        return;
    }
    
    const modal = document.getElementById('confirmReturnModal');
    const content = document.getElementById('confirmReturnContent');
    
    content.innerHTML = '<div class="detail-header"><h2>Konfirmasi Pengembalian</h2>' +
        '<p><strong>Nomor Nota:</strong> ' + loan.id + '</p>' +
        '<p><strong>Peminjam:</strong> ' + escapeHtml(loan.borrowerName) + '</p></div>' +
        '<form id="confirmReturnForm"><h3 style="margin: 20px 0 15px 0;">Daftar Barang yang Dikembalikan</h3>' +
        '<table class="detail-table"><thead><tr><th>Nama Barang</th><th>Jumlah Pinjam</th><th>Jumlah Kembali</th><th>Kurang</th></tr></thead><tbody>' +
        (loan.items || []).map(function(item, index) {
            return '<tr><td>' + escapeHtml(item.name) + '</td><td>' + item.quantity + '</td>' +
                '<td><input type="number" class="return-quantity" data-index="' + index + '" data-original="' + 
                item.quantity + '" min="0" max="' + item.quantity + '" value="' + item.quantity + '" onchange="updateReturnQuantity(this)"></td>' +
                '<td class="kurang-cell" style="font-weight: bold; color: #27ae60;">0</td></tr>';
        }).join('') +
        '</tbody></table><div style="margin-top: 20px;"><label for="returnNotes"><strong>Catatan Barang Kurang/Rusak:</strong></label>' +
        '<textarea id="returnNotes" rows="4" placeholder="Tuliskan catatan barang yang kurang atau rusak (jika ada)" style="width: 100%; padding: 10px; margin-top: 10px; border: 2px solid #ecf0f1; border-radius: 8px; font-size: 1rem;"></textarea></div>' +
        '<div style="margin-top: 20px; display: flex; gap: 10px; justify-content: flex-end;">' +
        '<button type="button" class="btn-reset" onclick="closeConfirmReturnModal()"><i class="fas fa-times"></i> Batal</button>' +
        '<button type="submit" class="btn-save" id="btnSubmitReturn"><i class="fas fa-check"></i> Konfirmasi</button></div></form>';
    
    modal.style.display = 'block';
    
    document.getElementById('confirmReturnForm').onsubmit = function(e) {
        e.preventDefault();
        saveReturnConfirmation(id);
    };
}

function updateReturnQuantity(input) {
    const original = parseInt(input.dataset.original, 10);
    const returned = parseInt(input.value, 10) || 0;
    const kurang = Math.max(0, original - returned);
    const row = input.closest('tr');
    const kurangCell = row.querySelector('.kurang-cell');
    kurangCell.textContent = kurang;
    
    if (kurang > 0) {
        kurangCell.style.color = '#e74c3c';
    } else {
        kurangCell.style.color = '#27ae60';
    }
}

async function saveReturnConfirmation(id) {
    if (!currentUser) {
        showToast('Silakan login sebagai admin untuk mengonfirmasi pengembalian.', 'warning');
        return;
    }

    const loan = loans.find(function(l) { return l.id === id; });
    if (!loan) {
        showToast('Data tidak ditemukan!', 'error');
        return;
    }
    
    const returnedItems = [];
    let totalKurang = 0;
    
    document.querySelectorAll('.return-quantity').forEach(function(input) {
        const index = parseInt(input.dataset.index, 10);
        const original = parseInt(input.dataset.original, 10);
        const returned = parseInt(input.value, 10) || 0;
        const kurang = Math.max(0, original - returned);
        
        totalKurang += kurang;
        returnedItems[index] = {
            returned: returned,
            kurang: kurang
        };
    });
    
    const returnNotes = document.getElementById('returnNotes').value;
    const btnSubmit = document.getElementById('btnSubmitReturn');
    if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Menyimpan...';
    }
    
    try {
        const res = await callApi('confirmReturn', {
            id: id,
            data: {
                returnedItems: returnedItems,
                returnNotes: returnNotes
            }
        });
        
        closeConfirmReturnModal();
        if (totalKurang > 0) {
            showToast('Konfirmasi sukses! ' + totalKurang + ' barang tercatat kurang.', 'warning');
        } else {
            showToast(res.message || 'Semua barang telah dikembalikan ke stok!', 'success');
        }
        
        await Promise.all([
            loadLoansFromApi(),
            loadItemsFromApi()
        ]);
    } catch (err) {
        showToast('Gagal konfirmasi: ' + err.message, 'error');
    } finally {
        if (btnSubmit) {
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = '<i class="fas fa-check"></i> Konfirmasi';
        }
    }
}

function closeConfirmReturnModal() {
    document.getElementById('confirmReturnModal').style.display = 'none';
}

function openAboutModal() {
    const modal = document.getElementById('aboutModal');
    if (modal) modal.style.display = 'block';
}

function closeAboutModal() {
    const modal = document.getElementById('aboutModal');
    if (modal) modal.style.display = 'none';
}

// =========================================================================
// EDIT LOAN FUNCTIONALITY
// =========================================================================

function editLoan(id) {
    if (!currentUser) {
        showToast('Silakan login sebagai admin untuk mengedit data.', 'warning');
        return;
    }

    const loan = loans.find(function(l) { return l.id === id; });
    if (!loan) {
        showToast('Data tidak ditemukan!', 'error');
        return;
    }
    
    const modal = document.getElementById('editModal');
    const content = document.getElementById('editContent');
    
    let itemsHtml = (loan.items || []).map(function(item) {
        return '<div class="edit-item-row">' +
            '<input type="text" class="edit-item-name" list="barangList" value="' + escapeHtml(item.name) + '" placeholder="Nama barang" required oninput="handleItemInputChange(this)">' +
            '<input type="number" class="edit-item-quantity" value="' + item.quantity + '" min="1" placeholder="Jumlah" required oninput="handleItemQtyChange(this)">' +
            '<button type="button" class="btn-remove-edit-item" onclick="removeEditItem(this)"><i class="fas fa-trash"></i> Del</button>' +
            '</div>';
    }).join('');
    
    content.innerHTML = '<div class="detail-header"><h2><i class="fas fa-edit"></i> Edit Data Peminjaman</h2>' +
        '<p><strong>Nomor Nota:</strong> ' + loan.id + '</p></div>' +
        '<form id="editLoanForm">' +
        
        // Section 1: Informasi Peminjam
        '<div class="edit-form-section">' +
        '<h3><i class="fas fa-user"></i> Informasi Peminjam</h3>' +
        '<div class="edit-form-group">' +
        '<label for="editBorrowerName">Nama Peminjam *</label>' +
        '<input type="text" id="editBorrowerName" class="edit-form-input" value="' + escapeHtml(loan.borrowerName) + '" required>' +
        '</div>' +
        '<div class="edit-form-group">' +
        '<label for="editLoanDate">Tanggal Pinjam *</label>' +
        '<input type="date" id="editLoanDate" class="edit-form-input" value="' + loan.loanDate + '" required>' +
        '</div>' +
        '<div class="edit-form-group">' +
        '<label for="editPenanggungJawab">Penanggung Jawab *</label>' +
        '<input type="text" id="editPenanggungJawab" class="edit-form-input" value="' + escapeHtml(loan.penanggungJawab || '') + '" required>' +
        '</div>' +
        '</div>' +
        
        // Section 2: Daftar Barang
        '<div class="edit-form-section">' +
        '<h3><i class="fas fa-box"></i> Daftar Barang yang Dipinjam</h3>' +
        '<div id="editItemsContainer" class="edit-items-container">' +
        itemsHtml +
        '</div>' +
        '<button type="button" class="btn-add-edit-item" onclick="addEditItem()"><i class="fas fa-plus"></i> Tambah Barang</button>' +
        '</div>' +
        
        // Section 3: Catatan
        '<div class="edit-form-section">' +
        '<h3><i class="fas fa-sticky-note"></i> Catatan</h3>' +
        '<div class="edit-form-group">' +
        '<label for="editReturnNotes">Catatan Tambahan</label>' +
        '<textarea id="editReturnNotes" class="edit-form-input" rows="3" placeholder="Catatan barang kurang/rusak atau informasi tambahan lainnya">' + 
        escapeHtml(loan.returnNotes || '') + '</textarea>' +
        '</div>' +
        '</div>' +
        
        // Action Buttons
        '<div class="edit-form-actions">' +
        '<button type="button" class="btn-cancel" onclick="closeEditModal()"><i class="fas fa-times"></i> Batal</button>' +
        '<button type="submit" class="btn-save-edit" id="btnSaveEdit"><i class="fas fa-save"></i> Simpan Perubahan</button>' +
        '</div>' +
        '</form>';
    
    modal.style.display = 'block';
    
    document.getElementById('editLoanForm').onsubmit = function(e) {
        e.preventDefault();
        saveEditLoan(id);
    };
}

function addEditItem() {
    const container = document.getElementById('editItemsContainer');
    const newItem = document.createElement('div');
    newItem.className = 'edit-item-row';
    newItem.innerHTML = '<input type="text" class="edit-item-name" list="barangList" placeholder="Nama barang" required oninput="handleItemInputChange(this)">' +
        '<input type="number" class="edit-item-quantity" value="1" min="1" placeholder="Jumlah" required oninput="handleItemQtyChange(this)">' +
        '<button type="button" class="btn-remove-edit-item" onclick="removeEditItem(this)"><i class="fas fa-trash"></i> Del</button>';
    container.appendChild(newItem);
}

function removeEditItem(button) {
    const container = document.getElementById('editItemsContainer');
    const items = container.querySelectorAll('.edit-item-row');
    
    if (items.length > 1) {
        button.closest('.edit-item-row').remove();
    } else {
        showToast('Minimal harus ada satu barang!', 'warning');
    }
}

function saveEditLoan(id) {
    if (!currentUser) {
        showToast('Silakan login sebagai admin untuk mengedit data.', 'warning');
        return;
    }

    const loan = loans.find(function(l) { return l.id === id; });
    if (!loan) {
        showToast('Data tidak ditemukan!', 'error');
        return;
    }
    
    const borrowerName = document.getElementById('editBorrowerName').value.trim();
    const loanDate = document.getElementById('editLoanDate').value;
    const penanggungJawab = document.getElementById('editPenanggungJawab').value.trim();
    const returnNotes = document.getElementById('editReturnNotes').value.trim();
    
    if (!borrowerName) {
        showToast('Mohon isi nama peminjam!', 'warning');
        return;
    }
    
    if (!penanggungJawab) {
        showToast('Mohon isi nama penanggung jawab!', 'warning');
        return;
    }
    
    const items = [];
    const itemRows = document.querySelectorAll('.edit-item-row');
    
    itemRows.forEach(function(row) {
        const name = row.querySelector('.edit-item-name').value.trim();
        const quantity = parseInt(row.querySelector('.edit-item-quantity').value, 10);
        if (name && quantity > 0) {
            items.push({ name: name, quantity: quantity });
        }
    });
    
    if (items.length === 0) {
        showToast('Mohon isi setidaknya satu barang!', 'warning');
        return;
    }
    
    showConfirm(
        'Simpan Perubahan?',
        'Yakin menyimpan perubahan data peminjaman dari "' + escapeHtml(borrowerName) + '"?',
        async function() {
            const btnSave = document.getElementById('btnSaveEdit');
            if (btnSave) {
                btnSave.disabled = true;
                btnSave.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Menyimpan...';
            }
            
            try {
                const res = await callApi('editLoan', {
                    id: id,
                    data: {
                        borrowerName: borrowerName,
                        loanDate: loanDate,
                        penanggungJawab: penanggungJawab,
                        items: items,
                        returnNotes: returnNotes
                    }
                });
                
                closeEditModal();
                showToast(res.message || 'Data berhasil diperbarui!', 'success');
                await Promise.all([
                    loadLoansFromApi(),
                    loadItemsFromApi()
                ]);
            } catch (err) {
                showToast('Gagal update: ' + err.message, 'error');
            } finally {
                if (btnSave) {
                    btnSave.disabled = false;
                    btnSave.innerHTML = '<i class="fas fa-save"></i> Simpan Perubahan';
                }
            }
        },
        function() {},
        'warning'
    );
}

function closeEditModal() {
    document.getElementById('editModal').style.display = 'none';
}

// Global scope bindings untuk inline HTML events
window.addItemRow = addItemRow;
window.removeItemRow = removeItemRow;
window.handleItemInputChange = handleItemInputChange;
window.handleItemQtyChange = handleItemQtyChange;
window.showDetail = showDetail;
window.closeModal = closeModal;
window.editLoan = editLoan;
window.closeEditModal = closeEditModal;
window.addEditItem = addEditItem;
window.removeEditItem = removeEditItem;
window.saveEditLoan = saveEditLoan;
window.deleteLoan = deleteLoan;
window.downloadPDF = downloadPDF;
window.filterByDate = filterByDate;
window.resetFilter = resetFilter;
window.confirmReturn = confirmReturn;
window.closeConfirmReturnModal = closeConfirmReturnModal;
window.updateReturnQuantity = updateReturnQuantity;
window.openAboutModal = openAboutModal;
window.closeAboutModal = closeAboutModal;
window.openStockModal = openStockModal;
window.closeStockModal = closeStockModal;
window.showLoginPage = showLoginPage;
window.closeLoginPage = closeLoginPage;
window.logout = logout;
