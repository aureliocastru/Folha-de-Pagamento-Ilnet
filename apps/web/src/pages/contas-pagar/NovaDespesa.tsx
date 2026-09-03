import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  LeitorDeCodigo,
  leitorDeCodigoSuportado,
} from '../../components/LeitorDeCodigo';
import { SeletorDeCategoria } from '../../components/SeletorDeCategoria';
import { CampoDinheiro, Carregando, Janela, Selo } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { useTermoAdiado } from '../../lib/busca';
import { formatBRL } from '../../lib/format';
import {
  TIPOS_CHAVE_PIX,
  type CategoriaDespesa,
  type ConfigFinanceira,
} from '../../lib/types';

/** Um fornecedor achado no IXC pela busca desta tela. */
interface FornecedorIxc {
  idFornecedor: number;
  nome: string;
  nomeFantasia: string | null;
  cpfCnpj: string | null;
}

/**
 * O ritmo das parcelas de uma nota.
 *
 * `'mes'` é o dia fixo — vence dia 15, vence todo dia 15 —, e é o padrão porque
 * é assim que quase toda nota parcelada é combinada. Os intervalos em dias
 * ficam para o que de fato conta dias, como um carnê de 15 em 15.
 */
type RitmoDasParcelas = 15 | 30 | 'mes';

/**
 * O mesmo fornecedor lido pelo código, agora com a aba "Dados bancários" do
 * IXC. A busca por nome não traz isso — mora noutra tabela e custaria uma
 * consulta por linha da lista.
 */
interface FornecedorComBanco extends FornecedorIxc {
  chavePix: string | null;
  tipoChavePix: string | null;
}

interface DespesaLancada {
  conta: { id: string; idFnApagarIxc: number | null; status: string };
  contas: Array<{ id: string; idFnApagarIxc: number | null }>;
  avisoCategoria: string | null;
  /** Null quando o lançamento não pediu para já sair pago. */
  baixa: {
    pagas: number;
    tentadas: number;
    valor: number;
    /** "AAAA-MM-DD" */
    data: string;
    avisos: string[];
  } | null;
}

/** Uma conta de onde o dinheiro sai, como o IXC a tem. */
interface ContaDePagamento {
  id: number;
  nome: string;
  ativa: boolean;
  usual: boolean;
}

/**
 * Os tipos que o IXC entende. É lista fechada de propósito: o rótulo vai exato
 * para o `fn_apagar.tipo_pagamento`, e um tipo inventado aqui vira uma conta
 * que o financeiro de lá não sabe pagar.
 */
const TIPOS_DE_PAGAMENTO = [
  {
    valor: 'Pix',
    rotulo: 'Pix',
    nota: 'O banco paga pela chave — ou pelo copia e cola do QR.',
  },
  {
    valor: 'Boleto',
    rotulo: 'Boleto',
    nota: 'Precisa da linha digitável; sem ela o IXC não tem como pagar.',
  },
  {
    valor: 'Dinheiro',
    rotulo: 'Em mãos (dinheiro)',
    nota: 'Sai do caixa, não do banco. Escolha o caixa na conta ao lado.',
  },
  { valor: 'Transferência', rotulo: 'Transferência', nota: 'TED ou DOC.' },
  { valor: 'Cartão', rotulo: 'Cartão', nota: 'Cartão da empresa.' },
] as const;

/**
 * O caixa de onde sai o dinheiro entregue em mãos: "CX - Werick" no IXC.
 * Escolher "Dinheiro" e deixar a conta do banco lançaria a saída no lugar
 * errado, e o acerto disso é no IXC, à mão.
 */
const CAIXA_EM_MAOS = 23;

/** Uma parcela na tela, antes de virar conta a pagar. */
interface Parcela {
  /** Valor canônico, como o CampoDinheiro devolve ("1234.56"). */
  valor: string;
  /** "AAAA-MM-DD" */
  vencimento: string;
}

/**
 * Lançar uma conta a pagar à mão — energia, aluguel, material —, sem passar
 * pela folha.
 *
 * O fornecedor é escolhido entre os que já existem no IXC porque é ele que o
 * `fn_apagar` exige. Cadastrar um novo daqui encheria a base de duplicados: a
 * Cemar já está lá, o que falta é achá-la.
 */
