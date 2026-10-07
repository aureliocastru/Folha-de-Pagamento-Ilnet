import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  LeitorDeCodigo,
  leitorDeCodigoSuportado,
} from '../../components/LeitorDeCodigo';
import { useAssistente } from '../../components/Assistente';
import { SeletorDeCategoria } from '../../components/SeletorDeCategoria';
import { SeletorDeVeiculo } from '../../components/SeletorDeVeiculo';
import {
  CampoDinheiro,
  Carregando,
  FotoAmpliada,
  Janela,
  Selo,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { useTermoAdiado } from '../../lib/busca';
import { formatBRL } from '../../lib/format';
import { prepararArquivo } from '../../lib/foto';
import { CampoDeData } from '../../components/CampoDeData';
import {
  TIPOS_CHAVE_PIX,
  type CategoriaDespesa,
  type ConfigFinanceira,
  type ContaAberta,
} from '../../lib/types';

/**
 * Uma conta que já está no IXC, aberta nesta mesma tela para mudar.
 *
 * Era outra janela, menor, com metade dos campos: quem lançou uma conta com o
 * fornecedor, a emissão ou o número da nota errados não tinha onde corrigir.
 * Agora editar é lançar de novo por cima — a mesma tela, já preenchida.
 */
export interface EdicaoDaConta {
  conta: ContaAberta;
  /** O título cru, como o IXC o devolve. */
  campos: Record<string, unknown>;
  tipoChavePix: string | null;
  /** Lançada por este app: só nela cabe o veículo, que mora aqui. */
  lancadaAqui: boolean;
  veiculoId: string | null;
  /** A conta paga de uma vez: as notas dela. Vazio na comum. */
  notas?: Array<{
    veiculo: string | null;
    categoria: string | null;
    valor: number;
    descricao: string | null;
  }>;
}

/** O que a conta tinha ao abrir, para mandar ao IXC só o que mudou. */
interface ValoresDaConta {
  idFornecedor: number | null;
  valor: number;
  emissao: string;
  vencimento: string;
  observacao: string;
  tipoPagamento: string;
  contaPagamento: string;
  chavePix: string;
  tipoChavePix: string;
  codigoBarras: string;
  categoriaId: string;
  veiculoId: string;
}

function valoresDaConta(e: EdicaoDaConta): ValoresDaConta {
  const texto = (v: unknown) => String(v ?? '').trim();
  return {
    idFornecedor: e.conta.fornecedor.id ?? (Number(texto(e.campos.id_fornecedor)) || null),
    valor: e.conta.valor,
    emissao:
      diaDoIxc(e.campos.data_emissao) || diaDoIxc(e.conta.emissao) || hoje(),
    vencimento: diaDoIxc(e.conta.vencimento) || diaDoIxc(e.campos.data_vencimento) || hoje(),
    observacao: e.conta.observacao ?? texto(e.campos.obs),
    tipoPagamento: texto(e.campos.tipo_pagamento),
    contaPagamento: texto(e.campos.id_contas),
    chavePix: texto(e.campos.chave_pix),
    tipoChavePix: e.tipoChavePix ?? '',
    codigoBarras: texto(e.campos.codigo_barras),
    categoriaId: e.conta.classificacao?.id ?? '',
    veiculoId: e.veiculoId ?? '',
  };
}

/** A data do IXC — "AAAA-MM-DD" ou "DD/MM/AAAA" — no formato do campo. */
function diaDoIxc(v: unknown): string {
  const s = String(v ?? '').trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso && iso[1] !== '0000') return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return '';
}

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

