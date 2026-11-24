// A página de status. Texto vindo dos JSON entra só por textContent ou atributo.
import { TEXTOS } from './textos.mjs';
import { preencher } from './lib/texto.mjs';
import {
  dataDeAssuncao,
  diaDeAssuncao,
  formatarDia,
  horaDeAssuncao,
  emMs,
  minutosDesde,
  somarDias,
} from './lib/tempo.mjs';
import {
  DIAS_GUARDADOS,
  corDoDia,
  disponibilidade,
  esperadasNoDia,
  intervaloDaLinha,
  linhaPorFato,
  temIncidenteDegradadoNoDia,
} from './lib/dias.mjs';
import { estadoAtual, incidentesRecentes, partesDaDuracao } from './lib/incidentes.mjs';
import { estadoGeral } from './lib/geral.mjs';

const IDIOMAS = ['pt-BR', 'es-PY'];
const $ = (id) => document.getElementById(id);

let idioma = idiomaInicial();
let dados = { estado: { verificado_em: null, linhas: [] }, dias: {}, incidentes: [] };

function idiomaInicial() {
  const pedido = new URLSearchParams(location.search).get('lang');
  if (IDIOMAS.includes(pedido)) return pedido;
  return (navigator.language || '').toLowerCase().startsWith('es') ? 'es-PY' : 'pt-BR';
}

function t(chave, valores) {
  return preencher(TEXTOS[idioma][chave] ?? '', valores);
}

function el(tag, classe, texto) {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (texto !== undefined) e.textContent = texto;
  return e;
}

