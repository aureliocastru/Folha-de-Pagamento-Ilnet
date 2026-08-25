import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import {
  LeitorDeCodigo,
  leitorDeCodigoSuportado,
} from '../../components/LeitorDeCodigo';
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
import { emArvore } from '../../lib/categorias';
import { formatBRL, formatData } from '../../lib/format';
import { FORMA_PAGAMENTO_LABEL, STATUS_LABEL, STATUS_TOM } from '../../lib/status';
import { TIPOS_CHAVE_PIX } from '../../lib/types';
import type {
  BeneficiarioAvulso,
  BeneficiarioComResumo,
  BeneficiarioSalvo,
  CategoriaDespesa,
  ConfigFinanceira,
  ConsultaCpfCnpj,
  FormaPagamento,
  FornecedorParaPagar,
  PaginaFornecedoresParaPagar,
  PagamentoAvulso,
} from '../../lib/types';

/** Cadastro em branco: começa no IXC, que é a forma rastreável. */
const CADASTRO_VAZIO = {
  nome: '',
  cpfCnpj: '',
  tipoPessoa: 'F',
  telefone: '',
  email: '',
  chavePix: '',
  tipoChavePix: '',
  valorPorVenda: '',
  formaPagamento: 'IXC' as FormaPagamento,
  observacoes: '',
};

type Cadastro = typeof CADASTRO_VAZIO;

/** O que fazer com o fornecedor que já existe no IXC com aquele documento. */
type EscolhaFornecedor =
  | { tipo: 'PERGUNTAR'; consulta: ConsultaCpfCnpj }
  | { tipo: 'REUSAR'; idFornecedorIxc: number; semPix: boolean }
  | { tipo: 'NOVO' };

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
 * @param doIxc Abre pela lista de fornecedores do IXC em vez de pelos
 * cadastrados aqui. É como a tela aparece no módulo Contas a Pagar: quem paga
 * alguém de fora da folha procura a pessoa pelo nome, e ela já está cadastrada
 * no IXC — o cadastro daqui nasce sozinho na hora do primeiro pagamento. No
 * módulo Folha a tela continua sendo a lista de quem esta casa cadastrou.
 */
