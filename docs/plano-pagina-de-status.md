# Plano: a página de status dos sistemas (API Agronomy, 23/11/2026)

> Cópia pública do plano do API Agronomy. Os endereços internos que tinham o nome da conta foram trocados por descrição.

Pedido do dono: «https://status.claude.com/ quero uma tela dessas pros sistemas tambem tem como?». Ele decidiu que a página é aberta aos clientes e feita por nós. O coordenador decidiu que ela fica fora dos sistemas: um repositório próprio na conta glivemusic, com a página no GitHub Pages e a checagem num cron do GitHub Actions a cada 5 min.

Este documento é só o plano: não criei repositório, não gravei nada nos dois repositórios e não mexi em produção.
- **[C]** é conferido no código. A leitura rodou em `claude -p` dentro de cada repositório, só com Read, Grep e Glob.
- **[S]** é suposição. **[D]** é a documentação pública do GitHub.
- `app/` é `basefertilapp/` e `ad/` é `agrodash/`.

## 0. Resumo

- **O desenho do coordenador vale, sem motivo forte contra.** Ele tem duas condições:
  - O repositório da página tem de ser **público**. Num repositório privado, o cron de 5 min custa caro e já houve falha de cobrança (§5, D1).
  - O cron do GitHub atrasa e às vezes pula execuções. Checagem que faltou conta como «sem dado», nunca como queda (§3).
- **O repositório da página não guarda segredo.** Ele só chama rotas públicas de saúde e nunca recebe o token de uma pessoa nem chave de banco.
- **Nenhum dos dois sistemas tem rota de saúde hoje** [C]:
  - O `app/static/sinal.txt` sai da CDN e não prova que o servidor responde (`app/src/lib/sinal.ts:91-92`).
  - O AgroDash só tem a `/data-health`, com login (`ad/src/routes/(app)/data-health/+page.server.ts:21-53`).
  - Por isso a primeira entrega são as duas rotas `GET /api/health`, pela esteira de cada repositório (§2).
- **O AgroDash ainda não tem produção.** O banco do painel é só de desenvolvimento (`ad/docs/arquitetura-dados.md:183-187`), e ele lê o develop do app (`ad/docs/decisoes/2026-11-18-login-do-app.md:6-19`). Uma página para clientes não pode mostrar o AgroDash como serviço até ele virar produto (D2).

## 1. Os componentes e como checar cada um

### 1.1 O que a página mostra ao cliente (produção)

| Linha na página (pt-BR / es-PY) | Vem de | Como se checa |
|---|---|---|
| **Agronomy Center: aplicativo** / **Agronomy Center: aplicación** | `componentes.servidor` de `https://basefertil.com/api/health` | Resposta 200 da rota em até 10 s. Já prova que a Vercel e a função respondem. |
| **Login e contas** / **Inicio de sesión y cuentas** | `componentes.login` da mesma rota | A rota chama o health do Auth do Supabase do app (§2.2). |
| **Dados dos talhões (banco)** / **Datos de los lotes (base de datos)** | `componentes.banco` da mesma rota | A rota faz uma leitura mínima no banco (§2.2, D3). |
| **AgroDash: painel** / **AgroDash: panel** | `https://<dominio-do-agrodash>/api/health` | Só entra quando o AgroDash tiver produção (D2). |
| **Integração Agronomy Center ↔ AgroDash** / **Integración Agronomy Center ↔ AgroDash** | sonda sem token nas duas APIs (§1.2) | Só entra junto com o AgroDash (D2). |

O domínio de produção do app é `basefertil.com` [C] (`app/docs/decisoes/versao-do-sistema.md:19-22`, `app/src/lib/numero-da-versao.ts:10-11`).

### 1.2 Como checar as duas APIs sem token

