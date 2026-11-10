# Backend planejado

Este documento descreve uma possível evolução futura. Ele é apenas documentação: não instala, configura ou executa backend, API, autenticação ou sincronização no aplicativo atual.

## Estado atual dos dados

O frontend usa Dexie sobre IndexedDB. Os registros pertencem ao navegador e ao dispositivo onde foram criados; não há usuário ou identificador remoto.

- `clients`: `id` numérico local, `name`, `phone`, `email`, `address`, `notes` e `createdAt`.
- `services`: `id` numérico local, `clientId`, `description`, `date`, `responsible` (`proprio` ou `terceirizado`), `chargedAmount`, `thirdPartyCost`, `materialsCost`, `materials` (lista de `{ id, name, cost }`) e `observations`.
- `servicePayments`: `id` numérico local, `serviceId`, `party` (`client` ou `thirdParty`), `amount`, `date` e `note`. Várias parcelas podem pertencer ao mesmo serviço e cada parcela indica claramente a direção do pagamento.
- `services.clientId` referencia `clients.id`. O frontend calcula lucro como `chargedAmount - thirdPartyCost - materialsCost`; o custo terceirizado é zero para serviços próprios.
- `servicePayments.serviceId` referencia `services.id`. Os saldos recebidos e pagos a terceiros são calculados como a soma das parcelas de cada tipo; não são armazenados separadamente.

Valores monetários são armazenados como números em reais e datas como strings no formato `YYYY-MM-DD`. Uma futura API deve validar explicitamente formatos, limites e conversão monetária.

## Tabelas e relacionamentos

Uma primeira versão relacional pode usar:

- `users`: identidade, estado e datas de criação; cada registro de negócio pertence a um usuário/empresa.
- `clients`: UUID, `owner_id`, nome, telefone, e-mail, endereço, observações, `created_at` e `updated_at`.
- `services`: UUID, `owner_id`, `client_id`, descrição, data, responsável, valor cobrado, custo terceirizado, observações, `created_at` e `updated_at`.
- `service_materials`: UUID, `owner_id`, `service_id`, descrição, custo e data de criação, com uma linha para cada material usado no serviço.
- `service_payments`: UUID, `owner_id`, `service_id`, `party` (`client` ou `third_party`), valor, data do pagamento, observação e `created_at`.

Use chaves estrangeiras de `services.client_id` para `clients.id`, de `service_materials.service_id` e `service_payments.service_id` para `services.id` e de todas as tabelas para `users.id`. Índices recomendados: `(owner_id, name)` em clientes, `(owner_id, date)` e `(owner_id, client_id, date)` em serviços, e `(owner_id, service_id, party, date)` em parcelas. Defina uma política explícita para exclusão de clientes com histórico; a interface atual confirma a exclusão do cliente e dos serviços, materiais e parcelas em conjunto. O lucro e os saldos pagos podem ser calculados na consulta ou em uma view, sem duplicar os valores persistidos.

## API futura

Uma API HTTP autenticada pode oferecer `GET/POST/PATCH/DELETE /clients`, `GET/POST/PATCH/DELETE /services`, `GET/POST/PATCH/DELETE /services/{id}/payments` e `GET /reports/services`. Listagens devem aceitar paginação e filtros por `from`, `to` e `clientId`; o endpoint de relatório deve retornar agregados e os registros usados para calculá-los. Validar todas as entradas no servidor, aplicar autorização por proprietário em cada consulta, usar transações para exclusões relacionadas e retornar erros consistentes. A lógica de domínio deve ficar em uma camada de serviço; controladores HTTP não devem acessar diretamente componentes de tela.

## Conexão futura com banco de dados

Escolha PostgreSQL ou outro banco relacional gerenciado, mantenha migrações versionadas e conecte-o exclusivamente pelo backend. O cliente web deve chamar uma API com sessão/token de curta duração; credenciais administrativas e segredos nunca devem ser incluídos no bundle frontend. Planeje backups, auditoria, retenção e políticas de acesso antes de publicar dados de clientes.

## Migração do navegador para o servidor

1. Implementar exportação local versionada em JSON com clientes, serviços e parcelas, validando tamanho, tipos, IDs e referências.
2. No usuário autenticado, enviar o arquivo por um endpoint de importação em lote com chave de idempotência.
3. Criar um mapa entre os IDs locais e UUIDs do servidor; importar clientes, serviços e parcelas nessa ordem e remapear `clientId` e `serviceId`.
4. Executar a importação em transação, rejeitar referências inválidas e apresentar um resumo de registros criados, ignorados e com conflito.
5. Conferir contagens e totais financeiros localmente e remotamente antes de marcar a migração como concluída.
6. Manter o arquivo original para recuperação e só depois oferecer uma opção explícita para limpar os dados locais.

Para sincronização contínua, acrescente UUIDs estáveis, `updatedAt`, versão do registro e estado da fila local. Defina resolução de conflitos por entidade e torne cada operação idempotente; não presuma que timestamps isoladamente resolvem edições concorrentes.

## Autenticação e sincronização

Uma arquitetura futura deve autenticar pessoas por um provedor confiável e associar cada cliente e serviço a uma organização/conta. O backend valida a identidade, verifica autorização em todas as rotas e, idealmente, aplica isolamento também no banco. No frontend, separar um repositório local Dexie de um repositório HTTP por interfaces comuns; uma fila de operações com IDs idempotentes, tentativas limitadas e estado de conflito pode habilitar modo offline. Sincronização em tempo real é opcional e deve ser adicionada apenas se os requisitos multiusuário justificarem sua complexidade.