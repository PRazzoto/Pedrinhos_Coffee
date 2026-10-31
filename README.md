# Café do Evento — pedidos em tempo real

Sistema mínimo para um evento: **um iPad faz pedidos** e **um celular acompanha a fila**.
Não há pagamentos, estoque nem servidor próprio. HTML/CSS/JS + Firebase Authentication e Cloud Firestore. O deploy usa um script Node.js sem dependências para gerar a configuração do Firebase.

## Como usar a interface

- No iPad/computador, use os botões **+ / −** ao lado das bebidas. O resumo fica ao lado do cardápio.
- Para o latte, toque em **+**: primeiro aparece a temperatura; depois da escolha, o xarope; por último, **Adicionar ao pedido**. A recomendação da noiva é um iced latte com Cumaru: toque em **+** para adicionar direto. Cada combinação fica separada no pedido; ajuste suas quantidades no resumo.
- No celular, adicione as bebidas e toque em **Ver meu pedido** para revisar e informar seu nome. Feche a revisão para voltar ao cardápio.
- Observações são opcionais: toque em **Observações** quando precisar.
- Depois de enviar, aguarde a confirmação e retire no balcão. **Fazer outro pedido** limpa a tela para o próximo cliente.
- No painel do barista, avance cada pedido por **Começar preparo → Marcar pronto → Confirmar entrega**. Em cada etapa, os pedidos mais antigos aparecem primeiro.
- Abra **Acompanhar** para ver a tela dos convidados: **Na fila**, **Preparando** e **Prontos para retirar**. Ela não exige e-mail/senha e mostra apenas nomes e status. Os pedidos entregues saem automaticamente da tela.

## Ativar o acompanhamento e o segundo barista

1. No Firebase, abra **Firestore Database > Rules**, substitua todo o editor pelo conteúdo atualizado de `firestore.rules` e clique em **Publish**. Os dois UIDs informados já estão na lista de `isBarista()`.
2. Publique as regras **antes de usar esta versão do site**: cada pedido grava também um resumo em `orderStatus` e um evento de histórico em `orders/{orderId}/events`.
3. Faça o deploy atualizado do site e recarregue as telas de pedidos e do barista.
4. Abra `/acompanhamento.html` no celular, tablet ou TV. Não é necessário criar a coleção manualmente.
5. Entre no painel do barista uma vez para sincronizar pedidos antigos. Depois, novos pedidos e mudanças de status são gravados atomicamente nas duas coleções.

Para adicionar outro barista no futuro, crie o usuário em **Authentication > Users**, inclua o novo UID na lista de `isBarista()` e publique as regras novamente. Cadastrar apenas o e-mail não concede acesso aos pedidos.

## Métricas futuras

Os pedidos registram bebida/receita, temperatura, xarope, quantidade, destaque da noiva, evento, fuso horário, marcação de teste e o horário de cada etapa. As mudanças ficam em um histórico com o UID do barista, revisão sequencial e ciclos de reabertura.

Configure o evento e `isTest` em `eventSettings` no `menu.js`. O dicionário dos campos, as fórmulas e os cuidados com registros antigos estão em [METRICS.md](METRICS.md).

## 1. Ajuste o cardápio

Edite `menu.js`: nome da cafeteria, categorias, bebidas, descrições e preços (deixe `price: null` para ocultar).

## 2. Crie o projeto no Firebase

1. Acesse https://console.firebase.google.com/ e crie um projeto.
2. No projeto, adicione um **aplicativo Web** (ícone `</>` no console). Para uso local, copie `firebase-config.example.js` para `firebase-config.js` e preencha os valores do objeto `firebaseConfig`, preservando os exports existentes. Esse arquivo local é ignorado pelo Git. Não copie imports como `from "firebase/app"`: este projeto carrega o SDK pelo CDN.
3. Em **Build > Authentication > Sign-in method**, habilite **Anonymous** (clientes) e **Email/Password** (barista).
4. Em **Authentication > Users**, crie manualmente um usuário com seu e-mail e uma senha forte. Copie o **UID** deste usuário.
5. Em **Build > Firestore Database**, crie um banco de dados. Escolha uma região próxima e configure em modo de produção.
6. Abra **Firestore Database > Rules**, cole o conteúdo de `firestore.rules`, confira a lista de UIDs em `isBarista()` e clique em **Publish**.

**ATENÇÃO:** Não publique as regras sem trocar o UID. Não configure `allow read, write: if true`.
As chaves em `firebase-config.js` identificam o projeto, mas não são credenciais secretas; as regras protegem os dados.

## 3. Teste no computador

