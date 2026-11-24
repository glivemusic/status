// D12 e D19: as fotos da página, com os dados de um cenário.
//   node scripts/fotos.mjs --saida <pasta> [--cenario C] [--fonte <pasta>] [--tema claro|escuro] [--idioma pt-BR|es-PY]
//   node scripts/fotos.mjs --interagir [--cenario C] [--fonte <pasta>] [--tema claro|escuro] [--idioma pt-BR|es-PY]
// Cenários (--cenario, padrão exemplo):
// - exemplo: os dados de exemplo/;
// - tudo-ok, fora, atrasado: feitos do exemplo por scripts/cenario.mjs, numa pasta temporária (só para as fotos,
//   nunca vão ao site publicado);
// - real: os dados do ramo dados (origin/dados, lidos com `git show`, sem mexer na pasta de trabalho), ou os de
//   --fonte <pasta> (estado.json, dias.json e incidentes.json). Só --fonte <pasta>, sem --cenario, é o mesmo que real.
// Monta o site numa pasta temporária, serve em 127.0.0.1 (porta livre, sob /status/) com node:http, abre o
// Chrome sem janela com perfil temporário e fala com ele pelo protocolo de depuração (WebSocket do Node 22).
// Fotografa a página inteira em pt-BR e es-PY (ou só no --idioma) a 360 e 1440 px e imprime a largura de rolagem
// e o `lang`.
// Com --interagir: a 360 px, toca numa barra e troca o idioma pelo seletor (a dica, o ?lang=, o lang, o
// aria-pressed e a altura das opções); a 1440 px, anda com Tab (o elemento focado e o anel de foco computado), muda
// o dia com as setas (a dica acompanha), fecha a dica com Esc, passa o mouse numa barra, imprime a árvore de
// acessibilidade do Chrome (o seletor, o grupo de barras e o dia focado), as fontes carregadas e os erros do
// console (inclusive os de CSP e de fonte).
// Encerra o Chrome e o servidor e apaga as pastas temporárias, mesmo em erro e com SIGINT, SIGTERM ou SIGHUP.
// Não entra no CI (sem Chrome lá).
// O que é garantido sobre a rede:
// - este script só abre conexão com 127.0.0.1 (o servidor escuta só lá; a depuração é em 127.0.0.1);
// - no Chrome, nenhum nome resolve (--host-resolver-rules), nem pelo DNS seguro, e ele não usa proxy:
//   nem o do sistema, nem PAC, nem detecção automática (--no-proxy-server). Os serviços de fundo, a
//   sincronização, a atualização de componentes e os relatórios ficam desligados por opção;
// - um IP literal fora do 127.0.0.1 não é bloqueado pelo Chrome: quem barra é a CSP da página
//   (default-src 'none', connect-src 'self'), e nada aqui navega para outro endereço.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { setTimeout as esperar } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HOST = '127.0.0.1';
const IDIOMAS = ['pt-BR', 'es-PY'];
const LARGURAS = [360, 1440];
const TEMPO_DO_COMANDO_MS = 30_000;
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};
const CENARIOS = ['exemplo', 'tudo-ok', 'fora', 'atrasado', 'real'];
const ARQUIVOS_DE_DADOS = ['estado.json', 'dias.json', 'incidentes.json'];

const { values } = parseArgs({
  options: {
    saida: { type: 'string' },
    tema: { type: 'string', default: 'claro' },
    interagir: { type: 'boolean', default: false },
    cenario: { type: 'string' },
    fonte: { type: 'string' },
    idioma: { type: 'string' },
  },
});
// Compatível com o uso de antes: `--fonte exemplo` é o exemplo; `--fonte <pasta>` sozinho é o cenário real.
const FONTE_PASTA = values.fonte && values.fonte !== 'exemplo' ? resolve(values.fonte) : null;
const CENARIO = values.cenario ?? (FONTE_PASTA ? 'real' : 'exemplo');
if (
  !['claro', 'escuro'].includes(values.tema) ||
  (!values.interagir && !values.saida) ||
  !CENARIOS.includes(CENARIO) ||
  (FONTE_PASTA && CENARIO !== 'real') ||
  (values.idioma !== undefined && !IDIOMAS.includes(values.idioma))
) {
  const opcoes = `[--cenario ${CENARIOS.join('|')}] [--fonte <pasta, só com real>] [--tema claro|escuro] [--idioma pt-BR|es-PY]`;
  console.error(`Uso: node scripts/fotos.mjs --saida <pasta> ${opcoes}`);
  console.error(`     node scripts/fotos.mjs --interagir ${opcoes}`);
  process.exit(2);
}
if (!existsSync(CHROME)) {
  console.error(`Erro: o Chrome não está em ${CHROME}.`);
  process.exit(1);
}

