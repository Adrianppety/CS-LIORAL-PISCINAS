# CS Litoral Serviços

Aplicativo para gerenciar clientes, serviços e parcelas de pagamentos, com login por nome de usuário e senha e armazenamento no Supabase. Depois do login, os dados são sincronizados com a nuvem e cada conta acessa apenas seus próprios registros.

## Configuração

Siga [BACKEND_PLANEJADO.md](BACKEND_PLANEJADO.md) para criar o projeto Supabase, executar as migrações, publicar a Edge Function de autenticação e configurar as variáveis de ambiente. O app precisa de `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`; use somente a chave pública `anon`/`publishable` no frontend, nunca `service_role`.

O login não usa e-mail e não oferece recuperação de senha por e-mail. Para contas Supabase já existentes, siga as instruções de vinculação de usuário no guia antes de entrar com o novo formulário.

## Executar localmente

Copie `.env.example` para `.env.local`, configure as variáveis do Supabase e execute:

```sh
npm install
npm run dev
```

## Backups

Use **Exportar** e **Importar** no cabeçalho do aplicativo para baixar ou mesclar um backup JSON. A importação atualiza registros com IDs iguais, acrescenta os novos e preserva os registros que não estão no arquivo.

Dados de instalações antigas que ainda estejam no IndexedDB do navegador não são migrados automaticamente para o Supabase.

## Build

```sh
npm run build
```
