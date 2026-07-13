import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.21.0"

serve(async (req) => {
  // Hanya menerima metode POST
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    // Membaca payload dari Fonnte
    const payload = await req.json();
    const sender = payload.sender ? payload.sender.replace(/\D/g, '') : '';
    const message = payload.message ? payload.message.trim().toLowerCase() : '';
    
    // Inisialisasi Supabase Client menggunakan service role key (melewati RLS)
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    
    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(JSON.stringify({ error: 'Missing Supabase environment variables' }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // 1. Validasi nomor pengirim (harus dari Admin)
    const adminNumber = Deno.env.get('ADMIN_PHONE') || '6281383237720';
    if (sender !== adminNumber) {
      return new Response(JSON.stringify({ error: 'Unauthorized sender' }), {
        status: 403,
        headers: { "Content-Type": "application/json" }
      });
    }
    
    // 2. Deteksi pola pesan, contoh: "ok #id" atau "tidak #id"
    const match = message.match(/(ok|tidak)\s+#([a-z0-9_]+)/);
    if (!match) {
      return new Response(JSON.stringify({ error: 'Invalid message format' }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    
    const action = match[1]; // "ok" atau "tidak"
    const id = match[2]; // ID pengajuan absensi
    const newStatus = (action === 'ok') ? 'approved' : 'rejected';
    
    if (id.startsWith('req_')) {
      // Update tabel permohonan buka akses absen terlambat
      const { error } = await supabase
        .from('attendance_open_requests')
        .update({ status: newStatus })
        .eq('id', id);
        
      if (error) throw error;
      
      return new Response(JSON.stringify({ success: true, message: `Request ${id} updated to ${newStatus}` }), {
        headers: { "Content-Type": "application/json" }
      });
    } else {
      // Update tabel izin/sakit kehadiran guru
      const { error } = await supabase
        .from('attendance')
        .update({ approval_status: newStatus })
        .eq('id', id);
        
      if (error) throw error;
      
      return new Response(JSON.stringify({ success: true, message: `Attendance ${id} updated to ${newStatus}` }), {
        headers: { "Content-Type": "application/json" }
      });
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
})
