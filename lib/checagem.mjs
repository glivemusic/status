// Uma execução da checagem, em duas partes (D13):
// `medirChecagem` chama os alvos (a única parte que usa a rede) e `aplicarMedida` atualiza estado, dias e
// incidentes a partir da medida, sem rede nem relógio (pura). A gravação no ramo `dados` reaplica a mesma medida
// sobre os dados recém-buscados em cada tentativa.
// Tudo de fora (fetch, relógio, espera, catálogo) entra por parâmetro.
import { checarAlvo } from './classificar.mjs';
import { atualizarMinutosFora, cortarDias, linhaPorFato, registrarChecagem } from './dias.mjs';
import { aplicarChecagem, aplicarFato, linhaVazia, zerarSerie } from './estado.mjs';
import { CHAVES_DO_SATELITE, cortarIncidentes, fecharAutomatico, novoIncidenteAutomatico } from './incidentes.mjs';
import { emMs } from './tempo.mjs';

export const PUBLICAR_A_CADA_MS = 15 * 60_000;

// As linhas checadas: nem `pendente` (D2) nem `em_breve` (D17). As outras não são chamadas e não recebem medida
// nova (estado, dia, incidente). Do que o ramo já tiver delas, o estado fica como está, mas os cortes (90 dias e
// 1 ano) e os minutos fora de incidente antigo ainda correm nos dias delas. A página não mostra nada delas.
const checadas = (config) => config.linhas.filter((l) => !l.pendente && !l.em_breve);

// -> { instante (ISO), resultados: { <linha>: estado }, fatos: { <linha por fato>: verificado_em | null },
//      motivos: { <id do alvo>: texto fixo } }
// D25: `motivos` só tem os alvos cuja checagem falhou e só vai ao log: o arquivo da medida (`arquivoDaMedida`) e o
// ramo `dados` não o recebem.
export async function medirChecagem({ config, fetch, relogio, esperar }) {
  const instante = new Date(relogio()).toISOString();
  const linhas = checadas(config);
  const resultados = {};
  const fatos = {};
  const motivos = {};
  for (const alvo of linhas.filter((l) => l.url)) {
    const dependentes = linhas.filter((l) => l.alvo === alvo.id);
    const saida = await checarAlvo(alvo, dependentes, { fetch, relogio, esperar });
    Object.assign(resultados, saida.resultados);
    Object.assign(fatos, saida.fatos);
    if (saida.motivo) motivos[alvo.id] = saida.motivo;
  }
  return { instante, resultados, fatos, motivos };
}

// D25: o que scripts/checar.mjs grava no arquivo da medida: só { instante, resultados, fatos }, como antes.
export function arquivoDaMedida({ instante, resultados, fatos }) {
  return { instante, resultados, fatos };
}

// `estado`: o estado.json; `dias`: o dias.json; `incidentes`: a lista de incidentes; `medida`: de `medirChecagem`.
// -> { estado, dias, incidentes, publicar, resultados, repetidas }
// `repetidas`: as linhas por fato (D11) cuja leitura não contou (fato repetido, mais velho, no futuro ou sem dado).
export function aplicarMedida({ config, estado, dias, incidentes, medida, textos }) {
  const { instante } = medida;
  const resultados = medida.resultados ?? {};
  const fatos = medida.fatos ?? {};
  const novoEstado = structuredClone(estado ?? {});
  novoEstado.linhas ??= {};
  const novosDias = structuredClone(dias ?? {});
  let lista = structuredClone(incidentes ?? []);

  let houveEvento = false;
  const repetidas = [];
  for (const l of checadas(config)) {
    const porFato = linhaPorFato(l);
    let atual = novoEstado.linhas[l.id] ?? linhaVazia();
    let aberto = atual.incidente ? lista.find((i) => i.id === atual.incidente) : undefined;
    if (atual.incidente && (!aberto || aberto.fim !== null)) {
      // O automático foi resolvido à mão (ou sumiu): o próximo problema abre um novo.
      atual = zerarSerie(atual);
      aberto = undefined;
    }

    const resultado = resultados[l.id] ?? 'sem_dado';
    let linha;
    let evento;
    if (porFato) {
      // D11: conta o fato, não a leitura; o dia é o do `verificado_em` do fato.
      // D18: o fato muito à frente da hora da checagem não conta.
      const fato = fatos[l.id] ?? null;
      const aplicado = aplicarFato(atual, resultado, fato, instante);
      ({ linha, evento } = aplicado);
      if (aplicado.contou) registrarChecagem(novosDias, l.id, resultado, fato);
      else repetidas.push(l.id);
    } else {
      ({ linha, evento } = aplicarChecagem(atual, resultado, instante, aberto?.tipo ?? null));
      registrarChecagem(novosDias, l.id, resultado, instante);
    }

    if (evento?.acao === 'abrir') {
      const novo = novoIncidenteAutomatico({
        linha: l.id,
        nome: l.nome,
        tipo: evento.tipo,
        inicio: evento.inicio,
        instante,
        textos,
        chaves: porFato ? CHAVES_DO_SATELITE : null,
      });
      lista.push(novo);
      linha.incidente = novo.id;
      houveEvento = true;
    } else if (evento?.acao === 'mudar_tipo') {
      aberto.tipo = evento.tipo;
      houveEvento = true;
    } else if (evento?.acao === 'fechar') {
      fecharAutomatico(aberto, evento.fim, instante, textos);
      linha.incidente = null;
      houveEvento = true;
    }

    novoEstado.linhas[l.id] = linha;
  }

  lista = cortarIncidentes(lista, instante);
  cortarDias(novosDias, instante);
  atualizarMinutosFora(novosDias, lista, instante);

  novoEstado.verificado_em = instante;
  const ultimo = novoEstado.publicado_em ? emMs(novoEstado.publicado_em) : null;
  const publicar = houveEvento || ultimo === null || emMs(instante) - ultimo > PUBLICAR_A_CADA_MS;
  if (publicar) novoEstado.publicado_em = instante;

  return { estado: novoEstado, dias: novosDias, incidentes: lista, publicar, resultados, repetidas };
}

// Medir e aplicar de uma vez (os testes de D4 e D11).
export async function executarChecagem({ config, estado, dias, incidentes, fetch, relogio, esperar, textos }) {
  const medida = await medirChecagem({ config, fetch, relogio, esperar });
  return aplicarMedida({ config, estado, dias, incidentes, medida, textos });
}
