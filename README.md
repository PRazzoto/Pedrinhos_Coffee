# Café do Evento — pedidos em tempo real

Sistema mínimo para um evento: **um iPad faz pedidos** e **um celular acompanha a fila**.
Não há pagamentos, estoque nem servidor próprio. HTML/CSS/JS + Firebase Authentication e Cloud Firestore. O deploy usa um script Node.js sem dependências para gerar a configuração do Firebase.

## Como usar a interface

- No iPad/computador, use os botões **+ / −** ao lado das bebidas. O resumo fica ao lado do cardápio.
- Para o latte, toque em **+**: primeiro aparece a temperatura; depois da escolha, o xarope; por último, **Adicionar ao pedido**. A recomendação da noiva abre direto no xarope, pois é sempre gelada. Cada combinação fica separada no pedido; ajuste suas quantidades no resumo.
- No celular, adicione as bebidas e toque em **Ver meu pedido** para revisar e informar seu nome. Feche a revisão para voltar ao cardápio.
- Observações são opcionais: toque em **Observações** quando precisar.
- Depois de enviar, aguarde a confirmação e retire no balcão. **Fazer outro pedido** limpa a tela para o próximo cliente.
- No painel do barista, avance cada pedido por **Começar preparo → Marcar pronto → Confirmar entrega**. Em cada etapa, os pedidos mais antigos aparecem primeiro.

## 1. Ajuste o cardápio

Edite `menu.js`: nome da cafeteria, categorias, bebidas, descrições e preços (deixe `price: null` para ocultar).

## 2. Crie o projeto no Firebase

1. Acesse https://console.firebase.google.com/ e crie um projeto.
2. No projeto, adicione um **aplicativo Web** (ícone `</>` no console). Para uso local, copie `firebase-config.example.js` para `firebase-config.js` e preencha os valores do objeto `firebaseConfig`, preservando os exports existentes. Esse arquivo local é ignorado pelo Git. Não copie imports como `from "firebase/app"`: este projeto carrega o SDK pelo CDN.
3. Em **Build > Authentication > Sign-in method**, habilite **Anonymous** (clientes) e **Email/Password** (barista).
4. Em **Authentication > Users**, crie manualmente um usuário com seu e-mail e uma senha forte. Copie o **UID** deste usuário.
5. Em **Build > Firestore Database**, crie um banco de dados. Escolha uma região próxima e configure em modo de produção.
6. Abra **Firestore Database > Rules**, cole o conteúdo de `firestore.rules`, substitua `COLE_AQUI_O_UID_DO_BARISTA` pelo UID copiado e clique em **Publish**.

**ATENÇÃO:** Não publique as regras sem trocar o UID. Não configure `allow read, write: if true`.
As chaves em `firebase-config.js` identificam o projeto, mas não são credenciais secretas; as regras protegem os dados.

## 3. Teste no computador

Sirva esta pasta com um servidor HTTP local (abrir os arquivos com `file://` não basta):

```bash
python -m http.server 8080
```

- Cliente: http://localhost:8080/
- Barista: http://localhost:8080/barista.html

Abra a tela barista em outra janela, entre com o e-mail e a senha, faça um pedido na tela cliente e confirme que aparece na fila.
Teste também mudar para **Preparando → Pronto → Entregue**.

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

- Só o usuário com UID configurado nas regras pode ler e atualizar os pedidos.
- Visitantes podem criar pedidos com autenticação anônima; não podem ler a fila.
- Para um evento privado e pequeno, é intencionalmente simples. Quem tiver o link pode enviar pedidos, então não compartilhe a URL indiscriminadamente. A proteção anti-spam é básica e não é adequada a uma operação pública de alto volume.
- O painel carrega os últimos **200 pedidos** por data de criação. Para eventos maiores, amplie esse limite ou use paginação.
- Os valores exibidos no cliente são informativos; **não há cobrança/pagamento integrado**.

### Referências oficiais

- Autenticação anônima: https://firebase.google.com/docs/auth/web/anonymous-auth
- Regras de segurança: https://firebase.google.com/docs/firestore/security/rules-conditions
- Listeners em tempo real: https://firebase.google.com/docs/firestore/query-data/listen
