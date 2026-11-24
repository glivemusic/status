// D12: scripts/fotos.mjs existe e não chama endereço fora do 127.0.0.1. Não roda aqui (o CI não tem Chrome).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ARQUIVO = fileURLToPath(new URL('../scripts/fotos.mjs', import.meta.url));

test('fotos.mjs existe, sem dependência, e não chama endereço fora do 127.0.0.1', () => {
  assert.ok(existsSync(ARQUIVO));
  const codigo = readFileSync(ARQUIVO, 'utf8');
  // Só módulos do Node.
  for (const [, origem] of codigo.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
    assert.match(origem, /^node:/, `import de fora do Node: ${origem}`);
  }
  // Todo endereço escrito aponta para 127.0.0.1.
  const enderecos = [...codigo.matchAll(/\b(?:https?|wss?):\/\/([^\s'"`/:]*)/g)];
  assert.ok(enderecos.length > 0);
  for (const [inteiro, host] of enderecos) assert.equal(host, '127.0.0.1', inteiro);
  assert.ok(!/localhost/.test(codigo), 'sem localhost (pode resolver para outro endereço)');
  assert.ok(!/\bfetch\s*\(/.test(codigo), 'sem fetch');
  // O servidor só escuta em 127.0.0.1, e o Chrome não resolve nenhum outro nome.
  assert.match(codigo, /const HOST = '127\.0\.0\.1';/);
  assert.match(codigo, /\.listen\(0, HOST,/);
  assert.ok(codigo.includes("'--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1'"));
  // Nem proxy do sistema, nem PAC: tudo direto, e nenhum nome resolve.
  assert.ok(codigo.includes("'--no-proxy-server'"));
  assert.ok(!/--proxy-(server|pac-url)=/.test(codigo));
  // Perfil temporário e encerramento no finally.
  assert.match(codigo, /--user-data-dir=/);
  assert.match(codigo, /finally \{\s*await encerrar\(\);/);
});

test('D19: os cenários das fotos; o ramo dados é lido com git show, sem mexer na pasta de trabalho', () => {
  const codigo = readFileSync(ARQUIVO, 'utf8');
  assert.match(codigo, /const CENARIOS = \['exemplo', 'tudo-ok', 'fora', 'atrasado', 'real'\];/);
  assert.ok(codigo.includes("['-C', RAIZ, 'show', `origin/dados:${nome}`]"));
  assert.ok(!/'(checkout|switch|reset|worktree|stash|pull|fetch)'/.test(codigo), 'nenhum comando git que mexa');
  // Os cenários de teste vão a uma pasta temporária, pelo scripts/cenario.mjs.
  assert.match(codigo, /temporaria\(`status-fotos-\$\{CENARIO\}-`\)/);
  assert.match(codigo, /'scripts', 'cenario\.mjs'/);
  // O --interagir imprime a árvore de acessibilidade do Chrome.
  assert.match(codigo, /Accessibility\.getPartialAXTree/);
});

test('fotos.mjs encerra tudo com SIGINT, SIGTERM e SIGHUP, e mensagem malformada não escapa do finally', () => {
  const codigo = readFileSync(ARQUIVO, 'utf8');
  for (const sinal of ['SIGHUP', 'SIGINT', 'SIGTERM']) assert.ok(codigo.includes(`${sinal}:`), sinal);
  assert.match(codigo, /process\.once\(sinal, async \(\) => \{[\s\S]*?await encerrar\(\);[\s\S]*?process\.exit\(128 \+ numero\)/);
  // Todo JSON.parse está dentro de um try.
  const parses = [...codigo.matchAll(/JSON\.parse\(/g)].length;
  const protegidos = [...codigo.matchAll(/try \{\s*m = JSON\.parse\(/g)].length;
  assert.equal(parses, protegidos);
});
