// D12: as fotos da página com os dados de exemplo.
//   node scripts/fotos.mjs --saida <pasta> [--tema claro|escuro]
//   node scripts/fotos.mjs --interagir [--tema claro|escuro]
// Monta o site numa pasta temporária, serve em 127.0.0.1 (porta livre, sob /status/) com node:http, abre o
// Chrome sem janela com perfil temporário e fala com ele pelo protocolo de depuração (WebSocket do Node 22).
// Fotografa a página inteira em pt-BR e es-PY a 360 e 1440 px e imprime a largura de rolagem e o `lang`.
// Com --interagir: toca numa barra, troca o idioma e imprime a dica, o ?lang=, o lang e os erros do console.
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
};

const { values } = parseArgs({
  options: {
    saida: { type: 'string' },
    tema: { type: 'string', default: 'claro' },
    interagir: { type: 'boolean', default: false },
  },
});
if (!['claro', 'escuro'].includes(values.tema) || (!values.interagir && !values.saida)) {
  console.error('Uso: node scripts/fotos.mjs --saida <pasta> [--tema claro|escuro]');
  console.error('     node scripts/fotos.mjs --interagir [--tema claro|escuro]');
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

// O site com os dados de exemplo, em <tmp>/status.
function montarSite() {
  const raiz = join(temporaria('status-fotos-site-'), 'status');
  execFileSync(process.execPath, [join(RAIZ, 'scripts', 'montar-site.mjs'), '--fonte', 'exemplo', '--saida', raiz], {
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
  for (const idioma of IDIOMAS) {
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

async function interagir(cdp, base) {
  const largura = 360;
  const pagina = await abrirPagina(cdp, `${base}?lang=pt-BR`, largura);
  // A barra amarela do satélite (D11); sem ela, a primeira barra da primeira linha.
  const barra =
    "(document.querySelector('.linha:last-child .barra-amarela') ?? document.querySelector('.barra'))";
  const qual = await pagina.avaliar(`(() => {
    const b = ${barra};
    const linha = b.closest('.linha');
    return { linha: linha.querySelector('.linha-nome').textContent, dia: b.title };
  })()`);
  console.log(`Largura ${largura} px, tema ${values.tema}. Toque na barra de «${qual.linha}».`);
  await tocar(pagina, barra);
  const dica = await pagina.avaliar(`(() => {
    const d = ${barra}.closest('.linha').querySelector('.dica');
    return d.hidden ? null : d.textContent;
  })()`);
  console.log(`dica: ${dica ?? '(não apareceu)'}`);
  const verificado = await pagina.avaliar(
    "Array.from(document.querySelectorAll('.linha-verificado'), (e) => e.textContent)",
  );
  console.log(`verificado: ${verificado.length ? verificado.join(' | ') : '(nenhum)'}`);

  const antes = await pagina.avaliar('({ busca: location.search, lang: document.documentElement.lang })');
  console.log(`antes da troca: endereço ${antes.busca || '(sem ?lang=)'}, lang ${antes.lang}`);
  await tocar(pagina, "document.getElementById('idioma')");
  const depois = await pagina.avaliar(`({
    busca: location.search,
    lang: document.documentElement.lang,
    botao: document.getElementById('idioma').textContent,
    geral: document.getElementById('geral').textContent,
    verificado: Array.from(document.querySelectorAll('.linha-verificado'), (e) => e.textContent),
  })`);
  console.log(`depois da troca: endereço ${depois.busca || '(sem ?lang=)'}, lang ${depois.lang}`);
  console.log(`  botão: ${depois.botao}; geral: ${depois.geral}; verificado: ${depois.verificado.join(' | ') || '(nenhum)'}`);
  console.log(`erros do console: ${pagina.erros.length ? '' : 'nenhum'}`);
  for (const e of pagina.erros) console.log(`  ${e}`);
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
