import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  BarrasComparadas,
  BarrasEmpilhadas,
  CORES_DE_ESTADO,
  PALETA,
  type SerieGrafico,
} from '../../components/graficos';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  Carregando,
  Indicador,
  Pagina,
  Selo,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { formatBRL, formatData } from '../../lib/format';
import type {
  ContaAberta,
  ContasAbertas,
  PagamentosDoMes,
} from '../../lib/types';
import { DetalheDaConta } from './DetalheDaConta';
import { PraOndeVaiODinheiro } from './PraOndeVaiODinheiro';

/**
 * O dashboard do que a empresa deve, na ordem em que as perguntas aparecem para
 * quem paga: **quanto** está em aberto, **como fecha o mês**, **o que sai nesta
 * semana**, **com o quê** se está devendo, **quando** vence o resto e **a quem**
 * se deve.
 *
 * A ordem não é enfeite. As primeiras seções respondem o dia de trabalho — o
 * que precisa sair agora — e as de baixo respondem o mês. Um dashboard que abre
 * por gráfico anual obriga a rolar para achar a conta que vence hoje.
 *
 * Roda sobre a mesma leitura da tela de lista — mesma chave de consulta, mesma
 * resposta do IXC. Trocar de aba não faz o IXC ser consultado de novo, e os
 * dois lados nunca mostram totais diferentes por terem lido em momentos
 * distintos.
 */

/** Quantas fatias os gráficos mostram antes de juntar o resto. */
const TETO_DE_FATIAS = 8;

/** Quantos dias a agenda de pagamento cobre. */
const DIAS_NA_AGENDA = 14;

/** Quantas contas a fila de pagamento lista antes de mandar para a lista. */
const TETO_DA_FILA = 8;

