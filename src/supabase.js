import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://wxvkuzliprujubrdfyld.supabase.co'
const supabaseKey = 'sb_publishable_sSJccJPT0nfFAaYYXLVHFg_t51a5tG8'

export const supabase = createClient(supabaseUrl, supabaseKey)