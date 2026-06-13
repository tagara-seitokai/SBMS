// =============================================
// Firebase 初期化設定
// このファイルは全ページで読み込まれます
// =============================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js";

// Firebase プロジェクト設定
const firebaseConfig = {
    apiKey: "AIzaSyB8KCEbdXL7wgEha70AWxGKcknyEoyssNU",
    authDomain: "sbms-91d32.firebaseapp.com",
    projectId: "sbms-91d32",
    storageBucket: "sbms-91d32.firebasestorage.app",
    messagingSenderId: "452504317991",
    appId: "1:452504317991:web:620a06638ba65b06031e02"
};

// Firebase アプリを初期化
const app = initializeApp(firebaseConfig);

// 他のモジュールから利用できるようにエクスポート
export { app };