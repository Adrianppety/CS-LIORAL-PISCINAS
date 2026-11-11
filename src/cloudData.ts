import type { Client, Service, ServiceMaterial, ServicePayment } from './db'
import { supabase } from './supabaseClient'

export interface CloudData {
  clients: Client[]
  services: Service[]
  servicePayments: ServicePayment[]
}

export interface DataBackup extends CloudData {
  format: 'cs-litoral-backup'
  version: 1
  exportedAt: string
}

function getClient() {
  if (!supabase) throw new Error('Supabase não está configurado.')
  return supabase
}

export async function loadCloudData(userId: string): Promise<CloudData> {
  const client = getClient()
  const [clientsResult, servicesResult, materialsResult, paymentsResult] = await Promise.all([
    client.from('clients').select('id,name,phone,email,address,notes,created_at').eq('owner_id', userId).order('name'),
    client.from('services').select('id,client_id,description,date,responsible,charged_amount,third_party_cost,materials_cost,observations').eq('owner_id', userId).order('date', { ascending: false }),
    client.from('service_materials').select('id,service_id,name,cost').eq('owner_id', userId),
    client.from('service_payments').select('id,service_id,party,amount,date,note').eq('owner_id', userId).order('date'),
  ])
  for (const result of [clientsResult, servicesResult, materialsResult, paymentsResult]) {
    if (result.error) throw result.error
  }

  const materialsByService = new Map<string, ServiceMaterial[]>()
  for (const material of materialsResult.data ?? []) {
    const materials = materialsByService.get(material.service_id) ?? []
    materials.push({ id: material.id, name: material.name, cost: Number(material.cost) })
    materialsByService.set(material.service_id, materials)
  }

  return {
    clients: (clientsResult.data ?? []).map((client) => ({
      id: client.id,
      name: client.name,
      phone: client.phone,
      email: client.email ?? '',
      address: client.address ?? '',
      notes: client.notes ?? '',
      createdAt: client.created_at,
    })),
    services: (servicesResult.data ?? []).map((service) => ({
      id: service.id,
      clientId: service.client_id,
      description: service.description,
      date: service.date,
      responsible: service.responsible,
      chargedAmount: Number(service.charged_amount),
      thirdPartyCost: Number(service.third_party_cost),
      materialsCost: Number(service.materials_cost),
      materials: materialsByService.get(service.id) ?? [],
      observations: service.observations ?? '',
    })),
    servicePayments: (paymentsResult.data ?? []).map((payment) => ({
      id: payment.id,
      serviceId: payment.service_id,
      party: payment.party,
      amount: Number(payment.amount),
      date: payment.date,
      note: payment.note ?? '',
    })),
  }
}

export async function saveClient(userId: string, draft: Omit<Client, 'id' | 'createdAt'>, id?: string) {
  const client = getClient()
  const values = {
    name: draft.name,
    phone: draft.phone,
    email: draft.email,
    address: draft.address,
    notes: draft.notes,
    updated_at: new Date().toISOString(),
  }
  const result = id
    ? await client.from('clients').update(values).eq('id', id).eq('owner_id', userId).select('id').single()
    : await client.from('clients').insert({ ...values, owner_id: userId }).select('id').single()
  if (result.error) throw result.error
}

export async function saveService(draft: Omit<Service, 'id'>, id?: string) {
  const client = getClient()
  const { error } = await client.rpc('save_service', {
    p_service_id: id ?? null,
    p_client_id: draft.clientId,
    p_description: draft.description,
    p_date: draft.date,
    p_responsible: draft.responsible,
    p_charged_amount: draft.chargedAmount,
    p_third_party_cost: draft.thirdPartyCost,
    p_materials_cost: draft.materialsCost,
    p_observations: draft.observations,
    p_materials: (draft.materials ?? []).map(({ name, cost }) => ({ name, cost })),
  })
  if (error) throw error
}

export async function exportCloudData(userId: string): Promise<DataBackup> {
  const data = await loadCloudData(userId)
  return {
    format: 'cs-litoral-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    ...data,
  }
}

export async function importCloudData(backup: DataBackup) {
  const { error } = await getClient().rpc('import_backup', {
    p_clients: backup.clients,
    p_services: backup.services,
    p_payments: backup.servicePayments,
  })
  if (error) throw error
}

export async function savePayment(userId: string, payment: Omit<ServicePayment, 'id'>, id?: string) {
  const client = getClient()
  const values = {
    service_id: payment.serviceId,
    party: payment.party,
    amount: payment.amount,
    date: payment.date,
    note: payment.note,
  }
  const result = id
    ? await client.from('service_payments').update(values).eq('id', id).eq('owner_id', userId).select('id').single()
    : await client.from('service_payments').insert({ ...values, owner_id: userId }).select('id').single()
  if (result.error) throw result.error
}

export async function deletePayment(userId: string, id: string) {
  const { error } = await getClient().from('service_payments').delete().eq('id', id).eq('owner_id', userId)
  if (error) throw error
}

export async function deleteService(userId: string, id: string) {
  const { error } = await getClient().from('services').delete().eq('id', id).eq('owner_id', userId)
  if (error) throw error
}

export async function deleteClient(userId: string, id: string) {
  const { error } = await getClient().from('clients').delete().eq('id', id).eq('owner_id', userId)
  if (error) throw error
}
