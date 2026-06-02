import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Wallet, Share2, TrendingUp, Users, RefreshCw, History, PlusCircle, MinusCircle, AlertCircle, CheckCircle2, ShieldCheck, LogOut } from 'lucide-react';
import { db } from './firebase';
import { collection, doc, onSnapshot, updateDoc, setDoc, getDocs, writeBatch } from 'firebase/firestore';
import { OperationType, UserAccount, Transaction } from './types';
import { handleFirestoreError } from './utils';
import AdminPanel from './AdminPanel';

// --- Default Data to Initialize if Empty ---
const DEFAULT_USERS: UserAccount[] = [
  { id: '1', name: 'Tariq', units: 232633.93, netDeposits: 232463.58, benchmarkCapital: 233000 },
  { id: '2', name: 'Yara', units: 24350.35, netDeposits: 24332.52, benchmarkCapital: 20000 },
  { id: '3', name: 'Dad', units: 782376.83, netDeposits: 781803.90, benchmarkCapital: 750000 },
  { id: '4', name: 'Hazem', units: 210153.89, netDeposits: 210000.00, benchmarkCapital: 210000 },
];
const DEFAULT_PORTFOLIO_VALUE = 1249515.00;

const formatCurrency = (value: number) => 
  new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP', minimumFractionDigits: 2 }).format(value);

const formatPercentage = (value: number) => 
  new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 2 }).format(value);

interface ModalState {
  isOpen: boolean;
  type: 'update_value' | 'deposit' | 'withdraw' | 'history' | 'update_metrics' | '';
  userId: string | null;
}

interface DashboardProps {
  isAdmin: boolean;
  onLogout: () => void;
}