O repositório da página nunca guarda o token de uma pessoa. As duas APIs se checam pela recusa: um pedido sem `Authorization` precisa voltar **401 em JSON, rápido**. Isso prova que o servidor, o roteamento e a guarda estão vivos, sem tocar no banco.
- **app:/api/v1:** `GET /api/v1/me` sem token deve dar `401 {"estado":"sem-token"}`. O gancho lê a credencial (`app/…/api-painel-v1/src/lib/server/api-v1/gancho.ts:25`) antes de criar o cliente (`:32`) e de chamar o Auth (`:40`) [C, na worktree; ainda não está no `main`].
- **agrodash:/api/v1:** `GET /api/v1/plantings` sem token deve dar `401 {"error":"unauthorized"}` (`ad/docs/api-v1.md:134`). Ainda falta conferir na F1 que a guarda vem antes de qualquer ida ao banco (`ad/src/lib/server/api-v1.ts:67-92`) [S].
- **Resultado na linha «Integração»:**
  - fora do ar quando alguma das duas não responde ou dá 5xx;
  - degradado quando responde com outro status ou outro corpo;
  - operacional quando as duas dão o 401 esperado.

### 1.3 As integrações: fora da v1

Nenhuma integração entra na v1:
- **Azure Maps** (clima no app e no AgroDash) é cobrado por chamada e precisa de chave [C] (`app/src/lib/server/clima.ts:158,286`, `ad/src/lib/server/azure-clima.ts:182`). Checar a cada 5 min seria gastar cota só para olhar.
- **Copernicus** (NDVI no app) tem OAuth e cota própria [C] (`app/src/lib/server/copernicus.ts:41-44`, `teto-do-provedor.ts:44-67`).
- **John Deere** (AgroDash) precisa de credencial e ainda não é produto (`ad/src/lib/server/john-deere.ts:197`). No app, John Deere é só formato de arquivo, sem chamada de rede (`app/src/lib/server/setup-john-deere.ts:5-10`).
- **NASA POWER** e a **chuva por satélite (NASA IMERG)** só existem no AgroDash (`ad/src/lib/server/nasa-power.ts:176`, `nasa-imerg.ts:256`). O IMERG precisa de token. A chuva do radar no app é Azure.

**Para depois (v2): saúde passiva.** Cada sistema guarda a hora do último sucesso de cada fornecedor, a partir das chamadas que já faz para os clientes. A `/api/health` então devolve `clima: ok | degradado` pela idade desse último sucesso, sem chamada nova e sem gastar cota. Exceção que já se pode usar no AgroDash: `situacaoDaChaveDoImerg()` é local, sem rede (`ad/src/lib/server/nasa-imerg.ts:197`). Mas o vencimento de token é assunto interno, e não vai à página do cliente.

### 1.4 O que nunca aparece para o cliente

- **Endereços internos.** São o develop (`develop.basefertil.com`) e o endereço interno da hospedagem. O endereço do develop do AgroDash contém o nome da conta do dono e já aparece em `ad/docs/integracoes/john-deere-operations-center.md:464`. Os refs do Supabase também (`app/docs/deploy-migracoes.md:3-11`, `ad/src/lib/server/supabase-config.ts:26-29`).
- **Nomes técnicos e de fornecedor.** Nada de «Supabase», «Vercel», «Cloudflare», «Worker», `app:/api/v1` ou nomes de função `painel_*`. A página fala por serviço («Login e contas»), não por peça.
- **Detalhes de falha.** Fica de fora a versão do sistema, a mensagem de erro, o código interno, o tempo por componente, o vencimento de token e qualquer contagem (de usuários, de talhões, de pedidos).
- **Dados de cliente.** Nenhum nome de produtor, fazenda ou organização, nem em incidente escrito à mão: o texto do incidente diz o serviço, nunca quem foi afetado.
- **O AgroDash e a integração**, até ele ter produção (D2).
- **O ambiente develop.** A página é só de produção.

## 2. O contrato da rota de saúde (igual nos dois sistemas)

### 2.1 Caminho e resposta

- **Caminho e métodos:** `GET /api/health` e `HEAD /api/health`, com o caminho em inglês, como pede o item 17 da revisão. Fica fora da `/api/v1`, porque não é dado e não tem Bearer.
- **Recusas:**
  - Qualquer query string dá `400 {"estado":"pedido-invalido"}` sem rodar nenhuma checagem. Assim ninguém fura o cache com `?x=1`.
  - Outro método dá `405` com `Allow: GET, HEAD`.

**Resposta, sempre JSON e sempre o mesmo formato:**
```json
{
  "sistema": "agronomy-center",
  "estado": "ok",
  "verificado_em": "2026-11-23T21:00:00Z",
  "componentes": { "servidor": "ok", "login": "ok", "banco": "ok" }
}
```

