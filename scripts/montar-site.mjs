// Monta o site: node scripts/montar-site.mjs --fonte <exemplo|dir do ramo dados> --saida <dir>
// Copia site/, os arquivos de lib/ que a página importa e grava a visão reduzida dos três JSON em <saida>/dados/.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { termoProibido } from '../lib/vazamento.mjs';
import { visaoDoEstado, visaoDosDias, visaoDosIncidentes } from '../lib/visao.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(RAIZ, 'site');
const LIB = join(RAIZ, 'lib');

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

mkdirSync(join(saida, 'lib'), { recursive: true });
mkdirSync(join(saida, 'dados'), { recursive: true });
for (const nome of readdirSync(SITE)) copyFileSync(join(SITE, nome), join(saida, nome));
for (const arquivo of libDaPagina()) copyFileSync(arquivo, join(saida, 'lib', arquivo.slice(LIB.length + 1)));

gravarJson(join(saida, 'dados', 'estado.json'), visaoDoEstado(config, estado));
gravarJson(join(saida, 'dados', 'dias.json'), visaoDosDias(config, dias, exemplo));
gravarJson(join(saida, 'dados', 'incidentes.json'), visaoDosIncidentes(incidentes.incidentes, exemplo));

// Plano §1.4: nenhum arquivo publicado leva endereço ou nome de fornecedor, venha de onde vier.
function publicados(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? publicados(join(dir, e.name)) : [join(dir, e.name)],
  );
}
const urls = config.linhas.map((l) => l.url).filter(Boolean);
let vazou = false;
for (const arquivo of publicados(saida)) {
  const termo = termoProibido(readFileSync(arquivo, 'utf8'), urls);
  if (termo) {
    const proprio = urls.includes(termo) ? 'o endereço de um alvo' : JSON.stringify(termo);
    console.error(`Erro: ${arquivo.slice(saida.length + 1)} contém ${proprio}. O site não deve ser publicado.`);
    vazou = true;
  }
}
if (vazou) process.exit(1);

console.log(`Site montado em ${saida} (fonte: ${exemplo ? 'exemplo' : 'dados'}).`);
