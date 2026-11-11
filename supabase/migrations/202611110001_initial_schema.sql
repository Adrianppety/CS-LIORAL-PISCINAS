create extension if not exists pgcrypto;

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  phone text not null default '',
  email text not null default '',
  address text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  client_id uuid not null,
  description text not null check (length(trim(description)) > 0),
  date date not null,
  responsible text not null check (responsible in ('proprio', 'terceirizado')),
  charged_amount numeric(12, 2) not null check (charged_amount >= 0),
  third_party_cost numeric(12, 2) not null default 0 check (third_party_cost >= 0),
  materials_cost numeric(12, 2) not null default 0 check (materials_cost >= 0),
  observations text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (client_id, owner_id) references public.clients (id, owner_id) on delete cascade
);

create table public.service_materials (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  service_id uuid not null,
  name text not null check (length(trim(name)) > 0),
  cost numeric(12, 2) not null check (cost >= 0),
  created_at timestamptz not null default now(),
  foreign key (service_id, owner_id) references public.services (id, owner_id) on delete cascade
);

create table public.service_payments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  service_id uuid not null,
  party text not null check (party in ('client', 'thirdParty')),
  amount numeric(12, 2) not null check (amount > 0),
  date date not null,
  note text not null default '',
  created_at timestamptz not null default now(),
  foreign key (service_id, owner_id) references public.services (id, owner_id) on delete cascade
);

create index clients_owner_name_idx on public.clients (owner_id, name);
create index services_owner_date_idx on public.services (owner_id, date);
create index services_owner_client_date_idx on public.services (owner_id, client_id, date);
create index service_materials_owner_service_idx on public.service_materials (owner_id, service_id);
create index service_payments_owner_service_party_date_idx on public.service_payments (owner_id, service_id, party, date);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger clients_set_updated_at
before update on public.clients
for each row execute function public.set_updated_at();

create trigger services_set_updated_at
before update on public.services
for each row execute function public.set_updated_at();

alter table public.clients enable row level security;
alter table public.services enable row level security;
alter table public.service_materials enable row level security;
alter table public.service_payments enable row level security;

create policy "Users manage their own clients"
on public.clients for all to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "Users manage their own services"
on public.services for all to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "Users manage their own service materials"
on public.service_materials for all to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "Users manage their own service payments"
on public.service_payments for all to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create function public.save_service(
  p_service_id uuid,
  p_client_id uuid,
  p_description text,
  p_date date,
  p_responsible text,
  p_charged_amount numeric,
  p_third_party_cost numeric,
  p_materials_cost numeric,
  p_observations text,
  p_materials jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_service_id uuid;
begin
  if v_owner_id is null then
    raise exception 'Authentication required';
  end if;

  if p_service_id is null then
    insert into public.services (
      owner_id, client_id, description, date, responsible,
      charged_amount, third_party_cost, materials_cost, observations
    ) values (
      v_owner_id, p_client_id, trim(p_description), p_date, p_responsible,
      p_charged_amount, p_third_party_cost, p_materials_cost, coalesce(p_observations, '')
    )
    returning id into v_service_id;
  else
    update public.services
    set client_id = p_client_id,
        description = trim(p_description),
        date = p_date,
        responsible = p_responsible,
        charged_amount = p_charged_amount,
        third_party_cost = p_third_party_cost,
        materials_cost = p_materials_cost,
        observations = coalesce(p_observations, '')
    where id = p_service_id and owner_id = v_owner_id
    returning id into v_service_id;

    if v_service_id is null then
      raise exception 'Service not found or access denied';
    end if;
  end if;

  delete from public.service_materials
  where service_id = v_service_id and owner_id = v_owner_id;

  insert into public.service_materials (owner_id, service_id, name, cost)
  select v_owner_id, v_service_id, trim(material.name), material.cost
  from jsonb_to_recordset(coalesce(p_materials, '[]'::jsonb)) as material(name text, cost numeric);

  return v_service_id;
end;
$$;

revoke all on function public.save_service(uuid, uuid, text, date, text, numeric, numeric, numeric, text, jsonb) from public, anon;
grant execute on function public.save_service(uuid, uuid, text, date, text, numeric, numeric, numeric, text, jsonb) to authenticated;

create function public.import_backup(
  p_clients jsonb,
  p_services jsonb,
  p_payments jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_client jsonb;
  v_service jsonb;
  v_material jsonb;
  v_payment jsonb;
  v_service_id uuid;
begin
  if v_owner_id is null then
    raise exception 'Authentication required';
  end if;

  for v_client in select value from jsonb_array_elements(coalesce(p_clients, '[]'::jsonb))
  loop
    insert into public.clients (id, owner_id, name, phone, email, address, notes, created_at)
    values (
      (v_client->>'id')::uuid, v_owner_id, trim(v_client->>'name'),
      coalesce(v_client->>'phone', ''), coalesce(v_client->>'email', ''),
      coalesce(v_client->>'address', ''), coalesce(v_client->>'notes', ''),
      coalesce((v_client->>'createdAt')::timestamptz, now())
    )
    on conflict (id) do update
    set name = excluded.name,
        phone = excluded.phone,
        email = excluded.email,
        address = excluded.address,
        notes = excluded.notes,
        updated_at = now();
  end loop;

  for v_service in select value from jsonb_array_elements(coalesce(p_services, '[]'::jsonb))
  loop
    insert into public.services (
      id, owner_id, client_id, description, date, responsible,
      charged_amount, third_party_cost, materials_cost, observations
    )
    values (
      (v_service->>'id')::uuid, v_owner_id, (v_service->>'clientId')::uuid,
      trim(v_service->>'description'), (v_service->>'date')::date,
      v_service->>'responsible', (v_service->>'chargedAmount')::numeric,
      (v_service->>'thirdPartyCost')::numeric, (v_service->>'materialsCost')::numeric,
      coalesce(v_service->>'observations', '')
    )
    on conflict (id) do update
    set client_id = excluded.client_id,
        description = excluded.description,
        date = excluded.date,
        responsible = excluded.responsible,
        charged_amount = excluded.charged_amount,
        third_party_cost = excluded.third_party_cost,
        materials_cost = excluded.materials_cost,
        observations = excluded.observations,
        updated_at = now();

    v_service_id := (v_service->>'id')::uuid;
    delete from public.service_materials
    where service_id = v_service_id and owner_id = v_owner_id;

    for v_material in select value from jsonb_array_elements(coalesce(v_service->'materials', '[]'::jsonb))
    loop
      insert into public.service_materials (id, owner_id, service_id, name, cost)
      values (
        coalesce((v_material->>'id')::uuid, gen_random_uuid()),
        v_owner_id, v_service_id, trim(v_material->>'name'), (v_material->>'cost')::numeric
      );
    end loop;
  end loop;

  for v_payment in select value from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb))
  loop
    insert into public.service_payments (id, owner_id, service_id, party, amount, date, note)
    values (
      (v_payment->>'id')::uuid, v_owner_id, (v_payment->>'serviceId')::uuid,
      v_payment->>'party', (v_payment->>'amount')::numeric,
      (v_payment->>'date')::date, coalesce(v_payment->>'note', '')
    )
    on conflict (id) do update
    set service_id = excluded.service_id,
        party = excluded.party,
        amount = excluded.amount,
        date = excluded.date,
        note = excluded.note;
  end loop;
end;
$$;

revoke all on function public.import_backup(jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.import_backup(jsonb, jsonb, jsonb) to authenticated;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.clients, public.services, public.service_materials, public.service_payments to authenticated;