export function NovaDespesa({ onFechar }: { onFechar: () => void }) {
  const queryClient = useQueryClient();

  const [termo, setTermo] = useState('');
  const [fornecedor, setFornecedor] = useState<FornecedorIxc | null>(null);
  const [valor, setValor] = useState('');
  const [emissao, setEmissao] = useState(hoje);
  const [vencimento, setVencimento] = useState(hoje);
  const [categoriaId, setCategoriaId] = useState('');
  const [tipoPagamento, setTipoPagamento] = useState('');
  const [observacao, setObservacao] = useState('');
  const [codigoBarras, setCodigoBarras] = useState('');
  const [documento, setDocumento] = useState('');
  const [numeroNota, setNumeroNota] = useState('');
  const [chavePix, setChavePix] = useState('');
  const [tipoChavePix, setTipoChavePix] = useState('');
  const [contaPagamento, setContaPagamento] = useState('');
  /** Qual leitor está aberto: o do boleto, o do QR do PIX, ou nenhum. */
  const [lendo, setLendo] = useState<'boleto' | 'pix' | null>(null);

  /**
   * Esta conta já foi paga antes de existir no IXC — o boleto saiu pelo
   * aplicativo do banco e só agora está sendo registrada.
   */
  const [jaPaga, setJaPaga] = useState(false);
  /** Dia em que o dinheiro saiu de fato. É o do extrato, não o de hoje. */
  const [dataPagamento, setDataPagamento] = useState(hoje);

  /** Repetir todo mês: esta conta vira uma regra, e as próximas nascem sozinhas. */
  const [recorrente, setRecorrente] = useState(false);
  /** Vencimento em fim de semana ou feriado anda para o proximo dia util. */
  const [soDiasUteis, setSoDiasUteis] = useState(true);

  // --- Parcelamento ---
  const [parcelado, setParcelado] = useState(false);
  /** "nota" divide um total; "consorcio" repete a parcela que falta. */
  const [modoParcela, setModoParcela] = useState<'nota' | 'consorcio'>('nota');
  const [quantasParcelas, setQuantasParcelas] = useState('2');
  /** Dias entre uma parcela e a seguinte: quinzenal ou mensal. */
  const [intervalo, setIntervalo] = useState<RitmoDasParcelas>('mes');
  const [parcelas, setParcelas] = useState<Parcela[]>([]);

  // --- Consórcio ---
  /**
   * Como as datas caminham: "mes" mantém o dia (vence todo dia 10), "dias30"
   * conta de trinta em trinta. As duas coisas se separam depois de meio ano, e
   * qual vale depende do contrato do grupo.
   */
  const [ritmoConsorcio, setRitmoConsorcio] = useState<'mes' | 'dias30'>('mes');
  const [totalParcelas, setTotalParcelas] = useState('');
  const [parcelasPagas, setParcelasPagas] = useState('');
  const [taxaAdmin, setTaxaAdmin] = useState('');
  const [reajusteAnual, setReajusteAnual] = useState('');
  const [lancada, setLancada] = useState<DespesaLancada | null>(null);
  /** A nota que vai junto: arquivo escolhido ou print colado. */
  const [nota, setNota] = useState<{ nome: string; dados: string } | null>(null);
  const [avisoDaNota, setAvisoDaNota] = useState<string | null>(null);

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

  // O tipo de pagamento começa no padrão das Configurações e fica editável: a
  // folha sai por PIX, mas a conta de energia costuma ser boleto, e mandar o
  // rótulo errado deixa o pagamento preso no IXC.
  useEffect(() => {
    if (config.data && !tipoPagamento) {
      setTipoPagamento(config.data.tipoPagamentoPadrao);
    }
  }, [config.data, tipoPagamento]);

  // A busca só sai depois que quem digita para de digitar: cada tecla aqui é
  // uma consulta ao IXC, que é lento e não é nosso.
  const buscaEfetiva = useTermoAdiado(termo);

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

  /**
   * A chave PIX de quem foi escolhido, lida do cadastro dele no IXC.
   *
   * Só depois da escolha: na lista de busca isso seria uma consulta por linha.
   * Falha para dentro — sem a chave, o campo fica em branco e o IXC usa a do
   * cadastro na hora de pagar, que é o comportamento de sempre.
   */
  const bancoDoFornecedor = useQuery({
    queryKey: ['fornecedor-ixc', fornecedor?.idFornecedor],
    queryFn: async () =>
      (
        await api.get<FornecedorComBanco | null>(
          `/fornecedores-ixc/${fornecedor!.idFornecedor}`,
        )
      ).data,
    enabled: !!fornecedor,
    retry: 0,
  });

  const pixDoCadastro = bancoDoFornecedor.data?.chavePix?.trim() || '';

  /**
   * Preenche a chave assim que ela chega — mas nunca por cima do que já está
   * escrito. Quem colou um copia-e-cola de cobrança ou leu um QR Code escolheu
   * aquela chave para esta conta; o cadastro do fornecedor é o padrão, não a
   * última palavra.
   */
  useEffect(() => {
    if (!pixDoCadastro) return;
    setChavePix((atual) => atual || pixDoCadastro);
    const tipo = bancoDoFornecedor.data?.tipoChavePix?.trim();
    if (tipo) setTipoChavePix((atual) => atual || tipo);
  }, [pixDoCadastro, bancoDoFornecedor.data?.tipoChavePix]);

  /**
   * O dia em que o dinheiro saiu passa a valer como emissão e vencimento.
   *
   * Uma conta paga antes de existir no IXC é registro retroativo: ela não tem
   * um vencimento futuro a esperar nem uma emissão em outro dia — as três datas
   * são o mesmo dia, o do extrato. Deixá-las em "hoje" faria a conta nascer
   * quitada com data de vencimento posterior ao próprio pagamento, e é isso que
   * o fechamento do mês não perdoa.
   *
   * Vale no momento da escolha, e não como amarra permanente: quem precisar de
   * uma emissão diferente ainda pode digitá-la depois.
   */
  function datarComoPaga(dia: string) {
    setDataPagamento(dia);
    if (!dia) return;
    setEmissao(dia);
    setVencimento(dia);
  }

  const lancar = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<DespesaLancada>(
        '/contas-abertas/despesa',
        {
          idFornecedorIxc: fornecedor!.idFornecedor,
          fornecedorNome: fornecedor!.nome,
          valor: Number(valor),
          dataEmissao: emissao,
          dataVencimento: vencimento,
          observacao: observacao.trim(),
          categoriaId: categoriaId || null,
          tipoPagamento: tipoPagamento.trim() || undefined,
          codigoBarras: digitos(codigoBarras) || undefined,
          documento: documento.trim() || undefined,
          numeroNota: numeroNota.trim() || undefined,
          chavePix: chavePix.trim() || undefined,
          // QR lido é sempre copia e cola: dizer isso ao IXC evita que ele
          // tente ler o EMV como se fosse CPF ou celular.
          tipoChavePix:
            (ehCopiaECola ? 'Código copia e cola' : tipoChavePix) || undefined,
          contaPagamento: contaPagamento ? Number(contaPagamento) : undefined,
          // Já paga: a conta nasce, é aprovada e baixada na mesma ida, com a
          // data do extrato. Sem isso ela ficaria em aberto esperando alguém
          // lembrar de voltar — e é assim que o mesmo dinheiro sai duas vezes.
          jaPaga: jaPaga || undefined,
          dataPagamento: jaPaga ? dataPagamento : undefined,
          parcelas: parcelado
            ? parcelas.map((p, i) => ({
                valor: Number(p.valor),
                dataVencimento: p.vencimento,
                // Num consórcio a numeração continua a do grupo: o IXC precisa
                // ler "13/120", que é o que vem no boleto.
                rotulo:
                  modoParcela === 'consorcio'
                    ? `${(Number(parcelasPagas) || 0) + i + 1}/${totalParcelas}`
                    : undefined,
              }))
            : undefined,
        },
      );
      /*
       * A repetição guarda a regra a partir do MÊS SEGUINTE: a conta deste mês
       * é a que acabou de ser lançada. Registrar a partir do mesmo vencimento
       * faria a rotina gerar hoje mesmo uma segunda conta igual.
       */
      if (recorrente) {
        await api.post('/recorrentes', {
          idFornecedorIxc: fornecedor!.idFornecedor,
          fornecedorNome: fornecedor!.nome,
          valor: Number(valor),
          observacao: observacao.trim(),
          proximoVencimento: mesSeguinte(vencimento),
          contaPagamento: contaPagamento ? Number(contaPagamento) : undefined,
          tipoPagamentoIxc: tipoPagamento.trim() || undefined,
          categoriaId: categoriaId || undefined,
          apenasDiasUteis: soDiasUteis,
        });
      }

      /*
       * A nota sobe depois, e por rota própria.
       *
       * O lançamento é a parte que não dá para refazer — a conta já está no
       * IXC. Se o anexo falhar (arquivo grande, webservice fora), o que se
       * perde é o anexo, e a tela diz isso: a conta continua lançada, e a nota
       * se anexa de novo pelo IXC ou por aqui.
       */
      const idNoIxc = data.conta.idFnApagarIxc;
      if (nota && idNoIxc) {
        try {
          await api.post(`/contas-abertas/${idNoIxc}/nota`, {
            arquivo: nota.dados,
            nome: nota.nome,
            descricao: observacao.trim().slice(0, 100) || 'Nota',
          });
        } catch (err) {
          setAvisoDaNota(
            `A conta foi lançada, mas a nota não subiu: ${mensagemErro(err)}`,
          );
        }
      }

      return data;
    },
    onSuccess: (data) => {
      setLancada(data);
      void queryClient.invalidateQueries({ queryKey: ['contas-abertas'] });
      void queryClient.invalidateQueries({ queryKey: ['categorias-despesa'] });
      void queryClient.invalidateQueries({ queryKey: ['recorrentes'] });
    },
  });

  const contasPagamento = useQuery({
    queryKey: ['contas-pagamento'],
    queryFn: async () =>
      (
        await api.get<ContaDePagamento[]>('/contas-abertas/contas-pagamento')
      ).data,
  });

  const usuais = (contasPagamento.data ?? []).filter((c) => c.usual);
  const demais = (contasPagamento.data ?? []).filter((c) => !c.usual);
  const nomeDaContaPadrao = contasPagamento.data?.find(
    (c) => c.id === config.data?.contaPagamentoId,
  )?.nome;

  /**
   * Redivide a nota assim que o valor total, a data ou o ritmo mudam.
   *
   * A divisão sobra centavos quase sempre (100 em 3 dá 33,33 três vezes e
   * perde um centavo), e o que sobra vai na primeira parcela: é onde ninguém
   * se incomoda, e a soma fecha com a nota. Editar qualquer linha depois é
   * livre — daí em diante manda o que está na tela.
   */
  function gerarParcelas(
    quantidade: number,
    total: number,
    primeiroVencimento: string,
    ritmo: RitmoDasParcelas,
  ): Parcela[] {
    if (quantidade < 1 || !primeiroVencimento) return [];
    const centavos = Math.round(total * 100);
    const base = Math.floor(centavos / quantidade);
    const sobra = centavos - base * quantidade;

    return Array.from({ length: quantidade }, (_, i) => ({
      valor: (((i === 0 ? base + sobra : base) / 100) || 0).toFixed(2),
      // "mes" mantém o dia: quem vence dia 15 vence todo dia 15. Contar 30 dias
      // parece a mesma coisa e não é — em seis meses a conta já anda cinco dias,
      // e a parcela de agosto cai em setembro no dia 10.
      vencimento:
        ritmo === 'mes'
          ? mesesDepois(primeiroVencimento, i)
          : somarDias(primeiroVencimento, ritmo * i),
    }));
  }

  function refazerParcelas(
    quantidade = Number(quantasParcelas) || 0,
    ritmo = intervalo,
  ) {
    setParcelas(
      gerarParcelas(quantidade, Number(valor) || 0, vencimento, ritmo),
    );
  }

  /**
   * Quantas parcelas do consórcio ainda não foram pagas. O teto de 240 é para
   * um dedo escorregado no total não virar mil linhas na tela — e mil contas
   * no IXC.
   */
  const faltamDoConsorcio = Math.min(
    Math.max((Number(totalParcelas) || 0) - (Number(parcelasPagas) || 0), 0),
    240,
  );

  /**
   * As parcelas que faltam de um consórcio.
   *
   * Diferente da nota parcelada: ali o valor total é dividido; aqui o valor da
   * parcela é conhecido e o que se sabe é quantas faltam. Quem entra com um
   * consórcio no meio já pagou algumas fora do sistema, e são as que sobram
   * que precisam existir como conta a pagar.
   *
   * A parcela cheia é o valor base mais a taxa de administração, e o reajuste
   * anual entra a cada doze meses — que é como o grupo corrige o saldo. As
   * duas taxas são opcionais e a tabela continua editável: consórcio tem
   * regra de contrato, e o que vale é o boleto que chega.
   *
   * O `ritmo` vem por parâmetro, e não do estado, porque quem troca o botão
   * precisa gerar já com a escolha nova — `setState` só vale no render
   * seguinte, e a tabela sairia com o ritmo anterior.
   */
  function gerarConsorcio(ritmo = ritmoConsorcio): Parcela[] {
    const restantes = faltamDoConsorcio;
    if (restantes < 1 || !vencimento) return [];

    const base = Number(valor) || 0;
    const comTaxa = base * (1 + (Number(taxaAdmin) || 0) / 100);
    const reajuste = (Number(reajusteAnual) || 0) / 100;

    return Array.from({ length: restantes }, (_, i) => {
      // A cada doze parcelas o valor sobe uma vez — o reajuste do grupo.
      const anos = Math.floor(i / 12);
      const valorDaParcela = comTaxa * Math.pow(1 + reajuste, anos);
      return {
        valor: valorDaParcela.toFixed(2),
        vencimento:
          ritmo === 'mes'
            ? mesesDepois(vencimento, i)
            : somarDias(vencimento, 30 * i),
      };
    });
  }

  function refazerConsorcio() {
    setParcelas(gerarConsorcio());
  }

  const somaDasParcelas = parcelas.reduce(
    (s, p) => s + (Number(p.valor) || 0),
    0,
  );
  const diferenca = Math.round((somaDasParcelas - (Number(valor) || 0)) * 100) / 100;

  const ehBoleto = /boleto/i.test(tipoPagamento);
  const ehPix = /pix/i.test(tipoPagamento);
  const boletoValido = [44, 47, 48].includes(digitos(codigoBarras).length);
  const ehCopiaECola = /^0002/.test(chavePix.trim());

  const podeLancar =
    !!fornecedor &&
    Number(valor) > 0 &&
    observacao.trim().length >= 3 &&
    // Boleto com código pela metade não é recusado aqui, mas com código errado
    // sim: a conta chegaria ao IXC com um número que o banco não reconhece.
    (!ehBoleto || !codigoBarras || boletoValido) &&
    // Marcar "em parcelas" e mandar sem nenhuma linha lançaria uma conta só,
    // do valor cheio — o oposto do que se pediu.
    (!parcelado || parcelas.length > 0);

  // Depois de lançada a tela vira recibo: a conta já existe no IXC e mostrar o
  // formulário de novo convidaria a lançar a mesma despesa duas vezes.
  //
  // Saiu tudo pago é uma notícia diferente de "lançada": ela diz que não há
  // mais nada a fazer com esta conta, e é o que impede alguém de ir procurá-la
  // na lista para pagar de novo.
  const quitou = !!lancada?.baixa && lancada.baixa.pagas === lancada.baixa.tentadas;

  if (lancada) {
    return (
      <Janela
        titulo={quitou ? 'Conta lançada e paga' : 'Conta lançada'}
        onFechar={onFechar}
      >
        <div className="text-center">
          <p className="font-display text-lg font-semibold text-tinta-900">
            {lancada.contas.length > 1
              ? `${lancada.contas.length} contas ${quitou ? 'lançadas e pagas' : 'criadas'} no IXC`
              : quitou
                ? 'A conta foi lançada e paga no IXC'
                : 'A conta foi criada no IXC'}
          </p>
          <p className="mt-1 text-sm text-tinta-500">
            {/* Lançada já paga, ela não fica no aguardo de nada — dizer que
                fica mandaria alguém procurá-la na auditoria. */}
            {lancada.contas.length > 1
              ? `Títulos ${lancada.contas
                  .map((c) => c.idFnApagarIxc ?? '?')
                  .join(', ')} — uma parcela cada${
                  lancada.baixa ? '.' : ', todas no aguardo da auditoria.'
                }`
              : lancada.conta.idFnApagarIxc
                ? `Título nº ${lancada.conta.idFnApagarIxc}${
                    lancada.baixa
                      ? '.'
                      : ', no aguardo da auditoria do IXC como qualquer outra.'
                  }`
                : 'A conta foi salva aqui, mas o IXC ainda não devolveu o número dela.'}
          </p>
          {/* A baixa é a parte que mexeu em dinheiro: ela merece dizer o que
              conseguiu e o que não, em vez de sumir num "pronto". */}
          {lancada.baixa && (
            <div
              className={`mx-auto mt-4 max-w-md rounded-xl px-4 py-3 text-sm ${
                lancada.baixa.pagas === lancada.baixa.tentadas
                  ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200'
                  : 'bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200'
              }`}
            >
              {lancada.baixa.pagas > 0 && (
                <p>
                  {lancada.baixa.tentadas > 1
                    ? `${lancada.baixa.pagas} de ${lancada.baixa.tentadas} parcelas baixadas`
                    : 'Baixada como paga'}{' '}
                  no IXC em {formatarDia(lancada.baixa.data)} —{' '}
                  {formatBRL(lancada.baixa.valor)}.
                </p>
              )}
              {lancada.baixa.avisos.map((aviso) => (
                <p key={aviso} className="mt-1">
                  {aviso}
                </p>
              ))}
            </div>
          )}
          {lancada.avisoCategoria && (
            <p className="mx-auto mt-4 max-w-md rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
              {lancada.avisoCategoria}
            </p>
          )}
          <button onClick={onFechar} className="btn btn-primario mt-6">
            Voltar para a lista
          </button>
        </div>
      </Janela>
    );
  }

  return (
    <Janela titulo="Lançar conta a pagar" onFechar={onFechar}>
      {/* --- Fornecedor --- */}
      <div className="mb-4">
        <label className="rotulo" htmlFor="fornecedor">
          Fornecedor no IXC
        </label>
        {fornecedor ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-tinta-100 bg-tinta-50 px-4 py-3">
            <div className="min-w-0">
              <div className="font-semibold text-tinta-900">
                {fornecedor.nome}
              </div>
              <div className="num text-xs text-tinta-500">
                nº {fornecedor.idFornecedor}
                {fornecedor.cpfCnpj ? ` · ${fornecedor.cpfCnpj}` : ''}
              </div>
            </div>
            <button
              onClick={() => {
                setFornecedor(null);
                setTermo('');
                // A chave sai junto com o fornecedor. Sem isto, trocar de
                // credor deixaria a chave do anterior no campo — e a conta iria
                // para o IXC pagando a pessoa errada.
                setChavePix('');
                setTipoChavePix('');
              }}
              className="btn btn-sutil btn-p"
            >
              Trocar
            </button>
          </div>
        ) : (
          <>
            <input
              id="fornecedor"
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              placeholder="Nome, nome fantasia ou CPF/CNPJ"
              className="campo"
              autoFocus
            />
            {fornecedores.isFetching && <Carregando texto="Procurando no IXC…" />}

            {fornecedores.error && (
              <p className="mt-2 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {mensagemErro(fornecedores.error)}
              </p>
            )}

            {fornecedores.data && fornecedores.data.length === 0 && (
              <p className="mt-2 text-sm text-tinta-500">
                Nenhum fornecedor ativo com esse nome. Se ele ainda não existe,
                cadastre-o no IXC — é lá que este app o procura.
              </p>
            )}

            {!!fornecedores.data?.length && (
              <div className="mt-2 max-h-56 overflow-y-auto rolagem-fina rounded-xl border border-tinta-100">
                {fornecedores.data.map((f) => (
                  <button
                    key={f.idFornecedor}
                    onClick={() => setFornecedor(f)}
                    className="item-dividido flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-tinta-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-tinta-800">
                        {f.nome}
                      </span>
                      {f.nomeFantasia && f.nomeFantasia !== f.nome && (
                        <span className="block truncate text-xs text-tinta-400">
                          {f.nomeFantasia}
                        </span>
                      )}
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="rotulo" htmlFor="valor">
            {parcelado && modoParcela === 'consorcio'
              ? 'Valor da parcela'
              : 'Valor'}
          </label>
          <CampoDinheiro valor={valor} onChange={setValor} placeholder="0,00" />
        </div>

        <div>
          <label className="rotulo" htmlFor="tipo-pagamento">
            Tipo de pagamento
          </label>
          {/* Lista fechada, e não campo com sugestão: o rótulo tem de ser
              exatamente um dos que o IXC conhece, e digitar livre era convite
              a criar um tipo que o financeiro de lá não entende. */}
          <select
            id="tipo-pagamento"
            value={tipoPagamento}
            onChange={(e) => {
              const novo = e.target.value;
              setTipoPagamento(novo);
              // Em mãos o dinheiro sai do caixa, não do banco: a conta do
              // caixa já vem escolhida, porque escolher "Dinheiro" e deixar a
              // conta do banco lançaria a saída no lugar errado.
              if (novo === 'Dinheiro') setContaPagamento(String(CAIXA_EM_MAOS));
              else if (contaPagamento === String(CAIXA_EM_MAOS)) {
                setContaPagamento('');
              }
            }}
            className="campo"
          >
            {TIPOS_DE_PAGAMENTO.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.rotulo}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="rotulo" htmlFor="conta-pagamento">
            Conta de Pagamento
          </label>
          <select
            id="conta-pagamento"
            value={contaPagamento}
            onChange={(e) => setContaPagamento(e.target.value)}
            className="campo"
            disabled={contasPagamento.isLoading}
          >
            <option value="">
              {config.data
                ? `Padrão — ${nomeDaContaPadrao ?? config.data.contaPagamentoId}`
                : 'Padrão das Configurações'}
            </option>
            {usuais.length > 0 && (
              <optgroup label="As que costumam pagar">
                {usuais.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </optgroup>
            )}
            {demais.length > 0 && (
              <optgroup label="Outras contas do IXC">
                {demais.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                    {c.ativa ? '' : ' (inativa)'}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {contasPagamento.error && (
            <p className="ajuda text-amber-700">
              Não deu para ler as contas do IXC — a padrão vale.
            </p>
          )}

          {/*
            "Já foi paga" mora colado na conta, e não junto das outras opções:
            é esta conta que recebe a baixa. As duas escolhas são uma só — de
            onde o dinheiro saiu —, e separá-las fazia marcar a caixa sem olhar
            para a conta que ia ser debitada.
          */}
          <label
            className="opcao mt-2.5"
            title="A conta é criada, aprovada e baixada como paga no IXC de uma vez, e as três datas passam a ser o dia em que o dinheiro saiu"
          >
            <input
              type="checkbox"
              className="marcador"
              checked={jaPaga}
              onChange={(e) => {
                setJaPaga(e.target.checked);
                if (e.target.checked) datarComoPaga(dataPagamento);
              }}
            />
            Já foi paga
          </label>
          {jaPaga && (
            <div className="mt-2">
              <label className="rotulo" htmlFor="data-pagamento">
                Dia em que saiu
              </label>
              <input
                id="data-pagamento"
                type="date"
                value={dataPagamento}
                onChange={(e) => datarComoPaga(e.target.value)}
                className="campo"
                title="Vale também como emissão e vencimento"
              />
            </div>
          )}
        </div>

        {/* Emissão e vencimento uma sob a outra: são a mesma pergunta em dois
            tempos, e lado a lado com um campo alto sobrava buraco na coluna. */}
        <div className="space-y-3">
          <div>
            <label className="rotulo" htmlFor="emissao">
              Emissão
            </label>
            <input
              id="emissao"
              type="date"
              value={emissao}
              onChange={(e) => setEmissao(e.target.value)}
              className="campo"
            />
          </div>

          <div>
            <label className="rotulo" htmlFor="vencimento">
              Vencimento
            </label>
            <input
              id="vencimento"
              type="date"
              value={vencimento}
              onChange={(e) => setVencimento(e.target.value)}
              className="campo"
            />
            {vencimento < emissao && (
              <p className="ajuda text-amber-700">
                O vencimento está antes da emissão — confira se é isso mesmo.
              </p>
            )}
          </div>
        </div>

        {/*
          O boleto só aparece quando é boleto que vai pagar: é o campo mais
          longo da tela, e deixá-lo aberto o tempo todo empurraria o resto para
          baixo em toda conta paga por PIX.
        */}
        {ehBoleto && (
          <div className="sm:col-span-2">
            <label className="rotulo" htmlFor="codigo-barras">
              Linha digitável do boleto
            </label>
            <div className="flex gap-2">
              <input
                id="codigo-barras"
                value={codigoBarras}
                onChange={(e) => setCodigoBarras(e.target.value)}
                className="campo num"
                inputMode="numeric"
                placeholder="Cole os números do boleto — pontos e espaços vão embora"
              />
              {/* No celular, ler é mais rápido e erra menos que digitar 47
                  dígitos. O botão só existe onde o navegador sabe ler. */}
              {leitorDeCodigoSuportado() && (
                <button
                  type="button"
                  onClick={() => setLendo('boleto')}
                  className="btn btn-ferramenta shrink-0"
                  title="Ler o código de barras com a câmera"
                >
                  Ler boleto
                </button>
              )}
            </div>
            <p
              className={`ajuda ${
                codigoBarras && !boletoValido ? 'text-amber-700' : ''
              }`}
            >
              {!codigoBarras
                ? 'Sem o código, a conta chega ao IXC sem como ser paga por boleto.'
                : boletoValido
                  ? `${digitos(codigoBarras).length} dígitos — ok.`
                  : `${digitos(codigoBarras).length} dígitos. O esperado é 44, 47 ou 48 — confira se copiou a linha inteira.`}
            </p>
          </div>
        )}

        {/*
          A chave só aparece no PIX, e é opcional: em branco, vale a do cadastro
          do fornecedor no IXC. O QR de uma cobrança é outra coisa — o "copia e
          cola" dele vale só para aquele pagamento, com valor e beneficiário
          dentro —, e é por isso que ele fica aqui, na conta, e não no cadastro.
        */}
        {ehPix && (
          <div className="sm:col-span-2">
            <label className="rotulo" htmlFor="chave-pix">
              Chave PIX desta conta
            </label>
            <div className="flex gap-2">
              <input
                id="chave-pix"
                value={chavePix}
                onChange={(e) => {
                  setChavePix(e.target.value);
                  if (!e.target.value) setTipoChavePix('');
                }}
                className="campo"
                placeholder="Em branco usa a chave do fornecedor no IXC"
              />
              {leitorDeCodigoSuportado() && (
                <button
                  type="button"
                  onClick={() => setLendo('pix')}
                  className="btn btn-ferramenta shrink-0"
                  title="Ler o QR Code do PIX com a câmera"
                >
                  Ler QR Code
                </button>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select
                value={tipoChavePix}
                onChange={(e) => setTipoChavePix(e.target.value)}
                className="campo max-w-[220px]"
                disabled={!chavePix}
              >
                <option value="">Tipo pelo formato da chave</option>
                {TIPOS_CHAVE_PIX.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              {ehCopiaECola && (
                <span className="text-xs text-emerald-700 dark:text-emerald-300">
                  QR lido: código copia e cola, {chavePix.length} caracteres.
                </span>
              )}
            </div>
            {/* De onde veio a chave que está no campo. Quem confere um
                pagamento precisa saber se ela é do cadastro do fornecedor ou
                se alguém a digitou aqui — são responsabilidades diferentes. */}
            <p className="ajuda">
              {bancoDoFornecedor.isFetching
                ? 'Procurando a chave do fornecedor no IXC…'
                : pixDoCadastro && chavePix.trim() === pixDoCadastro
                  ? 'Chave do cadastro deste fornecedor no IXC. Dá para trocar, e vale só para esta conta.'
                  : pixDoCadastro
                    ? `No cadastro do IXC a chave dele é ${pixDoCadastro} — esta conta vai com a que está acima.`
                    : 'Este fornecedor não tem chave PIX no cadastro do IXC. Escreva a chave aqui, ou cadastre-a lá.'}
            </p>
          </div>
        )}

        {/* Os três curtos numa linha só: eram três alturas de campo para
            preencher meia tela de largura. */}
        <div className="grid grid-cols-1 gap-4 sm:col-span-2 sm:grid-cols-3">
          <div>
            <label className="rotulo" htmlFor="documento">
              Documento
            </label>
            <input
              id="documento"
              value={documento}
              onChange={(e) => setDocumento(e.target.value)}
              className="campo"
              placeholder="opcional"
            />
          </div>

          <div>
            <label className="rotulo" htmlFor="numero-nota">
              Número da nota
            </label>
            <input
              id="numero-nota"
              value={numeroNota}
              onChange={(e) => setNumeroNota(e.target.value)}
              className="campo"
              placeholder="opcional"
            />
          </div>

          <div>
            <label className="rotulo" htmlFor="categoria">
              A que se refere
            </label>
            <SeletorDeCategoria
              id="categoria"
              categorias={categorias.data}
              value={categoriaId}
              vazio="Sem classificação"
              ajuda="Ela entra no cadastro e já fica escolhida para esta despesa."
              carregando={categorias.isLoading}
              onChange={setCategoriaId}
              title="É por esta escolha que o dashboard separa os gastos. Fica guardada aqui — o IXC não tem onde recebê-la."
            />
          </div>
        </div>

        {/* --- Serviço que se repete todo mês --- */}
        {!parcelado && (
          <div className="sm:col-span-2">
            <label
              className="opcao"
              title="Internet, aluguel, contabilidade — a conta de cada mês nasce sozinha no IXC"
            >
              <input
                type="checkbox"
                className="marcador"
                checked={recorrente}
                onChange={(e) => setRecorrente(e.target.checked)}
              />
              Repetir todo mês
            </label>
            {recorrente && (
              <label
                className="opcao ml-6 mt-2"
                title="Vencimento em sábado, domingo ou feriado nacional passa para o próximo dia em que o banco abre"
              >
                <input
                  type="checkbox"
                  className="marcador"
                  checked={soDiasUteis}
                  onChange={(e) => setSoDiasUteis(e.target.checked)}
                />
                Só em dia útil
              </label>
            )}
          </div>
        )}

        {/* --- Parcelamento --- */}
        {!recorrente && (
        <div className="sm:col-span-2">
          <label
            className="opcao"
            title="Uma conta a pagar para cada parcela no IXC"
          >
            <input
              type="checkbox"
              className="marcador"
              checked={parcelado}
              onChange={(e) => {
                setParcelado(e.target.checked);
                if (!e.target.checked) setParcelas([]);
                else if (modoParcela === 'consorcio') refazerConsorcio();
                else refazerParcelas();
              }}
            />
            Lançar em parcelas
          </label>

          {parcelado && (
            <div className="mt-2 rounded-xl border border-tinta-100 p-3">
              {/* Dois jeitos de parcelar, e a diferença é o que se sabe: numa
                  nota sabe-se o total e divide-se; num consórcio sabe-se a
                  parcela e quantas faltam. */}
              <div className="mb-3 flex flex-wrap gap-1.5">
                {(
                  [
                    ['nota', 'Nota parcelada', 'Divide o valor total'],
                    [
                      'consorcio',
                      'Consórcio',
                      'Repete a parcela que falta pagar',
                    ],
                  ] as const
                ).map(([modo, rotulo, nota]) => (
                  <button
                    key={modo}
                    type="button"
                    onClick={() => {
                      setModoParcela(modo);
                      if (modo === 'consorcio') setParcelas(gerarConsorcio());
                      else refazerParcelas();
                    }}
                    title={nota}
                    className={
                      modoParcela === modo
                        ? 'btn btn-p bg-brand-600 text-white'
                        : 'btn btn-p btn-neutro'
                    }
                  >
                    {rotulo}
                  </button>
                ))}
              </div>

              {modoParcela === 'consorcio' ? (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div>
                      <label className="rotulo" htmlFor="total-parcelas">
                        Parcelas no total
                      </label>
                      <input
                        id="total-parcelas"
                        type="number"
                        min={1}
                        max={240}
                        value={totalParcelas}
                        onChange={(e) => setTotalParcelas(e.target.value)}
                        onBlur={refazerConsorcio}
                        className="campo"
                        placeholder="80"
                      />
                    </div>
                    <div>
                      <label className="rotulo" htmlFor="parcelas-pagas">
                        Já pagas
                      </label>
                      <input
                        id="parcelas-pagas"
                        type="number"
                        min={0}
                        value={parcelasPagas}
                        onChange={(e) => setParcelasPagas(e.target.value)}
                        onBlur={refazerConsorcio}
                        className="campo"
                        placeholder="12"
                      />
                    </div>
                    <div>
                      <label className="rotulo" htmlFor="taxa-admin">
                        Taxa de adm. (%)
                      </label>
                      <input
                        id="taxa-admin"
                        type="number"
                        step="0.01"
                        min={0}
                        value={taxaAdmin}
                        onChange={(e) => setTaxaAdmin(e.target.value)}
                        onBlur={refazerConsorcio}
                        className="campo"
                        placeholder="0"
                      />
                    </div>
                    <div>
                      <label className="rotulo" htmlFor="reajuste">
                        Reajuste anual (%)
                      </label>
                      <input
                        id="reajuste"
                        type="number"
                        step="0.01"
                        min={0}
                        value={reajusteAnual}
                        onChange={(e) => setReajusteAnual(e.target.value)}
                        onBlur={refazerConsorcio}
                        className="campo"
                        placeholder="0"
                      />
                    </div>
                  </div>

                  <div className="mt-3">
                    <span className="rotulo">As parcelas vencem</span>
                    <div className="flex flex-wrap gap-1.5">
                      {(
                        [
                          ['mes', 'Todo mês no mesmo dia'],
                          ['dias30', 'A cada 30 dias'],
                        ] as const
                      ).map(([r, rotulo]) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => {
                            setRitmoConsorcio(r);
                            setParcelas(gerarConsorcio(r));
                          }}
                          className={
                            ritmoConsorcio === r
                              ? 'btn btn-p bg-brand-600 text-white'
                              : 'btn btn-p btn-neutro'
                          }
                        >
                          {rotulo}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={refazerConsorcio}
                      className="btn btn-neutro btn-p"
                    >
                      Gerar as que faltam
                    </button>
                    <span className="text-xs text-tinta-400">
                      {faltamDoConsorcio > 0
                        ? `Faltam ${faltamDoConsorcio} de ${totalParcelas || '?'}, a primeira vencendo em ${
                            vencimento ? formatarDia(vencimento) : '—'
                          }.`
                        : 'Informe o total e quantas já foram pagas.'}
                    </span>
                  </div>

                  <p className="ajuda">
                    O valor acima é o da parcela, não o total do consórcio. A
                    taxa de administração entra em cada uma, e o reajuste anual
                    sobe o valor a cada doze parcelas — a tabela abaixo fica
                    editável, porque o que vale é o boleto que o grupo manda.
                  </p>
                </>
              ) : (
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="rotulo" htmlFor="quantas">
                    Parcelas
                  </label>
                  <input
                    id="quantas"
                    type="number"
                    min={1}
                    max={60}
                    value={quantasParcelas}
                    onChange={(e) => {
                      setQuantasParcelas(e.target.value);
                      refazerParcelas(Number(e.target.value) || 0);
                    }}
                    className="campo w-24"
                  />
                </div>
                <div>
                  <span className="rotulo">Vencendo</span>
                  <div className="flex gap-1.5">
                    {([
                      [
                        'mes',
                        vencimento
                          ? `todo dia ${Number(vencimento.slice(8, 10))}`
                          : 'todo mês',
                      ],
                      [15, 'a cada 15 dias'],
                      [30, 'a cada 30 dias'],
                    ] as Array<[RitmoDasParcelas, string]>).map(
                      ([ritmo, rotulo]) => (
                        <button
                          key={String(ritmo)}
                          type="button"
                          onClick={() => {
                            setIntervalo(ritmo);
                            refazerParcelas(undefined, ritmo);
                          }}
                          className={
                            intervalo === ritmo
                              ? 'btn btn-p bg-brand-600 text-white'
                              : 'btn btn-p btn-neutro'
                          }
                        >
                          {rotulo}
                        </button>
                      ),
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => refazerParcelas()}
                  className="btn btn-neutro btn-p"
                  title="Refaz as parcelas a partir do valor total e do primeiro vencimento"
                >
                  Recalcular
                </button>
                <span className="ml-auto text-xs text-tinta-400">
                  A primeira vence em {vencimento ? formatarDia(vencimento) : '—'}
                </span>
              </div>
              )}

              {parcelas.length > 0 && (
                <div className="mt-3 overflow-x-auto rolagem-fina">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th className="th w-16">#</th>
                        <th className="th">Vencimento</th>
                        <th className="th">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parcelas.map((p, i) => (
                        <tr key={i} className="linha">
                          {/* No consórcio a numeração continua de onde o grupo
                              parou: quem já pagou 12 de 80 vê a próxima como
                              13/80, que é o número que vem no boleto. */}
                          <td className="td num whitespace-nowrap text-tinta-400">
                            {modoParcela === 'consorcio'
                              ? `${(Number(parcelasPagas) || 0) + i + 1}/${totalParcelas || '?'}`
                              : i + 1}
                          </td>
                          <td className="td">
                            <input
                              type="date"
                              value={p.vencimento}
                              onChange={(e) =>
                                setParcelas((atual) =>
                                  atual.map((x, j) =>
                                    j === i
                                      ? { ...x, vencimento: e.target.value }
                                      : x,
                                  ),
                                )
                              }
                              className="campo py-1"
                            />
                          </td>
                          <td className="td">
                            <CampoDinheiro
                              valor={p.valor}
                              onChange={(v) =>
                                setParcelas((atual) =>
                                  atual.map((x, j) =>
                                    j === i ? { ...x, valor: v } : x,
                                  ),
                                )
                              }
                              className="campo py-1"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* No consórcio não há "total da nota" com que conferir: o valor
                  digitado é o da parcela. O que interessa saber é quanto ainda
                  falta pagar até o fim do grupo. */}
              {modoParcela === 'consorcio' ? (
                <p className="ajuda">
                  {parcelas.length > 0
                    ? `${parcelas.length} parcela(s) a lançar, somando ${formatBRL(
                        somaDasParcelas,
                      )} até ${formatarDia(parcelas[parcelas.length - 1].vencimento)}.`
                    : 'Nenhuma parcela a lançar ainda.'}
                </p>
              ) : (
                <p className={`ajuda ${diferenca !== 0 ? 'text-amber-700' : ''}`}>
                  {diferenca === 0
                    ? `As ${parcelas.length} parcelas somam ${formatBRL(somaDasParcelas)} — igual ao total da nota.`
                    : `As parcelas somam ${formatBRL(somaDasParcelas)}, ${
                        diferenca > 0 ? 'a mais' : 'a menos'
                      } que o total da nota (${formatBRL(Math.abs(diferenca))} de diferença).`}
                </p>
              )}
            </div>
          )}
        </div>
        )}

        <div className="sm:col-span-2">
          <label className="rotulo" htmlFor="observacao">
            Observação
          </label>
          <textarea
            id="observacao"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            rows={2}
            className="campo"
            title="Vai para o campo de observação do IXC — é o que se lê na lista de contas a pagar de lá"
          />
        </div>

        <div className="sm:col-span-2">
          <CampoDaNota nota={nota} onMudar={setNota} />
        </div>
      </div>

      {lancar.isError && (
        <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {mensagemErro(lancar.error)}
        </p>
      )}

      {avisoDaNota && (
        <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
          {avisoDaNota}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
        {!podeLancar && (
          <span className="mr-auto text-xs text-tinta-400">
            {!fornecedor
              ? 'Escolha o fornecedor para continuar.'
              : !(Number(valor) > 0)
                ? 'Informe o valor.'
                : observacao.trim().length < 3
                  ? 'Escreva a observação (o que é essa conta).'
                  : parcelado && parcelas.length === 0
                    ? modoParcela === 'consorcio'
                      ? 'Diga quantas parcelas são no total e quantas já foram pagas.'
                      : 'Gere as parcelas antes de lançar.'
                    : 'Confira a linha digitável do boleto.'}
          </span>
        )}
        <button onClick={onFechar} className="btn btn-neutro">
          Cancelar
        </button>
        {/*
          Marcada a conta como já paga, o botão vira o de pagar — verde, com o
          nome do que ele de fato faz.

          O lançamento sempre criou, aprovou e baixou de uma vez nesse caso, mas
          o botão continuava dizendo só "Lançar conta": a parte que mexe em
          dinheiro acontecia sem estar escrita em lugar nenhum, e quem quisesse
          pagar ia procurar o pagamento na lista depois — pagando de novo o que
          já tinha saído.
        */}
        <button
          onClick={() => lancar.mutate()}
          disabled={!podeLancar || lancar.isPending}
          className={`btn ${jaPaga ? 'btn-pagar' : 'btn-primario'}`}
        >
          {lancar.isPending
            ? jaPaga
              ? parcelas.length > 1
                ? `Lançando e pagando ${parcelas.length} contas…`
                : 'Lançando e pagando no IXC…'
              : parcelas.length > 1
                ? `Lançando ${parcelas.length} contas no IXC…`
                : 'Lançando no IXC…'
            : jaPaga
              ? parcelado && parcelas.length > 1
                ? `Lançar e pagar ${parcelas.length} contas`
                : 'Lançar e pagar'
              : parcelado && parcelas.length > 1
                ? `Lançar ${parcelas.length} contas`
                : 'Lançar conta'}
        </button>
      </div>

      {/* Cada parcela é uma ida ao IXC, e mais uma para aprovar. Uma dúzia
          passa despercebida; oitenta demoram, e sem aviso parece travado. */}
      {parcelado && parcelas.length > 24 && (
        <p className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          São {parcelas.length} contas para criar no IXC, uma de cada vez —
          costuma levar alguns minutos. Deixe esta tela aberta até o fim; se
          parar no meio, as que já entraram ficam lá e a tela diz em qual parou.
        </p>
      )}

      {fornecedor && (
        <p className="mt-3 text-right text-xs text-tinta-400">
          A conta vai para o IXC agora.{' '}
          <Selo pequeno tom="atencao">
            some com ela só pelo IXC
          </Selo>
        </p>
      )}

      {lendo && (
        <LeitorDeCodigo
          alvo={lendo}
          onLido={(codigo) => {
            if (lendo === 'boleto') {
              setCodigoBarras(codigo);
            } else {
              setChavePix(codigo);
              setTipoChavePix('Código copia e cola');
            }
            setLendo(null);
          }}
          onFechar={() => setLendo(null)}
        />
      )}
    </Janela>
  );
}

/** Só os dígitos: boleto copiado vem com pontos, espaços e a máscara do banco. */
function digitos(valor: string): string {
  return valor.replace(/\D/g, '');
}

/**
 * Soma dias a uma data "AAAA-MM-DD", em UTC.
 *
 * Em UTC porque o horário de verão, em fuso que o tenha, faria "+30 dias" cair
 * uma hora antes e virar o dia anterior — uma parcela vencendo dia 30 em vez de
 * 31 é erro pequeno na tela e grande no caixa.
 */
function somarDias(iso: string, dias: number): string {
  const [ano, mes, dia] = iso.slice(0, 10).split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia + dias));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

/**
 * O mesmo dia do mês que vem, em "AAAA-MM-DD". Dia 31 em mês de 30 cai no
 * último dia dele — pular para o dia 1º do mês seguinte jogaria a conta de
 * janeiro para março.
 */
function mesSeguinte(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split('-').map(Number);
  const ultimoDoProximo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  const d = new Date(Date.UTC(ano, mes, Math.min(dia, ultimoDoProximo)));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

/**
 * O mesmo dia, alguns meses à frente — a conta de um consórcio vence todo dia
 * 10, não a cada 30 dias, e as duas coisas se separam depois de meio ano.
 * Mesmo cuidado com o dia 31 do `mesSeguinte`.
 */
function mesesDepois(iso: string, meses: number): string {
  const [ano, mes, dia] = iso.slice(0, 10).split('-').map(Number);
  const ultimoDoAlvo = new Date(Date.UTC(ano, mes + meses, 0)).getUTCDate();
  const d = new Date(
    Date.UTC(ano, mes - 1 + meses, Math.min(dia, ultimoDoAlvo)),
  );
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

/** "AAAA-MM-DD" → "15/08/2026", sem passar por Date (que escorrega de fuso). */
function formatarDia(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}

/** Hoje em "AAAA-MM-DD", que é o formato do input de data. */
function hoje(): string {
  const agora = new Date();
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const dia = String(agora.getDate()).padStart(2, '0');
  return `${agora.getFullYear()}-${mes}-${dia}`;
}

/**
 * A nota que vai anexada à conta, no IXC.
 *
 * Dois caminhos, porque são dois hábitos: quem tem o arquivo salvo escolhe o
 * arquivo; quem acabou de receber o comprovante no WhatsApp ou no internet
 * banking dá um print e cola aqui — e é esse o caminho que não existia em lugar
 * nenhum, porque colar imagem não é coisa que um `<input type=file>` aceite.
 *
 * O print colado não tem nome: quem nomeia é a API, com a data e a extensão
 * certa. Sem extensão, o anexo do IXC vira um binário que não abre.
 */
function CampoDaNota({
  nota,
  onMudar,
}: {
  nota: { nome: string; dados: string } | null;
  onMudar: (nota: { nome: string; dados: string } | null) => void;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [lendo, setLendo] = useState(false);

  /*
   * O Ctrl+V vale na janela inteira, e não só dentro de um quadrado.
   *
   * Quem copiou o comprovante quer colar; procurar onde clicar antes é um passo
   * que ninguém dá. Só entra imagem — texto colado é texto de campo, e roubá-lo
   * daqui quebraria a digitação normal.
   */
  useEffect(() => {
    async function aoColar(e: ClipboardEvent) {
      const arquivo = [...(e.clipboardData?.files ?? [])].find((f) =>
        f.type.startsWith('image/'),
      );
      if (!arquivo) return;
      e.preventDefault();
      setLendo(true);
      setErro(null);
      try {
        onMudar({ nome: '', dados: await lerComoDataUrl(arquivo) });
      } catch (err) {
        setErro(err instanceof Error ? err.message : String(err));
      } finally {
        setLendo(false);
      }
    }

    window.addEventListener('paste', aoColar);
    return () => window.removeEventListener('paste', aoColar);
  }, [onMudar]);

  async function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = '';
    if (!arquivo) return;
    setLendo(true);
    setErro(null);
    try {
      onMudar({ nome: arquivo.name, dados: await lerComoDataUrl(arquivo) });
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setLendo(false);
    }
  }

  const ehImagem = nota?.dados.startsWith('data:image/');

  return (
    <div>
      <span className="rotulo">Nota</span>
      <div className="flex flex-wrap items-center gap-3">
        <label className="btn btn-p btn-neutro w-fit cursor-pointer">
          {lendo ? 'Lendo…' : nota ? 'Trocar arquivo' : 'Anexar nota'}
          <input
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={escolher}
          />
        </label>

        {nota ? (
          <div className="flex items-center gap-2">
            {ehImagem ? (
              <img
                src={nota.dados}
                alt="Nota anexada"
                className="h-10 w-16 rounded-lg border border-tinta-200 object-cover"
              />
            ) : (
              <span className="rounded-lg border border-tinta-200 px-2 py-1 text-xs text-tinta-600">
                PDF
              </span>
            )}
            <span className="max-w-[220px] truncate text-sm text-tinta-600">
              {nota.nome || 'print colado'}
            </span>
            <button
              type="button"
              onClick={() => onMudar(null)}
              className="text-xs font-semibold text-rose-500 hover:underline"
            >
              tirar
            </button>
          </div>
        ) : (
          <span className="text-xs text-tinta-400">
            ou dê Ctrl+V para colar um print — ele vai como foto
          </span>
        )}
      </div>
      <p className="ajuda">
        Vai anexada ao título no IXC, na aba de arquivos dele. PDF ou imagem,
        até 8 MB. Em lançamento parcelado, a nota vai na primeira parcela.
      </p>
      {erro && <p className="mt-1 text-sm text-rose-600">{erro}</p>}
    </div>
  );
}

/** O arquivo como data URL — é assim que ele chega à API. */
function lerComoDataUrl(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result));
    leitor.onerror = () =>
      reject(new Error('Não consegui ler este arquivo do seu computador.'));
    leitor.readAsDataURL(arquivo);
  });
}