export default function Dashboard({ isAdmin, onLogout }: DashboardProps) {
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<(UserAccount & { history: Transaction[] })[]>([]);
  const [portfolioValue, setPortfolioValue] = useState(0);
  const [metrics, setMetrics] = useState({
    monthlyAlpha: 0,
    yearlyAlpha: 0,
    beta: 0
  });
  
  const [modal, setModal] = useState<ModalState>({ isOpen: false, type: '', userId: null });
  const [modalAmount, setModalAmount] = useState('');
  const [modalMetrics, setModalMetrics] = useState({ monthlyAlpha: '', yearlyAlpha: '', beta: '' });
  const [modalNote, setModalNote] = useState('');
  const [modalError, setModalError] = useState('');

  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Check and initialize data
    const initializeData = async () => {
      try {
        const usersSnapshot = await getDocs(collection(db, 'users'));
        if (usersSnapshot.empty) {
          const batch = writeBatch(db);
          batch.set(doc(db, 'portfolio', 'global'), { portfolioValue: DEFAULT_PORTFOLIO_VALUE });
          
          for (const u of DEFAULT_USERS) {
            batch.set(doc(db, 'users', u.id), {
              name: u.name,
              units: u.units,
              netDeposits: u.netDeposits,
              benchmarkCapital: u.benchmarkCapital
            });
          }
          await batch.commit();
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, 'users');
      }
    };

    initializeData().then(() => {
      const unsubPortfolio = onSnapshot(doc(db, 'portfolio', 'global'), (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setPortfolioValue(data.portfolioValue || 0);
          setMetrics({
            monthlyAlpha: data.monthlyAlpha || 0,
            yearlyAlpha: data.yearlyAlpha || 0,
            beta: data.beta || 0,
          });
        }
      }, (err) => handleFirestoreError(err, OperationType.GET, 'portfolio/global'));

      const unsubUsers = onSnapshot(collection(db, 'users'), async (snap) => {
        const usersData = snap.docs.map(d => ({ id: d.id, ...d.data() } as UserAccount));
        
        // Listen to histories
        const fullUsers: (UserAccount & { history: Transaction[] })[] = [];
        
        // For a simple app, doing multiple gets or setting up multiple snapshots 
        // to subcollections is okay. To keep it simple, we'll fetch them once per user update.
        // Or setup snapshot for each history subcollection.
        for (const u of usersData) {
          const historySnap = await getDocs(collection(db, `users/${u.id}/history`));
          const history = historySnap.docs.map(d => ({ id: d.id, ...d.data() } as Transaction))
            .sort((a,b) => b.timestamp - a.timestamp);
          fullUsers.push({ ...u, history });
        }
        
        setUsers(fullUsers);
        setLoading(false);
      }, (err) => handleFirestoreError(err, OperationType.GET, 'users'));

      return () => {
        unsubPortfolio();
        unsubUsers();
      };
    });
  }, []);

  const copyToClipboard = () => {
    const totalUnits = users.reduce((acc, u) => acc + u.units, 0);
    const unitPrice = portfolioValue / totalUnits;
    const totalNetDeposits = users.reduce((acc, u) => acc + u.netDeposits, 0);
    const totalProfit = portfolioValue - totalNetDeposits;

    let text = `📈 *Portfolio Update*\nTotal Value: ${formatCurrency(portfolioValue)}\nTotal Profit: ${formatCurrency(totalProfit)}\n\n`;
    
    users.forEach(user => {
      const value = user.units * unitPrice;
      const profit = value - user.netDeposits;
      const ownership = user.units / totalUnits;
      text += `*${user.name}*\nValue: ${formatCurrency(value)}\nProfit: ${formatCurrency(profit)}\nOwnership: ${formatPercentage(ownership)}\n\n`;
    });

    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }).catch(err => console.error('Failed to copy', err));
  };

  const openModal = (type: ModalState['type'], userId: string | null = null) => {
    setModal({ isOpen: true, type, userId });
    setModalAmount(type === 'update_value' ? portfolioValue.toString() : '');
    setModalMetrics({
      monthlyReturn: '',
      yearlyReturn: '',
      monthlyAlpha: metrics.monthlyAlpha.toString(),
      yearlyAlpha: metrics.yearlyAlpha.toString(),
      beta: metrics.beta.toString(),
    });
    setModalNote('');
    setModalError('');
  };

  const closeModal = () => setModal({ isOpen: false, type: '', userId: null });

  const submitTransaction = async () => {
    if (modal.type === 'update_metrics') {
      try {
        const ptDoc = doc(db, 'portfolio', 'global');
        await updateDoc(ptDoc, {
          monthlyAlpha: parseFloat(modalMetrics.monthlyAlpha) || 0,
          yearlyAlpha: parseFloat(modalMetrics.yearlyAlpha) || 0,
          beta: parseFloat(modalMetrics.beta) || 0,
        });
        closeModal();
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, 'portfolio');
        setModalError('Failed to save data.');
      }
      return;
    }

    const amount = parseFloat(modalAmount);
    
    if (isNaN(amount) || amount <= 0) {
      setModalError('Please enter a valid amount greater than 0.');
      return;
    }

    try {
      if (modal.type === 'update_value') {
        const ptDoc = doc(db, 'portfolio', 'global');
        await updateDoc(ptDoc, { portfolioValue: amount });
        closeModal();
        return;
      }

      const user = users.find(u => u.id === modal.userId);
      if (!user) return;
      
      const totalUnits = users.reduce((acc, u) => acc + u.units, 0);
      const unitPrice = portfolioValue / totalUnits;
      const userCurrentValue = user.units * unitPrice;

      if (modal.type === 'withdraw' && amount > userCurrentValue) {
        setModalError(`Cannot withdraw more than current value (${formatCurrency(userCurrentValue)})`);
        return;
      }

      const unitChange = modal.type === 'deposit' ? (amount / unitPrice) : -(amount / unitPrice);
      const depositChange = modal.type === 'deposit' ? amount : -amount;

      const newHistoryId = Date.now().toString();
      const ptDoc = doc(db, 'portfolio', 'global');
      const userDoc = doc(db, 'users', user.id);
      const historyDoc = doc(db, `users/${user.id}/history`, newHistoryId);

      const batch = writeBatch(db);
      
      batch.update(ptDoc, { portfolioValue: portfolioValue + depositChange });
      batch.update(userDoc, {
        units: user.units + unitChange,
        netDeposits: user.netDeposits + depositChange
      });
      batch.set(historyDoc, {
        type: modal.type,
        amount: amount,
        note: modalNote.trim(),
        date: new Date().toLocaleDateString(),
        timestamp: Date.now()
      });

      await batch.commit();

      // Because we fetch history manually in the snapshot to avoid too many listeners, 
      // we can quickly trigger a re-render of local state or let the users snapshot trigger.
      // Easiest is to just update state locally for that user.
      const updatedHistory = [{
        id: newHistoryId,
        type: modal.type,
        amount: amount,
        note: modalNote.trim(),
        date: new Date().toLocaleDateString(),
        timestamp: Date.now()
      }, ...user.history];

      setUsers(users.map(u => u.id === user.id ? { ...u, units: u.units + unitChange, netDeposits: u.netDeposits + depositChange, history: updatedHistory } : u));
      setPortfolioValue(portfolioValue + depositChange);
      
      closeModal();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, modal.type === 'update_value' ? 'portfolio' : `users/${modal.userId}`);
      setModalError('Failed to save data.');
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-emerald-400 font-bold">Loading Portfolio...</div>;
  }

  const totalUnits = users.reduce((acc, user) => acc + user.units, 0);
  const unitPrice = portfolioValue / totalUnits;
  const totalNetDeposits = users.reduce((acc, user) => acc + user.netDeposits, 0);
  const totalBenchmarkCapital = users.reduce((acc, user) => acc + user.benchmarkCapital, 0);
  const totalProfit = portfolioValue - totalNetDeposits;
  const totalNetProfit = portfolioValue - totalBenchmarkCapital;

  const estimatedYearlyReturn = totalBenchmarkCapital > 0 ? (totalNetProfit / totalBenchmarkCapital) : 0;
  const estimatedMonthlyReturn = estimatedYearlyReturn / 12;

  const activeUserForModal = modal.userId ? users.find(u => u.id === modal.userId) : null;

  // -- Chart Data Calculation --
  const allTransactions = users.flatMap(u => u.history).sort((a, b) => a.timestamp - b.timestamp);
  const currentTotalNetDeposits = users.reduce((acc, user) => acc + user.netDeposits, 0);
  let runningTotal = currentTotalNetDeposits - allTransactions.reduce((acc, t) => acc + (t.type === 'deposit' ? t.amount : -t.amount), 0);

  const chartDataMap = new Map<string, number>();
  chartDataMap.set('Start', runningTotal);

  allTransactions.forEach(t => {
    runningTotal += (t.type === 'deposit' ? t.amount : -t.amount);
    const dateStr = new Date(t.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    chartDataMap.set(dateStr, runningTotal);
  });

  const chartData = Array.from(chartDataMap.entries()).map(([name, value]) => ({ name, value }));

  return (
    <div className="bg-slate-900 text-slate-100 min-h-screen p-4 md:p-8 font-sans">
      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* Header Section */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-xl">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Wallet className="text-emerald-400 w-6 h-6" /> Family Portfolio
            </h1>
            <p className="text-slate-400 text-sm mt-1">Track investments, profit, and ownership safely.</p>
          </div>
          <div className="flex items-center gap-3 w-full md:w-auto">
            <button onClick={copyToClipboard} className="flex-1 md:flex-none flex justify-center items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-medium transition-colors">
              {copied ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Share2 className="w-4 h-4" />}
              <span>{copied ? 'Summary Copied!' : 'Copy Summary'}</span>
            </button>
            <button onClick={onLogout} className="flex justify-center items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-medium transition-colors text-red-400">
              <LogOut className="w-4 h-4" />
              <span>Logout</span>
            </button>
          </div>
        </header>

        {isAdmin && <AdminPanel />}

        {/* Global Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <TrendingUp className="w-16 h-16" />
            </div>
            <p className="text-slate-400 text-sm font-medium">Total Portfolio Value</p>
            <p className="text-2xl xl:text-3xl font-bold text-white mt-2 truncate" title={formatCurrency(portfolioValue)}>{formatCurrency(portfolioValue)}</p>
            {isAdmin && (
              <button onClick={() => openModal('update_value')} className="mt-4 flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300 font-medium whitespace-nowrap">
                <RefreshCw className="w-4 h-4" /> Update Market Value
              </button>
            )}
          </div>

          <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg min-w-0">
            <p className="text-slate-400 text-sm font-medium truncate">Total Capital Invested</p>
            <p className="text-xl xl:text-2xl font-bold text-white mt-2 truncate" title={formatCurrency(totalBenchmarkCapital)}>{formatCurrency(totalBenchmarkCapital)}</p>
          </div>

          <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg min-w-0">
            <p className="text-slate-400 text-sm font-medium truncate">Total Profit Generated</p>
            <p className={`text-xl xl:text-2xl font-bold mt-2 truncate ${totalProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`} title={(totalProfit >= 0 ? '+' : '') + formatCurrency(totalProfit)}>
              {totalProfit >= 0 ? '+' : ''}{formatCurrency(totalProfit)}
            </p>
          </div>

          <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg min-w-0">
            <p className="text-slate-400 text-sm font-medium truncate">Total Net Profit</p>
            <p className={`text-xl xl:text-2xl font-bold mt-2 truncate ${totalNetProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`} title={(totalNetProfit >= 0 ? '+' : '') + formatCurrency(totalNetProfit)}>
              {totalNetProfit >= 0 ? '+' : ''}{formatCurrency(totalNetProfit)}
            </p>
          </div>
        </div>

          <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg mt-8">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
               <TrendingUp className="text-blue-400 w-5 h-5" /> Performance Metrics
            </h2>
            {isAdmin && (
              <button onClick={() => openModal('update_metrics')} className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 font-medium bg-slate-700/50 py-1.5 px-3 rounded-lg transition-colors">
                <RefreshCw className="w-4 h-4" /> Edit Metrics
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700">
              <p className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-1">Monthly Return</p>
              <p className={`text-xl font-bold ${estimatedMonthlyReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatPercentage(estimatedMonthlyReturn)}</p>
            </div>
            <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700">
              <p className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-1">Yearly Return</p>
              <p className={`text-xl font-bold ${estimatedYearlyReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatPercentage(estimatedYearlyReturn)}</p>
            </div>
            <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700">
              <p className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-1">Monthly Alpha</p>
              <p className={`text-xl font-bold ${metrics.monthlyAlpha >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatPercentage(metrics.monthlyAlpha / 100)}</p>
            </div>
            <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700">
              <p className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-1">Yearly Alpha</p>
              <p className={`text-xl font-bold ${metrics.yearlyAlpha >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatPercentage(metrics.yearlyAlpha / 100)}</p>
            </div>
            <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700">
              <p className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-1">Beta</p>
              <p className="text-xl font-bold text-white">{metrics.beta.toFixed(2)}</p>
            </div>
          </div>
        </div>

        {/* Growth Chart */}
        <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg mt-8">
          <h2 className="text-xl font-bold text-white flex items-center gap-2 mb-6">
             <TrendingUp className="text-emerald-400 w-5 h-5" /> Capital Growth Over Time
          </h2>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis 
                  stroke="#94a3b8" 
                  fontSize={12} 
                  tickLine={false} 
                  axisLine={false} 
                  tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`}
                />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', borderRadius: '8px', color: '#f1f5f9' }}
                  itemStyle={{ color: '#34d399', fontWeight: 'bold' }}
                  formatter={(value: number) => [formatCurrency(value), 'Capital']}
                />
                <Line type="monotone" dataKey="value" stroke="#34d399" strokeWidth={3} dot={{ fill: '#34d399', strokeWidth: 2, r: 4 }} activeDot={{ r: 6, strokeWidth: 0 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* User Cards Header */}
        <h2 className="text-xl font-bold text-white flex items-center gap-2 mt-8 mb-4">
          <Users className="text-blue-400 w-6 h-6" /> Individual Accounts
        </h2>
        
        {/* User Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {users.map(user => {
            const currentValue = user.units * unitPrice;
            const userProfit = currentValue - user.netDeposits;
            const netProfit = currentValue - user.benchmarkCapital;
            const ownershipPercentage = user.units / totalUnits;

            return (
              <div key={user.id} className="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-start mb-4">
                    <h3 className="text-xl font-bold text-white flex items-center gap-2">
                      {user.name}
                      <button onClick={() => openModal('history', user.id)} className="text-slate-400 hover:text-blue-400 transition-colors bg-slate-700/50 p-1.5 rounded-md" title="View History">
                        <History className="w-4 h-4" />
                      </button>
                    </h3>
                    <span className="bg-slate-700 text-slate-300 py-1 px-3 rounded-full text-xs font-semibold border border-slate-600">
                      {formatPercentage(ownershipPercentage)} Ownership
                    </span>
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between items-end border-b border-slate-700 pb-3">
                      <span className="text-slate-400 text-sm">Current Value</span>
                      <span className="text-xl font-bold text-white">{formatCurrency(currentValue)}</span>
                    </div>
                    <div className="flex justify-between items-end border-b border-slate-700 pb-3">
                      <span className="text-slate-400 text-sm">Benchmark Capital</span>
                      <span className="text-md font-medium text-slate-300">{formatCurrency(user.benchmarkCapital)}</span>
                    </div>
                    <div className="flex justify-between items-end border-b border-slate-700 pb-3">
                      <span className="text-slate-400 text-sm">Net Capital (Dep. - With.)</span>
                      <span className="text-md font-medium text-slate-500">{formatCurrency(user.netDeposits)}</span>
                    </div>
                    <div className="flex justify-between items-end border-b border-slate-700 pb-3">
                      <span className="text-slate-400 text-sm">Individual Profit</span>
                      <span className={`text-md font-bold ${userProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {userProfit >= 0 ? '+' : ''}{formatCurrency(userProfit)}
                      </span>
                    </div>
                    <div className="flex justify-between items-end pb-2">
                      <span className="text-slate-400 text-sm">Net Profit (from Benchmark)</span>
                      <span className={`text-md font-bold ${netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {netProfit >= 0 ? '+' : ''}{formatCurrency(netProfit)}
                      </span>
                    </div>
                  </div>
                </div>

                {isAdmin && (
                  <div className="grid grid-cols-2 gap-3 mt-6">
                    <button onClick={() => openModal('deposit', user.id)} className="flex items-center justify-center gap-2 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 py-2.5 rounded-xl text-sm font-medium transition-colors border border-emerald-500/20">
                      <PlusCircle className="w-4 h-4" /> Add Funds
                    </button>
                    <button onClick={() => openModal('withdraw', user.id)} className="flex items-center justify-center gap-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 py-2.5 rounded-xl text-sm font-medium transition-colors border border-red-500/20">
                      <MinusCircle className="w-4 h-4" /> Withdraw
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Modal Overlay */}
      {modal.isOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            {modal.type === 'history' && activeUserForModal ? (
              <>
                <h3 className="text-xl font-bold text-white mb-4">{activeUserForModal.name}'s Transaction History</h3>
                <div className="max-h-64 overflow-y-auto pr-2 space-y-3 mb-6 scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-transparent">
                  {activeUserForModal.history.length === 0 ? (
                    <p className="text-slate-400 text-sm text-center py-4 bg-slate-900 rounded-lg">No transactions recorded yet.</p>
                  ) : (
                    activeUserForModal.history.map(record => (
                      <div key={record.id} className="flex justify-between items-center bg-slate-900 p-3 rounded-lg border border-slate-700">
                        <div>
                          <span className={`text-xs font-bold uppercase ${record.type === 'deposit' ? 'text-emerald-400' : 'text-red-400'}`}>{record.type}</span>
                          <p className="text-slate-400 text-xs">{record.date}</p>
                          {record.note && <p className="text-slate-300 text-sm mt-1">{record.note}</p>}
                        </div>
                        <span className={`font-bold ${record.type === 'deposit' ? 'text-emerald-400' : 'text-red-400'}`}>
                          {record.type === 'deposit' ? '+' : '-'}{formatCurrency(record.amount)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
                <button onClick={closeModal} className="w-full py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-medium transition-colors">Close</button>
              </>
            ) : (
              <>
                <h3 className="text-xl font-bold text-white mb-4">
                  {modal.type === 'update_value' && 'Update Market Portfolio Value'}
                  {modal.type === 'update_metrics' && 'Update Performance Metrics'}
                  {modal.type === 'deposit' && `Add Funds to ${activeUserForModal?.name}'s Account`}
                  {modal.type === 'withdraw' && `Withdraw from ${activeUserForModal?.name}'s Account`}
                </h3>
                <p className="text-slate-400 text-sm mb-4">
                  {modal.type === 'update_value' && 'Enter the current total value of your stock portfolio.'}
                  {modal.type === 'update_metrics' && 'Enter the performance metrics to track alpha and beta (values in percentages, except Beta).'}
                  {modal.type === 'deposit' && 'Adding funds increases their ownership percentage.'}
                  {modal.type === 'withdraw' && 'Withdrawing decreases their ownership percentage.'}
                </p>
                
                {modal.type === 'update_metrics' ? (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-slate-400 text-xs font-medium mb-1">Monthly Alpha (%)</label>
                      <input type="number" step="0.01" value={modalMetrics.monthlyAlpha} onChange={e => setModalMetrics({...modalMetrics, monthlyAlpha: e.target.value})} className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl py-2 px-4 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all" />
                    </div>
                    <div>
                      <label className="block text-slate-400 text-xs font-medium mb-1">Yearly Alpha (%)</label>
                      <input type="number" step="0.01" value={modalMetrics.yearlyAlpha} onChange={e => setModalMetrics({...modalMetrics, yearlyAlpha: e.target.value})} className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl py-2 px-4 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all" />
                    </div>
                    <div>
                      <label className="block text-slate-400 text-xs font-medium mb-1">Beta</label>
                      <input type="number" step="0.01" value={modalMetrics.beta} onChange={e => setModalMetrics({...modalMetrics, beta: e.target.value})} className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl py-2 px-4 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all" />
                    </div>
                  </div>
                ) : (
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">LE</span>
                    <input 
                      type="number" 
                      value={modalAmount}
                      onChange={e => setModalAmount(e.target.value)}
                      placeholder="Enter amount" 
                      className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl py-3 pl-12 pr-4 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                    />
                  </div>
                )}

                {(modal.type === 'deposit' || modal.type === 'withdraw') && (
                  <div className="mt-4">
                    <input 
                      type="text" 
                      value={modalNote}
                      onChange={e => setModalNote(e.target.value)}
                      placeholder="Add a note (optional)" 
                      className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl py-3 px-4 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                    />
                  </div>
                )}

                {modalError && (
                  <div className="mt-3 flex items-center gap-2 text-red-400 text-sm bg-red-400/10 p-2 rounded-lg border border-red-400/20">
                    <AlertCircle className="w-4 h-4" /> {modalError}
                  </div>
                )}

                <div className="flex gap-3 mt-6">
                  <button onClick={closeModal} className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-medium transition-colors">Cancel</button>
                  <button onClick={submitTransaction} className={`flex-1 py-3 rounded-xl font-medium transition-colors text-white ${modal.type === 'withdraw' ? 'bg-red-500 hover:bg-red-600' : 'bg-emerald-500 hover:bg-emerald-600'}`}>Confirm</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
