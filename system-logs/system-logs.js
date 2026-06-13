// =============================================
// 操作履歴モジュール（モジュール別種類表示・フィルター付き）
// =============================================
import { getDb, showToast } from "../common.js";
import {
    collection,
    getDocs,
    writeBatch,
    doc
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";
import {
    getAuth,
    signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";

// モジュール名 → 表示名＆CSSクラス のマッピング
const moduleDisplayMap = {
    'items': { label: '備品管理', cssClass: 'source-items' },
    'inspections': { label: '点検', cssClass: 'source-inspections' },
    'users': { label: 'ユーザー管理', cssClass: 'source-users' },
    'system-logs': { label: '操作履歴', cssClass: 'source-system-logs' },
    'loans': { label: '貸出・返却', cssClass: 'source-loans' },
    'loan-history': { label: '貸出履歴', cssClass: 'source-loans' },
    'トップ': { label: 'システム', cssClass: 'source-system' },
    'system': { label: 'システム', cssClass: 'source-system' }
};

// ヘルパー
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

let db, auth;
let allLogs = [], pendingClear = false;
let logTableBody, emptyMessage, filterSelect, clearBtn;
let loginModalOverlay, loginEmail, loginPassword, confirmLoginBtn, cancelLoginBtn;

// ----- 認証関連 -----
function showLoginModal() {
    loginModalOverlay.classList.add('active');
    loginEmail.value = '';
    loginPassword.value = '';
    loginEmail.focus();
}
function hideLoginModal() {
    loginModalOverlay.classList.remove('active');
}

async function performLogin() {
    const email = loginEmail.value.trim();
    const password = loginPassword.value.trim();
    if (!email || !password) {
        showToast('メールアドレスとパスワードを入力してください', 'error');
        return;
    }
    try {
        await signInWithEmailAndPassword(auth, email, password);
        hideLoginModal();
        showToast('認証成功', 'success');
        if (pendingClear) {
            pendingClear = false;
            await clearAllLogs();
        }
    } catch (error) {
        console.error(error);
        showToast('認証に失敗しました', 'error');
    }
}

// ----- 履歴読み込み -----
async function loadLogs() {
    try {
        const logs = [];

        // 1. systemLogs
        const systemSnap = await getDocs(collection(db, "systemLogs"));
        systemSnap.forEach(docSnap => {
            const data = docSnap.data();
            const timeStr = data.localTime ||
                (data.timestamp ? new Date(data.timestamp.seconds * 1000).toLocaleString('ja-JP') : '');
            logs.push({
                time: timeStr,
                sortTime: data.timestamp ? data.timestamp.seconds : 0,
                type: 'システム',
                module: data.targetModule || 'system',
                operator: data.details?.operator || '-',
                content: data.action || JSON.stringify(data.details || {})
            });
        });

        // 2. record（入荷）
        const recordSnap = await getDocs(collection(db, "record"));
        recordSnap.forEach(docSnap => {
            const data = docSnap.data();
            const timeStr = data.localTime ||
                (data.timestamp ? new Date(data.timestamp.seconds * 1000).toLocaleString('ja-JP') : '');
            logs.push({
                time: timeStr,
                sortTime: data.timestamp ? data.timestamp.seconds : 0,
                type: '入荷',
                module: 'items',
                operator: data.operator || '-',
                content: `${data.itemName} +${data.quantity}`
            });
        });

        // 3. inspections（点検）
        const inspSnap = await getDocs(collection(db, "inspections"));
        inspSnap.forEach(docSnap => {
            const data = docSnap.data();
            const timeStr = data.localTime ||
                (data.createdAt ? new Date(data.createdAt.seconds * 1000).toLocaleString('ja-JP') : '');
            const statusText = data.overallStatus === 'normal' ? '正常' :
                                data.overallStatus === 'abnormal' ? '異常' : '紛失';
            logs.push({
                time: timeStr,
                sortTime: data.createdAt ? data.createdAt.seconds : 0,
                type: '点検',
                module: 'inspections',
                operator: '-',
                content: `${data.date} 全体状態: ${statusText} (対象${data.details ? data.details.length : 0}件)`
            });
        });

        // 降順ソート
        logs.sort((a, b) => b.sortTime - a.sortTime);
        allLogs = logs;

        // フィルター選択肢を生成
        buildFilterOptions(logs);
        renderLogs(logs);
    } catch (error) {
        console.error('ログ読み込みエラー:', error);
        showToast('データの読み込みに失敗しました', 'error');
    }
}

function buildFilterOptions(logs) {
    const typeSet = new Set();
    logs.forEach(log => {
        const info = getTypeInfo(log);
        typeSet.add(info.label);
    });
    const types = Array.from(typeSet).sort();
    filterSelect.innerHTML = '<option value="">すべて表示</option>';
    types.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t;
        filterSelect.appendChild(opt);
    });
}

