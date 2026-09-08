import { useEffect, useState } from 'react';
import { Building2, ShieldCheck, Users } from 'lucide-react';

import { errorMessage, fetchUsers, updateUserRole } from '../api';
import { Spinner } from '../components/common';

// =============================================================================
// User management
// =============================================================================
export const UsersScreen = ({ currentUsername }) => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () =>
    fetchUsers()
      .then(setUsers)
      .catch((err) => setError(errorMessage(err, 'The user list could not be loaded.')))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const changeRole = async (username, role) => {
    setError('');
    try {
      await updateUserRole(username, role);
      load();
    } catch (err) {
      setError(errorMessage(err, 'That role could not be changed.'));
    }
  };

  return (
    <div className="p-8 animate-fade-in max-w-3xl mx-auto pb-16">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-2">
        <Users className="text-sky-500" /> People
      </h1>
      <p className="text-slate-600 dark:text-slate-400 mb-8">
        Administrators can ingest and remove documents. Readers can explore and ask questions.
        Roles are granted here, never chosen at sign-up.
      </p>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm">
          {error}
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8">
            <Spinner size={20} className="text-sky-500" />
          </div>
        ) : (
          users.map((user) => (
            <div
              key={user.username}
              className="flex items-center justify-between gap-4 p-4 border-b border-slate-100 dark:border-slate-700 last:border-b-0"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-full bg-sky-100 dark:bg-sky-900 text-sky-600 dark:text-sky-300 flex items-center justify-center font-bold uppercase text-sm shrink-0">
                  {(user.full_name || user.username).charAt(0)}
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-slate-900 dark:text-white text-sm truncate">
                    {user.full_name || user.username}
                    {user.full_name && (
                      <span className="text-xs text-slate-400 font-normal ml-1.5">
                        @{user.username}
                      </span>
                    )}
                    {user.username === currentUsername && (
                      <span className="text-xs text-slate-400 font-normal ml-2">you</span>
                    )}
                    {/*
                      The pending badge is the whole reason the sign-up form can
                      offer "Government official" safely: the request is recorded
                      and surfaced here for a human decision, never auto-granted.
                    */}
                    {user.requested_role === 'admin' && (
                      <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-semibold bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 px-1.5 py-0.5 rounded">
                        <ShieldCheck size={10} /> requested official access
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-slate-400 truncate flex items-center gap-1.5">
                    {user.organisation && (
                      <>
                        <Building2 size={11} className="shrink-0" />
                        <span className="truncate">
                          {user.designation ? `${user.designation}, ` : ''}
                          {user.organisation}
                        </span>
                        <span className="text-slate-300 dark:text-slate-600">·</span>
                      </>
                    )}
                    <span className="shrink-0">{user.documents} documents ingested</span>
                  </p>
                </div>
              </div>
              <select
                value={user.role}
                onChange={(e) => changeRole(user.username, e.target.value)}
                disabled={user.username === currentUsername}
                className="text-xs bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg py-2 px-3 focus:outline-none focus:border-sky-500 disabled:opacity-50 cursor-pointer shrink-0"
              >
                <option value="user">Reader</option>
                <option value="admin">Administrator</option>
              </select>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
