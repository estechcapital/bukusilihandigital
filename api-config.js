// =========================================================================
// KONFIGURASI API BACKEND GOOGLE APPS SCRIPT
// =========================================================================
// Masukkan URL Deployment Web App Google Apps Script Anda di bawah ini.
// Cara mendapatkan Web App URL:
// 1. Di Google Apps Script, klik tombol "Deploy" (Terapkan) -> "New deployment" (Deployment baru).
// 2. Pilih type "Web app".
// 3. Atur:
//    - Description: Web App API
//    - Execute as: "Me" (email Anda)
//    - Who has access: "Anyone" (Siapa saja)
// 4. Klik "Deploy", izinkan akses akun Google, lalu salin "Web app URL".
// 5. Tempel URL tersebut pada variabel SCRIPT_URL di bawah ini.
// =========================================================================

const API_CONFIG = {
    // Ganti nilai string di bawah dengan URL Web App Anda:
    SCRIPT_URL: "https://script.google.com/macros/s/AKfycbwWs4yqbDYoX6MzMo-A6twjXbKhu3AfZdjJZCDgVnvh2YoRNLLq3v1N4vU8eiGR2eo/exec",
    
    // Interval polling otomatis untuk sinkronisasi data riwayat & stok (dalam milidetik).
    // Default 30000 = 30 detik. Set 0 untuk menonaktifkan background polling.
    AUTO_REFRESH_INTERVAL: 30000,

    // Kunci penyimpanan session token di browser
    STORAGE_KEY_TOKEN: 'bolopecah_auth_token',
    STORAGE_KEY_USER: 'bolopecah_auth_user'
};
