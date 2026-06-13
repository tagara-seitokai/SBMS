// =============================================
// 生徒会資産管理システム 共通関数
// 全モジュールから利用される汎用機能を提供します
// =============================================
import { app } from "./firebase-config.js";
import {
    getFirestore,
    collection,
    addDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";

// Firestore インスタンス
const db = getFirestore(app);

// =============================================
// 日付フォーマット (YYYY-MM-DD HH:MM:SS)
// =============================================
/**
 * 日付をシステムで統一された文字列形式に変換します
 * @param {Date} [date=new Date()] - 日付オブジェクト
 * @returns {string} フォーマット済み日時文字列
 */
function formatDateTime(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

// =============================================
// トースト通知
// =============================================
/**
 * 画面右上にトースト通知を表示します
 * @param {string} message - 表示メッセージ
 * @param {'info'|'success'|'error'} [type='info'] - 通知の種類
 */
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) {
        const newContainer = document.createElement('div');
        newContainer.id = 'toastContainer';
        newContainer.className = 'toast-container';
        document.body.appendChild(newContainer);
        setTimeout(() => showToast(message, type), 0);
        return;
    }

    const toast = document.createElement('div');
    toast.className = 'toast';
    if (type === 'error') {
        toast.style.background = 'rgba(239, 68, 68, 0.9)';
        toast.style.color = 'white';
    } else if (type === 'success') {
        toast.style.background = 'rgba(34, 197, 94, 0.9)';
        toast.style.color = '#0F172A';
    }
    toast.textContent = message;
    container.appendChild(toast);

    toast.addEventListener('animationend', (e) => {
        if (e.animationName === 'fadeOut') {
            toast.remove();
        }
    });
}

// =============================================
// システムログ書き込み (Firestore)
// =============================================
/**
 * システム操作ログを systemLogs コレクションに書き込みます
 * @param {string} action - 操作内容の説明
 * @param {string} targetModule - 操作対象モジュール名
 * @param {object} [details={}] - 追加の詳細情報
 * @returns {Promise<void>}
 */
async function writeSystemLog(action, targetModule = '一般', details = {}) {
    try {
        const logData = {
            action: action,
            targetModule: targetModule,
            details: details,
            timestamp: serverTimestamp(),
            localTime: formatDateTime()
        };
        await addDoc(collection(db, "systemLogs"), logData);
    } catch (error) {
        console.error("システムログ書き込みエラー:", error);
    }
}

// =============================================
// Firestore インスタンス取得（モジュール用）
// =============================================
/**
 * Firestore データベースインスタンスを返します
 * @returns {Firestore}
 */
function getDb() {
    return db;
}

export { formatDateTime, showToast, writeSystemLog, getDb };