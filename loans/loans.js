// =============================================
// 貸出・返却モジュール（消耗品返却ロジック修正）
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
const loanQuantityInput = document.getElementById('loanQuantity');
const loanApproverSelect = document.getElementById('loanApproverSelect');
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
const returnReceiverSelect = document.getElementById('returnReceiverSelect');
const returnName = document.getElementById('returnName');
const returnId = document.getElementById('returnId');
const confirmReturnBtn = document.getElementById('confirmReturnBtn');
const cancelReturnBtn = document.getElementById('cancelReturnBtn');

// 消耗品返却モーダル
const consumableReturnModalOverlay = document.getElementById('consumableReturnModalOverlay');
const consumableReturnItemName = document.getElementById('consumableReturnItemName');
const consumableReturnLoanQty = document.getElementById('consumableReturnLoanQty');
const consumableReturnReceiverSelect = document.getElementById('consumableReturnReceiverSelect');
const consumableReturnName = document.getElementById('consumableReturnName');
const consumableReturnId = document.getElementById('consumableReturnId');
const consumableRemainingQty = document.getElementById('consumableRemainingQty');
const confirmConsumableReturnBtn = document.getElementById('confirmConsumableReturnBtn');
const cancelConsumableReturnBtn = document.getElementById('cancelConsumableReturnBtn');

let items = [];
let users = [];
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
        now.toLocaleString('ja-JP', { year:'numeric', month:'2-digit', day:'2-digit',
        hour:'2-digit', minute:'2-digit', second:'2-digit' });
}

function getTotalStock(itemName) {
    return items.filter(i => i.name === itemName).reduce((sum, i) => sum + (i.quantity || 0), 0);
}

// ----- データ読み込み -----
async function loadData() {
    try {
        const itemsSnap = await getDocs(collection(db, "items"));
        items = [];
        itemsSnap.forEach(doc => items.push({ id: doc.id, ...doc.data() }));

        const usersSnap = await getDocs(collection(db, "users"));
        users = [];
        usersSnap.forEach(doc => users.push({ id: doc.id, ...doc.data() }));

        updateItemSelect();
        updateApproverSelect();
        updateReceiverSelects();
        await loadActiveLoans();
    } catch (error) {
        console.error('データ読み込みエラー:', error);
        showToast('データの読み込みに失敗しました', 'error');
    }
}

function updateItemSelect() {
    const available = items.filter(item => (item.quantity || 0) > 0);
    const names = [...new Set(available.map(item => item.name).filter(Boolean))].sort();
    loanItemSelect.innerHTML = '<option value="">-- 選択してください --</option>';
    names.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = `${name} (在庫: ${getTotalStock(name)}個)`;
        loanItemSelect.appendChild(opt);
    });
}

function updateApproverSelect() {
    const names = [...new Set(users.map(u => u.name).filter(Boolean))].sort();
    loanApproverSelect.innerHTML = '<option value="">-- 選択してください --</option>';
    names.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        loanApproverSelect.appendChild(opt);
    });
}

function updateReceiverSelects() {
    const names = [...new Set(users.map(u => u.name).filter(Boolean))].sort();
    const fill = (select) => {
        select.innerHTML = '<option value="">-- 選択してください --</option>';
        names.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            select.appendChild(opt);
        });
    };
    fill(returnReceiverSelect);
    fill(consumableReturnReceiverSelect);
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
    } else {
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
                <td>${escapeHtml(loan.approver || '')}</td>
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
                    consumableReturnReceiverSelect.value = '';
                    consumableReturnName.value = '';
                    consumableReturnId.value = '';
                    consumableRemainingQty.value = '';
                    consumableReturnModalOverlay.classList.add('active');
                    consumableReturnReceiverSelect.focus();
                } else {
                    pendingReturnLoanId = loanId;
                    returnItemName.textContent = loan.itemName || '--';
                    returnItemQty.textContent = loan.quantity ?? '--';
                    returnReceiverSelect.value = '';
                    returnName.value = '';
                    returnId.value = '';
                    returnModalOverlay.classList.add('active');
                    returnReceiverSelect.focus();
                }
            });
        });
    }
}

