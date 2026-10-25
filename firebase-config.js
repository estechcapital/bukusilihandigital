// Firebase Configuration - Isi dengan config dari Firebase Console Anda
// Cara mendapatkan config:
// 1. Buka https://console.firebase.google.com
// 2. Buat project atau pilih project yang sudah ada
// 3. Klik icon gear (Project Settings)
// 4. Scroll ke "Your apps" dan klik icon web </>
// 5. Copy firebaseConfig dan paste di bawah

const firebaseConfig = {
    apiKey: "AIzaSyACpdCB2rpQKNBeIxZXzfJF1tTYpVHaqIQ",
    authDomain: "iseng-doang-960df.firebaseapp.com",
    projectId: "iseng-doang-960df",
    storageBucket: "iseng-doang-960df.appspot.com",
    messagingSenderId: "119115368803",
    appId: "1:119115368803:web:6d58bbb087531045faab56"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Initialize Firestore
const db = firebase.firestore();

// Initialize Auth
const auth = firebase.auth();

// Enable Firestore persistence
db.enablePersistence({ experimentalTabSynchronization: true })
.catch((err) => {
    if (err.code == 'failed-precondition') {
        console.log('Multiple tabs open, persistence can only be enabled in one tab at a time.');
    } else if (err.code == 'unimplemented') {
        console.log('The current browser does not support persistence.');
    }
});
