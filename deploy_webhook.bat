@echo off
echo ===================================================
echo Memulai Deployment Supabase Edge Function...
echo ===================================================
echo.
echo Langkah 1: Login ke Akun Supabase Anda
echo (Terminal akan meminta Access Token. Browser akan terbuka otomatis)
echo.
call npx supabase login
echo.
echo ===================================================
echo.
echo Langkah 2: Hubungkan ke Project Supabase Cloud
echo (Terminal akan meminta Password Database Supabase Anda)
echo.
call npx supabase link --project-ref sxcgiznhnvyhozghloik
echo.
echo ===================================================
echo.
echo Langkah 3: Deploy Fungsi Webhook ke Cloud
echo.
call npx supabase functions deploy whatsapp-webhook
echo.
echo ===================================================
echo.
echo Langkah 4: Set Environment Variables (Secrets)
echo.
call npx supabase secrets set SUPABASE_URL=https://sxcgiznhnvyhozghloik.supabase.co ADMIN_PHONE=6281383237720
echo.
echo ===================================================
echo.
echo Deployment Selesai!
echo Silakan salin URL Webhook Anda ke dashboard Fonnte:
echo https://sxcgiznhnvyhozghloik.functions.supabase.co/whatsapp-webhook
echo.
pause