// O que precisa ser desfeito, na ordem inversa.
const temporarias = [];
let servidor = null;
let chrome = null;
let ws = null;

let encerramento = null;
function encerrar() {
  encerramento ??= desfazer();
  return encerramento;
}

async function desfazer() {
  try {
    ws?.close();
  } catch {}
  if (chrome && chrome.exitCode === null && chrome.signalCode === null) {
    const saiu = new Promise((ok) => chrome.once('exit', ok));
    chrome.kill('SIGTERM');
    const morto = await Promise.race([saiu.then(() => true), esperar(5000).then(() => false)]);
    if (!morto) {
      chrome.kill('SIGKILL');
      await Promise.race([saiu, esperar(2000)]);
    }
  }
  if (servidor) {
    servidor.closeAllConnections?.();
    await new Promise((ok) => servidor.close(ok));
  }
  for (const pasta of temporarias.reverse()) {
    rmSync(pasta, { recursive: true, force: true, maxRetries: 5 });
    if (existsSync(pasta)) console.error(`Aviso: a pasta temporária ${pasta} não foi apagada.`);
  }
}

// Interrompido (Ctrl-C, kill, terminal fechado): encerra e apaga tudo antes de sair, com 128 + o número do sinal.
const SINAIS = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 };
for (const [sinal, numero] of Object.entries(SINAIS)) {
  process.once(sinal, async () => {
    console.error(`Interrompido (${sinal}): encerrando o Chrome e o servidor.`);
    await encerrar();
    process.exit(128 + numero);
  });
}

function temporaria(prefixo) {
  const pasta = mkdtempSync(join(tmpdir(), prefixo));
  temporarias.push(pasta);
  return pasta;
}

