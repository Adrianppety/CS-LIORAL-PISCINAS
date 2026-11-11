import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  ?.trim()
  .replace(/\/rest\/v1\/?$/i, '')
  .replace(/\/$/, '')
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigError = !supabaseUrl || !supabaseAnonKey
  ? 'Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para conectar ao Supabase.'
  : null

export const supabase = supabaseConfigError
  ? null
  : createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
