import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type InputHTMLAttributes, type ReactNode } from 'react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { deleteClient as deleteCloudClient, deletePayment as deleteCloudPayment, deleteService as deleteCloudService, exportCloudData, importCloudData, loadCloudData, saveClient as saveCloudClient, savePayment as saveCloudPayment, saveService as saveCloudService, type CloudData, type DataBackup } from './cloudData'
import { type Client, type Service, type ServiceMaterial, type ServicePayment } from './db'
import { supabase, supabaseConfigError } from './supabaseClient'

type Page = 'Visão geral' | 'Clientes' | 'Serviços' | 'Pagamentos' | 'Relatórios'
type ClientDraft = Omit<Client, 'id' | 'createdAt'>
type ServiceDraft = Omit<Service, 'id'>

const pages: { name: Page; icon: string }[] = [
  { name: 'Visão geral', icon: '⌂' },
  { name: 'Clientes', icon: '♧' },
  { name: 'Serviços', icon: '◇' },
  { name: 'Pagamentos', icon: '↕' },
  { name: 'Relatórios', icon: '▤' },
]
const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const parseDecimal = (value: string) => {
  const normalized = value.trim().replace(/\s/g, '')
  if (!normalized) return Number.NaN
  return Number(normalized.includes(',') ? normalized.replace(/\./g, '').replace(',', '.') : normalized)
}
const today = () => {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const formatDate = (date: string) => new Date(`${date.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR')
const toIsoDate = (value: string) => {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value)
  if (!match) return ''
  const [, day, month, year] = match
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  if (parsed.getUTCDate() !== Number(day) || parsed.getUTCMonth() + 1 !== Number(month) || parsed.getUTCFullYear() !== Number(year)) return ''
  return `${year}-${month}-${day}`
}
const toDisplayDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.slice(0, 10))
  return match ? `${match[3]}/${match[2]}/${match[1]}` : ''
}
const profit = (service: Service) => service.chargedAmount - (service.thirdPartyCost ?? 0) - (service.materialsCost ?? 0)

function isDataBackup(value: unknown): value is DataBackup {
  if (!value || typeof value !== 'object') return false
  const backup = value as Record<string, unknown>
  return backup.format === 'cs-litoral-backup'
    && backup.version === 1
    && Array.isArray(backup.clients)
    && Array.isArray(backup.services)
    && Array.isArray(backup.servicePayments)
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/35 p-0 sm:items-center sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="max-h-[92dvh] w-full overflow-y-auto rounded-t-[28px] bg-white p-6 shadow-2xl sm:max-w-xl sm:rounded-[24px]">
      <div className="mb-6 flex items-center justify-between"><h2 className="font-serif text-2xl text-stone-800">{title}</h2><button onClick={onClose} aria-label="Fechar" className="button-icon grid h-9 w-9 place-items-center rounded-full text-xl">×</button></div>
      {children}
    </section>
  </div>
}

function Field({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return <label className="block text-sm font-medium text-stone-600">{label}<input {...props} className={`mt-2 w-full rounded-xl border border-stone-200 bg-white px-3.5 py-3 text-base outline-none transition focus:border-[#b48b50] focus:ring-2 focus:ring-[#b48b50]/15 ${props.className ?? ''}`} /></label>
}

function DateField({ label, name, initialValue = '', onChange, required = false }: { label: string; name: string; initialValue?: string; onChange?: (isoDate: string) => void; required?: boolean }) {
  const [value, setValue] = useState(() => toDisplayDate(initialValue))
  function update(event: ChangeEvent<HTMLInputElement>) {
    const digits = event.target.value.replace(/\D/g, '').slice(0, 8)
    const formatted = digits.length > 4 ? `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}` : digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits
    const isoDate = toIsoDate(formatted)
    setValue(formatted)
    event.currentTarget.setCustomValidity(formatted.length === 10 && !isoDate ? 'Informe uma data válida.' : '')
    onChange?.(isoDate)
  }
  return <label className="block text-sm font-medium text-stone-600">{label}<input name={`${name}Display`} type="text" inputMode="numeric" placeholder="DD/MM/AAAA" autoComplete="off" maxLength={10} pattern="[0-9]{2}/[0-9]{2}/[0-9]{4}" title="Use o formato DD/MM/AAAA" value={value} onChange={update} required={required} className="mt-2 w-full rounded-xl border border-stone-200 bg-white px-3.5 py-3 text-base outline-none transition focus:border-[#b48b50] focus:ring-2 focus:ring-[#b48b50]/15" /><input type="hidden" name={name} value={toIsoDate(value)} /></label>
}

function PaymentLedger({ serviceId, userId, party, title, total, payments, notify, refreshData }: { serviceId: string; userId: string; party: ServicePayment['party']; title: string; total: number; payments: ServicePayment[]; notify: (message: string) => void; refreshData: () => Promise<void> }) {
  const [editing, setEditing] = useState<ServicePayment>()
  const [formVersion, setFormVersion] = useState(0)
  const entries = payments.filter((payment) => payment.party === party).sort((a, b) => a.date.localeCompare(b.date))
  const paid = entries.reduce((sum, payment) => sum + payment.amount, 0)
  const remaining = Math.max(0, total - paid)

  async function savePayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const amount = parseDecimal(String(form.get('amount') ?? ''))
    const date = String(form.get('date') ?? '')
    const note = String(form.get('note') ?? '').trim()
    const allowed = remaining + (editing?.amount ?? 0)
    if (!Number.isFinite(amount) || amount <= 0 || !date || amount > allowed) {
      notify(amount > allowed ? 'O valor da parcela excede o saldo pendente.' : 'Informe o valor e a data da parcela.')
      return
    }
    const payment: ServicePayment = { serviceId, party, amount, date, note }
    try {
      await saveCloudPayment(userId, payment, editing?.id)
      await refreshData()
      setEditing(undefined)
      setFormVersion((version) => version + 1)
      notify(editing ? 'Parcela atualizada.' : 'Parcela registrada.')
    } catch (error) {
      console.error(error)
      notify('Não foi possível salvar a parcela.')
    }
  }

  async function deletePayment(payment: ServicePayment) {
    if (payment.id === undefined || !window.confirm('Excluir esta parcela?')) return
    try {
      await deleteCloudPayment(userId, payment.id)
      await refreshData()
      if (editing?.id === payment.id) setEditing(undefined)
      notify('Parcela excluída.')
    } catch (error) {
      console.error(error)
      notify('Não foi possível excluir a parcela.')
    }
  }

  return <section className="rounded-xl border border-stone-200/70 bg-white p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><h3 className="font-serif text-lg">{title}</h3><p className="mt-1 text-xs text-stone-500">{entries.length} {entries.length === 1 ? 'parcela' : 'parcelas'}</p></div>
      <div className="text-right"><p className="text-sm font-semibold">Pago {money(paid)} de {money(total)}</p><p className="text-xs text-stone-500">Em aberto: {money(remaining)}</p></div>
    </div>
    {total > 0 && <form key={`${party}-${editing?.id ?? formVersion}`} onSubmit={savePayment} className="mt-4 grid gap-3 border-t border-stone-100 pt-4 sm:grid-cols-2">
      <Field label="Valor da parcela (R$)" name="amount" type="text" inputMode="decimal" placeholder="0,00" defaultValue={editing ? String(editing.amount).replace('.', ',') : ''} required />
      <DateField key={`${party}-${editing?.id ?? 'new'}`} label="Data do pagamento" name="date" initialValue={editing?.date ?? today()} required />
      <Field label="Observação" name="note" type="text" placeholder="Ex.: parcela 1 de 3" defaultValue={editing?.note ?? ''} />
      <div className="flex items-end gap-2"><button className="button-primary flex-1 rounded-xl px-4 py-3 text-sm font-semibold">{editing ? 'Salvar parcela' : 'Adicionar parcela'}</button>{editing && <button type="button" onClick={() => setEditing(undefined)} className="button-secondary rounded-xl px-3 py-3 text-sm font-semibold">Cancelar</button>}</div>
    </form>}
    {entries.length > 0 && <div className="mt-3 divide-y divide-stone-100">{entries.map((payment) => <div key={payment.id} className="flex items-center gap-3 py-3 last:pb-0">
      <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{money(payment.amount)}</p><p className="truncate text-xs text-stone-500">{formatDate(payment.date)}{payment.note ? ` · ${payment.note}` : ''}</p></div>
      <button type="button" onClick={() => setEditing(payment)} className="button-icon grid h-8 w-8 place-items-center rounded-lg" aria-label="Editar parcela">✎</button>
      <button type="button" onClick={() => void deletePayment(payment)} className="button-icon grid h-8 w-8 place-items-center rounded-lg" aria-label="Excluir parcela">×</button>
    </div>)}</div>}
  </section>
}

function FormActions({ onCancel, submit }: { onCancel: () => void; submit: string }) {
  return <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end"><button type="button" onClick={onCancel} className="button-secondary rounded-xl px-5 py-3 text-sm font-semibold">Cancelar</button><button className="button-primary rounded-xl px-5 py-3 text-sm font-semibold">{submit}</button></div>
}

function ClientForm({ initial, onClose, onSave }: { initial?: Client; onClose: () => void; onSave: (client: ClientDraft) => void }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const name = String(form.get('name') ?? '').trim()
    if (!name) return
    onSave({
      name,
      phone: String(form.get('phone') ?? '').trim(),
      email: initial?.email ?? '',
      address: String(form.get('address') ?? '').trim(),
      notes: String(form.get('notes') ?? '').trim(),
    })
  }
  return <form onSubmit={submit} className="space-y-4">
    <Field label="Nome" name="name" placeholder="Nome do cliente" defaultValue={initial?.name ?? ''} required autoFocus />
    <Field label="Telefone" name="phone" type="tel" placeholder="(00) 00000-0000" defaultValue={initial?.phone ?? ''} />
    <Field label="Endereço" name="address" placeholder="Rua, número, cidade" defaultValue={initial?.address ?? ''} />
    <label className="block text-sm font-medium text-stone-600">Observações<textarea name="notes" rows={3} defaultValue={initial?.notes ?? ''} className="mt-2 w-full rounded-xl border border-stone-200 bg-white px-3.5 py-3 text-base outline-none focus:border-[#b48b50] focus:ring-2 focus:ring-[#b48b50]/15" /></label>
    <FormActions onCancel={onClose} submit={initial ? 'Salvar alterações' : 'Cadastrar cliente'} />
  </form>
}

