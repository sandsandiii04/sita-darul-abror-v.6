import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://sxcgiznhnvyhozghloik.supabase.co';
const supabaseAnonKey = 'sb_publishable_gUTuV06xBXIXNYBgH3IyPw_u6DiKMS_';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function main() {
  try {
    const { data, error } = await supabase.from('users').select('*');
    if (error) {
      console.error("Direct Select Error:", error);
      return;
    }
    console.log("Success! Users in database (direct select):");
    if (data) {
      data.forEach(u => {
        console.log(`- ID: ${u.id}, Name: ${u.name}, Role: ${u.role}, Username: ${u.username}, Password: ${u.password}, Phone: ${u.phone_number || u.phoneNumber}`);
      });
    } else {
      console.log("No data returned");
    }
  } catch (e) {
    console.error("Exception:", e);
  }
}

main();
