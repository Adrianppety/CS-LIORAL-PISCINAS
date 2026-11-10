import Dexie, { type EntityTable } from 'dexie'

export interface Client {
  id?: number
  name: string
  phone: string
  email: string
  address: string
  notes: string
  createdAt: string
}

export interface ServiceMaterial {
  id: string
  name: string
  cost: number
}

export interface Service {
  id?: number
  clientId: number
  description: string
  date: string
  responsible: 'proprio' | 'terceirizado'
  chargedAmount: number
  thirdPartyCost: number
  materialsCost: number
  materials?: ServiceMaterial[]
  observations: string
}

export interface ServicePayment {
  id?: number
  serviceId: number
  party: 'client' | 'thirdParty'
  amount: number
  date: string
  note: string
}

class ServicesDatabase extends Dexie {
  clients!: EntityTable<Client, 'id'>
  services!: EntityTable<Service, 'id'>
  servicePayments!: EntityTable<ServicePayment, 'id'>

  constructor() {
    super('atelie-vendas')
    this.version(4).stores({ clients: '++id, name, createdAt', services: '++id, clientId, date, responsible' }).upgrade(async (transaction) => {
      const legacyClients = await transaction.table('clients').toArray() as Array<Partial<Client> & { id: number }>
      const migratedClients: Client[] = legacyClients.map((client) => ({
        id: client.id,
        name: client.name ?? '',
        phone: client.phone ?? '',
        createdAt: client.createdAt ?? new Date().toISOString(),
        email: client.email ?? '',
        address: client.address ?? '',
        notes: client.notes ?? '',
      })) as Client[]
      await transaction.table('clients').bulkPut(migratedClients)
    })
    this.version(5).stores({ servicePayments: '++id, serviceId, party, date' })
  }
}

export const db = new ServicesDatabase()