**Os campos:**
- `sistema` é `agronomy-center` ou `agrodash`.
- `estado` é `ok`, `degradado` ou `fora`. É o pior entre os componentes, com uma regra: componente «não crítico» que cai rebaixa o `estado` só até `degradado`.
- `verificado_em` é a hora da checagem que gerou a resposta, que pode ter vindo do cache.

**O status HTTP:** `200` quando o `estado` é `ok` ou `degradado`, e `503` quando é `fora`. Assim um monitor simples já entende só pelo status.

**Os componentes por sistema:**

| Sistema | Componentes | O que cada um testa | Crítico? |
|---|---|---|---|
| app | `servidor` | a própria resposta | sim |
| app | `login` | `GET {SUPABASE_URL}/auth/v1/health` com a chave publicável, em até 2 s | sim |
| app | `banco` | uma ida mínima ao Postgres, sem ler tabela (D3), em até 2 s | sim |
| AgroDash | `servidor` | a própria resposta | sim |
| AgroDash | `banco` | uma leitura de 1 linha na tabela das estações, que é dado público (`ad/src/lib/server/banco-do-painel.ts:50-51,103-114`), em até 2 s | sim |
| AgroDash | `coletor` | a idade da última leitura das estações: mais de 45 min dá `degradado` (o coletor roda a cada 15 min, `ad/workers/coletor/wrangler.jsonc:11`) | não |
| AgroDash | `login` | o health do Auth do app (o login do AgroDash é o do app), em até 2 s | sim |

A regra se reaplica: componente novo é campo novo e fica na mesma rota, sem versão nova.

### 2.2 As regras de dentro

- **Sem login.** Ela não lê cookie nem chama `getUser`.
  - **No app:** ela sai no topo do hook, como `/api/csp` (`app/src/hooks.server.ts:84`). Ficar só em `PUBLIC_PATHS` não basta: o `getUser` roda antes da conferência de caminho público, em todo pedido (`app/src/hooks.server.ts:177-178`) [C].
  - **No AgroDash:** ela entra por caminho **exato**, não por prefixo, porque o `PUBLIC_PATHS` usa `startsWith` (`ad/src/lib/caminhos-publicos.ts:8-16`). E fica fora da lista `/api/v1`, que é só de rota com Bearer (`:23-26`). O `configuracaoDoApp()` roda em todo pedido (`ad/src/hooks.server.ts:39`). Isso é bom: com variável faltando, a saúde também cai, e é verdade.
- **Sem segredo para fora.** Nenhuma chave, URL de banco, ref, mensagem de erro ou pilha vai na resposta ou no log; o log leva só `[saude] <componente> <codigo>`. A checagem do AgroDash usa a chave do servidor que já existe, só dentro de `$lib/server/banco-do-painel*.ts` (`ad/docs/arquitetura-dados.md:54`). A do app usa só a chave publicável, sem `service_role` (`app/src/lib/server/supabase-config.ts:33-38`).
- **Sem dado de cliente.** Nenhuma consulta toca tabela com `organization_id`. No AgroDash, a tabela das estações é pública e não pertence a nenhuma organização (`ad/docs/decisoes/2026-11-18-estacoes-dmh.md:26`).
- **Não gasta o banco nem vira porta de ataque.**
  - **Cache de 30 s.** No app, `Cache-Control: public, max-age=0, s-maxage=30`, e a CDN da Vercel responde à enxurrada. No AgroDash, o `caches.default` guarda por 30 s. Assim, no máximo 2 checagens reais por minuto, venha o volume que vier.
  - **Tempo.** Cada checagem tem `AbortSignal` de 2 s, e a rota responde em até 3 s, sempre.
  - **Leve:** corpo com menos de 300 bytes, nenhuma chamada a fornecedor pago e nenhum parâmetro.
  - **Cabeçalhos:** `X-Robots-Tag: noindex`, sem CORS (quem chama é o servidor do Actions, nunca o navegador) e os cabeçalhos de segurança da casa (`app/src/lib/server/cabecalhos-de-seguranca.ts:46-55`).
- **Testes, no molde de cada repositório:**
  - no app, em `src/lib/` (`app/vite.config.ts:93-109`, molde em `app/src/lib/zonas-gerar-rota.test.ts:8-17`);
  - no AgroDash, a lógica em `$lib/server` e a rota de uma linha (`ad/src/routes/api/v1/plantings/+server.ts:8`).