export function Dashboard() {
  const consulta = useQuery({
    queryKey: ['contas-abertas'],
    queryFn: async () => (await api.get<ContasAbertas>('/contas-abertas')).data,
    retry: 0,
  });

  /** Conta cuja ficha está aberta — a fila daqui abre o mesmo detalhe da lista. */
  const [detalhando, setDetalhando] = useState<ContaAberta | null>(null);

  /**
   * Quanto já saiu no mês. É outra leitura do IXC porque a lista de abertas,
   * por definição, não sabe nada do que já foi pago — e sem esse número o
   * dashboard só conta metade do mês.
   */
  const pagas = useQuery({
    queryKey: ['pagas-no-mes'],
    queryFn: async () =>
      (await api.get<PagamentosDoMes>('/contas-abertas/pagas-no-mes')).data,
    retry: 0,
  });

  // A lista vazia sai de um `useMemo` para ser sempre o mesmo array: um `[]`
  // criado a cada render refaria todos os agrupamentos abaixo sem nada ter
  // mudado.
  const contas = useMemo(() => consulta.data?.contas ?? [], [consulta.data]);

  /*
   * O "com o quê" mora agora no bloco "Para onde está indo o dinheiro", que
   * soma por categoria-mãe, faz o mesmo para o que já foi pago e abre cada
   * barra nas contas que a compõem. Aqui ficou o que ele não responde: a quem
   * se deve, quando vence, e o que precisa sair primeiro.
   */
  const porFornecedor = useMemo(
    () => agrupar(contas, (c) => c.fornecedor.nome || 'Sem fornecedor'),
    [contas],
  );
  const porMes = useMemo(() => agruparPorMes(contas), [contas]);
  const agenda = useMemo(() => agruparPorDia(contas), [contas]);
  /** O que ainda não foi etiquetado — fica de fora de todo relatório por categoria. */
  const semClassificar = useMemo(
    () => contas.filter((c) => !c.classificacao),
    [contas],
  );
  /** O que precisa sair primeiro: o que venceu, depois o que vence antes. */
  const fila = useMemo(() => filaDePagamento(contas), [contas]);

  /**
   * O que ainda tem de sair até o dia 31. Inclui o que já venceu: atraso não
   * deixa de ser dívida por ter passado da data, e é dinheiro que o caixa deste
   * mês precisa cobrir do mesmo jeito.
   */
  const aPagarNoMes = useMemo(() => {
    const fim = ultimoDiaDoMes();
    return contas.filter(
      (c) => c.vencimento !== null && String(c.vencimento).slice(0, 10) <= fim,
    );
  }, [contas]);

  const resumo = consulta.data?.resumo;
  const total = resumo?.total ?? 0;

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Dashboard"
        titulo="Como está o contas a pagar"
        descricao="A mesma leitura da lista: como fecha o mês, o que vence nos próximos dias, com o que se está gastando e a quem se deve."
        acoes={
          <button
            onClick={() => consulta.refetch()}
            disabled={consulta.isFetching}
            className="btn btn-acao"
          >
            {consulta.isFetching ? 'Lendo o IXC…' : 'Atualizar'}
          </button>
        }
      />

      {consulta.error && (
        <Aviso tom="erro">
          Não deu para ler as contas do IXC: {mensagemErro(consulta.error)}
          {consulta.data ? ' Os números são da última leitura que deu certo.' : ''}
        </Aviso>
      )}

      {!consulta.data ? (
        <Bloco semPadding>
          {consulta.error ? (
            <Vazio titulo="Não deu para ler o IXC">
              Os números saem das contas que estão no IXC, e ele não respondeu
              agora. Tente de novo em Atualizar.
            </Vazio>
          ) : (
            <Carregando texto="Lendo as contas no IXC…" />
          )}
        </Bloco>
      ) : contas.length === 0 ? (
        <Bloco semPadding>
          <Vazio titulo="Nada em aberto">
            Não há conta em aberto no IXC neste momento — por isso não há o que
            desenhar.
          </Vazio>
        </Bloco>
      ) : (
        <div className="space-y-4">
          {/* --- Os quatro números que se olha primeiro --- */}
          {resumo && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Indicador
                rotulo="Total em aberto"
                valor={formatBRL(resumo.total)}
                detalhe={`${resumo.quantidade} título(s) no IXC`}
                acento
              />
              <Indicador
                rotulo="Vencidas"
                valor={formatBRL(resumo.vencidas.total)}
                detalhe={`${resumo.vencidas.quantidade} título(s)`}
                alerta={
                  resumo.vencidas.quantidade > 0
                    ? 'Já passou do vencimento'
                    : undefined
                }
              />
              <Indicador
                rotulo="Vencem em 7 dias"
                valor={formatBRL(resumo.venceEmSeteDias.total)}
                detalhe={`${resumo.venceEmSeteDias.quantidade} título(s) — é o que o caixa precisa ter na semana`}
              />
              <Indicador
                rotulo="Sem categoria"
                valor={formatBRL(somar(semClassificar))}
                detalhe={
                  semClassificar.length
                    ? `${semClassificar.length} título(s) fora dos gráficos por categoria`
                    : 'Tudo classificado'
                }
                alerta={
                  semClassificar.length > 0
                    ? 'Esse dinheiro não aparece por categoria'
                    : undefined
                }
              />
            </div>
          )}

          {/* O fechamento do mês num bloco só. Antes eram dois números soltos,
              lado a lado, e faltava justamente o que se pergunta primeiro:
              quanto o mês inteiro custa e que parte dele já saiu. A barra
              responde isso de longe; os números embaixo dela dão a conferência.
              Os dois lados saem do contas a pagar do IXC, que é por onde passa
              todo o dinheiro da empresa — a folha inclusive. */}
          <Bloco titulo="O mês" className="surgir surgir-1">
            <FechamentoDoMes
              aPagar={somar(aPagarNoMes)}
              quantidadeAPagar={aPagarNoMes.length}
              pagas={pagas.data ?? null}
              carregando={pagas.isLoading}
              erro={!!pagas.error}
            />
          </Bloco>

          {/* --- O dia de trabalho: o que sai nos próximos dias --- */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
            <Bloco
              titulo={`Agenda dos próximos ${DIAS_NA_AGENDA} dias`}
              className="surgir surgir-2 xl:col-span-3"
              esticado
            >
              {/* O gráfico cresce até o pé do cartão: ao lado dele fica a fila,
                  que é alta, e barras maiores se comparam melhor do que um
                  gráfico baixinho com meio cartão vazio embaixo. */}
              <AgendaDosDias dias={agenda} />
              <p className="ajuda shrink-0">
                Cada coluna é um dia. Sábado e domingo aparecem apagados: o
                banco não paga neles, então o que vence no fim de semana precisa
                sair antes.
              </p>
            </Bloco>

            <Bloco
              titulo="Fila de pagamento"
              className="surgir surgir-3 xl:col-span-2"
              semPadding
            >
              <FilaDePagamento
                contas={fila}
                onAbrir={(c) => setDetalhando(c)}
              />
            </Bloco>
          </div>

          {/* --- O mês: com o quê, quando e a quem --- */}
          <Bloco titulo="Por mês de vencimento" className="surgir surgir-4">
            <BarrasEmpilhadas meses={porMes} series={SERIES_DO_MES} />
            <p className="ajuda">
              A primeira coluna junta tudo que já venceu, de qualquer ano. As
              seguintes são os próximos doze meses, um a um — é a leitura que
              diz quanto o caixa precisa ter e quando.
            </p>
          </Bloco>

          {/* Estes dois lêem-se em par — "com o quê" e "com quem" —, e são
              listas de barras curtas: lado a lado numa tela larga cabem sem
              apertar e poupam uma rolagem inteira. */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {/* Para onde o dinheiro vai: por categoria-mãe, dos dois lados —
                o que ainda vai sair e o que já saiu —, e cada barra abre nas
                contas que a somam. O bloco anterior mostrava só o que se deve,
                e o número morria na barra. */}
            <PraOndeVaiODinheiro contas={contas} />

            <Bloco titulo="Maiores credores" className="surgir surgir-4" esticado>
              <BarrasComparadas itens={paraBarras(porFornecedor, total)} />
              <Concentracao grupos={porFornecedor} total={total} />
            </Bloco>
          </div>
        </div>
      )}

      {detalhando && (
        <DetalheDaConta
          conta={detalhando}
          onFechar={() => setDetalhando(null)}
        />
      )}
    </Pagina>
  );
}

