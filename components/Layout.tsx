
import React, { useState } from 'react';
import { User, Role } from '../types';
import { LOGO_URL } from '../constants';
import { 
  BookOpen, 
  Users, 
  CalendarCheck, 
  Award, 
  LayoutDashboard, 
  LogOut, 
  Menu, 
  X,
  UserCheck,
  Database,
  FileText,
  Settings,
  HelpCircle,
  RotateCcw
} from 'lucide-react';

interface LayoutProps {
  user: User;
  onLogout: () => void;
  activeTab: string;
  onTabChange: (tab: string) => void;
  children: React.ReactNode;
  onOpenDbConfig?: () => void;
}

const Layout: React.FC<LayoutProps> = ({ user, onLogout, activeTab, onTabChange, children, onOpenDbConfig }) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const getMenuItems = (role: Role) => {
    const common = [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'ziyadah', label: 'Ziyadah (Sabaq)', icon: BookOpen },
      { id: 'murojaah', label: 'Muroja\'ah (Sabqi & Manzil)', icon: RotateCcw },
    ];

    const profileMenu = { id: 'profile', label: 'Pengaturan Akun', icon: Settings };

    if (role === 'parent') {
      return [
        ...common,
        { id: 'exam', label: 'Riwayat Ujian', icon: Award },
        { id: 'attendance_student', label: 'Absensi Anak', icon: CalendarCheck },
        { id: 'reports', label: 'Laporan Capaian', icon: FileText },
        profileMenu
      ];
    }

    if (role === 'teacher') {
      return [
        ...common,
        { id: 'attendance_student', label: 'Absensi Santri', icon: Users },
        { id: 'exam', label: 'Input Ujian', icon: Award },
        { id: 'reports', label: 'Laporan Capaian', icon: FileText },
        { id: 'attendance_self', label: 'Absensi Saya', icon: UserCheck },
        profileMenu
      ];
    }

    return [
      ...common,
      { id: 'master_data', label: 'Data Master', icon: Database },
      { id: 'attendance_student', label: 'Absensi Santri', icon: Users },
      { id: 'attendance_teacher', label: 'Absensi Guru', icon: UserCheck },
      { id: 'exam', label: 'Data Ujian', icon: Award },
      { id: 'reports', label: 'Laporan', icon: FileText },
      { id: 'tutorial', label: 'Panduan Sistem', icon: HelpCircle },
      profileMenu
    ];
  };

  const menuItems = getMenuItems(user.role);
  // Find the currently active menu item for header display
  const activeMenuItem = menuItems.find(i => i.id === activeTab) || menuItems[0];

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[#f8fafc] font-sans">
      {/* Mobile Header */}
      <div className="md:hidden bg-gradient-to-r from-emerald-800 to-teal-900 text-white p-4 flex justify-between items-center shadow-lg border-b border-emerald-950/20 print:hidden relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.1),transparent_50%)]" />
        <div className="flex items-center gap-3 relative z-10">
          <img 
            src={LOGO_URL} 
            alt="Logo" 
            className="w-9 h-9 object-contain bg-white rounded-xl p-1 shadow-sm" 
            onError={(e) => {
              (e.target as HTMLImageElement).src = 'https://cdn-icons-png.flaticon.com/512/3063/3063206.png';
            }}
          />
          <h1 className="font-extrabold text-base tracking-tight">Darul Abror IBS</h1>
        </div>
        <button 
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="relative z-10 bg-white/10 hover:bg-white/20 active:bg-white/30 p-2 rounded-xl transition-all border border-white/10"
        >
          {isSidebarOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-white shadow-xl transform transition-transform duration-300 ease-in-out border-r border-slate-100
        md:relative md:translate-x-0 print:hidden flex flex-col h-screen
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        {/* Sidebar Banner */}
        <div className="p-6 bg-gradient-to-br from-emerald-900 to-teal-950 text-white h-48 flex flex-col justify-center items-center text-center relative overflow-hidden shrink-0">
          <div className="absolute top-[-20%] right-[-20%] w-32 h-32 rounded-full bg-emerald-500/10 blur-xl pointer-events-none" />
          <div className="absolute bottom-[-20%] left-[-20%] w-32 h-32 rounded-full bg-teal-500/10 blur-xl pointer-events-none" />
          
          <div className="w-18 h-18 bg-white/95 backdrop-blur rounded-2xl p-1.5 mb-3 shadow-lg flex items-center justify-center overflow-hidden relative z-10 border border-white/20">
             <img 
                src={LOGO_URL} 
                alt="Darul Abror Logo" 
                className="w-full h-full object-contain" 
                onError={(e) => {
                  (e.target as HTMLImageElement).src = 'https://cdn-icons-png.flaticon.com/512/3063/3063206.png';
                }}
             />
          </div>
          <h2 className="text-base font-extrabold tracking-tight leading-tight relative z-10">Darul Abror IBS</h2>
          <p className="text-emerald-300 text-[10px] uppercase font-bold tracking-widest opacity-90 mt-1 relative z-10">Informasi Tahfidz</p>
        </div>
        
        {/* User Card */}
        <div className="p-4 border-b border-slate-100 bg-slate-50/40">
          <div className="flex items-center gap-3 bg-white p-2.5 rounded-2xl border border-slate-200/60 shadow-sm">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-100 to-teal-100 text-emerald-800 font-extrabold flex items-center justify-center shadow-inner overflow-hidden shrink-0">
              {user.avatar ? <img src={user.avatar} className="w-full h-full object-cover" alt="avatar" /> : user.name.charAt(0)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-slate-800 text-xs truncate leading-normal">{user.name}</p>
              <span className="inline-block text-[9px] px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-100 uppercase font-extrabold mt-0.5">
                {user.role}
              </span>
            </div>
          </div>
        </div>

        {/* Sidebar Nav */}
        <nav className="p-3 space-y-1 flex-1 overflow-y-auto">
          {menuItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  onTabChange(item.id);
                  setIsSidebarOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl transition-all duration-200 text-xs font-semibold border ${
                  isActive 
                    ? 'bg-emerald-50/70 border-emerald-100 text-emerald-800 shadow-[inset_0_1px_2px_rgba(0,0,0,0.01)] border-l-4 border-l-emerald-600 pl-2.5 font-bold' 
                    : 'text-slate-600 border-transparent hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <item.icon size={18} className={isActive ? 'text-emerald-700' : 'text-slate-400'} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Sidebar Footer */}
        <div className="w-full p-3 border-t border-slate-100 bg-white space-y-1 mt-auto shrink-0">
          {user.role === 'admin' && onOpenDbConfig && (
            <button 
              onClick={onOpenDbConfig}
              className="w-full flex items-center gap-3 px-3.5 py-2.5 text-slate-600 hover:bg-slate-50 hover:text-slate-900 rounded-xl transition-colors font-semibold text-xs border border-transparent"
            >
              <Settings size={18} className="text-slate-400" />
              <span>Database Supabase</span>
            </button>
          )}
          <button 
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-3.5 py-2.5 text-red-600 hover:bg-red-50 hover:text-red-700 rounded-xl transition-colors font-semibold text-xs border border-transparent"
          >
            <LogOut size={18} className="text-red-400" />
            <span>Keluar</span>
          </button>
        </div>
      </aside>

      {/* Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 md:hidden print:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Main Content */}
      <main className="flex-1 p-4 md:p-8 overflow-y-auto h-screen print:h-auto print:overflow-visible flex flex-col">
        <header className="mb-6 hidden md:block print:hidden shrink-0">
           <div className="flex items-center gap-3 mb-1">
             <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-100 to-teal-100 flex items-center justify-center text-emerald-800 shadow-sm border border-emerald-200/50">
               <activeMenuItem.icon size={16} />
             </div>
             <h1 className="text-xl font-extrabold text-slate-800 tracking-tight">
               {activeMenuItem.label}
             </h1>
           </div>
           <p className="text-slate-500 text-xs font-medium">Sistem Informasi Tahfidz Al Qur’an Darul Abror IBS V.1</p>
        </header>
        <div className="flex-1">
          {children}
        </div>
      </main>
    </div>
  );
};

export default Layout;
