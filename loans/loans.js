// =============================================
// 貸出・返却モジュール（出席番号対応、返却氏名省略）
// =============================================
import { getDb, writeSystemLog, showToast, formatDateTime } from "../common.js";
import {
    collection,
    getDocs,
    addDoc,
    updateDoc,
    doc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";

const db = getDb();

// DOM 要素
const loanItemSelect = document.getElementById('loanItemSelect');
const loanQuantity = document.getElementById('loanQuantity');
const loanApproverId = document.getElementById('loanApproverId');
const loanBorrowerName = document.getElementById('loanBorrowerName');
const loanBorrowerId = document.getElementById('loanBorrowerId');
const loanNotes = document.getElementById('loanNotes');
const loanSubmitBtn = document.getElementById('loanSubmitBtn');
const activeLoansBody = document.getElementById('activeLoansBody');
const activeEmptyMessage = document.getElementById('activeEmptyMessage');

// 消耗品警告モーダル
const warningModalOverlay = document.getElementById('warningModalOverlay');
const closeWarningBtn = document.getElementById('closeWarningBtn');

// 通常返却モーダル
const returnModalOverlay = document.getElementById('returnModalOverlay');
const returnItemName = document.getElementById('returnItemName');
const returnItemQty = document.getElementById('returnItemQty');
const returnReceiverId = document.getElementById('returnReceiverId');
const returnId = document.getElementById('returnId');
const confirmReturnBtn = document.getElementById('confirmReturnBtn');
const cancelReturnBtn = document.getElementById('cancelReturnBtn');

// 消耗品返却モーダル
const consumableReturnModalOverlay = document.getElementById('consumableReturnModalOverlay');
const consumableReturnItemName = document.getElementById('consumableReturnItemName');
const consumableReturnLoanQty = document.getElementById('consumableReturnLoanQty');
const consumableReturnReceiverId = document.getElementById('consumableReturnReceiverId');
const consumableReturnId = document.getElementById('consumableReturnId');
const consumableRemainingQty = document.getElementById('consumableRemainingQty');
const confirmConsumableReturnBtn = document.getElementById('confirmConsumableReturnBtn');
const cancelConsumableReturnBtn = document.getElementById('cancelConsumableReturnBtn');

let items = [];
let activeLoans = [];
let pendingReturnLoanId = null;
let pendingReturnConsumableLoanId = null;

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

function getTotalStock(itemName) {
    return items.filter(i => i.name === itemName && i.recordType !== 'status')
                .reduce((sum, i) => sum + (i.quantity || 0), 0);
}

// ----- データ読み込み -----
async function loadData() {
    try {
        const itemsSnap = await getDocs(collection(db, "items"));
        items = [];
        itemsSnap.forEach(doc => items.push({ id: doc.id, ...doc.data() }));

        // 数量記録で在庫がある物品のみ表示
        const available = items.filter(item => (item.quantity || 0) > 0 && item.recordType !== 'status');
        const names = [...new Set(available.map(item => item.name).filter(Boolean))].sort();

        loanItemSelect.innerHTML = '<option value="">-- 選択してください --</option>';
        names.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = `${name} (在庫: ${getTotalStock(name)}個)`;
            loanItemSelect.appendChild(opt);
        });

        await loadActiveLoans();
    } catch (error) {
        console.error('データ読み込みエラー:', error);
        showToast('データの読み込みに失敗しました', 'error');
    }
}

