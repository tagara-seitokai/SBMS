// =============================================
// お知らせモジュール
// =============================================
import { getDb, writeSystemLog, showToast, formatDateTime } from "../common.js";
import {
    collection,
    getDocs,
    addDoc,
    serverTimestamp,
    query,
    orderBy
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";
import {
    getAuth,
    signInWithEmailAndPassword,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";

const db = getDb();
const auth = getAuth();

// DOM
const notifList = document.getElementById('notifList');
const createNotifBtn = document.getElementById('createNotifBtn');
const loginModalOverlay = document.getElementById('loginModalOverlay');
const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
const confirmLoginBtn = document.getElementById('confirmLoginBtn');
const cancelLoginBtn = document.getElementById('cancelLoginBtn');

const createModalOverlay = document.getElementById('createModalOverlay');
const notifTitleInput = document.getElementById('notifTitleInput');
const notifContent = document.getElementById('notifContent');
const confirmCreateBtn = document.getElementById('confirmCreateBtn');
const cancelCreateBtn = document.getElementById('cancelCreateBtn');

let currentUser = null;
let isAuthenticated = false; // 進入認証済みか
let pendingCreate = false;

// ----- ヘルパー -----
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function updateClock() {
    const now = new Date();
    document.getElementById('headerTime').textContent =
        now.toLocaleString('ja-JP', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
}

// ----- 認証 -----
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
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        currentUser = userCredential.user;
        hideLoginModal();
        showToast('認証成功', 'success');

        // 初回認証の場合は通知リストを読み込み
        if (!isAuthenticated) {
            isAuthenticated = true;
            await loadNotifs();
        }

        // 作成待機があれば作成モーダルを表示
        if (pendingCreate) {
            pendingCreate = false;
            openCreateModal();
        }
    } catch (error) {
        console.error('ログインエラー:', error);
        showToast('認証に失敗しました', 'error');
    }
}

function cancelLogin() {
    window.location.href = '../index.html';
}

// ----- 通知リスト読み込み -----
async function loadNotifs() {
    try {
        const q = query(collection(db, "oshirase"), orderBy("createdAt", "desc"));
        const snap = await getDocs(q);
        if (snap.empty) {
            notifList.innerHTML = '<div class="empty-message">お知らせはありません。</div>';
            return;
        }
        notifList.innerHTML = '';
        snap.forEach(docSnap => {
            const data = docSnap.data();
            const timeStr = data.localTime || 
                (data.createdAt ? new Date(data.createdAt.seconds * 1000).toLocaleString('ja-JP') : '');
            const div = document.createElement('div');
            div.className = 'notif-item';
            div.innerHTML = `
                <h4>${escapeHtml(data.title || '')}</h4>
                <p>${escapeHtml(data.content || '')}</p>
                <div class="time">${timeStr}</div>
            `;
            notifList.appendChild(div);
        });
    } catch (error) {
        console.error(error);
        showToast('お知らせの読み込みに失敗しました', 'error');
    }
}

// ----- 作成モーダル -----
function openCreateModal() {
    notifTitleInput.value = '';
    notifContent.value = '';
    createModalOverlay.classList.add('active');
    notifTitleInput.focus();
}
function closeCreateModal() {
    createModalOverlay.classList.remove('active');
}

async function submitCreate() {
    const title = notifTitleInput.value.trim();
    const content = notifContent.value.trim();
    if (!title || !content) {
        showToast('タイトルと内容を入力してください', 'error');
        return;
    }
    try {
        await addDoc(collection(db, "oshirase"), {
            title,
            content,
            createdAt: serverTimestamp(),
            localTime: formatDateTime()
        });
        await writeSystemLog(`お知らせ作成: ${title}`, 'oshirase');
        showToast('お知らせを作成しました', 'success');
        closeCreateModal();
        await loadNotifs();
    } catch (error) {
        console.error(error);
        showToast('作成に失敗しました', 'error');
    }
}

// ----- イベント -----
createNotifBtn.addEventListener('click', () => {
    // まだ認証済みでなければ認証モーダル → 認証後に作成モーダルへ
    if (!isAuthenticated) {
        pendingCreate = true;
        showLoginModal();
    } else {
        // 認証済みでも再度認証を要求（重要操作）
        pendingCreate = true;
        showLoginModal();
    }
});

confirmLoginBtn.addEventListener('click', performLogin);
cancelLoginBtn.addEventListener('click', cancelLogin);
loginPassword.addEventListener('keydown', (e) => { if (e.key === 'Enter') performLogin(); });

confirmCreateBtn.addEventListener('click', submitCreate);
cancelCreateBtn.addEventListener('click', closeCreateModal);

// ----- 初期化 -----
document.addEventListener('DOMContentLoaded', () => {
    updateClock();
    setInterval(updateClock, 1000);
    // 進入時に認証モーダル表示
    showLoginModal();
});