function ServiceForm({ clients, initial, initialClientId, onClose, onSave }: { clients: Client[]; initial?: Service; initialClientId?: string; onClose: () => void; onSave: (service: ServiceDraft) => void }) {
  const [responsible, setResponsible] = useState<Service['responsible']>(initial?.responsible ?? 'proprio')
  const [charged, setCharged] = useState(initial ? String(initial.chargedAmount).replace('.', ',') : '')
  const [cost, setCost] = useState(initial?.thirdPartyCost ? String(initial.thirdPartyCost).replace('.', ',') : '')
  const [materials, setMaterials] = useState<ServiceMaterial[]>(() => initial?.materials?.length
    ? initial.materials
    : initial?.materialsCost
      ? [{ id: 'legacy-material-cost', name: 'Materiais registrados anteriormente', cost: initial.materialsCost }]
      : [],
  )
  const [newMaterialName, setNewMaterialName] = useState('')
  const [newMaterialCost, setNewMaterialCost] = useState('')
  const [materialError, setMaterialError] = useState('')
  const chargedValue = parseDecimal(charged)
  const costValue = responsible === 'terceirizado' ? parseDecimal(cost) : 0
  const materialsCost = materials.reduce((sum, item) => sum + item.cost, 0)
  const previewProfit = (Number.isFinite(chargedValue) ? chargedValue : 0) - (Number.isFinite(costValue) ? costValue : 0) - materialsCost

  function addMaterial() {
    const name = newMaterialName.trim()
    const materialCost = parseDecimal(newMaterialCost)
    if (!name || !Number.isFinite(materialCost) || materialCost <= 0) {
      setMaterialError('Informe a descrição e um valor maior que zero.')
      return
    }
    setMaterials((current) => [...current, { id: crypto.randomUUID(), name, cost: materialCost }])
    setNewMaterialName('')
    setNewMaterialCost('')
    setMaterialError('')
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const clientId = String(form.get('clientId') ?? '')
    const description = String(form.get('description') ?? '').trim()
    const date = String(form.get('date') ?? '')
    const chargedAmount = parseDecimal(String(form.get('chargedAmount') ?? ''))
    const thirdPartyCost = responsible === 'terceirizado' ? parseDecimal(String(form.get('thirdPartyCost') ?? '')) : 0
    if (!clientId || !description || !date || !Number.isFinite(chargedAmount) || chargedAmount < 0 || !Number.isFinite(thirdPartyCost) || thirdPartyCost < 0) return
    onSave({ clientId, description, date, responsible, chargedAmount, thirdPartyCost, materials: materials.slice(), materialsCost, observations: String(form.get('observations') ?? '').trim() })
  }

  return <form onSubmit={submit} className="space-y-4">
    <label className="block text-sm font-medium text-stone-600">Cliente<select name="clientId" required defaultValue={initial?.clientId ?? initialClientId ?? ''} className="mt-2 w-full rounded-xl border border-stone-200 bg-white px-3.5 py-3 text-base outline-none focus:border-[#b48b50]"><option value="" disabled>Selecione um cliente</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
    <label className="block text-sm font-medium text-stone-600">Descrição do serviço<textarea name="description" rows={2} defaultValue={initial?.description ?? ''} required placeholder="Descreva o serviço realizado" className="mt-2 w-full rounded-xl border border-stone-200 bg-white px-3.5 py-3 text-base outline-none focus:border-[#b48b50] focus:ring-2 focus:ring-[#b48b50]/15" /></label>
    <div className="grid gap-4 sm:grid-cols-2"><DateField label="Data do serviço" name="date" initialValue={initial?.date.slice(0, 10) ?? today()} required /><label className="block text-sm font-medium text-stone-600">Responsável pela execução<select name="responsible" value={responsible} onChange={(event) => setResponsible(event.target.value as Service['responsible'])} className="mt-2 w-full rounded-xl border border-stone-200 bg-white px-3.5 py-3 text-base outline-none focus:border-[#b48b50]"><option value="proprio">Próprio</option><option value="terceirizado">Terceirizado</option></select></label></div>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Valor cobrado do cliente (R$)" name="chargedAmount" type="text" inputMode="decimal" placeholder="0,00" value={charged} onChange={(event) => setCharged(event.target.value)} required />{responsible === 'terceirizado' && <Field label="Custo da terceirização (R$)" name="thirdPartyCost" type="text" inputMode="decimal" placeholder="0,00" value={cost} onChange={(event) => setCost(event.target.value)} required />}</div>
    <section className="rounded-xl border border-stone-200/70 bg-white p-4">
      <div className="mb-3 flex items-center justify-between"><h3 className="font-serif text-lg">Materiais</h3><span className="text-sm font-semibold">Total {money(materialsCost)}</span></div>
      {materials.length > 0 && <div className="mb-4 divide-y divide-stone-100">{materials.map((material) => <div key={material.id} className="flex items-center gap-3 py-2"><span className="min-w-0 flex-1 truncate text-sm">{material.name}</span><span className="text-sm font-semibold">{money(material.cost)}</span><button type="button" onClick={() => setMaterials((current) => current.filter((item) => item.id !== material.id))} className="button-icon grid h-8 w-8 place-items-center rounded-lg" aria-label={`Remover material ${material.name}`}>×</button></div>)}</div>}
      <div className="grid gap-3 sm:grid-cols-[1fr_150px_auto] sm:items-end"><Field label="Descrição do material" name="newMaterialName" placeholder="Ex.: Parafuso" value={newMaterialName} onChange={(event) => setNewMaterialName(event.target.value)} /><Field label="Valor (R$)" name="newMaterialCost" type="text" inputMode="decimal" placeholder="100,00" value={newMaterialCost} onChange={(event) => setNewMaterialCost(event.target.value)} /><button type="button" onClick={addMaterial} className="button-secondary rounded-xl px-4 py-3 text-sm font-semibold">＋ Adicionar material</button></div>
      {materialError && <p role="alert" className="mt-2 text-sm text-red-700">{materialError}</p>}
    </section>
    <div className="flex items-center justify-between rounded-xl bg-[#f8f6f1] px-4 py-3 text-sm"><span className="font-medium text-stone-600">Lucro estimado do serviço</span><span className={`financial-value font-semibold ${previewProfit < 0 ? 'text-red-700' : 'text-[#718a77]'}`}>{money(previewProfit)}</span></div>
    <label className="block text-sm font-medium text-stone-600">Observações<textarea name="observations" rows={3} defaultValue={initial?.observations ?? ''} className="mt-2 w-full rounded-xl border border-stone-200 bg-white px-3.5 py-3 text-base outline-none focus:border-[#b48b50] focus:ring-2 focus:ring-[#b48b50]/15" /></label>
    <FormActions onCancel={onClose} submit={initial ? 'Salvar alterações' : 'Registrar serviço'} />
  </form>
}

