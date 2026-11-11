export interface Client {
  id?: string
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
  id?: string
  clientId: string
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
  id?: string
  serviceId: string
  party: 'client' | 'thirdParty'
  amount: number
  date: string
  note: string
}
