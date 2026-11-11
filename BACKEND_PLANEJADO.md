# Backend Supabase

O aplicativo usa Supabase Auth e PostgreSQL. Os clientes, serviços, materiais e parcelas são armazenados na nuvem e associados à conta autenticada. O Row Level Security (RLS) limita as consultas e alterações ao proprietário dos dados.

## Preparar um projeto Supabase

1. Crie um projeto no [Supabase](https://supabase.com/).
2. No painel do projeto, abra **SQL Editor**, crie uma consulta e execute o conteúdo de `supabase/migrations/202611110001_initial_schema.sql`.
3. Em **Project Settings → API**, copie a **Project URL** e a chave pública **anon** (ou **publishable**). Nunca use a chave `service_role` no aplicativo.
4. Execute também `supabase/migrations/202611110002_username_auth.sql` no **SQL Editor**.
5. Em **Authentication → Sign In / Providers → Email**, desative a confirmação de e-mail. Os usuários não informam um e-mail; a função de autenticação usa um endereço técnico interno que não recebe mensagens.
6. Configure a Edge Function e publique-a conforme os passos abaixo.

### Publicar a função de login

Instale e autentique a [Supabase CLI](https://supabase.com/docs/guides/cli) e vincule o projeto. Na raiz do repositório, configure a chave administrativa apenas como secret da função e publique-a:

```sh
supabase login
supabase link --project-ref SEU_PROJECT_ID
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=SUA_CHAVE_SECRETA
supabase functions deploy username-auth
```

`SUPABASE_SERVICE_ROLE_KEY` dá acesso administrativo ao projeto: configure-a somente nos secrets das Edge Functions do Supabase. Nunca coloque essa chave em `.env.local`, no Vercel ou no frontend. A função usa esse privilégio no servidor para localizar a conta pelo nome de usuário; as senhas são validadas pelo Supabase Auth.

### Vincular uma conta existente

As contas que já usavam e-mail continuam existindo, e seus dados permanecem associados aos mesmos IDs. Para entrar nelas com nome de usuário, um administrador deve vincular cada conta uma vez pelo **SQL Editor**. Primeiro identifique o ID da conta e depois insira o nome desejado:

```sql
select id, email from auth.users;

insert into public.username_accounts (username, user_id)
values ('seu_usuario', 'UUID_DA_CONTA');
```

Use um nome único de 3 a 24 caracteres: letras sem acento, números, ponto, hífen ou sublinhado. A tabela não concede acesso de leitura ou escrita ao cliente público.

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
5. Configure a URL pública do app como **Site URL** do Supabase e inclua as URLs locais e de preview necessárias em **Redirect URLs**.

Não publique nem configure a chave `service_role` no Vercel para este frontend.

## Login por nome de usuário

O cadastro e o login aceitam nome de usuário e senha, sem campo de e-mail. O Supabase Auth exige um identificador compatível com e-mail, então a Edge Function cria endereços técnicos no domínio reservado `.invalid`; eles não representam caixas postais. O nome de usuário é mantido numa tabela privada e a senha nunca é armazenada por essa tabela nem enviada a serviços além do Supabase Auth.

Não há recuperação de senha por e-mail. Se a senha for perdida, o administrador precisará redefini-la pelo painel do Supabase. Não remova nem altere os endereços técnicos das contas novas manualmente.

## Importar e exportar

Os botões **Exportar** e **Importar** ficam no cabeçalho depois do login. A exportação baixa um backup JSON versionado. A importação aceita arquivos de até 10 MB e mescla por ID: atualiza os registros correspondentes e inclui os novos, mantendo os demais registros da conta. A importação ocorre em uma chamada SQL transacional; se houver dados incompatíveis, ela é rejeitada sem aplicar parcialmente o arquivo.

Os registros antigos do IndexedDB/Dexie do navegador **não são migrados automaticamente**. Antes de configurar o Supabase, mantenha qualquer cópia local de que precise; a interface conectada à nuvem não lê esses dados.

## Estrutura e segurança

- `clients`, `services`, `service_materials` e `service_payments` são tabelas protegidas por RLS.
- `save_service` grava o serviço e seus materiais atomicamente.
- `import_backup` mescla os dados do arquivo na conta autenticada e substitui qualquer `owner_id` fornecido pelo backup pelo usuário atual.
- As funções RPC usam `SECURITY INVOKER`; a autorização continua sujeita às políticas RLS.
