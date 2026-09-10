import { useMutation } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Aviso,
  CabecalhoPagina,
  CampoDinheiro,
  Pagina,
  Selo,
  Vazio,
  type Tom,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { semAcento } from '../../lib/busca';
import { mesAnterior, mesAtual, mesSeguinte, nomeDoMes } from '../../lib/folha';
import { formatBRL, formatData } from '../../lib/format';
import { STATUS_LABEL, TIPO_LABEL } from '../../lib/status';
import type {
  ComposicaoSalario,
  ContaJaGerada,
  ContaPagar,
  FeriasNaFolha,
  LancamentoCalculado,
  ParcelaValeFolha,
  PreviewFuncionario,
  SituacaoAdiantamento,
  TipoLancamento,
} from '../../lib/types';

interface ItemGerar extends LancamentoCalculado {
  funcionarioId: string;
  nome: string;
  apelido: string | null;
  selecionado: boolean;
  /** Carteira assinada: a contabilidade já desconta o dia 25 lá. */
  carteiraAssinada: boolean;
  /** Situação do dia 25 desta pessoa nesta competência. */
  adiantamento: SituacaoAdiantamento | null;
  /** Como o saldo salarial foi montado. */
  composicao: ComposicaoSalario;
  /** Parcelas de vale/acerto desta competência. */
  vales: ParcelaValeFolha[];
  /**
   * Conta a pagar **deste mesmo lançamento** que já existe na competência —
   * salário, bônus ou dia 25. É o que faz a linha nascer desmarcada.
   */
  jaGerado: ContaJaGerada | null;
  /** Valor que a API calculou, antes de a tela mexer no dia 25. */
  valorOriginal: number;
  /**
   * Abater o adiantamento do dia 25 do que esta pessoa recebe agora. Vem
   * ligado para quem não tem carteira assinada (é como a API calculou) e pode
   * ser desligado — ex.: o dia 25 não foi gerado, então não há o que
   * descontar. Para quem tem carteira assinada vem desligado, porque a
   * contabilidade já cuida disso; ligar é uma escolha de quem gera a folha.
   */
  descontarAdiantamento: boolean;
  /**
   * Este lançamento sai como **férias** no lugar do salário. Só a linha de
   * salário chega a ligar isto: férias substituem o salário do mês, com conta
   * contábil e observação próprias, e o valor deixa de ser o saldo salarial —
   * passa a ser o que a contabilidade apurou, digitado aqui.
   */
  ferias: boolean;
  /** O que a folha sabe das férias desta pessoa no mês trabalhado. */
  feriasInfo: FeriasNaFolha;
}

/** O tipo com que a linha vai para o IXC — férias entram no lugar do salário. */
function tipoGerado(it: ItemGerar): TipoLancamento {
  return it.ferias ? 'FERIAS' : it.tipo;
}

/** A conta contábil da linha; férias podem ter a sua própria. */
function contaContabilGerada(it: ItemGerar): number {
  return it.ferias ? it.feriasInfo.contaContabil : it.contaContabil;
}

/**
 * A observação que a pessoa vê no IXC. A de férias sai limpa: comissão, hora
 * extra e vale não entram num pagamento de férias, e o texto do salário os
 * descreveria.
 */
function observacaoGerada(it: ItemGerar): string {
  return it.ferias ? it.feriasInfo.observacao : it.observacao;
}

/** O pagamento que já existe para esta linha — o de férias quando ela é férias. */
function jaGeradoDoItem(it: ItemGerar): ContaJaGerada | null {
  return it.ferias ? it.feriasInfo.jaGerado : it.jaGerado;
}

/**
 * O pagamento do **outro** tipo que já saiu no lugar deste. De férias é o
 * salário: se ele já foi pago neste mês, pagar as férias por cima paga o mesmo
 * mês duas vezes, e o aviso tem de aparecer mesmo com a linha valendo férias.
 */
function tambemJaGerado(it: ItemGerar): ContaJaGerada | null {
  return it.ferias ? it.jaGerado : null;
}

