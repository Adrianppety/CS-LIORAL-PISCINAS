# CS Litoral Serviços

Aplicativo para gerenciar clientes, serviços e parcelas de pagamentos, com autenticação e armazenamento no Supabase. Depois do login, os dados são sincronizados com a nuvem e cada conta acessa apenas seus próprios registros.

## Configuração

Siga [BACKEND_PLANEJADO.md](BACKEND_PLANEJADO.md) para criar o projeto Supabase, executar a migração SQL e configurar as variáveis de ambiente localmente e no Vercel. Em resumo, o app precisa de `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`; use somente a chave pública `anon`/`publishable`, nunca `service_role`.

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
