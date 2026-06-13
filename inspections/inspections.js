// =============================================
// 点検モジュール（認証・二重確認・自動リダイレクト）
// =============================================
import { getDb, writeSystemLog, showToast, formatDateTime } from "../common.js";
import {
    collection,
    getDocs,
    addDoc,
    updateDoc,
    doc,
    serverTimestamp,
    query,
    orderBy,
    limit
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";
import {
    getAuth,
    signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";

const db = getDb();
const auth = getAuth();

// DOM 要素
const inspectionTableBody = document.getElementById('inspectionTableBody');
const emptyMessage = document.getElementById('emptyMessage');
const inspectionDateEl = document.getElementById('inspectionDate');
const inspectionCountEl = document.getElementById('inspectionCount');
const lastInspectionDateEl = document.getElementById('lastInspectionDate');
const submitBtn = document.getElementById('submitInspectionBtn');
const authAlertBar = document.getElementById('authAlertBar');

// 認証モーダル
const loginModalOverlay = document.getElementById('loginModalOverlay');
const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
const confirmLoginBtn = document.getElementById('confirmLoginBtn');
const cancelLoginBtn = document.getElementById('cancelLoginBtn');

// 第一次確認モーダル
const reviewModal1 = document.getElementById('reviewModal1');
const reviewTableBody1 = document.getElementById('reviewTableBody1');
const cancelReview1Btn = document.getElementById('cancelReview1Btn');
const confirmReview1Btn = document.getElementById('confirmReview1Btn');

// 第二次確認モーダル
const reviewModal2 = document.getElementById('reviewModal2');
const reviewTableBody2 = document.getElementById('reviewTableBody2');
const cancelReview2Btn = document.getElementById('cancelReview2Btn');
const confirmReview2Btn = document.getElementById('confirmReview2Btn');

let items = [];
let inspectionDetails = [];

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

function formatDate(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
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

async function performInitialLogin() {
    const email = loginEmail.value.trim();
    const password = loginPassword.value.trim();
    if (!email || !password) {
        showToast('メールアドレスとパスワードを入力してください', 'error');
        return;
    }
    try {
        await signInWithEmailAndPassword(auth, email, password);
        hideLoginModal();
        authAlertBar.classList.add('visible');
        showToast('認証成功', 'success');
        await loadInspectionData();
    } catch (error) {
        console.error('ログインエラー:', error);
        showToast('認証に失敗しました', 'error');
    }
}

function cancelLogin() {
    window.location.href = '../index.html';
}

// ----- 点検データ読み込み -----
async function loadInspectionData() {
    try {
        const itemsSnapshot = await getDocs(collection(db, "items"));
        items = [];
        itemsSnapshot.forEach(docSnap => items.push({ id: docSnap.id, ...docSnap.data() }));

        inspectionDateEl.textContent = formatDate();
        inspectionCountEl.textContent = items.length;

        // 前回点検日
        const inspQuery = query(
            collection(db, "inspections"),
            orderBy("createdAt", "desc"),
            limit(1)
        );
        const inspSnapshot = await getDocs(inspQuery);
        if (!inspSnapshot.empty) {
            const lastInsp = inspSnapshot.docs[0].data();
            lastInspectionDateEl.textContent = lastInsp.date || '----';
        } else {
            lastInspectionDateEl.textContent = '----';
        }

        // テーブル描画
        inspectionTableBody.innerHTML = '';
        if (items.length === 0) {
            emptyMessage.style.display = 'block';
        } else {
            emptyMessage.style.display = 'none';
            items.forEach((item, index) => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${escapeHtml(item.name || '')}</td>
                    <td>${escapeHtml(item.location || '-')}</td>
                    <td>${item.quantity ?? 0}</td>
                    <td>
                        <select class="status-select" data-index="${index}" required>
                            <option value="normal">✅ 正常</option>
                            <option value="lost">❌ 紛失</option>
                        </select>
                    </td>
                    <td>
                        <input type="text" class="notes-input" data-index="${index}" placeholder="備考（任意）">
                    </td>
                `;
                inspectionTableBody.appendChild(row);
            });
        }
    } catch (error) {
        console.error('点検データ読み込みエラー:', error);
        showToast('データの読み込みに失敗しました', 'error');
    }
}

// ----- 第一次確認モーダル表示 -----
function openReview1() {
    const statusSelects = document.querySelectorAll('.status-select');
    const notesInputs = document.querySelectorAll('.notes-input');

    inspectionDetails = [];
    statusSelects.forEach((select, i) => {
        const item = items[parseInt(select.dataset.index)];
        const notes = notesInputs[i] ? notesInputs[i].value.trim() : '';
        inspectionDetails.push({
            itemId: item.id,
            itemName: item.name,
            location: item.location || '',
            registeredQuantity: item.quantity,
            status: select.value,
            notes: notes,
            actualQuantity: item.quantity
        });
    });

    // 描画（編集可能）
    reviewTableBody1.innerHTML = '';
    inspectionDetails.forEach((d, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${escapeHtml(d.itemName)}</td>
            <td>${d.registeredQuantity}</td>
            <td>${d.status === 'lost' ? '❌ 紛失' : '✅ 正常'}</td>
            <td><input type="number" class="actual-qty-input" data-index="${idx}" min="0" value="${d.actualQuantity}"></td>
            <td>${escapeHtml(d.notes || '-')}</td>
        `;
        reviewTableBody1.appendChild(tr);
    });

    reviewModal1.classList.add('active');
}

// ----- 第一次 → 第二次 -----
function confirmReview1To2() {
    const inputs = document.querySelectorAll('.actual-qty-input');
    inputs.forEach(inp => {
        const idx = parseInt(inp.dataset.index);
        const val = parseInt(inp.value, 10);
        if (!isNaN(val) && val >= 0) {
            inspectionDetails[idx].actualQuantity = val;
        }
    });

    reviewTableBody2.innerHTML = '';
    inspectionDetails.forEach(d => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${escapeHtml(d.itemName)}</td>
            <td>${d.registeredQuantity}</td>
            <td>${d.status === 'lost' ? '❌ 紛失' : '✅ 正常'}</td>
            <td>${d.actualQuantity}</td>
            <td>${escapeHtml(d.notes || '-')}</td>
        `;
        reviewTableBody2.appendChild(tr);
    });

    reviewModal1.classList.remove('active');
    reviewModal2.classList.add('active');
}

// ----- 最終提出 -----
async function finalSubmitInspection() {
    try {
        // データベースの数量を現有数に更新
        for (const d of inspectionDetails) {
            if (d.actualQuantity !== d.registeredQuantity) {
                await updateDoc(doc(db, "items", d.itemId), { quantity: d.actualQuantity });
            }
        }

        const hasLost = inspectionDetails.some(d => d.status === 'lost');
        const overallStatus = hasLost ? 'lost' : 'normal';

        const inspectionData = {
            date: formatDate(),
            overallStatus: overallStatus,
            details: inspectionDetails,
            createdAt: serverTimestamp(),
            localTime: formatDateTime()
        };

        await addDoc(collection(db, "inspections"), inspectionData);
        await writeSystemLog(
            `点検提出: ${formatDate()} 対象${items.length}件 状態=${overallStatus}`,
            'inspections'
        );

        showToast('点検を提出しました', 'success');
        reviewModal2.classList.remove('active');

        // 1.5秒後にトップページへ自動遷移
        setTimeout(() => {
            window.location.href = '../index.html';
        }, 1500);
    } catch (error) {
        console.error('点検提出エラー:', error);
        showToast('点検の提出に失敗しました', 'error');
    }
}

// ----- イベント登録 -----
submitBtn.addEventListener('click', openReview1);

confirmLoginBtn.addEventListener('click', performInitialLogin);
cancelLoginBtn.addEventListener('click', cancelLogin);
loginPassword.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') performInitialLogin();
});

confirmReview1Btn.addEventListener('click', confirmReview1To2);
cancelReview1Btn.addEventListener('click', () => reviewModal1.classList.remove('active'));

confirmReview2Btn.addEventListener('click', finalSubmitInspection);
cancelReview2Btn.addEventListener('click', () => reviewModal2.classList.remove('active'));

// ----- 初期化 -----
document.addEventListener('DOMContentLoaded', () => {
    updateClock();
    setInterval(updateClock, 1000);
    showLoginModal();
});