- **O que os testes cobrem:**
  - `ok`, `degradado` e `fora`, com o 503;
  - o tempo estourado vira `fora` em até 3 s;
  - query dá 400, POST dá 405;
  - nem o corpo nem o log levam chave ou mensagem;
  - o `getUser` não é chamado (catraca de fonte no app);
  - o caminho exato não abre `/api/healthx` (AgroDash, no molde de `ad/src/lib/caminhos-publicos.test.ts:4-25`).
- **Revisão:** o `seguranca` é obrigatório nos dois, porque a mudança mexe no hook e em rota pública (`ad/docs/decisoes/2026-11-19-esteira-de-agentes.md:32-33`, `app/docs/esteira.md:22`).

## 3. O histórico e as regras

### 3.1 Quando uma checagem conta como fora, degradada ou operacional

O Actions chama cada endereço com tempo máximo de 10 s.
- **Falha:** erro de rede, tempo estourado, 5xx, corpo que não é o JSON do contrato, ou componente `fora`. Antes de contar a falha, a mesma execução tenta de novo depois de 20 s; só conta se falhar duas vezes.
- **Degradado:** 200 com `degradado`, ou resposta que levou mais de 5 s.
- **Operacional:** 200 com `ok` em até 5 s.
- **Sem dado:** a checagem que não rodou (cron atrasado ou pulado [D]). Não entra na conta da disponibilidade.

### 3.2 Quando abrir e fechar um incidente automático

- Abre como **fora do ar** depois de **2 falhas seguidas**, uns 10 min.
- Abre como **degradado** depois de **3 degradadas seguidas**, uns 15 min.
- Fecha depois de **2 checagens operacionais seguidas**.
- O início do incidente é a hora da primeira falha da série, e o fim é a hora da primeira checagem boa da série que o fechou.

### 3.3 A disponibilidade e as barras

- **Disponibilidade do dia:** checagens operacionais ou degradadas, divididas por todas as checagens feitas. Degradado conta como no ar, mas pinta a barra.
- **Disponibilidade de 90 dias:** a mesma conta somada nos 90 dias. A página mostra 2 casas (`99,95 %`).
- **O dia** é o de `America/Asuncion`, como no contrato das portas (`ad/docs/arquitetura-dados.md:89`).
- **A cor da barra do dia:**
  - verde, sem incidente;
  - amarela, com incidente degradado, ou fora do ar por menos de 30 min no dia;
  - vermelha, fora do ar por 30 min ou mais no dia;
  - cinza, com menos de 50 % das checagens do dia feitas.
- **Monitor atrasado.** Se a última checagem tem mais de 30 min, a página mostra «Monitoramento atrasado», em vez de afirmar que tudo está operacional.

### 3.4 Os arquivos

Os arquivos de dados ficam no ramo `dados` do repositório da página, separados do código, que mora no `main`:
- `estado.json`: o estado atual por linha, as contagens de falhas seguidas e o `verificado_em`.
- `dias.json`: `{ "<linha>": { "2026-11-23": { "feitas": 288, "ok": 281, "degradado": 5, "fora": 2, "minutos_fora": 10 } } }`, com 90 dias; o mais velho sai.
- `incidentes.json`: `[{ "id", "linhas": [...], "tipo": "fora|degradado", "inicio", "fim|null", "origem": "automatico|manual", "titulo": {"pt-BR","es-PY"}, "atualizacoes": [{ "em", "estado": "investigando|identificado|monitorando|resolvido", "texto": {"pt-BR","es-PY"} }] }]`. Guarda 1 ano.

**Os commits:** um por execução, no ramo `dados`, com `concurrency` para duas execuções não se cruzarem. Uma vez por dia, o ramo é recriado num commit só, para não acumular uns 100 mil commits por ano.

**O deploy do Pages** roda quando um incidente abre ou fecha, e fora isso a cada 15 min no máximo [S: confirmar o limite de deploy do Pages por Actions na F2].

**O cron:** `2-59/5 * * * *`, fora do minuto cheio, porque o GitHub atrasa e descarta execuções no começo da hora [D].

**A inatividade:** o cron de repositório público é desligado depois de 60 dias sem atividade [D]. O commit diário deve contar como atividade [S]. A página mostrar «Monitoramento atrasado» é a rede de segurança.

