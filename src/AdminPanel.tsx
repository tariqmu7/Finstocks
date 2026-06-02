import React, { useState, useEffect } from 'react';
import { db } from './firebase';
import { collection, query, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { ShieldAlert, CheckCircle2, XCircle, ShieldCheck } from 'lucide-react';
import { handleFirestoreError } from './utils';
import { OperationType } from './types';

interface AccessRequest {
  id: string;
  email: string;
  status: 'pending' | 'approved' | 'denied';
}

export default function AdminPanel() {
  const [requests, setRequests] = useState<AccessRequest[]>([]);

  useEffect(() => {
    const q = query(collection(db, 'userAccess'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data: AccessRequest[] = [];
      snapshot.forEach(doc => {
        data.push({ id: doc.id, ...doc.data() } as AccessRequest);
      });
      setRequests(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'userAccess');
    });

    return () => unsubscribe();
  }, []);

  const updateStatus = async (id: string, status: 'approved' | 'denied') => {
    try {
      await updateDoc(doc(db, 'userAccess', id), { status });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `userAccess/${id}`);
    }
  };

  if (requests.length === 0) return null;

  return (
    <div className="bg-slate-800 border border-slate-700 p-6 rounded-2xl shadow-lg mt-6">
      <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
        <ShieldCheck className="w-5 h-5 text-emerald-400" /> Admin Access Control
      </h2>
      <div className="space-y-3">
        {requests.map(req => (
          <div key={req.id} className="flex justify-between items-center bg-slate-900 border border-slate-700 p-4 rounded-xl">
            <div>
              <span className="font-medium text-slate-300">{req.email}</span>
              <span className={`ml-3 text-xs font-bold uppercase ${
                req.status === 'approved' ? 'text-emerald-400' :
                req.status === 'denied' ? 'text-red-400' :
                'text-amber-500'
              }`}>{req.status}</span>
            </div>
            
            <div className="flex gap-2">
              {req.status !== 'approved' && (
                <button
                  onClick={() => updateStatus(req.id, 'approved')}
                  className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-sm font-medium rounded-lg border border-emerald-500/20 transition-colors"
                  title="Approve"
                >
                  <CheckCircle2 className="w-4 h-4" /> Approve
                </button>
              )}
              {req.status !== 'denied' && (
                <button
                  onClick={() => updateStatus(req.id, 'denied')}
                  className="flex items-center gap-1 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm font-medium rounded-lg border border-red-500/20 transition-colors"
                  title="Deny"
                >
                  <XCircle className="w-4 h-4" /> Deny
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
