// =============================================
// 備品管理モジュール（数量/状態、補充機能、ロケーション並び替え）
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

const db = getDb();

// DOM 要素
const itemName = document.getElementById('itemName');
const itemLocation = document.getElementById('itemLocation');
const recordType = document.getElementById('recordType');
const quantityGroup = document.getElementById('quantityGroup');
const statusGroup = document.getElementById('statusGroup');
const itemQuantity = document.getElementById('itemQuantity');
const itemStatus = document.getElementById('itemStatus');
const studentId = document.getElementById('studentId');
const itemConsumable = document.getElementById('itemConsumable');
const itemNotes = document.getElementById('itemNotes');
const addBtn = document.getElementById('addBtn');
const itemsTableBody = document.getElementById('itemsTableBody');
const emptyMessage = document.getElementById('emptyMessage');

// 補充モーダル
const refillModalOverlay = document.getElementById('refillModalOverlay');
const refillQuantitySection = document.getElementById('refillQuantitySection');
const refillStatusSection = document.getElementById('refillStatusSection');
const currentQtyDisplay = document.getElementById('currentQtyDisplay');
const addQuantity = document.getElementById('addQuantity');
const currentStatusDisplay = document.getElementById('currentStatusDisplay');
const newStatus = document.getElementById('newStatus');
const refillStudentId = document.getElementById('refillStudentId');
const confirmRefillBtn = document.getElementById('confirmRefillBtn');
const cancelRefillBtn = document.getElementById('cancelRefillBtn');

let currentItems = [];
let refillingItemId = null;

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

// 自然ソート（A-1, A-2, A-10 順）
function naturalCompare(a, b) {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

// 記録方式切り替え
recordType.addEventListener('change', () => {
    if (recordType.value === 'quantity') {
        quantityGroup.style.display = 'flex';
        statusGroup.style.display = 'none';
    } else {
        quantityGroup.style.display = 'none';
        statusGroup.style.display = 'flex';
    }
});

// ----- データ読み込み -----
async function loadItems() {
    try {
        const snap = await getDocs(collection(db, "items"));
        const items = [];
        snap.forEach(doc => items.push({ id: doc.id, ...doc.data() }));

        // ロケーションで自然順ソート
        items.sort((a, b) => naturalCompare(a.location || '', b.location || ''));

        currentItems = items;
        renderTable(items);
    } catch (error) {
        console.error(error);
        showToast('備品の読み込みに失敗しました', 'error');
    }
}

function renderTable(items) {
    itemsTableBody.innerHTML = '';
    if (items.length === 0) {
        emptyMessage.style.display = 'block';
        return;
    }
    emptyMessage.style.display = 'none';

    items.forEach(item => {
        const row = document.createElement('tr');
        let displayValue = '';
        if (item.recordType === 'status') {
            displayValue = item.status || '-';
        } else {
            displayValue = item.quantity ?? 0;
        }
        row.innerHTML = `
            <td>${escapeHtml(item.name || '')}</td>
            <td>${escapeHtml(item.location || '-')}</td>
            <td>${item.recordType === 'status' ? '状態' : '数量'}</td>
            <td>${displayValue}</td>
            <td>${escapeHtml(item.studentId || '-')}</td>
            <td>${item.isConsumable ? '○' : '×'}</td>
            <td>${escapeHtml(item.notes || '-')}</td>
            <td>
                <button class="btn btn-success refill-btn" data-id="${item.id}">補充</button>
                <button class="btn btn-danger delete-btn" data-id="${item.id}">削除</button>
            </td>
        `;
        itemsTableBody.appendChild(row);
    });

    // 削除イベント
    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = e.target.getAttribute('data-id');
            if (confirm('この備品を削除しますか？')) {
                await deleteItem(id);
            }
        });
    });

    // 補充イベント
    document.querySelectorAll('.refill-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.target.getAttribute('data-id');
            openRefillModal(id);
        });
    });
}