## 4. O texto da página e o incidente à mão

### 4.1 O idioma

O idioma sai de `?lang=pt-BR|es-PY` e, sem ele, de `navigator.language`. Um botão troca. Não há cookie nem rastreio: a página não tem nenhum script de terceiros.

### 4.2 Os textos

| Chave | pt-BR | es-PY |
|---|---|---|
| titulo | Situação dos sistemas | Estado de los sistemas |
| geral.ok | Todos os sistemas operacionais | Todos los sistemas operativos |
| geral.degradado | Alguns serviços estão lentos ou instáveis | Algunos servicios están lentos o inestables |
| geral.fora | Há serviços fora do ar | Hay servicios fuera de línea |
| geral.atrasado | Monitoramento atrasado: a última checagem tem mais de 30 minutos | Monitoreo atrasado: la última verificación tiene más de 30 minutos |
| linha.ok | Operacional | Operativo |
| linha.degradado | Instável | Inestable |
| linha.fora | Fora do ar | Fuera de línea |
| linha.sem_dado | Sem dados | Sin datos |
| barras.legenda | Últimos 90 dias | Últimos 90 días |
| barras.disponibilidade | {pct} de disponibilidade | {pct} de disponibilidad |
| barras.hoje | Hoje | Hoy |
| barras.dias_atras | Há {n} dias | Hace {n} días |
| barra.dica | {dia}: {pct} no ar · {minutos} min fora do ar | {dia}: {pct} en línea · {minutos} min fuera de línea |
| incidentes.titulo | Incidentes recentes | Incidentes recientes |
| incidentes.nenhum | Nenhum incidente nos últimos 90 dias | Ningún incidente en los últimos 90 días |
| incidente.investigando | Investigando | Investigando |
| incidente.identificado | Causa identificada | Causa identificada |
| incidente.monitorando | Monitorando | Monitoreando |
| incidente.resolvido | Resolvido | Resuelto |
| incidente.automatico | Detectado automaticamente às {hora}. | Detectado automáticamente a las {hora}. |
| incidente.duracao | Duração: {duracao} | Duración: {duracao} |
| rodape.atualizado | Atualizado às {hora} (horário do Paraguai) | Actualizado a las {hora} (hora de Paraguay) |
| rodape.contato | Algum problema que não aparece aqui? Fale com a equipe pelo canal de sempre. | ¿Algún problema que no aparece aquí? Hable con el equipo por el canal habitual. |

Os nomes das linhas estão em §1.1. Os textos são propostos; o revisor de cada idioma confere antes da F4.

### 4.3 O incidente à mão

O incidente à mão entra pelo **workflow «Incidente»** (`workflow_dispatch`). Por regra do GitHub, só quem tem escrita no repositório consegue rodá-lo. Os campos:
- `acao`: abrir, atualizar ou resolver;
- `id`: vazio ao abrir; ao atualizar, o do incidente;
- `linhas`: lista fechada das linhas de §1.1;
- `tipo`: fora ou degradado;
- `estado`: investigando, identificado, monitorando ou resolvido;
- `titulo_pt`, `titulo_es`, `texto_pt` e `texto_es`.

O workflow confere os campos, grava em `incidentes.json` e faz o deploy. Pode rodar pelo site do GitHub ou pelo app do celular [S: confirmar o celular na F2].

O incidente automático já nasce com o texto padrão nos dois idiomas, e o dono só precisa «atualizar» para pôr a causa.

As issues ficam **desligadas** no repositório: num repositório público, qualquer pessoa abriria uma.

## 5. O que precisa de decisão do dono

