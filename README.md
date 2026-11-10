# CS Litoral Serviços

Aplicativo frontend para gerenciar clientes e serviços prestados. Os registros ficam no IndexedDB do navegador, gerenciado pelo Dexie, e permanecem disponíveis após atualizar ou fechar o aplicativo.

## Executar localmente

```sh
npm install
npm run dev
```

## Dados locais

Cadastros de clientes e serviços são armazenados apenas neste navegador e neste dispositivo. Limpar os dados do site no navegador remove esses registros. A aplicação não usa login, servidor, API externa ou sincronização em nuvem.

O banco atual contém `clients`, `services` e `servicePayments`. Cada serviço pode guardar várias linhas de materiais (descrição e valor); o total é somado automaticamente e entra no cálculo do lucro junto ao custo terceirizado. As parcelas ficam ligadas ao serviço e identificam separadamente o pagador (`client` ou `thirdParty`). Ao atualizar uma instalação anterior, os clientes locais são preservados e enriquecidos com campos de contato; as tabelas antigas de produtos, vendas e pagamentos são removidas na migração do IndexedDB.

Consulte [BACKEND_PLANEJADO.md](BACKEND_PLANEJADO.md) para a documentação de uma possível evolução futura.

## Build

```sh
npm run build
```