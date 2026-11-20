import React, { useState, useEffect } from 'react';
import { User } from '../../types';
import { api } from '../../api';
import { ShieldCheck, KeyRound, Power, RefreshCw, X, CheckCircle2, AlertCircle, Users, LogOut } from 'lucide-react';

interface UASSharedAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User;
}

export const UASSharedAccountModal: React.FC<UASSharedAccountModalProps> = ({ isOpen, onClose, user }) => {
  const [accountUsername, setAccountUsername] = useState('');
  const [accountName, setAccountName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [savingAccount, setSavingAccount] = useState(false);

  const [teachers, setTeachers] = useState<{ id: string; name: string; username?: string; hasPin?: boolean }[]>([]);
  const [loadingTeachers, setLoadingTeachers] = useState(false);
  const [pinInputs, setPinInputs] = useState<Record<string, string>>({});
  const [savingTeacherId, setSavingTeacherId] = useState<string | null>(null);

  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadTeachers = async () => {
    setLoadingTeachers(true);
    const res = await api.getUASActiveTeachers(user);
    setLoadingTeachers(false);
    if (res.success && res.teachers) {
      setTeachers(res.teachers);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setStatusMsg(null);
      setNewPassword('');
      setPinInputs({});
      loadTeachers();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSaveSharedAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountUsername.trim()) return;
    setSavingAccount(true);
    setStatusMsg(null);
    const res = await api.configureSharedUASAccount(
      {
        accountUsername: accountUsername.trim(),
        accountName: accountName.trim(),
        newPassword: newPassword.trim() || undefined,
        isActive
      },
      user
    );
    setSavingAccount(false);
    if (res.success) {
      setNewPassword('');
      setStatusMsg({
        type: 'success',
        text: isActive
          ? `Akun bersama '${res.username}' berhasil disimpan/diaktifkan.`
          : `Akun bersama '${res.username}' dinonaktifkan & seluruh sesi dicabut.`
      });
      await loadTeachers();
    } else {
      setStatusMsg({ type: 'error', text: res.message || 'Gagal menyimpan konfigurasi akun bersama.' });
    }
  };

  const handleRevokeSessions = async () => {
    setStatusMsg(null);
    const res = await api.revokeUASSharedSessions(accountUsername.trim() || undefined, user);
    if (res.success) {
      setStatusMsg({ type: 'success', text: 'Seluruh sesi akun bersama UAS yang aktif berhasil dicabut.' });
    } else {
      setStatusMsg({ type: 'error', text: res.message || 'Gagal mencabut sesi akun bersama.' });
    }
  };

  const handleSetPin = async (teacherId: string, teacherName: string) => {
    const pin = (pinInputs[teacherId] || '').trim();
    if (pin.length < 4) {
      setStatusMsg({ type: 'error', text: `PIN untuk ${teacherName} minimal 4 karakter.` });
      return;
    }
    setSavingTeacherId(teacherId);
    setStatusMsg(null);
    const res = await api.setUASExaminerPin(teacherId, pin, user);
    setSavingTeacherId(null);
    if (res.success) {
      setPinInputs(prev => ({ ...prev, [teacherId]: '' }));
      setStatusMsg({ type: 'success', text: `PIN pribadi untuk ${teacherName} berhasil disimpan (terenkripsi bcrypt).` });
      await loadTeachers();
    } else {
      setStatusMsg({ type: 'error', text: res.message || `Gagal menyimpan PIN untuk ${teacherName}.` });
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 bg-gradient-to-r from-slate-900 to-teal-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <ShieldCheck size={20} className="text-emerald-300" />
            <div>
              <h3 className="font-bold text-sm sm:text-base">Pengaturan Akun Bersama UAS &amp; PIN Penguji</h3>
              <p className="text-[11px] text-slate-300">Khusus Admin — PIN di-hash bcrypt di server dan tidak pernah ditampilkan kembali.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-white/10">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1 space-y-5">
          {statusMsg && (
            <div
              className={`p-3 rounded-2xl border text-xs flex items-center gap-2 ${
                statusMsg.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}
            >
              {statusMsg.type === 'success' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
              <span>{statusMsg.text}</span>
            </div>
          )}

          {/* Shared Account Settings */}
          <form onSubmit={handleSaveSharedAccount} className="p-4 rounded-2xl border border-slate-200 bg-slate-50/60 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="font-bold text-xs text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Power size={14} className="text-teal-600" />
                <span>Akun Bersama UAS (shared_uas_examiner)</span>
              </h4>
              <button
                type="button"
                onClick={handleRevokeSessions}
                className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-[11px] font-bold flex items-center gap-1"
              >
                <LogOut size={12} />
                <span>Cabut Semua Sesi Aktif</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">Username Akun Bersama (yang sudah ada / baru)</label>
                <input
                  type="text"
                  value={accountUsername}
                  onChange={e => setAccountUsername(e.target.value)}
                  placeholder="Contoh: UAS"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white"
                  required
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">Nama Tampilan</label>
                <input
                  type="text"
                  value={accountName}
                  onChange={e => setAccountName(e.target.value)}
                  placeholder="Contoh: Akun Ujian (kosongkan jika tetap)"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">Password Baru / Rotasi (min 6 karakter)</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Kosongkan jika tidak mengubah password"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white"
                />
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer pb-2">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={e => setIsActive(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span>Akun Bersama Aktif (nonaktifkan untuk blokir akses)</span>
                </label>
              </div>
            </div>

            <button
              type="submit"
              disabled={savingAccount}
              className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-xl shadow-sm disabled:opacity-50"
            >
              {savingAccount ? 'Menyimpan...' : 'Simpan Pengaturan Akun Bersama'}
            </button>
          </form>

          {/* 16 Teachers PIN Management */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-xs text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Users size={14} className="text-indigo-600" />
                <span>PIN Pribadi Penguji ({teachers.length} Guru Aktif)</span>
              </h4>
              <button
                type="button"
                onClick={loadTeachers}
                className="text-xs font-semibold text-teal-700 hover:underline flex items-center gap-1"
              >
                <RefreshCw size={12} className={loadingTeachers ? 'animate-spin' : ''} />
                <span>Muat Ulang</span>
              </button>
            </div>

            <div className="border border-slate-200 rounded-2xl divide-y divide-slate-100 overflow-hidden">
              {teachers.map(t => (
                <div key={t.id} className="p-3 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div>
                    <div className="font-bold text-xs text-slate-800">{t.name}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] text-slate-400">@{t.username}</span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          t.hasPin ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {t.hasPin ? 'PIN Terpasang' : 'Belum Ada PIN'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="password"
                      value={pinInputs[t.id] || ''}
                      onChange={e => setPinInputs(prev => ({ ...prev, [t.id]: e.target.value }))}
                      placeholder={t.hasPin ? 'Reset PIN baru...' : 'Buat PIN (min 4)...'}
                      className="w-36 sm:w-40 px-2.5 py-1.5 text-xs border border-slate-200 rounded-xl"
                    />
                    <button
                      type="button"
                      onClick={() => handleSetPin(t.id, t.name)}
                      disabled={savingTeacherId === t.id || !(pinInputs[t.id] || '').trim()}
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl flex items-center gap-1 disabled:opacity-40"
                    >
                      <KeyRound size={12} />
                      <span>{savingTeacherId === t.id ? '...' : t.hasPin ? 'Reset' : 'Set PIN'}</span>
                    </button>
                  </div>
                </div>
              ))}
              {teachers.length === 0 && !loadingTeachers && (
                <div className="p-6 text-center text-xs text-slate-400">Tidak ada guru aktif ditemukan.</div>
              )}
            </div>
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200 rounded-xl"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
};
