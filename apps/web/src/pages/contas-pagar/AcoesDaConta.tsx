import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Aviso, CampoDinheiro, Janela } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { formatBRL, formatData } from '../../lib/format';
import type { ContaAberta } from '../../lib/types';

/** Uma conta de onde o dinheiro sai, como o IXC a tem. */
interface ContaDePagamento {
  id: number;
  nome: string;
  ativa: boolean;
  usual: boolean;
}

/** O caixa de onde sai o dinheiro entregue em mãos ("CX - Werick" no IXC). */
const CAIXA_EM_MAOS = 23;

const TIPOS_DE_PAGAMENTO = [
  'Pix',
  'Boleto',
  'Dinheiro',
  'Transferência',
  'Cartão',
] as const;

function hojeISO(): string {
  const agora = new Date();
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const dia = String(agora.getDate()).padStart(2, '0');
  return `${agora.getFullYear()}-${mes}-${dia}`;
}

/**
 * Pagar — uma conta ou várias, na mesma janela.
 *
 * A conta escolhida decide o que acontece, e a tela diz qual é o caso antes de
 * confirmar:
 *
 * - **ModoBank**: só aprova no IXC. O pagamento sai pela tela dele lá, com um
 *   botão que este app não tem permissão de acionar — marcar como paga aqui
 *   seria dar por quitado o que o banco ainda não pagou.
 * - **qualquer outra conta**: aprova e dá baixa, que é o mesmo que fazer o
 *   pagamento manual no IXC. É o que evita repetir o trabalho lá.
 *
 * O lote vai uma conta por vez; o que já saiu fica de pé se a seguinte falhar,
 * e a tela diz quais passaram. Desfazer pagamento que deu certo por causa do
 * que não deu seria tirar dinheiro do caixa duas vezes.
 */
