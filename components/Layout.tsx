
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
    <div className="min-h-screen flex flex-col md:flex-row bg-gray-50">
      {/* Mobile Header */}
      <div className="md:hidden bg-primary text-white p-4 flex justify-between items-center shadow-md print:hidden">
        <div className="flex items-center gap-3">
          <img 
            src={LOGO_URL} 
            alt="Logo" 
            className="w-10 h-10 object-contain bg-white rounded-full p-1" 
            onError={(e) => {
              (e.target as HTMLImageElement).src = 'https://cdn-icons-png.flaticon.com/512/3063/3063206.png';
            }}
          />
          <h1 className="font-bold text-lg">Darul Abror IBS</h1>
        </div>
        <button onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
          {isSidebarOpen ? <X /> : <Menu />}
        </button>
      </div>

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-white shadow-xl transform transition-transform duration-300 ease-in-out
        md:relative md:translate-x-0 print:hidden flex flex-col h-screen
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="p-6 bg-primary text-white h-48 flex flex-col justify-center items-center text-center">
          <div className="w-20 h-20 bg-white rounded-full p-2 mb-3 shadow-lg flex items-center justify-center overflow-hidden">
             <img 
                src={LOGO_URL} 
                alt="Darul Abror Logo" 
                className="w-full h-full object-contain" 
                onError={(e) => {
                  (e.target as HTMLImageElement).src = 'https://cdn-icons-png.flaticon.com/512/3063/3063206.png';
                }}
             />
          </div>
          <h2 className="text-lg font-bold leading-tight">Darul Abror IBS</h2>
          <p className="text-emerald-100 text-xs opacity-90 mt-1">Sistem Informasi Tahfidz</p>
        </div>
        
        <div className="p-4 border-b">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-primary font-bold overflow-hidden">
              {user.avatar ? <img src={user.avatar} className="w-full h-full object-cover" alt="avatar" /> : user.name.charAt(0)}
            </div>
            <div>
              <p className="font-medium text-gray-800 text-sm truncate w-36">{user.name}</p>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border uppercase font-bold">
                {user.role}
              </span>
            </div>
          </div>
        </div>

        <nav className="p-4 space-y-2 flex-1 overflow-y-auto">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                onTabChange(item.id);
                setIsSidebarOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                activeTab === item.id 
                  ? 'bg-emerald-50 text-primary font-bold' 
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <item.icon size={20} />
              <span className="text-sm">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="w-full p-4 border-t bg-white space-y-1 mt-auto">
          {user.role === 'admin' && onOpenDbConfig && (
            <button 
              onClick={onOpenDbConfig}
              className="w-full flex items-center gap-3 px-4 py-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors font-medium text-sm"
            >
              <Settings size={20} />
              Database Supabase
            </button>
          )}
          <button 
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors font-medium text-sm"
          >
            <LogOut size={20} />
            Keluar
          </button>
        </div>
      </aside>

      {/* Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden print:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Main Content */}
      <main className="flex-1 p-4 md:p-8 overflow-y-auto h-screen print:h-auto print:overflow-visible">
        <header className="mb-8 hidden md:block print:hidden">
           <div className="flex items-center gap-3 mb-1">
             <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
               {/* Fixed: using activeMenuItem.icon instead of undefined item.icon */}
               <activeMenuItem.icon size={18} />
             </div>
             <h1 className="text-2xl font-bold text-gray-800">
               {activeMenuItem.label}
             </h1>
           </div>
           <p className="text-gray-500 text-sm">Sistem Informasi Tahfidz Al Qur’an Darul Abror IBS V.1</p>
        </header>
        {children}
      </main>
    </div>
  );
};

export default Layout;