function arredondar(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Salário da pessoa sem nenhum abatimento do dia 25 — de onde a opção parte. */
function salarioCheio(c: ComposicaoSalario): number {
  return arredondar(c.saldo + c.adiantamentoDescontado);
}

/**
 * Como o adiantamento do dia 25 se divide entre os pagamentos da pessoa: sai
 * primeiro do salário e, se não couber ali, desce para o bônus — na empresa o
 * bônus também conta como salário. O que nem o bônus cobrir fica de aviso, sem
 * ser abatido de lugar nenhum.
 */
interface RepartoDia25 {
  /** Quanto do dia 25 está sendo abatido ao todo (0 = desconto desligado). */
  total: number;
  /** Parte que saiu do salário. */
  noSalario: number;
  /** Parte que desceu para o bônus. */
  noBonus: number;
  /** O que não coube em lugar nenhum. */
  aDescoberto: number;
  /** Novo valor do salário (null = a pessoa não tem lançamento de salário). */
  salario: number | null;
  /** Novo valor do bônus (null = a pessoa não tem lançamento de bônus). */
  bonus: number | null;
}

function repartirDia25(
  total: number,
  cheioSalario: number | null,
  cheioBonus: number | null,
): RepartoDia25 {
  const noSalario = arredondar(Math.min(total, Math.max(0, cheioSalario ?? 0)));
  const sobra = arredondar(total - noSalario);
  const noBonus = arredondar(Math.min(sobra, Math.max(0, cheioBonus ?? 0)));
  return {
    total,
    noSalario,
    noBonus,
    aDescoberto: arredondar(sobra - noBonus),
    salario: cheioSalario === null ? null : arredondar(cheioSalario - noSalario),
    bonus: cheioBonus === null ? null : arredondar(cheioBonus - noBonus),
  };
}

/** Valor de um lançamento depois do reparto do dia 25. */
function valorComDia25(it: ItemGerar, reparto: RepartoDia25): number {
  if (it.tipo === 'SALARIO' && reparto.salario !== null) return reparto.salario;
  if (it.tipo === 'BONUS' && reparto.bonus !== null) return reparto.bonus;
  return it.valorOriginal;
}

/**
 * Este lançamento vira conta a pagar? Zerado, não: a API recusa valor abaixo
 * de R$ 0,01 e derruba o lote inteiro. Acontece quando o dia 25 come todo o
 * salário — aí quem paga o resto é o bônus, e a linha de salário some.
 */
function vaiGerar(it: ItemGerar): boolean {
  return it.selecionado && it.valor > 0;
}

/** Uma pessoa na prévia, com todos os lançamentos que ela recebe. */
interface Grupo {
  funcionarioId: string;
  nome: string;
  apelido: string | null;
  /** Índices em `itens` dos lançamentos desta pessoa. */
  indices: number[];
  adiantamento: SituacaoAdiantamento | null;
  composicao: ComposicaoSalario;
  carteiraAssinada: boolean;
  /** Índice do lançamento de SALÁRIO, de onde o dia 25 sai primeiro. */
  salarioIdx: number | null;
  /** Índice do lançamento de BÔNUS, que absorve o que não coube no salário. */
  bonusIdx: number | null;
  /** Dá para escolher abater o dia 25 desta pessoa nesta prévia? */
  temOpcaoDia25: boolean;
  descontarAdiantamento: boolean;
  /** Esta pessoa está sendo paga como férias nesta prévia. */
  ferias: boolean;
  /** O que a folha sabe das férias dela no mês trabalhado. */
  feriasInfo: FeriasNaFolha;
  reparto: RepartoDia25;
}

/**
 * Dá para escolher abater o dia 25 desta pessoa? Só quando há adiantamento
 * apurado e algum pagamento de onde tirá-lo. Estando de férias, não: quem está
 * de férias não recebeu o dia 25, e não há o que abater.
 */
function podeEscolherDia25(
  g: Pick<Grupo, 'composicao' | 'salarioIdx' | 'bonusIdx' | 'ferias'>,
): boolean {
  return (
    !g.ferias &&
    g.composicao.adiantamento > 0 &&
    (g.salarioIdx !== null || g.bonusIdx !== null)
  );
}

/**
 * O valor cheio da linha que ocupa o lugar do salário. De férias é o que a
 * contabilidade apurou (só um ponto de partida, editável na tela); fora delas,
 * o saldo salarial sem nenhum abatimento do dia 25.
 */
function cheioDoSalario(
  g: Pick<Grupo, 'composicao' | 'ferias' | 'feriasInfo'>,
): number {
  return g.ferias ? g.feriasInfo.valorSugerido : salarioCheio(g.composicao);
}

/** Quanto do dia 25 está mesmo saindo — sem contar o que ficou a descoberto. */
function abatidoDia25(r: RepartoDia25): number {
  return arredondar(r.noSalario + r.noBonus);
}

/** O reparto do dia 25 de uma pessoa, do jeito que está agora na tela. */
function repartoDoGrupo(
  itens: ItemGerar[],
  g: Pick<
    Grupo,
    | 'composicao'
    | 'salarioIdx'
    | 'bonusIdx'
    | 'temOpcaoDia25'
    | 'descontarAdiantamento'
    | 'ferias'
    | 'feriasInfo'
  >,
): RepartoDia25 {
  const total =
    g.temOpcaoDia25 && g.descontarAdiantamento ? g.composicao.adiantamento : 0;
  return repartirDia25(
    total,
    g.salarioIdx === null ? null : cheioDoSalario(g),
    g.bonusIdx === null ? null : itens[g.bonusIdx].valorOriginal,
  );
}

// ---------------------------------------------------------------------------
// A régua: o saldo salarial aberto termo a termo, do jeito que se confere uma
// conta no papel. É a peça central da tela — se um número surpreende, é aqui
// que a pessoa descobre de onde ele veio.
// ---------------------------------------------------------------------------
interface Termo {
  rotulo: string;
  valor: number;
  nota?: string;
  sinal: '+' | '−';
}

function Regua({ c, reparto }: { c: ComposicaoSalario; reparto: RepartoDia25 }) {
  const termos: Termo[] = [
    {
      rotulo: c.usouValorAReceber ? 'A receber na folha' : 'Salário base',
      valor: c.salarioBase,
      sinal: '+',
    },
  ];
  if (c.comissao > 0) {
    termos.push({
      rotulo: 'Comissão',
      valor: c.comissao,
      nota: `${c.vendas} × ${formatBRL(c.valorPorVenda)}`,
      sinal: '+',
    });
  }
  if (c.horasExtras > 0) {
    termos.push({ rotulo: 'Horas extras', valor: c.horasExtras, sinal: '+' });
  }
  if (c.valesCredito > 0) {
    termos.push({
      rotulo: 'Acerto a favor',
      valor: c.valesCredito,
      sinal: '+',
    });
  }
  if (c.descontos > 0) {
    termos.push({ rotulo: 'Descontos fixos', valor: c.descontos, sinal: '−' });
  }
  if (c.vales > 0) {
    termos.push({ rotulo: 'Vale do mês', valor: c.vales, sinal: '−' });
  }
  /* A falta tem chip próprio, e não some dentro dos descontos fixos: sem ele a
     conta na tela não fecha — o salário menos os outros termos dava um número
     diferente do "a pagar", e quem confere não achava a diferença. */
  if (c.faltas > 0) {
    termos.push({ rotulo: 'Faltas', valor: c.faltas, sinal: '−' });
  }
  if (reparto.noSalario > 0) {
    termos.push({
      rotulo: 'Adiantamento dia 25',
      valor: reparto.noSalario,
      // Quando o dia 25 não coube no salário, o resto foi para o bônus.
      nota:
        reparto.noBonus > 0
          ? `+ ${formatBRL(reparto.noBonus)} no bônus`
          : undefined,
      sinal: '−',
    });
  }

  const saldo = reparto.salario ?? salarioCheio(c);

  // Um termo só: o salário fala por si.
  if (termos.length === 1) return null;

  return (
    <div className="rolagem-fina mb-4 md:overflow-x-auto">
      {/* No celular a conta quebra linha em vez de rolar para o lado: o "a
          pagar", no fim dela, é justamente o que não pode ficar escondido. */}
      <div className="flex flex-wrap items-stretch gap-1 md:min-w-max md:flex-nowrap">
        {termos.map((t, i) => (
          <div key={t.rotulo} className="flex items-stretch gap-1">
            {i > 0 && (
              <span className="flex items-center px-1 font-display text-lg font-medium text-tinta-300">
                {t.sinal}
              </span>
            )}
            <div className="rounded-lg bg-papel px-3 py-2 ring-1 ring-tinta-100">
              <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-tinta-400">
                {t.rotulo}
              </div>
              <div
                className={`font-display text-[15px] font-semibold leading-tight num ${
                  t.sinal === '−' ? 'text-rose-600' : 'text-tinta-900'
                }`}
              >
                {t.sinal === '−' ? '−' : ''}
                {formatBRL(t.valor)}
              </div>
              {t.nota && (
                <div className="text-[10px] text-tinta-400 num">{t.nota}</div>
              )}
            </div>
          </div>
        ))}
        <span className="flex items-center px-1.5 font-display text-lg font-medium text-tinta-300">
          =
        </span>
        <div className="rounded-lg bg-barra px-4 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-brand-300">
            A pagar
          </div>
          <div className="font-display text-[15px] font-semibold leading-tight text-white num">
            {formatBRL(saldo)}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A escolha de pagar férias no lugar do salário.
 *
 * Quem entra de férias não recebe o salário do mês: recebe o que a
 * contabilidade apurou das férias, que não tem relação com o saldo salarial
 * daqui — nem comissão, nem hora extra, nem vale entram nele. Por isso ligar
 * esta opção troca o lançamento inteiro (tipo, conta contábil e observação) e
 * deixa o valor por conta de quem gera a folha.
 *
 * Ela aparece para todo mundo que tem salário na prévia, e não só para quem a
 * tela de Férias conhece: o registro das férias depende do PDF da
 * contabilidade, e quem entrou de férias ontem precisa ser pago hoje.
 */
function OpcaoFerias({
  grupo,
  onChange,
}: {
  grupo: Grupo;
  onChange: (ferias: boolean) => void;
}) {
  if (grupo.salarioIdx === null) return null;
  const { feriasInfo, ferias } = grupo;
  const periodo = feriasInfo.periodo;

  return (
    <div className="mb-4 rounded-lg bg-papel px-3 py-2 ring-1 ring-tinta-100">
      <label className="flex w-fit flex-wrap items-center gap-2 text-xs text-tinta-600">
        <input
          type="checkbox"
          className="accent-brand-600"
          checked={ferias}
          onChange={(e) => onChange(e.target.checked)}
        />
        Esta pessoa está de férias — pagar{' '}
        <strong className="text-tinta-900">férias</strong> no lugar do salário
        {ferias && (
          <Selo tom="info" pequeno>
            sai como férias
          </Selo>
        )}
        {periodo && (
          <span className="text-tinta-400">
            registradas de {formatData(periodo.inicio)} a{' '}
            {formatData(periodo.fim)} ({periodo.dias} dias)
          </span>
        )}
      </label>

      {ferias ? (
        <p className="mt-1.5 pl-6 text-[11px] leading-relaxed text-tinta-500">
          O valor é o que a contabilidade apurou —{' '}
          <strong className="text-tinta-700">digite-o no campo abaixo</strong>. O
          que está lá é só um ponto de partida. Comissão, hora extra e vale não
          entram num pagamento de férias, e o adiantamento do dia 25 sai de cena:
          quem está de férias não o recebe.
        </p>
      ) : (
        <p className="mt-1.5 pl-6 text-[11px] leading-relaxed text-tinta-400">
          Marque quando a pessoa saiu de férias neste mês: o lançamento passa a
          ser de férias no IXC, com a conta contábil e a observação de férias, e
          ela deixa de receber o adiantamento do dia 25.
        </p>
      )}

      {ferias && grupo.composicao.vales > 0 && (
        <p className="mt-1.5 pl-6 text-[11px] leading-relaxed text-amber-700">
          O vale deste mês ({formatBRL(grupo.composicao.vales)}) não é abatido
          das férias e a parcela continua em aberto — ela volta na próxima folha,
          quando a pessoa voltar a receber salário.
        </p>
      )}
    </div>
  );
}

/**
 * Escolha de abater ou não o adiantamento do dia 25 do que a pessoa recebe
 * agora.
 *
 * Para quem não tem carteira assinada vem ligada, que é como a API calculou, e
 * serve para quando o pagamento do dia 25 não chegou a sair. Para quem tem
 * carteira assinada vem desligada — a contabilidade já desconta o dia 25 do
 * salário oficial —, mas dá para ligar quando a empresa também for abater do
 * que esta folha paga.
 */
function OpcaoDia25({
  grupo,
  onChange,
}: {
  grupo: Grupo;
  onChange: (descontar: boolean) => void;
}) {
  if (!grupo.temOpcaoDia25) return null;
  const { composicao, reparto, carteiraAssinada } = grupo;
  const ligado = grupo.descontarAdiantamento;
  const naoGerado = grupo.adiantamento?.situacao === 'NAO_GERADO';
  return (
    <div className="mb-4 rounded-lg bg-papel px-3 py-2 ring-1 ring-tinta-100">
      <label className="flex w-fit flex-wrap items-center gap-2 text-xs text-tinta-600">
        <input
          type="checkbox"
          className="accent-brand-600"
          checked={ligado}
          onChange={(e) => onChange(e.target.checked)}
        />
        Descontar o adiantamento do dia 25 (
        <span className="num font-semibold">
          {formatBRL(composicao.adiantamento)}
        </span>
        ) deste pagamento
        {!ligado && (
          <Selo tom="atencao" pequeno>
            saindo cheio
          </Selo>
        )}
        {ligado && naoGerado && (
          <span className="text-amber-700">
            — o dia 25 não saiu neste mês; confira se a pessoa recebeu.
          </span>
        )}
      </label>

      {carteiraAssinada && !ligado && (
        <p className="mt-1.5 pl-6 text-[11px] leading-relaxed text-tinta-400">
          Carteira assinada: a contabilidade já desconta o dia 25 do salário
          oficial. Marque só se a empresa for abater também do que esta folha
          paga.
        </p>
      )}
      {ligado && reparto.noBonus > 0 && (
        <p className="mt-1.5 pl-6 text-[11px] leading-relaxed text-tinta-500">
          Não coube tudo no salário:{' '}
          <span className="num font-semibold">
            {formatBRL(reparto.noSalario)}
          </span>{' '}
          saem do salário e{' '}
          <span className="num font-semibold">{formatBRL(reparto.noBonus)}</span>{' '}
          do bônus — na empresa o bônus também conta como salário.
        </p>
      )}
      {ligado && reparto.aDescoberto > 0 && (
        <p className="mt-1.5 pl-6 text-[11px] leading-relaxed text-amber-700">
          Faltou de onde tirar{' '}
          <span className="num font-semibold">
            {formatBRL(reparto.aDescoberto)}
          </span>
          : o que a folha paga não cobre o dia 25 inteiro. Ajuste na mão antes de
          gerar.
        </p>
      )}
    </div>
  );
}

/** Parcelas de vale que já foram acertadas e por isso não entram no saldo. */
function ValesJaBaixados({ vales }: { vales: ParcelaValeFolha[] }) {
  const baixadas = vales.filter((v) => v.descontada);
  if (baixadas.length === 0) return null;
  return (
    <p className="mb-4 text-xs text-tinta-500">
      Já acertado nesta folha, fora deste saldo:{' '}
      {baixadas
        .map(
          (v) =>
            `${v.descricao} ${v.numero}/${v.de} ${
              v.sentido === 'CREDITO' ? '+' : '−'
            }${formatBRL(v.valor)}`,
        )
        .join(' · ')}
      .
    </p>
  );
}

/**
 * A conta a pagar daquele lançamento que já existe nesta competência. É o que
 * decide quem nasce marcado na prévia: quem já recebeu (ou já tem o pagamento
 * criado) fica de fora, cada tipo olhando o seu — o bônus tem o dele.
 */
function jaGeradoDoLancamento(
  tipo: TipoLancamento,
  f: PreviewFuncionario,
): ContaJaGerada | null {
  if (tipo === 'SALARIO') return f.salarioJaGerado;
  if (tipo === 'BONUS') return f.bonusJaGerado;
  if (tipo === 'ADIANTAMENTO') {
    const a = f.adiantamento;
    if (!a || a.situacao === 'NAO_GERADO' || !a.status) return null;
    return { situacao: a.situacao, status: a.status, pagoEm: a.pagoEm };
  }
  return null;
}

/**
 * Avisa quando aquele pagamento já saiu nesta competência. Gerar de novo cria
 * um segundo pagamento — e é justamente por isso que o vale já abatido não é
 * descontado outra vez.
 */
function SeloJaGerado({
  tipo,
  conta,
}: {
  tipo: TipoLancamento;
  conta: ContaJaGerada | null;
}) {
  if (!conta) return null;
  const nome = TIPO_LABEL[tipo].toLowerCase();
  return (
    <Selo
      tom={conta.situacao === 'PAGO' ? 'erro' : 'atencao'}
      pequeno
      titulo={`Já existe conta a pagar de ${nome} nesta folha. Gerar de novo paga duas vezes — confira em Contas a Pagar antes.`}
    >
      {conta.situacao === 'PAGO'
        ? `${nome} já pago${conta.pagoEm ? ` em ${formatData(conta.pagoEm)}` : ''}`
        : `${nome} já gerado · ${STATUS_LABEL[conta.status].toLowerCase()}`}
    </Selo>
  );
}

/**
 * Diz que a pessoa está de férias — e, no dia 25, por que ela veio desmarcada.
 *
 * "De férias" aqui é o que a folha consegue provar: ou a tela de Férias
 * registrou um período que pega o dia 25, ou o pagamento das férias já saiu.
 * Nos dois casos o adiantamento não é devido; no quinto dia o selo só lembra
 * que aquele salário virou pagamento de férias.
 */
function SeloFerias({
  modo,
  ferias,
}: {
  modo: ModoPagamento;
  ferias: FeriasNaFolha;
}) {
  if (!ferias.deFerias) return null;
  const periodo = ferias.periodo;
  const quando = periodo
    ? ` (${formatData(periodo.inicio)} a ${formatData(periodo.fim)})`
    : '';
  return (
    <Selo
      pequeno
      tom="info"
      titulo={
        modo === 'DIA_25'
          ? `Está de férias${quando} — adiantamento é sobre o mês que se está trabalhando, e quem está de férias não está. Marque só se a empresa for adiantar mesmo assim.`
          : `Está de férias${quando} — o salário do mês sai como pagamento de férias, no valor que a contabilidade apurou.`
      }
    >
      de férias{modo === 'DIA_25' ? ' · não recebe o dia 25' : ''}
    </Selo>
  );
}

/**
 * Diz se o adiantamento do dia 25 daquela pessoa já saiu. No quinto dia é o
 * que justifica (ou desmente) o desconto no salário; no dia 25 serve de aviso
 * para não gerar o mesmo pagamento duas vezes.
 */
function SeloAdiantamento({
  modo,
  adiantamento,
  abatido,
}: {
  modo: ModoPagamento;
  adiantamento: SituacaoAdiantamento | null;
  /**
   * Quanto do dia 25 está mesmo saindo deste pagamento. Zero quando o desconto
   * foi desligado na tela; menos que o valor cheio quando não coube tudo.
   */
  abatido: number;
}) {
  if (!adiantamento) return null;
  const { situacao, pagoEm } = adiantamento;

  if (modo === 'DIA_25') {
    if (situacao === 'NAO_GERADO') return null;
    return (
      <Selo
        pequeno
        tom={situacao === 'PAGO' ? 'pago' : 'atencao'}
        titulo="Este adiantamento já foi gerado neste mês — gerar de novo duplica o pagamento."
      >
        {situacao === 'PAGO'
          ? `já pago${pagoEm ? ` em ${formatData(pagoEm)}` : ''}`
          : 'já gerado · aguardando pagamento'}
      </Selo>
    );
  }

  if (situacao === 'PAGO') {
    return (
      <Selo pequeno tom="pago" titulo="Adiantamento do dia 25 confirmado pelo banco.">
        dia 25 pago{pagoEm ? ` em ${formatData(pagoEm)}` : ''}
      </Selo>
    );
  }
  if (situacao === 'PENDENTE') {
    return (
      <Selo
        pequeno
        tom="atencao"
        titulo="A conta do dia 25 existe, mas o banco ainda não confirmou o pagamento."
      >
        dia 25 ainda não pago
      </Selo>
    );
  }
  const tom: Tom = abatido > 0 ? 'erro' : 'neutro';
  return (
    <Selo
      pequeno
      tom={tom}
      titulo={
        abatido > 0
          ? `Não há conta a pagar do dia 25 neste mês, mas ${formatBRL(abatido)} estão sendo descontados do pagamento. Confira antes de gerar.`
          : 'Não há conta a pagar do dia 25 neste mês.'
      }
    >
      dia 25 não gerado{abatido > 0 ? ` · ${formatBRL(abatido)} descontados` : ''}
    </Selo>
  );
}

/** Os dois pagamentos do mês. */
type ModoPagamento = 'DIA_25' | 'QUINTO_DIA';

/**
 * O aviso que abre a prévia: o que já saiu e quem está de férias. As duas
 * coisas explicam linhas que nascem desmarcadas, e sem elas a folha parece ter
 * esquecido gente.
 */
function montarAviso(
  modo: ModoPagamento,
  pessoas: PreviewFuncionario[],
  itens: ItemGerar[],
): string | null {
  if (itens.length === 0) {
    return modo === 'DIA_25'
      ? 'Ninguém está marcado para receber adiantamento no dia 25.'
      : 'Nenhum salário ou bônus a gerar neste mês trabalhado.';
  }

  const avisos: string[] = [];
  const deFerias = pessoas.filter((p) => p.ferias.deFerias).length;
  if (deFerias > 0) {
    avisos.push(
      modo === 'DIA_25'
        ? `${deFerias} pessoa(s) de férias vieram desmarcadas: quem está de férias não recebe adiantamento.`
        : `${deFerias} pessoa(s) de férias — o salário delas já veio como pagamento de férias. Confira o valor com a contabilidade antes de gerar.`,
    );
  }

  // Fora as de férias, que o aviso acima já explica.
  const jaGerados = itens.filter(
    (i) => !i.selecionado && (jaGeradoDoItem(i) || tambemJaGerado(i)),
  ).length;
  if (jaGerados > 0) {
    avisos.push(
      `${jaGerados} pagamento(s) já existem nesta folha e vieram desmarcados — marque só se quiser mesmo gerar de novo.`,
    );
  }

  return avisos.length > 0 ? avisos.join(' ') : null;
}

/** Perto do dia 25 a folha provável é a do adiantamento. */
function modoInicial(): ModoPagamento {
  return new Date().getDate() >= 20 ? 'DIA_25' : 'QUINTO_DIA';
}

/**
 * Em que mês o dinheiro sai, dado o mês que foi trabalhado.
 *
 * O adiantamento é pago no dia 25 do próprio mês em que se trabalha; o salário,
 * no início do mês seguinte — o de agosto sai em setembro. A API raciocina pelo
 * mês do pagamento; a tela pergunta pelo mês trabalhado, que é como se fala.
 */
function mesDoPagamento(mesTrabalhado: string, modo: ModoPagamento): string {
  return modo === 'DIA_25' ? mesTrabalhado : mesSeguinte(mesTrabalhado);
}

/**
 * Qual mês de trabalho está na mesa hoje. Perto do dia 25 é o mês corrente (o
 * adiantamento é sobre o que se está trabalhando agora); no começo do mês é o
 * anterior, que é o que se vai pagar.
 */
function mesTrabalhadoInicial(modo: ModoPagamento): string {
  return modo === 'DIA_25' ? mesAtual() : mesAnterior(mesAtual());
}

export function Folha() {
  const navigate = useNavigate();
  const [modo, setModo] = useState<ModoPagamento>(modoInicial());
  const [mesTrabalhado, setMesTrabalhado] = useState(() =>
    mesTrabalhadoInicial(modoInicial()),
  );
  const competencia = mesDoPagamento(mesTrabalhado, modo);
  const [itens, setItens] = useState<ItemGerar[]>([]);
  /** Filtra as linhas da prévia por nome ou apelido. */
  const [buscaPessoa, setBuscaPessoa] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  /** Funcionários com o detalhamento aberto. */
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});

  const preview = useMutation({
    mutationFn: async () => {
      // Dia 25 paga só o adiantamento; no quinto dia sai o salário (já com o
      // adiantamento descontado de quem recebeu) mais os bônus.
      const body = {
        competencia,
        // Sem ele a API deduz o mês trabalhado da competência, o que só vale
        // no quinto dia; no dia 25 os dois são o mesmo mês, e é por aqui que a
        // folha do dia 25 reconhece quem já recebeu férias.
        mesTrabalhado,
        incluirAdiantamento: modo === 'DIA_25',
        incluirSalario: modo === 'QUINTO_DIA',
        incluirBonus: modo === 'QUINTO_DIA',
      };
      return (
        await api.post<PreviewFuncionario[]>('/contas-pagar/preparar-folha', body)
      ).data;
    },
    onSuccess: (data) => {
      const flat: ItemGerar[] = [];
      for (const f of data) {
        const temSalario = f.lancamentos.some((l) => l.tipo === 'SALARIO');
        const bonus = f.lancamentos.find((l) => l.tipo === 'BONUS') ?? null;
        // Quem não tem carteira assinada já veio da API com o dia 25 abatido;
        // quem tem, não — a contabilidade cuida disso, então aqui a opção
        // nasce desligada.
        const descontarAdiantamento = f.composicao.adiantamentoDescontado > 0;
        // Quem a folha sabe estar de férias já vem marcado: o salário do mês
        // nasce como pagamento de férias, e o dia 25 sai de cena.
        const ferias = temSalario && f.ferias.deFerias;
        const temOpcaoDia25 =
          !ferias && f.composicao.adiantamento > 0 && (temSalario || !!bonus);
        const reparto = repartirDia25(
          temOpcaoDia25 && descontarAdiantamento ? f.composicao.adiantamento : 0,
          temSalario
            ? cheioDoSalario({
                composicao: f.composicao,
                ferias,
                feriasInfo: f.ferias,
              })
            : null,
          bonus ? bonus.valor : null,
        );

        for (const l of f.lancamentos) {
          const ehFerias = ferias && l.tipo === 'SALARIO';
          // Pagamento que já existe na competência vem desmarcado: o certo é
          // conferir em Contas a Pagar antes de gerar outro. Vale para os
          // quatro — salário, férias, bônus e dia 25 —, cada um olhando a sua
          // própria conta. `jaGerado` guarda sempre a do tipo original; a de
          // férias vem de `feriasInfo`, e assim as duas continuam à vista.
          const jaGerado = jaGeradoDoLancamento(l.tipo, f);
          // Nesta linha, o que já saiu é o pagamento de férias.
          const feriasJaPagas = ehFerias && f.ferias.jaGerado !== null;
          // De férias não se adianta salário: o dia 25 nasce desmarcado, do
          // mesmo jeito que o pagamento que já saiu.
          const semDia25 = l.tipo === 'ADIANTAMENTO' && f.ferias.deFerias;
          const item: ItemGerar = {
            ...l,
            funcionarioId: f.funcionarioId,
            nome: f.nome,
            apelido: f.apelido,
            // Salário já pago também desmarca a linha de férias: os dois
            // pagam o mesmo mês.
            selecionado: !jaGerado && !feriasJaPagas && !semDia25,
            carteiraAssinada: f.carteiraAssinada,
            adiantamento: f.adiantamento,
            composicao: f.composicao,
            vales: f.vales,
            jaGerado,
            valorOriginal: l.valor,
            descontarAdiantamento,
            ferias: ehFerias,
            feriasInfo: f.ferias,
          };
          flat.push({ ...item, valor: valorComDia25(item, reparto) });
        }
      }
      setItens(flat);
      setFeedback(montarAviso(modo, data, flat));
    },
    onError: (err) => setFeedback(mensagemErro(err)),
  });

  const gerar = useMutation({
    mutationFn: async () => {
      const selecionados = itens.filter(vaiGerar);
      const body = {
        itens: selecionados.map((i) => ({
          funcionarioId: i.funcionarioId,
          // Férias vão ao IXC como férias: tipo, conta contábil e observação
          // próprias. Era isso que fazia um pagamento de férias ficar gravado
          // como salário só porque o valor tinha sido trocado na mão.
          tipo: tipoGerado(i),
          valor: i.valor,
          contaContabil: contaContabilGerada(i),
          observacao: observacaoGerada(i),
          competencia,
        })),
      };
      return (await api.post<ContaPagar[]>('/contas-pagar', body)).data;
    },
    onSuccess: (data) => {
      const comErro = data.filter((c) => c.status === 'ERRO').length;
      setFeedback(
        `${data.length} conta(s) criada(s) no IXC${
          comErro ? `, ${comErro} com erro` : ''
        }. Abrindo Contas a Pagar…`,
      );
      setTimeout(() => navigate('/folha/pagamentos'), 1200);
    },
    onError: (err) => setFeedback(`Não deu para gerar: ${mensagemErro(err)}`),
  });

  const totalSelecionado = itens
    .filter(vaiGerar)
    .reduce((s, i) => s + i.valor, 0);

  // Uma linha por pessoa (com o total), preservando os índices dos lançamentos
  // que a compõem para o detalhamento e para a geração.
  const grupos = useMemo<Grupo[]>(() => {
    const porFuncionario = new Map<string, Grupo>();
    itens.forEach((it, idx) => {
      const grupo = porFuncionario.get(it.funcionarioId) ?? {
        funcionarioId: it.funcionarioId,
        nome: it.nome,
        apelido: it.apelido,
        indices: [],
        adiantamento: it.adiantamento,
        composicao: it.composicao,
        carteiraAssinada: it.carteiraAssinada,
        salarioIdx: null,
        bonusIdx: null,
        temOpcaoDia25: false,
        descontarAdiantamento: it.descontarAdiantamento,
        ferias: false,
        feriasInfo: it.feriasInfo,
        reparto: repartirDia25(0, null, null),
      };
      grupo.indices.push(idx);
      if (it.tipo === 'SALARIO') grupo.salarioIdx = idx;
      if (it.tipo === 'BONUS') grupo.bonusIdx = idx;
      // Só a linha de salário carrega a marca; ela é que vira férias.
      if (it.ferias) grupo.ferias = true;
      porFuncionario.set(it.funcionarioId, grupo);
    });

    const lista = [...porFuncionario.values()];
    for (const g of lista) {
      // No modo dia 25 a lista só tem adiantamentos: não há de onde abater, e
      // a opção nem aparece. De férias também não — ver `podeEscolherDia25`.
      g.temOpcaoDia25 = podeEscolherDia25(g);
      g.reparto = repartoDoGrupo(itens, g);
    }
    return lista;
  }, [itens]);

  // A busca só esconde linhas; nada sai da seleção por não estar à vista. Quem
  // procurou "Dão" para conferir um valor não quer que os outros 53 pagamentos
  // se desmarquem sozinhos.
  // Sem acento: quem procura o "Dão" escreve "dao".
  const procurado = semAcento(buscaPessoa.trim());
  const gruposVisiveis = procurado
    ? grupos.filter((g) =>
        semAcento(`${g.nome} ${g.apelido ?? ''}`).includes(procurado),
      )
    : grupos;

  /**
   * O que a caixa do cabeçalho manda: as linhas à vista que viram conta. As
   * zeradas ficam de fora — não há o que gerar nelas.
   */
  const geraveisVisiveis = gruposVisiveis
    .flatMap((g) => g.indices)
    .filter((i) => itens[i].valor > 0);
  const marcadosVisiveis = geraveisVisiveis.filter((i) => itens[i].selecionado);
  const todosVisiveis =
    geraveisVisiveis.length > 0 &&
    marcadosVisiveis.length === geraveisVisiveis.length;

  /** Marca (ou desmarca) tudo que está à vista agora. */
  function marcarVisiveis(marcar: boolean) {
    const alvo = new Set(gruposVisiveis.flatMap((g) => g.indices));
    setItens((prev) =>
      prev.map((it, i) =>
        alvo.has(i) && it.valor > 0 ? { ...it, selecionado: marcar } : it,
      ),
    );
  }

  function toggle(idx: number) {
    setItens((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, selecionado: !it.selecionado } : it)),
    );
  }
  function editarValor(idx: number, valor: number) {
    setItens((prev) => prev.map((it, i) => (i === idx ? { ...it, valor } : it)));
  }
  /**
   * Liga/desliga o abatimento do dia 25 das pessoas indicadas e refaz o
   * reparto: o valor sai do salário e, no que não couber ali, do bônus.
   */
  function descontarDia25(alvos: Grupo[], descontar: boolean) {
    const comOpcao = alvos.filter((g) => g.temOpcaoDia25);
    if (comOpcao.length === 0) return;
    setItens((prev) => {
      const repartos = new Map(
        comOpcao.map((g) => [
          g.funcionarioId,
          repartoDoGrupo(prev, { ...g, descontarAdiantamento: descontar }),
        ]),
      );
      return prev.map((it) => {
        const reparto = repartos.get(it.funcionarioId);
        if (!reparto) return it;
        const atualizado = { ...it, descontarAdiantamento: descontar };
        return { ...atualizado, valor: valorComDia25(atualizado, reparto) };
      });
    });
  }
  /**
   * Liga/desliga o pagamento de férias das pessoas indicadas: a linha de
   * salário passa a sair como férias, com a conta contábil e a observação de
   * férias, e o valor vira o que a contabilidade apurou — para ser conferido e
   * corrigido no campo. O dia 25 deixa de ser abatido junto: quem está de
   * férias não o recebeu.
   */
  function marcarFerias(alvos: Grupo[], ferias: boolean) {
    const comSalario = alvos.filter((g) => g.salarioIdx !== null);
    if (comSalario.length === 0) return;
    const alvo = new Set(comSalario.map((g) => g.funcionarioId));
    setItens((prev) => {
      const repartos = new Map(
        comSalario.map((g) => {
          const depois = { ...g, ferias };
          return [
            g.funcionarioId,
            repartoDoGrupo(prev, {
              ...depois,
              temOpcaoDia25: podeEscolherDia25(depois),
            }),
          ];
        }),
      );
      return prev.map((it) => {
        const reparto = repartos.get(it.funcionarioId);
        if (!reparto || !alvo.has(it.funcionarioId)) return it;
        const atualizado = { ...it, ferias: ferias && it.tipo === 'SALARIO' };
        return {
          ...atualizado,
          valor: valorComDia25(atualizado, reparto),
          // Se o pagamento de férias já saiu, a linha se desmarca sozinha —
          // como qualquer outro que já existe. Marcar de volta é escolha de
          // quem gera; por isso ela nunca se remarca sozinha.
          selecionado:
            atualizado.selecionado &&
            !jaGeradoDoItem(atualizado) &&
            !tambemJaGerado(atualizado),
        };
      });
    });
  }
  function selecionarGrupo(indices: number[], selecionado: boolean) {
    const alvo = new Set(indices);
    setItens((prev) =>
      prev.map((it, i) =>
        alvo.has(i) && it.valor > 0 ? { ...it, selecionado } : it,
      ),
    );
  }
  function limparPrevia() {
    setItens([]);
    setAbertos({});
    setFeedback(null);
    setBuscaPessoa('');
  }
  /** Trocar de pagamento invalida a prévia anterior. */
  function trocarModo(novo: ModoPagamento) {
    if (novo === modo) return;
    setModo(novo);
    limparPrevia();
  }
  /** O mês trabalhado é o mesmo nos dois pagamentos — só muda quando sai. */
  function trocarMes(novo: string) {
    if (!novo || novo === mesTrabalhado) return;
    setMesTrabalhado(novo);
    limparPrevia();
  }
  function alternarDetalhe(funcionarioId: string) {
    setAbertos((prev) => ({ ...prev, [funcionarioId]: !prev[funcionarioId] }));
  }
  /** Total que a pessoa recebe: só o que está marcado. */
  function totalDoGrupo(indices: number[]): number {
    return indices.reduce(
      (s, i) => s + (vaiGerar(itens[i]) ? itens[i].valor : 0),
      0,
    );
  }

  const marcados = itens.filter(vaiGerar).length;

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Gerar folha"
        titulo={
          modo === 'DIA_25' ? 'Adiantamento do dia 25' : 'Salário do quinto dia'
        }
        descricao={
          modo === 'DIA_25'
            ? 'Só o adiantamento de quem recebe no dia 25, sobre o mês que está sendo trabalhado.'
            : 'Salário e bônus do mês trabalhado. Quem recebeu no dia 25 vem com o adiantamento descontado; quem tem carteira assinada vem cheio, mas dá para descontar.'
        }
      />

      <div className="surgir surgir-1 card mb-6 p-5">
        <div className="flex flex-wrap items-end gap-5">
          <div>
            <span className="rotulo">Pagamento</span>
            <div className="inline-flex rounded-xl bg-tinta-100 p-1">
              <BotaoModo
                ativo={modo === 'DIA_25'}
                onClick={() => trocarModo('DIA_25')}
              >
                Dia 25
              </BotaoModo>
              <BotaoModo
                ativo={modo === 'QUINTO_DIA'}
                onClick={() => trocarModo('QUINTO_DIA')}
              >
                Quinto dia
              </BotaoModo>
            </div>
          </div>
          <div>
            <label className="rotulo" htmlFor="mes-folha">
              Mês trabalhado
            </label>
            <input
              id="mes-folha"
              type="month"
              value={mesTrabalhado}
              onChange={(e) => trocarMes(e.target.value)}
              className="campo"
            />
          </div>
          <button
            onClick={() => preview.mutate()}
            disabled={preview.isPending}
            className="btn btn-primario"
          >
            {preview.isPending ? 'Calculando…' : 'Calcular prévia'}
          </button>
        </div>

        <QuandoSai modo={modo} mesTrabalhado={mesTrabalhado} />
      </div>

      {feedback && <Aviso tom="marca">{feedback}</Aviso>}

      {itens.length === 0 && !preview.isPending && (
        <div className="card">
          <Vazio titulo="Nada calculado ainda">
            Escolha o pagamento e o mês trabalhado e clique em “Calcular prévia”.
            Nada é enviado ao IXC até você conferir.
          </Vazio>
        </div>
      )}

      {itens.length > 0 && (
        <div className="surgir mb-4 flex flex-wrap items-center gap-3">
          <input
            value={buscaPessoa}
            onChange={(e) => setBuscaPessoa(e.target.value)}
            placeholder="Buscar por nome ou apelido…"
            className="campo max-w-xs"
            autoComplete="off"
          />
          {procurado && (
            <span className="text-xs text-tinta-400">
              A busca só esconde linhas — quem está fora dela continua marcado
              como estava, e vai ser gerado do mesmo jeito. A caixa do cabeçalho
              marca só {gruposVisiveis.length} à vista.
            </span>
          )}
        </div>
      )}

      {itens.length > 0 && (
        <div className="surgir surgir-2 card overflow-hidden">
          <div className="overflow-x-auto rolagem-fina">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th w-10">
                    {/* Marca e desmarca a folha inteira. Com a busca ligada,
                        vale só para quem está à vista — é assim que se marca
                        uma pessoa só. */}
                    <input
                      type="checkbox"
                      className="accent-brand-600"
                      checked={todosVisiveis}
                      disabled={geraveisVisiveis.length === 0}
                      title={
                        procurado
                          ? `Marcar ou desmarcar ${gruposVisiveis.length} pessoa(s) encontrada(s).`
                          : 'Marcar ou desmarcar a folha inteira.'
                      }
                      ref={(el) => {
                        if (el) {
                          el.indeterminate =
                            marcadosVisiveis.length > 0 && !todosVisiveis;
                        }
                      }}
                      onChange={() => marcarVisiveis(!todosVisiveis)}
                    />
                  </th>
                  <th className="th">Pessoa</th>
                  <th className="th text-right">Total a pagar</th>
                </tr>
              </thead>
              {gruposVisiveis.map((g, iGrupo) => {
                // Linha zerada pelo dia 25 não conta: não há o que gerar nela.
                const geraveis = g.indices.filter((i) => itens[i].valor > 0);
                const marcadosGrupo = geraveis.filter(
                  (i) => itens[i].selecionado,
                );
                const todos =
                  geraveis.length > 0 &&
                  marcadosGrupo.length === geraveis.length;
                const aberto = !!abertos[g.funcionarioId];
                const temSalario = g.salarioIdx !== null;
                return (
                  <tbody key={g.funcionarioId}>
                    <tr
                      onClick={() => alternarDetalhe(g.funcionarioId)}
                      // `tbody` por funcionário reinicia o `:nth-child`, então
                      // aqui a faixa alternada vem do índice do grupo.
                      className={`linha cursor-pointer ${
                        iGrupo % 2 === 1 ? 'linha-faixa' : ''
                      } ${marcadosGrupo.length === 0 ? 'opacity-45' : ''}`}
                    >
                      <td className="td" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="accent-brand-600"
                          checked={todos}
                          disabled={geraveis.length === 0}
                          title={
                            geraveis.length === 0
                              ? 'Sem valor a pagar — não vira conta no IXC.'
                              : undefined
                          }
                          ref={(el) => {
                            if (el) {
                              el.indeterminate =
                                marcadosGrupo.length > 0 && !todos;
                            }
                          }}
                          onChange={() => selecionarGrupo(g.indices, !todos)}
                        />
                      </td>
                      <td className="td">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`text-tinta-300 transition-transform ${
                              aberto ? 'rotate-90' : ''
                            }`}
                          >
                            ▸
                          </span>
                          <span className="font-medium text-tinta-900">
                            {g.nome}
                          </span>
                          {g.apelido && (
                            <span className="text-xs text-tinta-400">
                              {g.apelido}
                            </span>
                          )}
                          <span className="text-[11px] uppercase tracking-wider text-tinta-400">
                            {g.indices
                              .map((i) => TIPO_LABEL[tipoGerado(itens[i])])
                              .join(' · ')}
                          </span>
                          <SeloFerias modo={modo} ferias={g.feriasInfo} />
                          <SeloAdiantamento
                            modo={modo}
                            adiantamento={g.adiantamento}
                            abatido={abatidoDia25(g.reparto)}
                          />
                          {/* O dia 25 já tem o selo acima; aqui ficam salário,
                              férias e bônus que já saíram nesta competência. */}
                          {g.indices
                            .filter(
                              (i) =>
                                itens[i].tipo !== 'ADIANTAMENTO' &&
                                jaGeradoDoItem(itens[i]),
                            )
                            .map((i) => (
                              <SeloJaGerado
                                key={i}
                                tipo={tipoGerado(itens[i])}
                                conta={jaGeradoDoItem(itens[i])}
                              />
                            ))}
                          {/* De férias, o salário já pago continua aparecendo:
                              os dois pagam o mesmo mês. */}
                          {g.indices
                            .filter((i) => tambemJaGerado(itens[i]))
                            .map((i) => (
                              <SeloJaGerado
                                key={`tambem-${i}`}
                                tipo={itens[i].tipo}
                                conta={tambemJaGerado(itens[i])}
                              />
                            ))}
                        </div>
                      </td>
                      <td className="td text-right">
                        <span className="valor text-[15px]">
                          {formatBRL(totalDoGrupo(g.indices))}
                        </span>
                      </td>
                    </tr>

                    {aberto && (
                      <tr>
                        <td colSpan={3} className="bg-tinta-50/80 px-5 pb-5 pt-4">
                          {/* De férias a régua não explica mais nada: o valor
                              não é o saldo salarial, é o que a contabilidade
                              apurou. */}
                          {temSalario && !g.ferias && (
                            <>
                              <Regua c={g.composicao} reparto={g.reparto} />
                              <ValesJaBaixados
                                vales={itens[g.indices[0]].vales}
                              />
                            </>
                          )}
                          <OpcaoFerias
                            grupo={g}
                            onChange={(ferias) => marcarFerias([g], ferias)}
                          />
                          <OpcaoDia25
                            grupo={g}
                            onChange={(descontar) =>
                              descontarDia25([g], descontar)
                            }
                          />

                          <table className="w-full text-sm">
                            <thead>
                              <tr>
                                <th className="th w-10 !py-2"></th>
                                <th className="th !py-2">Lançamento</th>
                                <th className="th !py-2">Conta contábil</th>
                                <th className="th !py-2">
                                  Observação enviada ao IXC
                                </th>
                                <th className="th !py-2 text-right">Valor</th>
                              </tr>
                            </thead>
                            <tbody>
                              {g.indices.map((idx) => {
                                const it = itens[idx];
                                return (
                                  <tr
                                    key={idx}
                                    className={`border-t border-tinta-200/70 ${
                                      vaiGerar(it) ? '' : 'opacity-45'
                                    }`}
                                  >
                                    <td className="td !py-2.5">
                                      <input
                                        type="checkbox"
                                        className="accent-brand-600"
                                        checked={vaiGerar(it)}
                                        disabled={it.valor <= 0}
                                        title={
                                          it.valor <= 0
                                            ? 'Sem valor a pagar — não vira conta no IXC.'
                                            : undefined
                                        }
                                        onChange={() => toggle(idx)}
                                      />
                                    </td>
                                    <td className="td !py-2.5">
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        <span className="font-medium text-tinta-800">
                                          {TIPO_LABEL[tipoGerado(it)]}
                                        </span>
                                        {/* Junto da caixa de seleção, para a
                                            linha desmarcada se explicar. */}
                                        <SeloJaGerado
                                          tipo={tipoGerado(it)}
                                          conta={jaGeradoDoItem(it)}
                                        />
                                        <SeloJaGerado
                                          tipo={it.tipo}
                                          conta={tambemJaGerado(it)}
                                        />
                                        {it.ferias && (
                                          <Selo
                                            pequeno
                                            tom="info"
                                            titulo="Entra no lugar do salário: o valor é o que a contabilidade apurou das férias, e não o saldo salarial do mês."
                                          >
                                            no lugar do salário
                                          </Selo>
                                        )}
                                        {it.tipo === 'SALARIO' &&
                                          g.carteiraAssinada &&
                                          g.temOpcaoDia25 && (
                                            <Selo
                                              pequeno
                                              tom="atencao"
                                              titulo={
                                                g.reparto.total > 0
                                                  ? 'Carteira assinada com o desconto ligado nesta prévia: o dia 25 está sendo abatido aqui além do que a contabilidade já desconta.'
                                                  : 'Carteira assinada: a contabilidade já desconta o adiantamento, então o saldo salarial não é reduzido aqui.'
                                              }
                                            >
                                              carteira assinada
                                            </Selo>
                                          )}
                                        {it.tipo === 'SALARIO' &&
                                          g.reparto.noSalario > 0 && (
                                            <Selo
                                              pequeno
                                              titulo="Valor do dia 25 já abatido deste saldo salarial."
                                            >
                                              − {formatBRL(g.reparto.noSalario)}{' '}
                                              do dia 25
                                            </Selo>
                                          )}
                                        {it.tipo === 'BONUS' &&
                                          g.reparto.noBonus > 0 && (
                                            <Selo
                                              pequeno
                                              titulo="O dia 25 não coube inteiro no salário; o resto foi abatido do bônus, que na empresa também conta como salário."
                                            >
                                              − {formatBRL(g.reparto.noBonus)} do
                                              dia 25
                                            </Selo>
                                          )}
                                        {it.valor <= 0 && (
                                          <Selo
                                            pequeno
                                            tom="neutro"
                                            titulo="Sem valor a pagar: não vira conta no IXC."
                                          >
                                            não gera
                                          </Selo>
                                        )}
                                      </div>
                                    </td>
                                    <td className="td !py-2.5 num text-tinta-400">
                                      {contaContabilGerada(it)}
                                    </td>
                                    <td className="td !py-2.5 max-w-md text-xs text-tinta-500">
                                      {observacaoGerada(it)}
                                    </td>
                                    <td className="td !py-2.5 text-right">
                                      <CampoDinheiro
                                        valor={String(it.valor)}
                                        onChange={(v) =>
                                          editarValor(idx, Number(v) || 0)
                                        }
                                        className="campo w-32 py-1.5 text-right"
                                      />
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </tbody>
                );
              })}
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-tinta-100 bg-papel px-5 py-4">
            <div>
              <p className="eyebrow">Total selecionado</p>
              <p className="valor mt-1 font-display text-2xl">
                {formatBRL(totalSelecionado)}
              </p>
              <p className="mt-0.5 text-xs text-tinta-400">
                {marcados} lançamento(s) em {grupos.length} pessoa(s)
              </p>
            </div>
            <button
              onClick={() => gerar.mutate()}
              disabled={gerar.isPending || totalSelecionado <= 0}
              className="btn btn-primario"
            >
              {gerar.isPending ? 'Gerando…' : 'Gerar contas a pagar no IXC'}
            </button>
          </div>
        </div>
      )}
    </Pagina>
  );
}

/**
 * A frase que desfaz a confusão da competência: qual mês foi trabalhado e
 * quando o dinheiro dele sai. A empresa paga o mês seguinte ao trabalhado, e
 * pedir "competência" na tela fazia a pessoa escolher setembro para pagar
 * agosto — ou agosto, e receber a folha errada.
 */
function QuandoSai({
  modo,
  mesTrabalhado,
}: {
  modo: ModoPagamento;
  mesTrabalhado: string;
}) {
  const trabalho = nomeDoMes(mesTrabalhado);
  return (
    <p className="mt-4 border-t border-tinta-100 pt-4 text-sm leading-relaxed text-tinta-600">
      {modo === 'DIA_25' ? (
        <>
          Adiantamento sobre o trabalho de{' '}
          <strong className="text-tinta-900">{trabalho}</strong>, pago no{' '}
          <strong className="text-tinta-900">dia 25 de {trabalho}</strong> — no
          meio do próprio mês.
        </>
      ) : (
        <>
          Salário e bônus de{' '}
          <strong className="text-tinta-900">{trabalho}</strong>, pagos no
          começo de{' '}
          <strong className="text-tinta-900">
            {nomeDoMes(mesSeguinte(mesTrabalhado))}
          </strong>{' '}
          — o mês trabalhado sempre sai no mês seguinte.
        </>
      )}
    </p>
  );
}

function BotaoModo({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
        ativo
          ? 'bg-papel text-tinta-900 shadow-sm'
          : 'text-tinta-500 hover:text-tinta-800'
      }`}
    >
      {children}
    </button>
  );
}
