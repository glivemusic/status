# O domínio `status.basefertil.com` (D17)

A página sai de `glivemusic.github.io/status` e passa a `status.basefertil.com`. O harness deste repositório não
tem permissão para mexer na configuração do Pages: os comandos abaixo são da sessão de fora, com o `gh` dela.

## O registro de DNS (já existe)

| Nome | Tipo | Valor |
|---|---|---|
| `status` | `CNAME` | `glivemusic.github.io` |

Este repositório não mexe em DNS: o que for DNS é do dono ou da sessão de fora.

## O risco do domínio sem dono

> **Feito em 24/11/2026:** o domínio `basefertil.com` está verificado na conta `glivemusic` (Settings → Pages:
> «basefertil.com Verified»). O TXT `_github-pages-challenge-glivemusic.basefertil.com` foi criado pelo dono na
> Hostinger e responde no DNS público. Nenhuma outra conta pode usar `basefertil.com` nem `status.basefertil.com`.

Enquanto o registro acima aponta para o GitHub Pages e `status.basefertil.com` não está gravado neste Pages, outra
conta do GitHub pode gravar esse domínio no Pages dela e servir a sua página no nosso endereço. Por isso:

- o passo 1 abaixo (gravar o domínio) vem **antes** de tudo, sem demora depois de o registro existir;
- recomenda-se **verificar o domínio `basefertil.com` na conta** `glivemusic`: nas configurações de Pages da conta
  (não do repositório), o GitHub fornece um registro TXT `_github-pages-challenge-glivemusic` com um valor; o dono
  (ou a sessão de fora) cria esse TXT no DNS e confirma a verificação ali. Com o domínio verificado, nenhuma outra
  conta consegue usar `basefertil.com` nem os subdomínios imediatos dele (um nível abaixo, como
  `status.basefertil.com`); subdomínios mais fundos, como `a.status.basefertil.com`, não ficam cobertos. É DNS: nunca é feito por este repositório.

## O arquivo `CNAME` no site

`scripts/montar-site.mjs` grava sempre `CNAME` na raiz do site montado, com uma linha só (`status.basefertil.com`),
para as duas fontes (`exemplo` e `dados`). No deploy por workflow próprio (o `pages.yml`), esse arquivo **não grava
o domínio**: quem grava é a `gh api` do passo 1. O arquivo é só registro do domínio esperado e não atrapalha.

O `noindex` (`<meta name="robots" content="noindex">`) continua até a F4. Todo caminho da página é relativo: ela
funciona em `/` e em `/status/`.

## Os comandos (sessão de fora), nesta ordem

1. Gravar o domínio no Pages (primeiro, pelo risco acima):

   ```sh
   gh api --method PUT repos/glivemusic/status/pages -f cname=status.basefertil.com
   ```

2. Esperar o certificado sair (o campo `https_certificate.state` chega a `approved`):

   ```sh
   gh api repos/glivemusic/status/pages --jq '{cname, https_enforced, estado: .https_certificate.state}'
   ```

3. Forçar o HTTPS, depois do certificado:

   ```sh
   gh api --method PUT repos/glivemusic/status/pages -F https_enforced=true
   ```

4. Começar o ramo `dados` do zero. A recriação diária (D8, D13) não limpa o que foi medido antes de D17: ela
   copia os mesmos JSON para um commit só. Por isso:

   a. Apagar o ramo remoto `dados`, sem nenhuma checagem nem incidente rodando. Antes, conferir que
      `FONTE_DOS_DADOS` não é `dados` (vazia ou `exemplo`); senão, um deploy entre o 4a e o 4b falha no checkout
      do ramo que não existe:

      ```sh
      gh variable get FONTE_DOS_DADOS --repo glivemusic/status
      ```

      E que nenhum run está em andamento nem na fila (as duas listas vazias):

      ```sh
      gh run list --repo glivemusic/status --status in_progress
      gh run list --repo glivemusic/status --status queued
      ```

      Então apagar (se o ramo não existe, a resposta é 422 e pode seguir):

      ```sh
      gh api --method DELETE repos/glivemusic/status/git/refs/heads/dados
      ```

      Se, mesmo assim, uma gravação que já estava a caminho recriar o ramo com dado antigo, a conferência do 4c
      pega, e o passo 4 recomeça do 4a.

   b. Disparar a checagem uma vez (ou ligar o cron, quando o coordenador avisar). A primeira gravação cria o ramo
      (D13):

      ```sh
      gh workflow run checagem.yml --repo glivemusic/status
      ```

   c. Antes de trocar a fonte, conferir o ramo novo. Um commit só, de depois de D17:

      ```sh
      gh api 'repos/glivemusic/status/commits?sha=dados&per_page=5' --jq 'length, (.[] | .commit.committer.date)'
      ```

      O `estado.json` com só a linha `app` (a saída é `["app"]`):

      ```sh
      gh api -H 'Accept: application/vnd.github.raw+json' 'repos/glivemusic/status/contents/estado.json?ref=dados' \
        --jq '.linhas | keys'
      ```

      Nenhum incidente de login, banco ou satélite (a saída é `[]`):

      ```sh
      gh api -H 'Accept: application/vnd.github.raw+json' 'repos/glivemusic/status/contents/incidentes.json?ref=dados' \
        --jq '[.incidentes[] | select(.linhas | any(. != "app")) | .id]'
      ```

   d. Só então passar a fonte para o ramo `dados` e publicar uma vez à mão:

      ```sh
      gh variable set FONTE_DOS_DADOS --repo glivemusic/status --body dados
      gh workflow run pages.yml --repo glivemusic/status
      ```

Se, mesmo assim, sobrar um incidente automático antigo aberto numa linha em breve, ele se fecha pelo workflow
`incidente.yml` com `acao: resolver` e o `id` dele (atualizar e resolver aceitam o `id` de qualquer linha do
config; só abrir numa linha em breve é recusado).

## O que conferir

- **Certificado válido:** `https://status.basefertil.com/` abre sem aviso do navegador, e o passo 2 mostra
  `https_enforced: true` e o certificado `approved`. O endereço com `http://` redireciona para `https://`.
- **A página em `/`:** ela é servida em `https://status.basefertil.com/`, não em `/status/`; os arquivos
  `estilo.css`, `pagina.mjs` e `dados/estado.json` carregam (nenhum erro no console).
- **`noindex` presente:** o código-fonte da página tem `<meta name="robots" content="noindex">`.
- **Sem a faixa de exemplo com a fonte `dados`:** a faixa «Dados de exemplo…» / «Datos de ejemplo…» não aparece, e
  `dados/estado.json` publicado não tem o campo `exemplo`.
- **As linhas em breve (D17):** «Login e contas», «Dados dos talhões (banco)» e «Imagens de satélite (Sentinel-2)»
  aparecem com «Em breve» / «Próximamente», sem barras nem percentual; só a linha do aplicativo tem barras.
  *(Substituído pela D24.)*
- **As quatro linhas (D24):** todas com estado e barras; a do satélite com «Verificado há» / «Verificado hace», e o
  estado dela não muda a faixa geral.
