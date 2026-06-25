@echo off
echo ============================================================
echo [SITA] Menginstal library Supabase SDK...
echo ============================================================
npm install @supabase/supabase-js
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Gagal menginstal. Pastikan Node.js dan NPM sudah terpasang di komputer Anda.
) else (
    echo.
    echo [SUKSES] @supabase/supabase-js berhasil diinstal!
)
echo.
pause
