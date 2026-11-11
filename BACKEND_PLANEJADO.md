# Backend Supabase

O aplicativo usa Supabase Auth e PostgreSQL. Os clientes, serviços, materiais e parcelas são armazenados na nuvem e associados à conta autenticada. O Row Level Security (RLS) limita as consultas e alterações ao proprietário dos dados.

## Preparar um projeto Supabase

1. Crie um projeto no [Supabase](https://supabase.com/).
2. No painel do projeto, abra **SQL Editor**, crie uma consulta e execute o conteúdo de `supabase/migrations/202611110001_initial_schema.sql`.
3. Em **Project Settings → API**, copie a **Project URL** e a chave pública **anon** (ou **publishable**). Nunca use a chave `service_role` no aplicativo.
4. Em **Authentication → URL Configuration**, configure a URL pública do app como **Site URL**. Durante o desenvolvimento local, adicione `http://localhost:5173` às **Redirect URLs**.

## Executar localmente

Na raiz do repositório, copie `.env.example` para `.env.local` e substitua os exemplos:

```env
VITE_SUPABASE_URL=https://SEU_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=SUA_CHAVE_PUBLICA_ANON_OU_PUBLISHABLE
```

Depois execute:

```sh
npm install
npm run dev
```

As variáveis `VITE_` são incluídas no frontend. Somente a URL e a chave pública do Supabase devem ser usadas aqui; a proteção dos dados é feita pelo login, RLS e políticas SQL.

## Configurar no Vercel

1. Abra o projeto no Vercel e vá a **Settings → Environment Variables**.
2. Crie `VITE_SUPABASE_URL` com a Project URL e `VITE_SUPABASE_ANON_KEY` com a chave pública `anon`/`publishable`.
3. Marque os ambientes em que o app será usado: **Production**, **Preview** e/ou **Development**.
4. Salve e faça um novo deploy para que o build receba as variáveis.
5. Se o login por e-mail usar confirmação, configure a URL do domínio de produção no **Site URL** do Supabase e inclua as URLs locais e de preview necessárias em **Redirect URLs**.

Não publique nem configure a chave `service_role` no Vercel para este frontend.

## Importar e exportar

Os botões **Exportar** e **Importar** ficam no cabeçalho depois do login. A exportação baixa um backup JSON versionado. A importação aceita arquivos de até 10 MB e mescla por ID: atualiza os registros correspondentes e inclui os novos, mantendo os demais registros da conta. A importação ocorre em uma chamada SQL transacional; se houver dados incompatíveis, ela é rejeitada sem aplicar parcialmente o arquivo.

Os registros antigos do IndexedDB/Dexie do navegador **não são migrados automaticamente**. Antes de configurar o Supabase, mantenha qualquer cópia local de que precise; a interface conectada à nuvem não lê esses dados.

## Estrutura e segurança

- `clients`, `services`, `service_materials` e `service_payments` são tabelas protegidas por RLS.
- `save_service` grava o serviço e seus materiais atomicamente.
- `import_backup` mescla os dados do arquivo na conta autenticada e substitui qualquer `owner_id` fornecido pelo backup pelo usuário atual.
- As funções RPC usam `SECURITY INVOKER`; a autorização continua sujeita às políticas RLS.