// Os dados do cenário: `exemplo`, ou uma pasta (temporária, menos a de --fonte) com os três JSON.
function dadosDoCenario() {
  if (CENARIO === 'exemplo') return 'exemplo';
  if (CENARIO === 'real' && FONTE_PASTA) return FONTE_PASTA;
  const pasta = temporaria(`status-fotos-${CENARIO}-`);
  if (CENARIO === 'real') {
    // O ramo dados, como está no origin, sem checkout: um arquivo que falta fica com o padrão do montar-site.
    for (const nome of ARQUIVOS_DE_DADOS) {
      let conteudo;
      try {
        conteudo = execFileSync('git', ['-C', RAIZ, 'show', `origin/dados:${nome}`], { stdio: ['ignore', 'pipe', 'ignore'] });
      } catch {
        if (nome === 'estado.json') throw new Error('não li origin/dados:estado.json (use --fonte <pasta>).');
        continue;
      }
      writeFileSync(join(pasta, nome), conteudo);
    }
    return pasta;
  }
  execFileSync(process.execPath, [join(RAIZ, 'scripts', 'cenario.mjs'), '--cenario', CENARIO, '--saida', pasta], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  return pasta;
}

// O site com os dados do cenário, em <tmp>/status.
function montarSite() {
  const raiz = join(temporaria('status-fotos-site-'), 'status');
  execFileSync(process.execPath, [join(RAIZ, 'scripts', 'montar-site.mjs'), '--fonte', dadosDoCenario(), '--saida', raiz], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  return raiz;
}

// Servidor estático só em 127.0.0.1, numa porta livre, com o site sob /status/.
function servir(raiz) {
  const s = createServer((pedido, resposta) => {
    const caminho = new URL(pedido.url, 'http://127.0.0.1').pathname;
    if (caminho === '/status') {
      resposta.writeHead(301, { Location: '/status/' }).end();
      return;
    }
    if (pedido.method !== 'GET' || !caminho.startsWith('/status/')) {
      resposta.writeHead(404).end();
      return;
    }
    let relativo;
    try {
      relativo = decodeURIComponent(caminho.slice('/status/'.length));
    } catch {
      resposta.writeHead(400).end();
      return;
    }
    if (relativo === '' || relativo.endsWith('/')) relativo += 'index.html';
    const arquivo = resolve(raiz, relativo);
    if (!arquivo.startsWith(raiz + sep)) {
      resposta.writeHead(403).end();
      return;
    }
    let corpo;
    try {
      corpo = readFileSync(arquivo);
    } catch {
      resposta.writeHead(404).end();
      return;
    }
    resposta
      .writeHead(200, {
        'Content-Type': TIPOS[extname(arquivo)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      })
      .end(corpo);
  });
  return new Promise((ok, erro) => {
    s.once('error', erro);
    s.listen(0, HOST, () => ok(s));
  });
}

// O Chrome sem janela, com perfil temporário e a porta de depuração escolhida por ele (lida do perfil).
async function abrirChrome() {
  const perfil = temporaria('status-fotos-perfil-');
  chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${perfil}`,
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--use-mock-keychain',
      '--password-store=basic',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-domain-reliability',
      '--disable-client-side-phishing-detection',
      '--disable-sync',
      '--no-pings',
      '--disable-features=Translate,OptimizationHints,MediaRouter,AutofillServerCommunication,DnsOverHttps',
      // Nenhum nome resolve, e nada sai por proxy (nem o do sistema, nem PAC, nem detecção automática).
      '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1',
      '--no-proxy-server',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  const arquivo = join(perfil, 'DevToolsActivePort');
  for (let i = 0; i < 100; i += 1) {
    if (chrome.exitCode !== null) throw new Error('o Chrome fechou antes de abrir a porta de depuração.');
    if (existsSync(arquivo)) {
      const [porta, caminho] = readFileSync(arquivo, 'utf8').split('\n');
      if (/^\d+$/.test(porta) && caminho?.startsWith('/devtools/browser/')) return `ws://127.0.0.1:${porta}${caminho}`;
    }
    await esperar(100);
  }
  throw new Error('o Chrome não abriu a porta de depuração em 10 s.');
}

// O protocolo de depuração: comandos com id e eventos por sessão.
async function conectar(endereco) {
  ws = new WebSocket(endereco);
  await new Promise((ok, erro) => {
    ws.addEventListener('open', ok, { once: true });
    ws.addEventListener('error', () => erro(new Error('não conectou ao Chrome.')), { once: true });
  });
  let proximo = 0;
  const pendentes = new Map();
  const ouvintes = new Set();
  // Depois de uma mensagem malformada a conversa não é confiável: tudo o que está pendente e tudo o que vier
  // depois é rejeitado, e o erro chega ao `finally` (nada de exceção solta no ouvinte).
  let quebrada = null;
  const quebrar = (erro) => {
    quebrada ??= erro;
    for (const p of pendentes.values()) {
      clearTimeout(p.relogio);
      p.erro(quebrada);
    }
    pendentes.clear();
  };
  ws.addEventListener('message', (evento) => {
    let m;
    try {
      m = JSON.parse(evento.data);
      if (m === null || typeof m !== 'object') throw new Error('não é um objeto');
    } catch (erro) {
      quebrar(new Error(`mensagem malformada do Chrome (${erro.message}).`));
      return;
    }
    if (m.id !== undefined) {
      const p = pendentes.get(m.id);
      if (!p) return;
      pendentes.delete(m.id);
      clearTimeout(p.relogio);
      if (m.error) p.erro(new Error(`${p.metodo}: ${m.error.message}`));
      else p.ok(m.result);
    } else {
      for (const f of ouvintes) {
        try {
          f(m);
        } catch (erro) {
          quebrar(new Error(`evento do Chrome fora do esperado (${erro.message}).`));
        }
      }
    }
  });
  const enviar = (metodo, params = {}, sessionId) =>
    new Promise((ok, erro) => {
      if (quebrada) {
        erro(quebrada);
        return;
      }
      const id = ++proximo;
      const relogio = setTimeout(() => {
        pendentes.delete(id);
        erro(new Error(`${metodo}: sem resposta em ${TEMPO_DO_COMANDO_MS / 1000} s.`));
      }, TEMPO_DO_COMANDO_MS);
      pendentes.set(id, { ok, erro, relogio, metodo });
      ws.send(JSON.stringify({ id, method: metodo, params, ...(sessionId ? { sessionId } : {}) }));
    });
  return { enviar, ouvir: (f) => ouvintes.add(f), parar: (f) => ouvintes.delete(f) };
}

function textoDoErro(m) {
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    return d.exception?.description ?? d.text;
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    return m.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
  }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    return `${m.params.entry.text}${m.params.entry.url ? ` (${m.params.entry.url})` : ''}`;
  }
  return null;
}