export function Avulsos({ doIxc = false }: { doIxc?: boolean } = {}) {
  const qc = useQueryClient();
  const [busca, setBusca] = useState('');
  const [verInativos, setVerInativos] = useState(false);
  /** Página da lista do IXC (só no modo `doIxc`). */
  const [pagina, setPagina] = useState(1);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [erro, setErro] = useState(false);
  /** Cadastro aberto: null = fechado, "novo" = novo, id = editando. */
  const [editando, setEditando] = useState<string | null>(null);
  const [form, setForm] = useState<Cadastro>(CADASTRO_VAZIO);
  /** O que decidir sobre o fornecedor do IXC (só no cadastro novo). */
  const [fornecedor, setFornecedor] = useState<EscolhaFornecedor>({
    tipo: 'NOVO',
  });
  const [aberto, setAberto] = useState<string | null>(null);
  const [pagando, setPagando] = useState<BeneficiarioAvulso | null>(null);
  /** Fornecedor do IXC aberto para edição (só no modo `doIxc`). */
  const [editandoFornecedor, setEditandoFornecedor] =
    useState<FornecedorParaPagar | null>(null);

  /**
   * De qual lado esta tela está. A folha e o contas a pagar dividem as mesmas
   * tabelas, e sem dizer o módulo a folha listaria também os fornecedores do
   * IXC pagos do outro lado — que não são custo dela.
   */
  const modulo = doIxc ? 'contas-pagar' : 'folha';

  const lista = useQuery({
    queryKey: ['avulsos', modulo, busca, verInativos],
    queryFn: async () => {
      const params: Record<string, string> = { modulo };
      if (busca) params.busca = busca;
      if (verInativos) params.todos = 'true';
      return (
        await api.get<BeneficiarioComResumo[]>('/avulsos/beneficiarios', {
          params,
        })
      ).data;
    },
  });

  // A busca só vai ao IXC depois que se para de digitar: cada tecla aqui seria
  // uma consulta a um sistema lento que não é nosso.
  const [buscaIxc, setBuscaIxc] = useState('');
  useEffect(() => {
    if (!doIxc) return;
    const id = setTimeout(() => {
      setBuscaIxc(busca.trim());
      setPagina(1);
    }, 400);
    return () => clearTimeout(id);
  }, [busca, doIxc]);

  const fornecedoresIxc = useQuery({
    queryKey: ['fornecedores-ixc-avulsos', buscaIxc, pagina],
    queryFn: async () =>
      (
        await api.get<PaginaFornecedoresParaPagar>('/avulsos/fornecedores-ixc', {
          params: { busca: buscaIxc || undefined, page: pagina, porPagina: 25 },
        })
      ).data,
    enabled: doIxc,
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

  /**
   * Grava o nome fantasia no cadastro do IXC. É o apelido pelo qual a pessoa é
   * conhecida — e é por ele que a busca desta tela passa a encontrá-la, aqui e
   * lá.
   */
  const salvarFornecedorIxc = useMutation({
    mutationFn: async (dados: { idFornecedor: number; nomeFantasia: string }) =>
      (
        await api.patch<FornecedorParaPagar>(
          `/avulsos/fornecedores-ixc/${dados.idFornecedor}`,
          { nomeFantasia: dados.nomeFantasia },
        )
      ).data,
    onSuccess: (f) => {
      void qc.invalidateQueries({ queryKey: ['fornecedores-ixc-avulsos'] });
      setEditandoFornecedor(null);
      avisar(
        f.nomeFantasia
          ? `${f.nome} agora é "${f.nomeFantasia}" no IXC.`
          : `Apelido de ${f.nome} apagado no IXC.`,
      );
    },
    onError: (err) => avisar(mensagemErro(err), true),
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
  }

  function avisar(texto: string, ruim = false) {
    setErro(ruim);
    setFeedback(texto);
  }

  /**
   * Antes de cadastrar, pergunta ao IXC se aquele documento já é fornecedor.
   * Reaproveitar é quase sempre o certo — é no cadastro antigo que estão os
   * dados bancários — mas quem sabe se é a mesma pessoa é quem está aqui.
   */
  const consultar = useMutation({
    mutationFn: async (cpfCnpj: string) =>
      (
        await api.get<ConsultaCpfCnpj>('/avulsos/consultar-documento', {
          params: { cpfCnpj },
        })
      ).data,
    onSuccess: (consulta) => {
      if (consulta.beneficiario) {
        avisar(
          `${consulta.beneficiario.nome} já está cadastrado aqui com esse documento — use o cadastro dele em vez de criar outro.`,
          true,
        );
        return;
      }
      if (consulta.fornecedor) {
        setFornecedor({ tipo: 'PERGUNTAR', consulta });
        return;
      }
      setFornecedor({ tipo: 'NOVO' });
      avisar(
        consulta.ixcIndisponivel
          ? `Não deu para consultar o IXC agora (${consulta.ixcIndisponivel}). Dá para cadastrar assim mesmo.`
          : 'Nenhum fornecedor com esse documento no IXC — será criado um novo.',
        !!consulta.ixcIndisponivel,
      );
    },
    onError: (err) => avisar(mensagemErro(err), true),
  });

  const salvar = useMutation({
    mutationFn: async () => {
      const body = {
        nome: form.nome,
        cpfCnpj: form.cpfCnpj || undefined,
        tipoPessoa: form.tipoPessoa,
        telefone: form.telefone || undefined,
        email: form.email || undefined,
        chavePix: form.chavePix || undefined,
        tipoChavePix: form.tipoChavePix,
        valorPorVenda: form.valorPorVenda || null,
        formaPagamento: form.formaPagamento,
        observacoes: form.observacoes || undefined,
        ...(fornecedor.tipo === 'REUSAR'
          ? { idFornecedorIxc: fornecedor.idFornecedorIxc }
          : {}),
        ...(fornecedor.tipo === 'NOVO' ? { fornecedorNovoNoIxc: false } : {}),
      };
      return editando && editando !== 'novo'
        ? (
            await api.patch<BeneficiarioSalvo>(
              `/avulsos/beneficiarios/${editando}`,
              body,
            )
          ).data
        : (await api.post<BeneficiarioSalvo>('/avulsos/beneficiarios', body))
            .data;
    },
    onSuccess: ({ beneficiario: b, avisoIxc }) => {
      const feito =
        editando && editando !== 'novo'
          ? `${b.nome} atualizado.`
          : `${b.nome} cadastrado.`;
      avisar(avisoIxc ? `${feito} ${avisoIxc}` : feito, !!avisoIxc);
      fecharCadastro();
      invalidar();
    },
    onError: (err) => avisar(mensagemErro(err), true),
  });

  const alternarAtivo = useMutation({
    mutationFn: async (b: BeneficiarioAvulso) =>
      (
        await api.patch<BeneficiarioSalvo>(`/avulsos/beneficiarios/${b.id}`, {
          ativo: !b.ativo,
        })
      ).data,
    onSuccess: ({ beneficiario: b }) => {
      avisar(`${b.nome} ${b.ativo ? 'reativado' : 'desativado'}.`);
      invalidar();
    },
    onError: (err) => avisar(mensagemErro(err), true),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) =>
      (await api.delete(`/avulsos/beneficiarios/${id}`)).data,
    onSuccess: () => {
      avisar('Cadastro apagado.');
      invalidar();
    },
    onError: (err) => avisar(mensagemErro(err), true),
  });

  const pagar = useMutation({
    mutationFn: async (args: {
      beneficiarioId: string;
      body: Record<string, unknown>;
    }) => {
      // A categoria é etiqueta desta casa e mora fora do pagamento: ela se
      // prende ao número do título, que só existe depois que o IXC responde.
      const { categoriaId, ...body } = args.body as {
        categoriaId?: string;
      } & Record<string, unknown>;

      const { data: p } = await api.post<PagamentoAvulso>(
        `/avulsos/beneficiarios/${args.beneficiarioId}/pagamentos`,
        body,
      );

      let avisoCategoria: string | null = null;
      if (categoriaId && p.contaPagar?.idFnApagarIxc) {
        try {
          await api.put(
            `/contas-abertas/${p.contaPagar.idFnApagarIxc}/categoria`,
            { categoriaId },
          );
        } catch (err) {
          // O pagamento já saiu; a etiqueta que faltou se resolve na lista.
          avisoCategoria = `O pagamento saiu, mas a categoria não ficou (${mensagemErro(err)}).`;
        }
      } else if (categoriaId) {
        avisoCategoria =
          'O pagamento saiu, mas o IXC não devolveu o número do título, então ' +
          'a categoria não pôde ser gravada.';
      }

      return { pagamento: p, avisoCategoria };
    },
    onSuccess: ({ pagamento: p, avisoCategoria }) => {
      setPagando(null);
      setAberto(p.beneficiarioId);
      avisar(
        avisoCategoria
          ? `${resumoDoPagamento(p)} ${avisoCategoria}`
          : resumoDoPagamento(p),
        !!p.erroIxc || p.contaPagar?.status === 'ERRO' || !!avisoCategoria,
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

  /**
   * Reusar o cadastro do IXC traz o que ele já tem. O motivo de reusar é não
   * redigitar — vir com os campos vazios seria o pior dos dois mundos.
   *
   * Só completa o que está em branco: o que a pessoa já escreveu foi escolha
   * dela, e o IXC não tem por que desfazê-la.
   */
  function usarFornecedor(f: NonNullable<ConsultaCpfCnpj['fornecedor']>) {
    setForm((atual) => ({
      ...atual,
      nome: atual.nome || f.nome,
      // Tipo de pessoa não é preferência de quem digita, é um fato do cadastro
      // — e o campo já nasce em "Física", então esperar que esteja vazio seria
      // esperar para sempre. O IXC ainda tem "Estrangeiro", que aqui não existe.
      tipoPessoa: f.tipoPessoa === 'J' ? 'J' : 'F',
      telefone: atual.telefone || (f.telefone ?? ''),
      email: atual.email || (f.email ?? ''),
      chavePix: atual.chavePix || (f.chavePix ?? ''),
      tipoChavePix: atual.tipoChavePix || (f.tipoChavePix ?? ''),
    }));
    setFornecedor({
      tipo: 'REUSAR',
      idFornecedorIxc: f.idFornecedor,
      semPix: !f.chavePix,
    });
    avisar(
      f.chavePix
        ? `Peguei os dados de ${f.nome} no IXC, inclusive a chave PIX dos dados bancários.`
        : `Peguei os dados de ${f.nome} no IXC. Ele não tem chave PIX cadastrada lá — preencha aqui que eu subo para o cadastro dele.`,
    );
  }

  function abrirNovo() {
    setForm(CADASTRO_VAZIO);
    setFornecedor({ tipo: 'NOVO' });
    setEditando('novo');
  }
  function abrirEdicao(b: BeneficiarioAvulso) {
    setForm({
      nome: b.nome,
      cpfCnpj: b.cpfCnpj ?? '',
      tipoPessoa: b.tipoPessoa,
      telefone: b.telefone ?? '',
      email: b.email ?? '',
      chavePix: b.chavePix ?? '',
      tipoChavePix: b.tipoChavePix ?? '',
      valorPorVenda: b.valorPorVenda ?? '',
      formaPagamento: b.formaPagamento,
      observacoes: b.observacoes ?? '',
    });
    setFornecedor(
      b.idFornecedorIxc
        ? {
            tipo: 'REUSAR',
            idFornecedorIxc: b.idFornecedorIxc,
            semPix: !b.chavePix,
          }
        : { tipo: 'NOVO' },
    );
    setEditando(b.id);
  }
  function fecharCadastro() {
    setEditando(null);
    setForm(CADASTRO_VAZIO);
    setFornecedor({ tipo: 'NOVO' });
  }

  const itens = lista.data ?? [];
  const pendentes = itens.reduce((s, i) => s + i.pendentesNoCaixa, 0);
  const abertoBeneficiario = itens.find(
    (i) => i.beneficiario.id === aberto,
  )?.beneficiario;
  const editandoNovo = editando === 'novo';
  const nomeValido = form.nome.trim().length >= 2;

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Pagamentos avulsos"
        titulo="Pagar quem não é da folha"
        descricao={
          doIxc
            ? 'Todo o cadastro de fornecedores do IXC, para pagar quem já existe lá sem cadastrar de novo. O pagamento sai como conta a pagar no IXC, do banco por PIX ou do caixa em dinheiro.'
            : 'Mão de obra contratada, serviço pontual, patrocínio, ajuda de custo. A pessoa fica cadastrada e vira fornecedor no IXC — o pagamento sai por lá como conta a pagar, do banco por PIX ou do caixa em dinheiro.'
        }
        acoes={
          <button onClick={abrirNovo} className="btn btn-primario">
            Cadastrar beneficiário
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
          titulo={editandoNovo ? 'Novo beneficiário' : 'Editar cadastro'}
          className="surgir mb-6"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Campo label="Nome ou razão social" span2>
              <input
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
                className="campo"
                placeholder="Ex.: João da Silva"
              />
            </Campo>
            <Campo label="Tipo de pessoa">
              <select
                value={form.tipoPessoa}
                onChange={(e) =>
                  setForm({ ...form, tipoPessoa: e.target.value })
                }
                className="campo"
              >
                <option value="F">Física</option>
                <option value="J">Jurídica</option>
              </select>
            </Campo>
            <Campo label="CPF ou CNPJ">
              <div className="flex gap-2">
                <input
                  value={form.cpfCnpj}
                  onChange={(e) => {
                    setForm({ ...form, cpfCnpj: e.target.value });
                    setFornecedor({ tipo: 'NOVO' });
                  }}
                  className="campo"
                />
                <button
                  onClick={() => consultar.mutate(form.cpfCnpj)}
                  disabled={form.cpfCnpj.trim().length < 3 || consultar.isPending}
                  className="btn btn-ferramenta shrink-0"
                  title="Procura no IXC um fornecedor já cadastrado com esse documento"
                >
                  {consultar.isPending ? 'Vendo…' : 'Conferir no IXC'}
                </button>
              </div>
            </Campo>
            <Campo label="Telefone">
              <input
                value={form.telefone}
                onChange={(e) => setForm({ ...form, telefone: e.target.value })}
                className="campo"
              />
            </Campo>
            <Campo label="E-mail">
              <input
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="campo"
              />
            </Campo>
            <Campo label="Como costuma receber">
              <select
                value={form.formaPagamento}
                onChange={(e) =>
                  setForm({
                    ...form,
                    formaPagamento: e.target.value as FormaPagamento,
                  })
                }
                className="campo"
              >
                <option value="IXC">Pelo IXC (conta a pagar)</option>
                <option value="EM_MAOS">Em mãos (sai do caixa)</option>
              </select>
            </Campo>
            <Campo label="Chave PIX">
              <input
                value={form.chavePix}
                onChange={(e) => setForm({ ...form, chavePix: e.target.value })}
                className="campo"
                placeholder="Sem ela o banco não paga"
              />
            </Campo>
            <Campo label="Tipo da chave">
              <select
                value={form.tipoChavePix}
                onChange={(e) =>
                  setForm({ ...form, tipoChavePix: e.target.value })
                }
                className="campo"
              >
                <option value="">Pelo formato da chave</option>
                {TIPOS_CHAVE_PIX.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo label="Valor por venda (R$)">
              <CampoDinheiro
                valor={form.valorPorVenda}
                onChange={(v) => setForm({ ...form, valorPorVenda: v })}
                placeholder="Se essa pessoa também vende"
              />
            </Campo>
            <Campo label="Observações" span2>
              <input
                value={form.observacoes}
                onChange={(e) =>
                  setForm({ ...form, observacoes: e.target.value })
                }
                className="campo"
                placeholder="O que essa pessoa faz, combinados…"
              />
            </Campo>
          </div>

          {fornecedor.tipo === 'PERGUNTAR' && fornecedor.consulta.fornecedor && (
            <EscolhaDoFornecedor
              fornecedor={fornecedor.consulta.fornecedor}
              onReusar={() => usarFornecedor(fornecedor.consulta.fornecedor!)}
              onNovo={() => setFornecedor({ tipo: 'NOVO' })}
            />
          )}
          {fornecedor.tipo === 'REUSAR' && (
            <Aviso tom="pago">
              Vai usar o fornecedor #{fornecedor.idFornecedorIxc} que já existe
              no IXC{fornecedor.semPix ? ' — ele ainda não tem chave PIX cadastrada lá. A que você preencher aqui sobe para os dados bancários dele ao salvar, e no próximo pagamento já vem pronta.' : '.'}
            </Aviso>
          )}

          <div className="mt-5 flex flex-wrap gap-3 border-t border-tinta-100 pt-4">
            <button
              onClick={() => salvar.mutate()}
              disabled={
                !nomeValido ||
                salvar.isPending ||
                fornecedor.tipo === 'PERGUNTAR'
              }
              className="btn btn-primario"
            >
              {salvar.isPending ? 'Salvando…' : 'Salvar'}
            </button>
            <button onClick={fecharCadastro} className="btn btn-neutro">
              Cancelar
            </button>
            {fornecedor.tipo === 'PERGUNTAR' && (
              <span className="text-sm text-amber-700">
                Escolha acima o que fazer com o fornecedor que já existe.
              </span>
            )}
          </div>
        </Bloco>
      )}

      <div className="surgir surgir-1 mb-4 flex flex-wrap items-center gap-3">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder={
            doIxc
              ? 'Buscar no IXC por nome ou apelido'
              : 'Buscar por nome ou documento'
          }
          className="campo max-w-xs"
        />
        {doIxc ? (
          <span className="text-xs text-tinta-400">
            {fornecedoresIxc.isFetching
              ? 'Lendo o IXC…'
              : fornecedoresIxc.data
                ? `${fornecedoresIxc.data.total.toLocaleString('pt-BR')} fornecedor(es) ativo(s) no IXC`
                : ''}
          </span>
        ) : (
          <label className="flex w-fit items-center gap-2 text-sm text-tinta-600">
            <input
              type="checkbox"
              className="accent-brand-600"
              checked={verInativos}
              onChange={(e) => setVerInativos(e.target.checked)}
            />
            Mostrar desativados
          </label>
        )}
      </div>

      {doIxc && (
        <Bloco className="surgir surgir-2" semPadding>
          <div className="overflow-x-auto rolagem-fina">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th">Fornecedor no IXC</th>
                  <th className="th">CPF / CNPJ</th>
                  <th className="th">Por aqui</th>
                  <th className="th text-right">Ação</th>
                </tr>
              </thead>
              <tbody>
                {fornecedoresIxc.isLoading && (
                  <tr>
                    <td colSpan={4}>
                      <Carregando texto="Lendo o cadastro do IXC…" />
                    </td>
                  </tr>
                )}
                {fornecedoresIxc.error && (
                  <tr>
                    <td colSpan={4}>
                      <Vazio titulo="Não deu para ler o IXC">
                        {mensagemErro(fornecedoresIxc.error)}
                      </Vazio>
                    </td>
                  </tr>
                )}
                {fornecedoresIxc.data?.itens.length === 0 && (
                  <tr>
                    <td colSpan={4}>
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
      )}

      {!doIxc && (
      <Bloco className="surgir surgir-2" semPadding>
        <div className="overflow-x-auto rolagem-fina">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th">Beneficiário</th>
                <th className="th">Chave PIX</th>
                <th className="th">Costuma receber</th>
                <th className="th text-right">Já pago</th>
                <th className="th">Último</th>
                <th className="th text-right">Ação</th>
              </tr>
            </thead>
            <tbody>
              {lista.isLoading && (
                <tr>
                  <td colSpan={6}>
                    <Carregando />
                  </td>
                </tr>
              )}
              {!lista.isLoading && itens.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <Vazio titulo="Ninguém cadastrado ainda">
                      Cadastre quem presta serviço para a empresa sem estar na
                      folha — pedreiro, eletricista, patrocinado.
                    </Vazio>
                  </td>
                </tr>
              )}
              {itens.map(({ beneficiario: b, ...resumo }) => (
                <tr key={b.id} className={`linha ${b.ativo ? '' : 'opacity-50'}`}>
                  <td className="td">
                    <button
                      onClick={() => setAberto(aberto === b.id ? null : b.id)}
                      className="flex flex-wrap items-center gap-2 text-left"
                    >
                      <span
                        className={`text-tinta-300 transition-transform ${
                          aberto === b.id ? 'rotate-90' : ''
                        }`}
                      >
                        ▸
                      </span>
                      <span className="font-medium text-tinta-900">{b.nome}</span>
                      {!b.ativo && (
                        <Selo tom="neutro" pequeno>
                          desativado
                        </Selo>
                      )}
                      {b.idFornecedorIxc && (
                        <Selo tom="info" pequeno titulo="Fornecedor vinculado no IXC">
                          #{b.idFornecedorIxc}
                        </Selo>
                      )}
                      {resumo.pendentesNoCaixa > 0 && (
                        <Selo tom="atencao" pequeno>
                          {resumo.pendentesNoCaixa} fora do caixa
                        </Selo>
                      )}
                      {resumo.quantidadeComErro > 0 && (
                        <Selo
                          tom="erro"
                          pequeno
                          titulo="O IXC recusou a conta a pagar — corrija e reenvie em Contas a Pagar"
                        >
                          {resumo.quantidadeComErro} com erro
                        </Selo>
                      )}
                    </button>
                    {b.cpfCnpj && (
                      <div className="mt-0.5 num text-xs text-tinta-400">
                        {b.cpfCnpj}
                      </div>
                    )}
                  </td>
                  <td className="td text-tinta-500">
                    {b.chavePix || (
                      <Selo tom="atencao" pequeno>
                        sem PIX
                      </Selo>
                    )}
                  </td>
                  <td className="td text-tinta-500">
                    {FORMA_PAGAMENTO_LABEL[b.formaPagamento]}
                  </td>
                  <td className="td text-right">
                    <span className="valor">{formatBRL(resumo.totalPago)}</span>
                    <div className="num text-xs text-tinta-400">
                      {resumo.quantidadePagas} pagamento(s)
                    </div>
                    {resumo.totalAguardando > 0 && (
                      <div
                        className="mt-0.5 num text-xs text-amber-600"
                        title="Lançado no IXC, ainda não pago pelo banco"
                      >
                        + {formatBRL(resumo.totalAguardando)} a caminho
                      </div>
                    )}
                  </td>
                  <td className="td num text-tinta-500">
                    {resumo.ultimoPagamento
                      ? formatData(resumo.ultimoPagamento)
                      : '—'}
                  </td>
                  <td className="td text-right">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <button
                        onClick={() => setPagando(b)}
                        disabled={!b.ativo}
                        className="btn btn-pagar btn-p disabled:opacity-40"
                      >
                        Pagar
                      </button>
                      <button
                        onClick={() => abrirEdicao(b)}
                        className="btn btn-neutro btn-p"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => alternarAtivo.mutate(b)}
                        className="btn btn-sutil btn-p"
                      >
                        {b.ativo ? 'Desativar' : 'Reativar'}
                      </button>
                      {resumo.quantidadePagamentos === 0 && (
                        <button
                          onClick={() => {
                            if (confirm(`Apagar o cadastro de ${b.nome}?`)) {
                              excluir.mutate(b.id);
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
      </Bloco>
      )}

      {aberto && abertoBeneficiario && (
        <Bloco
          titulo={`Pagamentos — ${abertoBeneficiario.nome}`}
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
          soValor={doIxc}
          onCancelar={() => setPagando(null)}
          onConfirmar={(body) =>
            pagar.mutate({ beneficiarioId: pagando.id, body })
          }
        />
      )}

      {editandoFornecedor && (
        <FormularioFornecedorIxc
          fornecedor={editandoFornecedor}
          ocupado={salvarFornecedorIxc.isPending}
          onCancelar={() => setEditandoFornecedor(null)}
          onConfirmar={(nomeFantasia) =>
            salvarFornecedorIxc.mutate({
              idFornecedor: editandoFornecedor.idFornecedor,
              nomeFantasia,
            })
          }
        />
      )}
    </Pagina>
  );
}

/**
 * Edita o cadastro do fornecedor no próprio IXC.
 *
 * Só o nome fantasia se escreve daqui — o resto está à vista para conferir que
 * é esta a pessoa antes de mexer no cadastro dela. Razão social, documento e
 * contato são o que identifica o fornecedor dentro do IXC e mudam a vida de
 * quem emite nota contra ele; o apelido, não: ele existe justamente para quem
 * procura a pessoa pelo nome de que se lembra.
 */
function FormularioFornecedorIxc({
  fornecedor,
  ocupado,
  onCancelar,
  onConfirmar,
}: {
  fornecedor: FornecedorParaPagar;
  ocupado: boolean;
  onCancelar: () => void;
  onConfirmar: (nomeFantasia: string) => void;
}) {
  const [fantasia, setFantasia] = useState(fornecedor.nomeFantasia ?? '');
  const mudou = fantasia.trim() !== (fornecedor.nomeFantasia ?? '').trim();

  return (
    <Janela
      titulo={`Editar no IXC — ${fornecedor.nome}`}
      onFechar={onCancelar}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Campo label="Fantasia (como é conhecido)" span2>
          <input
            value={fantasia}
            onChange={(e) => setFantasia(e.target.value)}
            className="campo"
            placeholder="Ex.: Deda pedreiro"
            autoFocus
          />
          <p className="ajuda">
            É por aqui que a busca desta tela passa a achar a pessoa, além da
            razão social. Vazio apaga o apelido no IXC.
          </p>
        </Campo>
      </div>

      {/*
       * O que o IXC já tem, só para conferir. Não é editável de propósito:
       * trocar razão social ou documento de um fornecedor é mexer no que a
       * contabilidade usa para emitir nota, e isso se faz no IXC, com quem
       * responde por aquele cadastro olhando.
       */}
      <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-3 border-t border-tinta-100 pt-4 text-sm sm:grid-cols-2">
        <Conferir titulo="Razão social / Nome">{fornecedor.nome}</Conferir>
        <Conferir titulo="CPF / CNPJ">{fornecedor.cpfCnpj}</Conferir>
        <Conferir titulo="E-mail">{fornecedor.email}</Conferir>
        <Conferir titulo="Telefone">{fornecedor.telefone}</Conferir>
        <Conferir titulo="Código no IXC">#{fornecedor.idFornecedor}</Conferir>
      </dl>

      <div className="mt-5 flex flex-wrap gap-3 border-t border-tinta-100 pt-4">
        <button
          onClick={() => onConfirmar(fantasia)}
          disabled={!mudou || ocupado}
          className="btn btn-primario"
        >
          {ocupado ? 'Salvando no IXC…' : 'Salvar no IXC'}
        </button>
        <button onClick={onCancelar} className="btn btn-neutro">
          Cancelar
        </button>
      </div>
    </Janela>
  );
}

/** Um dado do cadastro do IXC mostrado só para conferência. */
function Conferir({
  titulo,
  children,
}: {
  titulo: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-tinta-400">{titulo}</dt>
      <dd className="truncate text-tinta-700">{children || '—'}</dd>
    </div>
  );
}

/**
 * O IXC já tem um fornecedor com aquele documento. Reaproveitar traz junto os
 * dados bancários que a tela de contas a pagar de lá preenche sozinha — mas
 * pode ser homônimo, CPF digitado errado ou um cadastro velho que ninguém quer
 * mexer. Quem decide é quem está cadastrando.
 */
function EscolhaDoFornecedor({
  fornecedor,
  onReusar,
  onNovo,
}: {
  fornecedor: NonNullable<ConsultaCpfCnpj['fornecedor']>;
  onReusar: () => void;
  onNovo: () => void;
}) {
  return (
    <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <p className="text-sm text-amber-900">
        Esse CPF/CNPJ já é fornecedor no IXC:{' '}
        <strong>{fornecedor.nome}</strong> (#{fornecedor.idFornecedor})
        {!fornecedor.ativo && ' — inativo por lá'}. O que você quer fazer?
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={onReusar} className="btn btn-primario btn-p">
          Usar esse fornecedor
        </button>
        <button onClick={onNovo} className="btn btn-neutro btn-p">
          Criar um novo mesmo assim
        </button>
      </div>
      <p className="mt-2 text-xs text-amber-800">
        Usar o que existe costuma ser o certo: é lá que estão os dados bancários
        e o histórico. Criar outro faz sentido quando é outra pessoa com o
        documento digitado igual por engano.
      </p>
    </div>
  );
}

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
  const [categoriaId, setCategoriaId] = useState('');
  const [tipoPagamento, setTipoPagamento] = useState('');
  const [valorServico, setValorServico] = useState('');
  const [vendas, setVendas] = useState('');
  const [valorPorVenda, setValorPorVenda] = useState(
    beneficiario.valorPorVenda ?? '',
  );
  const [valorExtra, setValorExtra] = useState('');
  const [descricaoExtra, setDescricaoExtra] = useState('');
  const [descricao, setDescricao] = useState('');
  const [forma, setForma] = useState<FormaPagamento>(beneficiario.formaPagamento);
  const [chavePix, setChavePix] = useState(beneficiario.chavePix ?? '');
  const [tipoChavePix, setTipoChavePix] = useState(
    beneficiario.tipoChavePix ?? '',
  );
  const [contaContabil, setContaContabil] = useState('');
  const [lendoQr, setLendoQr] = useState(false);

  const categorias = useQuery({
    queryKey: ['categorias-despesa'],
    queryFn: async () =>
      (await api.get<CategoriaDespesa[]>('/categorias-despesa')).data,
  });
  const categoriasEmArvore = emArvore(categorias.data);

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

  // O tipo de pagamento começa no padrão das Configurações e é editável: nem
  // todo fornecedor recebe por PIX, e era isso que travava o pagamento de quem
  // manda boleto.
  useEffect(() => {
    if (config.data && !tipoPagamento) {
      setTipoPagamento(config.data.tipoPagamentoPadrao);
    }
  }, [config.data, tipoPagamento]);

  const servico = Number(valorServico) || 0;
  const comissao = (Number(vendas) || 0) * (Number(valorPorVenda) || 0);
  const extra = Number(valorExtra) || 0;
  const total = servico + comissao + extra;
  const vaiDePix = /pix/i.test(tipoPagamento);
  const semPix = forma === 'IXC' && vaiDePix && !chavePix.trim();
  const valido = total >= 0.01 && descricao.trim().length >= 3 && !semPix;

  /** A conta contábil que vai valer: a escolhida, ou a padrão da configuração. */
  const contaEmUso = Number(contaContabil) || config.data?.contaContabilAvulso;
  const nomeDaConta = plano.data?.find((c) => c.id === contaEmUso)?.nome;

  return (
    <Janela titulo={`Pagar — ${beneficiario.nome}`} onFechar={onCancelar}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Campo label="Data">
          <input
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
            className="campo"
          />
        </Campo>
        <Campo label="Como vai pagar">
          <select
            value={forma}
            onChange={(e) => setForma(e.target.value as FormaPagamento)}
            className="campo"
          >
            <option value="IXC">Pelo IXC (conta a pagar)</option>
            <option value="EM_MAOS">Em mãos (desconta do caixa)</option>
          </select>
        </Campo>
        <Campo label="Conta contábil no IXC">
          <select
            value={contaContabil}
            onChange={(e) => setContaContabil(e.target.value)}
            className="campo"
            disabled={plano.isLoading}
          >
            <option value="">
              {config.data
                ? `Padrão — ${config.data.contaContabilAvulso}${
                    plano.data?.find(
                      (c) => c.id === config.data!.contaContabilAvulso,
                    )?.nome
                      ? ` · ${plano.data.find((c) => c.id === config.data!.contaContabilAvulso)!.nome}`
                      : ''
                  }`
                : 'Padrão das Configurações'}
            </option>
            {(plano.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.id} · {c.nome}
              </option>
            ))}
          </select>
          <p className="ajuda">
            {plano.error
              ? 'Não deu para ler o plano de contas do IXC — o padrão vale.'
              : nomeDaConta
                ? `Vai lançar em "${nomeDaConta}".`
                : 'É a conta do plano de contas do IXC onde a despesa entra.'}
          </p>
        </Campo>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Campo label="A que se refere — categoria daqui">
          <select
            value={categoriaId}
            onChange={(e) => setCategoriaId(e.target.value)}
            className="campo"
            disabled={categorias.isLoading}
          >
            <option value="">Sem classificação</option>
            {/* As soltas primeiro, os grupos depois: opção fora de `optgroup`
                listada abaixo de um grupo parece ter escapado dele. */}
            {categoriasEmArvore.soltas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
            {categoriasEmArvore.grupos.map(({ mae, filhas }) => (
              <optgroup key={mae.id} label={mae.nome}>
                {mae.emUso > 0 && (
                  <option value={mae.id}>{mae.nome} (sem subcategoria)</option>
                )}
                {filhas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <p className="ajuda">
            É por ela que o dashboard separa os gastos. Fica guardada aqui — o IXC
            não tem onde recebê-la.
          </p>
        </Campo>

        {forma === 'IXC' && (
          <Campo label="Como o IXC vai pagar">
            <input
              list="tipos-pagamento-avulso"
              value={tipoPagamento}
              onChange={(e) => setTipoPagamento(e.target.value)}
              className="campo"
              placeholder="Pix"
            />
            <datalist id="tipos-pagamento-avulso">
              <option value="Pix" />
              <option value="Boleto" />
              <option value="Dinheiro" />
              <option value="Transferência" />
              <option value="Cartão" />
            </datalist>
            <p className="ajuda">
              O rótulo tem de ser o mesmo do seu IXC. Fora do PIX, a chave não é
              exigida.
            </p>
          </Campo>
        )}
      </div>

      <Parte titulo="Valor" valor={servico}>
        <Campo label="Valor (R$)" span2>
          <CampoDinheiro valor={valorServico} onChange={setValorServico} />
        </Campo>
      </Parte>

      {!soValor && (
        <>
          <Parte
            titulo="Vendas"
            valor={comissao}
            nota="Cliente da empresa também vende e recebe comissão. Deixe em zero quando o acerto não tiver venda."
          >
            <Campo label="Quantas vendas">
              <input
                type="number"
                min="0"
                value={vendas}
                onChange={(e) => setVendas(e.target.value)}
                placeholder="0"
                className="campo"
              />
            </Campo>
            <Campo label="Valor de cada venda (R$)">
              <CampoDinheiro
                valor={valorPorVenda}
                onChange={setValorPorVenda}
                placeholder={
                  beneficiario.valorPorVenda
                    ? `combinado ${formatBRL(beneficiario.valorPorVenda)}`
                    : 'ex.: 50,00'
                }
              />
            </Campo>
          </Parte>

          <Parte
            titulo="Serviço por fora"
            valor={extra}
            nota="Aquele trabalho a mais que rendeu um troco no mesmo acerto."
          >
            <Campo label="Valor extra (R$)">
              <CampoDinheiro valor={valorExtra} onChange={setValorExtra} />
            </Campo>
            <Campo label="O que foi">
              <input
                value={descricaoExtra}
                onChange={(e) => setDescricaoExtra(e.target.value)}
                className="campo"
                placeholder="Ex.: instalação"
              />
            </Campo>
          </Parte>
        </>
      )}

      <div className="mt-5 grid grid-cols-1 gap-4 border-t border-tinta-100 pt-5 sm:grid-cols-2 lg:grid-cols-3">
        <Campo label="Do que se trata — vai para o IXC" span2>
          <input
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            className="campo"
            placeholder="Ex.: troca do padrão de energia"
          />
        </Campo>
        {forma === 'IXC' && (
          <>
            <Campo label="Chave PIX — vai exata para o IXC">
              <div className="flex gap-2">
                <input
                  value={chavePix}
                  onChange={(e) => setChavePix(e.target.value)}
                  className="campo"
                  placeholder="Ex.: (99) 99230-0993"
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
            </Campo>
            <Campo label="Tipo da chave">
              <select
                value={tipoChavePix}
                onChange={(e) => setTipoChavePix(e.target.value)}
                className="campo"
              >
                <option value="">Pelo formato da chave</option>
                {TIPOS_CHAVE_PIX.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Campo>
          </>
        )}
      </div>

      <p className="mt-4 text-xs leading-relaxed text-tinta-500">
        {forma === 'IXC'
          ? 'Vai virar uma conta a pagar só no IXC: a pessoa é cadastrada como fornecedor e o pagamento passa pela auditoria, como o da folha. A chave e o tipo ficam gravados no cadastro para a próxima vez.'
          : 'Vira a mesma conta a pagar no IXC, mudando só de onde o dinheiro sai: a conta do caixa em vez da do banco, em dinheiro. Sem chave PIX, e passando pela auditoria como as outras.'}
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-tinta-100 pt-4">
        <button
          onClick={() =>
            onConfirmar({
              data,
              valorServico: valorServico || undefined,
              // Sem as partes na tela, nada de comissão nem extra no pedido: o
              // valor digitado é o pagamento inteiro.
              ...(soValor
                ? {}
                : {
                    vendas: Number(vendas) || 0,
                    valorPorVenda: valorPorVenda || undefined,
                    valorExtra: valorExtra || undefined,
                    descricaoExtra: descricaoExtra || undefined,
                  }),
              descricao,
              forma,
              contaContabil: contaContabil || undefined,
              categoriaId: categoriaId || undefined,
              ...(forma === 'IXC'
                ? { chavePix, tipoChavePix, tipoPagamento: tipoPagamento || undefined }
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

        {semPix ? (
          <span className="text-sm text-rose-600">
            Sem chave PIX o banco não paga por PIX — informe a chave, escolha
            outro tipo de pagamento (boleto, transferência) ou pague em mãos.
          </span>
        ) : (
          <span className="ml-auto text-sm text-tinta-500">
            Vai sair{' '}
            <strong className="valor text-lg text-tinta-900">
              {formatBRL(total)}
            </strong>
          </span>
        )}
      </div>
    </Janela>
  );
}

/**
 * Uma parte do pagamento, com o que ela soma à direita. Ver as três somas
 * separadas é o que permite conferir o total sem refazer a conta de cabeça.
 */
function Parte({
  titulo,
  valor,
  nota,
  children,
}: {
  titulo: string;
  valor: number;
  nota?: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-5 rounded-xl border border-tinta-100 p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-tinta-500">
          {titulo}
        </h3>
        <span
          className={`valor text-sm ${valor > 0 ? 'text-tinta-800' : 'text-tinta-300'}`}
        >
          {formatBRL(valor)}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
      {nota && <p className="mt-3 text-xs text-tinta-400">{nota}</p>}
    </section>
  );
}

function Campo({
  label,
  span2,
  children,
}: {
  label: string;
  span2?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={span2 ? 'sm:col-span-2' : ''}>
      <label className="rotulo">{label}</label>
      {children}
    </div>
  );
}