function AuthScreen({ client }: { client: SupabaseClient }) {
  const [creatingAccount, setCreatingAccount] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const authMessages: Record<string, string> = {
    invalid_credentials: 'Usuário ou senha incorretos.',
    username_taken: 'Esse nome de usuário já está em uso.',
    invalid_username: 'O nome de usuário informado é inválido.',
    invalid_password: 'A senha deve ter entre 8 e 72 caracteres.',
    account_unavailable: 'Não foi possível acessar essa conta. Contate o administrador.',
    email_confirmation_enabled: 'O administrador precisa desativar a confirmação de e-mail no Supabase.',
    signup_failed: 'Não foi possível criar a conta. Verifique a configuração do Supabase e tente novamente.',
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    const form = new FormData(event.currentTarget)
    const username = String(form.get('username') ?? '').trim().toLowerCase()
    const password = String(form.get('password') ?? '')
    if (!/^[a-z0-9][a-z0-9._-]{2,23}$/.test(username)) {
      setMessage('Use um nome de usuário de 3 a 24 caracteres: letras sem acento, números, ponto, hífen ou sublinhado.')
      setBusy(false)
      return
    }
    if (password.length < 8 || password.length > 72) {
      setMessage('A senha deve ter entre 8 e 72 caracteres.')
      setBusy(false)
      return
    }
    try {
      const { data, error } = await client.functions.invoke<{
        ok: boolean
        code?: string
        session?: { access_token: string; refresh_token: string }
      }>('username-auth', {
        body: { action: creatingAccount ? 'signup' : 'signin', username, password },
      })
      if (error) {
        const context = 'context' in error ? error.context : null
        if (context instanceof Response) {
          const failure: unknown = await context.clone().json().catch(() => null)
          const code = failure && typeof failure === 'object' && 'code' in failure && typeof failure.code === 'string'
            ? failure.code
            : ''
          setMessage(authMessages[code] ?? 'O serviço de autenticação retornou um erro. Confira os logs da função username-auth no Supabase.')
          return
        }
        throw error
      }
      if (!data?.ok || !data.session) {
        setMessage(authMessages[data?.code ?? ''] ?? 'Não foi possível autenticar. Tente novamente.')
        return
      }
      const { error: sessionError } = await client.auth.setSession(data.session)
      if (sessionError) throw sessionError
    } catch (error) {
      console.error(error)
      setMessage('Não foi possível acessar a função de autenticação. Confirme se username-auth está publicada no mesmo projeto Supabase configurado no app.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="grid min-h-screen place-items-center bg-[#f8f6f1] px-5 py-10"><section className="w-full max-w-md rounded-[24px] border border-stone-200/70 bg-white p-7 shadow-sm sm:p-9">
    <Brand />
    <h1 className="mt-8 font-serif text-3xl">{creatingAccount ? 'Criar conta' : 'Entrar'}</h1>
    <p className="mt-2 text-sm text-stone-500">Acesse com seu nome de usuário e senha.</p>
    <form onSubmit={submit} className="mt-6 space-y-4">
      <Field label="Nome de usuário" name="username" type="text" autoComplete="username" minLength={3} maxLength={24} pattern="[A-Za-z0-9][A-Za-z0-9._\-]{2,23}" title="Use 3 a 24 caracteres: letras sem acento, números, ponto, hífen ou sublinhado." required />
      <Field label="Senha" name="password" type="password" autoComplete={creatingAccount ? 'new-password' : 'current-password'} minLength={8} required />
      {message && <p role="status" className="text-sm text-stone-600">{message}</p>}
      <button disabled={busy} className="button-primary w-full rounded-xl px-4 py-3 text-sm font-semibold disabled:opacity-60">{busy ? 'Aguarde...' : creatingAccount ? 'Criar conta' : 'Entrar'}</button>
    </form>
    <button type="button" onClick={() => { setCreatingAccount((value) => !value); setMessage('') }} className="button-link mt-5 w-full text-center text-sm font-semibold">{creatingAccount ? 'Já tenho uma conta' : 'Criar uma conta'}</button>
    <p className="mt-5 text-center text-xs leading-5 text-stone-400">Não há recuperação de senha por e-mail. Se perder a senha, contate o administrador.</p>
  </section></main>
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState('')
  const client = supabase

  useEffect(() => {
    if (!client) {
      setAuthLoading(false)
      return
    }
    let active = true
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
    })
    client.auth.getSession().then(({ data, error }) => {
      if (!active) return
      if (error) setAuthError(error.message)
      setSession(data.session)
      setAuthLoading(false)
    }).catch((error: unknown) => {
      if (!active) return
      console.error(error)
      setAuthError(error instanceof Error ? error.message : 'Não foi possível verificar a sessão.')
      setAuthLoading(false)
    })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [client])

  if (supabaseConfigError || !client) return <main className="grid min-h-screen place-items-center bg-[#f8f6f1] px-5"><section className="max-w-xl rounded-[24px] border border-stone-200 bg-white p-8"><Brand /><h1 className="mt-8 font-serif text-2xl">Configuração do Supabase necessária</h1><p className="mt-3 text-sm leading-6 text-stone-600">{supabaseConfigError}</p><p className="mt-3 text-sm leading-6 text-stone-600">No computador, crie <code>.env.local</code> na pasta do projeto. No Vercel, configure essas variáveis em Project Settings → Environment Variables e publique um novo deploy.</p></section></main>
  if (authLoading) return <main className="grid min-h-screen place-items-center bg-[#f8f6f1] text-sm text-stone-500">Conectando ao Supabase...</main>
  if (authError) return <main className="grid min-h-screen place-items-center bg-[#f8f6f1] px-5"><p role="alert" className="rounded-xl bg-white p-6 text-sm text-red-700">Erro ao verificar a sessão: {authError}</p></main>
  if (!session) return <AuthScreen client={client} />
  return <Dashboard key={session.user.id} userId={session.user.id} email={session.user.user_metadata.username ?? 'Conta'} onSignOut={async () => {
    const { error } = await client.auth.signOut()
    if (error) throw error
  }} />
}

function Dashboard({ userId, email, onSignOut }: { userId: string; email: string; onSignOut: () => Promise<void> }) {
  const [cloudData, setCloudData] = useState<CloudData>({ clients: [], services: [], servicePayments: [] })
  const [dataLoading, setDataLoading] = useState(true)
  const [dataError, setDataError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const refreshData = useCallback(async () => {
    const data = await loadCloudData(userId)
    setCloudData(data)
    setDataError('')
  }, [userId])

  useEffect(() => {
    let active = true
    setDataLoading(true)
    loadCloudData(userId).then((data) => {
      if (active) {
        setCloudData(data)
        setDataError('')
      }
    }).catch((error: unknown) => {
      console.error(error)
      if (active) setDataError(error instanceof Error ? error.message : 'Falha ao carregar os dados.')
    }).finally(() => {
      if (active) setDataLoading(false)
    })
    return () => { active = false }
  }, [userId])

  const clients = cloudData.clients
  const services = cloudData.services
  const servicePayments = cloudData.servicePayments
  const [page, setPage] = useState<Page>('Visão geral')
  const [modal, setModal] = useState<'client' | 'service' | null>(null)
  const [editingClient, setEditingClient] = useState<Client | undefined>()
  const [editingService, setEditingService] = useState<Service | undefined>()
  const [activeService, setActiveService] = useState<Service | null>(null)
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null)
  const [initialServiceClientId, setInitialServiceClientId] = useState<string | undefined>()
  const [search, setSearch] = useState('')
  const [serviceClientId, setServiceClientId] = useState('')
  const [serviceResponsible, setServiceResponsible] = useState('')
  const [paymentSearch, setPaymentSearch] = useState('')
  const [reportStart, setReportStart] = useState(`${today().slice(0, 7)}-01`)
  const [reportEnd, setReportEnd] = useState(today())
  const [reportClientId, setReportClientId] = useState('')
  const [message, setMessage] = useState('')
  const activeServicePayments = servicePayments.filter((payment) => payment.serviceId === activeService?.id)

  const clientById = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients])
  const totalCharged = services.reduce((total, service) => total + service.chargedAmount, 0)
  const totalOutsourced = services.reduce((total, service) => total + (service.thirdPartyCost ?? 0), 0)
  const totalMaterials = services.reduce((total, service) => total + (service.materialsCost ?? 0), 0)
  const totalProfit = services.reduce((total, service) => total + profit(service), 0)
  const recentServices = [...services].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5)
  const visibleClients = clients.filter((client) => `${client.name} ${client.phone}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')))
  const visibleServices = services.filter((service) => !serviceClientId || service.clientId === serviceClientId).filter((service) => !serviceResponsible || service.responsible === serviceResponsible).sort((a, b) => b.date.localeCompare(a.date))
  const paymentGroups = clients
    .map((client) => {
      const clientServices = services.filter((service) => service.clientId === client.id)
      const payments = servicePayments.filter((payment) => clientServices.some((service) => service.id === payment.serviceId))
      const charged = clientServices.reduce((sum, service) => sum + service.chargedAmount, 0)
      const received = payments.filter((payment) => payment.party === 'client').reduce((sum, payment) => sum + payment.amount, 0)
      const outsourced = clientServices.reduce((sum, service) => sum + (service.thirdPartyCost ?? 0), 0)
      const materials = clientServices.reduce((sum, service) => sum + (service.materialsCost ?? 0), 0)
      const paidToThirdParties = payments.filter((payment) => payment.party === 'thirdParty').reduce((sum, payment) => sum + payment.amount, 0)
      return { client, services: clientServices, charged, received, outstanding: Math.max(0, charged - received), outsourced, materials, paidToThirdParties, thirdPartyOutstanding: Math.max(0, outsourced - paidToThirdParties) }
    })
    .filter((group) => group.services.length > 0 && `${group.client.name} ${group.client.phone}`.toLocaleLowerCase('pt-BR').includes(paymentSearch.toLocaleLowerCase('pt-BR')))
  const filteredServices = services.filter((service) => (!reportStart || service.date.slice(0, 10) >= reportStart) && (!reportEnd || service.date.slice(0, 10) <= reportEnd)).filter((service) => !reportClientId || service.clientId === reportClientId).sort((a, b) => b.date.localeCompare(a.date))
  const reportCharged = filteredServices.reduce((total, service) => total + service.chargedAmount, 0)
  const reportOutsourced = filteredServices.reduce((total, service) => total + (service.thirdPartyCost ?? 0), 0)
  const reportMaterials = filteredServices.reduce((total, service) => total + (service.materialsCost ?? 0), 0)
  const reportProfit = filteredServices.reduce((total, service) => total + profit(service), 0)
  const activeClient = clients.find((client) => client.id === selectedClientId)
  const clientServices = activeClient ? services.filter((service) => service.clientId === activeClient.id).sort((a, b) => b.date.localeCompare(a.date)) : []

  function notify(text: string) {
    setMessage(text)
    window.setTimeout(() => setMessage(''), 3200)
  }
  async function signOut() {
    try {
      await onSignOut()
    } catch (error) {
      console.error(error)
      notify('Não foi possível sair da conta.')
    }
  }
  async function exportBackup() {
    try {
      const backup = await exportCloudData(userId)
      const file = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(file)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `cs-litoral-backup-${today()}.json`
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      notify('Backup exportado com sucesso.')
    } catch (error) {
      console.error(error)
      notify('Não foi possível exportar os dados.')
    }
  }
  async function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      notify('O arquivo deve ter no máximo 10 MB.')
      return
    }
    if (!window.confirm('Importar este backup? Registros com o mesmo ID serão atualizados; os demais serão adicionados. Outros registros da conta serão mantidos.')) return
    try {
      const parsed: unknown = JSON.parse(await file.text())
      if (!isDataBackup(parsed)) throw new Error('Arquivo inválido ou incompatível. Selecione um backup exportado por este aplicativo.')
      await importCloudData(parsed)
      await refreshData()
      notify('Dados importados com sucesso.')
    } catch (error) {
      console.error(error)
      notify(error instanceof Error ? `Falha ao importar: ${error.message}` : 'Não foi possível importar os dados.')
    }
  }
  function generateMonthlyPdf() {
    if (!reportStart || !reportEnd || reportStart > reportEnd) {
      notify('Informe um período válido para gerar o relatório.')
      return
    }
    window.print()
  }
  function openClientForm(client?: Client) { setEditingClient(client); setModal('client') }
  function openServiceForm(service?: Service, clientId?: string) {
    if (!clients.length) { notify('Cadastre um cliente antes de registrar um serviço.'); setPage('Clientes'); return }
    setEditingService(service)
    setInitialServiceClientId(clientId)
    setModal('service')
  }
  async function saveClient(draft: ClientDraft) {
    try {
      await saveCloudClient(userId, draft, editingClient?.id)
      await refreshData()
      notify(editingClient ? 'Cadastro do cliente atualizado.' : 'Cliente cadastrado com sucesso.')
      setModal(null); setEditingClient(undefined)
    } catch (error) { console.error(error); notify('Não foi possível salvar o cliente.') }
  }
  async function saveService(draft: ServiceDraft) {
    try {
      await saveCloudService(draft, editingService?.id)
      await refreshData()
      notify(editingService ? 'Serviço atualizado com sucesso.' : 'Serviço registrado com sucesso.')
      setModal(null); setEditingService(undefined); setInitialServiceClientId(undefined)
    } catch (error) { console.error(error); notify('Não foi possível salvar o serviço.') }
  }
  async function deleteService(service: Service) {
    if (!service.id || !window.confirm(`Excluir o serviço "${service.description}"?`)) return
    try {
      await deleteCloudService(userId, service.id)
      await refreshData()
      notify('Serviço e parcelas excluídos.')
    }
    catch (error) { console.error(error); notify('Não foi possível excluir o serviço.') }
  }
  async function deleteClient(client: Client) {
    if (!client.id || !window.confirm(`Excluir ${client.name} e todo o histórico de serviços deste cliente?`)) return
    try {
      await deleteCloudClient(userId, client.id)
      await refreshData()
      setSelectedClientId(null); notify('Cliente e histórico excluídos.')
    } catch (error) { console.error(error); notify('Não foi possível excluir o cliente.') }
  }

  if (dataLoading) return <main className="grid min-h-screen place-items-center bg-[#f8f6f1] text-sm text-stone-500">Carregando seus dados...</main>
  if (dataError) return <main className="grid min-h-screen place-items-center bg-[#f8f6f1] px-5"><section className="max-w-lg rounded-2xl bg-white p-6 text-center"><p role="alert" className="text-sm text-red-700">Não foi possível carregar os dados: {dataError}</p><button onClick={() => { setDataLoading(true); void refreshData().catch((error: unknown) => setDataError(error instanceof Error ? error.message : 'Falha ao carregar os dados.')).finally(() => setDataLoading(false)) }} className="button-primary mt-4 rounded-xl px-5 py-3 text-sm font-semibold">Tentar novamente</button></section></main>

  return <div className="min-h-screen bg-[#f8f6f1] text-stone-800"><div className="mx-auto flex min-h-screen max-w-[1440px]">
    <aside className="hidden w-[248px] shrink-0 border-r border-stone-200/80 bg-[#fbfaf7] px-5 py-8 md:flex md:flex-col"><Brand /><p className="mb-3 mt-12 px-3 text-[10px] font-semibold uppercase tracking-[.2em] text-stone-400">Menu principal</p><Nav page={page} setPage={setPage} /><div className="mt-auto border-t border-stone-200 pt-4"><p className="truncate px-3 text-xs text-stone-500">{email}</p><button onClick={() => void signOut()} className="button-link mt-2 px-3 text-sm font-semibold">Sair da conta</button></div></aside>
    <main className="min-w-0 flex-1 pb-24 md:pb-8">
      <header className="sticky top-0 z-20 flex min-h-[76px] items-center justify-between gap-2 border-b border-stone-200/70 bg-[#f8f6f1]/90 px-3 backdrop-blur-md sm:px-8 lg:px-11"><div className="md:hidden"><Brand compact /></div><div className="hidden md:block"><p className="text-sm capitalize text-stone-500">{new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</p><h1 className="font-serif text-[26px] leading-tight">{page}</h1></div><div className="flex items-center gap-1.5 sm:gap-2"><input ref={fileInput} type="file" accept="application/json,.json" className="hidden" onChange={(event) => void importBackup(event)} /><button type="button" onClick={() => void exportBackup()} aria-label="Exportar dados" className="button-secondary rounded-full px-2.5 py-2.5 text-xs font-semibold sm:px-3"><span aria-hidden="true">⇩ </span><span className="hidden sm:inline">Exportar</span></button><button type="button" onClick={() => fileInput.current?.click()} aria-label="Importar dados" className="button-secondary rounded-full px-2.5 py-2.5 text-xs font-semibold sm:px-3"><span aria-hidden="true">⇧ </span><span className="hidden sm:inline">Importar</span></button><button type="button" onClick={() => void signOut()} aria-label="Sair da conta" title="Sair da conta" className="button-secondary rounded-full px-2.5 py-2.5 text-xs font-semibold md:hidden">Sair</button><button onClick={() => openServiceForm()} className="button-primary rounded-full px-3 py-2.5 text-xs font-semibold shadow-sm sm:px-5 sm:text-sm"><span className="mr-1.5">＋</span><span className="hidden sm:inline">Novo serviço</span><span className="sm:hidden">Novo</span></button></div></header>
      <div className="mx-auto max-w-[1160px] px-5 py-7 sm:px-8 lg:px-11 lg:py-9"><div className="mb-7 md:hidden"><p className="text-xs capitalize text-stone-500">{new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</p><h1 className="mt-1 font-serif text-3xl">{page}</h1></div>
        {page === 'Visão geral' && <section>
          <div className="mb-7 flex flex-wrap items-end justify-between gap-3"><div><p className="font-serif text-2xl">Resumo da operação</p><p className="mt-1 text-sm font-semibold text-stone-500">Acompanhe clientes, serviços e resultados.</p></div><span className="rounded-full border border-stone-200 bg-white/70 px-3 py-1.5 text-xs capitalize text-stone-500">{new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</span></div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6 lg:gap-4"><Metric label="Clientes cadastrados" value={String(clients.length)} icon="♧" tint="sand" detail="base de clientes" /><Metric label="Serviços realizados" value={String(services.length)} icon="◇" tint="sage" detail="registros no histórico" /><Metric label="Faturamento total" value={money(totalCharged)} icon="↗" tint="rose" detail="valor cobrado" /><Metric label="Gastos terceirizados" value={money(totalOutsourced)} icon="↙" tint="gold" detail="custo dos serviços" /><Metric label="Gastos com materiais" value={money(totalMaterials)} icon="▦" tint="sand" detail="custo dos materiais" /><Metric label="Lucro total" value={money(totalProfit)} icon="✧" tint="sage" detail="após materiais e terceirização" /></div>
          <section className="mt-7 rounded-[22px] border border-stone-200/70 bg-white p-5 sm:p-6"><div className="mb-5 flex items-center justify-between gap-3"><div><h2 className="font-serif text-xl">Serviços recentes</h2><p className="mt-1 text-xs text-stone-500">Últimos registros adicionados</p></div><button onClick={() => setPage('Serviços')} className="button-link text-xs font-semibold">Ver todos →</button></div>{recentServices.length ? <div className="divide-y divide-stone-100">{recentServices.map((service) => <ServiceRow key={service.id} service={service} clientName={clientById.get(service.clientId)?.name ?? 'Cliente'} onEdit={() => openServiceForm(service)} onDelete={() => void deleteService(service)} />)}</div> : <EmptyState text="Seus serviços registrados aparecerão aqui." />}</section>
          <div className="mt-5 grid gap-4 sm:grid-cols-2"><QuickAction icon="♧" title="Novo cliente" description="Cadastre os dados de um cliente" onClick={() => openClientForm()} /><QuickAction icon="◇" title="Registrar serviço" description="Vincule um serviço a um cliente" onClick={() => openServiceForm()} /></div>
        </section>}

        {page === 'Clientes' && <section><PageHeading title="Clientes" subtitle="Consulte cadastros e acompanhe o histórico de serviços." button="＋ Adicionar cliente" onClick={() => openClientForm()} /><div className="mb-4"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome ou telefone..." className="w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#b48b50] sm:max-w-md" /></div><div className="overflow-hidden rounded-[22px] border border-stone-200/70 bg-white"><div className="hidden grid-cols-[1.5fr_1fr_1fr] gap-3 bg-[#fbfaf7] px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-stone-400 sm:grid"><span>Cliente</span><span>Serviços</span><span>Faturamento</span></div>{visibleClients.map((client) => { const related = services.filter((service) => service.clientId === client.id); const charged = related.reduce((total, service) => total + service.chargedAmount, 0); return <button key={client.id} onClick={() => setSelectedClientId(client.id ?? null)} className="button-row flex w-full items-center gap-3 border-t border-stone-100 px-4 py-4 text-left first:border-0 sm:grid sm:grid-cols-[1.5fr_1fr_1fr] sm:gap-3 sm:px-5"><Avatar name={client.name} /><span className="min-w-0 flex-1 sm:flex-auto"><span className="block truncate text-sm font-semibold">{client.name}</span><span className="block truncate text-xs text-stone-500">{client.phone || 'Sem telefone cadastrado'}</span></span><span className="hidden text-sm text-stone-600 sm:block">{related.length}</span><span className="financial-value whitespace-nowrap text-right text-sm font-semibold sm:text-left">{money(charged)}<span className="block text-[10px] font-normal text-stone-400 sm:hidden">faturamento</span></span></button> })}{!visibleClients.length && <EmptyState text={clients.length ? 'Nenhum cliente encontrado.' : 'Cadastre seu primeiro cliente para começar.'} />}</div></section>}

        {page === 'Serviços' && <section>
          <PageHeading title="Serviços" subtitle="Registre o trabalho realizado, os custos e o resultado." />
          <div className="mb-5 grid gap-3 rounded-xl border border-stone-200/70 bg-white p-4 sm:grid-cols-2">
            <label className="block text-sm font-medium text-stone-600">Cliente<select value={serviceClientId} onChange={(event) => setServiceClientId(event.target.value)} className="mt-2 w-full rounded-xl border border-stone-200 bg-white px-3.5 py-3 text-base outline-none"><option value="">Todos os clientes</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
            <label className="block text-sm font-medium text-stone-600">Execução<select value={serviceResponsible} onChange={(event) => setServiceResponsible(event.target.value)} className="mt-2 w-full rounded-xl border border-stone-200 bg-white px-3.5 py-3 text-base outline-none"><option value="">Todos</option><option value="proprio">Próprio</option><option value="terceirizado">Terceirizado</option></select></label>
          </div>
          <div className="overflow-hidden rounded-[22px] border border-stone-200/70 bg-white">{visibleServices.map((service) => <ServiceRow key={service.id} service={service} clientName={clientById.get(service.clientId)?.name ?? 'Cliente'} onOpen={() => setActiveService(service)} onEdit={() => openServiceForm(service)} onDelete={() => void deleteService(service)} />)}{!visibleServices.length && <EmptyState text={services.length ? 'Nenhum serviço encontrado para esses filtros.' : clients.length ? 'Registre seu primeiro serviço.' : 'Cadastre um cliente antes de registrar serviços.'} />}</div>
        </section>}

        {page === 'Pagamentos' && <section>
          <PageHeading title="Pagamentos" subtitle="Acompanhe parcelas recebidas e pagamentos a terceiros por cliente." />
          <div className="mb-5"><input value={paymentSearch} onChange={(event) => setPaymentSearch(event.target.value)} placeholder="Buscar cliente por nome ou telefone..." className="w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm outline-none sm:max-w-md" /></div>
          <div className="space-y-4">{paymentGroups.map((group) => <section key={group.client.id} className="overflow-hidden rounded-[18px] border border-stone-200/70 bg-white">
            <header className="border-b border-stone-200/70 bg-[#E6E9EF] px-4 py-4 sm:px-5"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><Avatar name={group.client.name} /><div><h2 className="font-serif text-lg">{group.client.name}</h2><p className="text-xs text-stone-500">{group.client.phone || 'Sem telefone'} · {group.services.length} {group.services.length === 1 ? 'serviço' : 'serviços'}</p></div></div><div className="grid grid-cols-2 gap-2 text-right sm:grid-cols-3 lg:grid-cols-6"><Summary label="Cobrado" value={money(group.charged)} /><Summary label="Recebido" value={money(group.received)} /><Summary label="Em aberto" value={money(group.outstanding)} /><Summary label="Materiais" value={money(group.materials)} /><Summary label="Pago terceiros" value={money(group.paidToThirdParties)} /><Summary label="A pagar terceiros" value={money(group.thirdPartyOutstanding)} /></div></div></header>
            <div className="divide-y divide-stone-100">{group.services.sort((a, b) => b.date.localeCompare(a.date)).map((service) => <ServiceRow key={service.id} service={service} clientName={group.client.name} onOpen={() => setActiveService(service)} onEdit={() => openServiceForm(service)} onDelete={() => void deleteService(service)} />)}</div>
          </section>)}{!paymentGroups.length && <EmptyState text={services.length ? 'Nenhum pagamento encontrado para essa busca.' : 'Registre um serviço para acompanhar os pagamentos.'} />}</div>
        </section>}

        {page === 'Relatórios' && <section className="print-report">
          <PageHeading title="Relatório mensal" subtitle="Faturamento, custos e lucro dos serviços no período selecionado." button="Gerar PDF mensal" onClick={generateMonthlyPdf} />
          <p className="mb-5 text-sm text-stone-500">Período: {formatDate(reportStart)} a {formatDate(reportEnd)}{reportClientId ? ` · Cliente: ${clientById.get(reportClientId)?.name ?? ''}` : ' · Todos os clientes'}</p>
          <div className="report-controls mb-5 grid gap-4 rounded-[22px] border border-stone-200/70 bg-white p-4 sm:grid-cols-3 sm:px-5">
            <DateField label="Data inicial" name="reportStart" initialValue={reportStart} onChange={setReportStart} />
            <DateField label="Data final" name="reportEnd" initialValue={reportEnd} onChange={setReportEnd} />
            <label className="block text-sm font-medium text-stone-600">Cliente<select value={reportClientId} onChange={(event) => setReportClientId(event.target.value)} className="mt-2 w-full rounded-xl border border-stone-200 bg-white px-3.5 py-3 text-base outline-none focus:border-[#b48b50]"><option value="">Todos os clientes</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
          </div>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5"><Metric label="Serviços" value={String(filteredServices.length)} icon="◇" tint="sand" detail="no período selecionado" /><Metric label="Faturamento" value={money(reportCharged)} icon="↗" tint="sage" detail="valor cobrado" /><Metric label="Terceirizados" value={money(reportOutsourced)} icon="↙" tint="rose" detail="custos no período" /><Metric label="Materiais" value={money(reportMaterials)} icon="▦" tint="sand" detail="custo dos materiais" /><Metric label="Lucro" value={money(reportProfit)} icon="✧" tint="gold" detail="após os custos" /></div>
          <div className="overflow-hidden rounded-[22px] border border-stone-200/70 bg-white">{filteredServices.map((service) => <ServiceRow key={service.id} service={service} clientName={clientById.get(service.clientId)?.name ?? 'Cliente'} onEdit={() => openServiceForm(service)} onDelete={() => void deleteService(service)} />)}{!filteredServices.length && <EmptyState text="Não há serviços no período e cliente selecionados." />}</div>
          <ReportChart billed={reportCharged} outsourced={reportOutsourced} materials={reportMaterials} profit={reportProfit} />
        </section>}
      </div>
    </main>
  </div>

  <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 flex w-full justify-between border-t border-stone-200/80 bg-[#fbfaf7]/95 px-1 pt-2 backdrop-blur-md md:hidden">{pages.map((item) => <button key={item.name} onClick={() => setPage(item.name)} className={`button-mobile-nav flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 py-1 text-[10px] ${page === item.name ? 'button-mobile-nav-active' : ''}`}><span className="text-xl leading-6">{item.icon}</span>{item.name === 'Visão geral' ? 'Início' : item.name}</button>)}</nav>
  {message && <div role="status" className="fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-stone-800 px-5 py-3 text-center text-sm text-white shadow-lg md:bottom-7">{message}</div>}
  {modal === 'client' && <Modal title={editingClient ? 'Editar cliente' : 'Novo cliente'} onClose={() => { setModal(null); setEditingClient(undefined) }}><ClientForm key={editingClient?.id ?? 'new-client'} initial={editingClient} onClose={() => { setModal(null); setEditingClient(undefined) }} onSave={(draft) => void saveClient(draft)} /></Modal>}
  {modal === 'service' && <Modal title={editingService ? 'Editar serviço' : 'Novo serviço'} onClose={() => { setModal(null); setEditingService(undefined); setInitialServiceClientId(undefined) }}><ServiceForm key={editingService?.id ?? `new-service-${initialServiceClientId ?? ''}`} clients={clients} initial={editingService} initialClientId={initialServiceClientId} onClose={() => { setModal(null); setEditingService(undefined); setInitialServiceClientId(undefined) }} onSave={(draft) => void saveService(draft)} /></Modal>}
  {activeService && <ServiceDetails service={activeService} userId={userId} clientName={clientById.get(activeService.clientId)?.name ?? 'Cliente'} payments={activeServicePayments} notify={notify} refreshData={refreshData} onClose={() => setActiveService(null)} />}
  {activeClient && <Modal title={activeClient.name} onClose={() => setSelectedClientId(null)}>
    <div className="mb-5 rounded-2xl bg-[#f8f6f1] p-4"><p className="text-sm text-stone-600">{activeClient.phone || 'Sem telefone'}</p>{activeClient.address && <p className="mt-1 text-sm text-stone-500">{activeClient.address}</p>}{activeClient.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-stone-500">{activeClient.notes}</p>}<p className="mt-2 text-xs text-stone-400">Cliente desde {formatDate(activeClient.createdAt)}</p></div>
    <div className="mb-5 grid grid-cols-3 gap-2 text-center"><Summary label="Serviços" value={String(clientServices.length)} /><Summary label="Faturado" value={money(clientServices.reduce((sum, service) => sum + service.chargedAmount, 0))} /><Summary label="Lucro" value={money(clientServices.reduce((sum, service) => sum + profit(service), 0))} /></div>
    <div className="mb-3 flex items-center justify-between gap-2"><h3 className="font-serif text-lg">Histórico de serviços</h3><button onClick={() => openServiceForm(undefined, activeClient.id)} className="button-link text-xs font-semibold">＋ Serviço</button></div>
    <div className="max-h-64 divide-y divide-stone-100 overflow-y-auto">{clientServices.map((service) => <ServiceRow key={service.id} service={service} clientName={activeClient.name} compact onEdit={() => { setSelectedClientId(null); openServiceForm(service) }} onDelete={() => void deleteService(service)} />)}{!clientServices.length && <p className="py-5 text-center text-sm text-stone-400">Ainda não há serviços para este cliente.</p>}</div>
    <div className="mt-5 flex flex-col gap-3 sm:flex-row"><button onClick={() => { setSelectedClientId(null); openClientForm(activeClient) }} className="button-secondary flex-1 rounded-xl px-4 py-3 text-sm font-semibold">Editar cliente</button><button onClick={() => void deleteClient(activeClient)} className="button-secondary flex-1 rounded-xl px-4 py-3 text-sm font-semibold">Excluir cliente</button></div>
  </Modal>}
  </div>
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <div className="flex items-center gap-2.5"><span className="brand-mark" aria-hidden="true">CS</span><span className={`brand-name font-serif text-xl tracking-wide text-stone-700 ${compact ? 'text-lg' : ''}`}>CS Litoral Serviços</span></div>
}
function Nav({ page, setPage }: { page: Page; setPage: (page: Page) => void }) {
  return <nav className="space-y-1">{pages.map((item) => <button key={item.name} onClick={() => setPage(item.name)} className={`button-nav flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left text-sm ${page === item.name ? 'button-nav-active' : ''}`}><span className="w-5 text-center text-lg">{item.icon}</span>{item.name}</button>)}</nav>
}
function Metric({ label, value, icon, tint, detail }: { label: string; value: string; icon: string; tint: string; detail: string }) {
  const colors: Record<string, string> = { sand: 'bg-[#f3eee4] text-[#9f7945]', sage: 'bg-[#edf2ed] text-[#718a77]', rose: 'bg-[#f5eeeb] text-[#a37b68]', gold: 'bg-[#f6f0df] text-[#a8863d]' }
  return <article className="rounded-[20px] border border-stone-200/70 bg-white p-4 sm:p-5"><div className="flex items-center justify-between gap-2"><p className="text-[11px] font-semibold leading-tight text-stone-500 sm:text-xs">{label}</p><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm ${colors[tint]}`}>{icon}</span></div><p className="financial-value mt-3 truncate text-xl font-semibold sm:text-2xl">{value}</p><p className="mt-1 truncate text-[10px] text-stone-400 sm:text-xs">{detail}</p></article>
}
function PageHeading({ title, subtitle, button, onClick }: { title: string; subtitle: string; button?: string; onClick?: () => void }) {
  return <div className="mb-6 flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-serif text-2xl">{title}</h2><p className="mt-1 text-sm font-semibold text-stone-500">{subtitle}</p></div>{button && <button onClick={onClick} className="button-primary rounded-full px-4 py-2.5 text-sm font-semibold">{button}</button>}</div>
}
function ServiceRow({ service, clientName, onOpen, onEdit, onDelete, compact = false }: { service: Service; clientName: string; onOpen?: () => void; onEdit: () => void; onDelete: () => void; compact?: boolean }) {
  return <div className={`flex items-center gap-3 border-t border-stone-100 px-4 py-4 first:border-0 sm:px-5 ${compact ? 'px-1 sm:px-1' : ''}`}><span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#f3eee4] text-[#9f7945]">◇</span><div className="min-w-0 flex-1">{onOpen ? <button type="button" onClick={onOpen} title="Ver parcelas e pagamentos" aria-label={`Ver pagamentos de ${service.description}`} className="button-link block max-w-full truncate text-left text-sm font-semibold">{service.description}</button> : <p className="truncate text-sm font-semibold">{service.description}</p>}<p className="truncate text-xs text-stone-500">{clientName} · {formatDate(service.date)} · {service.responsible === 'terceirizado' ? 'Terceirizado' : 'Próprio'}</p><p className="mt-1 text-[11px] text-stone-400">Lucro {money(profit(service))}{service.thirdPartyCost ? ` · Terceiro ${money(service.thirdPartyCost)}` : ''}{service.materialsCost ? ` · Materiais ${money(service.materialsCost)}` : ''}</p></div><div className="text-right"><p className="financial-value whitespace-nowrap text-sm font-semibold">{money(service.chargedAmount)}</p><p className="text-[10px] text-stone-400">cobrado</p></div><div className="hidden gap-1 sm:flex"><button type="button" onClick={onEdit} aria-label="Editar serviço" title="Editar serviço" className="button-icon grid h-9 w-9 place-items-center rounded-lg">✎</button><button type="button" onClick={onDelete} aria-label="Excluir serviço" title="Excluir serviço" className="button-icon grid h-9 w-9 place-items-center rounded-lg">×</button></div><div className="flex flex-col gap-1 sm:hidden"><button type="button" onClick={onEdit} aria-label="Editar serviço" className="button-icon grid h-8 w-8 place-items-center rounded-lg text-sm">✎</button><button type="button" onClick={onDelete} aria-label="Excluir serviço" className="button-icon grid h-8 w-8 place-items-center rounded-lg text-sm">×</button></div></div>
}
function QuickAction({ icon, title, description, onClick }: { icon: string; title: string; description: string; onClick: () => void }) {
  return <button onClick={onClick} className="button-card flex items-center gap-4 rounded-2xl border p-4 text-left"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#fff1e8] text-lg text-[#e85d0b]">{icon}</span><span><span className="block text-sm font-semibold">{title}</span><span className="mt-0.5 block text-xs text-stone-500">{description}</span></span><span className="ml-auto text-stone-400">→</span></button>
}
function EmptyState({ text }: { text: string }) { return <div className="px-4 py-9 text-center text-sm text-stone-400">{text}</div> }
function Avatar({ name }: { name: string }) { return <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#f3eee4] text-sm font-semibold text-[#9f7945]">{name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toLocaleUpperCase('pt-BR')}</span> }
function Summary({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-[#fbfaf7] px-2 py-3"><p className="truncate text-[10px] font-semibold uppercase tracking-wide text-stone-400">{label}</p><p className="financial-value mt-1 truncate text-sm font-semibold">{value}</p></div> }
function ServiceDetails({ service, userId, clientName, payments, notify, refreshData, onClose }: { service: Service; userId: string; clientName: string; payments: ServicePayment[]; notify: (message: string) => void; refreshData: () => Promise<void>; onClose: () => void }) {
  const clientPaid = payments.filter((payment) => payment.party === 'client').reduce((sum, payment) => sum + payment.amount, 0)
  const thirdPartyPaid = payments.filter((payment) => payment.party === 'thirdParty').reduce((sum, payment) => sum + payment.amount, 0)
  const isOutsourced = service.responsible === 'terceirizado'
  return <Modal title={service.description} onClose={onClose}>
    <p className="mb-4 text-sm text-stone-500">{clientName} · {formatDate(service.date)} · {service.responsible === 'terceirizado' ? 'Terceirizado' : 'Próprio'}</p>
    <div className={`mb-4 grid grid-cols-2 gap-2 text-center ${isOutsourced ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}><Summary label="Cobrado" value={money(service.chargedAmount)} /><Summary label="Recebido" value={money(clientPaid)} /><Summary label="Materiais" value={money(service.materialsCost ?? 0)} /><Summary label="Lucro" value={money(profit(service))} />{isOutsourced && <><Summary label="Custo terceiro" value={money(service.thirdPartyCost ?? 0)} /><Summary label="Pago terceiro" value={money(thirdPartyPaid)} /></>}</div>
    {!!service.materials?.length && <section className="mb-4 rounded-xl border border-stone-200/70 bg-white p-4"><h3 className="mb-2 font-serif text-lg">Materiais usados</h3><div className="divide-y divide-stone-100">{service.materials.map((material) => <div key={material.id} className="flex items-center justify-between gap-3 py-2 text-sm"><span className="truncate">{material.name}</span><span className="whitespace-nowrap font-semibold">{money(material.cost)}</span></div>)}</div><div className="mt-2 flex justify-between border-t border-stone-100 pt-3 text-sm font-semibold"><span>Total de materiais</span><span>{money(service.materialsCost ?? service.materials.reduce((sum, material) => sum + material.cost, 0))}</span></div></section>}
    <div className="space-y-4">
      {service.id && <PaymentLedger serviceId={service.id} userId={userId} party="client" title="Parcelas do cliente" total={service.chargedAmount} payments={payments} notify={notify} refreshData={refreshData} />}
      {service.id && service.responsible === 'terceirizado' && <PaymentLedger serviceId={service.id} userId={userId} party="thirdParty" title="Parcelas do terceirizado" total={service.thirdPartyCost ?? 0} payments={payments} notify={notify} refreshData={refreshData} />}
    </div>
    {service.observations && <p className="mt-4 whitespace-pre-wrap rounded-xl bg-[#f8f6f1] p-3 text-sm text-stone-600">{service.observations}</p>}
  </Modal>
}
function ReportChart({ billed, outsourced, materials, profit: serviceProfit }: { billed: number; outsourced: number; materials: number; profit: number }) {
  const maximum = Math.max(billed, outsourced, materials, serviceProfit, 1)
  const rows = [
    { label: 'Faturamento', value: billed, color: '#2B2F36' },
    { label: 'Terceirizados', value: outsourced, color: '#A7B1BE' },
    { label: 'Materiais', value: materials, color: '#A7B1BE' },
    { label: 'Lucro', value: serviceProfit, color: '#2B2F36' },
  ]
  return <section className="mt-5 rounded-xl border border-stone-200/70 bg-white p-5"><h3 className="font-serif text-lg">Composição financeira</h3><div role="img" aria-label="Gráfico de faturamento, custos terceirizados, materiais e lucro" className="mt-4 space-y-4">{rows.map((row) => <div key={row.label} className="grid grid-cols-[96px_1fr_auto] items-center gap-3 text-sm"><span>{row.label}</span><div className="h-2.5 overflow-hidden rounded-full bg-[#E6E9EF]"><div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, row.value / maximum * 100))}%`, backgroundColor: row.color }} /></div><strong className="financial-value whitespace-nowrap">{money(row.value)}</strong></div>)}</div></section>
}

export default App