// Uma aba nova, já na largura, no tema e no endereço, com a página desenhada.
async function abrirPagina(cdp, url, largura) {
  const { targetId } = await cdp.enviar('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.enviar('Target.attachToTarget', { targetId, flatten: true });
  const s = (metodo, params) => cdp.enviar(metodo, params, sessionId);
  const erros = [];
  const ouvinte = (m) => {
    if (m.sessionId !== sessionId) return;
    const texto = textoDoErro(m);
    if (texto) erros.push(texto);
  };
  cdp.ouvir(ouvinte);
  await s('Page.enable');
  await s('Runtime.enable');
  await s('Log.enable');
  const celular = largura < 600;
  await s('Emulation.setDeviceMetricsOverride', { width: largura, height: 800, deviceScaleFactor: 1, mobile: celular });
  if (celular) await s('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await s('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: values.tema === 'escuro' ? 'dark' : 'light' }],
  });
  await s('Page.navigate', { url });
  const avaliar = async (expressao) => {
    const r = await s('Runtime.evaluate', { expression: expressao, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`na página: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  let pronta = false;
  for (let i = 0; i < 100 && !pronta; i += 1) {
    await esperar(100);
    pronta = await avaliar(
      "document.readyState === 'complete' && !!document.getElementById('cartao') && !document.getElementById('cartao').hidden",
    ).catch(() => false);
  }
  if (!pronta) throw new Error(`a página não desenhou em 10 s (${url}).`);
  const fechar = async () => {
    cdp.parar(ouvinte);
    await cdp.enviar('Target.closeTarget', { targetId });
  };
  return { s, avaliar, erros, fechar };
}

async function fotografar(cdp, base, saida) {
  mkdirSync(saida, { recursive: true });
  console.log(`Cenário ${CENARIO}, tema ${values.tema}.`);
  for (const idioma of values.idioma ? [values.idioma] : IDIOMAS) {
    for (const largura of LARGURAS) {
      const pagina = await abrirPagina(cdp, `${base}?lang=${idioma}`, largura);
      const m = await pagina.avaliar(
        '({ rolagem: document.documentElement.scrollWidth, janela: document.documentElement.clientWidth,' +
          ' altura: document.documentElement.scrollHeight, lang: document.documentElement.lang })',
      );
      await pagina.s('Emulation.setDeviceMetricsOverride', {
        width: largura,
        height: m.altura,
        deviceScaleFactor: 1,
        mobile: largura < 600,
      });
      await esperar(300);
      const foto = await pagina.s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      const nome = `${idioma}-${largura}${values.tema === 'escuro' ? '-escuro' : ''}.png`;
      writeFileSync(join(saida, nome), Buffer.from(foto.data, 'base64'));
      const estoura = m.rolagem > m.janela ? '  ESTOURA A LARGURA' : '';
      console.log(
        `${nome}: largura de rolagem ${m.rolagem} px (janela ${m.janela} px), altura ${m.altura} px, lang ${m.lang}${estoura}`,
      );
      for (const e of pagina.erros) console.log(`  erro do console: ${e}`);
      await pagina.fechar();
    }
  }
  console.log(`Fotos em ${resolve(saida)}.`);
}

// Um toque de verdade (eventos de toque) no centro do elemento.
async function tocar(pagina, seletor) {
  const centro = await pagina.avaliar(`(() => {
    const e = ${seletor};
    if (!e) return null;
    e.scrollIntoView({ block: 'center' });
    const r = e.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!centro) throw new Error(`nada para tocar: ${seletor}`);
  await esperar(100);
  const ponto = { x: centro.x, y: centro.y };
  await pagina.s('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [ponto] });
  await pagina.s('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await esperar(300);
}

// Uma tecla de verdade (keyDown e keyUp pelo protocolo). Só o Enter leva texto (é o que ativa o botão).
const TECLAS = { Tab: 9, Enter: 13, Escape: 27, End: 35, Home: 36, ArrowLeft: 37, ArrowRight: 39 };
async function tecla(pagina, nome) {
  const base = { key: nome, code: nome, windowsVirtualKeyCode: TECLAS[nome], nativeVirtualKeyCode: TECLAS[nome] };
  if (nome === 'Enter') await pagina.s('Input.dispatchKeyEvent', { type: 'keyDown', ...base, text: '\r' });
  else await pagina.s('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
  await pagina.s('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await esperar(120);
}

// O elemento focado e o anel de foco computado; null se o foco está no corpo da página (ou saiu dela).
const FOCO = `(() => {
  const e = document.activeElement;
  if (!e || e === document.body || e === document.documentElement) return null;
  const s = getComputedStyle(e);
  return {
    elemento: e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className ? '.' + String(e.className).trim().split(/\\s+/).join('.') : ''),
    nome: e.getAttribute('aria-label') ?? e.textContent.trim(),
    pressionado: e.getAttribute('aria-pressed'),
    linha: e.closest('.linha')?.querySelector('.linha-nome')?.textContent ?? null,
    focoVisivel: e.matches(':focus-visible'),
    anel: s.outlineStyle + ' ' + s.outlineWidth + ' ' + s.outlineColor + ', folga ' + s.outlineOffset,
  };
})()`;

function mostrarFoco(rotulo, f) {
  if (!f) {
    console.log(`  ${rotulo}: (foco fora dos controles da página)`);
    return;
  }
  const extra = [f.pressionado !== null ? `aria-pressed=${f.pressionado}` : null, f.linha ? `linha «${f.linha}»` : null]
    .filter(Boolean)
    .join(', ');
  console.log(`  ${rotulo}: ${f.elemento} «${f.nome}»${extra ? ` (${extra})` : ''}`);
  console.log(`      :focus-visible ${f.focoVisivel}; anel ${f.anel}`);
}

// O nó da árvore de acessibilidade do Chrome para o primeiro elemento do seletor: papel, nome e propriedades.
async function noDeAcessibilidade(pagina, seletor) {
  const { root } = await pagina.s('DOM.getDocument', { depth: 0 });
  const { nodeId } = await pagina.s('DOM.querySelector', { nodeId: root.nodeId, selector: seletor });
  if (!nodeId) return null;
  const { nodes } = await pagina.s('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
  const n = nodes.find((x) => !x.ignored) ?? nodes[0];
  if (!n) return null;
  const props = (n.properties ?? [])
    .filter((p) => p.value?.value !== undefined && p.value.value !== false)
    .map((p) => `${p.name}=${p.value.value}`);
  return { papel: n.role?.value, nome: n.name?.value ?? '', filhos: n.childIds?.length ?? 0, props, ignorado: n.ignored === true };
}

function mostrarNo(rotulo, n) {
  if (!n) {
    console.log(`  ${rotulo}: (não achado)`);
    return;
  }
  const props = n.props.length ? `; ${n.props.join(', ')}` : '';
  console.log(`  ${rotulo}: papel ${n.papel}, nome «${n.nome}», ${n.filhos} filhos${n.ignorado ? ', IGNORADO' : ''}${props}`);
}

function mostrarErros(pagina) {
  console.log(`erros do console: ${pagina.erros.length ? '' : 'nenhum'}`);
  for (const e of pagina.erros) console.log(`  ${e}`);
}

// A dica da linha da primeira barra que casa com o seletor (null se fechada).
const dicaDe = (barra) => `(() => {
  const b = ${barra};
  const d = b && b.closest('.linha').querySelector('.dica');
  return !d || d.hidden ? null : d.textContent;
})()`;

async function interagir(cdp, base) {
  const inicial = values.idioma ?? 'pt-BR';
  const outro = inicial === 'pt-BR' ? 'es-PY' : 'pt-BR';
  console.log(`Cenário ${CENARIO}, tema ${values.tema}, idioma inicial ${inicial}.`);

  // --- 360 px, toque ---
  let pagina = await abrirPagina(cdp, `${base}?lang=${inicial}`, 360);
  console.log('\n360 px (toque)');
  // A barra amarela do satélite (D11); sem ela, a primeira barra da primeira linha.
  const barra = "(document.querySelector('.linha:last-child .barra-amarela') ?? document.querySelector('.barra'))";
  const resumo = await pagina.avaliar(`({
    legenda: document.getElementById('legenda').textContent,
    barras: Array.from(document.querySelectorAll('.barras'), (g) => g.children.length),
    rodapes: Array.from(document.querySelectorAll('.linha-rodape'), (r) => Array.from(r.children, (c) => c.textContent).join(' | ')),
    linha: ${barra}?.closest('.linha').querySelector('.linha-nome').textContent ?? null,
  })`);
  console.log(`legenda: ${resumo.legenda}; barras por linha: ${resumo.barras.join(', ') || '(nenhuma)'}`);
  for (const r of resumo.rodapes) console.log(`  rodapé: ${r}`);
  if (resumo.linha) {
    await tocar(pagina, barra);
    console.log(`toque na barra de «${resumo.linha}»: dica ${(await pagina.avaliar(dicaDe(barra))) ?? '(não apareceu)'}`);
  } else {
    console.log('nenhuma barra para tocar');
  }
  const verificado = await pagina.avaliar("Array.from(document.querySelectorAll('.linha-verificado'), (e) => e.textContent)");
  console.log(`verificado: ${verificado.length ? verificado.join(' | ') : '(nenhum)'}`);
  const seletor = `(() => ({
    busca: location.search,
    lang: document.documentElement.lang,
    rotulo: getComputedStyle(document.getElementById('idioma-rotulo')).display === 'none' ? '(escondido)' : document.getElementById('idioma-rotulo').textContent,
    opcoes: Array.from(document.querySelectorAll('.idioma-opcao'), (b) => {
      const r = b.getBoundingClientRect();
      return b.textContent + ' aria-pressed=' + b.getAttribute('aria-pressed') + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' px';
    }),
    geral: document.getElementById('geral-texto').textContent,
  }))()`;
  const antes = await pagina.avaliar(seletor);
  console.log(`antes da troca: endereço ${antes.busca || '(sem ?lang=)'}, lang ${antes.lang}; rótulo «${antes.rotulo}»`);
  console.log(`  opções: ${antes.opcoes.join(' · ')}`);
  await tocar(pagina, `document.querySelector('.idioma-opcao[data-idioma="${outro}"]')`);
  const depois = await pagina.avaliar(seletor);
  console.log(`depois de tocar ${outro}: endereço ${depois.busca || '(sem ?lang=)'}, lang ${depois.lang}; rótulo «${depois.rotulo}»`);
  console.log(`  opções: ${depois.opcoes.join(' · ')}`);
  console.log(`  geral: ${depois.geral}`);
  mostrarErros(pagina);
  await pagina.fechar();

  // --- 1440 px, teclado e mouse ---
  pagina = await abrirPagina(cdp, `${base}?lang=${inicial}`, 1440);
  console.log('\n1440 px (teclado e mouse)');
  await pagina.s('Accessibility.enable');
  const fontes = await pagina.avaliar(`(async () => {
    await document.fonts.ready;
    return {
      corpo: getComputedStyle(document.body).fontFamily,
      inter600: document.fonts.check('600 15px Inter'),
      carregadas: Array.from(document.fonts).filter((f) => f.status === 'loaded').map((f) => f.family + ' ' + f.weight + (f.unicodeRange.startsWith('U+0-FF') || f.unicodeRange.startsWith('U+0000') ? ' latin' : ' latin-ext')),
      peso700: Array.from(document.querySelectorAll('body *')).filter((e) => getComputedStyle(e).fontWeight === '700').map((e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '')),
    };
  })()`);
  console.log(`fonte do corpo: ${fontes.corpo}; Inter 600 pronta: ${fontes.inter600}`);
  console.log(`fontes carregadas: ${fontes.carregadas.join(', ') || '(nenhuma)'}`);
  console.log(`elementos com peso 700: ${fontes.peso700.join(', ') || 'nenhum'}`);

  console.log('Tab a partir do início:');
  const paradas = [];
  for (let i = 1; i <= 10; i += 1) {
    await tecla(pagina, 'Tab');
    const f = await pagina.avaliar(FOCO);
    mostrarFoco(`Tab ${i}`, f);
    if (!f) break;
    paradas.push(f);
  }
  console.log(`  paradas de Tab: ${paradas.length} (barras: ${paradas.filter((f) => f.elemento.includes('.barra')).length})`);

  // Volta ao dia de hoje da primeira linha com barras, pelo foco programático, e anda com as setas.
  const primeiraBarra = "document.querySelector('.barras .barra[tabindex=\"0\"]')";
  const temBarra = await pagina.avaliar(`(() => { const b = ${primeiraBarra}; if (!b) return false; b.focus(); return true; })()`);
  if (temBarra) {
    const focada = "document.activeElement";
    console.log('Setas no grupo de barras:');
    mostrarFoco('foco inicial', await pagina.avaliar(FOCO));
    console.log(`      dica: ${(await pagina.avaliar(dicaDe(focada))) ?? '(fechada)'}`);
    for (const nome of ['ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowRight', 'Home', 'ArrowLeft', 'End', 'ArrowRight']) {
      await tecla(pagina, nome);
      const r = await pagina.avaliar(`(() => {
        const e = document.activeElement;
        const grupo = e.closest('.barras');
        return {
          nome: e.getAttribute('aria-label'),
          indice: grupo ? Array.prototype.indexOf.call(grupo.children, e) : -1,
          total: grupo ? grupo.children.length : 0,
          paradas: grupo ? grupo.querySelectorAll('[tabindex="0"]').length : 0,
        };
      })()`);
      const d = await pagina.avaliar(dicaDe(focada));
      console.log(`  ${nome}: dia ${r.indice + 1}/${r.total} «${r.nome}»; tabindex=0 no grupo: ${r.paradas}; dica: ${d ?? '(fechada)'}`);
    }
    console.log('Árvore de acessibilidade do Chrome:');
    mostrarNo('seletor', await noDeAcessibilidade(pagina, '#idioma'));
    mostrarNo('  PT-BR', await noDeAcessibilidade(pagina, '#idioma-pt'));
    mostrarNo('  ES-PY', await noDeAcessibilidade(pagina, '#idioma-es'));
    mostrarNo('faixa geral', await noDeAcessibilidade(pagina, '#geral'));
    mostrarNo('grupo de barras', await noDeAcessibilidade(pagina, '.barras'));
    mostrarNo('dia focado', await noDeAcessibilidade(pagina, '.barras .barra[tabindex="0"]'));
    mostrarNo('dica', await noDeAcessibilidade(pagina, '.dica'));

    await tecla(pagina, 'Escape');
    console.log(`Esc: dica ${(await pagina.avaliar(dicaDe(focada))) ?? '(fechada)'}; foco ainda em «${(await pagina.avaliar(FOCO))?.nome}»`);

    // O mouse: sem foco, passa sobre o 10º dia da primeira linha e depois sai.
    await pagina.avaliar('document.activeElement.blur()');
    const decimo = "document.querySelector('.barras').children[9]";
    const ponto = await pagina.avaliar(`(() => {
      const b = ${decimo};
      b.scrollIntoView({ block: 'center' });
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    await pagina.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ponto.x, y: ponto.y });
    await esperar(150);
    console.log(`mouse sobre o 10º dia: dica ${(await pagina.avaliar(dicaDe(decimo))) ?? '(fechada)'}`);
    await pagina.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
    await esperar(150);
    console.log(`mouse fora das barras: dica ${(await pagina.avaliar(dicaDe(decimo))) ?? '(fechada)'}`);
    await pagina.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ponto.x, y: ponto.y });
    await esperar(150);
    await tecla(pagina, 'Escape');
    console.log(`mouse de volta e Esc: dica ${(await pagina.avaliar(dicaDe(decimo))) ?? '(fechada)'}`);
  } else {
    console.log('nenhuma barra na página (setas, Esc e mouse não testados)');
  }

  // O seletor pelo teclado: foco na opção do outro idioma e Enter.
  await pagina.avaliar(`document.querySelector('.idioma-opcao[data-idioma="${outro}"]').focus()`);
  await tecla(pagina, 'Enter');
  const troca = await pagina.avaliar(seletor);
  console.log(`Enter em ${outro}: endereço ${troca.busca}, lang ${troca.lang}; ${troca.opcoes.join(' · ')}`);
  mostrarFoco('foco depois da troca', await pagina.avaliar(FOCO));
  mostrarErros(pagina);
  await pagina.fechar();
}

let codigo = 0;
try {
  const raiz = montarSite();
  servidor = await servir(raiz);
  const base = `http://127.0.0.1:${servidor.address().port}/status/`;
  const cdp = await conectar(await abrirChrome());
  if (values.interagir) await interagir(cdp, base);
  else await fotografar(cdp, base, values.saida);
} catch (erro) {
  console.error(`Erro: ${erro.message}`);
  codigo = 1;
} finally {
  await encerrar();
}
process.exit(codigo);