export interface DespesaLancada {
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
  /** As notas da conta paga de uma vez, na ordem em que foram mandadas. */
  partes?: Array<{ id: string }>;
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
export function NovaDespesa({
  onFechar,
  veiculoInicial,
  inicial,
  onLancada,
  edicao,
}: {
  onFechar: () => void;
  /** Lançada de dentro da ficha de um veículo: ele já vem escolhido. */
  veiculoInicial?: { id: string; apelido: string };
  /**
   * Aberta por outra tela, que já sabe quase tudo — a parcela antecipada de um
   * financiamento, por exemplo. O que ela preenche vem pronto; o que ela não
   * tem como saber (o valor do boleto com desconto, a forma de pagar) fica em
   * branco para quem lança.
   */
  inicial?: {
    fornecedor?: { idFornecedor: number; nome: string };
    valor?: string;
    observacao?: string;
    categoriaId?: string | null;
    veiculoId?: string | null;
    tipoPagamento?: string;
    /** "AAAA-MM-DD" */
    vencimento?: string;
  };
  /** A conta nasceu: quem abriu fica sabendo, e com que valor ela saiu. */
  onLancada?: (dados: DespesaLancada, valorLancado: number) => void;
  /** Uma conta que já está no IXC: a tela abre nela e salva por cima. */
  edicao?: EdicaoDaConta;
}) {
  const queryClient = useQueryClient();

  /*
   * O que a conta tinha ao abrir. Anda junto quando se salva: se a nota falhar
   * depois, a segunda tentativa não reenvia ao IXC o que já foi para lá.
   */
  const [original, setOriginal] = useState<ValoresDaConta | null>(() =>
    edicao ? valoresDaConta(edicao) : null,
  );
  const o = original;

  const [termo, setTermo] = useState('');
  const [fornecedor, setFornecedor] = useState<FornecedorIxc | null>(
    edicao
      ? {
          idFornecedor: o!.idFornecedor ?? 0,
          nome: edicao.conta.fornecedor.nome,
          nomeFantasia: null,
          cpfCnpj: null,
        }
      : inicial?.fornecedor
        ? { ...inicial.fornecedor, nomeFantasia: null, cpfCnpj: null }
        : null,
  );
  const [valor, setValor] = useState(o ? String(o.valor) : (inicial?.valor ?? ''));
  const [emissao, setEmissao] = useState(o?.emissao ?? hoje);
  const [vencimento, setVencimento] = useState(
    o?.vencimento ?? inicial?.vencimento ?? hoje,
  );
  const [categoriaId, setCategoriaId] = useState(
    o?.categoriaId ?? inicial?.categoriaId ?? '',
  );
  /**
   * Em qual veículo da frota foi o gasto. Não depende da categoria: ela diz com
   * o que (peça, mão de obra do mecânico), o veículo diz em qual.
   */
  const [veiculoId, setVeiculoId] = useState(
    o?.veiculoId ?? veiculoInicial?.id ?? inicial?.veiculoId ?? '',
  );
  const [tipoPagamento, setTipoPagamento] = useState(
    o?.tipoPagamento ?? inicial?.tipoPagamento ?? '',
  );
  const [observacao, setObservacao] = useState(
    o?.observacao ?? inicial?.observacao ?? '',
  );
  const [codigoBarras, setCodigoBarras] = useState(o?.codigoBarras ?? '');
  const [chavePix, setChavePix] = useState(o?.chavePix ?? '');
  const [tipoChavePix, setTipoChavePix] = useState(o?.tipoChavePix ?? '');
  const [contaPagamento, setContaPagamento] = useState(o?.contaPagamento ?? '');
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
  /** As notas que vão junto: arquivos escolhidos ou prints colados. */
  const [notas, setNotas] = useState<ArquivoDaNota[]>([]);
  /**
   * A conta paga de uma vez com várias notas dentro — a peça da Strada, o pneu
   * da Hilux, o serviço do escritório —, cada uma com a sua categoria e, se for
   * o caso, o seu veículo. Vazia, é a conta de sempre.
   */
  const [divisao, setDivisao] = useState<NotaDaConta[]>([]);
  /** A tela das notas está aberta, no lugar do formulário. */
  const [dividindo, setDividindo] = useState(false);
  const dividida = divisao.length > 0;
  const somaDasNotas = somarNotas(divisao);
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

  const veiculos = useQuery({
    queryKey: ['veiculos', 'ativos'],
    queryFn: async () =>
      (
        await api.get<Array<{ id: string; apelido: string; placa: string | null }>>(
          '/veiculos',
          { params: { ativos: true } },
        )
      ).data,
  });

  // O tipo de pagamento começa no padrão das Configurações e fica editável: a
  // folha sai por PIX, mas a conta de energia costuma ser boleto, e mandar o
  // rótulo errado deixa o pagamento preso no IXC.
  //
  // Na edição, não: a conta sem tipo no IXC continua sem tipo até alguém
  // escolher, e o padrão entrando sozinho viraria uma mudança que ninguém fez.
  useEffect(() => {
    if (config.data && !tipoPagamento && !edicao) {
      setTipoPagamento(config.data.tipoPagamentoPadrao);
    }
  }, [config.data, tipoPagamento, edicao]);

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

  /** Na edição, o fornecedor foi trocado — e a chave do novo passa a valer. */
  const trocouFornecedor =
    !!o && !!fornecedor && fornecedor.idFornecedor !== o.idFornecedor;

  /**
   * Preenche a chave assim que ela chega — mas nunca por cima do que já está
   * escrito. Quem colou um copia-e-cola de cobrança ou leu um QR Code escolheu
   * aquela chave para esta conta; o cadastro do fornecedor é o padrão, não a
   * última palavra.
   *
   * Na edição, só depois de trocar o fornecedor: a conta sem chave no IXC paga
   * pela do cadastro de todo jeito, e preenchê-la sozinho viraria uma mudança
   * que ninguém pediu.
   */
  useEffect(() => {
    if (!pixDoCadastro) return;
    if (edicao && !trocouFornecedor) return;
    setChavePix((atual) => atual || pixDoCadastro);
    const tipo = bancoDoFornecedor.data?.tipoChavePix?.trim();
    if (tipo) setTipoChavePix((atual) => atual || tipo);
  }, [pixDoCadastro, bancoDoFornecedor.data?.tipoChavePix, edicao, trocouFornecedor]);

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

  /**
   * A regra que faz a conta nascer sozinha todo mês, a partir do mês seguinte
   * ao desta: a deste mês é a que está na tela, e registrar a partir do mesmo
   * vencimento faria a rotina gerar hoje mesmo uma segunda conta igual.
   */
  async function registrarRepeticao() {
    await api.post('/recorrentes', {
      idFornecedorIxc: fornecedor!.idFornecedor,
      fornecedorNome: fornecedor!.nome,
      valor: Number(valor),
      observacao: observacao.trim() || fornecedor!.nome,
      proximoVencimento: mesSeguinte(vencimento),
      contaPagamento: contaPagamento ? Number(contaPagamento) : undefined,
      tipoPagamentoIxc: tipoPagamento.trim() || undefined,
      categoriaId: categoriaId || undefined,
      apenasDiasUteis: soDiasUteis,
    });
  }

  /** Na edição, a repetição já criada numa tentativa anterior não se repete. */
  const [repeticaoCriada, setRepeticaoCriada] = useState(false);

  const lancar = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<DespesaLancada>(
        '/contas-abertas/despesa',
        {
          idFornecedorIxc: fornecedor!.idFornecedor,
          fornecedorNome: fornecedor!.nome,
          valor: valorDaConta,
          dataEmissao: emissao,
          dataVencimento: vencimento,
          observacao: observacao.trim(),
          categoriaId: categoriaId || null,
          // Com várias notas, a conta não é de um veículo: cada nota é do seu.
          veiculoId: dividida ? undefined : veiculoId || undefined,
          notas: dividida
            ? divisao.map((n) => ({
                veiculoId: n.veiculoId || undefined,
                categoriaId: n.categoriaId || undefined,
                valor: Number(n.valor),
                descricao: n.descricao.trim() || undefined,
              }))
            : undefined,
          tipoPagamento: tipoPagamento.trim() || undefined,
          codigoBarras: digitos(codigoBarras) || undefined,
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
      if (recorrente) await registrarRepeticao();

      /*
       * A nota sobe depois, e por rota própria.
       *
       * O lançamento é a parte que não dá para refazer — a conta já está no
       * IXC. Se o anexo falhar (arquivo grande, webservice fora), o que se
       * perde é o anexo, e a tela diz isso: a conta continua lançada, e a nota
       * se anexa de novo pelo IXC ou por aqui.
       */
      const idNoIxc = data.conta.idFnApagarIxc;
      const paraSubir = arquivosParaSubir(observacao);
      const avisos: string[] = [];
      if (paraSubir.length > 0 && idNoIxc) {
        const { falhas, motivo } = await subirNotas(idNoIxc, paraSubir);
        if (falhas.length > 0) {
          avisos.push(
            `A conta foi lançada, mas ${contarNotas(falhas.length, paraSubir.length)} ` +
              `não ${falhas.length === 1 ? 'subiu' : 'subiram'}: ${motivo}`,
          );
        }
      }
      /*
       * A foto de cada nota vai para a nota dela, e fica guardada aqui além de
       * subir para o título: com várias no mesmo título, o IXC desta base não
       * as devolve uma por uma.
       */
      const dasNotas = await subirFotosDasNotas(divisao, data.partes ?? [], rotuloDaNota);
      if (dasNotas) avisos.push(dasNotas);
      if (avisos.length) setAvisoDaNota(avisos.join(' '));

      return data;
    },
    onSuccess: (data) => {
      setLancada(data);
      // Quem abriu a tela precisa saber por quanto a conta saiu: numa parcela
      // antecipada, é esse valor — o do boleto com desconto — que fica
      // registrado como o que se pagou por ela.
      onLancada?.(data, Number(valor));
      void queryClient.invalidateQueries({ queryKey: ['contas-abertas'] });
      if (data.baixa) {
        void queryClient.invalidateQueries({ queryKey: ['pagas-no-mes'] });
        void queryClient.invalidateQueries({ queryKey: ['pagamentos-feitos'] });
      }
      void queryClient.invalidateQueries({ queryKey: ['categorias-despesa'] });
      void queryClient.invalidateQueries({ queryKey: ['recorrentes'] });
      void queryClient.invalidateQueries({ queryKey: ['veiculos'] });
    },
  });

