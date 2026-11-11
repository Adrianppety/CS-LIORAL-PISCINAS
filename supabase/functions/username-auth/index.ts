import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const usernamePattern = /^[a-z0-9][a-z0-9._-]{2,23}$/
const internalEmailDomain = 'users.invalid'

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return response({ ok: false, code: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error('Username authentication function is missing Supabase environment variables.')
    return response({ ok: false, code: 'server_error' }, 500)
  }

  let payload: { action?: unknown; username?: unknown; password?: unknown }
  try {
    payload = await request.json()
  } catch {
    return response({ ok: false, code: 'invalid_request' }, 400)
  }

  const action = payload.action
  const username = typeof payload.username === 'string' ? payload.username.trim().toLowerCase() : ''
  const password = typeof payload.password === 'string' ? payload.password : ''
  if (!usernamePattern.test(username)) return response({ ok: false, code: 'invalid_username' }, 400)
  if (password.length < 8 || password.length > 72) return response({ ok: false, code: 'invalid_password' }, 400)
  if (action !== 'signup' && action !== 'signin') return response({ ok: false, code: 'invalid_request' }, 400)

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const auth = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  try {
    let userId: string
    let email: string

    if (action === 'signup') {
      const { data: existing, error: lookupError } = await admin
        .from('username_accounts')
        .select('user_id')
        .eq('username', username)
        .maybeSingle()
      if (lookupError) throw lookupError
      if (existing) return response({ ok: false, code: 'username_taken' })

      email = `${username}@${internalEmailDomain}`
      const { data: created, error: createError } = await auth.auth.signUp({
        email,
        password,
        options: { data: { username } },
      })
      if (createError) {
        console.error('Supabase could not create a username account:', createError.message)
        return response({ ok: false, code: 'signup_failed' }, 500)
      }
      if (!created.user || !created.session) {
        if (created.user) {
          const { error: cleanupError } = await admin.auth.admin.deleteUser(created.user.id)
          if (cleanupError) console.error('Could not clean up an account created while email confirmation was enabled:', cleanupError.message)
        }
        return response({ ok: false, code: 'email_confirmation_enabled' }, 503)
      }
      userId = created.user.id

      const { error: insertError } = await admin
        .from('username_accounts')
        .insert({ username, user_id: userId })
      if (insertError) {
        const { error: cleanupError } = await admin.auth.admin.deleteUser(userId)
        if (cleanupError) console.error('Could not clean up an account after username registration failed:', cleanupError.message)
        if (insertError.code === '23505') return response({ ok: false, code: 'username_taken' })
        throw insertError
      }
      return response({
        ok: true,
        session: {
          access_token: created.session.access_token,
          refresh_token: created.session.refresh_token,
        },
      })
    } else {
      const { data: account, error: lookupError } = await admin
        .from('username_accounts')
        .select('user_id')
        .eq('username', username)
        .maybeSingle()
      if (lookupError) throw lookupError
      if (!account) return response({ ok: false, code: 'invalid_credentials' })

      const { data: userData, error: userError } = await admin.auth.admin.getUserById(account.user_id)
      if (userError || !userData.user.email) {
        if (userError) console.error('Could not load the username account:', userError.message)
        return response({ ok: false, code: 'account_unavailable' })
      }
      userId = userData.user.id
      email = userData.user.email
      if (userData.user.user_metadata.username !== username) {
        const { error: metadataError } = await admin.auth.admin.updateUserById(userId, {
          user_metadata: { ...userData.user.user_metadata, username },
        })
        if (metadataError) console.error('Could not synchronize the account username:', metadataError.message)
      }
    }

    const { data: signIn, error: signInError } = await auth.auth.signInWithPassword({ email, password })
    if (signInError || !signIn.session) {
      if (signInError) console.error('Supabase password authentication failed.')
      return response({
        ok: false,
        code: action === 'signin' ? 'invalid_credentials' : 'signup_failed',
      }, action === 'signin' ? 200 : 500)
    }

    return response({
      ok: true,
      session: {
        access_token: signIn.session.access_token,
        refresh_token: signIn.session.refresh_token,
      },
    })
  } catch (error) {
    console.error('Username authentication request failed:', error)
    return response({ ok: false, code: 'server_error' }, 500)
  }
})