async function carregar(nome) {
  const r = await fetch(`dados/${nome}.json`, { cache: 'no-store' });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

function agora() {
  return dados.estado.exemplo === true && dados.estado.agora ? emMs(dados.estado.agora) : Date.now();
}

function formatarDuracao(incidente, instante) {
  const p = partesDaDuracao(incidente, instante);
  return t(`duracao.${p.forma}`, p);
}

function desenharTopo() {
  document.documentElement.lang = idioma;
  document.title = `${t('titulo')} · ${t('marca')}`;
  $('marca').textContent = t('marca');
  $('titulo').textContent = t('titulo');
  const botao = $('idioma');
  const outro = idioma === 'pt-BR' ? 'es-PY' : 'pt-BR';
  botao.textContent = t('idioma.trocar');
  botao.lang = outro;
  botao.setAttribute('aria-label', t('idioma.rotulo'));
  botao.hidden = false;

  const aviso = $('aviso');
  aviso.hidden = dados.estado.exemplo !== true;
  aviso.textContent = aviso.hidden ? '' : t('exemplo.aviso');
}

function desenharGeral(instante) {
  const estados = dados.estado.linhas.map((l) => l.estado);
  const geral = estadoGeral(estados, dados.estado.verificado_em, instante);
  const faixa = $('geral');
  faixa.className = `geral geral-${geral}`;
  faixa.textContent = t(`geral.${geral}`);
  faixa.hidden = false;
}

function desenharBarras(linha, instante, dica) {
  const hoje = diaDeAssuncao(instante);
  const porDia = dados.dias[linha.id] ?? {};
  const barras = el('div', 'barras');
  barras.setAttribute('role', 'img');
  const registros = [];
  const botoes = [];
  // D11: a linha por fato tem os seus previstos por dia, a sua disponibilidade e a sua cor.
  const porFato = linhaPorFato(linha);
  const intervalo = intervaloDaLinha(linha);

  for (let n = DIAS_GUARDADOS - 1; n >= 0; n -= 1) {
    const dia = somarDias(hoje, -n);
    const registro = porDia[dia];
    if (registro) registros.push(registro);
    const cor = corDoDia({
      registro,
      temDegradado: temIncidenteDegradadoNoDia(dados.incidentes, linha.id, dia, instante),
      esperadas: esperadasNoDia(dia, instante, intervalo),
      porFato,
    });
    const texto =
      registro && registro.feitas > 0
        ? t('barra.dica', {
            dia: formatarDia(dia),
            pct: disponibilidade([registro], { porFato }),
            minutos: registro.minutos_fora,
          })
        : t('barra.sem_dado', { dia: formatarDia(dia) });
    const botao = el('button', `barra barra-${cor}`);
    botao.type = 'button';
    botao.title = texto;
    botao.tabIndex = n === 0 ? 0 : -1;
    botao.dataset.dica = texto;
    botoes.push(botao);
    barras.append(botao);
  }

  const pct = disponibilidade(registros, { porFato });
  barras.setAttribute('aria-label', t('barras.resumo', { pct }));

  function mostrar(botao) {
    for (const b of botoes) b.classList.toggle('barra-escolhida', b === botao);
    dica.textContent = botao.dataset.dica;
    dica.hidden = false;
  }
  barras.addEventListener('click', (evento) => {
    const botao = evento.target.closest('.barra');
    if (botao) mostrar(botao);
  });
  barras.addEventListener('focusin', (evento) => {
    if (evento.target.classList.contains('barra')) mostrar(evento.target);
  });
  barras.addEventListener('keydown', (evento) => {
    const atual = botoes.indexOf(document.activeElement);
    if (atual < 0) return;
    const destino = { ArrowLeft: atual - 1, ArrowRight: atual + 1, Home: 0, End: botoes.length - 1 }[evento.key];
    if (destino === undefined || destino < 0 || destino >= botoes.length) return;
    evento.preventDefault();
    botoes[atual].tabIndex = -1;
    botoes[destino].tabIndex = 0;
    botoes[destino].focus();
  });
  return { barras, pct };
}

function desenharLinhas(instante) {
  $('legenda').textContent = t('barras.legenda');
  const lista = $('linhas');
  lista.replaceChildren();
  for (const linha of dados.estado.linhas) {
    const item = el('li', 'linha');
    const topo = el('div', 'linha-topo');
    const cabeca = el('div', 'linha-cabeca');
    cabeca.append(el('span', 'linha-nome', linha.nome[idioma]));
    // D11: «Verificado há {minutos} min», do último fato; sem fato, não mostra.
    const minutos = linhaPorFato(linha) ? minutosDesde(linha.verificado_em, instante) : null;
    if (minutos !== null) cabeca.append(el('span', 'linha-verificado', t('satelite.verificado', { minutos })));
    topo.append(cabeca, el('span', `linha-estado estado-${linha.estado}`, t(`linha.${linha.estado}`)));
    const dica = el('p', 'dica');
    dica.hidden = true;
    dica.setAttribute('aria-live', 'polite');
    const { barras, pct } = desenharBarras(linha, instante, dica);
    const rodape = el('div', 'linha-rodape');
    rodape.append(
      el('span', null, t('barras.dias_atras', { n: DIAS_GUARDADOS })),
      el('span', 'linha-pct', t('barras.disponibilidade', { pct })),
      el('span', null, t('barras.hoje')),
    );
    item.append(topo, barras, dica, rodape);
    lista.append(item);
  }
  $('cartao').hidden = false;
}

function quando(instante) {
  return `${dataDeAssuncao(instante)} ${horaDeAssuncao(instante)}`;
}

function desenharIncidentes(instante) {
  $('incidentes-titulo').textContent = t('incidentes.titulo');
  const caixa = $('incidentes');
  caixa.replaceChildren();
  const recentes = incidentesRecentes(dados.incidentes, instante);
  if (recentes.length === 0) {
    caixa.append(el('p', 'incidentes-nenhum', t('incidentes.nenhum')));
  } else {
    const lista = el('ul', 'incidentes-lista');
    for (const i of recentes) {
      const item = el('li', `incidente incidente-${i.fim === null ? 'aberto' : 'fechado'}`);
      item.append(el('h3', 'incidente-titulo', i.titulo[idioma]));
      const meta = el('p', 'incidente-meta');
      meta.append(
        el('span', `incidente-tipo tipo-${i.tipo}`, t(`incidente.tipo_${i.tipo}`)),
        el('span', 'incidente-estado', t(`incidente.${estadoAtual(i)}`)),
        el('span', null, t('incidente.duracao', { duracao: formatarDuracao(i, instante) })),
      );
      item.append(meta);
      const atualizacoes = el('ol', 'atualizacoes');
      for (const a of [...i.atualizacoes].reverse()) {
        const linha = el('li', 'atualizacao');
        const cabeca = el('p', 'atualizacao-cabeca');
        cabeca.append(el('strong', null, t(`incidente.${a.estado}`)), el('time', null, quando(a.em)));
        cabeca.lastChild.dateTime = a.em;
        linha.append(cabeca, el('p', 'atualizacao-texto', a.texto[idioma]));
        atualizacoes.append(linha);
      }
      item.append(atualizacoes);
      lista.append(item);
    }
    caixa.append(lista);
  }
  $('secao-incidentes').hidden = false;
}

function desenharRodape() {
  const v = dados.estado.verificado_em;
  $('atualizado').textContent = t('rodape.atualizado', { hora: v ? horaDeAssuncao(v) : '—' });
  $('contato').textContent = t('rodape.contato');
}

function desenhar() {
  const instante = agora();
  desenharTopo();
  desenharGeral(instante);
  desenharLinhas(instante);
  desenharIncidentes(instante);
  desenharRodape();
}

$('idioma').addEventListener('click', () => {
  idioma = idioma === 'pt-BR' ? 'es-PY' : 'pt-BR';
  const url = new URL(location.href);
  url.searchParams.set('lang', idioma);
  history.replaceState(null, '', url);
  desenhar();
});

try {
  const [estado, dias, incidentes] = await Promise.all([carregar('estado'), carregar('dias'), carregar('incidentes')]);
  dados = { estado, dias, incidentes: incidentes.incidentes ?? [] };
} catch {
  // Sem dados: a página mostra «monitoramento atrasado».
}
desenhar();
