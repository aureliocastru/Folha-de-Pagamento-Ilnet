import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  IconeCheckCirculo,
  IconeCirculo,
  IconeLapis,
  IconeRaio,
  IconeRelogio,
} from '../../components/icones';
import { SeletorDeCategoria } from '../../components/SeletorDeCategoria';
import {
  Aviso,
  Carregando,
  CampoDinheiro,
  Janela,
  Selo,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { useTermoAdiado } from '../../lib/busca';
import { formatBRL, formatData } from '../../lib/format';
import type { CategoriaDespesa, StatusContaPagar } from '../../lib/types';
import type {
  ParcelaAntecipada,
  Recorrente,
  RecorrenteComResumo,
} from './Recorrentes';

/** Um fornecedor achado no IXC pela busca. */
interface FornecedorIxc {
  idFornecedor: number;
  nome: string;
  nomeFantasia: string | null;
  cpfCnpj: string | null;
}

const TIPOS_DE_PAGAMENTO = [
  'Boleto',
  'Pix',
  'Débito em conta',
  'Transferência',
  'Dinheiro',
];

/**
 * Os números de parcela que já saíram deste contrato.
 *
 * As que a rotina gerou pela frente, as que já estavam antecipadas quando o
 * contrato entrou aqui (as últimas, contadas do fim) e as que foram
 * antecipadas uma a uma. É a mesma conta do servidor — e é um conjunto, e não
 * uma soma, porque as duas pontas podem se encontrar.
 */
function numerosJaSaidos(r: Recorrente): Set<number> {
  const total = r.totalParcelas ?? 0;
  const usados = new Set<number>();
  for (let n = 1; n <= r.parcelasLancadas; n += 1) usados.add(n);
  for (let i = 0; i < (r.parcelasAntecipadas ?? 0); i += 1) {
    const n = total - i;
    if (n >= 1) usados.add(n);
  }
  for (const a of r.antecipadas ?? []) usados.add(a.numero);
  return usados;
}

/**
 * O que falta de um consórcio ou financiamento, contado do jeito que a rotina
 * vai gerar.
 *
 * A dívida pode andar por duas pontas: a rotina paga as da frente, uma atrás
 * da outra, e quem antecipa paga as do fim, que saem mais baratas porque o
 * juro que ainda ia correr é descontado. O que fica em aberto é o vão do meio,
 * e cada uma dessas parcelas tem um mês previsto — o mês em que a rotina a
 * geraria se ninguém a antecipasse.
 */
export function andamento(r: Recorrente) {
  const total = r.totalParcelas ?? 0;
  const porMes = Math.max(1, r.parcelasPorMes);
  const jaSairam = numerosJaSaidos(r);
  const antecipadas = (r.parcelasAntecipadas ?? 0) + (r.antecipadas?.length ?? 0);

  const iso = String(r.proximoVencimento).slice(0, 10);
  /*
   * As que ainda faltam, na ordem, com o mês de cada uma.
   *
   * O mês sai da fila: as do próximo vencimento são as que ainda cabem nele
   * (uma das duas do mês pode já ter nascido), e daí em diante andam de
   * `porMes` em `porMes`.
   */
  const emAberto: Array<{ numero: number; vencimento: string }> = [];
  for (let n = 1; n <= total; n += 1) {
    if (jaSairam.has(n)) continue;
    const mes = Math.floor((emAberto.length + r.lancadasNoMes) / porMes);
    emAberto.push({ numero: n, vencimento: somarMeses(iso, mes, r.diaDoVencimento) });
  }

  const faltam = emAberto.length;
  // As que nascem no próximo vencimento: as primeiras da fila que ainda cabem
  // no mês.
  const parcelas = emAberto.slice(0, Math.max(0, porMes - r.lancadasNoMes));

  return {
    total,
    porMes,
    faltam,
    antecipadas,
    /** Quantas já foram, pelos dois lados. */
    pagas: total - faltam,
    quitado: total > 0 && faltam === 0,
    emAberto,
    parcelas,
    numeros: parcelas.map((p) => p.numero),
    ultimaEm: faltam > 0 ? emAberto[emAberto.length - 1].vencimento : null,
    /** O que se economizou antecipando: o de tabela menos o que se pagou. */
    economia: (r.antecipadas ?? []).reduce(
      (s, a) => s + (Number(a.valorDeTabela) - Number(a.valor)),
      0,
    ),
  };
}

/**
 * Os consórcios e os financiamentos: a despesa que se repete todo mês, mas
 * acaba.
 *
 * Cartão em vez de tabela: o que importa aqui é quanto falta, e uma barra diz
 * isso num relance — e cartão cabe na tela do celular sem rolar de lado.
 *
 * A barra é uma só, de uma cor só, e ao lado dela a porcentagem paga: pagar a
 * parcela do mês ou antecipar a do fim é a mesma coisa para quem olha daqui —
 * o que se quer saber é quanto do contrato já foi.
 */
export function ListaDeConsorcios({
  itens,
  vazio,
  onEditar,
  onApagar,
  onAntecipar,
  onAbrir,
}: {
  itens: RecorrenteComResumo[];
  /** O que dizer quando não há nenhum — cada aba tem o seu caminho. */
  vazio?: { titulo: string; texto: string };
  onEditar: (r: Recorrente) => void;
  onApagar: (r: Recorrente) => void;
  onAntecipar: (r: Recorrente) => void;
  /** Clicar no cartão abre o que já foi pago deste contrato. */
  onAbrir: (r: Recorrente) => void;
}) {
  if (itens.length === 0) {
    return (
      <Vazio titulo={vazio?.titulo ?? 'Nenhum consórcio cadastrado'}>
        {vazio?.texto ??
          'Cadastre em "Novo consórcio" — ou, se ele já está nas mensais, use "É consórcio" na linha dele.'}
      </Vazio>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2 md:p-4">
      {itens.map(({ recorrente: r, diasParaGerar }) => {
        const a = andamento(r);
        const pago = a.total ? (a.pagas / a.total) * 100 : 0;
        return (
          /*
           * O cartão todo é a porta do histórico — é onde o dedo cai quando a
           * pergunta é "o que eu já paguei disto?". Os botões de dentro param
           * o clique antes de ele subir até aqui.
           */
          <div
            key={r.id}
            role="button"
            tabIndex={0}
            onClick={() => onAbrir(r)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onAbrir(r);
              }
            }}
            title="Ver o que já foi pago deste contrato"
            className={`min-w-0 cursor-pointer rounded-2xl border border-tinta-100 bg-papel p-4 transition hover:border-tinta-300 ${
              r.ativa || a.quitado ? '' : 'opacity-60'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              {/* No financiamento o que se procura é o que está sendo pago —
                  "STRADA NILMA" —, e isso é a descrição; o banco vem embaixo.
                  No consórcio, quem dá nome é a administradora. */}
              <div className="min-w-0 font-semibold text-tinta-900">
                {r.ehFinanciamento ? r.observacao : r.fornecedorNome}
              </div>
              <div className="shrink-0 text-right">
                <div className="valor">{formatBRL(Number(r.valor))}</div>
                {a.porMes > 1 && (
                  <div className="text-[11px] text-tinta-500">
                    × {a.porMes} ={' '}
                    <span className="valor">
                      {formatBRL(Number(r.valor) * a.porMes)}
                    </span>
                    /mês
                  </div>
                )}
              </div>
            </div>

            {/*
             * A linha do meio, com a largura toda do cartão.
             *
             * Ela ficou fora do cabeçalho porque, na tela do celular, o valor
             * da parcela mais o do mês tomam a direita e sobra uma coluna de
             * uma palavra para o resto: "Banco / Bradesco / S/A" descendo em
             * escada.
             */}
            <div className="mt-0.5 text-xs text-tinta-500">
              {[
                r.fornecedorNome,
                r.ehFinanciamento ? null : r.observacao,
                r.diaDoVencimento ? `todo dia ${r.diaDoVencimento}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>

            {/* Quanto já foi, quanto falta — e a porcentagem no fim. */}
            <div className="mt-3">
              <div className="flex items-center gap-2">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-tinta-100">
                  <div
                    className={`h-full rounded-full ${
                      a.quitado ? 'bg-emerald-500' : 'bg-brand-500'
                    }`}
                    style={{ width: `${pago}%` }}
                  />
                </div>
                <span
                  className={`num shrink-0 text-xs font-semibold ${
                    a.quitado
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-tinta-700'
                  }`}
                >
                  {Math.round(pago)}%
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-tinta-500">
                <span>
                  <strong className="num text-tinta-800">{a.pagas}</strong> de{' '}
                  <span className="num">{a.total}</span> parcelas
                  {a.porMes > 1 ? ` · ${a.porMes} por mês` : ''}
                  {a.antecipadas > 0 && (
                    <>
                      {' · '}
                      <span className="text-emerald-700 dark:text-emerald-400">
                        <strong className="num">{a.antecipadas}</strong>{' '}
                        antecipada{a.antecipadas > 1 ? 's' : ''}
                      </span>
                    </>
                  )}
                </span>
                {a.quitado ? (
                  <Selo pequeno tom="pago">
                    quitado
                  </Selo>
                ) : (
                  <span>
                    faltam{' '}
                    <strong className="num text-tinta-800">{a.faltam}</strong>
                    {a.ultimaEm && ` · última em ${mesAno(a.ultimaEm)}`}
                  </span>
                )}
              </div>
              {a.economia > 0 && (
                <div className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
                  Antecipando, já se economizou{' '}
                  <strong className="valor">{formatBRL(a.economia)}</strong>.
                </div>
              )}
            </div>

            {!a.quitado && (
              <div className="mt-3 rounded-xl bg-tinta-50 px-3 py-2 text-xs text-tinta-600">
                {a.parcelas.length > 1 ? 'Parcelas ' : 'Parcela '}
                <strong className="num text-tinta-800">{juntar(a.numeros)}</strong>{' '}
                {a.parcelas.length > 1 ? 'vencem' : 'vence'}{' '}
                <strong className="num text-tinta-800">
                  {formatData(r.proximoVencimento)}
                </strong>
                {' · '}
                {!r.ativa ? (
                  'desligado, não vai gerar'
                ) : diasParaGerar <= 0 ? (
                  <Selo pequeno tom="atencao">
                    nasce na próxima rodada
                  </Selo>
                ) : (
                  `nasce no IXC em ${diasParaGerar} dia(s)`
                )}
              </div>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {!r.ativa && !a.quitado && (
                <Selo pequeno tom="neutro">
                  desligado
                </Selo>
              )}
              {r.ultimoErro && (
                <Selo pequeno tom="erro" titulo={r.ultimoErro}>
                  a última falhou
                </Selo>
              )}
              <div
                className="ml-auto flex flex-wrap justify-end gap-1.5"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                role="presentation"
              >
                {!a.quitado && (
                  <button
                    onClick={() => onAntecipar(r)}
                    className="btn btn-primario btn-p"
                    title="Escolher uma parcela lá do fim e pagá-la adiantada, com desconto"
                  >
                    Antecipar
                  </button>
                )}
                <button onClick={() => onEditar(r)} className="btn btn-neutro btn-p">
                  Editar
                </button>
                <button onClick={() => onApagar(r)} className="btn btn-perigo btn-p">
                  Apagar
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Escolher a parcela que se vai antecipar.
 *
 * As parcelas em aberto, na ordem, cada uma com o mês em que ela venceria. A
 * do fim é a que costuma valer a pena: é a que tem mais juro para descontar, e
 * é por isso que a lista começa por ela — o dedo cai primeiro na última.
 *
 * Escolhida, o caminho é o mesmo de qualquer conta: a tela de lançar, já
 * preenchida, esperando o valor do boleto com desconto e a forma de pagar.
 */
export function JanelaDeAntecipacao({
  item,
  onFechar,
  onPagar,
  onRegistrar,
  onDesfazer,
}: {
  item: RecorrenteComResumo;
  onFechar: () => void;
  onPagar: (parcela: { numero: number; vencimento: string }) => void;
  /** Já paguei esta: só registrar, sem gerar conta nenhuma. */
  onRegistrar: (dados: { numero: number; valor: number; data: string }) => void;
  onDesfazer: (antecipada: ParcelaAntecipada) => void;
}) {
  const r = item.recorrente;
  const a = andamento(r);
  const [escolhida, setEscolhida] = useState<number | null>(
    // A última em aberto: a de maior desconto, e a que quase sempre se
    // antecipa. Vem marcada — "nem me pergunta".
    a.emAberto.length ? a.emAberto[a.emAberto.length - 1].numero : null,
  );
  const [verTodas, setVerTodas] = useState(false);
  /** Quando se está informando o valor de uma que já foi paga por fora. */
  const [registrando, setRegistrando] = useState(false);
  const [valorPago, setValorPago] = useState('');
  const [dataPaga, setDataPaga] = useState(new Date().toISOString().slice(0, 10));

  /*
   * As que o cadastro contou sem valor.
   *
   * "Já foram 6 antecipadas" diz que a 36 até a 31 saíram, e não por quanto.
   * Informar o valor de cada uma é o que faz a economia aparecer — e é aqui
   * que elas ficam à mão para isso.
   */
  const semValor: number[] = [];
  for (let n = a.total; n > a.total - (r.parcelasAntecipadas ?? 0); n -= 1) {
    if (!r.antecipadas.some((x) => x.numero === n)) semValor.push(n);
  }

  const daVez =
    a.emAberto.find((p) => p.numero === escolhida) ??
    (escolhida != null && semValor.includes(escolhida)
      ? { numero: escolhida, vencimento: '' }
      : null);
  // Do fim para a frente: a primeira da lista é a última do contrato.
  const doFimParaAFrente = [...a.emAberto].reverse();
  const mostradas = verTodas ? doFimParaAFrente : doFimParaAFrente.slice(0, 24);

  return (
    <Janela
      titulo={`Antecipar parcela — ${r.ehFinanciamento ? r.observacao : r.fornecedorNome}`}
      onFechar={onFechar}
    >
      <p className="text-sm text-tinta-600">
        Escolha a parcela que você vai pagar adiantada. Ela sai da fila da
        rotina: não vai nascer de novo no mês dela.
      </p>

      <div className="mt-3 max-h-[280px] overflow-y-auto rolagem-fina rounded-xl border border-tinta-100 p-2">
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
          {mostradas.map((p) => {
            const marcada = p.numero === escolhida;
            return (
              <button
                key={p.numero}
                onClick={() => setEscolhida(p.numero)}
                aria-pressed={marcada}
                className={`rounded-xl border px-2 py-2 text-center transition ${
                  marcada
                    ? 'border-brand-500 bg-brand-500/10'
                    : 'border-tinta-100 hover:border-tinta-300'
                }`}
              >
                <div className="num text-sm font-semibold text-tinta-900">
                  {p.numero}
                  <span className="text-[11px] font-normal text-tinta-400">
                    /{a.total}
                  </span>
                </div>
                <div className="num text-[11px] text-tinta-500">
                  {mesAno(p.vencimento)}
                </div>
              </button>
            );
          })}
        </div>
        {!verTodas && doFimParaAFrente.length > mostradas.length && (
          <button
            onClick={() => setVerTodas(true)}
            className="btn btn-sutil btn-p mt-2 w-full"
          >
            Ver as outras {doFimParaAFrente.length - mostradas.length} em aberto
          </button>
        )}
      </div>

      {daVez && !registrando && (
        <div className="mt-4 rounded-2xl bg-tinta-50 p-4 text-sm text-tinta-600">
          A parcela <strong className="num text-tinta-900">{daVez.numero}</strong> de{' '}
          {a.total}
          {daVez.vencimento && (
            <>
              {' '}
              venceria em{' '}
              <strong className="num text-tinta-900">{mesAno(daVez.vencimento)}</strong>
            </>
          )}{' '}
          vale{' '}
          <strong className="valor text-tinta-900">
            {formatBRL(Number(r.valor))}
          </strong>
          . Pagando agora ela sai por menos — o valor do boleto com desconto é o
          que você vai digitar na conta.
        </div>
      )}

      {/* Já paguei esta: nada nasce no IXC, só fica registrado o que saiu. */}
      {daVez && registrando && (
        <div className="mt-4 rounded-2xl border border-tinta-100 p-4">
          <p className="text-sm text-tinta-600">
            Quanto você pagou pela parcela{' '}
            <strong className="num text-tinta-900">{daVez.numero}</strong>? Ela
            vale <strong className="valor">{formatBRL(Number(r.valor))}</strong> —
            a diferença é a economia. Nada é lançado no IXC: isto é o registro
            de um pagamento que já aconteceu.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="rotulo" htmlFor="ant-valor">
                Valor pago
              </label>
              <CampoDinheiro id="ant-valor" valor={valorPago} onChange={setValorPago} />
            </div>
            <div>
              <label className="rotulo" htmlFor="ant-data">
                Quando foi paga
              </label>
              <input
                id="ant-data"
                type="date"
                value={dataPaga}
                onChange={(e) => setDataPaga(e.target.value)}
                className="campo"
              />
            </div>
          </div>
        </div>
      )}

      {semValor.length > 0 && !registrando && (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
          <p className="text-amber-900 dark:text-amber-200">
            O cadastro conta {semValor.length} antecipada(s) sem dizer por
            quanto. Informe o valor de cada uma para a economia aparecer:
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {semValor.map((n) => (
              <button
                key={n}
                onClick={() => {
                  setEscolhida(n);
                  setValorPago('');
                  setRegistrando(true);
                }}
                className="btn btn-sutil btn-p num"
              >
                {n}/{a.total}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* O que já foi antecipado, e a saída para quando o número saiu errado. */}
      {r.antecipadas.length > 0 && (
        <div className="mt-4">
          <p className="rotulo">Já antecipadas</p>
          <div className="mt-1 space-y-1">
            {r.antecipadas.map((x) => (
              <div
                key={x.id}
                className="flex flex-wrap items-center gap-2 rounded-xl bg-tinta-50 px-3 py-2 text-xs text-tinta-600"
              >
                <span className="num font-semibold text-tinta-800">
                  {x.numero}/{a.total}
                </span>
                <span className="valor">{formatBRL(Number(x.valor))}</span>
                {Number(x.valorDeTabela) > Number(x.valor) && (
                  <span className="text-emerald-700 dark:text-emerald-400">
                    economia de{' '}
                    {formatBRL(Number(x.valorDeTabela) - Number(x.valor))}
                  </span>
                )}
                <span className="num text-tinta-400">{formatData(x.data)}</span>
                <button
                  onClick={() => onDesfazer(x)}
                  className="btn btn-sutil btn-p ml-auto"
                  title="A parcela volta para a fila da rotina. A conta no IXC não é mexida."
                >
                  Desfazer
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button
          onClick={() => (registrando ? setRegistrando(false) : onFechar())}
          className="btn btn-neutro"
        >
          {registrando ? 'Voltar' : 'Cancelar'}
        </button>
        {registrando ? (
          <button
            onClick={() =>
              daVez &&
              onRegistrar({
                numero: daVez.numero,
                valor: Number(valorPago),
                data: dataPaga,
              })
            }
            disabled={!daVez || !(Number(valorPago) > 0) || !dataPaga}
            className="btn btn-primario"
          >
            Registrar o que foi pago
          </button>
        ) : (
          <>
            <button
              onClick={() => {
                setValorPago('');
                setRegistrando(true);
              }}
              disabled={!daVez}
              className="btn btn-sutil"
              title="A parcela já foi paga por fora: só registrar o valor"
            >
              Já paguei essa
            </button>
            <button
              onClick={() => daVez && daVez.vencimento && onPagar(daVez)}
              disabled={!daVez || !daVez.vencimento}
              className="btn btn-primario"
            >
              Pagar esta parcela
            </button>
          </>
        )}
      </div>
    </Janela>
  );
}

/** Uma linha do histórico, como a API a devolve. */
interface LinhaDoHistorico {
  contaId: string | null;
  antecipacaoId: string | null;
  numero: number | null;
  valor: string;
  valorDeTabela: string;
  /** Vencimento da conta, ou o dia em que a antecipada foi paga. */
  data: string;
  status: StatusContaPagar | null;
  pagoEm: string | null;
  idFnApagarIxc: number | null;
  antecipada: boolean;
}

/** Uma parcela do contrato na tela: do número 1 ao último, saiu ou não. */
interface ParcelaNaTela {
  numero: number;
  /** O vencimento real, quando há conta; o previsto, quando não há. */
  vencimento: string;
  /** Quanto ela vale pelo contrato. */
  cheio: number;
  /** O que saiu por ela. Null = ainda não saiu, ou não se sabe por quanto. */
  pago: number | null;
  situacao: 'paga' | 'antecipada' | 'esperando' | 'aberta';
  status: StatusContaPagar | null;
  /** O dia em que o dinheiro saiu, quando se sabe. */
  pagoEm: string | null;
  idFnApagarIxc: number | null;
  /** Tem conta a pagar: o valor é o do título, e não se digita aqui. */
  temConta: boolean;
}

const ICONE_DA_SITUACAO = {
  paga: { icone: IconeCheckCirculo, cor: 'text-emerald-600 dark:text-emerald-400', titulo: 'paga' },
  antecipada: { icone: IconeRaio, cor: 'text-emerald-600 dark:text-emerald-400', titulo: 'antecipada' },
  esperando: { icone: IconeRelogio, cor: 'text-brand-600 dark:text-brand-300', titulo: 'esperando pagamento' },
  aberta: { icone: IconeCirculo, cor: 'text-tinta-300', titulo: 'ainda não saiu' },
} as const;

/**
 * O contrato inteiro, parcela por parcela.
 *
 * Junta três coisas que moram em lugares diferentes: as contas que nasceram no
 * IXC, os valores informados à mão (as antecipadas e as pagas antes de tudo
 * isto) e o que ainda falta, com o mês previsto de cada uma. O que não se sabe
 * fica em branco esperando alguém digitar — e é digitando que a soma do que já
 * se pagou vira a soma de verdade.
 */
function parcelasDoContrato(r: Recorrente, linhas: LinhaDoHistorico[]): ParcelaNaTela[] {
  const a = andamento(r);
  const jaSairam = numerosJaSaidos(r);
  const porNumero = new Map(
    linhas.filter((l) => l.numero != null).map((l) => [l.numero as number, l]),
  );
  const previsto = new Map(a.emAberto.map((p) => [p.numero, p.vencimento]));
  const iso = String(r.proximoVencimento).slice(0, 10);
  const primeiraEmAberto = a.emAberto[0]?.numero ?? a.total + 1;
  const porMes = Math.max(1, r.parcelasPorMes);

  return Array.from({ length: a.total }, (_, i) => {
    const numero = i + 1;
    const linha = porNumero.get(numero);
    const saiu = jaSairam.has(numero);

    /*
     * O mês de cada uma. As que ainda faltam já vêm calculadas do andamento —
     * são as mesmas datas que o cartão anuncia. As que ficaram para trás são
     * contadas de trás para a frente a partir da primeira em aberto: é
     * estimativa, e é a única coisa que se pode dizer de uma parcela paga
     * antes de o contrato entrar aqui.
     */
    /*
     * O vencimento, e não o dia do pagamento: a parcela 45 vence em 11/2027
     * mesmo tendo sido paga em setembro. Quando há conta a pagar, a data dela
     * é a verdadeira; quando não há, vale a previsão.
     */
    const vencimento =
      (linha?.contaId ? linha.data : null) ??
      previsto.get(numero) ??
      somarMeses(
        iso,
        Math.floor((numero - primeiraEmAberto + r.lancadasNoMes) / porMes),
        r.diaDoVencimento,
      );

    const situacao: ParcelaNaTela['situacao'] = linha?.antecipada
      ? 'antecipada'
      : !saiu
        ? 'aberta'
        : linha == null || linha.status === 'PAGO' || linha.status === null
          ? 'paga'
          : 'esperando';

    return {
      numero,
      vencimento,
      cheio: linha ? Number(linha.valorDeTabela) : Number(r.valor),
      pago: linha ? Number(linha.valor) : null,
      situacao,
      status: linha?.status ?? null,
      /** Quando saiu o dinheiro, para quem antecipou. */
      pagoEm: linha?.pagoEm ?? (linha && !linha.contaId ? linha.data : null),
      idFnApagarIxc: linha?.idFnApagarIxc ?? null,
      temConta: !!linha?.contaId,
    };
  });
}

/**
 * O contrato inteiro: o que já foi pago, o que falta e por quanto saiu cada
 * parcela.
 *
 * Uma linha por parcela, do começo ao fim, com o número na frente e um ícone
 * dizendo em que pé ela está. O valor pago de quem não tem conta a pagar é
 * digitável: as parcelas pagas antes de o contrato entrar aqui não têm papel
 * nenhum guardado, e é informando cada uma que o total do contrato fecha.
 */
export function JanelaDeHistorico({
  item,
  onFechar,
}: {
  item: RecorrenteComResumo;
  onFechar: () => void;
}) {
  const queryClient = useQueryClient();
  const r = item.recorrente;
  const a = andamento(r);

  const [editando, setEditando] = useState<number | null>(null);
  const [valor, setValor] = useState('');

  const historico = useQuery({
    queryKey: ['recorrentes', r.id, 'historico'],
    queryFn: async () =>
      (await api.get<{ linhas: LinhaDoHistorico[] }>(`/recorrentes/${r.id}/historico`))
        .data,
  });

  const salvar = useMutation({
    mutationFn: async (dados: { numero: number; valor: number }) => {
      await api.post(`/recorrentes/${r.id}/antecipacoes`, {
        numero: dados.numero,
        valor: dados.valor,
        valorDeTabela: Number(r.valor),
      });
    },
    onSuccess: () => {
      setEditando(null);
      void queryClient.invalidateQueries({ queryKey: ['recorrentes'] });
    },
  });

  const parcelas = parcelasDoContrato(r, historico.data?.linhas ?? []);
  const pagas = parcelas.filter(
    (p) => p.situacao === 'paga' || p.situacao === 'antecipada',
  );
  const saiuDoCaixa = pagas.reduce((s, p) => s + (p.pago ?? 0), 0);
  const semValor = pagas.filter((p) => p.pago == null).length;
  const esperando = parcelas
    .filter((p) => p.situacao === 'esperando')
    .reduce((s, p) => s + (p.pago ?? p.cheio), 0);
  const economia = parcelas.reduce(
    (s, p) => s + (p.pago != null ? Math.max(0, p.cheio - p.pago) : 0),
    0,
  );

  return (
    <Janela
      titulo={`Parcelas — ${r.ehFinanciamento ? r.observacao : r.fornecedorNome}`}
      onFechar={onFechar}
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Numero rotulo="Pagas" valor={`${a.pagas} de ${a.total}`} />
        <Numero
          rotulo="Já saiu do caixa"
          valor={formatBRL(saiuDoCaixa)}
          detalhe={semValor > 0 ? `${semValor} sem valor informado` : undefined}
        />
        <Numero rotulo="Esperando pagamento" valor={formatBRL(esperando)} />
        <Numero rotulo="Economia" valor={formatBRL(economia)} verde />
      </div>

      {historico.isError && (
        <Aviso tom="erro">{mensagemErro(historico.error)}</Aviso>
      )}
      {salvar.isError && <Aviso tom="erro">{mensagemErro(salvar.error)}</Aviso>}

      {historico.isLoading ? (
        <Carregando />
      ) : (
        <div className="mt-3 max-h-[46vh] overflow-y-auto rolagem-fina rounded-xl border border-tinta-100">
          {/* Uma linha por parcela: número, vencimento, valor cheio e o que
              saiu de verdade. Compacta de propósito — são dezenas delas. */}
          {parcelas.map((p) => {
            const { icone: Icone, cor, titulo } = ICONE_DA_SITUACAO[p.situacao];
            const emEdicao = editando === p.numero;
            return (
              <div
                key={p.numero}
                className="item-dividido flex items-center gap-1.5 px-2 py-1.5 text-[12px] sm:gap-2 sm:px-2.5 sm:text-[13px]"
              >
                <Icone className={`h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4 ${cor}`} />
                <span className="num w-9 shrink-0 font-semibold text-tinta-800 sm:w-11">
                  {p.numero}
                  <span className="text-[10px] font-normal text-tinta-400">
                    /{a.total}
                  </span>
                </span>
                <span
                  className="num w-[62px] shrink-0 text-[11px] text-tinta-500 sm:w-[74px] sm:text-[13px]"
                  title={
                    p.pagoEm
                      ? `${titulo} em ${formatData(p.pagoEm)}`
                      : `vence ${formatData(p.vencimento)} — ${titulo}`
                  }
                >
                  {formatData(p.vencimento)}
                </span>

                {emEdicao ? (
                  <div className="ml-auto flex shrink-0 items-center gap-1">
                    <CampoDinheiro
                      valor={valor}
                      onChange={setValor}
                      className="campo w-24 py-1 text-right sm:w-28"
                    />
                    <button
                      onClick={() =>
                        salvar.mutate({ numero: p.numero, valor: Number(valor) })
                      }
                      disabled={!(Number(valor) > 0) || salvar.isPending}
                      className="btn btn-primario btn-p"
                    >
                      Salvar
                    </button>
                    <button
                      onClick={() => setEditando(null)}
                      className="btn btn-sutil btn-p"
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="num ml-auto shrink-0 text-right text-[11px] text-tinta-400">
                      {formatBRL(p.cheio)}
                    </span>
                    <span
                      className={`valor w-[72px] shrink-0 text-right sm:w-24 ${
                        p.pago == null
                          ? 'text-tinta-300'
                          : p.pago < p.cheio
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-tinta-800'
                      }`}
                    >
                      {p.pago == null ? '—' : formatBRL(p.pago)}
                    </span>
                    {/* Quem tem conta a pagar não se digita: o valor é o do
                        título, e mexer nele aqui seria inventar um número que
                        o IXC não tem. */}
                    <button
                      onClick={() => {
                        setEditando(p.numero);
                        setValor(p.pago != null ? String(p.pago) : '');
                      }}
                      disabled={p.temConta}
                      className="btn btn-sutil btn-p shrink-0 px-1.5 disabled:opacity-30"
                      title={
                        p.temConta
                          ? `O valor é o da conta no IXC${p.idFnApagarIxc ? ` (título ${p.idFnApagarIxc})` : ''}`
                          : 'Informar quanto saiu por esta parcela'
                      }
                    >
                      <IconeLapis className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="ajuda">
        O valor pago das parcelas sem conta a pagar é digitável — as que foram
        pagas antes de o contrato entrar aqui não têm registro nenhum, e é
        informando cada uma que a soma fecha.
      </p>

      <div className="mt-4 flex justify-end">
        <button onClick={onFechar} className="btn btn-neutro">
          Fechar
        </button>
      </div>
    </Janela>
  );
}

/** Um número do alto da janela: rótulo pequeno, valor grande. */
function Numero({
  rotulo,
  valor,
  detalhe,
  verde,
}: {
  rotulo: string;
  valor: string;
  detalhe?: string;
  verde?: boolean;
}) {
  return (
    <div className="rounded-xl bg-tinta-50 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wider text-tinta-400">{rotulo}</p>
      <p
        className={`valor text-sm font-semibold ${
          verde ? 'text-emerald-700 dark:text-emerald-400' : 'text-tinta-900'
        }`}
      >
        {valor}
      </p>
      {detalhe && <p className="text-[11px] text-tinta-400">{detalhe}</p>}
    </div>
  );
}

/**
 * Cadastro do consórcio e do financiamento — novo, editado, ou uma mensal que
 * vira parcelado.
 *
 * A pergunta que decide tudo é "quantas já saíram": dela sai o número da
 * próxima parcela e quando ele acaba. As que já estão lançadas no IXC, mesmo
 * sem pagar, contam — senão a rotina lança de novo uma que já existe. E, para
 * quem antecipa, a mesma pergunta do outro lado: quantas já foram pagas do fim
 * para trás, porque é daí que sai o número da próxima antecipada.
 *
 * Financiamento é a mesma coisa com um veículo no nome: é o veículo que o
 * manda para a aba dele e diz de que carro é a dívida.
 */
export function CadastroDoConsorcio({
  base,
  todas,
  modo = 'consorcio',
  onFechar,
  onPronto,
}: {
  /** A recorrente editada ou convertida; sem ela, é um cadastro novo. */
  base: Recorrente | null;
  todas: RecorrenteComResumo[];
  /** De que aba veio. Na edição, quem manda é o veículo que já está gravado. */
  modo?: 'consorcio' | 'financiamento';
  onFechar: () => void;
  onPronto: (mensagem: string) => void;
}) {
  const convertendo = !!base && base.totalParcelas == null;
  const editando = !!base && !convertendo;
  const financiamento = base ? base.ehFinanciamento : modo === 'financiamento';
  const oQueE = financiamento ? 'financiamento' : 'consórcio';

  const [fornecedor, setFornecedor] = useState<{ id: number; nome: string } | null>(
    base ? { id: base.idFornecedorIxc, nome: base.fornecedorNome } : null,
  );
  const [termo, setTermo] = useState('');
  const buscaEfetiva = useTermoAdiado(termo);

  const [observacao, setObservacao] = useState(base?.observacao ?? '');
  const [valor, setValor] = useState(base ? String(Number(base.valor)) : '');
  const [dia, setDia] = useState(
    base
      ? String(base.diaDoVencimento ?? Number(String(base.proximoVencimento).slice(8, 10)))
      : '',
  );
  /** A data escrita à mão ganha do dia; sem ela, a data segue o dia. */
  const [vencimentoEscrito, setVencimentoEscrito] = useState(
    base ? String(base.proximoVencimento).slice(0, 10) : '',
  );
  const [total, setTotal] = useState(base?.totalParcelas ? String(base.totalParcelas) : '');
  const [lancadas, setLancadas] = useState(editando ? String(base.parcelasLancadas) : '');
  const [porMes, setPorMes] = useState(String(editando ? base.parcelasPorMes : 1));
  const [antecipadas, setAntecipadas] = useState(
    editando ? String(base.parcelasAntecipadas) : '',
  );

  const [categoriaId, setCategoriaId] = useState(base?.categoriaId ?? '');
  const [tipoPagamento, setTipoPagamento] = useState(base?.tipoPagamentoIxc ?? 'Boleto');
  const [soDiasUteis, setSoDiasUteis] = useState(base?.apenasDiasUteis ?? true);

  const fornecedores = useQuery({
    queryKey: ['fornecedores-ixc', buscaEfetiva],
    queryFn: async () =>
      (
        await api.get<FornecedorIxc[]>('/fornecedores-ixc', {
          params: { busca: buscaEfetiva },
        })
      ).data,
    enabled: buscaEfetiva.length >= 2 && !fornecedor,
    retry: 0,
  });

  const categorias = useQuery({
    queryKey: ['categorias-despesa'],
    queryFn: async () =>
      (await api.get<CategoriaDespesa[]>('/categorias-despesa')).data,
  });

  const nDia = Number(dia);
  const diaValido = Number.isInteger(nDia) && nDia >= 1 && nDia <= 31;
  const vencimento = vencimentoEscrito || (diaValido ? proximaData(nDia) : '');
  const nTotal = Number(total);
  const nLancadas = Number(lancadas || 0);
  const nPorMes = Number(porMes);
  const nAntecipadas = Number(antecipadas || 0);
  /** A próxima a pagar do fim para trás, se ele antecipar de novo. */
  const proximaDoFim = nTotal - nAntecipadas;

  /*
   * As outras repetições do mesmo fornecedor. É o desenho da Canopus antes
   * disto: duas mensais, uma para cada parcela do mês. Ficando, cada mês teria
   * as parcelas do consórcio e mais as delas.
   */
  const irmas = fornecedor
    ? todas
        .map((i) => i.recorrente)
        .filter(
          (r) =>
            r.id !== base?.id &&
            r.idFornecedorIxc === fornecedor.id &&
            r.ativa &&
            r.totalParcelas == null,
        )
    : [];
  const [apagar, setApagar] = useState<Set<string> | null>(null);
  const marcadas = apagar ?? new Set(irmas.map((r) => r.id));

  const previa =
    nTotal >= 2 && nLancadas >= 0 && nLancadas <= nTotal && nPorMes >= 1 && vencimento
      ? andamento({
          ...(base ?? ({} as Recorrente)),
          antecipadas: base?.antecipadas ?? [],
          totalParcelas: nTotal,
          parcelasLancadas: nLancadas,
          parcelasPorMes: nPorMes,
          parcelasAntecipadas: nAntecipadas,
          // Se a contagem e a data ficaram como estavam, vale o que já nasceu
          // no mês; mexer nelas recomeça o mês (é o que o servidor faz).
          lancadasNoMes:
            editando &&
            nLancadas === base.parcelasLancadas &&
            vencimento === String(base.proximoVencimento).slice(0, 10)
              ? base.lancadasNoMes
              : 0,
          proximoVencimento: vencimento,
          diaDoVencimento: diaValido ? nDia : null,
        })
      : null;

  const podeSalvar =
    !!fornecedor &&
    Number(valor) > 0 &&
    diaValido &&
    Number.isInteger(nTotal) &&
    nTotal >= 2 &&
    nTotal <= 360 &&
    Number.isInteger(nLancadas) &&
    nLancadas >= 0 &&
    Number.isInteger(nAntecipadas) &&
    nAntecipadas >= 0 &&
    // As duas pontas não se ultrapassam: juntas, nunca passam do contrato.
    nLancadas + nAntecipadas <= nTotal &&
    nPorMes >= 1 &&
    !!vencimento;

  const salvar = useMutation({
    mutationFn: async () => {
      const obs = observacao.trim();
      const dados = {
        valor: Number(valor),
        // Sem descrição, a do IXC diz o que é: "nem me pergunta".
        observacao: obs.length >= 3 ? obs : descricaoPadrao,
        proximoVencimento: vencimento,
        diaDoVencimento: nDia,
        totalParcelas: nTotal,
        parcelasLancadas: nLancadas,
        parcelasPorMes: nPorMes,
        parcelasAntecipadas: nAntecipadas,
        ehFinanciamento: financiamento,
        categoriaId: categoriaId || null,
        tipoPagamentoIxc: tipoPagamento.trim() || undefined,
        apenasDiasUteis: soDiasUteis,
      };
      if (base) {
        await api.patch(`/recorrentes/${base.id}`, dados);
      } else {
        await api.post('/recorrentes', {
          ...dados,
          idFornecedorIxc: fornecedor!.id,
          fornecedorNome: fornecedor!.nome,
        });
      }

      let apagadas = 0;
      for (const r of irmas) {
        if (!marcadas.has(r.id)) continue;
        await api.delete(`/recorrentes/${r.id}`);
        apagadas += 1;
      }
      return apagadas;
    },
    onSuccess: (apagadas) =>
      onPronto(
        (editando
          ? `${financiamento ? 'Financiamento' : 'Consórcio'} de ${nomeDoCadastro} atualizado.`
          : `${nomeDoCadastro} ${convertendo ? `virou ${oQueE}` : `cadastrado como ${oQueE}`}. As parcelas nascem no IXC 5 dias antes de vencer.`) +
          (apagadas > 0
            ? ` ${apagadas} repetição(ões) mensal(is) do mesmo fornecedor apagada(s).`
            : ''),
      ),
  });

  /** Como este cadastro se chama nas mensagens: o que ele paga, ou o credor. */
  const nomeDoCadastro = observacao.trim() || fornecedor?.nome || '';
  const descricaoPadrao = financiamento
    ? `Financiamento ${fornecedor?.nome ?? ''}`.trim()
    : `Consórcio ${fornecedor?.nome ?? ''}`.trim();

  return (
    <Janela
      titulo={
        editando
          ? `Editar ${oQueE} — ${nomeDoCadastro || base.fornecedorNome}`
          : convertendo
            ? `Transformar em ${oQueE}`
            : financiamento
              ? 'Novo financiamento'
              : 'Novo consórcio'
      }
      onFechar={onFechar}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="rotulo" htmlFor="co-fornecedor">
            Fornecedor no IXC
          </label>
          {fornecedor ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-tinta-50 px-3 py-2">
              <span className="min-w-0 text-tinta-800">{fornecedor.nome}</span>
              <span className="num text-xs text-tinta-400">
                código {fornecedor.id}
              </span>
              {/* Na edição o fornecedor fica: trocar de credor é outro consórcio. */}
              {!base && (
                <button
                  onClick={() => {
                    setFornecedor(null);
                    setTermo('');
                    setApagar(null);
                  }}
                  className="btn btn-sutil btn-p ml-auto"
                >
                  Trocar
                </button>
              )}
            </div>
          ) : (
            <>
              <input
                id="co-fornecedor"
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
                className="campo"
                placeholder="Nome, nome fantasia ou CPF/CNPJ"
                autoComplete="off"
                autoFocus
              />
              {fornecedores.isFetching && (
                <p className="ajuda">Procurando no IXC…</p>
              )}
              {fornecedores.error && (
                <p className="ajuda text-rose-600">
                  {mensagemErro(fornecedores.error)}
                </p>
              )}
              {fornecedores.data && fornecedores.data.length === 0 && (
                <p className="ajuda">
                  Nenhum fornecedor ativo com esse nome no IXC.
                </p>
              )}
              {!!fornecedores.data?.length && (
                <div className="mt-2 max-h-48 overflow-y-auto rolagem-fina rounded-xl border border-tinta-100">
                  {fornecedores.data.map((f) => (
                    <button
                      key={f.idFornecedor}
                      onClick={() =>
                        setFornecedor({ id: f.idFornecedor, nome: f.nome })
                      }
                      className="item-dividido flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-tinta-50"
                    >
                      <span className="min-w-0 truncate text-sm text-tinta-800">
                        {f.nome}
                      </span>
                      <span className="num shrink-0 text-xs text-tinta-400">
                        {f.cpfCnpj ?? `nº ${f.idFornecedor}`}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="sm:col-span-2">
          <label className="rotulo" htmlFor="co-obs">
            Descrição (vai na conta do IXC)
          </label>
          <input
            id="co-obs"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            className="campo"
            placeholder={
              financiamento
                ? 'Financiamento STRADA NILMA'
                : descricaoPadrao || 'Consórcio caçamba'
            }
            autoComplete="off"
          />
          <p className="ajuda">
            {financiamento
              ? 'Diga aqui o que está sendo pago — "Financiamento STRADA NILMA", "Retroescavadeira". É o nome do cartão, e vai na conta com o número da parcela no fim: "(12/60)".'
              : 'Cada conta sai com o número da parcela no fim: "(12/60)".'}
          </p>
        </div>

        <div>
          <label className="rotulo" htmlFor="co-valor">
            Valor de cada parcela
          </label>
          <CampoDinheiro id="co-valor" valor={valor} onChange={setValor} />
        </div>

        <div>
          <label className="rotulo" htmlFor="co-por-mes">
            Parcelas por mês
          </label>
          <select
            id="co-por-mes"
            value={porMes}
            onChange={(e) => setPorMes(e.target.value)}
            className="campo"
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n === 1 ? '1 por mês' : `${n} por mês (vencem juntas)`}
              </option>
            ))}
          </select>
          {nPorMes > 1 && Number(valor) > 0 && (
            <p className="ajuda">
              {nPorMes} contas no mesmo dia, somando{' '}
              {formatBRL(Number(valor) * nPorMes)} por mês.
            </p>
          )}
        </div>

        <div>
          <label className="rotulo" htmlFor="co-dia">
            Vence todo dia
          </label>
          <input
            id="co-dia"
            type="number"
            inputMode="numeric"
            min={1}
            max={31}
            value={dia}
            onChange={(e) => setDia(e.target.value)}
            className="campo num"
            placeholder="14"
          />
        </div>

        <div>
          <label className="rotulo" htmlFor="co-vencimento">
            Próxima parcela a gerar vence em
          </label>
          <input
            id="co-vencimento"
            type="date"
            value={vencimento}
            onChange={(e) => setVencimentoEscrito(e.target.value)}
            className="campo"
          />
          <p className="ajuda">
            Se a deste mês já está lançada no IXC, deixe a do mês que vem.
          </p>
        </div>

        <div>
          <label className="rotulo" htmlFor="co-total">
            Quantidade de parcelas
          </label>
          <input
            id="co-total"
            type="number"
            inputMode="numeric"
            min={2}
            max={360}
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            className="campo num"
            placeholder="60"
          />
        </div>

        <div>
          <label className="rotulo" htmlFor="co-lancadas">
            Quantas já foram pagas
          </label>
          <input
            id="co-lancadas"
            type="number"
            inputMode="numeric"
            min={0}
            max={360}
            value={lancadas}
            onChange={(e) => setLancadas(e.target.value)}
            className="campo num"
            placeholder="0"
          />
          <p className="ajuda">
            Conte também as que já estão lançadas no IXC esperando pagamento.
          </p>
        </div>

        {/* A outra ponta: o que já se pagou do fim para trás. */}
        <div>
          <label className="rotulo" htmlFor="co-antecipadas">
            Quantas já foram antecipadas
          </label>
          <input
            id="co-antecipadas"
            type="number"
            inputMode="numeric"
            min={0}
            max={360}
            value={antecipadas}
            onChange={(e) => setAntecipadas(e.target.value)}
            className="campo num"
            placeholder="0"
          />
          <p className="ajuda">
            {nTotal >= 2 && nAntecipadas > 0
              ? `Contadas do fim: a ${nTotal} até a ${proximaDoFim + 1} já foram, e a próxima do fim é a ${proximaDoFim}.`
              : 'As que já tinham sido pagas adiantadas, do fim para trás, antes de entrar aqui. As próximas você lança pelo botão Antecipar.'}
          </p>
        </div>


        <div>
          <label className="rotulo" htmlFor="co-tipo">
            Tipo de pagamento
          </label>
          <select
            id="co-tipo"
            value={tipoPagamento}
            onChange={(e) => setTipoPagamento(e.target.value)}
            className="campo"
          >
            {(TIPOS_DE_PAGAMENTO.includes(tipoPagamento)
              ? TIPOS_DE_PAGAMENTO
              : [tipoPagamento, ...TIPOS_DE_PAGAMENTO]
            ).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="rotulo" htmlFor="co-categoria">
            Categoria
          </label>
          <SeletorDeCategoria
            id="co-categoria"
            categorias={categorias.data ?? []}
            value={categoriaId}
            onChange={setCategoriaId}
            vazio="Sem categoria"
            carregando={categorias.isLoading}
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-tinta-700 sm:col-span-2">
          <input
            type="checkbox"
            className="h-4 w-4 accent-brand-600"
            checked={soDiasUteis}
            onChange={(e) => setSoDiasUteis(e.target.checked)}
          />
          Só em dia útil — fim de semana ou feriado passa para o próximo dia
        </label>
      </div>

      {/* O que vai acontecer, antes de acontecer. */}
      {previa && (
        <div className="mt-4 rounded-2xl bg-tinta-50 p-4 text-sm text-tinta-600">
          {previa.quitado ? (
            <>Todas as parcelas já saíram — este consórcio não gera mais nada.</>
          ) : (
            <>
              {previa.numeros.length > 1 ? 'As parcelas ' : 'A parcela '}
              <strong className="num text-tinta-900">
                {juntar(previa.numeros)}
              </strong>{' '}
              de {previa.total} {previa.numeros.length > 1 ? 'vencem' : 'vence'}{' '}
              <strong className="num text-tinta-900">
                {formatData(vencimento)}
              </strong>{' '}
              e {previa.numeros.length > 1 ? 'nascem' : 'nasce'} no IXC 5 dias
              antes. Faltam <strong className="num">{previa.faltam}</strong>
              {previa.ultimaEm && <> — a última em {mesAno(previa.ultimaEm)}</>}
              ; depois dela o {oQueE} para sozinho.
              {nAntecipadas > 0 && (
                <>
                  {' '}
                  Do fim já foram {nAntecipadas}: a próxima a antecipar é a{' '}
                  <strong className="num text-tinta-900">{proximaDoFim}</strong>.
                </>
              )}
            </>
          )}
        </div>
      )}

      {irmas.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            {fornecedor!.nome} já tem {irmas.length} repetição(ões) mensal(is)
          </p>
          <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
            Se ficarem, cada mês vai ter as parcelas do {oQueE} e mais as
            delas. As marcadas são apagadas ao salvar — as contas que já
            geraram continuam no IXC.
          </p>
          <div className="mt-2 space-y-1">
            {irmas.map((r) => (
              <label
                key={r.id}
                className="flex items-center gap-2 text-sm text-amber-900 dark:text-amber-200"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 accent-amber-600"
                  checked={marcadas.has(r.id)}
                  onChange={(e) => {
                    const novo = new Set(marcadas);
                    if (e.target.checked) novo.add(r.id);
                    else novo.delete(r.id);
                    setApagar(novo);
                  }}
                />
                <span className="min-w-0 truncate">
                  {r.observacao} · {formatBRL(Number(r.valor))} · próxima{' '}
                  {formatData(r.proximoVencimento)}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {salvar.isError && <Aviso tom="erro">{mensagemErro(salvar.error)}</Aviso>}

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onFechar} className="btn btn-neutro">
          Cancelar
        </button>
        <button
          onClick={() => salvar.mutate()}
          disabled={!podeSalvar || salvar.isPending}
          className="btn btn-primario"
        >
          {salvar.isPending
            ? 'Salvando…'
            : editando
              ? 'Salvar'
              : convertendo
                ? `Virar ${oQueE}`
                : financiamento
                  ? 'Cadastrar financiamento'
                  : 'Cadastrar consórcio'}
        </button>
      </div>
    </Janela>
  );
}

/** A próxima vez que o dia cai depois de hoje ("todo dia 14" num dia 14 = mês que vem). */
function proximaData(dia: number): string {
  const agora = new Date();
  const hoje = Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate());
  let ano = agora.getFullYear();
  let mes = agora.getMonth();
  for (;;) {
    const ultimo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
    const d = Date.UTC(ano, mes, Math.min(dia, ultimo));
    if (d > hoje) return new Date(d).toISOString().slice(0, 10);
    mes += 1;
    if (mes > 11) {
      mes = 0;
      ano += 1;
    }
  }
}

/** `meses` depois de `iso`, voltando ao dia combinado quando o mês cabe. */
function somarMeses(iso: string, meses: number, dia: number | null): string {
  const [ano, mes, d] = iso.split('-').map(Number);
  const alvo = dia ?? d;
  const ultimo = new Date(Date.UTC(ano, mes - 1 + meses + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ano, mes - 1 + meses, Math.min(alvo, ultimo)))
    .toISOString()
    .slice(0, 10);
}

function mesAno(iso: string): string {
  return `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** [12, 13] → "12 e 13"; [12, 13, 14] → "12, 13 e 14". */
function juntar(itens: Array<string | number>): string {
  if (itens.length <= 1) return itens.join('');
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}

