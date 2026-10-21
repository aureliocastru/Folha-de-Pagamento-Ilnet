import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import {
  LeitorDeCodigo,
  leitorDeCodigoSuportado,
} from '../../components/LeitorDeCodigo';
import { SeletorDeCategoria } from '../../components/SeletorDeCategoria';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  CampoDinheiro,
  Carregando,
  Janela,
  Pagina,
  Selo,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { useTermoAdiado } from '../../lib/busca';
import { formatBRL, formatData } from '../../lib/format';
import { STATUS_LABEL, STATUS_TOM } from '../../lib/status';
import { TIPOS_CHAVE_PIX } from '../../lib/types';
import { CampoDeData } from '../../components/CampoDeData';
import { EditarFornecedor } from '../../components/EditarFornecedor';
import type {
  BeneficiarioAvulso,
  BeneficiarioComResumo,
  CategoriaDespesa,
  ConfigFinanceira,
  FormaPagamento,
  FornecedorParaPagar,
  PaginaFornecedoresParaPagar,
  PagamentoAvulso,
} from '../../lib/types';
import { CampoComSugestoes } from '../../components/CampoComSugestoes';
import { useAssistente } from '../../components/Assistente';
import { SeletorComBusca } from '../../components/SeletorComBusca';
import { CadastroDeFornecedor } from '../../components/CadastroDeFornecedor';

/**
 * Quanto vale cada venda de um avulso. É sempre isto (o dono, 23/09/2026: "a
 * venda sempre é 50, então não precisa daquele campo") — a tela pede só
 * quantas foram.
 */
const VALOR_DA_VENDA = 50;

function hojeISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Primeira linha desta página, contada de 1 — o "X" de "X–Y de 3.238". */
function inicioDaPagina(p: PaginaFornecedoresParaPagar): number {
  return (p.page - 1) * p.porPagina + 1;
}

/**
 * Última linha desta página. Sai da contagem real do que veio, e não de
 * `page × porPagina`: a última página quase nunca vem cheia, e prometer 3.250
 * de 3.238 seria dizer que existe o que não existe.
 */
function fimDaPagina(p: PaginaFornecedoresParaPagar): number {
  return (p.page - 1) * p.porPagina + p.itens.length;
}

/**
 * Pagamento em mãos do tempo em que "em mãos" escrevia direto na movimentação
 * financeira: nunca virou conta a pagar e nunca virou lançamento no caixa. É o
 * único que ainda precisa ser fechado à mão — hoje o dinheiro em mãos sai do
 * caixa pela própria conta a pagar.
 */
function pendenteNoCaixa(p: PagamentoAvulso): boolean {
  return (
    p.forma === 'EM_MAOS' &&
    !p.contaPagarId &&
    !p.idLancamentoIxc &&
    !p.lancadoManual
  );
}

/**
 * De onde veio o valor daquele pagamento. Sai um pagamento só, então sem esta
 * linha não há como saber se os R$ 630 foram serviço, venda ou o extra. O
 * serviço é o que sobra: só o total é gravado numa coluna.
 */
function partesDoPagamento(p: PagamentoAvulso): string[] {
  const comissao = Number(p.comissaoVendas);
  const extra = Number(p.valorExtra);
  const servico = Number(p.valor) - comissao - extra;

  const partes: string[] = [];
  if (servico > 0) partes.push(`serviço ${formatBRL(servico)}`);
  if (comissao > 0) {
    partes.push(`${p.vendas} venda(s) = ${formatBRL(comissao)}`);
  }
  if (extra > 0) {
    partes.push(
      `extra ${formatBRL(extra)}${p.descricaoExtra ? ` (${p.descricaoExtra})` : ''}`,
    );
  }
  return partes;
}

/**
 * @param modulo De que lado esta tela está.
 *
 * As duas listam o cadastro de fornecedores do IXC — é lá que a pessoa já
 * existe, e cadastrá-la de novo aqui antes de poder pagá-la era o passo que
 * sobrava. O cadastro deste sistema nasce sozinho no primeiro pagamento.
 *
 * O que muda de um lado para o outro é o formulário e a conta: na folha o
 * pagamento se divide em serviço, comissão de venda e extra, e a comissão entra
 * no gráfico de vendas. No Contas a Pagar é um valor só, porque ali o pagamento
 * avulso é uma saída da empresa e não o acerto de quem também vende.
 */