/**
 * Uma fatia de uma leitura em barra: um pedaço do dinheiro, com o nome e a cor
 * que o identificam.
 */
interface Fatia {
  rotulo: string;
  cor: string;
  total: number;
  quantidade: number;
}

/**
 * Uma barra só, dividida, com a legenda embaixo — a forma em que este dashboard
 * responde toda pergunta de "quanto disto é aquilo": urgência, aprovação no
 * IXC, origem da dívida e fechamento do mês.
 *
 * É sempre proporcional ao **dinheiro**, nunca à quantidade de títulos: contar
 * títulos esconde uma conta de cem mil no meio de trinta de cinquenta reais.
 *
 * Os segmentos são separados por um fio da cor do cartão — encostados, duas
 * cores vizinhas viram uma mancha só. E o valor aparece sempre em número ao
 * lado do rótulo: cor sozinha não serve a quem não a distingue.
 */
function BarraDeFatias({ fatias }: { fatias: Fatia[] }) {
  const comValor = fatias.filter((f) => f.quantidade > 0);
  const total = comValor.reduce((s, f) => s + f.total, 0) || 1;

  return (
    <div>
      <div className="flex h-4 w-full gap-[2px] overflow-hidden rounded-full bg-tinta-100">
        {comValor.map((f) => (
          <div
            key={f.rotulo}
            style={{ width: `${(f.total / total) * 100}%`, background: f.cor }}
            title={`${f.rotulo}: ${formatBRL(f.total)} em ${f.quantidade} título(s)`}
          />
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
        {comValor.map((f) => (
          <span key={f.rotulo} className="flex items-center gap-2 text-xs">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: f.cor }}
            />
            <span className="text-tinta-500">{f.rotulo}</span>
            <span className="valor text-[12px] text-tinta-700">
              {formatBRL(f.total)}
            </span>
            <span className="text-tinta-400">
              ({f.quantidade} · {Math.round((f.total / total) * 100)}%)
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Como o mês fecha: o que já saiu e o que ainda tem de sair, na mesma barra.
 *
 * Os dois números existiam soltos, um ao lado do outro, e faltava o que se
 * pergunta primeiro — quanto o mês custa por inteiro e que parte dele já
 * passou. Somados numa barra, isso se lê sem conta de cabeça; separados em dois
 * cartões, não se lia.
 *
 * O que já venceu e não foi pago entra no "a pagar": atraso não deixa de ser
 * dívida por ter passado da data, e é dinheiro que este mês precisa cobrir.
 */
function FechamentoDoMes({
  aPagar,
  quantidadeAPagar,
  pagas,
  carregando,
  erro,
}: {
  aPagar: number;
  quantidadeAPagar: number;
  pagas: PagamentosDoMes | null;
  carregando: boolean;
  erro: boolean;
}) {
  // Sem a leitura do que já saiu não dá para desenhar a barra: ela ficaria
  // dizendo que 100% do mês está por pagar, que é uma afirmação — e errada.
  if (!pagas) {
    return (
      <div>
        <p className="valor text-[22px] text-tinta-900">{formatBRL(aPagar)}</p>
        <p className="ajuda">
          ainda a pagar até o fim do mês, em {quantidadeAPagar} título(s), o
          atraso incluído.{' '}
          {erro
            ? 'Não deu para ler do IXC quanto já saiu neste mês.'
            : carregando
              ? 'Lendo do IXC quanto já saiu…'
              : ''}
        </p>
      </div>
    );
  }

  const doMes = pagas.total + aPagar;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">O mês inteiro</p>
          <p className="valor text-[25px] leading-none text-tinta-900">
            {formatBRL(doMes)}
          </p>
        </div>
        <p className="text-xs text-tinta-400">
          {doMes > 0 ? Math.round((pagas.total / doMes) * 100) : 0}% já saiu
          {pagas.completo ? '' : ' — leitura parcial do IXC'}
        </p>
      </div>

      <BarraDeFatias
        fatias={[
          {
            rotulo: 'Já pago neste mês',
            cor: CORES_DE_ESTADO.prazo,
            total: pagas.total,
            quantidade: pagas.quantidade,
          },
          {
            rotulo: 'Ainda a pagar',
            cor: PALETA[0],
            total: aPagar,
            quantidade: quantidadeAPagar,
          },
        ]}
      />
      <p className="ajuda">
        O que ainda tem de sair inclui o atraso: conta vencida continua sendo
        dinheiro que este mês precisa cobrir.
      </p>

      {/* A economia não entra na barra: ela não é uma fatia do mês, é dinheiro
          que não saiu. Somá-la ao pago inflaria o mês com uma despesa que não
          existiu, e por isso ela vem como uma linha à parte — só quando houve
          alguma, para não pôr "R$ 0,00 economizado" em todo mês comum. */}
      {pagas.economia > 0 && (
        <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-300">
          <span className="valor">{formatBRL(pagas.economia)}</span> de economia
          no mês — desconto obtido por antecipar pagamentos. Os títulos valiam{' '}
          {formatBRL(pagas.total + pagas.economia)} e saíram por{' '}
          {formatBRL(pagas.total)}.
        </p>
      )}
    </div>
  );
}

interface DiaDaAgenda {
  /** AAAA-MM-DD */
  dia: string;
  /** Dia do mês, para o rótulo. */
  numero: number;
  /** Sigla do dia da semana. */
  semana: string;
  fimDeSemana: boolean;
  hoje: boolean;
  total: number;
  quantidade: number;
  /** Vencidas de antes da janela, empilhadas no primeiro dia. */
  atrasado: boolean;
}

/**
 * Quanto sai em cada um dos próximos dias. É a leitura que a tela de lista não
 * dá: lá as contas estão em ordem, mas ninguém soma de cabeça o que cai na
 * terça.
 *
 * A primeira coluna é o atraso acumulado — tudo que já venceu, de qualquer
 * data. Ela fica junto porque atraso também precisa sair do caixa desta
 * semana, e escondê-la faria a agenda parecer mais leve do que é.
 */
function AgendaDosDias({ dias }: { dias: DiaDaAgenda[] }) {
  const maior = Math.max(1, ...dias.map((d) => d.total));
  const vazio = dias.every((d) => d.total === 0);

  if (vazio) {
    return (
      <div className="flex min-h-44 flex-1 flex-col justify-center">
        <p className="text-sm text-tinta-400">
          Nada vence nos próximos {DIAS_NA_AGENDA} dias.
        </p>
        <p className="mt-1 text-xs text-tinta-300">
          O que está em aberto vence depois disso — veja o gráfico por mês.
        </p>
      </div>
    );
  }

  return (
    // `min-h` segura o piso num cartão sozinho; o `flex-1` cresce quando há
    // espaço, que é o caso ao lado da fila de pagamento.
    <div className="flex min-h-44 flex-1 items-end gap-1.5">
      {dias.map((d) => (
        <div
          key={d.dia}
          className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5"
          title={
            d.total > 0
              ? `${d.atrasado ? 'Atrasadas' : formatData(d.dia)}: ${formatBRL(d.total)} em ${d.quantidade} título(s)`
              : `${formatData(d.dia)}: nada vence`
          }
        >
          {/* O valor fica sempre visível, não só no hover: quem confere a
              semana quer ler os quatorze números de uma vez, e passar o mouse
              coluna a coluna para descobrir isso não é conferir. */}
          <span
            className={`num shrink-0 text-[10px] font-semibold ${
              d.hoje || d.atrasado ? 'text-tinta-700' : 'text-tinta-400'
            }`}
          >
            {d.total > 0 ? valorDaColuna(d.total) : ''}
          </span>
          <div className="flex w-full flex-1 items-end">
            <div
              className="w-full animate-crescer rounded-t-[4px] transition-opacity group-hover:opacity-80"
              style={{
                height: `${Math.max((d.total / maior) * 100, d.total > 0 ? 3 : 0)}%`,
                background: d.atrasado
                  ? CORES_DE_ESTADO.vencido
                  : d.hoje
                    ? CORES_DE_ESTADO.hoje
                    : PALETA[0],
              }}
            />
          </div>
          <div
            className={`shrink-0 text-center leading-tight ${
              d.hoje ? 'font-semibold text-tinta-700' : 'text-tinta-400'
            }`}
          >
            <div className="num text-[10px]">
              {d.atrasado ? '!' : d.numero}
            </div>
            <div
              className={`text-[9px] uppercase ${
                d.fimDeSemana && !d.atrasado ? 'text-tinta-300' : ''
              }`}
            >
              {d.atrasado ? 'atr.' : d.semana}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * O que pagar primeiro, em ordem de aperto: o que venceu antes vem antes, e o
 * que ainda tem prazo entra por vencimento. Cada linha abre a ficha do débito
 * — daqui até saber o que é a conta são dois cliques, não uma volta pela lista.
 */
function FilaDePagamento({
  contas,
  onAbrir,
}: {
  contas: ContaAberta[];
  onAbrir: (conta: ContaAberta) => void;
}) {
  if (contas.length === 0) {
    return (
      <Vazio titulo="Nada para os próximos dias">
        Não há conta vencida nem vencendo nesta semana. O que está em aberto
        vence mais para a frente.
      </Vazio>
    );
  }

  return (
    <div className="lista-dividida">
      {contas.map((c) => {
        const dias = c.diasParaVencer;
        const atrasada = dias !== null && dias < 0;
        return (
          <button
            key={c.idFnApagar}
            onClick={() => onAbrir(c)}
            className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition hover:bg-tinta-50"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm text-tinta-800">
                {c.fornecedor.nome || `Fornecedor ${c.fornecedor.id ?? '?'}`}
              </span>
              <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                <Selo pequeno tom={atrasada ? 'erro' : dias === 0 ? 'atencao' : 'pago'}>
                  {atrasada
                    ? `${Math.abs(dias)} dia(s) em atraso`
                    : dias === 0
                      ? 'vence hoje'
                      : `em ${dias} dia(s)`}
                </Selo>
                {c.classificacao ? (
                  <span
                    className="text-[11px] text-tinta-400"
                    title={
                      c.classificacao.grupo
                        ? `${c.classificacao.grupo.nome} · ${c.classificacao.nome}`
                        : undefined
                    }
                  >
                    {c.classificacao.nome}
                  </span>
                ) : (
                  <span className="text-[11px] text-amber-600">
                    sem categoria
                  </span>
                )}
              </span>
            </span>
            <span className="valor shrink-0 text-sm">
              {formatBRL(c.valorAberto)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Quanto os maiores credores representam do total. Uma carteira concentrada em
 * três nomes se negocia; espalhada em cem, não — e o gráfico de barras sozinho
 * não responde isso.
 */
function Concentracao({ grupos, total }: { grupos: Grupo[]; total: number }) {
  if (grupos.length < 3 || total <= 0) return null;
  const tresMaiores = grupos.slice(0, 3).reduce((s, g) => s + g.total, 0);
  const fatia = Math.round((tresMaiores / total) * 100);

  return (
    <p className="ajuda">
      Os três maiores somam {formatBRL(tresMaiores)} — {fatia}% de tudo que está
      em aberto.
    </p>
  );
}

const SERIES_DO_MES: SerieGrafico[] = [
  { chave: 'vencido', rotulo: 'Já vencido', cor: CORES_DE_ESTADO.vencido },
  { chave: 'aVencer', rotulo: 'A vencer', cor: PALETA[0] },
];

interface Grupo {
  rotulo: string;
  total: number;
  quantidade: number;
}

/**
 * Soma por chave e devolve do maior para o menor. O que não cabe nas primeiras
 * fatias vira uma linha só — trinta barrinhas de um por cento não são um
 * gráfico, são uma lista ruim.
 */
function agrupar(
  contas: ContaAberta[],
  chave: (c: ContaAberta) => string,
): Grupo[] {
  const mapa = new Map<string, Grupo>();
  for (const c of contas) {
    const k = chave(c);
    const atual = mapa.get(k) ?? { rotulo: k, total: 0, quantidade: 0 };
    atual.total += c.valorAberto;
    atual.quantidade += 1;
    mapa.set(k, atual);
  }

  const ordenado = [...mapa.values()].sort((a, b) => b.total - a.total);
  if (ordenado.length <= TETO_DE_FATIAS) return ordenado;

  const cabem = ordenado.slice(0, TETO_DE_FATIAS);
  const resto = ordenado.slice(TETO_DE_FATIAS);
  cabem.push({
    rotulo: `Outras ${resto.length}`,
    total: resto.reduce((s, g) => s + g.total, 0),
    quantidade: resto.reduce((s, g) => s + g.quantidade, 0),
  });
  return cabem;
}

/**
 * As barras ganham a fatia do total ao lado da contagem: "12 tít." diz quantas
 * contas são, e "· 34%" diz o tamanho daquilo no bolso da empresa.
 */
function paraBarras(grupos: Grupo[], total: number) {
  return grupos.map((g, i) => ({
    rotulo: g.rotulo,
    valor: g.total,
    cor: PALETA[i % PALETA.length],
    detalhe:
      total > 0
        ? `${g.quantidade} tít. · ${Math.round((g.total / total) * 100)}%`
        : `${g.quantidade} tít.`,
  }));
}

/** Quantos meses à frente o calendário mostra antes de juntar o resto. */
const MESES_A_FRENTE = 12;

/**
 * O calendário da dívida, contado a partir de hoje.
 *
 * A primeira versão desenhava do mês do título mais antigo ao do mais novo. Só
 * que uma conta esquecida de 2023 no meio de uma carteira de 2026 abre três
 * anos de eixo: as colunas viravam quarenta, o corte pegava as primeiras, e o
 * gráfico mostrava dezoito meses vazios de 2023 e 2024 enquanto escondia
 * justamente onde está o dinheiro.
 *
 * Agora o eixo é o que serve para planejar o caixa: tudo que já venceu numa
 * coluna só na frente — não importa de que ano —, os doze meses seguintes um a
 * um, e o que passa disso numa última coluna. Os meses vazios do meio ficam,
 * porque é o vazio que mostra o fôlego entre um vencimento e outro.
 */
function agruparPorMes(
  contas: ContaAberta[],
): Array<{ competencia: string; vencido: number; aVencer: number }> {
  const comData = contas.filter((c) => c.vencimento !== null);
  if (comData.length === 0) return [];

  const hoje = new Date();
  const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
  const janela = mesesSeguintes(mesAtual, MESES_A_FRENTE);
  const ultimoDaJanela = janela[janela.length - 1];

  const vencidas = { competencia: 'Vencidas', vencido: 0, aVencer: 0 };
  const depois = { competencia: 'Depois', vencido: 0, aVencer: 0 };
  const porMes = new Map(
    janela.map((m) => [m, { competencia: m, vencido: 0, aVencer: 0 }]),
  );

  for (const c of comData) {
    const mes = String(c.vencimento).slice(0, 7);
    if (c.diasParaVencer !== null && c.diasParaVencer < 0) {
      vencidas.vencido += c.valorAberto;
      continue;
    }
    const alvo =
      mes > ultimoDaJanela ? depois : (porMes.get(mes) ?? depois);
    alvo.aVencer += c.valorAberto;
  }

  // As pontas só aparecem quando têm o que mostrar: uma coluna "vencidas"
  // zerada faria procurar um atraso que não existe.
  return [
    ...(vencidas.vencido > 0 ? [vencidas] : []),
    ...janela.map((m) => porMes.get(m)!),
    ...(depois.aVencer > 0 ? [depois] : []),
  ];
}

const SIGLA_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/**
 * O que vence em cada um dos próximos dias, com o atraso acumulado na frente.
 *
 * As datas do IXC chegam como "AAAA-MM-DD" e são comparadas como texto, sem
 * virar `Date`: converter para data local no fuso de Brasília joga a conta que
 * vence dia 1º para o dia 31, e uma agenda de pagamento errada por um dia é
 * pior que agenda nenhuma.
 */
function agruparPorDia(contas: ContaAberta[]): DiaDaAgenda[] {
  const hoje = new Date();
  const dias: DiaDaAgenda[] = [];

  const atrasadas = contas.filter(
    (c) => c.diasParaVencer !== null && c.diasParaVencer < 0,
  );
  if (atrasadas.length > 0) {
    dias.push({
      dia: 'atrasadas',
      numero: 0,
      semana: '',
      fimDeSemana: false,
      hoje: false,
      atrasado: true,
      total: somar(atrasadas),
      quantidade: atrasadas.length,
    });
  }

  for (let i = 0; i < DIAS_NA_AGENDA; i++) {
    const d = new Date(hoje);
    d.setDate(hoje.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const doDia = contas.filter(
      (c) => c.vencimento !== null && String(c.vencimento).slice(0, 10) === iso,
    );

    dias.push({
      dia: iso,
      numero: d.getDate(),
      semana: SIGLA_SEMANA[d.getDay()],
      fimDeSemana: d.getDay() === 0 || d.getDay() === 6,
      hoje: i === 0,
      atrasado: false,
      total: somar(doDia),
      quantidade: doDia.length,
    });
  }

  return dias;
}

/**
 * A ordem em que as contas precisam sair: as vencidas primeiro, da mais antiga
 * para a mais nova, e depois as da semana. Empatou no prazo, paga a maior —
 * é a que mais pesa se atrasar.
 */
function filaDePagamento(contas: ContaAberta[]): ContaAberta[] {
  return contas
    .filter((c) => c.diasParaVencer !== null && c.diasParaVencer <= 7)
    .sort((a, b) => {
      const prazo = (a.diasParaVencer ?? 0) - (b.diasParaVencer ?? 0);
      return prazo !== 0 ? prazo : b.valorAberto - a.valorAberto;
    })
    .slice(0, TETO_DA_FILA);
}

/** O mês dado e os seguintes, em sequência. */
function mesesSeguintes(inicio: string, quantos: number): string[] {
  const [anoInicial, mesInicial] = inicio.split('-').map(Number);
  const meses: string[] = [];

  let ano = anoInicial;
  let mes = mesInicial;
  for (let i = 0; i < quantos; i++) {
    meses.push(`${ano}-${String(mes).padStart(2, '0')}`);
    mes += 1;
    if (mes > 12) {
      mes = 1;
      ano += 1;
    }
  }
  return meses;
}

/**
 * Valor de uma coluna da agenda. Não usa o `formatCompacto` dos gráficos ("45,2
 * mil") porque aqui a coluna tem uns quarenta pixels: o número precisa caber em
 * três ou quatro caracteres ou vira sopa em cima da barra.
 */
function valorDaColuna(valor: number): string {
  if (valor >= 1_000_000) {
    return `${(valor / 1_000_000).toFixed(1).replace('.', ',')}M`;
  }
  if (valor >= 1_000) return `${Math.round(valor / 1_000)}k`;
  return String(Math.round(valor));
}

/** "AAAA-MM-DD" do último dia do mês corrente. */
function ultimoDiaDoMes(): string {
  const hoje = new Date();
  // Dia zero do mês seguinte é o último dia deste — resolve fevereiro e os
  // meses de 30 sem tabela nenhuma.
  const ultimo = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
  const mes = String(ultimo.getMonth() + 1).padStart(2, '0');
  return `${ultimo.getFullYear()}-${mes}-${String(ultimo.getDate()).padStart(2, '0')}`;
}

function somar(contas: ContaAberta[]): number {
  return contas.reduce((s, c) => s + c.valorAberto, 0);
}
