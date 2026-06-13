// =============================================
// 備品管理モジュール（認証・入荷登録・消耗品○×対応）
// =============================================
import { getDb, writeSystemLog, showToast, formatDateTime } from "../common.js";
import {
    collection,
    getDocs,
    addDoc,
    deleteDoc,
    doc,
    updateDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";
import {
    getAuth,
    signInWithEmailAndPassword,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";

const db = getDb();
const auth = getAuth();

// DOM 要素
const itemNameInput = document.getElementById('itemName');
const itemLocationInput = document.getElementById('itemLocation');
const itemQuantityInput = document.getElementById('itemQuantity');
const itemOperatorSelect = document.getElementById('itemOperatorSelect');
const itemConsumableSelect = document.getElementById('itemConsumable');
const itemNotesInput = document.getElementById('itemNotes');
const addBtn = document.getElementById('addBtn');
const itemsTableBody = document.getElementById('itemsTableBody');
const emptyMessage = document.getElementById('emptyMessage');

const movementItemSelect = document.getElementById('movementItemSelect');
const movementQuantityInput = document.getElementById('movementQuantity');
const movementOperatorSelect = document.getElementById('movementOperatorSelect');
const movementSubmitBtn = document.getElementById('movementSubmitBtn');

const loginModalOverlay = document.getElementById('loginModalOverlay');
const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
const confirmLoginBtn = document.getElementById('confirmLoginBtn');
const cancelLoginBtn = document.getElementById('cancelLoginBtn');

let currentUser = null;
let pendingAddItem = false;
let pendingDeleteId = null;
let currentItems = [];

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
        showToast('ログインしました', 'success');
        if (pendingAddItem) {
            pendingAddItem = false;
            await addItem();
        }
        if (pendingDeleteId) {
            const idToDelete = pendingDeleteId;
            pendingDeleteId = null;
            await deleteItem(idToDelete);
        }
    } catch (error) {
        console.error('ログインエラー:', error);
        showToast('ログインに失敗しました。メールアドレスとパスワードを確認してください', 'error');
    }
}

onAuthStateChanged(auth, (user) => {
    currentUser = user;
});

// ----- ドロップダウン更新 -----
async function loadOperatorOptions() {
    try {
        const usersSnap = await getDocs(collection(db, "users"));
        const names = [];
        usersSnap.forEach(docSnap => {
            const data = docSnap.data();
            if (data.name && data.name.trim() !== '') {
                names.push(data.name.trim());
            }
        });
        const uniqueNames = [...new Set(names)].sort();

        // 操作者用（追加フォーム）
        itemOperatorSelect.innerHTML = '<option value="">-- 選択してください --</option>';
        uniqueNames.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            itemOperatorSelect.appendChild(opt);
        });

        // 入荷用操作者
        movementOperatorSelect.innerHTML = '<option value="">-- 選択してください --</option>';
        uniqueNames.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            movementOperatorSelect.appendChild(opt);
        });
    } catch (error) {
        console.error('ユーザー一覧取得エラー:', error);
    }
}