export function PagarEmMaos({
  contas,
  onFechar,
}: {
  contas: ContaAberta[];
  onFechar: () => void;
}) {
  const queryClient = useQueryClient();
  const [data, setData] = useState(hojeISO);
  const [contaEscolhida, setContaEscolhida] = useState('');
  /**
   * O dinheiro já saiu — este pagamento está sendo registrado, não feito.
   *
   * É o que destrava a baixa na conta do ModoBank, que sozinha só é aprovada
   * aqui. Serve para o caso comum de pagar o PIX pelo aplicativo do banco e vir
   * registrar depois, com a data em que o dinheiro de fato saiu.
   */
  const [jaSaiu, setJaSaiu] = useState(false);
  /**
   * O abatimento de quem paga adiantado, em reais.
   *
   * Fica só no pagamento de uma conta: um desconto negociado é de uma conta, e
   * dividi-lo por um lote inventaria abatimento em título que ninguém
   * negociou. A API recusa o lote com desconto pelo mesmo motivo.
   */
  const [desconto, setDesconto] = useState('');
  const [resultado, setResultado] = useState<{
    pagas: number;
    total: number;
    economia: number;
    aguardandoBanco: number;
    falhas: Array<{ idFnApagar: number; erro: string }>;
  } | null>(null);

  const contasIxc = useQuery({
    queryKey: ['contas-pagamento'],
    queryFn: async () =>
      (await api.get<ContaDePagamento[]>('/contas-abertas/contas-pagamento'))
        .data,
  });

  const config = useQuery({
    queryKey: ['config-financeira'],
    queryFn: async () =>
      (await api.get<{ contaPagamentoId: number }>('/config-financeira')).data,
  });

  /** A do banco que paga sozinho: é a padrão da configuração (ModoBank). */
  const contaDoBanco = config.data?.contaPagamentoId;
  const contaAtual = Number(contaEscolhida) || contaDoBanco;
  const escolhida = contasIxc.data?.find((c) => c.id === contaAtual);
  /** A conta escolhida é a do banco que paga sozinho (ModoBank). */
  const contaDoBancoEscolhida = !!contaDoBanco && contaAtual === contaDoBanco;
  /**
   * Só aprova, sem baixar: a conta do banco **e** ninguém tendo dito que o
   * dinheiro já saiu. Dizer que saiu desfaz a única razão de não baixar aqui —
   * não há mais pagamento futuro do banco para esperar.
   */
  const soAprova = contaDoBancoEscolhida && !jaSaiu;

  const total = contas.reduce((s, c) => s + c.valorAberto, 0);

  /**
   * O desconto só existe onde há baixa, e para uma conta de cada vez.
   *
   * Pelo ModoBank a conta é apenas aprovada aqui — o pagamento sai na tela
   * dele, e é lá que o abatimento teria de ser informado. Mostrar o campo
   * neste caso ofereceria uma economia que este app não tem como fazer
   * acontecer.
   */
  const cabeDesconto = !soAprova && contas.length === 1;
  const descontoNumero = cabeDesconto ? Number(desconto) || 0 : 0;
  /** O que de fato sai do caixa — e o número que vai para o IXC. */
  const aPagar = Math.round((total - descontoNumero) * 100) / 100;
  /** Desconto que come a conta inteira não é pagamento: a API também recusa. */
  const descontoAlto = descontoNumero >= total;

  const pagar = useMutation({
    mutationFn: async () => {
      const { data: r } = await api.post<{
        pagas: Array<{ idFnApagar: number; aguardandoBanco: boolean }>;
        falhas: Array<{ idFnApagar: number; erro: string }>;
        total: number;
        economia: number;
      }>('/contas-abertas/pagar-lote', {
        idsFnApagar: contas.map((c) => c.idFnApagar),
        contaPagamento: contaAtual,
        data,
        jaSaiu,
        desconto: descontoNumero || undefined,
      });
      return r;
    },
    onSuccess: (r) => {
      setResultado({
        pagas: r.pagas.length,
        total: r.total,
        economia: r.economia,
        aguardandoBanco: r.pagas.filter((p) => p.aguardandoBanco).length,
        falhas: r.falhas,
      });
      void queryClient.invalidateQueries({ queryKey: ['contas-abertas'] });
      void queryClient.invalidateQueries({ queryKey: ['pagas-no-mes'] });
    },
  });

  if (resultado) {
    return (
      <Janela
        titulo={resultado.aguardandoBanco ? 'Aprovado no IXC' : 'Pagamento feito'}
        onFechar={onFechar}
      >
        <p className="font-display text-lg font-semibold text-tinta-900">
          {resultado.aguardandoBanco
            ? `${resultado.pagas} conta(s) aprovadas — ${formatBRL(resultado.total)}`
            : resultado.pagas === 1
              ? `${formatBRL(resultado.total)} pago e baixado no IXC`
              : `${resultado.pagas} contas pagas — ${formatBRL(resultado.total)}`}
        </p>
        <p className="mt-1 text-sm text-tinta-500">
          {resultado.aguardandoBanco
            ? `Estão liberadas no IXC para o ${escolhida?.nome ?? 'banco'} pagar — é lá que o pagamento sai.`
            : `Saiu de ${escolhida?.nome ?? 'conta escolhida'}. No IXC as contas constam quitadas; estornar, se precisar, é por lá.`}
        </p>

        {/* A economia fica na tela do "pronto", e não só no painel do mês:
            quem acabou de negociar o desconto é quem confere se ele entrou
            pelo valor combinado. */}
        {resultado.economia > 0 && (
          <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-300">
            Economia de {formatBRL(resultado.economia)} — o título era de{' '}
            {formatBRL(resultado.total + resultado.economia)} e no IXC ele
            consta quitado com esse desconto.
          </p>
        )}

        {resultado.falhas.length > 0 && (
          <div className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            <p className="font-semibold">
              {resultado.falhas.length} não saíram:
            </p>
            <ul className="mt-1 space-y-1">
              {resultado.falhas.map((f) => (
                <li key={f.idFnApagar}>
                  Título {f.idFnApagar}: {f.erro}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-5 flex justify-end">
          <button onClick={onFechar} className="btn btn-primario">
            Fechar
          </button>
        </div>
      </Janela>
    );
  }

  return (
    <Janela
      titulo={contas.length === 1 ? 'Pagar' : `Pagar ${contas.length} contas`}
      onFechar={onFechar}
    >
      <div className="rounded-2xl bg-tinta-50 p-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-sm text-tinta-500">
              {soAprova ? 'Vai ser liberado para o banco' : 'Vai sair de'}
            </div>
            <div className="valor text-3xl">{formatBRL(aPagar)}</div>
            {/* Com desconto o número grande deixa de ser o do título, e é o
                do título que a pessoa tem na frente ao conferir. Os dois
                aparecem: o que sai, grande, e de onde ele veio, embaixo. */}
            {descontoNumero > 0 && !descontoAlto && (
              <div className="mt-0.5 text-xs text-tinta-400">
                título de {formatBRL(total)} −{' '}
                {formatBRL(descontoNumero)} de desconto
              </div>
            )}
          </div>
          <div className="min-w-[240px]">
            <label className="rotulo" htmlFor="conta-do-pagamento">
              Conta de Pagamento
            </label>
            <select
              id="conta-do-pagamento"
              value={contaEscolhida}
              onChange={(e) => setContaEscolhida(e.target.value)}
              className="campo"
              disabled={contasIxc.isLoading}
            >
              <option value="">
                {contaDoBanco
                  ? `Padrão — ${contasIxc.data?.find((c) => c.id === contaDoBanco)?.nome ?? contaDoBanco}`
                  : 'Padrão das Configurações'}
              </option>
              {(contasIxc.data ?? [])
                .filter((c) => c.usual || c.ativa)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
            </select>
          </div>
        </div>

        {contaDoBancoEscolhida && (
          <label className="mt-3 flex w-fit flex-wrap items-center gap-2 text-sm text-tinta-600">
            <input
              type="checkbox"
              className="accent-brand-600"
              checked={jaSaiu}
              onChange={(e) => setJaSaiu(e.target.checked)}
            />
            Já foi paga — o dinheiro já saiu desta conta
          </label>
        )}

        {/* O que vai acontecer, em uma linha, antes de confirmar. */}
        <p
          className={`mt-3 text-sm ${
            soAprova
              ? 'text-amber-700 dark:text-amber-300'
              : 'text-emerald-700 dark:text-emerald-300'
          }`}
        >
          {soAprova
            ? `Pelo ${escolhida?.nome ?? 'ModoBank'} a conta só é aprovada aqui — o pagamento sai na tela dele, no IXC. Marque acima se ela já foi paga.`
            : `Aprova e dá baixa no IXC: a conta fica paga, saindo de ${escolhida?.nome ?? 'conta escolhida'}. Não precisa repetir lá.`}
        </p>
      </div>

      {contaDoBancoEscolhida && jaSaiu && (
        <Aviso tom="atencao">
          Isto registra um pagamento que já aconteceu — não move dinheiro
          nenhum. Confira no extrato antes: dar por paga uma conta que o banco
          ainda não pagou faz o ModoBank pagá-la depois, por cima, e o dinheiro
          sai duas vezes.
        </Aviso>
      )}

      <div className="mt-4 max-h-[40vh] overflow-y-auto rolagem-fina rounded-xl border border-tinta-100">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Fornecedor</th>
              <th className="th">Vencimento</th>
              <th className="th text-right">Valor</th>
            </tr>
          </thead>
          <tbody>
            {contas.map((c) => (
              <tr key={c.idFnApagar} className="linha">
                <td className="td">
                  <div className="text-tinta-800">
                    {c.fornecedor.nome || `Fornecedor ${c.fornecedor.id ?? '?'}`}
                  </div>
                  {c.observacao && (
                    <div className="text-xs text-tinta-400">{c.observacao}</div>
                  )}
                </td>
                <td className="td num whitespace-nowrap text-tinta-500">
                  {c.vencimento ? formatData(c.vencimento) : '—'}
                </td>
                <td className="td whitespace-nowrap text-right">
                  <span className="valor">{formatBRL(c.valorAberto)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!soAprova && (
        <div className="mt-4">
          <div className="flex flex-wrap gap-4">
            <div className="max-w-[200px] flex-1">
              <label className="rotulo" htmlFor="data-pagamento-lote">
                Dia em que saiu
              </label>
              <input
                id="data-pagamento-lote"
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
                className="campo"
              />
            </div>

            {/* Desconto por antecipação: o campo fica ao lado da data porque
                as duas perguntas são a mesma — em que condições o dinheiro
                saiu —, e quem paga adiantado responde as duas de uma vez. */}
            {cabeDesconto && (
              <div className="max-w-[200px] flex-1">
                <label className="rotulo" htmlFor="desconto-pagamento">
                  Desconto (antecipação)
                </label>
                <CampoDinheiro
                  id="desconto-pagamento"
                  valor={desconto}
                  onChange={setDesconto}
                />
              </div>
            )}
          </div>
          {/* É esta data que vai para a movimentação financeira do IXC, e é
              por ela que o movimento encontra a linha do extrato. O dia em
              que se registra não serve: quem paga pelo aplicativo do banco e
              lança dias depois concilia pelo dia em que o dinheiro saiu. */}
          <p className="mt-1.5 text-xs text-tinta-400">
            Pode ser um dia passado. É esta data que vai para o IXC e é por ela
            que a conciliação acha a linha do extrato — não vale o dia de hoje
            se o dinheiro saiu antes.
          </p>
          {/* O desconto muda o valor do pagamento, não o do título: é o que
              explica a diferença entre o que o IXC diz que se devia e o que o
              extrato do banco vai mostrar. */}
          {cabeDesconto && (
            <p className="mt-1 text-xs text-tinta-400">
              Desconto é o abatimento por pagar antes do vencimento. O título
              continua valendo {formatBRL(total)}; para o IXC vai o que saiu de
              verdade, {formatBRL(aPagar)} — é esse valor que a conciliação
              procura no extrato. A diferença entra como economia no painel do
              mês.
            </p>
          )}
        </div>
      )}

      {descontoAlto && (
        <Aviso tom="erro">
          O desconto de {formatBRL(descontoNumero)} alcança o valor do título (
          {formatBRL(total)}) — assim não sobra pagamento nenhum. Para uma conta
          que não vai ser paga, o caminho é cancelá-la no IXC.
        </Aviso>
      )}

      {pagar.isError && <Aviso tom="erro">{mensagemErro(pagar.error)}</Aviso>}

      <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto text-xs text-tinta-400">
          {contas.length > 1
            ? `${contas.length} contas, uma de cada vez no IXC.`
            : 'A conta é aprovada na auditoria do IXC.'}
        </span>
        <button onClick={onFechar} className="btn btn-neutro">
          Cancelar
        </button>
        <button
          onClick={() => pagar.mutate()}
          disabled={pagar.isPending || descontoAlto}
          className="btn btn-primario"
        >
          {pagar.isPending
            ? 'Enviando ao IXC…'
            : soAprova
              ? `Aprovar ${formatBRL(total)} para o banco pagar`
              : jaSaiu
                ? `Registrar ${formatBRL(aPagar)} como pago`
                : `Confirmar pagamento de ${formatBRL(aPagar)}`}
        </button>
      </div>
    </Janela>
  );
}

/**
 * Muda um título que ainda está em aberto: o meio de pagamento, a data, o
 * valor. É a tela para quando a conta chegou ao IXC com algo errado e não vale
 * a pena apagar e lançar de novo.
 */
export function EditarConta({
  conta,
  onFechar,
}: {
  conta: ContaAberta;
  onFechar: () => void;
}) {
  const queryClient = useQueryClient();
  const [valor, setValor] = useState(String(conta.valorAberto));
  const [vencimento, setVencimento] = useState(
    conta.vencimento ? String(conta.vencimento).slice(0, 10) : hojeISO(),
  );
  const [observacao, setObservacao] = useState(conta.observacao ?? '');
  const [tipoPagamento, setTipoPagamento] = useState('');
  const [contaPagamento, setContaPagamento] = useState('');
  const [chavePix, setChavePix] = useState('');
  const [codigoBarras, setCodigoBarras] = useState('');

  const contasIxc = useQuery({
    queryKey: ['contas-pagamento'],
    queryFn: async () =>
      (await api.get<ContaDePagamento[]>('/contas-abertas/contas-pagamento'))
        .data,
  });

  /*
   * Os campos crus do título, para os seletores abrirem no que está lá — e não
   * num "como está no IXC" que esconde justamente o que se quer conferir antes
   * de mudar.
   */
  const bruto = useQuery({
    queryKey: ['conta-bruta', conta.idFnApagar],
    queryFn: async () =>
      (
        await api.get<{ campos: Record<string, unknown> }>(
          `/contas-abertas/${conta.idFnApagar}/bruto`,
        )
      ).data,
    retry: 0,
  });

  const campos = bruto.data?.campos;
  const tipoAtual = String(campos?.tipo_pagamento ?? '').trim();
  const contaAtual = String(campos?.id_contas ?? '').trim();
  const chaveAtual = String(campos?.chave_pix ?? '').trim();
  const boletoAtual = String(campos?.codigo_barras ?? '').trim();

  // O que veio do IXC vira o valor inicial dos campos, uma vez só.
  useEffect(() => {
    if (!campos) return;
    setTipoPagamento((v) => v || tipoAtual);
    setContaPagamento((v) => v || contaAtual);
    setChavePix((v) => v || chaveAtual);
    setCodigoBarras((v) => v || boletoAtual);
  }, [campos, tipoAtual, contaAtual, chaveAtual, boletoAtual]);

  const salvar = useMutation({
    mutationFn: async () => {
      // Só o que de fato mudou: mandar tudo de volta faria o IXC reprovar e
      // reaprovar a conta por causa de uma edição que não mudou nada.
      const mudancas: Record<string, unknown> = {};
      if (Number(valor) !== conta.valorAberto) mudancas.valor = Number(valor);
      if (vencimento !== String(conta.vencimento ?? '').slice(0, 10)) {
        mudancas.dataVencimento = vencimento;
      }
      if (observacao !== (conta.observacao ?? '')) {
        mudancas.observacao = observacao;
      }
      if (tipoPagamento && tipoPagamento !== tipoAtual) {
        mudancas.tipoPagamento = tipoPagamento;
      }
      if (contaPagamento && contaPagamento !== contaAtual) {
        mudancas.contaPagamento = Number(contaPagamento);
      }
      if (chavePix && chavePix !== chaveAtual) mudancas.chavePix = chavePix;
      if (codigoBarras && codigoBarras !== boletoAtual) {
        mudancas.codigoBarras = codigoBarras;
      }

      await api.patch(`/contas-abertas/${conta.idFnApagar}`, mudancas);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['contas-abertas'] });
      onFechar();
    },
  });

  return (
    <Janela titulo={`Editar — ${conta.fornecedor.nome}`} onFechar={onFechar}>
      <p className="mb-4 text-sm text-tinta-500">
        A mudança vai direto para o título nº {conta.idFnApagar} no IXC. Os
        campos abrem com o que está lá agora.
        {conta.statusAuditoria === 'A' && (
          <>
            {' '}
            Como ela já está aprovada, o IXC não deixa editar direto: a conta é
            reprovada, alterada e aprovada de novo — sozinha, sem sair daqui.
          </>
        )}
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="rotulo" htmlFor="ed-valor">
            Valor
          </label>
          <CampoDinheiro id="ed-valor" valor={valor} onChange={setValor} />
        </div>
        <div>
          <label className="rotulo" htmlFor="ed-vencimento">
            Vencimento
          </label>
          <input
            id="ed-vencimento"
            type="date"
            value={vencimento}
            onChange={(e) => setVencimento(e.target.value)}
            className="campo"
          />
        </div>
        <div>
          <label className="rotulo" htmlFor="ed-tipo">
            Tipo de pagamento
          </label>
          <select
            id="ed-tipo"
            value={tipoPagamento}
            onChange={(e) => {
              setTipoPagamento(e.target.value);
              if (e.target.value === 'Dinheiro') {
                setContaPagamento(String(CAIXA_EM_MAOS));
              }
            }}
            className="campo"
            disabled={bruto.isLoading}
          >
            <option value="">
              {bruto.isLoading ? 'lendo do IXC…' : 'sem tipo definido'}
            </option>
            {/* O tipo que está no IXC entra na lista mesmo se for um rótulo que
                a tela não conhece — senão ele sumiria do seletor e a edição o
                trocaria sem ninguém pedir. */}
            {[
              ...TIPOS_DE_PAGAMENTO,
              ...(tipoAtual &&
              !TIPOS_DE_PAGAMENTO.includes(
                tipoAtual as (typeof TIPOS_DE_PAGAMENTO)[number],
              )
                ? [tipoAtual]
                : []),
            ].map((t) => (
              <option key={t} value={t}>
                {t === 'Dinheiro' ? 'Em mãos (dinheiro)' : t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="rotulo" htmlFor="ed-conta">
            Conta de Pagamento
          </label>
          <select
            id="ed-conta"
            value={contaPagamento}
            onChange={(e) => setContaPagamento(e.target.value)}
            className="campo"
            disabled={bruto.isLoading || contasIxc.isLoading}
          >
            <option value="">
              {bruto.isLoading ? 'lendo do IXC…' : 'sem conta definida'}
            </option>
            {(contasIxc.data ?? [])
              // A conta que o título usa hoje aparece mesmo se estiver inativa:
              // é o valor atual, e escondê-lo faria a edição trocá-la sozinha.
              .filter((c) => c.usual || c.ativa || String(c.id) === contaAtual)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                  {c.ativa ? '' : ' (inativa)'}
                </option>
              ))}
          </select>
        </div>

        {tipoPagamento === 'Pix' && (
          <div className="sm:col-span-2">
            <label className="rotulo" htmlFor="ed-pix">
              Chave PIX
            </label>
            <input
              id="ed-pix"
              value={chavePix}
              onChange={(e) => setChavePix(e.target.value)}
              className="campo"
              placeholder="Em branco mantém a que está no IXC"
            />
          </div>
        )}

        {tipoPagamento === 'Boleto' && (
          <div className="sm:col-span-2">
            <label className="rotulo" htmlFor="ed-boleto">
              Linha digitável do boleto
            </label>
            <input
              id="ed-boleto"
              value={codigoBarras}
              onChange={(e) => setCodigoBarras(e.target.value)}
              className="campo num"
              inputMode="numeric"
              placeholder="Em branco mantém o que está no IXC"
            />
          </div>
        )}

        <div className="sm:col-span-2">
          <label className="rotulo" htmlFor="ed-obs">
            Observação
          </label>
          <input
            id="ed-obs"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            className="campo"
          />
        </div>
      </div>

      {salvar.isError && <Aviso tom="erro">{mensagemErro(salvar.error)}</Aviso>}

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onFechar} className="btn btn-neutro">
          Cancelar
        </button>
        <button
          onClick={() => salvar.mutate()}
          disabled={salvar.isPending}
          className="btn btn-primario"
        >
          {salvar.isPending ? 'Salvando no IXC…' : 'Salvar no IXC'}
        </button>
      </div>
    </Janela>
  );
}

/**
 * Apagar o título no IXC. Pede confirmação com o valor e o fornecedor na
 * frente: a lista tem centenas de linhas parecidas, e o botão de apagar fica a
 * um centímetro do de pagar.
 */
export function ExcluirConta({
  conta,
  onFechar,
}: {
  conta: ContaAberta;
  onFechar: () => void;
}) {
  const queryClient = useQueryClient();

  const excluir = useMutation({
    mutationFn: async () => {
      await api.delete(`/contas-abertas/${conta.idFnApagar}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['contas-abertas'] });
      onFechar();
    },
  });

  return (
    <Janela titulo="Apagar conta no IXC" onFechar={onFechar}>
      <p className="text-sm text-tinta-700">
        Apagar de vez o título nº {conta.idFnApagar} no IXC?
      </p>
      <div className="mt-3 rounded-2xl bg-tinta-50 p-4">
        <div className="font-semibold text-tinta-900">
          {conta.fornecedor.nome}
        </div>
        <div className="valor mt-1 text-2xl">
          {formatBRL(conta.valorAberto)}
        </div>
        {conta.observacao && (
          <div className="mt-1 text-sm text-tinta-500">{conta.observacao}</div>
        )}
        <div className="num mt-1 text-xs text-tinta-400">
          vence {conta.vencimento ? formatData(conta.vencimento) : 'sem data'}
        </div>
      </div>
      <p className="ajuda">
        Some do IXC e desta lista. Não dá para desfazer daqui — só lançando de
        novo.
      </p>

      {excluir.isError && (
        <Aviso tom="erro">{mensagemErro(excluir.error)}</Aviso>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onFechar} className="btn btn-neutro">
          Cancelar
        </button>
        <button
          onClick={() => excluir.mutate()}
          disabled={excluir.isPending}
          className="btn bg-rose-600 text-white hover:bg-rose-500"
        >
          {excluir.isPending ? 'Apagando…' : 'Apagar no IXC'}
        </button>
      </div>
    </Janela>
  );
}
