// =============================================
// 貸出履歴モジュール（出席番号対応）
// =============================================
import { getDb, showToast } from "../common.js";
import {
    collection,
    getDocs,
    query
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";

const db = getDb();

// DOM 要素
const historyTableBody = document.getElementById('historyTableBody');
const emptyMessage = document.getElementById('emptyMessage');
const statusFilter = document.getElementById('statusFilter');

let allLoans = [];

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

// ----- データ読み込み -----
async function loadHistory() {
    try {
        const q = query(collection(db, "loans"));
        const snap = await getDocs(q);
        allLoans = [];
        snap.forEach(doc => {
            allLoans.push({ id: doc.id, ...doc.data() });
        });

        // 貸出日の降順
        allLoans.sort((a, b) => {
            const aTime = a.createdAt ? a.createdAt.seconds : 0;
            const bTime = b.createdAt ? b.createdAt.seconds : 0;
            return bTime - aTime;
        });

        renderLoans(allLoans);
    } catch (error) {
        console.error('履歴読み込みエラー:', error);
        showToast('履歴の読み込みに失敗しました', 'error');
    }
}

// ----- 履歴表示 -----
function renderLoans(loans) {
    historyTableBody.innerHTML = '';
    if (loans.length === 0) {
        emptyMessage.style.display = 'block';
    } else {
        emptyMessage.style.display = 'none';
        loans.forEach(loan => {
            const row = document.createElement('tr');
            const status = loan.status || 'active';
            const statusLabel = status === 'returned' ? '返却済' : '貸出中';
            const statusClass = status === 'returned' ? 'status-returned' : 'status-active';
            const isConsumable = loan.isConsumable || false;

            // 返却数量の表示
            let returnQtyDisplay = '-';
            if (isConsumable) {
                if (status === 'returned' && loan.returnQty !== undefined && loan.returnQty !== null) {
                    returnQtyDisplay = loan.returnQty;
                }
            }

            row.innerHTML = `
                <td>${escapeHtml(loan.itemName || '')}</td>
                <td>${escapeHtml(loan.borrowerName || '')}</td>
                <td>${escapeHtml(loan.borrowerId || '')}</td>
                <td>${loan.quantity ?? ''}</td>
                <td>${isConsumable ? '○' : '×'}</td>
                <td>${loan.loanDate || ''}</td>
                <td>${escapeHtml(loan.approverId || '')}</td>
                <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
                <td>${loan.returnDate || '-'}</td>
                <td>${escapeHtml(loan.receiverId || '-')}</td>
                <td>${escapeHtml(loan.returnId || '-')}</td>
                <td>${returnQtyDisplay}</td>
            `;
            historyTableBody.appendChild(row);
        });
    }
}

// ----- フィルター -----
function applyFilter() {
    const selected = statusFilter.value;
    if (!selected) {
        renderLoans(allLoans);
    } else {
        const filtered = allLoans.filter(loan => loan.status === selected);
        renderLoans(filtered);
    }
}

statusFilter.addEventListener('change', applyFilter);

// ----- 初期化 -----
document.addEventListener('DOMContentLoaded', async () => {
    updateClock();
    setInterval(updateClock, 1000);
    await loadHistory();
});
