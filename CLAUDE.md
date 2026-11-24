# status — a página de status pública do Agronomy Center

Repositório **público** `glivemusic/status`. A página fica no GitHub Pages
(`glivemusic.github.io/status` até a F4; depois `status.basefertil.com`). A checagem roda no GitHub Actions.
O plano inteiro está em `docs/plano-pagina-de-status.md` (do API Agronomy); as decisões da F2 e da F3 estão em
`docs/f2-f3.md`. Em conflito, vale o plano, e a dúvida vai ao coordenador (agente Agronomy Center), nunca ao dono.

## Regras que não se quebram

- **Público para sempre.** O runner só é grátis em repositório público. Nunca tornar privado.
- **Nenhum segredo** no repositório, nos workflows ou nos dados: a página só chama rotas públicas de saúde.
  Nada de `secrets.*` nos workflows além do `GITHUB_TOKEN` automático.
- **Nada de fora para o cliente** (plano §1.4): nenhum endereço interno (develop, `*.vercel.app`, `*.workers.dev`,
  ref do Supabase), nenhum nome de fornecedor (Supabase, Vercel, Cloudflare), nenhuma mensagem de erro, versão,
  tempo por componente, contagem ou dado de cliente na página ou nos JSON publicados.
- **Página sem framework e sem script de terceiros.** HTML, CSS e JS próprios, sem CDN, fonte externa, analytics
  ou cookie. Texto de incidente entra por `textContent`, nunca por `innerHTML`.
- **Node 22 sem dependências.** Testes com `node --test`. Nada de `npm install` de pacote no repositório.
- **Workflows:** permissões mínimas por job; ações fixadas por SHA completo com a versão em comentário;
  entrada de `workflow_dispatch` vai por `env:`, nunca interpolada (`${{ }}`) dentro de `run:`.
- **Não mexer** no `basefertilapp` nem no `agrodash` (as rotas de saúde são dos agentes deles), em DNS,
  na produção do app ou em cobrança.
- Issues, wiki e projects ficam desligados.

## Mapa

- `lib/` — a lógica pura (classificação, estado, incidentes, dias, disponibilidade, cor da barra). É o que os
  testes cobrem.
- `scripts/` — as CLIs que os workflows chamam (checar, incidente, montar o site, gerar o exemplo).
- `config/alvos.json` — os endereços checados e as linhas da página.
- `site/` — a página estática.
- `exemplo/` — os dados de exemplo, marcados com `"exemplo": true`.
- `test/` — os testes.
- `.github/workflows/` — `ci`, `checagem`, `incidente`, `pages`.
- Os dados reais moram no ramo `dados`, nunca no `main`.

## Como trabalhar

Toda programação roda no harness do Claude Code, com a pasta de trabalho neste repositório.
A esteira: o `implementer` escreve; o `revisor`, o `seguranca` e o `qa` conferem em paralelo; a sessão principal
decide o destino de cada achado e devolve ao `implementer`. O `seguranca` é obrigatório em toda mudança de
workflow, de dado publicado ou de código da página.

### Testes: só os da mudança (regra do dono, 23/11/2026)

Palavra do dono: «NÃO CARA SUITE INTEIRA NÃO PELO AMOR DE DEUS É SÓ AS ALTERAÇOES».

- Nesta máquina, a suíte inteira **nunca** roda: nem `node --test` sem arquivo, nem a cada fatia, nem antes do push.
  Suíte inteira rodando: encerra-se pelo pid, e rodam-se só os testes da mudança.
- Localmente, só os testes ligados ao que mudou: `node --test test/<arquivo>.test.mjs …`, os que importam os
  módulos de `lib/`, `scripts/` ou `site/` tocados.
- A suíte inteira roda só na CI do GitHub (`ci.yml`), que é a prova antes de dizer pronto.
- O QA com navegador só nas telas que mudaram, uma vez, quando as fatias estiverem prontas.

Antes de dizer pronto: os testes da mudança verdes aqui, a CI verde no GitHub, e a página aberta e conferida por foto
nos dois idiomas (pt-BR e es-PY), a 360 e a 1440 px, só no que mudou.

Commits: `git add` por lista explícita, mensagem por `git commit -F`, em português.
