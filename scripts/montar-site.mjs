// Monta o site: node scripts/montar-site.mjs --fonte <exemplo|dir do ramo dados> --saida <dir>
// Copia de site/ a lista fechada do que se publica (D19), os arquivos de lib/ que a página importa e grava a visão reduzida dos três JSON em <saida>/dados/.
// Só a fonte pedida é lida: com o dir do ramo dados, nada de exemplo/ entra. D17: grava sempre o CNAME.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { FONTES_DO_SITE, LICENCA_DAS_FONTES, termoProibido, textoParaConferir } from '../lib/vazamento.mjs';
import { visaoDoEstado, visaoDosDias, visaoDosIncidentes } from '../lib/visao.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(RAIZ, 'site');
const LIB = join(RAIZ, 'lib');
// D17: o domínio da página (docs/dominio.md).
const DOMINIO = 'status.basefertil.com';

const { values } = parseArgs({ options: { fonte: { type: 'string' }, saida: { type: 'string' } } });
if (!values.fonte || !values.saida) {
  console.error('Uso: node scripts/montar-site.mjs --fonte <exemplo|dir> --saida <dir>');
  process.exit(2);
}
const fonte = values.fonte === 'exemplo' ? join(RAIZ, 'exemplo') : resolve(values.fonte);
const saida = resolve(values.saida);

function lerJson(caminho, padrao) {
  return existsSync(caminho) ? JSON.parse(readFileSync(caminho, 'utf8')) : padrao;
}
function gravarJson(caminho, valor) {
  writeFileSync(caminho, `${JSON.stringify(valor, null, 2)}\n`);
}

// Os arquivos de lib/ que a página importa, seguindo os imports a partir de site/pagina.mjs.
// Na página, './lib/x.mjs' (de site/) e './y.mjs' (de dentro de lib/) apontam para lib/.
function libDaPagina() {
  const achados = new Set();
  const fila = [{ arquivo: join(SITE, 'pagina.mjs'), base: SITE }];
  while (fila.length) {
    const { arquivo, base } = fila.shift();
    const codigo = readFileSync(arquivo, 'utf8');
    for (const [, especificador] of codigo.matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/g)) {
      let alvo;
      if (base === SITE && especificador.startsWith('./lib/')) alvo = join(LIB, especificador.slice(6));
      else if (base === LIB) alvo = resolve(LIB, especificador);
      else continue;
      if (dirname(alvo) !== LIB) throw new Error(`Import fora de lib/: ${especificador}`);
      if (!achados.has(alvo)) {
        achados.add(alvo);
        fila.push({ arquivo: alvo, base: LIB });
      }
    }
  }
  return [...achados].sort();
}

const config = lerJson(join(RAIZ, 'config', 'alvos.json'), null);
const estado = lerJson(join(fonte, 'estado.json'), {});
const dias = lerJson(join(fonte, 'dias.json'), {});
const incidentes = lerJson(join(fonte, 'incidentes.json'), { incidentes: [] });
const exemplo = estado.exemplo === true;

// D19: a lista fechada do que se publica de site/. Qualquer outro arquivo, pasta ou link simbólico em site/, um
// arquivo da lista que falte ou uma fonte sem o cabeçalho `wOF2` é erro, e nada é gravado. Só o arquivo `.DS_Store`
// (em site/ e nas pastas da lista) é ignorado, sem erro e sem ir ao site.
const DO_SITE = [
  'index.html',
  'estilo.css',
  'pagina.mjs',
  'textos.mjs',
  'favicon.svg',
  'marca/simbolo.svg',
  'marca/simbolo-escuro.svg',
  LICENCA_DAS_FONTES,
  ...FONTES_DO_SITE,
];

function problemasDoSite() {
  const problemas = [];
  const vistos = new Set();
  const andar = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const caminho = join(dir, e.name);
      const rel = relative(SITE, caminho).split(sep).join('/');
      if (e.isSymbolicLink()) problemas.push(`site/${rel} é um link simbólico`);
      // O .DS_Store que o Finder do macOS cria (só arquivo com esse nome exato): ignorado, não vai ao site.
      else if (e.isFile() && e.name === '.DS_Store') continue;
      else if (e.isDirectory()) {
        if (DO_SITE.some((p) => p.startsWith(`${rel}/`))) andar(caminho);
        else problemas.push(`a pasta site/${rel} está fora da lista do que se publica`);
      } else if (!e.isFile() || !DO_SITE.includes(rel)) problemas.push(`site/${rel} está fora da lista do que se publica`);
      else vistos.add(rel);
    }
  };
  andar(SITE);
  for (const p of DO_SITE) if (!vistos.has(p)) problemas.push(`falta site/${p}`);
  for (const p of FONTES_DO_SITE) {
    if (vistos.has(p) && readFileSync(join(SITE, p)).subarray(0, 4).toString('latin1') !== 'wOF2') {
      problemas.push(`site/${p} não é woff2 (sem o cabeçalho wOF2)`);
    }
  }
  return problemas;
}

const problemas = problemasDoSite();
if (problemas.length) {
  for (const p of problemas) console.error(`Erro: ${p}. O site não deve ser publicado.`);
  process.exit(1);
}

mkdirSync(join(saida, 'lib'), { recursive: true });
mkdirSync(join(saida, 'dados'), { recursive: true });
for (const p of DO_SITE) {
  mkdirSync(dirname(join(saida, p)), { recursive: true });
  copyFileSync(join(SITE, p), join(saida, p));
}
for (const arquivo of libDaPagina()) copyFileSync(arquivo, join(saida, 'lib', arquivo.slice(LIB.length + 1)));

gravarJson(join(saida, 'dados', 'estado.json'), visaoDoEstado(config, estado));
gravarJson(join(saida, 'dados', 'dias.json'), visaoDosDias(config, dias, exemplo));
gravarJson(join(saida, 'dados', 'incidentes.json'), visaoDosIncidentes(incidentes.incidentes, exemplo));
writeFileSync(join(saida, 'CNAME'), `${DOMINIO}\n`);

// Plano §1.4: nenhum arquivo publicado leva endereço ou nome de fornecedor, venha de onde vier.
function publicados(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? publicados(join(dir, e.name)) : [join(dir, e.name)],
  );
}
const urls = config.linhas.map((l) => l.url).filter(Boolean);
let vazou = false;
for (const arquivo of publicados(saida)) {
  const texto = textoParaConferir(relative(saida, arquivo).split(sep).join('/'), readFileSync(arquivo, 'utf8'));
  if (texto === null) continue;
  const termo = termoProibido(texto, urls);
  if (termo) {
    const proprio = urls.includes(termo) ? 'o endereço de um alvo' : JSON.stringify(termo);
    console.error(`Erro: ${arquivo.slice(saida.length + 1)} contém ${proprio}. O site não deve ser publicado.`);
    vazou = true;
  }
}
if (vazou) process.exit(1);

console.log(`Site montado em ${saida} (fonte: ${exemplo ? 'exemplo' : 'dados'}).`);