// ----- 備品一覧読み込み -----
async function loadItems() {
    try {
        const querySnapshot = await getDocs(collection(db, "items"));
        const items = [];
        querySnapshot.forEach(docSnap => items.push({ id: docSnap.id, ...docSnap.data() }));
        currentItems = items;

        itemsTableBody.innerHTML = '';
        if (items.length === 0) {
            emptyMessage.style.display = 'block';
        } else {
            emptyMessage.style.display = 'none';
            items.forEach(item => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${escapeHtml(item.name || '')}</td>
                    <td>${escapeHtml(item.location || '-')}</td>
                    <td>${item.quantity ?? 0}</td>
                    <td>${escapeHtml(item.operator || '-')}</td>
                    <td>${item.isConsumable ? '○' : '×'}</td>
                    <td>${escapeHtml(item.notes || '-')}</td>
                    <td><button class="btn btn-danger delete-btn" data-id="${item.id}">削除</button></td>
                `;
                itemsTableBody.appendChild(row);
            });

            document.querySelectorAll('.delete-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const id = e.target.getAttribute('data-id');
                    if (confirm('この備品を削除しますか？（認証が必要です）')) {
                        pendingDeleteId = id;
                        showLoginModal();
                    }
                });
            });
        }

        updateMovementSelect(items);
    } catch (error) {
        console.error('備品読み込みエラー:', error);
        showToast('備品の読み込みに失敗しました', 'error');
    }
}

function updateMovementSelect(items) {
    const uniqueNames = [...new Set(items.map(item => item.name).filter(Boolean))].sort();
    movementItemSelect.innerHTML = '<option value="">-- 備品を選択してください --</option>';
    uniqueNames.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        movementItemSelect.appendChild(option);
    });
}

// ----- 備品追加 -----
async function addItem() {
    const name = itemNameInput.value.trim();
    const location = itemLocationInput.value.trim();
    const quantity = parseInt(itemQuantityInput.value, 10);
    const operator = itemOperatorSelect.value;
    const isConsumable = itemConsumableSelect.value === 'yes';
    const notes = itemNotesInput.value.trim();

    if (!name) { showToast('物品名を入力してください', 'error'); return; }
    if (isNaN(quantity) || quantity < 0) { showToast('数量は0以上の数値を入力してください', 'error'); return; }

    try {
        await addDoc(collection(db, "items"), {
            name,
            location: location || '',
            quantity,
            operator: operator || '',
            isConsumable,
            notes: notes || '',
            createdAt: serverTimestamp()
        });

        await writeSystemLog(
            `備品「${name}」を追加（数量: ${quantity}${isConsumable ? ' 消耗品' : ''}）`,
            'items'
        );
        showToast('備品を追加しました', 'success');

        // フォームリセット
        itemNameInput.value = '';
        itemLocationInput.value = '';
        itemQuantityInput.value = '1';
        itemOperatorSelect.value = '';
        itemConsumableSelect.value = 'no';
        itemNotesInput.value = '';

        await loadItems();
    } catch (error) {
        console.error('追加エラー:', error);
        showToast('追加に失敗しました', 'error');
    }
}

function handleAddClick() {
    pendingAddItem = true;
    showLoginModal();
}

// ----- 備品削除 -----
async function deleteItem(id) {
    try {
        await deleteDoc(doc(db, "items", id));
        await writeSystemLog(`備品（ID: ${id}）を削除`, 'items');
        showToast('備品を削除しました', 'success');
        await loadItems();
    } catch (error) {
        console.error('削除エラー:', error);
        showToast('削除に失敗しました', 'error');
    }
}

// ----- 入荷登録 -----
async function handleMovementSubmit() {
    const itemName = movementItemSelect.value.trim();
    const addQty = parseInt(movementQuantityInput.value, 10);
    const operator = movementOperatorSelect.value;

    if (!itemName) { showToast('対象備品を選択してください', 'error'); return; }
    if (isNaN(addQty) || addQty < 1) { showToast('数量は1以上を入力してください', 'error'); return; }

    const targetItem = currentItems.find(item => item.name === itemName);
    if (!targetItem) { showToast('選択された備品が見つかりません', 'error'); return; }

    const newQty = (targetItem.quantity || 0) + addQty;

    try {
        await updateDoc(doc(db, "items", targetItem.id), { quantity: newQty });

        await addDoc(collection(db, "record"), {
            type: '入荷',
            itemName: itemName,
            itemId: targetItem.id,
            quantity: addQty,
            operator: operator || '',
            timestamp: serverTimestamp(),
            localTime: formatDateTime()
        });

        await writeSystemLog(
            `入荷登録: ${itemName} +${addQty} (操作者: ${operator || '未入力'})`,
            'items'
        );
        showToast(`「${itemName}」を${addQty}個入荷しました（現在数: ${newQty}）`, 'success');

        movementItemSelect.value = '';
        movementQuantityInput.value = '1';
        movementOperatorSelect.value = '';

        await loadItems();
    } catch (error) {
        console.error('入荷登録エラー:', error);
        showToast('入荷登録に失敗しました', 'error');
    }
}

// ----- イベント登録 -----
addBtn.addEventListener('click', handleAddClick);
document.querySelectorAll('.form-row input').forEach(input => {
    input.addEventListener('keydown', e => { if (e.key === 'Enter') handleAddClick(); });
});

confirmLoginBtn.addEventListener('click', performLogin);
cancelLoginBtn.addEventListener('click', () => {
    pendingAddItem = false;
    pendingDeleteId = null;
    hideLoginModal();
});
loginPassword.addEventListener('keydown', e => { if (e.key === 'Enter') performLogin(); });

movementSubmitBtn.addEventListener('click', handleMovementSubmit);

// ----- 初期化 -----
document.addEventListener('DOMContentLoaded', async () => {
    updateClock();
    setInterval(updateClock, 1000);
    await loadOperatorOptions();
    await loadItems();
});