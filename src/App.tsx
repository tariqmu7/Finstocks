/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import Login from './Login';
import Dashboard from './Dashboard';
import { auth, db } from './firebase';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [accessStatus, setAccessStatus] = useState<'loading' | 'pending' | 'approved' | 'denied'>('loading');
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let unsubscribeAccess: (() => void) | null = null;
    
    const unsub = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      
      // Cleanup previous snapshot if it exists
      if (unsubscribeAccess) {
        unsubscribeAccess();
        unsubscribeAccess = null;
      }
      
      if (!currentUser) {
        setAuthChecking(false);
        setAccessStatus('loading');
        setIsAdmin(false);
        return;
      }

      if (currentUser.email === 'tarekmoh123@gmail.com') {
        setIsAdmin(true);
        setAccessStatus('approved');
        setAuthChecking(false);
        return;
      }

      setIsAdmin(false);

      // Other users need an access request
      const accessDocRef = doc(db, 'userAccess', currentUser.uid);
      
      unsubscribeAccess = onSnapshot(accessDocRef, async (snap) => {
        if (!snap.exists()) {
          // Create pending access request
          try {
            await setDoc(accessDocRef, {
              email: currentUser.email,
              status: 'pending'
            });
            setAccessStatus('pending');
          } catch (err) {
            console.error("Failed to create access request:", err);
            setAccessStatus('denied');
          }
        } else {
          setAccessStatus(snap.data().status as any);
        }
        setAuthChecking(false);
      }, (err) => {
        console.error("Failed to listen to access doc:", err);
        setAccessStatus('denied');
        setAuthChecking(false);
      });
    });

    return () => {
      unsub();
      if (unsubscribeAccess) unsubscribeAccess();
    };
  }, []);

  const handleLogout = async () => {
    await signOut(auth);
  };

  if (authChecking || (user && accessStatus === 'loading')) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center text-emerald-400 font-bold">
        Checking authentication...
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  if (accessStatus === 'pending') {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
        <div className="bg-slate-800 p-8 rounded-2xl border border-slate-700 shadow-xl max-w-md w-full text-center">
          <h2 className="text-2xl font-bold text-white mb-2">Access Pending</h2>
          <p className="text-slate-400 mb-6">Your access request has been sent to the administrator. Please wait for approval.</p>
          <button onClick={handleLogout} className="px-6 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors">Sign Out</button>
        </div>
      </div>
    );
  }

  if (accessStatus === 'denied') {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
        <div className="bg-slate-800 p-8 rounded-2xl border border-red-900/50 shadow-xl max-w-md w-full text-center">
          <h2 className="text-2xl font-bold text-white mb-2">Access Denied</h2>
          <p className="text-slate-400 mb-6">You do not have permission to access this portfolio.</p>
          <button onClick={handleLogout} className="px-6 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors">Sign Out</button>
        </div>
      </div>
    );
  }

  return <Dashboard isAdmin={isAdmin} onLogout={handleLogout} />;
}