Sirva esta pasta com um servidor HTTP local (abrir os arquivos com `file://` não basta):

```bash
python -m http.server 8080
```

- Cliente: http://localhost:8080/
- Barista: http://localhost:8080/barista.html
- Acompanhamento: http://localhost:8080/acompanhamento.html

Abra a tela barista em outra janela, entre com o e-mail e a senha, faça um pedido na tela cliente e confirme que aparece na fila.
Teste também mudar para **Preparando → Pronto → Entregue**, conferindo que o acompanhamento muda de coluna e remove os pedidos entregues.

## 4. Publique na Vercel

1. Coloque o projeto em um repositório GitHub. Não inclua `firebase-config.js`, `.env` nem `dist/`: estão no `.gitignore`. Se o arquivo de configuração já estiver rastreado, execute `git rm --cached firebase-config.js` para parar de rastreá-lo sem apagar a cópia local.
2. Em https://vercel.com/new, importe o repositório e selecione **Framework Preset: Other**.
3. Antes do primeiro deploy, adicione estas variáveis em **Environment Variables**, usando os valores do seu `firebase-config.js` local:

   | Variável na Vercel | Campo da configuração |
   | --- | --- |
   | `FIREBASE_API_KEY` | `apiKey` |
   | `FIREBASE_AUTH_DOMAIN` | `authDomain` |
   | `FIREBASE_PROJECT_ID` | `projectId` |
   | `FIREBASE_APP_ID` | `appId` |

   `FIREBASE_STORAGE_BUCKET` e `FIREBASE_MESSAGING_SENDER_ID` são opcionais. Ative as variáveis nos ambientes que pretende usar (por exemplo, Production e Preview).
4. O arquivo `vercel.json` já define o comando de build `node scripts/build.mjs` e a pasta de saída `dist`. Não deixe o comando de build vazio. Não é necessário instalar pacotes npm.
5. Clique em **Deploy**. O build gera `dist/firebase-config.js` com as variáveis configuradas e publica apenas os arquivos do site. Se faltar uma variável obrigatória, o build falha indicando o nome dela.
6. Abra `https://SEU-PROJETO.vercel.app/` no iPad e `https://SEU-PROJETO.vercel.app/barista.html` no celular do barista.
7. Em **Firebase Authentication > Settings > Authorized domains**, adicione o hostname `SEU-PROJETO.vercel.app`.

Se alterar as variáveis na Vercel, faça um novo deploy. Elas não alteram deployments antigos.

Para testar o mesmo build localmente, copie `.env.example` para `.env`, preencha os valores e execute com Node.js 22 ou mais recente:

```bash
node --env-file=.env scripts/build.mjs
python -m http.server 8080 --directory dist
```

A configuração Web do Firebase continuará visível no navegador, pois o aplicativo precisa dela. Esse fluxo mantém a configuração fora do repositório; as regras do Firestore protegem os pedidos.

## 5. Antes do evento

- Envie 2–3 pedidos de teste de dispositivos diferentes, **com internet real**.
- Abra o painel no celular e pressione **Ativar som** uma vez; o áudio só funciona com o painel aberto e ativo (iOS e outros sistemas podem suspender páginas em segundo plano).
- Mantenha o celular carregado, a tela do painel aberta e a conexão estável.
- No iPad, ative **Acesso Guiado** nas configurações de acessibilidade para restringir o uso ao navegador.
- Confira o limite de dados do plano gratuito do Firebase e monitore o uso.
- O Firestore é a fonte da verdade: os pedidos persistem se o celular recarregar a página. Não há salvamento offline de pedidos não enviados.

## Segurança e limites

- Só os usuários com UID na lista de baristas podem ler e atualizar os pedidos completos.
- Visitantes podem criar pedidos com autenticação anônima e ler os nomes/status ativos em `orderStatus`. Eles não podem ler itens ou observações em `orders`, nem mudar os status.
- Para um evento privado e pequeno, é intencionalmente simples. Quem tiver o link pode enviar pedidos, então não compartilhe a URL indiscriminadamente. A proteção anti-spam é básica e não é adequada a uma operação pública de alto volume.
- O painel carrega os últimos **200 pedidos** por data de criação. O acompanhamento carrega até **200 pedidos ativos**. Para eventos maiores, amplie esse limite ou use paginação.
- Os valores exibidos no cliente são informativos; **não há cobrança/pagamento integrado**.

### Referências oficiais

- Autenticação anônima: https://firebase.google.com/docs/auth/web/anonymous-auth
- Regras de segurança: https://firebase.google.com/docs/firestore/security/rules-conditions
- Listeners em tempo real: https://firebase.google.com/docs/firestore/query-data/listen
