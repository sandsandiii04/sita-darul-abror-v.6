
import React, { useState, useRef } from 'react';
import { User } from '../types';
import { Save, Camera, Lock, User as UserIcon, Phone, Mail, AlertCircle, Loader2 } from 'lucide-react';

interface ProfileSettingsProps {
  user: User;
  onUpdateUser: (updatedData: Partial<User>) => void;
}

const ProfileSettings: React.FC<ProfileSettingsProps> = ({ user, onUpdateUser }) => {
  const [formData, setFormData] = useState({
    name: user.name,
    username: user.username || '',
    password: user.password || '',
    phoneNumber: user.phoneNumber || '',
    email: user.email || '',
    avatar: user.avatar || ''
  });
  
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(false); // New loading state
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Limit 2MB karena sekarang diupload ke Drive (lebih lega dari localStorage)
      if (file.size > 2 * 1024 * 1024) { 
        setError("Ukuran foto terlalu besar. Maksimal 2MB.");
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData({ ...formData, avatar: reader.result as string });
        setError('');
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.username || !formData.password) {
      setError("Nama, Username, dan Password wajib diisi.");
      return;
    }

    setIsLoading(true); // Start loading

    // Jika avatar adalah Base64 (data:image...), ini akan dikirim ke backend,
    // diupload ke Drive, dan backend akan menyimpan URL-nya.
    // Frontend mengirim 'data:image...', Backend menyimpannya, lalu kita berharap 
    // sinkronisasi berikutnya akan mengambil URL-nya, atau kita update optimis.
    
    // Simulasi delay sedikit agar user tau sedang proses (karena upload drive butuh waktu)
    // Di aplikasi real, onUpdateUser harus async.
    
    setTimeout(() => {
        onUpdateUser(formData);
        setIsEditing(false);
        setIsLoading(false);
        setError('');
        alert("Profil berhasil diperbarui! Foto sedang diupload ke server (jika ada perubahan), mohon tunggu sinkronisasi.");
    }, 1500);
  };

  return (
    <div className="max-w-3xl mx-auto animate-fade-in">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        
        {/* Header Profile Info */}
        <div className="bg-emerald-50 p-6 flex flex-col md:flex-row items-center gap-6 border-b border-emerald-100">
          <div className="relative group">
            <div className="w-24 h-24 rounded-full bg-white border-4 border-white shadow-md overflow-hidden flex items-center justify-center">
              {formData.avatar ? (
                <img src={formData.avatar} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <UserIcon size={40} className="text-gray-400" />
              )}
            </div>
            {isEditing && !isLoading && (
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="absolute bottom-0 right-0 bg-primary text-white p-2 rounded-full shadow-lg hover:bg-emerald-800 transition-colors"
                title="Ganti Foto"
              >
                <Camera size={16} />
              </button>
            )}
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              accept="image/*" 
              onChange={handleFileChange}
            />
          </div>
          
          <div className="text-center md:text-left flex-1">
            <h2 className="text-2xl font-bold text-gray-800">{user.name}</h2>
            <p className="text-emerald-600 font-medium capitalize">{user.role === 'teacher' ? 'Guru Halaqah' : user.role === 'admin' ? 'Administrator' : 'Wali Santri'}</p>
            <p className="text-sm text-gray-500 mt-1">ID: {user.id}</p>
          </div>

          {!isEditing && (
             <button 
               onClick={() => setIsEditing(true)}
               className="bg-primary text-white px-6 py-2.5 rounded-lg font-medium hover:bg-emerald-800 transition-colors shadow-sm"
             >
               Edit Profil
             </button>
          )}
        </div>

        {/* Edit Form */}
        <div className="p-6 md:p-8">
           {error && (
             <div className="bg-red-50 text-red-600 p-4 rounded-lg mb-6 flex items-center gap-2 text-sm border border-red-100">
               <AlertCircle size={18} /> {error}
             </div>
           )}

           <form onSubmit={handleSubmit}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 
                 {/* Left Column */}
                 <div className="space-y-4">
                    <h3 className="font-bold text-gray-800 border-b pb-2 mb-4">Informasi Pribadi</h3>
                    
                    <div>
                       <label className="block text-sm font-semibold text-gray-600 mb-1">Nama Lengkap</label>
                       <div className="relative">
                          <UserIcon size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                          <input 
                            type="text" 
                            name="name"
                            value={formData.name} 
                            onChange={handleChange}
                            disabled={!isEditing || isLoading}
                            className="w-full pl-10 pr-4 py-2 border rounded-lg bg-gray-50 disabled:bg-gray-100 disabled:text-gray-500 focus:outline-primary"
                          />
                       </div>
                    </div>

                    <div>
                       <label className="block text-sm font-semibold text-gray-600 mb-1">Nomor WhatsApp</label>
                       <div className="relative">
                          <Phone size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                          <input 
                            type="text" 
                            name="phoneNumber"
                            value={formData.phoneNumber} 
                            onChange={handleChange}
                            disabled={!isEditing || isLoading}
                            placeholder="628..."
                            className="w-full pl-10 pr-4 py-2 border rounded-lg bg-gray-50 disabled:bg-gray-100 disabled:text-gray-500 focus:outline-primary"
                          />
                       </div>
                    </div>

                    <div>
                       <label className="block text-sm font-semibold text-gray-600 mb-1">Alamat Email</label>
                       <div className="relative">
                          <Mail size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                          <input 
                            type="email" 
                            name="email"
                            value={formData.email} 
                            onChange={handleChange}
                            disabled={!isEditing || isLoading}
                            placeholder="nama@email.com"
                            className="w-full pl-10 pr-4 py-2 border rounded-lg bg-gray-50 disabled:bg-gray-100 disabled:text-gray-500 focus:outline-primary"
                          />
                       </div>
                    </div>
                 </div>

                 {/* Right Column */}
                 <div className="space-y-4">
                    <h3 className="font-bold text-gray-800 border-b pb-2 mb-4">Keamanan Akun</h3>
                    
                    <div>
                       <label className="block text-sm font-semibold text-gray-600 mb-1">Username Login</label>
                       <div className="relative">
                          <UserIcon size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                          <input 
                            type="text" 
                            name="username"
                            value={formData.username} 
                            onChange={handleChange}
                            disabled={!isEditing || isLoading}
                            className="w-full pl-10 pr-4 py-2 border rounded-lg bg-gray-50 disabled:bg-gray-100 disabled:text-gray-500 focus:outline-primary"
                          />
                       </div>
                    </div>

                    <div>
                       <label className="block text-sm font-semibold text-gray-600 mb-1">Password</label>
                       <div className="relative">
                          <Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                          <input 
                            type="text" 
                            name="password"
                            value={formData.password} 
                            onChange={handleChange}
                            disabled={!isEditing || isLoading}
                            className="w-full pl-10 pr-4 py-2 border rounded-lg bg-gray-50 disabled:bg-gray-100 disabled:text-gray-500 focus:outline-primary"
                          />
                       </div>
                       {isEditing && <p className="text-xs text-orange-500 mt-1">Gunakan password yang aman dan mudah diingat.</p>}
                    </div>
                 </div>
              </div>

              {isEditing && (
                <div className="flex justify-end gap-3 mt-8 pt-6 border-t">
                  <button 
                    type="button"
                    onClick={() => {
                        setIsEditing(false);
                        setFormData({
                            name: user.name,
                            username: user.username || '',
                            password: user.password || '',
                            phoneNumber: user.phoneNumber || '',
                            email: user.email || '',
                            avatar: user.avatar || ''
                        });
                        setError('');
                    }}
                    disabled={isLoading}
                    className="px-6 py-2.5 rounded-lg font-medium text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50"
                  >
                    Batal
                  </button>
                  <button 
                    type="submit"
                    disabled={isLoading}
                    className="bg-emerald-600 text-white px-6 py-2.5 rounded-lg font-bold hover:bg-emerald-700 transition-colors shadow-md flex items-center gap-2 disabled:opacity-70 disabled:cursor-wait"
                  >
                    {isLoading ? (
                        <>
                            <Loader2 size={18} className="animate-spin" /> Mengupload...
                        </>
                    ) : (
                        <>
                            <Save size={18} /> Simpan Perubahan
                        </>
                    )}
                  </button>
                </div>
              )}
           </form>
        </div>
      </div>
    </div>
  );
};

export default ProfileSettings;