// ----- 貸出実行 -----
async function executeLoan() {
    const itemName = loanItemSelect.value;
    const qty = parseInt(loanQuantityInput.value, 10);
    const approver = loanApproverSelect.value;
    const borrowerName = loanBorrowerName.value.trim();
    const borrowerId = loanBorrowerId.value.trim();
    const notes = loanNotes.value.trim();

    if (!itemName) { showToast('物品を選択してください', 'error'); return; }
    if (!approver) { showToast('承認人を選択してください', 'error'); return; }
    if (!borrowerName) { showToast('貸出先の氏名を入力してください', 'error'); return; }
    if (!borrowerId) { showToast('貸出先の出席番号を入力してください', 'error'); return; }
    if (isNaN(qty) || qty < 1) { showToast('数量は1以上を入力してください', 'error'); return; }

    const totalStock = getTotalStock(itemName);
    if (totalStock < qty) {
        showToast(`在庫不足です。（現在の在庫: ${totalStock}個）`, 'error');
        return;
    }

    const targetItem = items.find(i => i.name === itemName);
    const isConsumable = targetItem ? targetItem.isConsumable : false;

    // 在庫減少
    let remaining = qty;
    for (const item of items) {
        if (item.name === itemName && item.quantity > 0) {
            const deduct = Math.min(item.quantity, remaining);
            await updateDoc(doc(db, "items", item.id), { quantity: item.quantity - deduct });
            remaining -= deduct;
            if (remaining <= 0) break;
        }
    }

    const loanDate = new Date().toISOString().slice(0, 10);
    await addDoc(collection(db, "loans"), {
        itemName, quantity: qty, approver,
        borrowerName, borrowerId, notes,
        isConsumable,
        loanDate, status: 'active',
        createdAt: serverTimestamp()
    });

    await addDoc(collection(db, "record"), {
        type: '貸出', itemName, quantity: qty,
        operator: approver, borrowerName, borrowerId,
        isConsumable,
        timestamp: serverTimestamp(), localTime: formatDateTime()
    });
    await writeSystemLog(
        `貸出: ${itemName} ${qty}個 → ${borrowerName}(${borrowerId}) 承認:${approver}${isConsumable ? ' (消耗品)' : ''}`,
        'loans'
    );

    showToast(`${itemName}を${qty}個貸し出しました`, 'success');

    loanItemSelect.value = '';
    loanQuantityInput.value = '1';
    loanApproverSelect.value = '';
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
    const receiver = returnReceiverSelect.value;
    const retName = returnName.value.trim();
    const retId = returnId.value.trim();

    if (!receiver) { showToast('受取人を選択してください', 'error'); return; }
    if (!retName) { showToast('返却者の氏名を入力してください', 'error'); return; }
    if (!retId) { showToast('返却者の出席番号を入力してください', 'error'); return; }

    const loan = activeLoans.find(l => l.id === pendingReturnLoanId);
    if (!loan) { showToast('貸出記録が見つかりません', 'error'); return; }

    try {
        // 非消耗品は全量戻す
        const targetItem = items.find(i => i.name === loan.itemName);
        if (targetItem) {
            await updateDoc(doc(db, "items", targetItem.id), { quantity: (targetItem.quantity || 0) + loan.quantity });
        }

        await updateDoc(doc(db, "loans", loan.id), {
            status: 'returned',
            receiver, returnName: retName, returnId: retId,
            returnDate: new Date().toISOString().slice(0, 10)
        });

        await addDoc(collection(db, "record"), {
            type: '返却', itemName: loan.itemName, quantity: loan.quantity,
            operator: retName, operatorId: retId, receiver,
            timestamp: serverTimestamp(), localTime: formatDateTime()
        });
        await writeSystemLog(
            `返却: ${loan.itemName} ${loan.quantity}個（返却者: ${retName} ${retId} 受取:${receiver}）`,
            'loans'
        );

        showToast('返却しました', 'success');
        returnModalOverlay.classList.remove('active');
        pendingReturnLoanId = null;
        await loadData();
    } catch (error) {
        console.error(error);
        showToast('返却処理に失敗しました', 'error');
    }
}

// ----- 消耗品返却（修正：返却数量を加算） -----
async function executeConsumableReturn() {
    const receiver = consumableReturnReceiverSelect.value;
    const retName = consumableReturnName.value.trim();
    const retId = consumableReturnId.value.trim();
    // 今回戻ってきた数量
    const returnQty = parseInt(consumableRemainingQty.value, 10);

    if (!receiver) { showToast('受取人を選択してください', 'error'); return; }
    if (!retName) { showToast('返却者の氏名を入力してください', 'error'); return; }
    if (!retId) { showToast('返却者の出席番号を入力してください', 'error'); return; }
    if (isNaN(returnQty) || returnQty < 0) { showToast('返却数量は0以上を入力してください', 'error'); return; }

    const loan = activeLoans.find(l => l.id === pendingReturnConsumableLoanId);
    if (!loan) { showToast('貸出記録が見つかりません', 'error'); return; }

    // 返却数量が借出数量を超えていないかチェック
    if (returnQty > loan.quantity) {
        showToast(`返却数量は貸出数量(${loan.quantity})以下にしてください`, 'error');
        return;
    }

    try {
        // 在庫に今回戻ってきた分を加算
        const targetItem = items.find(i => i.name === loan.itemName);
        if (targetItem) {
            await updateDoc(doc(db, "items", targetItem.id), { quantity: (targetItem.quantity || 0) + returnQty });
        }

        // ローン情報更新（消費された数量も記録）
        await updateDoc(doc(db, "loans", loan.id), {
            status: 'returned',
            receiver, returnName: retName, returnId: retId,
            returnDate: new Date().toISOString().slice(0, 10),
            returnQty: returnQty,
            consumedQty: loan.quantity - returnQty
        });

        // 操作ログ
        await addDoc(collection(db, "record"), {
            type: '返却 (消耗品)', itemName: loan.itemName,
            loanQuantity: loan.quantity,
            returnQty: returnQty,
            consumedQty: loan.quantity - returnQty,
            operator: retName, operatorId: retId, receiver,
            timestamp: serverTimestamp(), localTime: formatDateTime()
        });
        await writeSystemLog(
            `消耗品返却: ${loan.itemName} 貸出${loan.quantity}個 → 返却${returnQty}個（消費${loan.quantity - returnQty}個） 返却者:${retName} ${retId} 受取:${receiver}`,
            'loans'
        );

        showToast('消耗品を返却しました', 'success');
        consumableReturnModalOverlay.classList.remove('active');
        pendingReturnConsumableLoanId = null;
        await loadData();
    } catch (error) {
        console.error(error);
        showToast('返却処理に失敗しました', 'error');
    }
}

// ----- イベント -----
loanSubmitBtn.addEventListener('click', executeLoan);

closeWarningBtn.addEventListener('click', () => {
    warningModalOverlay.classList.remove('active');
});

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
document.addEventListener('DOMContentLoaded', async () => {
    updateClock();
    setInterval(updateClock, 1000);
    await loadData();
});