async function loadActiveLoans() {
    const snap = await getDocs(collection(db, "loans"));
    activeLoans = [];
    snap.forEach(doc => {
        const data = doc.data();
        if (data.status === 'active') {
            activeLoans.push({ id: doc.id, ...data });
        }
    });

    activeLoansBody.innerHTML = '';
    if (activeLoans.length === 0) {
        activeEmptyMessage.style.display = 'block';
        return;
    }
    activeEmptyMessage.style.display = 'none';

    activeLoans.forEach(loan => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${escapeHtml(loan.itemName || '')}</td>
            <td>${escapeHtml(loan.borrowerName || '')}</td>
            <td>${escapeHtml(loan.borrowerId || '')}</td>
            <td>${loan.quantity}</td>
            <td>${loan.isConsumable ? '○' : '×'}</td>
            <td>${loan.loanDate || ''}</td>
            <td>${escapeHtml(loan.approverId || '')}</td>
            <td>${escapeHtml(loan.notes || '')}</td>
            <td><button class="btn btn-success return-btn" data-id="${loan.id}" data-consumable="${loan.isConsumable || false}">返却</button></td>
        `;
        activeLoansBody.appendChild(row);
    });

    document.querySelectorAll('.return-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const loanId = e.target.dataset.id;
            const isConsumable = e.target.dataset.consumable === 'true';
            const loan = activeLoans.find(l => l.id === loanId);
            if (!loan) return;

            if (isConsumable) {
                pendingReturnConsumableLoanId = loanId;
                consumableReturnItemName.textContent = loan.itemName;
                consumableReturnLoanQty.textContent = loan.quantity;
                consumableReturnReceiverId.value = '';
                consumableReturnId.value = '';
                consumableRemainingQty.value = 0;
                consumableReturnModalOverlay.classList.add('active');
            } else {
                pendingReturnLoanId = loanId;
                returnItemName.textContent = loan.itemName;
                returnItemQty.textContent = loan.quantity;
                returnReceiverId.value = '';
                returnId.value = '';
                returnModalOverlay.classList.add('active');
            }
        });
    });
}

// ----- 貸出実行 -----
async function executeLoan() {
    const itemName = loanItemSelect.value;
    const qty = parseInt(loanQuantity.value, 10);
    const approverId = loanApproverId.value.trim();
    const borrowerName = loanBorrowerName.value.trim();
    const borrowerId = loanBorrowerId.value.trim();
    const notes = loanNotes.value.trim();

    if (!itemName || !approverId || !borrowerName || !borrowerId || isNaN(qty) || qty < 1) {
        showToast('すべての項目を正しく入力してください', 'error');
        return;
    }

    const totalStock = getTotalStock(itemName);
    if (totalStock < qty) {
        showToast('在庫不足です', 'error');
        return;
    }

    const targetItem = items.find(i => i.name === itemName);
    const isConsumable = targetItem ? targetItem.isConsumable : false;

    // 在庫減少
    let remaining = qty;
    for (const item of items) {
        if (item.name === itemName && item.recordType !== 'status' && item.quantity > 0) {
            const deduct = Math.min(item.quantity, remaining);
            await updateDoc(doc(db, "items", item.id), { quantity: item.quantity - deduct });
            remaining -= deduct;
            if (remaining <= 0) break;
        }
    }

    const loanDate = new Date().toISOString().slice(0, 10);
    await addDoc(collection(db, "loans"), {
        itemName,
        quantity: qty,
        approverId,
        borrowerName,
        borrowerId,
        notes,
        isConsumable,
        loanDate,
        status: 'active',
        createdAt: serverTimestamp()
    });

    // ログ
    await writeSystemLog(
        `貸出: ${itemName} ${qty}個 → ${borrowerName}(${borrowerId}) 承認:${approverId}${isConsumable ? ' (消耗品)' : ''}`,
        'loans'
    );
    showToast(`${itemName}を${qty}個貸し出しました`, 'success');

    // フォームリセット
    loanItemSelect.value = '';
    loanQuantity.value = '1';
    loanApproverId.value = '';
    loanBorrowerName.value = '';
    loanBorrowerId.value = '';
    loanNotes.value = '';

    if (isConsumable) {
        warningModalOverlay.classList.add('active');
    }

    await loadData();
}

// ----- 通常返却 -----
async function executeReturn() {
    const receiverId = returnReceiverId.value.trim();
    const retId = returnId.value.trim();

    if (!receiverId || !retId) {
        showToast('すべての出席番号を入力してください', 'error');
        return;
    }

    const loan = activeLoans.find(l => l.id === pendingReturnLoanId);
    if (!loan) return;

    const targetItem = items.find(i => i.name === loan.itemName);
    if (targetItem) {
        await updateDoc(doc(db, "items", targetItem.id), { quantity: (targetItem.quantity || 0) + loan.quantity });
    }

    await updateDoc(doc(db, "loans", loan.id), {
        status: 'returned',
        receiverId,
        returnId: retId,
        returnDate: new Date().toISOString().slice(0, 10)
    });

    await writeSystemLog(`返却: ${loan.itemName} (受取:${receiverId} 返却者:${retId})`, 'loans');
    showToast('返却しました', 'success');

    returnModalOverlay.classList.remove('active');
    pendingReturnLoanId = null;
    await loadData();
}

// ----- 消耗品返却 -----
async function executeConsumableReturn() {
    const receiverId = consumableReturnReceiverId.value.trim();
    const retId = consumableReturnId.value.trim();
    const retQty = parseInt(consumableRemainingQty.value, 10);

    if (!receiverId || !retId || isNaN(retQty) || retQty < 0) {
        showToast('すべての項目を正しく入力してください', 'error');
        return;
    }

    const loan = activeLoans.find(l => l.id === pendingReturnConsumableLoanId);
    if (!loan) return;

    if (retQty > loan.quantity) {
        showToast(`返却数量は貸出数量(${loan.quantity})以下にしてください`, 'error');
        return;
    }

    const targetItem = items.find(i => i.name === loan.itemName);
    if (targetItem) {
        await updateDoc(doc(db, "items", targetItem.id), { quantity: (targetItem.quantity || 0) + retQty });
    }

    await updateDoc(doc(db, "loans", loan.id), {
        status: 'returned',
        receiverId,
        returnId: retId,
        returnDate: new Date().toISOString().slice(0, 10),
        returnQty: retQty
    });

    await writeSystemLog(`消耗品返却: ${loan.itemName} 返却${retQty}個 (受取:${receiverId} 返却者:${retId})`, 'loans');
    showToast('返却しました', 'success');

    consumableReturnModalOverlay.classList.remove('active');
    pendingReturnConsumableLoanId = null;
    await loadData();
}

// ----- イベント -----
loanSubmitBtn.addEventListener('click', executeLoan);
closeWarningBtn.addEventListener('click', () => warningModalOverlay.classList.remove('active'));
confirmReturnBtn.addEventListener('click', executeReturn);
cancelReturnBtn.addEventListener('click', () => {
    returnModalOverlay.classList.remove('active');
    pendingReturnLoanId = null;
});
confirmConsumableReturnBtn.addEventListener('click', executeConsumableReturn);
cancelConsumableReturnBtn.addEventListener('click', () => {
    consumableReturnModalOverlay.classList.remove('active');
    pendingReturnConsumableLoanId = null;
});

// ----- 初期化 -----
document.addEventListener('DOMContentLoaded', () => {
    updateClock();
    setInterval(updateClock, 1000);
    loadData();
});