// ----- 補充モーダル -----
function openRefillModal(itemId) {
    const item = currentItems.find(i => i.id === itemId);
    if (!item) return;
    refillingItemId = itemId;

    if (item.recordType === 'status') {
        refillQuantitySection.style.display = 'none';
        refillStatusSection.style.display = 'block';
        currentStatusDisplay.value = item.status || '—';
        newStatus.value = item.status || '十分';
    } else {
        refillQuantitySection.style.display = 'block';
        refillStatusSection.style.display = 'none';
        currentQtyDisplay.value = item.quantity ?? 0;
        addQuantity.value = 0;
    }
    refillStudentId.value = '';
    refillModalOverlay.classList.add('active');
}

async function executeRefill() {
    const item = currentItems.find(i => i.id === refillingItemId);
    if (!item) return;

    const sid = refillStudentId.value.trim();
    if (!sid) {
        showToast('出席番号を入力してください', 'error');
        return;
    }

    try {
        if (item.recordType === 'quantity') {
            const addQty = parseInt(addQuantity.value, 10);
            if (isNaN(addQty) || addQty < 0) {
                showToast('有効な追加数量を入力してください', 'error');
                return;
            }
            const newQty = (item.quantity || 0) + addQty;
            await updateDoc(doc(db, "items", item.id), { quantity: newQty });
            await writeSystemLog(
                `補充 (数量): ${item.name} +${addQty} → ${newQty} (出席番号:${sid})`,
                'items'
            );
            showToast(`「${item.name}」を${addQty}個補充しました（現在数: ${newQty}）`, 'success');
        } else {
            const status = newStatus.value;
            await updateDoc(doc(db, "items", item.id), { status: status });
            await writeSystemLog(
                `補充 (状態): ${item.name} 状態を「${status}」に変更 (出席番号:${sid})`,
                'items'
            );
            showToast(`「${item.name}」の状態を「${status}」に更新しました`, 'success');
        }

        refillModalOverlay.classList.remove('active');
        await loadItems();
    } catch (error) {
        console.error(error);
        showToast('補充に失敗しました', 'error');
    }
}

// ----- 追加 -----
async function addItem() {
    const name = itemName.value.trim();
    const location = itemLocation.value.trim();
    const type = recordType.value;
    const consumable = itemConsumable.value === 'yes';
    const notes = itemNotes.value.trim();
    const sid = studentId.value.trim();

    if (!name) { showToast('物品名を入力してください', 'error'); return; }
    if (!sid) { showToast('出席番号を入力してください', 'error'); return; }

    const data = {
        name,
        location: location || '',
        recordType: type,
        isConsumable: consumable,
        studentId: sid,
        notes: notes || '',
        createdAt: serverTimestamp()
    };

    if (type === 'quantity') {
        const qty = parseInt(itemQuantity.value, 10);
        if (isNaN(qty) || qty < 0) {
            showToast('有効な数量を入力してください', 'error');
            return;
        }
        data.quantity = qty;
    } else {
        data.status = itemStatus.value;
    }

    try {
        await addDoc(collection(db, "items"), data);
        await writeSystemLog(`備品「${name}」を追加（出席番号:${sid}）`, 'items');
        showToast('備品を追加しました', 'success');

        // フォームリセット
        itemName.value = '';
        itemLocation.value = '';
        recordType.value = 'quantity';
        quantityGroup.style.display = 'flex';
        statusGroup.style.display = 'none';
        itemQuantity.value = '1';
        itemStatus.value = '十分';
        studentId.value = '';
        itemConsumable.value = 'no';
        itemNotes.value = '';

        await loadItems();
    } catch (error) {
        console.error(error);
        showToast('追加に失敗しました', 'error');
    }
}

// ----- 削除 -----
async function deleteItem(id) {
    try {
        await deleteDoc(doc(db, "items", id));
        await writeSystemLog(`備品（ID: ${id}）を削除`, 'items');
        showToast('備品を削除しました', 'success');
        await loadItems();
    } catch (error) {
        console.error(error);
        showToast('削除に失敗しました', 'error');
    }
}

// ----- イベント -----
addBtn.addEventListener('click', addItem);
confirmRefillBtn.addEventListener('click', executeRefill);
cancelRefillBtn.addEventListener('click', () => {
    refillModalOverlay.classList.remove('active');
});

// ----- 初期化 -----
document.addEventListener('DOMContentLoaded', () => {
    updateClock();
    setInterval(updateClock, 1000);
    loadItems();
});