function getTypeInfo(log) {
    if (log.type === '入荷') {
        return { label: '備品管理', cssClass: 'source-record' };
    } else if (log.type === '点検') {
        return { label: '点検', cssClass: 'source-inspections' };
    } else {
        const mod = log.module || 'system';
        const map = moduleDisplayMap[mod];
        if (map) return map;
        return { label: 'システム', cssClass: 'source-system' };
    }
}

function renderLogs(logs) {
    logTableBody.innerHTML = '';
    if (logs.length === 0) {
        emptyMessage.style.display = 'block';
    } else {
        emptyMessage.style.display = 'none';
        logs.forEach(log => {
            const typeInfo = getTypeInfo(log);
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${escapeHtml(log.time)}</td>
                <td><span class="source-badge ${typeInfo.cssClass}">${escapeHtml(typeInfo.label)}</span></td>
                <td>${escapeHtml(log.operator)}</td>
                <td>${escapeHtml(log.content)}</td>
            `;
            logTableBody.appendChild(row);
        });
    }
}

function applyFilter() {
    const selectedType = filterSelect.value;
    if (!selectedType) {
        renderLogs(allLogs);
    } else {
        const filtered = allLogs.filter(log => getTypeInfo(log).label === selectedType);
        renderLogs(filtered);
    }
}

// ----- 全履歴クリア -----
async function clearAllLogs() {
    try {
        const collections = ['systemLogs', 'record', 'inspections'];
        const batch = writeBatch(db);
        for (const colName of collections) {
            const snap = await getDocs(collection(db, colName));
            snap.forEach(docSnap => batch.delete(doc(db, colName, docSnap.id)));
        }
        await batch.commit();
        showToast('全履歴をクリアしました', 'success');
        await loadLogs();
    } catch (error) {
        console.error(error);
        showToast('クリアに失敗しました', 'error');
    }
}

// ----- 初期化 -----
document.addEventListener('DOMContentLoaded', async () => {
    // DOM 要素取得（HTML読み込み後）
    logTableBody = document.getElementById('logTableBody');
    emptyMessage = document.getElementById('emptyMessage');
    filterSelect = document.getElementById('filterSelect');
    clearBtn = document.getElementById('clearLogsBtn');
    loginModalOverlay = document.getElementById('loginModalOverlay');
    loginEmail = document.getElementById('loginEmail');
    loginPassword = document.getElementById('loginPassword');
    confirmLoginBtn = document.getElementById('confirmLoginBtn');
    cancelLoginBtn = document.getElementById('cancelLoginBtn');

    // 初期化
    db = getDb();
    auth = getAuth();

    // ヘッダー時計
    function updateClock() {
        const now = new Date();
        document.getElementById('headerTime').textContent =
            now.toLocaleString('ja-JP', {
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            });
    }
    updateClock();
    setInterval(updateClock, 1000);

    // イベント登録
    filterSelect.addEventListener('change', applyFilter);
    clearBtn.addEventListener('click', () => {
        pendingClear = true;
        showLoginModal();
    });
    confirmLoginBtn.addEventListener('click', performLogin);
    cancelLoginBtn.addEventListener('click', () => {
        pendingClear = false;
        hideLoginModal();
    });
    loginPassword.addEventListener('keydown', e => { if (e.key === 'Enter') performLogin(); });

    // 履歴読み込み
    await loadLogs();
});