| # | Decisão | Recomendação | Por quê |
|---|---|---|---|
| D1 | Repositório **público** ou privado | **Público** | O runner do GitHub é grátis em repositório público [D]. Num privado, saem umas 8 640 execuções por mês contra US$ 18 de crédito do Pro [D], algo como US$ 30–50 por mês [S: conta aproximada]. E o app já teve falha de cobrança no Actions, tanto que o CI roda em runner próprio (`app/.github/workflows/ci.yml:58-80,121`). O runner próprio não serve para a página: Mac desligado viraria queda falsa. O público expõe o código da página, os endereços de produção (que já são públicos) e o histórico, e nenhum segredo, porque o repositório não tem nenhum. |
| D2 | O AgroDash e a integração entram quando | **Só quando o AgroDash tiver produção** | Hoje ele só existe em develop (`ad/docs/arquitetura-dados.md:179-187`), e o domínio próprio «se decide quando virar produto» (`ad/docs/decisoes/2026-11-18-nome-agrodash.md:12-13`). O endereço de hoje contém o nome da conta (o endereço do develop do AgroDash). |
| D3 | Como a saúde do app prova o banco | **Uma função `public.saude_do_banco()`** que devolve só `now()`, sem ler tabela, `stable`, com `execute` para o `anon`; é migração no app, pela esteira | O `anon` não lê tabela (`app/docs/decisoes/conexoes.md:1460`), e não se conserta isso «dando EXECUTE ao anon» (`:1684-1685`). Esta função não lê tabela nem devolve dado, mas é EXECUTE ao `anon`, então a palavra final é do coordenador. A alternativa sem migração é só o health do Auth, que **não** prova o Postgres [S]. |
| D4 | O endereço da página | `status.basefertil.com` | O CNAME vai para o Pages, e o DNS é do dono. Sem domínio próprio, fica `glivemusic.github.io/<repo>`, com o nome da conta à mostra. Atenção: `basefertil.com` também é o domínio da consultoria (`app/docs/decisoes/marca-agronomy-center.md:242`), e a marca é «Agronomy Center». O dono escolhe o domínio que o cliente reconhece. |
| D5 | O nome e o dono do repositório | Por exemplo `glivemusic/status`; o dono decide quem cuida | O repositório ainda não tem agente. Quem criar o repositório é o dono, ou alguém com a palavra dele. |
| D6 | Divulgar aos clientes | Só depois de 2 semanas no ar sem queda falsa | Assim se calibram os limites de §3 antes de o cliente ver. |

## 6. A ordem e quem faz

| Fase | O quê | Quem | Pronto quando |
|---|---|---|---|
| F0 | D1 a D5 | dono e coordenador | as decisões estão registradas |
| F1a | `GET /api/health` no app, com a D3 se aprovada | **Base Fértil**, pela esteira do app (com o `seguranca`) | testes de §2.2 verdes, em `develop.basefertil.com` |
| F1b | `GET /api/health` no AgroDash | **AgroDash**, pela esteira dele (com o `seguranca`) | testes verdes, no endereço do develop |
| F1c | conferência das duas rotas contra §2 (caminho, corpo, cache, tempo, sem segredo) | **API Agronomy**, no harness de cada repositório | relatório sem achado «bloqueia» |
| F2 | repositório novo: o workflow de checagem (§3) e o de incidente (§4.3), apontados para o **develop** | o agente que o coordenador escolher (D5) | uma semana de dados em develop |
| F3 | a página estática (§4) no Pages, sem framework e sem script de terceiros | o mesmo agente | as barras, o incidente e os dois idiomas conferidos na tela |
| F4 | apontar para a produção e ligar o domínio (D4) | o mesmo agente, mais o dono no DNS | o deploy do app com a F1a no `main` |
| F5 | 2 semanas de observação, depois divulgação | coordenador | D6 |
| depois | o AgroDash e a integração (D2); a saúde passiva das integrações (§1.3) | AgroDash, Base Fértil e API Agronomy | o AgroDash em produção |

Cada sistema implementa a rota de saúde só pela própria esteira; ninguém grava no repositório do outro (`ad/docs/decisoes/2026-11-18-o-crud-mora-no-agrodash.md:53`). A rota de saúde não é porta de dados e não muda essa regra.

## 7. O que não vi

- **Os painéis das plataformas:**
  - GitHub: o plano real da conta e o crédito restante;
  - Vercel: se a CDN guarda resposta de função com `s-maxage` neste projeto [S];
  - Cloudflare: o domínio real;
  - Supabase: o rate limit do Auth e se `/auth/v1/health` precisa de `apikey` [S].
- **Um teste prático:** o comportamento de `getUser()` sem cookie no `@supabase/ssr` [S], e se a guarda da `agrodash:/api/v1` responde 401 antes de qualquer ida ao banco [S].
- **Os limites do GitHub Pages:** os de deploy por Actions e o uso pelo celular [S].
- **A rede:** não chamei nenhum endereço; tudo veio do código e da documentação.
