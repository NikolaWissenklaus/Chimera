# 🐲 Chimera

**Monitor de tracking em tempo real para o console do navegador.**
Uma única injeção mostra as três camadas do rastreamento ao mesmo tempo: o que o site empurra, o que o GTM processa e o que sai pela rede para o GA4.

```
┌─────────────┐      ┌─────────────┐      ┌──────────────┐
│  SITE       │      │  GTM        │      │  GA4         │
│  dataLayer  │ ───► │  tags       │ ───► │  /g/collect  │
└─────────────┘      └─────────────┘      └──────────────┘
      📥                    🏷️                    📡
   dl.push()             gtm_tag              request
   (amarelo)              (azul)               (verde)
```

---

## Índice

- [Por que existe](#por-que-existe)
- [Instalação](#instalação)
- [As três camadas](#as-três-camadas)
- [Comandos](#comandos)
- [Como ler os logs](#como-ler-os-logs)
- [O decodificador de requisições GA4](#o-decodificador-de-requisições-ga4)
- [Receitas de debug](#receitas-de-debug)
- [Arquitetura técnica](#arquitetura-técnica)
- [Limitações conhecidas](#limitações-conhecidas)
- [Troubleshooting](#troubleshooting)
- [Histórico](#histórico)

---

## Por que existe

Quando um evento não aparece no GA4, a pergunta real é **onde ele morreu**. São três fronteiras possíveis, e cada uma tem uma causa diferente:

| Onde quebrou | Sintoma no Chimera | Causa provável |
|---|---|---|
| O site não disparou | nada em 📥 `dl.push()` | bug no front, listener não anexado, elemento não existe |
| O site disparou, o GTM ignorou | 📥 sim, 🏷️ não | trigger errado, condição de exceção, tag pausada |
| O GTM disparou, a rede não saiu | 🏷️ sim, 📡 não | consent mode bloqueando, ad blocker, erro na tag |
| A rede saiu com dado errado | 📡 sim, com valor torto | variável do GTM mal mapeada, dataLayer com tipo errado |

Sem ver as três juntas, você chuta. Com elas na mesma timeline e numeradas em sequência, o ponto de falha fica óbvio em segundos.

O Chimera nasceu da fusão de três scripts separados (`kitsune.js`, `zapdos.js`, `huldra.js`), que exigiam três colagens no console, tinham código duplicado e nenhuma noção de ordem entre si.

---

## Instalação

O Chimera é um script de console. Ele não precisa de build, dependência ou permissão, só de um lugar para rodar.

### Opção 1, Colar no console (rápido, para um teste pontual)

1. Abra o site, pressione `F12` → aba **Console**.
2. Cole todo o conteúdo de `chimera.js` e dê `Enter`.

> Em alguns navegadores, na primeira vez que você cola algo no console, é preciso digitar `allow pasting` e dar `Enter` antes.

**Importante:** o script morre a cada navegação. Marque **Preserve log** no console se quiser manter o histórico visível ao trocar de página, mas você terá que colar de novo para continuar monitorando.

### Opção 2, Snippet do DevTools (recomendado no dia a dia)

1. `F12` → aba **Sources** → painel lateral **Snippets** → **New snippet**.
2. Nomeie `chimera` e cole o conteúdo do arquivo.
3. Para rodar: `Ctrl+Enter` (ou clique com o botão direito → Run).

Fica salvo no seu navegador e roda em qualquer site com dois cliques.

### Opção 3, Userscript (monitoramento contínuo)

Com Tampermonkey ou Violentmonkey, envolva o arquivo em um header de userscript com `@run-at document-start`. Assim o Chimera sobe **antes** do GTM e captura desde o primeiro push da página, inclusive o `page_view` inicial, que é justamente o que mais escapa nas outras opções.

### Onde rodar mais cedo importa

Quanto antes o Chimera entra, mais ele vê. Colar no console depois da página carregada significa perder os pushes iniciais em tempo real, mas eles ainda estão no array, então `chimera.dl()` recupera o histórico.

---

## As três camadas

### 📥 `dl.push()`, amarelo

Intercepta `window.dataLayer.push`. Mostra tudo que o site (ou o próprio GTM) empurra para a camada de dados, com os objetos expandidos em árvore navegável.

Cobre também chamadas via `gtag()`, que internamente fazem push de um objeto `arguments`, elas aparecem rotuladas como `gtag(event, purchase)` em vez de um push sem nome.

**Detalhe que importa:** o log guarda um *snapshot* congelado do objeto. Se o site mutar aquele objeto depois do push (acontece mais do que se imagina), o console continua mostrando o valor real do momento do disparo, não o valor de agora.

### 🏷️ `gtm_tag`, azul

Escuta a fila interna do GTM (`window.google_tag_manager[…]`), onde ficam as mensagens que as tags de configuração e de evento processaram. É a prova de que o GTM **reagiu** ao push, não só de que o push existiu.

Mostra o tipo de disparo (`event`, `config`, `get`…), o nome do evento, o Measurement ID de destino e todos os parâmetros anexados pela tag, em árvore.

Essa é a camada que revela problemas de mapeamento: o dataLayer trouxe `valor_total`, mas a tag mandou `value` vazio porque a variável do GTM aponta para o lugar errado.

### 📡 `request`, verde

Intercepta as requisições de rede do GA4 (`/g/collect` e `/j/collect`) em `fetch`, `navigator.sendBeacon` e `XMLHttpRequest`, e **decodifica** o payload, que em estado natural é uma sopa de query string ilegível.

É a verdade final: o que realmente saiu do navegador em direção ao Google.

---

## Comandos

Todos vivem no objeto global `chimera`.

| Comando | O que faz |
|---|---|
| `chimera.help()` | lista os comandos no console |
| `chimera.dl()` | despeja o histórico completo do `dataLayer` atual, em árvore |
| `chimera.gtm()` | despeja o histórico interno de tags já processadas pelo GTM |
| `chimera.req()` | tabela resumida dos hits GA4 capturados nesta sessão |
| `chimera.filter('purchase')` | só loga eventos cujo nome contém o texto (case-insensitive) |
| `chimera.filter(/^view_/)` | aceita RegExp para casos mais precisos |
| `chimera.filter(null)` | remove o filtro |
| `chimera.pause()` | para de logar, mas mantém os hooks e a contagem ativos |
| `chimera.resume()` | volta a logar |
| `chimera.stats()` | tabela de contagem por evento, separada nas três camadas |
| `chimera.retryGTM()` | força nova tentativa de conexão ao GTM |
| `chimera.off()` | remove todos os hooks e restaura a página ao estado original |
| `chimera.version` | versão em execução |

Os nomes antigos continuam funcionando como atalhos: `chimera.kitsune()` → `dl()`, `chimera.zapdos()` → `gtm()`, `chimera.huldra()` → `req()`.

Os comandos que retornam `api` são encadeáveis: `chimera.filter('add_to_cart').resume()`.

### Diferença entre histórico e tempo real

Vale entender de onde vem cada histórico, porque isso muda o que você vê:

- `chimera.dl()` lê o **array `window.dataLayer` real**. Traz tudo, inclusive o que aconteceu antes do Chimera subir.
- `chimera.gtm()` lê a **fila real do GTM**. Mesma coisa: histórico completo, independente de quando você injetou.
- `chimera.req()` lê o **buffer interno do Chimera** (últimos 300 hits). Requisições de rede não ficam guardadas em nenhum array da página, então só aparece o que o Chimera capturou desde a injeção.

O `filter` e o `pause` valem para os logs em tempo real. Os três comandos de histórico ignoram ambos de propósito, quando você pede o histórico, você quer o histórico inteiro.

---

## Como ler os logs

Cada linha em tempo real segue a mesma anatomia:

```
📥 dl.push(): add_to_cart  #14 [14:32:07.881]
│  │           │            │    │
│  │           │            │    └── horário com milissegundos
│  │           │            └── nº sequencial global (as 3 camadas compartilham)
│  │           └── nome do evento
│  └── rótulo da camada (colorido)
└── ícone da camada
```

**O contador sequencial é a peça mais útil do conjunto.** Como as três camadas compartilham a mesma numeração, a ordem dos `#` conta a história do evento:

```
📥 dl.push(): purchase   #41   ← o site disparou
🏷️ gtm_tag: purchase     #42   ← o GTM reagiu
📡 request: purchase     #43   ← saiu para o GA4  ✅ fluxo completo
```

```
📥 dl.push(): purchase   #41   ← o site disparou
                               ← ...e nada mais aconteceu  ❌ morreu no GTM
```

Dentro de cada grupo colapsado, valores vêm com cor por tipo: **azul** para chaves, laranja para strings, **verde** para números, **vermelho itálico** para `null`/`undefined`/booleanos. Arrays e objetos aninhados viram subgrupos navegáveis, e listas de produtos mostram o `item_name` já no título do grupo, você identifica o item sem precisar abrir.

---

## O decodificador de requisições GA4

Essa é a parte que mais economiza tempo. Um hit de `purchase` sai do navegador assim:

```
v=2&tid=G-XXXXXXX&cid=1234.5678&en=purchase&ep.transaction_id=A1B2&epn.value=299.9
&pr1=idSKU123~nmSmart%20TV%2050~brSamsung~caEletronicos~pr1499.9~qt1~cpFRETEGRATIS
```

O Chimera transforma isso em:

```
📡 request: purchase | ID: G-XXXXXXX  #43 [14:32:08.104] (Beacon)
  👤 Identificação e Usuário
     ▪ cid (Client ID): 1234.5678
  🎯 Dados do Evento
     ▪ en: purchase
     ▪ ep.transaction_id: A1B2
     ▪ epn.value: 299.9
  🛒 Produtos do E-commerce (1 itens)
     📦 pr1: Smart TV 50
        ▪ item_id: SKU123
        ▪ item_name: Smart TV 50
        ▪ item_brand: Samsung
        ▪ item_category: Eletronicos
        ▪ price: 1499.9
        ▪ quantity: 1
        ▪ coupon: FRETEGRATIS
  ⚙️ Outros Parâmetros
     ▪ v (versão do protocolo): 2
```

### Os quatro grupos

| Grupo | O que agrupa |
|---|---|
| 👤 **Identificação e Usuário** | `cid`, `uid`, `sid` e todas as user properties (`up.`, `upn.`) |
| 🎯 **Dados do Evento** | o nome (`en`) e os parâmetros do evento, texto (`ep.`) e numéricos (`epn.`) |
| 🛒 **Produtos do E-commerce** | os itens `pr1`, `pr2`, `pr3`… decodificados em objetos legíveis |
| ⚙️ **Outros Parâmetros** | parâmetros de protocolo, sessão, consent e página |

Os produtos são ordenados numericamente de verdade, `pr2` vem antes de `pr10`, não depois, como aconteceria numa ordenação alfabética.

### Tradução dos códigos de item

O formato `pr` do GA4 usa prefixos de duas letras. O Chimera traduz todos os padrões:

| | | | | | |
|---|---|---|---|---|---|
| `id` → item_id | `nm` → item_name | `br` → item_brand | `af` → affiliation | `pr` → price | `qt` → quantity |
| `ca` → item_category | `c2`…`c5` → item_category2…5 | `ds` → discount | `cp` → coupon | `lo` → location_id | `cu` → currency |
| `li` → item_list_id | `ln` → item_list_name | `lp` → index | `va` → item_variant | `pi` → promotion_id | `pn` → promotion_name |
| `cn` → creative_name | `cs` → creative_slot | | | | |

Parâmetros customizados de item também são resolvidos: o GA4 os codifica em pares `k0`/`v0` (chave e valor), e o Chimera remonta o nome real em vez de mostrar códigos soltos.

### Glossário de protocolo

Parâmetros crípticos vêm com tradução no próprio log, `sid (Session ID)`, `_et (tempo de engajamento (ms))`, `_ss (início de sessão)`, `gcs (consent status)`, `_fv (primeira visita)`, `sct (nº de sessões)`, entre outros. Você para de precisar de uma segunda aba com a documentação do Measurement Protocol aberta.

### Requisições em lote

O GA4 agrupa vários eventos num único POST, separados por quebra de linha no body. O Chimera desmembra o lote e loga **cada evento separadamente**, replicando em todos os parâmetros comuns que vieram na URL. Um lote de 4 eventos gera 4 logs legíveis, não um bloco único.

---

## Receitas de debug

### "Meu evento não chega no GA4"

```js
chimera.filter('nome_do_evento')   // corta o ruído
// reproduza a ação na página
```

Veja quantas das três camadas apareceram. O ponto onde a sequência para é o ponto de falha, consulte a [tabela do início](#por-que-existe).

### "O valor da compra está errado no relatório"

Compare as três camadas do mesmo evento, na ordem:

1. 📥 o `value` já está errado no push? → problema no front-end.
2. 🏷️ o push está certo mas a tag mandou errado? → variável do GTM mal mapeada.
3. 📡 a tag está certa mas o `epn.value` saiu diferente? → transformação na própria tag ou no server-side.

### "O evento está disparando duas vezes"

```js
chimera.stats()
```

A contagem por camada mostra onde nasceu a duplicidade. Duplicado já no 📥 é o site chamando duas vezes. Um push só, mas duas tags, é trigger duplicado no GTM. Uma tag só, mas dois requests, geralmente é retry de rede ou duas configurações de destino.

### "Preciso auditar o e-commerce de uma página"

```js
chimera.filter(/view_item|add_to_cart|begin_checkout|purchase/)
```

Percorra o funil e confira, em cada etapa, se os itens chegam completos na camada 📡, é lá que faltam `item_brand`, `item_category` e afins.

### "Quero conferir o que já rolou antes de eu abrir o console"

```js
chimera.dl()    // tudo que o site empurrou desde o carregamento
chimera.gtm()   // tudo que o GTM processou
```

### "O console está poluído demais"

```js
chimera.pause()    // silencia, mas continua contando
// navegue até o ponto que interessa
chimera.resume()
```

---

## Arquitetura técnica

### Estratégia de interceptação

O Chimera não usa polling de estado nem `MutationObserver`. Ele envolve os pontos de saída reais, sempre chamando o original primeiro e logando depois, o comportamento da página não muda.

| Alvo | Técnica | Por quê |
|---|---|---|
| `dataLayer.push` | wrapper + guard periódico | o GTM sobrescreve esse método ao carregar |
| fila do GTM | wrapper após descoberta por polling | a fila só existe depois do GTM inicializar |
| `window.fetch` | wrapper | caminho principal do GA4 moderno |
| `navigator.sendBeacon` | wrapper | usado no `visibilitychange`/unload |
| `XMLHttpRequest` | wrapper em `open` + `send` | fallback de navegadores e configs antigas |

### O guard do dataLayer

Este é o detalhe que faz o monitoramento sobreviver ao carregamento do GTM. Quando o `gtm.js` sobe, ele substitui `dataLayer.push` pela própria implementação, e um wrapper ingênuo simplesmente desaparece nesse momento, silenciosamente, sem erro nenhum.

O Chimera reaplica o hook a cada segundo, por cima do que estiver lá, marcando o próprio wrapper com uma flag (`__chimera`) para nunca se envolver duas vezes. O efeito colateral é positivo: você passa a ver também os pushes que o **próprio GTM** faz (`gtm.dom`, `gtm.load`, `gtm.click`), o que é excelente para depurar triggers automáticos.

### Descoberta do GTM

A fila interna do GTM não tem caminho documentado nem estável. O Chimera varre `window.google_tag_manager` procurando o primeiro array cujo primeiro elemento tem a propriedade `message`, assinatura que identifica a fila independente do ID do contêiner.

O polling roda a cada 500ms por até 30 segundos. Se estourar, avisa no console e para (em vez de girar para sempre em segundo plano). `chimera.retryGTM()` tenta de novo, se o GTM subir mais tarde.

### Extração de corpo de requisição

O GA4 envia o payload em formatos diferentes conforme o contexto. O Chimera lida com todos: `string`, `Blob`, `URLSearchParams`, `ArrayBuffer`/`TypedArray` e `Request` com body (via `clone()`, para não consumir o stream original).

O caso do `Blob` merece destaque, é o formato mais comum em `sendBeacon`, e ler `Blob` exige uma operação assíncrona. Os scripts originais só liam string e perdiam esses hits em silêncio.

### Renderização em árvore

Uma única função recursiva serve as três camadas, com duas proteções: limite de profundidade (8 níveis) e detecção de referência circular via `WeakSet`. Objetos de dataLayer no mundo real às vezes carregam referências a elementos do DOM ou ao próprio `window`, sem essas guardas, o log entra em loop e trava a aba.

### Estado e memória

Um único objeto centraliza pausa, filtro, contador sequencial, contagens por evento e histórico. O buffer de requisições é limitado a **300 entradas** (FIFO), suficiente para uma sessão de debug longa, sem risco de vazar memória numa aba deixada aberta a tarde inteira.

### Reversibilidade

Cada hook registra sua própria função de desfazer. `chimera.off()` limpa os timers, executa todas elas e desmarca a flag de ativo, a página volta ao estado original, sem reload. Colar o script duas vezes também é seguro: a segunda injeção detecta a primeira e avisa, em vez de empilhar wrappers e duplicar todos os logs.

### Nenhum erro do monitor quebra a página

Todos os pontos de interceptação envolvem o log em `try/catch` e chamam o método original **fora** dele. Se o Chimera falhar ao decodificar algo, ele reclama no console e a requisição segue normalmente. Um script de debug nunca deve ser a causa de um bug em produção.

---

## Limitações conhecidas

Coisas que valem saber antes de concluir que "não está capturando":

- **Até 1 segundo de cegueira no `dl.push()`** se o GTM sobrescrever o método logo depois de um ciclo do guard. Pushes nessa janela não aparecem em tempo real, mas continuam recuperáveis via `chimera.dl()`, porque o array em si não se perde.
- **Logs de `Beacon` podem sair levemente fora de ordem.** Ler `Blob` é assíncrono, então o `#` sequencial daquele hit é atribuído alguns milissegundos depois. A ordem relativa entre camadas continua correta na prática, mas em disparos muito próximos pode haver inversão.
- **Só GA4.** O filtro de rede é `/g/collect` e `/j/collect`. Meta Pixel, Floodlight, Criteo e afins não são capturados. Adicionar é trivial: amplie a regex `GA4_URL_RE`.
- **Só client-side.** Em setups com GTM server-side, o Chimera vê o hit saindo do navegador para o seu endpoint, o que acontece depois, no servidor, está fora de alcance.
- **Ad blockers vencem o Chimera.** Se a extensão bloqueia a requisição antes do `fetch`, não há o que interceptar. Ausência de 📡 com 🏷️ presente pode ser bloqueio, não bug, teste numa janela sem extensões antes de abrir um ticket.
- **Injeção tardia perde o começo.** `page_view` inicial e eventos de carregamento acontecem antes de você colar o script. Use a opção de userscript com `@run-at document-start` se precisar deles em tempo real.
- **`chimera.off()` restaura `window.fetch` para o valor original capturado na injeção.** Se outro script envolveu `fetch` depois do Chimera, esse wrapper de terceiros é descartado no desligamento. Em ambiente de debug isso é inofensivo, mas fica registrado.

---

## Troubleshooting

**`chimera is not defined`**
O script não rodou por completo. Recole e confira se não há erro em vermelho logo acima. No Chrome, pode ser a proteção de colagem, digite `allow pasting`, dê `Enter` e tente de novo.

**"Já está ativa nesta página"**
Guard de dupla injeção funcionando. Rode `chimera.off()` e injete de novo, ou apenas siga usando a instância que já está no ar.

**"GTM não encontrado após 30s"**
Ou o site não usa GTM, ou o contêiner ainda não carregou, ou nenhuma tag foi processada até agora (a fila só nasce no primeiro disparo). Interaja com a página e rode `chimera.retryGTM()`.

**As três camadas silenciosas**
Verifique se está pausado (`chimera.resume()`) e se há filtro ativo (`chimera.filter(null)`).

**Vejo 📥 e 🏷️, mas nunca 📡**
Nessa ordem de probabilidade: ad blocker ativo, consent mode negando o envio, ou tag com erro interno. Confira a aba Network filtrando por `collect`, se lá também não aparece nada, o problema é anterior ao Chimera.

**O console travou depois de um push gigante**
Objeto muito grande ou aninhado além do limite. As guardas de profundidade e circularidade evitam o pior, mas um array com milhares de itens ainda pesa. Use `chimera.filter()` para reduzir o volume.

---

## Histórico

### v1.1, nomenclatura funcional

Os codinomes deram lugar a rótulos que dizem o que a camada é:

| Antes | Agora | Cor | Ícone |
|---|---|---|---|
| `kitsune` | `dl.push()` | amarelo `#ffe600` | 📥 |
| `zapdos` | `gtm_tag` | azul `#2f9bff` | 🏷️ |
| `huldra` | `request` | verde `#09ff00` | 📡 |

Cores e ícones ficam centralizados no objeto `MODULES`, no topo do arquivo, um lugar só para reestilizar tudo. Os comandos passaram a `chimera.dl()`, `.gtm()` e `.req()`, com os nomes antigos mantidos como atalhos.

### v1.0, a fusão

Unificação de `kitsune.js`, `zapdos.js` e `huldra.js` num só script, com correções que iam além da junção:

**Bugs corrigidos**

- 🔴 **`sendBeacon` com `Blob` era ignorado**, a maior falha do conjunto. O GA4 usa `Blob` na maioria dos hits, e o código original só lia strings. Uma fatia enorme das requisições nunca era logada, sem nenhum aviso.
- 🔴 **O hook do `dataLayer` morria quando o GTM carregava**, silenciosamente. Resolvido com o guard periódico.
- 🟡 **Logs mostravam objetos mutados depois do push**, não o estado real do disparo. Resolvido com snapshot.
- 🟡 **Polling infinito do GTM** rodava para sempre quando o contêiner não existia.
- 🟡 **Pushes de `gtag()`** apareciam como "push (Sem Nome)".
- 🟡 **Sem proteção contra referência circular**, um objeto com referência ao DOM travava a aba.

**Ganhos de capacidade**

- Contador sequencial compartilhado entre as três camadas, que é o que torna possível ler o fluxo como uma linha do tempo única.
- Captura de `XMLHttpRequest` e de `Request` com body no `fetch`.
- Mapa de itens ampliado com `coupon`, `affiliation`, `location_id` e os campos de promoção.
- Glossário de tradução dos parâmetros de protocolo.
- Comandos novos: `filter`, `pause`, `resume`, `stats`, `off`, `help`.
- Guard de dupla injeção e desligamento reversível completo.
- Árvore recursiva única no lugar de três implementações duplicadas, a do GTM, em particular, só expandia um nível de profundidade.