export function Avulsos({
  modulo = 'folha',
}: { modulo?: 'folha' | 'contas-pagar' } = {}) {
  const qc = useQueryClient();
  const [busca, setBusca] = useState('');
  /** Página da lista do IXC (a lista do IXC é paginada). */
  const [pagina, setPagina] = useState(1);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [erro, setErro] = useState(false);
  /** Cadastro aberto: null = fechado, "novo" = novo, id = editando. */
  const [editando, setEditando] = useState<string | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [pagando, setPagando] = useState<BeneficiarioAvulso | null>(null);
  /** Fornecedor do IXC aberto para edição (o apelido é gravado lá). */
  const [editandoFornecedor, setEditandoFornecedor] =
    useState<FornecedorParaPagar | null>(null);

  /**
   * O formulário de um valor só é o do Contas a Pagar.
   *
   * Escondidos, os campos de venda não vão no pedido, e o pagamento sai com o
   * valor inteiro como serviço — que é o certo daquele lado.
   */
  const soValor = modulo === 'contas-pagar';

  const lista = useQuery({
    queryKey: ['avulsos', modulo, busca],
    queryFn: async () => {
      const params: Record<string, string> = { modulo };
      if (busca) params.busca = busca;
      return (
        await api.get<BeneficiarioComResumo[]>('/avulsos/beneficiarios', {
          params,
        })
      ).data;
    },
  });

  // A busca só vai ao IXC depois que se para de digitar: cada tecla aqui seria
  // uma consulta a um sistema lento que não é nosso.
  const buscaIxc = useTermoAdiado(busca, () => setPagina(1));

  const fornecedoresIxc = useQuery({
    queryKey: ['fornecedores-ixc-avulsos', buscaIxc, pagina],
    queryFn: async () =>
      (
        await api.get<PaginaFornecedoresParaPagar>('/avulsos/fornecedores-ixc', {
          params: { busca: buscaIxc || undefined, page: pagina, porPagina: 25 },
        })
      ).data,
    // O IXC demora e às vezes não responde: repetir por baixo dobraria a espera
    // com a tela parada, sem dizer nada a quem está esperando.
    retry: 0,
    // Enquanto a página nova não chega, a anterior fica na tela em vez de
    // piscar para vazio a cada clique em "Próxima".
    placeholderData: (anterior) => anterior,
  });

  /**
   * Abre o pagamento de alguém escolhido na lista do IXC. O cadastro daqui é
   * criado na hora, se ainda não houver — é ele que guarda o histórico e a
   * chave PIX; o vínculo pelo código do fornecedor garante que a segunda vez
   * ache o mesmo cadastro em vez de abrir outro.
   */
  const pagarDoIxc = useMutation({
    mutationFn: async (idFornecedorIxc: number) =>
      (
        await api.post<BeneficiarioAvulso>('/avulsos/beneficiarios/do-ixc', {
          idFornecedorIxc,
          modulo,
        })
      ).data,
    onSuccess: (beneficiario) => {
      void qc.invalidateQueries({ queryKey: ['avulsos'] });
      setPagando(beneficiario);
    },
    onError: (err) => {
      setErro(true);
      setFeedback(mensagemErro(err));
    },
  });

  const pagamentos = useQuery({
    queryKey: ['pagamentos-avulsos', modulo, aberto],
    queryFn: async () =>
      (
        await api.get<PagamentoAvulso[]>('/avulsos/pagamentos', {
          params: { beneficiarioId: aberto, modulo },
        })
      ).data,
    enabled: !!aberto,
  });

  function invalidar() {
    qc.invalidateQueries({ queryKey: ['avulsos'] });
    qc.invalidateQueries({ queryKey: ['pagamentos-avulsos'] });
    qc.invalidateQueries({ queryKey: ['contas-pagar'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    // O pagamento nasce etiquetado: a conta entra na lista de em aberto já
    // classificada, e a categoria escolhida passa a contar uma conta a mais.
    qc.invalidateQueries({ queryKey: ['contas-abertas'] });
    qc.invalidateQueries({ queryKey: ['categorias-despesa'] });
  }

  function avisar(texto: string, ruim = false) {
    setErro(ruim);
    setFeedback(texto);
  }

  /*
   * Desativar e apagar o cadastro sairam junto com a lista local.
   *
   * Eram acoes daquela tabela, e a tela agora lista o cadastro do IXC — onde o
   * que se edita e o registro de la. As rotas continuam existindo; falta o
   * caminho na tela, e ele volta no dia em que alguem precisar dele aqui.
   */

  /*
   * A categoria vai junto no mesmo pedido.
   *
   * Ela é etiqueta desta casa e se prende ao número do título, que só existe
   * depois que o IXC responde — mas quem faz esse segundo passo é o servidor,
   * que está do lado de lá do envio. Feito daqui, ele era uma segunda ida que
   * podia falhar sozinha com o dinheiro já a caminho; e o mesmo pedido que
   * etiqueta é o que guarda a categoria no cadastro de quem recebeu, para o
   * pagamento seguinte já abrir marcado.
   */
  const pagar = useMutation({
    mutationFn: async (args: {
      beneficiarioId: string;
      body: Record<string, unknown>;
    }) =>
      (
        await api.post<PagamentoAvulso>(
          `/avulsos/beneficiarios/${args.beneficiarioId}/pagamentos`,
          // O módulo vai junto: é ele que decide em que relatório este pagamento
          // conta. Sem ele o servidor cai na origem do cadastro, e a comissão
          // paga pela folha a um fornecedor puxado do IXC ficaria de fora do
          // gráfico de vendas.
          { ...args.body, modulo },
        )
      ).data,
    onSuccess: (p) => {
      setPagando(null);
      setAberto(p.beneficiarioId);
      avisar(
        p.avisoCategoria
          ? `${resumoDoPagamento(p)} ${p.avisoCategoria}`
          : resumoDoPagamento(p),
        !!p.erroIxc || p.contaPagar?.status === 'ERRO' || !!p.avisoCategoria,
      );
      invalidar();
    },
    onError: (err) => avisar(mensagemErro(err), true),
  });

  const acaoPagamento = useMutation({
    mutationFn: async (args: {
      id: string;
      op: 'lancar-caixa' | 'marcar-lancado';
    }) =>
      (await api.post<PagamentoAvulso>(`/avulsos/pagamentos/${args.id}/${args.op}`))
        .data,
    onSuccess: (p, args) => {
      avisar(
        args.op === 'marcar-lancado'
          ? 'Marcado como lançado no IXC à mão.'
          : resumoDoPagamento(p),
        !!p.erroIxc,
      );
      invalidar();
    },
    onError: (err) => avisar(mensagemErro(err), true),
  });

  const excluirPagamento = useMutation({
    mutationFn: async (id: string) =>
      (await api.delete(`/avulsos/pagamentos/${id}`)).data,
    onSuccess: () => {
      avisar('Pagamento apagado.');
      invalidar();
    },
    onError: (err) => avisar(mensagemErro(err), true),
  });

  function abrirNovo() {
    setEditando('novo');
  }
  /*
   * `abrirEdicao` saiu junto com a lista local: era o "Editar" daquela
   * tabela. O cadastro continua sendo criado por "Cadastrar beneficiário", e
   * o que se edita na lista do IXC é o registro de lá.
   */
  function fecharCadastro() {
    setEditando(null);
  }

  const itens = lista.data ?? [];
  const pendentes = itens.reduce((s, i) => s + i.pendentesNoCaixa, 0);

  /*
   * De quem é o painel de pagamentos aberto.
   *
   * O nome sai da lista local quando ela o tem, e da linha do IXC quando não —
   * e é o segundo caso que fazia o painel não abrir. A lista local é filtrada
   * pela origem do módulo; a do IXC não. Um fornecedor que só tem cadastro do
   * outro lado não estava em `itens`, e o painel, que dependia dele para
   * escrever o título, simplesmente não aparecia: clicava-se e nada acontecia.
   */
  const nomeDoAberto =
    itens.find((i) => i.beneficiario.id === aberto)?.beneficiario.nome ??
    fornecedoresIxc.data?.itens.find((f) => f.beneficiarioId === aberto)?.nome;

  return (
    <Pagina>
      <CabecalhoPagina
        secao={soValor ? 'Fornecedores' : 'Pagamentos avulsos'}
        titulo={soValor ? 'Quem a empresa paga' : 'Pagar quem não é da folha'}
        acoes={
          <button onClick={abrirNovo} className="btn btn-primario">
            {soValor ? 'Cadastrar fornecedor' : 'Cadastrar beneficiário'}
          </button>
        }
      />

      {feedback && <Aviso tom={erro ? 'erro' : 'marca'}>{feedback}</Aviso>}

      {pendentes > 0 && (
        <Aviso tom="atencao">
          {pendentes} pagamento(s) em mãos antigos ainda não saíram do caixa no
          IXC. Abra a pessoa para tentar de novo ou marcar que você lançou à
          mão. Os novos saem do caixa pela própria conta a pagar.
        </Aviso>
      )}

      {editando && (
        <Bloco
          titulo={soValor ? 'Novo fornecedor' : 'Novo beneficiário'}
          className="surgir mb-6"
        >
          <CadastroDeFornecedor
            onCancelar={fecharCadastro}
            onSalvo={({ beneficiario: b, avisoIxc }) => {
              const feito = `${b.nome} cadastrado.`;
              avisar(avisoIxc ? `${feito} ${avisoIxc}` : feito, !!avisoIxc);
              fecharCadastro();
              invalidar();
            }}
          />
        </Bloco>
      )}

      <div className="surgir surgir-1 mb-4 flex flex-wrap items-center gap-3">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar no IXC por nome ou apelido"
          className="campo max-w-xs"
          autoComplete="off"
        />
        <span className="text-xs text-tinta-400">
          {fornecedoresIxc.isFetching
            ? 'Lendo o IXC…'
            : fornecedoresIxc.data
              ? `${fornecedoresIxc.data.total.toLocaleString('pt-BR')} fornecedor(es) ativo(s) no IXC`
              : ''}
        </span>
      </div>

      <Bloco className="surgir surgir-2" semPadding>
          <div className="overflow-x-auto rolagem-fina">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th">Fornecedor no IXC</th>
                  <th className="th">CPF / CNPJ</th>
                  <th className="th">Categoria padrão</th>
                  <th className="th">Por aqui</th>
                  <th className="th text-right">Ação</th>
                </tr>
              </thead>
              <tbody>
                {fornecedoresIxc.isLoading && (
                  <tr>
                    <td colSpan={5}>
                      <Carregando texto="Lendo o cadastro do IXC…" />
                    </td>
                  </tr>
                )}
                {fornecedoresIxc.error && (
                  <tr>
                    <td colSpan={5}>
                      <Vazio titulo="Não deu para ler o IXC">
                        {mensagemErro(fornecedoresIxc.error)}
                      </Vazio>
                    </td>
                  </tr>
                )}
                {fornecedoresIxc.data?.itens.length === 0 && (
                  <tr>
                    <td colSpan={5}>
                      <Vazio titulo="Ninguém com esse nome no IXC">
                        A busca procura pela razão social e pelo nome fantasia
                        do cadastro de fornecedores.
                      </Vazio>
                    </td>
                  </tr>
                )}
                {(fornecedoresIxc.data?.itens ?? []).map((f) => (
                  <tr key={f.idFornecedor} className="linha">
                    <td className="td">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-tinta-900">
                          {f.nome}
                        </span>
                        <Selo tom="neutro" pequeno titulo="Código no IXC">
                          #{f.idFornecedor}
                        </Selo>
                      </div>
                      {f.nomeFantasia && f.nomeFantasia !== f.nome && (
                        <div className="mt-0.5 text-xs text-tinta-400">
                          {f.nomeFantasia}
                        </div>
                      )}
                    </td>
                    <td className="td num text-tinta-500">
                      {f.cpfCnpj ?? '—'}
                    </td>
                    {/* A que o "Lançar conta" já abre marcada para ele. Clicar
                        abre o Editar, onde ela se troca. */}
                    <td className="td">
                      <button
                        onClick={() => setEditandoFornecedor(f)}
                        className="text-left"
                        title="Trocar a categoria padrão"
                      >
                        {f.categoriaNome ? (
                          <Selo tom="marca" pequeno>
                            {f.categoriaNome}
                          </Selo>
                        ) : (
                          <span className="text-xs text-tinta-400 hover:text-brand-600">
                            sem categoria
                          </span>
                        )}
                      </button>
                    </td>
                    <td className="td text-tinta-500">
                      {f.beneficiarioId ? (
                        <button
                          onClick={() =>
                            setAberto(
                              aberto === f.beneficiarioId
                                ? null
                                : f.beneficiarioId,
                            )
                          }
                          className="text-left"
                          title="Ver os pagamentos feitos por aqui"
                        >
                          <Selo tom="pago" pequeno>
                            {f.quantidadePagamentos} pagamento(s)
                          </Selo>
                          {f.ultimoPagamento && (
                            <span className="num ml-2 text-xs text-tinta-400">
                              último em {formatData(f.ultimoPagamento)}
                            </span>
                          )}
                        </button>
                      ) : (
                        <span className="text-xs text-tinta-400">
                          nunca recebeu por aqui
                        </span>
                      )}
                    </td>
                    <td className="td text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => setEditandoFornecedor(f)}
                          className="btn btn-neutro btn-p"
                          title="Mudar o cadastro dele no IXC"
                        >
                          Editar
                        </button>
                        {/* Um botão de verdade para ver o que a pessoa já
                            recebeu. O "2 pagamento(s)" da coluna ao lado
                            também abre, mas ninguém adivinha que um selo é
                            clicável — e sem isto não havia como olhar um
                            pagamento antigo por esta tela. */}
                        {f.beneficiarioId && (
                          <button
                            onClick={() =>
                              setAberto(
                                aberto === f.beneficiarioId
                                  ? null
                                  : f.beneficiarioId,
                              )
                            }
                            className="btn btn-neutro btn-p"
                          >
                            {aberto === f.beneficiarioId
                              ? 'Fechar'
                              : 'Pagamentos'}
                          </button>
                        )}
                        <button
                          onClick={() => pagarDoIxc.mutate(f.idFornecedor)}
                          disabled={pagarDoIxc.isPending}
                          className="btn btn-pagar btn-p disabled:opacity-40"
                        >
                          {pagarDoIxc.isPending &&
                          pagarDoIxc.variables === f.idFornecedor
                            ? 'Abrindo…'
                            : 'Pagar'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Paginação: são milhares de cadastros, e a tela mostra 25 por vez. */}
          {fornecedoresIxc.data && fornecedoresIxc.data.total > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-tinta-100 px-5 py-3.5">
              <span className="num text-xs text-tinta-400">
                {inicioDaPagina(fornecedoresIxc.data)}–
                {fimDaPagina(fornecedoresIxc.data)} de{' '}
                {fornecedoresIxc.data.total.toLocaleString('pt-BR')}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPagina((p) => Math.max(1, p - 1))}
                  disabled={pagina === 1 || fornecedoresIxc.isFetching}
                  className="btn btn-neutro btn-p"
                >
                  Anterior
                </button>
                <button
                  onClick={() => setPagina((p) => p + 1)}
                  disabled={
                    fimDaPagina(fornecedoresIxc.data) >=
                      fornecedoresIxc.data.total || fornecedoresIxc.isFetching
                  }
                  className="btn btn-neutro btn-p"
                >
                  Próxima
                </button>
              </div>
            </div>
          )}
      </Bloco>

      {/*
        Aqui ficava a lista dos beneficiários cadastrados nesta casa.

        As duas telas passaram a listar o cadastro de fornecedores do IXC: é
        lá que a pessoa já existe, e obrigar a cadastrá-la de novo aqui antes
        de poder pagá-la era o passo que sobrava. O histórico de cada um não
        se perdeu — a coluna "Por aqui" abre os pagamentos feitos por este
        sistema àquele fornecedor.
      */}

      {aberto && (
        <Bloco
          titulo={`Pagamentos — ${nomeDoAberto ?? 'este fornecedor'}`}
          className="surgir surgir-3 mt-6"
          acao={
            <button onClick={() => setAberto(null)} className="btn btn-sutil btn-p">
              Fechar
            </button>
          }
          semPadding
        >
          {pagamentos.isLoading ? (
            <Carregando />
          ) : (pagamentos.data ?? []).length === 0 ? (
            <Vazio titulo="Nenhum pagamento ainda" />
          ) : (
            <div className="overflow-x-auto rolagem-fina">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-t border-tinta-200">
                    <th className="th">Data</th>
                    <th className="th">Serviço</th>
                    <th className="th text-right">Valor</th>
                    <th className="th">Saiu por</th>
                    <th className="th text-right">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {(pagamentos.data ?? []).map((p) => (
                    <tr key={p.id} className="linha">
                      <td className="td num text-tinta-500">
                        {formatData(p.data)}
                      </td>
                      <td className="td">
                        <div className="text-tinta-800">{p.descricao}</div>
                        <div className="mt-0.5 num text-xs text-tinta-400">
                          {[...partesDoPagamento(p), `conta ${p.contaContabil}`]
                            .join(' · ')}
                        </div>
                        {p.erroIxc && (
                          <div className="mt-1 max-w-lg text-xs text-rose-600">
                            {p.erroIxc}
                          </div>
                        )}
                        {p.contaPagar?.erro && (
                          <div className="mt-1 max-w-lg text-xs text-rose-600">
                            {p.contaPagar.erro}
                          </div>
                        )}
                      </td>
                      <td className="td text-right">
                        <span className="valor">{formatBRL(p.valor)}</span>
                      </td>
                      <td className="td">
                        <SituacaoPagamento pagamento={p} />
                      </td>
                      <td className="td text-right">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {pendenteNoCaixa(p) && (
                            <>
                              <button
                                onClick={() =>
                                  acaoPagamento.mutate({
                                    id: p.id,
                                    op: 'lancar-caixa',
                                  })
                                }
                                disabled={acaoPagamento.isPending}
                                className="btn btn-p bg-amber-500 text-white hover:bg-amber-600"
                              >
                                Lançar no caixa
                              </button>
                              <button
                                onClick={() =>
                                  acaoPagamento.mutate({
                                    id: p.id,
                                    op: 'marcar-lancado',
                                  })
                                }
                                title="Marque quando você mesmo lançou a saída na tela do IXC"
                                className="btn btn-neutro btn-p"
                              >
                                Já lancei à mão
                              </button>
                            </>
                          )}
                          {!p.idLancamentoIxc && (
                            <button
                              onClick={() => {
                                if (
                                  confirm(
                                    `Apagar o pagamento de ${formatBRL(p.valor)}?` +
                                      (p.contaPagarId
                                        ? '\n\nA conta a pagar também será apagada no IXC.'
                                        : ''),
                                  )
                                ) {
                                  excluirPagamento.mutate(p.id);
                                }
                              }}
                              className="btn btn-perigo btn-p"
                            >
                              Excluir
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Bloco>
      )}

      {pagando && (
        <FormularioPagamento
          beneficiario={pagando}
          ocupado={pagar.isPending}
          soValor={soValor}
          onCancelar={() => setPagando(null)}
          onConfirmar={(body) =>
            pagar.mutate({ beneficiarioId: pagando.id, body })
          }
        />
      )}

      {editandoFornecedor && (
        <EditarFornecedor
          fornecedor={editandoFornecedor}
          modulo={modulo}
          onFechar={() => setEditandoFornecedor(null)}
          onSalvo={(mensagem) => {
            setEditandoFornecedor(null);
            avisar(mensagem);
          }}
        />
      )}
    </Pagina>
  );
}

/**
 * O IXC já tem um fornecedor com aquele documento. Reaproveitar traz junto os
 * dados bancários que a tela de contas a pagar de lá preenche sozinha — mas
 * pode ser homônimo, CPF digitado errado ou um cadastro velho que ninguém quer
 * mexer. Quem decide é quem está cadastrando.
 */
/**
 * Por onde o pagamento saiu — e o que ainda falta, quando falta.
 *
 * As duas formas são conta a pagar no IXC, então é a conta que manda no que
 * aparece; o selo só diz de onde o dinheiro sai. Sem conta a pagar é um
 * pagamento em mãos antigo, de quando a saída ia direto para a movimentação
 * financeira.
 */
function SituacaoPagamento({ pagamento }: { pagamento: PagamentoAvulso }) {
  const conta = pagamento.contaPagar;
  if (conta) {
    const emMaos = pagamento.forma === 'EM_MAOS';
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <Selo
          pequeno
          tom="info"
          titulo={
            emMaos
              ? 'Conta a pagar no IXC, na conta do caixa'
              : 'Conta a pagar no IXC, na conta do banco'
          }
        >
          {emMaos ? 'caixa' : 'IXC'}
        </Selo>
        <Selo pequeno tom={STATUS_TOM[conta.status]} ponto>
          {STATUS_LABEL[conta.status]}
        </Selo>
      </div>
    );
  }

  if (pagamento.idLancamentoIxc) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <Selo pequeno tom="pago">
          caixa {pagamento.caixaIxc ?? '?'}
        </Selo>
        <span className="num text-xs text-tinta-400">
          lanç. {pagamento.idLancamentoIxc}
        </span>
      </div>
    );
  }
  if (pagamento.lancadoManual) {
    return (
      <Selo pequeno tom="pago" titulo="Lançado na tela do IXC por você">
        lançado à mão
      </Selo>
    );
  }
  return (
    <Selo
      pequeno
      tom="atencao"
      titulo="O dinheiro saiu em mãos, mas a saída ainda não está no caixa do IXC."
    >
      fora do caixa
    </Selo>
  );
}

/** O que dizer depois de pagar (ou de tentar lançar no caixa de novo). */
function resumoDoPagamento(p: PagamentoAvulso): string {
  if (p.contaPagar) {
    if (p.contaPagar.status === 'ERRO') {
      return `O IXC recusou: ${p.contaPagar.erro ?? 'erro desconhecido'} — corrija e reenvie em Contas a Pagar.`;
    }
    return p.forma === 'EM_MAOS'
      ? 'Pagamento lançado como conta a pagar no IXC, saindo do caixa — aprove em Contas a Pagar.'
      : 'Pagamento lançado como conta a pagar no IXC — aprove em Contas a Pagar.';
  }
  if (p.erroIxc) return p.erroIxc;
  if (p.idLancamentoIxc) {
    return `Pago em mãos e descontado do caixa ${p.caixaIxc} no IXC (lançamento ${p.idLancamentoIxc}).`;
  }
  return 'Pagamento registrado.';
}

/**
 * Pagar um beneficiário avulso, numa janela por cima da tela.
 *
 * Três partes que somam num pagamento só: o serviço contratado, a comissão das
 * vendas que a pessoa fechou (cliente da empresa também vende) e um extra
 * quando fez algo por fora no mesmo acerto.
 */
/**
 * @param soValor Esconde a comissão de venda e o serviço por fora, deixando um
 * valor só. É como o formulário aparece no módulo Contas a Pagar, onde o
 * pagamento avulso é uma saída da empresa e não um acerto de quem também vende.
 * Na folha as três partes continuam, porque lá elas são o acerto do mês.
 *
 * Não é só enfeite de tela: escondidos, os campos não vão no pedido, e o
 * pagamento sai com o valor inteiro como serviço.
 */
function FormularioPagamento({
  beneficiario,
  ocupado,
  soValor = false,
  onCancelar,
  onConfirmar,
}: {
  beneficiario: BeneficiarioAvulso;
  ocupado: boolean;
  soValor?: boolean;
  onCancelar: () => void;
  onConfirmar: (body: Record<string, unknown>) => void;
}) {
  const [data, setData] = useState(hojeISO());
  /*
   * A categoria abre marcada com a de quem recebe. Quem paga o mesmo pedreiro
   * pela quarta vez não deveria ter de dizer "Obras" pela quarta — é na quarta
   * que alguém deixa em branco, e a conta some do dashboard. Trocar aqui vale
   * para este pagamento e vira o novo padrão do cadastro.
   */
  const [categoriaId, setCategoriaId] = useState(
    beneficiario.categoriaId ?? '',
  );
  const [tipoPagamento, setTipoPagamento] = useState('');
  const [valorServico, setValorServico] = useState('');
  const [vendas, setVendas] = useState('');
  const valorPorVenda = VALOR_DA_VENDA;
  const [valorExtra, setValorExtra] = useState('');
  const [descricaoExtra, setDescricaoExtra] = useState('');
  const [descricao, setDescricao] = useState('');
  const [forma, setForma] = useState<FormaPagamento>(beneficiario.formaPagamento);
  /** De onde sai: o banco, pelo IXC; o caixa, em mãos. Vazio = o padrão. */
  const [contaPagamento, setContaPagamento] = useState('');
  const [chavePix, setChavePix] = useState(beneficiario.chavePix ?? '');
  const [tipoChavePix, setTipoChavePix] = useState(
    beneficiario.tipoChavePix ?? '',
  );
  const [contaContabil, setContaContabil] = useState('');
  const [lendoQr, setLendoQr] = useState(false);
  /*
   * Conta contábil e serviço por fora quase nunca mudam: ficam fechados, e a
   * tela mostra só o que se preenche em todo pagamento. Um extra já digitado
   * mantém a gaveta aberta, para ele não sumir da vista.
   */
  const [maisOpcoes, setMaisOpcoes] = useState(false);

  const categorias = useQuery({
    queryKey: ['categorias-despesa'],
    queryFn: async () =>
      (await api.get<CategoriaDespesa[]>('/categorias-despesa')).data,
  });

  const config = useQuery({
    queryKey: ['config-financeira'],
    queryFn: async () =>
      (await api.get<ConfigFinanceira>('/config-financeira')).data,
  });

  const plano = useQuery({
    queryKey: ['plano-de-contas'],
    queryFn: async () =>
      (
        await api.get<Array<{ id: number; nome: string }>>(
          '/contas-abertas/plano-de-contas',
        )
      ).data,
  });

  const contas = useQuery({
    queryKey: ['contas-pagamento'],
    queryFn: async () =>
      (
        await api.get<ContaDePagamentoIxc[]>('/contas-abertas/contas-pagamento')
      ).data,
  });

  // O tipo de pagamento começa no padrão das Configurações e é editável: nem
  // todo fornecedor recebe por PIX, e era isso que travava o pagamento de quem
  // manda boleto.
  useEffect(() => {
    if (config.data && !tipoPagamento) {
      setTipoPagamento(config.data.tipoPagamentoPadrao);
    }
  }, [config.data, tipoPagamento]);

  const servico = Number(valorServico) || 0;
  const comissao = (Number(vendas) || 0) * valorPorVenda;
  const extra = Number(valorExtra) || 0;
  const total = servico + comissao + extra;
  const vaiDePix = /pix/i.test(tipoPagamento);
  const semPix = forma === 'IXC' && vaiDePix && !chavePix.trim();
  /*
   * Sem categoria o pagamento não sai — e não é capricho de formulário.
   *
   * Ele vira conta a pagar no IXC como qualquer outra, e conta sem etiqueta cai
   * em "Sem categoria" no dashboard do Contas a Pagar: some do gráfico e só
   * volta quando alguém for caçá-la na lista, um mês depois, sem lembrar do que
   * se tratava. Escolher agora custa um clique — e a partir da segunda vez nem
   * isso, porque vem marcada do cadastro.
   */
  const semCategoria = !categoriaId;
  const valido =
    total >= 0.01 &&
    descricao.trim().length >= 3 &&
    !semPix &&
    !semCategoria;

  /** A conta contábil que vai valer: a escolhida, ou a padrão da configuração. */
  const contaEmUso = Number(contaContabil) || config.data?.contaContabilAvulso;
  const nomeDaConta = plano.data?.find((c) => c.id === contaEmUso)?.nome;
  const nomeDoPadrao = plano.data?.find(
    (c) => c.id === config.data?.contaContabilAvulso,
  )?.nome;
  const nomeDaCategoria = categorias.data?.find((c) => c.id === categoriaId);

  /*
   * De onde o dinheiro sai. Em mãos, só os caixas (o do Werick e o do
   * Aurélio); pelo IXC, só os bancos. Misturar as duas listas deixava escolher
   * "pelo IXC, saindo do caixa", que não é nenhuma das duas coisas.
   */
  const emMaos = forma === 'EM_MAOS';
  const opcoesDeConta = (contas.data ?? []).filter(
    (c) => c.ativa && c.caixa === emMaos,
  );
  const contaPadrao = emMaos
    ? config.data?.contaPagamentoCaixaId
    : config.data?.contaPagamentoId;
  const contaEscolhida = Number(contaPagamento) || contaPadrao;
  const nomeDaSaida = contas.data?.find((c) => c.id === contaEscolhida)?.nome;

  /*
   * No celular, uma pergunta por vez e a revisão no fim — como o lançar conta
   * do Contas a Pagar. No computador o formulário é o de sempre, inteiro.
   */
  const passo = useAssistente([
    { rotulo: 'Data', resumo: formatData(data) },
    {
      rotulo: 'Como vai pagar',
      resumo: `${emMaos ? 'Em mãos' : 'Pelo IXC'}${nomeDaSaida ? ` — ${nomeDaSaida}` : ''}`,
    },
    {
      rotulo: 'Valor',
      resumo: servico > 0 ? formatBRL(servico) : undefined,
      falta:
        soValor && servico < 0.01 ? 'Informe o valor do pagamento.' : undefined,
    },
    {
      rotulo: 'Vendas',
      resumo:
        comissao > 0
          ? `${vendas} × ${formatBRL(valorPorVenda)} = ${formatBRL(comissao)}`
          : undefined,
      falta:
        total < 0.01 ? 'Informe o valor ou as vendas: o pagamento está em zero.' : undefined,
      pular: soValor,
    },
    {
      rotulo: 'Do que se trata',
      resumo: descricao.trim(),
      falta:
        descricao.trim().length < 3
          ? 'Escreva do que se trata — é o que vai para o IXC.'
          : undefined,
    },
    {
      rotulo: 'A que se refere',
      resumo: nomeDaCategoria
        ? nomeDaCategoria.pai
          ? `${nomeDaCategoria.pai.nome} › ${nomeDaCategoria.nome}`
          : nomeDaCategoria.nome
        : undefined,
      falta: semCategoria
        ? 'Escolha a categoria: sem ela o gasto cai em "Sem categoria" no dashboard.'
        : undefined,
    },
    {
      rotulo: 'Como o IXC vai pagar',
      resumo: `${tipoPagamento}${vaiDePix && chavePix.trim() ? ` — ${chavePix.trim()}` : ''}`,
      falta: semPix
        ? 'Sem chave PIX o banco não paga por PIX — informe a chave ou troque a forma.'
        : undefined,
      pular: emMaos,
    },
    {
      rotulo: 'Mais opções',
      resumo: [
        `Conta contábil ${contaEmUso ?? ''}${nomeDaConta ? ` · ${nomeDaConta}` : ''}`,
        extra > 0
          ? `extra ${formatBRL(extra)}${descricaoExtra ? ` (${descricaoExtra})` : ''}`
          : null,
      ]
        .filter(Boolean)
        .join(' — '),
    },
  ]);

  const verMais = passo.celular || maisOpcoes || extra > 0 || !!contaContabil;

  return (
    <Janela titulo={`Pagar — ${beneficiario.nome}`} onFechar={onCancelar}>
      {passo.cabecalho}
      <div className="grid max-w-2xl grid-cols-1 gap-3">
        {passo.mostrar(0) && (
          <Campo label="Data">
            <CampoDeData valor={data} onChange={setData} className="campo" />
          </Campo>
        )}

        {passo.mostrar(1) && (
          <>
            <Campo label="Como vai pagar">
              <select
                value={forma}
                onChange={(e) => {
                  setForma(e.target.value as FormaPagamento);
                  // A conta de uma forma não serve à outra: volta ao padrão.
                  setContaPagamento('');
                }}
                className="campo"
              >
                <option value="IXC">Pelo IXC (conta a pagar)</option>
                <option value="EM_MAOS">Em mãos (sai do caixa)</option>
              </select>
            </Campo>
            <Campo label={emMaos ? 'De qual caixa sai' : 'De qual conta sai'}>
              <select
                value={contaPagamento}
                onChange={(e) => setContaPagamento(e.target.value)}
                className="campo"
                disabled={contas.isLoading}
              >
                <option value="">
                  {nomeDaSaida && !contaPagamento
                    ? `${nomeDaSaida} (padrão)`
                    : 'Padrão das Configurações'}
                </option>
                {opcoesDeConta
                  .filter((c) => c.id !== contaPadrao)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
              </select>
            </Campo>
          </>
        )}

        {passo.mostrar(2) && (
          <Campo label={soValor ? 'Valor (R$)' : 'Valor do serviço (R$)'}>
            <CampoDinheiro valor={valorServico} onChange={setValorServico} />
          </Campo>
        )}

        {!soValor && passo.mostrar(3) && (
          <>
            <Campo label={`Quantas vendas (${formatBRL(valorPorVenda)} cada)`}>
              <input
                type="number"
                min="0"
                inputMode="numeric"
                value={vendas}
                onChange={(e) => setVendas(e.target.value)}
                placeholder="0"
                className="campo"
              />
              {comissao > 0 && (
                <p className="ajuda">= {formatBRL(comissao)} de comissão</p>
              )}
            </Campo>
          </>
        )}

        {passo.mostrar(4) && (
          <Campo label="Do que se trata">
            <input
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              className="campo"
              placeholder="Ex.: troca do padrão de energia"
              autoComplete="off"
            />
          </Campo>
        )}

        {passo.mostrar(5) && (
          <Campo label="A que se refere">
            <SeletorDeCategoria
              categorias={categorias.data}
              value={categoriaId}
              vazio="Escolha a categoria…"
              carregando={categorias.isLoading}
              onChange={setCategoriaId}
              title="É por ela que o dashboard separa os gastos. Fica guardada no cadastro para a próxima vez."
            />
          </Campo>
        )}

        {!emMaos && passo.mostrar(6) && (
          <>
            <Campo label="Como o IXC vai pagar">
              <CampoComSugestoes
                value={tipoPagamento}
                onChange={setTipoPagamento}
                sugestoes={['Pix', 'Boleto', 'Dinheiro', 'Transferência', 'Cartão']}
                placeholder="Pix"
              />
            </Campo>
            {/* A chave só aparece quando é o PIX que paga: boleto e
                transferência não pedem chave nenhuma. */}
            {vaiDePix && (
              <Campo label="Chave PIX">
                <div className="flex gap-2">
                  <input
                    value={chavePix}
                    onChange={(e) => setChavePix(e.target.value)}
                    className="campo"
                    placeholder="Ex.: (99) 99230-0993"
                    autoComplete="off"
                  />
                  {/* Cobrança com QR: o "copia e cola" lido substitui a chave
                      fixa da pessoa, porque é ele que carrega valor e destino
                      daquele pagamento. */}
                  {leitorDeCodigoSuportado() && (
                    <button
                      type="button"
                      onClick={() => setLendoQr(true)}
                      className="btn btn-ferramenta shrink-0"
                      title="Ler o QR Code do PIX com a câmera"
                    >
                      QR
                    </button>
                  )}
                </div>
                <select
                  value={tipoChavePix}
                  onChange={(e) => setTipoChavePix(e.target.value)}
                  className="campo mt-2"
                  aria-label="Tipo da chave"
                >
                  <option value="">Tipo da chave: pelo formato</option>
                  {TIPOS_CHAVE_PIX.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </Campo>
            )}
          </>
        )}
      </div>

      {passo.mostrar(7) &&
        (verMais ? (
          <div className="mt-4 grid max-w-2xl grid-cols-1 gap-3">
            <Campo label="Conta contábil no IXC">
              <SeletorComBusca
                value={contaContabil}
                onChange={setContaContabil}
                carregando={plano.isLoading}
                vazio={
                  config.data
                    ? `Padrão — ${config.data.contaContabilAvulso}${
                        nomeDoPadrao ? ` · ${nomeDoPadrao}` : ''
                      }`
                    : 'Padrão das Configurações'
                }
                opcoes={(plano.data ?? []).map((c) => ({
                  valor: String(c.id),
                  rotulo: `${c.id} · ${c.nome}`,
                }))}
                procurar="Procurar pelo nome ou pelo código…"
              />
            </Campo>
            {!soValor && (
              <>
                <Campo label="Serviço por fora (R$)">
                  <CampoDinheiro valor={valorExtra} onChange={setValorExtra} />
                </Campo>
                <Campo label="O que foi">
                  <input
                    value={descricaoExtra}
                    onChange={(e) => setDescricaoExtra(e.target.value)}
                    className="campo"
                    placeholder="Ex.: instalação"
                    autoComplete="off"
                  />
                </Campo>
              </>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setMaisOpcoes(true)}
            className="btn btn-sutil btn-p mt-3"
          >
            Mais opções — conta contábil{soValor ? '' : ', serviço por fora'}
          </button>
        ))}

      {passo.resumo}
      {passo.barra}

      {/* Fora dos botões: no celular eles só aparecem na revisão, e o QR é
          lido no passo da chave. */}
      {lendoQr && (
        <LeitorDeCodigo
          alvo="pix"
          onLido={(codigo) => {
            setChavePix(codigo);
            setTipoChavePix('Código copia e cola');
            setLendoQr(false);
          }}
          onFechar={() => setLendoQr(false)}
        />
      )}

      {passo.mostrarAcao && (
        <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-tinta-100 pt-4">
          <button
            onClick={() =>
              onConfirmar({
                data,
                valorServico: valorServico || undefined,
                // Sem as partes na tela, nada de comissão nem extra no pedido:
                // o valor digitado é o pagamento inteiro.
                ...(soValor
                  ? {}
                  : {
                      vendas: Number(vendas) || 0,
                      valorPorVenda,
                      valorExtra: valorExtra || undefined,
                      descricaoExtra: descricaoExtra || undefined,
                    }),
                descricao,
                forma,
                contaPagamento: contaPagamento || undefined,
                contaContabil: contaContabil || undefined,
                categoriaId: categoriaId || undefined,
                ...(forma === 'IXC'
                  ? {
                      chavePix,
                      tipoChavePix,
                      tipoPagamento: tipoPagamento || undefined,
                    }
                  : {}),
              })
            }
            disabled={!valido || ocupado}
            className="btn btn-primario"
          >
            {ocupado ? 'Registrando…' : 'Confirmar pagamento'}
          </button>
          <button onClick={onCancelar} className="btn btn-neutro">
            Cancelar
          </button>

          {semPix ? (
            <span className="text-sm text-rose-600">
              Sem chave PIX o banco não paga por PIX — informe a chave ou troque
              a forma de pagar.
            </span>
          ) : semCategoria ? (
            <span className="text-sm text-rose-600">
              Escolha a que se refere: sem categoria o gasto some do dashboard.
            </span>
          ) : (
            <span className="ml-auto text-sm text-tinta-500">
              Vai sair{' '}
              <strong className="valor text-lg text-tinta-900">
                {formatBRL(total)}
              </strong>
              {comissao > 0 || extra > 0 ? (
                <span className="block text-xs text-tinta-400">
                  {[
                    servico > 0 ? `serviço ${formatBRL(servico)}` : null,
                    comissao > 0 ? `vendas ${formatBRL(comissao)}` : null,
                    extra > 0 ? `extra ${formatBRL(extra)}` : null,
                  ]
                    .filter(Boolean)
                    .join(' + ')}
                </span>
              ) : null}
            </span>
          )}
        </div>
      )}
    </Janela>
  );
}

/** Uma conta de onde o dinheiro sai, como `/contas-abertas/contas-pagamento` a devolve. */
interface ContaDePagamentoIxc {
  id: number;
  nome: string;
  ativa: boolean;
  usual: boolean;
  /** Caixa (dinheiro em mãos), e não banco. */
  caixa: boolean;
}

function Campo({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="rotulo">{label}</label>
      {children}
    </div>
  );
}