  /**
   * Salvar a edição: só o que mudou vai para o IXC.
   *
   * Mandar tudo de volta faria o IXC reprovar e reaprovar a conta por causa de
   * uma edição que não mudou nada. A categoria é nossa e vai por outro
   * caminho; a nota sobe por último, como no lançamento.
   */
  const salvar = useMutation({
    mutationFn: async () => {
      const id = edicao!.conta.idFnApagar;
      const antes = original!;
      const tipoChave = ehCopiaECola ? 'Código copia e cola' : tipoChavePix;
      const depois: ValoresDaConta = {
        idFornecedor: fornecedor?.idFornecedor ?? antes.idFornecedor,
        valor: Number(valor),
        emissao,
        vencimento,
        observacao: observacao.trim(),
        tipoPagamento,
        contaPagamento,
        chavePix: chavePix.trim(),
        tipoChavePix: tipoChave,
        codigoBarras: digitos(codigoBarras),
        categoriaId,
        veiculoId,
      };

      const mudancas: Record<string, unknown> = {};
      if (depois.idFornecedor !== antes.idFornecedor) {
        mudancas.idFornecedor = depois.idFornecedor;
      }
      if (depois.valor !== antes.valor) mudancas.valor = depois.valor;
      if (depois.emissao !== antes.emissao) mudancas.dataEmissao = depois.emissao;
      if (depois.vencimento !== antes.vencimento) {
        mudancas.dataVencimento = depois.vencimento;
      }
      if (depois.observacao !== antes.observacao.trim()) {
        mudancas.observacao = depois.observacao;
      }
      if (depois.tipoPagamento && depois.tipoPagamento !== antes.tipoPagamento) {
        mudancas.tipoPagamento = depois.tipoPagamento;
      }
      if (depois.contaPagamento !== antes.contaPagamento) {
        // "Padrão" é a conta das Configurações — no IXC não existe padrão.
        const conta = depois.contaPagamento
          ? Number(depois.contaPagamento)
          : config.data?.contaPagamentoId;
        if (conta) mudancas.contaPagamento = conta;
      }
      if (depois.chavePix !== antes.chavePix) mudancas.chavePix = depois.chavePix;
      if (depois.tipoChavePix && depois.tipoChavePix !== antes.tipoChavePix) {
        mudancas.tipoChavePix = depois.tipoChavePix;
      }
      if (depois.codigoBarras !== digitos(antes.codigoBarras)) {
        mudancas.codigoBarras = depois.codigoBarras;
      }
      if (depois.veiculoId !== antes.veiculoId) {
        mudancas.veiculoId = depois.veiculoId || null;
      }

      if (Object.keys(mudancas).length > 0) {
        await api.patch(`/contas-abertas/${id}`, mudancas);
      }
      if (depois.categoriaId !== antes.categoriaId) {
        await api.put(`/contas-abertas/${id}/categoria`, {
          categoriaId: depois.categoriaId || null,
        });
      }
      setOriginal(depois);
      if (recorrente && !repeticaoCriada) {
        await registrarRepeticao();
        setRepeticaoCriada(true);
      }

      if (notas.length > 0) {
        const { falhas, motivo } = await subirNotas(id, arquivosParaSubir(depois.observacao));
        // Ficam só as que não subiram: salvar de novo não repete as outras no
        // IXC.
        setNotas(falhas);
        if (falhas.length > 0) {
          setAvisoDaNota(
            `A conta foi salva, mas ${contarNotas(falhas.length, notas.length)} ` +
              `não ${falhas.length === 1 ? 'subiu' : 'subiram'}: ${motivo}`,
          );
          return false;
        }
      }
      return true;
    },
    onSuccess: (tudoCerto) => {
      void queryClient.invalidateQueries({ queryKey: ['contas-abertas'] });
      void queryClient.invalidateQueries({ queryKey: ['categorias-despesa'] });
      void queryClient.invalidateQueries({ queryKey: ['veiculos'] });
      void queryClient.invalidateQueries({ queryKey: ['recorrentes'] });
      if (tudoCerto) onFechar();
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

  /** O valor da conta: o digitado, ou a soma das notas quando ela tem várias. */
  const valorDaConta = dividida ? somaDasNotas : Number(valor) || 0;

  /*
   * Várias notas num pagamento só vale para qualquer conta — a oficina, a
   * papelaria, o fornecedor que manda três notas e cobra junto. Só não cabe
   * na parcelada nem na que se repete: as duas são outra divisão do dinheiro.
   */
  const podeDividir = !edicao && !parcelado && !recorrente;

  function abrirDivisao() {
    if (divisao.length === 0) {
      // A primeira nota começa com o que já estava no formulário — inclusive a
      // foto, que agora é dela.
      setDivisao([
        novaNotaDaConta({
          categoriaId,
          veiculoId,
          valor: Number(valor) > 0 ? valor : '',
          notas,
        }),
      ]);
      setNotas([]);
    }
    setDividindo(true);
  }

  /** "Strada · Manutenção — troca de óleo": o nome da nota no IXC e na tela. */
  function rotuloDaNota(n: NotaDaConta): string {
    const apelido = veiculos.data?.find((v) => v.id === n.veiculoId)?.apelido;
    const categoria = categorias.data?.find((c) => c.id === n.categoriaId)?.nome;
    return [[apelido, categoria].filter(Boolean).join(' · '), n.descricao.trim()]
      .filter(Boolean)
      .join(' — ')
      .slice(0, 80) || observacao.trim().slice(0, 80) || 'Nota';
  }

  const podeLancar =
    !!fornecedor &&
    valorDaConta > 0 &&
    (!dividida || notasCompletas(divisao)) &&
    // Na edição não se exige: conta lançada no IXC sem observação continua
    // podendo ser corrigida no que ela tem de errado.
    (!!edicao || observacao.trim().length >= 3) &&
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

  /*
   * No celular, uma pergunta por vez — e a revisão no fim.
   *
   * São quinze campos: na tela de bolso eles viravam uma parede em que se
   * rolava procurando o que faltava, com o botão de lançar a seis rolagens de
   * distância. No computador nada muda (ver `useAssistente`).
   */
  const a = useAssistente([
    {
      rotulo: 'Quem recebe',
      resumo: fornecedor?.nome,
      falta: fornecedor ? undefined : 'Escolha o fornecedor.',
    },
    {
      rotulo: 'Valor e vencimento',
      resumo: [
        valorDaConta > 0 ? formatBRL(valorDaConta) : null,
        `vence ${formatarDia(vencimento)}`,
      ]
        .filter(Boolean)
        .join(' · '),
      falta: valorDaConta > 0 ? undefined : 'Digite o valor.',
    },
    {
      rotulo: 'O que é esta conta',
      resumo: observacao.trim() || undefined,
      falta:
        edicao || observacao.trim().length >= 3
          ? undefined
          : 'Escreva o que é esta conta — é o que se lê na lista do IXC.',
    },
    {
      rotulo: 'Pagamento',
      resumo: [
        tipoPagamento || null,
        jaPaga ? 'já foi paga' : null,
        ehBoleto && codigoBarras ? 'boleto preenchido' : null,
        ehPix && chavePix ? 'chave PIX desta conta' : null,
      ]
        .filter(Boolean)
        .join(' · '),
    },
    {
      rotulo: 'Classificação',
      resumo: [
        categoriaId ? 'categoria marcada' : null,
        dividida
          ? `${divisao.length} nota${divisao.length > 1 ? 's' : ''}`
          : veiculoId
            ? 'veículo marcado'
            : null,
      ]
        .filter(Boolean)
        .join(' · ') || undefined,
    },
    {
      rotulo: 'Repetir ou parcelar',
      resumo: recorrente
        ? 'repete todo mês'
        : parcelado
          ? `${parcelas.length} parcela(s)`
          : 'uma conta só',
    },
    {
      rotulo: 'Notas',
      resumo: notas.length
        ? `${notas.length} arquivo${notas.length > 1 ? 's' : ''}`
        : undefined,
    },
  ]);

  /** O título de cada coluna — só no computador: no celular o passo já tem o seu. */
  const tituloDaColuna = (texto: string) =>
    a.celular ? null : <p className="eyebrow mb-3">{texto}</p>;

  /**
   * Os arquivos que sobem com a conta pelo título, cada um com o nome que a
   * aba de arquivos do IXC vai mostrar. As fotos das várias notas não passam
   * por aqui: vão pela nota de cada uma (ver `subirFotosDasNotas`).
   */
  function arquivosParaSubir(textoDaConta: string): NotaParaSubir[] {
    const base = textoDaConta.trim().slice(0, 80) || 'Nota';
    return notas.map((n) => ({ ...n, descricao: base }));
  }

  if (dividindo) {
    return (
      <Janela titulo="Várias notas, um pagamento" onFechar={() => setDividindo(false)} larga>
        <TelaDasNotas
          notas={divisao}
          onMudar={setDivisao}
          veiculos={veiculos.data ?? []}
          carregandoVeiculos={veiculos.isLoading}
          categorias={categorias.data}
          carregandoCategorias={categorias.isLoading}
          categoriaDaConta={categoriaId}
          fornecedor={fornecedor?.nome ?? null}
          onPronto={() => {
            setValor(somaDasNotas.toFixed(2));
            setVeiculoId('');
            setDividindo(false);
          }}
          onDesfazer={() => {
            // As fotos voltam para a conta: elas foram tiradas para ela.
            setNotas((atuais) => [...atuais, ...divisao.flatMap((n) => n.notas)]);
            setDivisao([]);
            setDividindo(false);
          }}
        />
      </Janela>
    );
  }

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
    <Janela
      titulo={edicao ? 'Editar conta a pagar' : 'Lançar conta a pagar'}
      onFechar={onFechar}
      larga
    >
      {a.cabecalho}

      {/*
        Duas colunas no computador: a conta à esquerda, o pagamento à
        direita — tudo numa tela, sem rolar. No celular é um passo por vez,
        na mesma ordem.
      */}
      <div className="grid grid-cols-1 gap-x-8 lg:grid-cols-2">
        <div>
          {tituloDaColuna('A conta')}
          {/* --- Fornecedor --- */}
          {a.mostrar(0) && (
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
                {/* `autoComplete="off"`: o navegador guardava o que já se digitou
                    aqui e oferecia a lista dele por cima da nossa — um retângulo
                    preto com "posto sao d", "posto sao domi" tapando justamente os
                    fornecedores do IXC, que são o que se veio escolher. */}
                <input
                  id="fornecedor"
                  value={termo}
                  onChange={(e) => setTermo(e.target.value)}
                  placeholder="Nome, nome fantasia ou CPF/CNPJ"
                  className="campo"
                  autoComplete="off"
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
          )}
          {a.mostrar(1) && (
            <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="rotulo" htmlFor="valor">
                  {parcelado && modoParcela === 'consorcio'
                    ? 'Valor da parcela'
                    : 'Valor'}
                </label>
                {dividida || edicao?.notas?.length ? (
                  <button
                    type="button"
                    onClick={() => dividida && setDividindo(true)}
                    className="campo text-left"
                    title="A soma das notas desta conta"
                  >
                    {formatBRL(valorDaConta)}
                  </button>
                ) : (
                  <CampoDinheiro valor={valor} onChange={setValor} placeholder="0,00" />
                )}
              </div>
              <div>
                <label className="rotulo" htmlFor="vencimento">
                  Vencimento
                </label>
                <CampoDeData
                  id="vencimento"
                  valor={vencimento}
                  onChange={setVencimento}
                  className="campo"
                />
                {vencimento < emissao && (
                  <p className="ajuda text-amber-700">
                    O vencimento está antes da emissão — confira se é isso mesmo.
                  </p>
                )}
              </div>
              <div>
                <label className="rotulo" htmlFor="emissao">
                  Emissão
                </label>
                <CampoDeData
                  id="emissao"
                  valor={emissao}
                  onChange={setEmissao}
                  className="campo"
                />
              </div>
            </div>
          )}
          {/* O fornecedor mandou várias notas e cobra tudo junto: um
              pagamento só, e cada nota com a sua categoria. */}
          {a.mostrar(1) && podeDividir && !dividida && (
            <button
              type="button"
              onClick={abrirDivisao}
              className="btn btn-p btn-ferramenta -mt-2 mb-4"
            >
              Várias notas, um pagamento
            </button>
          )}
          {a.mostrar(2) && (
            <div className="mb-4">
              <label className="rotulo" htmlFor="observacao">
                O que é esta conta
              </label>
              <textarea
                id="observacao"
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                rows={2}
                placeholder="Ex.: troca de óleo do Strada, internet de outubro"
                className="campo"
                title="Vai para o campo de observação do IXC — é o que se lê na lista de contas a pagar de lá"
              />
            </div>
          )}
          {a.mostrar(6) && !dividida && (
            <div>
              <CampoDaNota notas={notas} onMudar={setNotas} parcelado={parcelado} />
            </div>
          )}
        </div>
        <div className="lg:border-l lg:border-tinta-200 lg:pl-8">
          {tituloDaColuna('O pagamento')}
          {a.mostrar(3) && (
            <div className="mb-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                    {/* Conta que chegou ao IXC sem tipo continua sem tipo até alguém
                        escolher — e o tipo que está lá entra na lista mesmo se a tela
                        não o conhece, senão a edição o trocaria sem ninguém pedir. */}
                    {edicao && !o?.tipoPagamento && (
                      <option value="">sem tipo definido</option>
                    )}
                    {TIPOS_DE_PAGAMENTO.map((t) => (
                      <option key={t.valor} value={t.valor}>
                        {t.rotulo}
                      </option>
                    ))}
                    {o?.tipoPagamento &&
                      !TIPOS_DE_PAGAMENTO.some((t) => t.valor === o.tipoPagamento) && (
                        <option value={o.tipoPagamento}>{o.tipoPagamento}</option>
                      )}
                  </select>
                </div>
                <div>
                  <label className="rotulo" htmlFor="conta-pagamento">
                    Conta de pagamento
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
                  {/* Na edição, pagar é o botão "Pagar" da lista — é ele que sabe
                      baixar uma conta que já existe. */}
                  {!edicao && (
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
                  )}
                  {jaPaga && (
                    <div className="mt-2">
                      <label className="rotulo" htmlFor="data-pagamento">
                        Dia em que saiu
                      </label>
                      <CampoDeData
                        id="data-pagamento"
                        valor={dataPagamento}
                        onChange={datarComoPaga}
                        className="campo"
                        title="Vale também como emissão e vencimento"
                      />
                    </div>
                  )}
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
                        autoComplete="off"
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
                    <div className="flex flex-wrap gap-2">
                      <input
                        id="chave-pix"
                        value={chavePix}
                        onChange={(e) => {
                          setChavePix(e.target.value);
                          if (!e.target.value) setTipoChavePix('');
                        }}
                        // `min-w-0`: num flex o input não encolhe abaixo do tamanho
                        // do placeholder, e era ele que empurrava a janela para o lado.
                        className="campo min-w-0 flex-1 basis-56"
                        placeholder="Em branco usa a chave do fornecedor no IXC"
                        autoComplete="off"
                      />
                      {/* O tipo só aparece com chave escrita: vazio, ele era uma
                          linha inteira de campo desabilitado. Copia e cola lido do
                          QR já sabe o que é, e não pergunta. */}
                      {chavePix && !ehCopiaECola && (
                        <select
                          value={tipoChavePix}
                          onChange={(e) => setTipoChavePix(e.target.value)}
                          className="campo w-auto shrink-0"
                          aria-label="Tipo da chave PIX"
                        >
                          <option value="">Tipo pelo formato</option>
                          {TIPOS_CHAVE_PIX.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      )}
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
                    {ehCopiaECola && (
                      <p className="ajuda text-emerald-700 dark:text-emerald-300">
                        QR lido: código copia e cola, {chavePix.length} caracteres.
                      </p>
                    )}
                    {/* De onde veio a chave que está no campo. Quem confere um
                        pagamento precisa saber se ela é do cadastro do fornecedor ou
                        se alguém a digitou aqui — são responsabilidades diferentes. */}
                    <p className="ajuda">
                      {bancoDoFornecedor.isFetching
                        ? 'Procurando a chave do fornecedor no IXC…'
                        : pixDoCadastro && chavePix.trim() === pixDoCadastro
                          ? 'Chave do cadastro no IXC — trocar aqui vale só para esta conta.'
                          : pixDoCadastro
                            ? `No cadastro do IXC é ${pixDoCadastro}; esta conta vai com a de cima.`
                            : 'Sem chave PIX no cadastro do IXC: escreva aqui ou cadastre lá.'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
          {a.mostrar(4) && (
            <div className="mb-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="rotulo" htmlFor="categoria">
                    A que se refere
                  </label>
                  <SeletorDeCategoria
                    id="categoria"
                    categorias={categorias.data}
                    value={categoriaId}
                    vazio="Sem classificação"
                    carregando={categorias.isLoading}
                    onChange={setCategoriaId}
                    title="É por esta escolha que o dashboard separa os gastos. Fica guardada aqui — o IXC não tem onde recebê-la."
                  />
                </div>
                {dividida ? (
                  <div>
                    <span className="rotulo">Notas da conta</span>
                    <button
                      type="button"
                      onClick={() => setDividindo(true)}
                      className="campo flex items-center justify-between gap-2 text-left"
                    >
                      <span className="truncate">
                        {divisao.length} nota{divisao.length > 1 ? 's' : ''} ·{' '}
                        {formatBRL(somaDasNotas)}
                      </span>
                      <span className="shrink-0 text-xs font-semibold text-brand-600 dark:text-brand-300">
                        Ver notas
                      </span>
                    </button>
                  </div>
                ) : edicao?.notas?.length ? (
                  <div>
                    <span className="rotulo">Notas da conta</span>
                    <ul className="space-y-1 text-sm text-tinta-700">
                      {edicao.notas.map((p, i) => (
                        <li key={i} className="flex justify-between gap-2">
                          <span className="truncate">
                            {[[p.veiculo, p.categoria].filter(Boolean).join(' · '), p.descricao]
                              .filter(Boolean)
                              .join(' — ') || `Nota ${i + 1}`}
                          </span>
                          <span className="valor shrink-0">{formatBRL(p.valor)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : /* Só aparece quando há frota cadastrada — ou quando a conta
                       nasceu dentro de um veículo, e aí ele já vem marcado. */
                (edicao
                  ? edicao.lancadaAqui
                  : veiculoInicial || (veiculos.data?.length ?? 0) > 0) && (
                  <div>
                    <label className="rotulo" htmlFor="veiculo">
                      Veículo da frota
                    </label>
                    <SeletorDeVeiculo
                      id="veiculo"
                      value={veiculoId}
                      onChange={setVeiculoId}
                      carregando={veiculos.isLoading}
                      veiculos={[
                        ...(veiculos.data ?? []),
                        // O veículo de onde a conta nasceu, mesmo fora da lista de ativos.
                        ...(veiculoInicial && !veiculos.data?.some((v) => v.id === veiculoInicial.id)
                          ? [{ ...veiculoInicial, placa: null }]
                          : []),
                      ]}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
          {a.mostrar(5) && (
            <div className="mb-4 flex flex-wrap gap-x-6 gap-y-2">
              {/* --- Serviço que se repete todo mês --- */}
              {!parcelado && (
                <div className="min-w-0 flex-1">
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
              {!edicao && !recorrente && (
              <div className="min-w-0 flex-1">
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
                                  <CampoDeData
                                    valor={p.vencimento}
                                    onChange={(valorNovo) => setParcelas((atual) =>
                                        atual.map((x, j) =>
                                          j === i
                                            ? { ...x, vencimento: valorNovo }
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
            </div>
          )}
        </div>
      </div>

      {/* A revisão do celular: cada passo, o que ficou nele, e o caminho de
          volta para corrigir. */}
      {a.resumo}
      {a.barra}

      {lancar.isError && (
        <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {mensagemErro(lancar.error)}
        </p>
      )}
      {salvar.isError && (
        <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {mensagemErro(salvar.error)}
        </p>
      )}

      {avisoDaNota && (
        <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
          {avisoDaNota}
        </p>
      )}

      {a.mostrarAcao && (
      <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
        {!podeLancar && (
          <span className="mr-auto text-xs text-tinta-400">
            {!fornecedor
              ? 'Escolha o fornecedor para continuar.'
              : !(valorDaConta > 0)
                ? 'Informe o valor.'
                : !edicao && observacao.trim().length < 3
                  ? 'Escreva o que é esta conta.'
                  : parcelado && parcelas.length === 0
                    ? modoParcela === 'consorcio'
                      ? 'Diga quantas parcelas são no total e quantas já foram pagas.'
                      : 'Gere as parcelas antes de lançar.'
                    : 'Confira a linha digitável do boleto.'}
          </span>
        )}
        {podeLancar && !edicao && (
          <span className="mr-auto text-xs text-tinta-400">
            A conta vai para o IXC agora.{' '}
            <Selo pequeno tom="atencao">
              some com ela só pelo IXC
            </Selo>
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
        {edicao ? (
          <button
            onClick={() => salvar.mutate()}
            disabled={!podeLancar || salvar.isPending}
            className="btn btn-primario"
          >
            {salvar.isPending ? 'Salvando no IXC…' : 'Salvar no IXC'}
          </button>
        ) : (
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
        )}
      </div>
      )}

      {/* Cada parcela é uma ida ao IXC, e mais uma para aprovar. Uma dúzia
          passa despercebida; oitenta demoram, e sem aviso parece travado. */}
      {parcelado && parcelas.length > 24 && (
        <p className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          São {parcelas.length} contas para criar no IXC, uma de cada vez —
          costuma levar alguns minutos. Deixe esta tela aberta até o fim; se
          parar no meio, as que já entraram ficam lá e a tela diz em qual parou.
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

/** Um arquivo de nota, já lido, esperando a conta existir no IXC. */
interface ArquivoDaNota {
  /** Vazio no print colado: quem nomeia é a API. */
  nome: string;
  dados: string;
}

/** Um arquivo com o nome que a aba de arquivos do IXC vai mostrar. */
type NotaParaSubir = ArquivoDaNota & { descricao: string };

/** Uma das notas de uma conta paga de uma vez. */
interface NotaDaConta {
  /** Só para a lista da tela saber quem é quem enquanto se edita. */
  chave: string;
  /** Com o que se gastou nesta nota. Vazia, vale a categoria da conta. */
  categoriaId: string;
  /** O veículo desta nota, quando ela é de um. */
  veiculoId: string;
  /** Valor canônico: "120.00", ou "" quando vazio. */
  valor: string;
  /** O que foi: "troca de óleo", "manutenção do ar". */
  descricao: string;
  /** A foto ou o PDF desta nota. */
  notas: ArquivoDaNota[];
}

let sequenciaDasNotas = 0;

function novaNotaDaConta(
  inicio: Partial<Omit<NotaDaConta, 'chave'>> = {},
): NotaDaConta {
  sequenciaDasNotas += 1;
  return {
    chave: `nota-${sequenciaDasNotas}`,
    categoriaId: inicio.categoriaId ?? '',
    veiculoId: inicio.veiculoId ?? '',
    valor: inicio.valor ?? '',
    descricao: inicio.descricao ?? '',
    notas: inicio.notas ?? [],
  };
}

function somarNotas(notas: NotaDaConta[]): number {
  return Math.round(notas.reduce((t, n) => t + (Number(n.valor) || 0), 0) * 100) / 100;
}

/** Toda nota com valor: é o que a divisão precisa para fechar. */
function notasCompletas(notas: NotaDaConta[]): boolean {
  return notas.length > 0 && notas.every((n) => Number(n.valor) > 0);
}

/**
 * Manda a foto de cada nota para a nota dela.
 *
 * Fica guardada aqui e sobe para o título no IXC — é a cópia daqui que abre,
 * na ficha do veículo e na conta. A que falha não para as outras. Devolve o
 * aviso, quando houve o que avisar.
 */
async function subirFotosDasNotas(
  notas: NotaDaConta[],
  partes: Array<{ id: string }>,
  rotulo: (n: NotaDaConta) => string,
): Promise<string | null> {
  const total = notas.reduce((t, n) => t + n.notas.length, 0);
  if (total === 0) return null;
  if (partes.length !== notas.length) {
    return 'A conta foi lançada, mas as fotos das notas não subiram: a divisão não ficou gravada.';
  }

  let falharam = 0;
  let motivo = '';
  for (const [i, nota] of notas.entries()) {
    for (const arquivo of nota.notas) {
      try {
        const { data } = await api.post<{ aviso: string | null }>(
          `/contas-abertas/partes/${partes[i].id}/nota`,
          { arquivo: arquivo.dados, nome: arquivo.nome, descricao: rotulo(nota) },
        );
        if (data.aviso) motivo ||= data.aviso;
      } catch (err) {
        falharam += 1;
        motivo ||= mensagemErro(err);
      }
    }
  }
  if (falharam > 0) {
    return `A conta foi lançada, mas ${contarNotas(falharam, total)} não ${
      falharam === 1 ? 'subiu' : 'subiram'
    }: ${motivo}`;
  }
  return motivo || null;
}

/**
 * As notas de uma conta paga de uma vez, cada uma com o que ela é.
 *
 * O fornecedor manda várias notas e cobra tudo junto: a peça da Strada, o
 * pneu da Hilux, o serviço do escritório. Aqui se lança nota por nota — a
 * categoria, o veículo se for de um, o que foi, quanto e a foto —, e na volta
 * ao formulário a conta vale a soma: um título só no IXC, um pagamento, e cada
 * nota contando na categoria dela e na ficha do seu veículo.
 */
function TelaDasNotas({
  notas,
  onMudar,
  veiculos,
  carregandoVeiculos,
  categorias,
  carregandoCategorias,
  categoriaDaConta,
  fornecedor,
  onPronto,
  onDesfazer,
}: {
  notas: NotaDaConta[];
  onMudar: (notas: NotaDaConta[]) => void;
  veiculos: Array<{ id: string; apelido: string; placa: string | null }>;
  carregandoVeiculos: boolean;
  categorias: CategoriaDespesa[] | undefined;
  carregandoCategorias: boolean;
  /** A categoria escolhida no formulário: é com ela que a nota nova começa. */
  categoriaDaConta: string;
  fornecedor: string | null;
  onPronto: () => void;
  onDesfazer: () => void;
}) {
  const soma = somarNotas(notas);
  const completas = notasCompletas(notas);
  const temFrota = veiculos.length > 0;
  const mudar = (chave: string, parte: Partial<NotaDaConta>) =>
    onMudar(notas.map((n) => (n.chave === chave ? { ...n, ...parte } : n)));

  return (
    <div>
      <div className="space-y-3">
        {notas.map((n, i) => (
          <div
            key={n.chave}
            className={`grid grid-cols-1 gap-3 rounded-xl border border-tinta-200 p-3 lg:items-start ${
              temFrota
                ? 'lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_8.5rem_minmax(0,1.2fr)_auto]'
                : 'lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_8.5rem_minmax(0,1.2fr)_auto]'
            }`}
          >
            <div>
              <label className="rotulo" htmlFor={`categoria-${n.chave}`}>
                {notas.length > 1 ? `Nota ${i + 1} · categoria` : 'Categoria'}
              </label>
              <SeletorDeCategoria
                id={`categoria-${n.chave}`}
                categorias={categorias}
                value={n.categoriaId}
                vazio="A da conta"
                carregando={carregandoCategorias}
                onChange={(categoriaId) => mudar(n.chave, { categoriaId })}
              />
            </div>
            {temFrota && (
              <div>
                <label className="rotulo" htmlFor={`veiculo-${n.chave}`}>
                  Veículo
                </label>
                <SeletorDeVeiculo
                  id={`veiculo-${n.chave}`}
                  value={n.veiculoId}
                  onChange={(veiculoId) => mudar(n.chave, { veiculoId })}
                  carregando={carregandoVeiculos}
                  veiculos={veiculos}
                  vazio="Nenhum"
                />
              </div>
            )}
            <div>
              <label className="rotulo" htmlFor={`oque-${n.chave}`}>
                O que foi
              </label>
              <input
                id={`oque-${n.chave}`}
                value={n.descricao}
                onChange={(e) => mudar(n.chave, { descricao: e.target.value.slice(0, 200) })}
                className="campo"
                placeholder="Ex.: troca de óleo"
                autoComplete="off"
              />
            </div>
            <div>
              <label className="rotulo" htmlFor={`valor-${n.chave}`}>
                Valor
              </label>
              <CampoDinheiro
                id={`valor-${n.chave}`}
                valor={n.valor}
                onChange={(valor) => mudar(n.chave, { valor })}
                placeholder="0,00"
              />
            </div>
            <CampoDaNota
              notas={n.notas}
              onMudar={(arquivos) => mudar(n.chave, { notas: arquivos })}
              colar={false}
              rotulo="Foto"
            />
            {notas.length > 1 && (
              <button
                type="button"
                onClick={() => onMudar(notas.filter((x) => x.chave !== n.chave))}
                className="btn btn-sutil btn-p self-end text-rose-600 lg:mt-6"
              >
                Tirar
              </button>
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() =>
          onMudar([...notas, novaNotaDaConta({ categoriaId: categoriaDaConta })])
        }
        className="btn btn-neutro btn-p mt-3"
      >
        + Outra nota
      </button>

      <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-tinta-200 pt-4">
        <span className="mr-auto text-sm text-tinta-600">
          {notas.length} nota{notas.length > 1 ? 's' : ''} ·{' '}
          <strong className="valor">{formatBRL(soma)}</strong>
          {fornecedor ? ` num pagamento só para ${fornecedor}` : ' num pagamento só'}
        </span>
        <button type="button" onClick={onDesfazer} className="btn btn-sutil">
          Não dividir
        </button>
        <button
          type="button"
          onClick={onPronto}
          disabled={!completas}
          className="btn btn-primario"
          title={completas ? undefined : 'Cada nota precisa do valor.'}
        >
          Pronto
        </button>
      </div>
      {!completas && <p className="ajuda text-right">Cada nota precisa do valor.</p>}
    </div>
  );
}

/** No máximo tantos por conta: cada um é uma ida ao webservice do IXC. */
const NOTAS_POR_CONTA = 10;

/**
 * Sobe as notas ao título, uma a uma.
 *
 * Uma a uma, e a que falha não para as outras: quem anexou a nota e o
 * comprovante quer os dois lá, e se um falhar quer o outro guardado. Volta o
 * que não subiu, para a tela dizer e tentar de novo só aquilo.
 */
async function subirNotas(
  idFnApagar: number,
  notas: NotaParaSubir[],
): Promise<{ falhas: NotaParaSubir[]; motivo: string }> {
  const falhas: NotaParaSubir[] = [];
  let motivo = '';
  for (const [i, nota] of notas.entries()) {
    try {
      await api.post(`/contas-abertas/${idFnApagar}/nota`, {
        arquivo: nota.dados,
        nome: nota.nome,
        // Na aba de arquivos do IXC elas aparecem pela descrição: com várias,
        // cada uma com o seu número.
        descricao:
          notas.length > 1 ? `${nota.descricao} (${i + 1} de ${notas.length})` : nota.descricao,
      });
    } catch (err) {
      falhas.push(nota);
      motivo ||= mensagemErro(err);
    }
  }
  return { falhas, motivo };
}

function contarNotas(falharam: number, total: number): string {
  if (total === 1) return 'a nota';
  return falharam === total ? 'as notas' : `${falharam} das ${total} notas`;
}

/**
 * As notas que vão anexadas à conta, no IXC.
 *
 * Dois caminhos, porque são dois hábitos: quem tem o arquivo salvo escolhe o
 * arquivo; quem acabou de receber o comprovante no WhatsApp ou no internet
 * banking dá um print e cola aqui — e é esse o caminho que não existia em lugar
 * nenhum, porque colar imagem não é coisa que um `<input type=file>` aceite.
 *
 * Mais de uma: a nota e o comprovante do pagamento, a nota de duas páginas, o
 * cupom e a foto da peça. Escolher vários de uma vez ou colar um print depois
 * do outro — tudo vai somando.
 *
 * O print colado não tem nome: quem nomeia é a API, com a data e a extensão
 * certa. Sem extensão, o anexo do IXC vira um binário que não abre.
 */
function CampoDaNota({
  notas,
  onMudar,
  parcelado = false,
  colar = true,
  rotulo = 'Notas',
}: {
  notas: ArquivoDaNota[];
  onMudar: (notas: ArquivoDaNota[]) => void;
  /** Em conta parcelada as notas vão na primeira parcela, e a tela diz isso. */
  parcelado?: boolean;
  /**
   * Escuta o Ctrl+V da janela. Só um campo por tela pode: com as notas de cada
   * veículo abertas, o print colado iria para todas ao mesmo tempo.
   */
  colar?: boolean;
  rotulo?: string;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [lendo, setLendo] = useState(false);
  /** Qual foto está aberta em tela cheia, para ver se saiu legível. */
  const [vendo, setVendo] = useState<number | null>(null);
  const cheia = notas.length >= NOTAS_POR_CONTA;

  /*
   * As notas de agora e o `onMudar`, lidos depois da espera: enquanto uma foto
   * é reduzida, outra pode ter sido colada ou tirada.
   */
  const atual = useRef({ notas, onMudar });
  atual.current = { notas, onMudar };

  async function somar(arquivos: File[], nomear: boolean) {
    const cabem = NOTAS_POR_CONTA - atual.current.notas.length;
    if (arquivos.length === 0 || cabem <= 0) return;
    setLendo(true);
    setErro(null);
    try {
      // A foto da câmera passa dos 8 MB e o HEIC do iPhone não abre no
      // computador: as duas saem daqui em JPEG. PDF vai como veio.
      const prontas = await Promise.all(
        arquivos.slice(0, cabem).map(prepararArquivo),
      );
      const novas = prontas.map((p) => (nomear ? p : { ...p, nome: '' }));
      atual.current.onMudar([...atual.current.notas, ...novas]);
      if (arquivos.length > cabem) {
        setErro(
          `Cabem ${NOTAS_POR_CONTA} arquivos por conta; os outros ficaram de fora.`,
        );
      }
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setLendo(false);
    }
  }
  const somarAgora = useRef(somar);
  somarAgora.current = somar;

  /*
   * O Ctrl+V vale na janela inteira, e não só dentro de um quadrado.
   *
   * Quem copiou o comprovante quer colar; procurar onde clicar antes é um passo
   * que ninguém dá. Só entra imagem — texto colado é texto de campo, e roubá-lo
   * daqui quebraria a digitação normal.
   */
  useEffect(() => {
    if (!colar) return;
    function aoColar(e: ClipboardEvent) {
      const imagens = [...(e.clipboardData?.files ?? [])].filter((f) =>
        f.type.startsWith('image/'),
      );
      if (imagens.length === 0) return;
      e.preventDefault();
      // O print colado não tem nome: quem nomeia é a API.
      void somarAgora.current(imagens, false);
    }

    window.addEventListener('paste', aoColar);
    return () => window.removeEventListener('paste', aoColar);
  }, [colar]);

  async function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    // A cópia sai antes de limpar o campo: `files` é uma lista viva.
    const arquivos = [...(e.target.files ?? [])];
    e.target.value = '';
    await somar(arquivos, true);
  }

  /** Só as fotos — são elas que a tela cheia percorre com as setas. */
  const fotos = notas
    .map((n, i) => ({ n, i }))
    .filter(({ n }) => n.dados.startsWith('data:image/'));
  const naSequencia = fotos.findIndex(({ i }) => i === vendo);

  return (
    <div>
      <span className="rotulo">{rotulo}</span>
      <div className="flex flex-wrap items-center gap-3">
        {notas.map((nota, i) => (
          <div key={nota.dados.slice(-32) + i} className="flex items-center gap-2">
            {nota.dados.startsWith('data:image/') ? (
              <button
                type="button"
                onClick={() => setVendo(i)}
                title="Ver em tela cheia"
                className="cursor-zoom-in"
              >
                <img
                  src={nota.dados}
                  alt={`Nota ${i + 1}`}
                  className="h-10 w-16 rounded-lg border border-tinta-200 object-cover"
                />
              </button>
            ) : (
              <span className="rounded-lg border border-tinta-200 px-2 py-1 text-xs text-tinta-600">
                PDF
              </span>
            )}
            <span className="max-w-[160px] truncate text-sm text-tinta-600">
              {nota.nome || 'print colado'}
            </span>
            <button
              type="button"
              onClick={() => onMudar(notas.filter((_, j) => j !== i))}
              className="text-xs font-semibold text-rose-500 hover:underline"
            >
              tirar
            </button>
          </div>
        ))}

        {!cheia && (
          <label className="btn btn-p btn-neutro w-fit cursor-pointer">
            {lendo ? 'Lendo…' : notas.length > 0 ? '+ outra' : 'Anexar nota'}
            {/* Da galeria ou da pasta dá para marcar várias de uma vez. */}
            <input
              type="file"
              accept="image/*,application/pdf"
              multiple
              className="hidden"
              onChange={escolher}
            />
          </label>
        )}

        {colar && notas.length === 0 && (
          <span className="text-xs text-tinta-400">
            ou dê Ctrl+V para colar um print — ele vai como foto
          </span>
        )}
      </div>
      {parcelado && notas.length > 0 && (
        <p className="ajuda">Em conta parcelada, vão na primeira parcela.</p>
      )}
      {erro && <p className="mt-1 text-sm text-rose-600">{erro}</p>}
      {naSequencia >= 0 && (
        <FotoAmpliada
          src={fotos[naSequencia].n.dados}
          titulo={
            fotos.length > 1
              ? `Foto ${naSequencia + 1} de ${fotos.length}`
              : fotos[naSequencia].n.nome || 'Nota'
          }
          onFechar={() => setVendo(null)}
          onAnterior={
            naSequencia > 0 ? () => setVendo(fotos[naSequencia - 1].i) : undefined
          }
          onProxima={
            naSequencia < fotos.length - 1
              ? () => setVendo(fotos[naSequencia + 1].i)
              : undefined
          }
        />
      )}
    </div>
  );
}
