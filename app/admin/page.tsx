"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseClient } from "../utils/supabase/client";
import { getReasonCodes, type ReasonCodeRow } from "../lib/db";

interface UserRole {
  user_id: string;
  role: string;
}

const EMPTY_RC = { code: "", label: "", responsible: "", notes: "", deprecated: false };

export default function AdminPage() {
  const router = useRouter();
  
  // Auth States
  const [isAuthenticatedAsAdmin, setIsAuthenticatedAsAdmin] = useState(false);
  const [adminUsername, setAdminUsername] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Dashboard States
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [team, setTeam] = useState("Team VS");
  const [users, setUsers] = useState<UserRole[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("create");

  // Reason Codes tab
  const [reasonCodes, setReasonCodes] = useState<ReasonCodeRow[]>([]);
  const [rcDraft, setRcDraft] = useState<{ code: string; label: string; responsible: string; notes: string; deprecated: boolean }>(EMPTY_RC);
  const [rcBusy, setRcBusy] = useState(false);

  // Initial Auth Check
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const supabase = createSupabaseClient();
        const { data: { session } } = await supabase.auth.getSession();
        
        if (session) {
          const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001/api";
          const res = await fetch(`${API_URL}/auth/me`, {
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
          });
          
          if (res.ok) {
            const data = await res.json();
            if (data.role === "Planner" || data.role === "Admin") {
              setIsAuthenticatedAsAdmin(true);
            }
          }
        }
      } catch (err) {
        console.error("Auth check failed", err);
      } finally {
        setAuthLoading(false);
      }
    };
    
    checkAuth();
  }, []);

  const fetchUsers = async () => {
    try {
      const supabase = createSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      
      const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001/api";
      const res = await fetch(`${API_URL}/admin/users`, {
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
        },
      });
      
      if (res.ok) {
        const data = await res.json();
        setUsers(data || []);
      }
    } catch (err) {
      console.error("Failed to fetch users", err);
    }
  };

  const fetchReasonCodes = async () => {
    try {
      setReasonCodes(await getReasonCodes());
    } catch (err) {
      console.error("Failed to fetch reason codes", err);
    }
  };

  const authedFetch = async (path: string, init: RequestInit) => {
    const supabase = createSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001/api";
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token}`,
        ...(init.headers || {}),
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Request failed (${res.status})`);
    }
    return res.json().catch(() => ({}));
  };

  const saveReasonCode = async (row: typeof rcDraft) => {
    if (!row.code.trim()) return;
    setRcBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await authedFetch("/reason-codes", { method: "POST", body: JSON.stringify(row) });
      await fetchReasonCodes();
      setRcDraft(EMPTY_RC);
      setSuccess(`Reason ${row.code} saved.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRcBusy(false);
    }
  };

  const removeReasonCode = async (code: string) => {
    setRcBusy(true);
    setError(null);
    try {
      await authedFetch(`/reason-codes/${encodeURIComponent(code)}`, { method: "DELETE" });
      await fetchReasonCodes();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRcBusy(false);
    }
  };

  useEffect(() => {
    if (isAuthenticatedAsAdmin) {
      const initFetch = async () => {
        await fetchUsers();
        await fetchReasonCodes();
      };
      initFetch();
    }
  }, [isAuthenticatedAsAdmin]);

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);

    try {
      const supabase = createSupabaseClient();
      const cleanAdminUsername = adminUsername.trim().toLowerCase().replace(/\s+/g, '');
      
      let sessionData = null;

      // Try legacy domain first
      const { data: legacyData, error: legacyError } = await supabase.auth.signInWithPassword({
        email: `${cleanAdminUsername}@personal.local`,
        password: adminPassword,
      });

      if (legacyError) {
        // Fallback to new domain
        const { data: newData, error: newError } = await supabase.auth.signInWithPassword({
          email: `${cleanAdminUsername}@brandix.com`,
          password: adminPassword,
        });
        if (newError) throw newError;
        sessionData = newData;
      } else {
        sessionData = legacyData;
      }

      if (sessionData?.session) {
        const { session } = sessionData;
        const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001/api";
        const res = await fetch(`${API_URL}/auth/me`, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });
        
        if (res.ok) {
          const data = await res.json();
          if (data.role === "Planner" || data.role === "Admin") {
            setIsAuthenticatedAsAdmin(true);
          } else {
            setAuthError("Access Denied: You do not have administrator privileges.");
            await supabase.auth.signOut();
          }
        } else {
          setAuthError("Access Denied: Could not verify role.");
          await supabase.auth.signOut();
        }
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setAuthError(errorMsg);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const supabase = createSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      
      const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001/api";
      const res = await fetch(`${API_URL}/admin/users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ username, password, team }),
      });

      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || "Failed to create user");
      }
      
      setSuccess(`User ${username} successfully created and assigned to ${team}!`);
      setUsername("");
      setPassword("");
      setTeam("Team VS");
      fetchUsers();
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    const supabase = createSupabaseClient();
    await supabase.auth.signOut();
    router.push("/login");
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  // --- LOGIN VIEW ---
  if (!isAuthenticatedAsAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-zinc-950 p-4">
        <div className="max-w-md w-full p-8 bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-gray-100 dark:border-zinc-800">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-blue-500/10 text-blue-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Admin Gateway
            </h1>
            <p className="text-gray-500 dark:text-zinc-400 mt-2 text-sm">
              Please authenticate to access the control panel.
            </p>
          </div>

          <form onSubmit={handleAdminLogin} className="space-y-5">
            {authError && (
              <div className="p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl text-red-600 dark:text-red-400 text-sm flex items-center gap-2">
                <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                {authError}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-1.5">
                Admin Username
              </label>
              <input
                type="text"
                value={adminUsername}
                onChange={(e) => setAdminUsername(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 dark:border-zinc-700 rounded-xl focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 dark:bg-zinc-800 dark:text-white transition-all outline-none"
                required
                placeholder="planner_admin"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 dark:border-zinc-700 rounded-xl focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 dark:bg-zinc-800 dark:text-white transition-all outline-none"
                required
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={authLoading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-4 rounded-xl transition-colors focus:ring-4 focus:ring-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed mt-2 shadow-sm"
            >
              {authLoading ? "Authenticating..." : "Login to Admin"}
            </button>
            
            <button
              type="button"
              onClick={() => router.push("/")}
              className="w-full bg-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 font-medium py-2.5 px-4 rounded-xl transition-colors mt-2"
            >
              Return to Planner
            </button>
          </form>
        </div>
      </div>
    );
  }

  // --- DASHBOARD VIEW ---
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col md:flex-row">
      
      {/* Sidebar Navigation */}
      <div className="w-full md:w-64 bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 flex flex-col">
        <div className="p-6 border-b border-zinc-200 dark:border-zinc-800">
          <h1 className="text-xl font-bold text-zinc-900 dark:text-white flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Admin Center
          </h1>
        </div>
        
        <nav className="flex-1 p-4 space-y-2">
          <button
            onClick={() => setActiveTab("create")}
            className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl font-medium transition-colors ${
              activeTab === "create" 
                ? "bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400" 
                : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50"
            }`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
            </svg>
            Create Users
          </button>
          
          <button
            onClick={() => setActiveTab("list")}
            className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl font-medium transition-colors ${
              activeTab === "list" 
                ? "bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400" 
                : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50"
            }`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            User List
          </button>

          <button
            onClick={() => setActiveTab("codes")}
            className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl font-medium transition-colors ${
              activeTab === "codes"
                ? "bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400"
                : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50"
            }`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
            </svg>
            Reason Codes
          </button>
        </nav>
        
        <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 space-y-2">
          <button
            onClick={() => router.push("/")}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Planner
          </button>
          
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sign Out
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 p-8 overflow-y-auto">
        <div className="max-w-3xl mx-auto">
          
          {activeTab === "create" && (
            <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-8">
              <h2 className="text-2xl font-bold text-zinc-900 dark:text-white mb-2">Create New User</h2>
              <p className="text-zinc-500 dark:text-zinc-400 mb-8">Provision a new account and assign it to a team or administrative role.</p>
              
              <form onSubmit={handleCreateUser} className="space-y-6 max-w-xl">
                {error && (
                  <div className="p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl text-red-600 dark:text-red-400 text-sm">
                    {error}
                  </div>
                )}
                {success && (
                  <div className="p-4 bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 rounded-xl text-green-700 dark:text-green-400 text-sm">
                    {success}
                  </div>
                )}

                <div>
                  <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
                    Username
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full px-4 py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-xl focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 dark:bg-zinc-800 dark:text-white transition-all outline-none"
                    required
                    placeholder="e.g. planner_john"
                  />
                  <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-2">
                    Internal format: <code className="bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">username@brandix.com</code>
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
                    Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-xl focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 dark:bg-zinc-800 dark:text-white transition-all outline-none"
                    required
                    placeholder="••••••••"
                    minLength={6}
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
                    Assign Team / Role
                  </label>
                  <select
                    value={team}
                    onChange={(e) => setTeam(e.target.value)}
                    className="w-full px-4 py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-xl focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 dark:bg-zinc-800 dark:text-white transition-all outline-none appearance-none"
                  >
                    <option value="Team VS">Team VS</option>
                    <option value="Team CK">Team CK</option>
                    <option value="Team Pink">Team Pink</option>
                    <option value="Planner">Planner (Admin)</option>
                    <option value="Read-Only">Read-Only</option>
                  </select>
                </div>

                <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800">
                  <button
                    type="submit"
                    disabled={loading}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-6 rounded-xl transition-colors focus:ring-4 focus:ring-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                  >
                    {loading ? "Creating User..." : "Create User"}
                  </button>
                </div>
              </form>
            </div>
          )}

          {activeTab === "list" && (
            <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-8">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h2 className="text-2xl font-bold text-zinc-900 dark:text-white mb-2">User Directory</h2>
                  <p className="text-zinc-500 dark:text-zinc-400">View and manage assigned roles for all registered users.</p>
                </div>
                <button onClick={fetchUsers} className="p-2 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              </div>
              
              <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-zinc-50 dark:bg-zinc-900/50 border-b border-zinc-200 dark:border-zinc-800">
                      <th className="px-6 py-4 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">User ID Reference</th>
                      <th className="px-6 py-4 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider text-right">Assigned Role</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {users.length === 0 ? (
                      <tr>
                        <td colSpan={2} className="px-6 py-8 text-center text-zinc-500 dark:text-zinc-400">
                          No users found in directory.
                        </td>
                      </tr>
                    ) : (
                      users.map((u, i) => (
                        <tr key={i} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/20 transition-colors">
                          <td className="px-6 py-4">
                            <span className="font-mono text-sm text-zinc-700 dark:text-zinc-300" title={u.user_id}>
                              {u.user_id.split("-")[0]}...
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-200/50 dark:border-blue-500/20">
                              {u.role}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              
              <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-6 flex items-start gap-2">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                For security and privacy reasons, full email addresses are not exposed via the standard API without dedicated service role keys.
              </p>
            </div>
          )}

          {activeTab === "codes" && (
            <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-8">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-zinc-900 dark:text-white mb-2">Failure Reason Codes</h2>
                  <p className="text-zinc-500 dark:text-zinc-400 text-sm">
                    The list plants pick from when marking an event Fail. Feeds the app and the plant Google Sheet.
                    Re-running <code className="bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">npm run seed:codes</code> overwrites this with the bundled defaults.
                  </p>
                </div>
                <button onClick={fetchReasonCodes} className="p-2 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              </div>

              {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl text-red-600 dark:text-red-400 text-sm">{error}</div>}
              {success && <div className="mb-4 p-3 bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 rounded-xl text-green-700 dark:text-green-400 text-sm">{success}</div>}

              {/* Add / edit form */}
              <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end p-4 mb-6 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800">
                <label className="text-xs font-semibold text-zinc-500 md:col-span-1">
                  Code
                  <input value={rcDraft.code} onChange={(e) => setRcDraft({ ...rcDraft, code: e.target.value })}
                    className="mt-1 w-full px-2.5 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg dark:bg-zinc-800 dark:text-white text-sm outline-none" placeholder="61" />
                </label>
                <label className="text-xs font-semibold text-zinc-500 md:col-span-2">
                  Label
                  <input value={rcDraft.label} onChange={(e) => setRcDraft({ ...rcDraft, label: e.target.value })}
                    className="mt-1 w-full px-2.5 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg dark:bg-zinc-800 dark:text-white text-sm outline-none" placeholder="61: New reason" />
                </label>
                <label className="text-xs font-semibold text-zinc-500 md:col-span-2">
                  Responsible
                  <input value={rcDraft.responsible} onChange={(e) => setRcDraft({ ...rcDraft, responsible: e.target.value })}
                    className="mt-1 w-full px-2.5 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg dark:bg-zinc-800 dark:text-white text-sm outline-none" placeholder="Embellishment plant" />
                </label>
                <label className="flex items-center gap-2 text-xs font-semibold text-zinc-500 md:col-span-1">
                  <input type="checkbox" checked={rcDraft.deprecated} onChange={(e) => setRcDraft({ ...rcDraft, deprecated: e.target.checked })} />
                  Deprecated
                </label>
                <label className="text-xs font-semibold text-zinc-500 md:col-span-5">
                  Notes
                  <input value={rcDraft.notes} onChange={(e) => setRcDraft({ ...rcDraft, notes: e.target.value })}
                    className="mt-1 w-full px-2.5 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg dark:bg-zinc-800 dark:text-white text-sm outline-none" />
                </label>
                <div className="md:col-span-1 flex gap-2">
                  <button disabled={rcBusy || !rcDraft.code.trim()} onClick={() => saveReasonCode(rcDraft)}
                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium py-2 px-3 rounded-lg">Save</button>
                  {rcDraft.code && <button onClick={() => setRcDraft(EMPTY_RC)} className="text-sm text-zinc-500 hover:text-zinc-700 px-2">Clear</button>}
                </div>
              </div>

              <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-zinc-50 dark:bg-zinc-900/50 border-b border-zinc-200 dark:border-zinc-800 text-xs uppercase tracking-wider text-zinc-500">
                      <th className="px-4 py-3">Code</th><th className="px-4 py-3">Label</th>
                      <th className="px-4 py-3">Responsible</th><th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {reasonCodes.length === 0 ? (
                      <tr><td colSpan={4} className="px-4 py-8 text-center text-zinc-500">No reason codes — run <code>npm run seed:codes</code>.</td></tr>
                    ) : reasonCodes.map((r) => (
                      <tr key={r.code} className={`hover:bg-zinc-50/50 dark:hover:bg-zinc-800/20 ${r.deprecated ? "opacity-50" : ""}`}>
                        <td className="px-4 py-2.5 font-mono">{r.code}</td>
                        <td className="px-4 py-2.5">{r.label}{r.deprecated && <span className="ml-2 text-[10px] uppercase text-zinc-400">deprecated</span>}</td>
                        <td className="px-4 py-2.5 text-zinc-500">{r.responsible}</td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          <button onClick={() => setRcDraft({ code: r.code, label: r.label, responsible: r.responsible || "", notes: r.notes || "", deprecated: r.deprecated })}
                            className="text-blue-600 dark:text-blue-400 hover:underline text-xs mr-3">Edit</button>
                          <button onClick={() => removeReasonCode(r.code)} disabled={rcBusy}
                            className="text-rose-600 dark:text-rose-400 hover:underline text-xs disabled:opacity-50">Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      </div>

    </div>
  );
}
