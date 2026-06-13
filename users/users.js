// =============================================
// ユーザー管理モジュール（進入時認証、管理者/一般、認証対応）
// =============================================
import { getDb, writeSystemLog, showToast, formatDateTime } from "../common.js";
import {
    collection,
    getDocs,
    addDoc,
    deleteDoc,
    doc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";
import {
    getAuth,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";

const db = getDb();
const auth = getAuth();

// DOM 要素
const userTypeSelect = document.getElementById('userType');
const userNameInput = document.getElementById('userName');
const userRoleSelect = document.getElementById('userRole');
const userMemoInput = document.getElementById('userMemo');
const addUserBtn = document.getElementById('addUserBtn');
const adminFields = document.getElementById('adminFields');
const adminEmailInput = document.getElementById('adminEmail');
const adminPasswordInput = document.getElementById('adminPassword');
const usersTableBody = document.getElementById('usersTableBody');
const emptyMessage = document.getElementById('emptyMessage');

const loginModalOverlay = document.getElementById('loginModalOverlay');
const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
const confirmLoginBtn = document.getElementById('confirmLoginBtn');
const cancelLoginBtn = document.getElementById('cancelLoginBtn');

let currentUser = null;
let pendingAddUser = false;
let pendingDeleteUserId = null;
let isAuthenticated = false; // 追加：進入時の認証状態

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

// 種類切り替え
function toggleAdminFields() {
    if (userTypeSelect.value === 'admin') {
        adminFields.classList.add('visible');
        adminEmailInput.required = true;
        adminPasswordInput.required = true;
    } else {
        adminFields.classList.remove('visible');
        adminEmailInput.required = false;
        adminPasswordInput.required = false;
    }
}
userTypeSelect.addEventListener('change', toggleAdminFields);

// ----- 認証（初期表示＆操作時） -----
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

        // 如果尚未加载数据，进行初始加载（进入时认证）
        if (!isAuthenticated) {
            isAuthenticated = true;
            await loadUsers();
        }

        // 处理待操作：添加/删除
        if (pendingAddUser) {
            pendingAddUser = false;
            await addUser();
        }
        if (pendingDeleteUserId) {
            const id = pendingDeleteUserId;
            pendingDeleteUserId = null;
            await deleteUser(id);
        }
    } catch (error) {
        console.error('ログインエラー:', error);
        showToast('認証に失敗しました', 'error');
    }
}

// キャンセル時はトップへ戻る
function cancelLogin() {
    window.location.href = '../index.html';
}

onAuthStateChanged(auth, (user) => {
    currentUser = user;
});

// ----- ユーザー一覧読み込み -----
async function loadUsers() {
    try {
        const snap = await getDocs(collection(db, "users"));
        const users = [];
        snap.forEach(doc => users.push({ id: doc.id, ...doc.data() }));
        usersTableBody.innerHTML = '';
        if (users.length === 0) {
            emptyMessage.style.display = 'block';
        } else {
            emptyMessage.style.display = 'none';
            users.forEach(u => {
                const isAdmin = u.isAdmin === true;
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${escapeHtml(u.name || '')}</td>
                    <td><span class="badge ${isAdmin ? 'badge-admin' : 'badge-general'}">${isAdmin ? '管理者' : '一般'}</span></td>
                    <td>${escapeHtml(u.role || '')}</td>
                    <td>${escapeHtml(u.memo || '')}</td>
                    <td><button class="btn btn-danger delete-user" data-id="${u.id}" data-isadmin="${isAdmin}">削除</button></td>
                `;
                usersTableBody.appendChild(row);
            });
            document.querySelectorAll('.delete-user').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const id = btn.dataset.id;
                    if (confirm('このユーザーを削除しますか？（認証が必要です）')) {
                        pendingDeleteUserId = id;
                        showLoginModal();
                    }
                });
            });
        }
    } catch (error) {
        console.error('ユーザー読み込みエラー:', error);
        showToast('読み込み失敗', 'error');
    }
}

// ----- ユーザー追加 -----
async function addUser() {
    const type = userTypeSelect.value;
    const name = userNameInput.value.trim();
    const role = userRoleSelect.value;
    const memo = userMemoInput.value.trim();

    if (!name) { showToast('名前を入力してください', 'error'); return; }

    if (type === 'admin') {
        const email = adminEmailInput.value.trim();
        const password = adminPasswordInput.value;
        if (!email || !password) {
            showToast('管理者のメールアドレスとパスワードを入力してください', 'error');
            return;
        }
        if (password.length < 6) {
            showToast('パスワードは6文字以上必要です', 'error');
            return;
        }

        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const uid = userCredential.user.uid;
            await addDoc(collection(db, "users"), {
                name, role, memo,
                isAdmin: true,
                email: email,
                authUid: uid,
                createdAt: serverTimestamp()
            });
            await writeSystemLog(`管理者ユーザー「${name}」（${email}）を追加`, 'users');
            showToast('管理者ユーザーを追加しました', 'success');
        } catch (error) {
            console.error('管理者作成エラー:', error);
            if (error.code === 'auth/email-already-in-use') {
                showToast('このメールアドレスは既に使用されています', 'error');
            } else {
                showToast('管理者の作成に失敗しました', 'error');
            }
            return;
        }
    } else {
        try {
            await addDoc(collection(db, "users"), {
                name, role, memo,
                isAdmin: false,
                createdAt: serverTimestamp()
            });
            await writeSystemLog(`一般ユーザー「${name}」を追加`, 'users');
            showToast('一般ユーザーを追加しました', 'success');
        } catch (error) {
            console.error('一般ユーザー追加エラー:', error);
            showToast('追加に失敗しました', 'error');
            return;
        }
    }

    userNameInput.value = '';
    userRoleSelect.value = '一般';
    userMemoInput.value = '';
    userTypeSelect.value = 'general';
    adminEmailInput.value = '';
    adminPasswordInput.value = '';
    toggleAdminFields();
    await loadUsers();
}

function handleAddClick() {
    // 進入時に認証済みでも、重要な操作は再認証を求める
    pendingAddUser = true;
    showLoginModal();
}

// ----- ユーザー削除 -----
async function deleteUser(id) {
    try {
        const snap = await getDocs(collection(db, "users"));
        let target = null;
        snap.forEach(d => { if (d.id === id) target = d.data(); });
        await deleteDoc(doc(db, "users", id));
        await writeSystemLog(`ユーザー（ID: ${id}）を削除しました`, 'users');
        if (target && target.isAdmin) {
            showToast('Firestoreから削除しました。Authenticationのアカウントは手動で削除してください。', 'info');
        } else {
            showToast('ユーザーを削除しました', 'success');
        }
        await loadUsers();
    } catch (error) {
        console.error('削除エラー:', error);
        showToast('削除に失敗しました', 'error');
    }
}

// ----- イベント -----
addUserBtn.addEventListener('click', handleAddClick);
confirmLoginBtn.addEventListener('click', performLogin);
cancelLoginBtn.addEventListener('click', cancelLogin);
loginPassword.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') performLogin();
});

// ----- 初期化：認証を求める -----
document.addEventListener('DOMContentLoaded', () => {
    updateClock();
    setInterval(updateClock, 1000);
    toggleAdminFields();
    // 進入時認証モーダル表示
    showLoginModal();
});