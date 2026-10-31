# Dados para métricas

Novos pedidos usam `schemaVersion: 2`. Os dados completos ficam em `orders/{orderId}`; o histórico fica em `orders/{orderId}/events/{eventId}`. A tela pública continua recebendo somente nome, status e data de criação.

## Dimensões de cada pedido

| Campo | Uso |
| --- | --- |
| `eventId` | Separar eventos, sem depender do nome da cafeteria. |
| `timeZone` | Converter os horários UTC do Firestore para o horário do evento. |
| `isTest` | Excluir ensaios dos relatórios reais. |
| `channel` | Origem do pedido; atualmente `web`. |
| `createdAt` | Demanda por dia, hora, intervalo de 15 minutos e dia da semana. |
| `itemCount` / `lineCount` | Bebidas por pedido / combinações diferentes por pedido. |
| `hasNotes` | Percentual de pedidos com observações. |
| `orderValueCents` / `currency` | Valor informativo do cardápio, quando todos os preços são conhecidos. |
| `historyComplete` / `historyStartedAt` | Distinguir o histórico completo de registros antigos acompanhados apenas a partir desta versão. |

Em `menu.js`, configure `eventSettings.id`, `timeZone` e `isTest`. Use `isTest: true` durante ensaios e `false` no evento. Os valores são copiados para o pedido; mudar o cardápio não altera pedidos anteriores.

## Dimensões de cada bebida

| Campo em `items[]` | Uso |
| --- | --- |
| `id` | Combinação específica adicionada ao carrinho. |
| `baseId` | Item do cardápio: por exemplo, `latte` ou `iced-latte` (recomendação). |
| `productId` / `productName` | Receita canônica. O latte comum e a recomendação contam juntos como `latte` quando desejado. |
| `name` / `category` | Nomes e categoria no momento do pedido. |
| `qty` | Quantidade real de bebidas; some este campo para calcular popularidade. |
| `options.temperature` | `quente` ou `gelado`. |
| `options.syrup` | `baunilha` ou `cumaru`, quando aplicável. |
| `optionLabels` | Rótulos apresentados ao cliente. |
| `featured` | Identifica a recomendação da noiva. |
| `unitPriceCents` / `currency` | Preço unitário em centavos no momento do pedido. `null` significa preço desconhecido, e não gratuidade. |

A recomendação é sempre gelada com Cumaru e entra com um único toque, sem seleção. O latte comum mantém as quatro combinações.

## Tempos e histórico

Todos os horários operacionais usam `serverTimestamp()`, não o relógio do iPad/celular.

| Intervalo | Cálculo no primeiro ciclo |
| --- | --- |
| Espera na fila | `preparationStartedAt - createdAt` |
| Preparo | `readyAt - preparationStartedAt` |
| Espera para retirada | `deliveredAt - readyAt` |
| Tempo total | `deliveredAt - createdAt` |

O pedido também guarda `updatedAt`, `cycle`, `reopenCount`, `lastReopenedAt`, `statusRevision` e `lastEventId`.

Cada evento de histórico tem `type`, `revision`, `fromStatus`, `toStatus`, `at`, `actorUid` e `cycle`. Na criação, `actorUid` é `null`; nas mudanças de status, identifica o barista. O ID do pedido é obtido pelo caminho do documento do evento.

Ao reabrir, o ciclo é incrementado e os três horários de preparo/retirada do resumo voltam a `null`. Os eventos do ciclo anterior permanecem intactos. Para tempos por ciclo, use o evento que entrou em `pending` como início daquele ciclo. Para a experiência total do cliente, use a criação original até a entrega final.

As mudanças são transações: pedido, evento e acompanhamento são gravados juntos. Uma ação baseada em status antigo é rejeitada, evitando duplicidade quando dois baristas clicam ao mesmo tempo. As regras impedem editar ou apagar eventos pelo aplicativo e exigem horários do servidor e revisão sequencial.

## Relatórios possíveis

- Bebidas e combinações mais pedidas, somando `qty`.
- Participação de quentes/gelados, Baunilha/Cumaru e recomendação da noiva.
- Pedidos e bebidas por hora/15 minutos; horário de pico.
- Média, mediana e percentil 90 de fila, preparo, retirada e tempo total.
- Bebidas por pedido, combinações frequentes no mesmo pedido e proporção de observações.
- Pedidos iniciados/finalizados por barista, usando o evento da etapa correspondente.
- Taxa de reabertura e tempo por ciclo de atendimento.
- Evolução da fila e quantidade simultânea em preparo, reconstruídas pelos eventos.

Conte cada `orderId` uma vez nas métricas de demanda, mesmo se houver reabertura. Separe demanda criada de pedidos efetivamente entregues. Use o histórico de todos os pedidos na análise: o limite de 200 do painel operacional não é o total do banco.

## Limites dos dados

Pedidos antigos continuam utilizáveis. Seus horários anteriores não são reconstruídos: ao mudar de status pela primeira vez nesta versão, recebem `historyComplete: false` e horários apenas das etapas efetivamente registradas. Intervalos com algum horário ausente devem ficar desconhecidos; não os preencha com zero nem com `updatedAt`.

Não trate o nome como identificador único de cliente. Não existe medição de tempo de navegação ou abandono antes do envio. Valores do cardápio são informativos: não comprovam pagamento nem receita recebida. Os tempos refletem os cliques do barista; marcarem as etapas no momento correto é essencial.

Publique o `firestore.rules` atualizado antes do deploy e recarregue as telas. O histórico novo e os dados completos continuam acessíveis somente aos baristas autorizados.
