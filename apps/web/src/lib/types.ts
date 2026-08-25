export type PerfilUsuario = 'ADMIN' | 'RH' | 'VISUALIZADOR';

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  role: PerfilUsuario;
  /**
   * Os módulos que este login abre ("folha", "contas-pagar", "rh").
   * **Vazio = todos** — é lista de restrição, não de permissão.
   */
  modulos?: string[];
}

/** Login como aparece na tela de gerenciamento (só para ADMIN). */
export interface UsuarioAdmin extends Usuario {
  ativo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Funcionario {
  id: string;
  ixcId: number | null;
  nome: string;
  /** Como a pessoa é chamada no dia a dia; é por ele que a busca acha. */
  apelido: string | null;
  cpfCnpj: string | null;
  email: string | null;
  telefone: string | null;
  salarioBase: string;
  funcao: string | null;
  departamento: string | null;
  dataAdmissao: string | null;
  dataDemissao: string | null;
  ativo: boolean;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  chavePix: string | null;
  /** Tipo de PIX preferencial do fornecedor, repetido na conta a pagar */
  tipoChavePix: string | null;
  observacoes: string | null;
  ultimoSyncAt: string | null;
}

/** Tipos de chave PIX, como aparecem na tela de contas a pagar do IXC. */
export const TIPOS_CHAVE_PIX = [
  'CPF/CNPJ',
  'Celular',
  'E-mail',
  'Aleatória',
  'Código copia e cola',
] as const;

export interface Adiantamento {
  id: string;
  descricao: string;
  data: string;
  valor: string;
  tipoPagamento: string;
}

export interface Funcionario {
  /** Contratado como CLT (informativo; a folha olha a carteira assinada) */
  clt?: boolean;
  carteiraAssinada?: boolean;
  /** Só para carteira assinada: o que a folha daqui paga (vira a base) */
  valorAReceberFolha?: string | null;
  recebeAdiantamento?: boolean;
  /** Valor que a pessoa recebe no dia 25 (null = percentual da configuração) */
  valorAdiantamento?: string | null;
  /** Quanto a pessoa ganha por venda — na prática R$ 5 ou R$ 50 */
  valorPorVenda?: string | null;
  idFornecedorIxc?: number | null;
}

/** Vendas e horas extras de um mês trabalhado. */
export interface VariavelMes {
  id: string;
  competencia: string;
  vendas: number;
  /** Valor por venda só daquele mês (null = o do cadastro) */
  valorPorVenda: string | null;
  horasExtras: string;
  observacao: string | null;
}

export type TipoLancamento =
  | 'SALARIO'
  /** Pagamento de quem entrou de férias — entra no lugar do salário do mês */
  | 'FERIAS'
  | 'ADIANTAMENTO'
  | 'BONUS'
  | 'DESCONTO'
  | 'AVULSO'
  | 'DIARIA'
  /** Conta a pagar lançada à mão (energia, aluguel): despesa, não pagamento a alguém */
  | 'DESPESA';

export interface Lancamento {
  id: string;
  tipo: TipoLancamento;
  descricao: string;
  valor: string;
  ativo: boolean;
  /** null = fixo (todo mês); "AAAA-MM" = avulso daquela competência */
  competencia: string | null;
}

export interface FuncionarioDetalhe extends Funcionario {
  adiantamentos: Adiantamento[];
  lancamentos: Lancamento[];
  variaveisMes: VariavelMes[];
}

// --- Vales e acertos entre a pessoa e a empresa (avulsos ou parcelados) ---
/** DESCONTO: o funcionário deve. CREDITO: a empresa deve. */
export type SentidoVale = 'DESCONTO' | 'CREDITO';

export interface ValeParcela {
  id: string;
  numero: number;
  competencia: string;
  valor: string;
  descontada: boolean;
  descontadaEm: string | null;
}

export interface Vale {
  id: string;
  funcionarioId: string;
  sentido: SentidoVale;
  descricao: string;
  data: string;
  valorTotal: string;
  quantidadeParcelas: number;
  valorParcela: string;
  descontarDaFolha: boolean;
  competenciaInicio: string;
  cancelado: boolean;
  observacao: string | null;
  parcelas: ValeParcela[];
}

export interface ValeComSaldo {
  vale: Vale;
  funcionarioNome: string;
  saldo: number;
  totalDescontado: number;
  parcelasDescontadas: number;
  quitado: boolean;
  proximaParcela: ValeParcela | null;
}

export type StatusContaPagar =
  | 'RASCUNHO'
  | 'AGUARDANDO_APROVACAO'
  | 'APROVADO'
  | 'REPROVADO'
  | 'AGUARDANDO_PAGAMENTO'
  | 'PAGO'
  | 'CANCELADO'
  | 'ERRO';

export interface ContaPagar {
  id: string;
  competencia: string | null;
  tipo: TipoLancamento;
  funcionarioId: string | null;
  beneficiarioNome: string;
  idFornecedorIxc: number | null;
  valor: string;
  contaContabil: number;
  contaPagamento: number;
  filialId: number;
  dataEmissao: string;
  dataVencimento: string;
  observacao: string;
  status: StatusContaPagar;
  erro: string | null;
  idFnApagarIxc: number | null;
  aprovadoEm: string | null;
  pagoEm: string | null;
  createdAt: string;
}

/** O que a conferência com o IXC descobriu sobre uma conta. */
export interface ResultadoSincronizacao {
  /** null = não existe mais no IXC e foi apagada daqui também. */
  conta: ContaPagar | null;
  removida: boolean;
  mudouStatus: boolean;
  statusAnterior: StatusContaPagar;
}

export interface ResumoSincronizacao {
  verificadas: number;
  pagas: number;
  removidas: number;
  atualizadas: number;
  erros: number;
}

/** Conta que ficou de fora de uma ação em massa, e por quê. */
export interface FalhaLote {
  id: string;
  beneficiario: string;
  erro: string;
}

/** O que aconteceu numa ação feita em várias contas de uma vez. */
export interface ResultadoLote {
  total: number;
  sucesso: number;
  falhas: FalhaLote[];
}

export interface LancamentoCalculado {
  tipo: TipoLancamento;
  valor: number;
  contaContabil: number;
  observacao: string;
}

/** Situação do adiantamento do dia 25 na competência da prévia. */
export interface SituacaoAdiantamento {
  valor: number;
  /** Foi abatido do saldo salarial desta prévia? */
  descontado: boolean;
  situacao: 'PAGO' | 'PENDENTE' | 'NAO_GERADO';
  status: StatusContaPagar | null;
  pagoEm: string | null;
}

/** Saldo salarial aberto: o que entrou e o que saiu. */
export interface ComposicaoSalario {
  /** Base usada: salário base ou "a receber na folha" (carteira assinada) */
  salarioBase: number;
  usouValorAReceber: boolean;
  vendas: number;
  valorPorVenda: number;
  comissao: number;
  horasExtras: number;
  descontos: number;
  /** vales descontados (o funcionário devia à empresa) */
  vales: number;
  /** acertos somados (a empresa devia ao funcionário) */
  valesCredito: number;
  /** faltas do mês, já com o descanso semanal perdido dentro */
  faltas: number;
  adiantamento: number;
  adiantamentoDescontado: number;
  saldo: number;
}

/** Parcela de vale/acerto que mexeu na folha da competência. */
export interface ParcelaValeFolha {
  valeId: string;
  sentido: SentidoVale;
  descricao: string;
  numero: number;
  de: number;
  valor: number;
  descontada: boolean;
}

/** Aviso de que aquele pagamento já existe na competência. */
export interface ContaJaGerada {
  situacao: 'PAGO' | 'PENDENTE';
  status: StatusContaPagar;
  pagoEm: string | null;
}

export interface PreviewFuncionario {
  funcionarioId: string;
  nome: string;
  apelido: string | null;
  carteiraAssinada: boolean;
  recebeAdiantamento: boolean;
  /** null para quem não recebe adiantamento no dia 25 */
  adiantamento: SituacaoAdiantamento | null;
  composicao: ComposicaoSalario;
  vales: ParcelaValeFolha[];
  /** Conta de salário que já existe nesta competência */
  salarioJaGerado: ContaJaGerada | null;
  /** Conta de bônus que já existe nesta competência */
  bonusJaGerado: ContaJaGerada | null;
  /** O que a folha sabe sobre as férias desta pessoa no mês trabalhado */
  ferias: FeriasNaFolha;
  lancamentos: LancamentoCalculado[];
}

/**
 * Férias da pessoa no mês trabalhado, e o que elas mudam na folha dela.
 *
 * Quem entra de férias não recebe salário naquele mês: recebe o valor que a
 * contabilidade apurou. E não recebe o adiantamento do dia 25 — adiantamento é
 * sobre o mês que se está trabalhando, e quem está de férias não está.
 */
export interface FeriasNaFolha {
  /** Férias registradas na tela de Férias que alcançam o mês trabalhado */
  periodo: { inicio: string; fim: string; dias: number } | null;
  /** As férias pegam o dia 25 — o dia em que o adiantamento é pago */
  noDia25: boolean;
  /** Pagamento de férias que já saiu por este mês trabalhado */
  jaGerado: ContaJaGerada | null;
  /** Pelo que a folha sabe, esta pessoa está de férias neste mês */
  deFerias: boolean;
  /** Ponto de partida do valor; o certo vem da contabilidade */
  valorSugerido: number;
  /** Conta contábil e observação com que o lançamento de férias sai no IXC */
  contaContabil: number;
  observacao: string;
}

export interface ConfigFinanceira {
  contaPagamentoId: number;
  /** Conta de pagamento de quem recebe em mãos: o caixa, não o banco */
  contaPagamentoCaixaId: number;
  filialId: number;
  contaContabilSalario: number;
  contaContabilAdiantamento: number;
  contaContabilBonus: number;
  /** Férias. Nasce igual à de salário — confirme com a contabilidade */
  contaContabilFerias: number;
  contaContabilDiaria: number;
  /** Pagamentos avulsos (mão de obra, serviço pontual, patrocínio) */
  contaContabilAvulso: number;
  cidadePadraoId: number;
  /** Quem paga, como sai impresso no recibo assinado da diária */
  empresaNome: string;
  empresaCnpj: string;
  /** % do salário base no adiantamento do dia 25 (padrão 40) */
  percentualAdiantamento: number;
  tipoPagamentoPadrao: string;
  /** Coluna do fn_apagar com o "Tipo da chave Pix" ("" = aprender do IXC) */
  pixCampoTipoChave: string;
  /** Códigos por tipo, ex.: "Celular=C,E-mail=E" ("" = usar o rótulo) */
  pixCodigosTipoChave: string;
  /** Coluna que o app aprendeu sozinho do IXC (só leitura) */
  pixCampoTipoChaveAprendido: string;
  /** Códigos que o app já decorou, um por tipo de chave (só leitura) */
  pixCodigosTipoChaveAprendidos: string;
  obsSalarioTemplate: string;
  obsAdiantamentoTemplate: string;
  obsBonusTemplate: string;
  obsFeriasTemplate: string;
  /** Campo do "Contribuinte ICMS" no fornecedor ("" = detectar automaticamente) */
  fornecedorCampoIcms: string;
  /** Valores desse campo que significam "Isento", separados por vírgula */
  fornecedorIcmsIsento: string;
  /** Tabela da aba "Dados bancários" do fornecedor ("" = descobrir sozinho) */
  fornecedorTabelaBanco: string;
  /** Campo do "Tipo de pessoa" no fornecedor ("" = detectar automaticamente) */
  fornecedorCampoTipoPessoa: string;
  /** Valores desse campo que significam "Estrangeiro", separados por vírgula */
  fornecedorTipoEstrangeiro: string;
  /** Caixa de onde sai o dinheiro pago em mãos (0 = procurar pelo nome) */
  caixaEmMaosId: number;
  caixaEmMaosNome: string;
  /** Tabelas do IXC ("" = descobrir sozinho) */
  caixaTabelaContas: string;
  caixaTabelaMovimento: string;
}

// --- Pagamentos avulsos: quem recebe fora da folha e fora da diária ---
export interface BeneficiarioAvulso {
  id: string;
  nome: string;
  cpfCnpj: string | null;
  /** F = física, J = jurídica */
  tipoPessoa: string;
  telefone: string | null;
  email: string | null;
  chavePix: string | null;
  tipoChavePix: string | null;
  /** Quanto ganha por venda — cliente da empresa também vende e comissiona */
  valorPorVenda: string | null;
  formaPagamento: FormaPagamento;
  observacoes: string | null;
  ativo: boolean;
  idFornecedorIxc: number | null;
  /** Avisado de que o documento já existia no IXC, quis um fornecedor novo */
  fornecedorNovoNoIxc: boolean;
}

export interface BeneficiarioComResumo {
  beneficiario: BeneficiarioAvulso;
  quantidadePagamentos: number;
  /** Só o dinheiro que saiu: conta a pagar que o IXC deu por paga */
  totalPago: number;
  quantidadePagas: number;
  /** Lançado no IXC, esperando aprovação ou o pagamento */
  totalAguardando: number;
  quantidadeAguardando: number;
  quantidadeComErro: number;
  ultimoPagamento: string | null;
  /** Pagos em mãos antigos, que nunca viraram lançamento no caixa do IXC */
  pendentesNoCaixa: number;
}

/**
 * Um fornecedor do cadastro do IXC, como a tela de pagamentos avulsos do
 * módulo Contas a Pagar o mostra: o que existe lá, mais o que esta casa já
 * sabe sobre ele.
 */
export interface FornecedorParaPagar {
  idFornecedor: number;
  nome: string;
  nomeFantasia: string | null;
  cpfCnpj: string | null;
  tipoPessoa: string | null;
  email: string | null;
  telefone: string | null;
  cidadeIxc: number | null;
  ativo: boolean;
  /** Cadastro daqui, quando já existe. Null = nunca recebeu por este app. */
  beneficiarioId: string | null;
  quantidadePagamentos: number;
  ultimoPagamento: string | null;
}

export interface PaginaFornecedoresParaPagar {
  itens: FornecedorParaPagar[];
  /** Quantos há no filtro inteiro no IXC, não nesta página. */
  total: number;
  page: number;
  porPagina: number;
}

export interface PagamentoAvulso {
  id: string;
  beneficiarioId: string;
  data: string;
  /** Total: serviço + comissão de venda + extra */
  valor: string;
  descricao: string;
  contaContabil: number;
  vendas: number;
  valorPorVenda: string | null;
  comissaoVendas: string;
  valorExtra: string;
  descricaoExtra: string | null;
  forma: FormaPagamento;
  contaPagarId: string | null;
  caixaIxc: number | null;
  idLancamentoIxc: number | null;
  lancadoEm: string | null;
  lancadoManual: boolean;
  erroIxc: string | null;
  beneficiario?: { nome: string };
  contaPagar?: {
    id: string;
    status: StatusContaPagar;
    erro: string | null;
    idFnApagarIxc: number | null;
  } | null;
}

/** Cadastro salvo, mais o que não deu certo do lado do IXC (se algo). */
export interface BeneficiarioSalvo {
  beneficiario: BeneficiarioAvulso;
  /** null = correu tudo bem */
  avisoIxc: string | null;
}

/**
 * Um fornecedor que já existe no IXC com aquele CPF/CNPJ, com o que ele traz da
 * aba "Dados bancários" — é de lá que sai a chave que de fato paga.
 */
export interface FornecedorNoIxc {
  idFornecedor: number;
  nome: string;
  nomeFantasia: string | null;
  cpfCnpj: string | null;
  /** F | J | E, como o IXC guarda */
  tipoPessoa: string | null;
  email: string | null;
  telefone: string | null;
  cidadeIxc: number | null;
  ativo: boolean;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  chavePix: string | null;
  tipoChavePix: string | null;
}

/** O que já existe com aquele documento, aqui e no IXC. */
export interface ConsultaCpfCnpj {
  beneficiario: BeneficiarioAvulso | null;
  fornecedor: FornecedorNoIxc | null;
  /** Não deu para perguntar ao IXC agora — o cadastro não precisa parar */
  ixcIndisponivel: string | null;
}

// --- Diaristas: quem trabalha por dia e recebe por diária ---
/**
 * De onde o dinheiro sai. As duas viram conta a pagar no IXC: IXC paga pela
 * conta do banco, por PIX; EM_MAOS paga pela conta do caixa, em dinheiro.
 */
export type FormaPagamento = 'IXC' | 'EM_MAOS';

export interface Diarista {
  id: string;
  /** Razão social — é o nome que vai para a conta a pagar no IXC */
  nome: string;
  /** Como a pessoa é conhecida ("Deda pedreiro"); também é buscável */
  nomeFantasia: string | null;
  cpfCnpj: string | null;
  telefone: string | null;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  chavePix: string | null;
  tipoChavePix: string | null;
  valorDiaria: string | null;
  /** Quanto ganha por venda — diarista também é vendedor externo */
  valorPorVenda: string | null;
  formaPagamento: FormaPagamento;
  observacoes: string | null;
  ativo: boolean;
  idFornecedorIxc: number | null;
  /** Veio da importação de fornecedores "Estrangeiro", não do cadastro à mão */
  importadoDoIxc: boolean;
}

export interface DiaristaComResumo {
  diarista: Diarista;
  /** Diárias no histórico, pagas ou não */
  quantidadeDiarias: number;
  /** Só o dinheiro que saiu: conta a pagar que o IXC deu por paga */
  totalPago: number;
  quantidadePagas: number;
  /** Lançado no IXC, esperando aprovação ou o pagamento */
  totalAguardando: number;
  quantidadeAguardando: number;
  /** Contas a pagar recusadas pelo IXC */
  quantidadeComErro: number;
  ultimaDiaria: string | null;
  /** Diárias em mãos antigas, que nunca viraram lançamento no caixa do IXC */
  pendentesNoCaixa: number;
}

/** Como o cadastro novo se saiu do lado do IXC. */
export interface ResultadoNoIxc {
  /** null = não deu para criar; a pessoa está cadastrada só aqui por enquanto */
  idFornecedor: number | null;
  /** Ligado a um fornecedor que já existia lá, com o mesmo CPF/CNPJ */
  reaproveitado: boolean;
  /** Saiu com a marcação que faz o IXC reconhecê-lo como diarista */
  marcadoComoDiarista: boolean;
  /** Por que o fornecedor não foi criado (null = foi) */
  erro: string | null;
  /** Por que a chave PIX não foi para a aba "Dados bancários" (null = foi) */
  avisoPix: string | null;
}

/** O cadastro recém-criado e o que aconteceu com ele no IXC. */
export interface DiaristaCriado {
  diarista: Diarista;
  ixc: ResultadoNoIxc;
}

/** O que aconteceu ao apagar várias diárias de uma vez. */
export interface ResultadoLoteDiarias {
  total: number;
  sucesso: number;
  falhas: Array<{ id: string; erro: string }>;
}

export interface Diaria {
  id: string;
  diaristaId: string;
  data: string;
  quantidade: string;
  valorDiaria: string;
  /** Total: diárias + comissão de venda + extra */
  valor: string;
  descricao: string;
  vendas: number;
  valorPorVenda: string | null;
  comissaoVendas: string;
  valorExtra: string;
  descricaoExtra: string | null;
  forma: FormaPagamento;
  contaPagarId: string | null;
  /** Caixa do IXC de onde o dinheiro saiu (pagamento em mãos) */
  caixaIxc: number | null;
  /** Lançamento criado na movimentação financeira do IXC */
  idLancamentoIxc: number | null;
  lancadoEm: string | null;
  /** Alguém lançou no IXC à mão */
  lancadoManual: boolean;
  /** Por que a saída no caixa não saiu (null = sem pendência) */
  erroIxc: string | null;
  diarista?: { nome: string };
  contaPagar?: {
    id: string;
    status: StatusContaPagar;
    erro: string | null;
    idFnApagarIxc: number | null;
  } | null;
  /**
   * Recibo em mãos: null = ninguém coletou ainda; `assinadoEm` vazio = o link
   * existe e está esperando. `expiraEm` só vem na fila de assinaturas.
   */
  assinatura?: { assinadoEm: string | null; expiraEm?: string } | null;
}

/**
 * Como a assinatura foi feita. Desenhada com o dedo, ou escrita pelo sistema a
 * partir do nome, para quem não assina de próprio punho — o recibo diz qual
 * das duas, porque um papel que aparenta punho sem ser não prova nada.
 */
export type ModoAssinatura = 'DESENHADA' | 'DIGITADA';

/**
 * O recibo assinado de uma diária paga em mãos, como a tela de quem paga o vê.
 * `assinadoEm` vazio = o link está de pé, mas ninguém assinou ainda.
 */
export interface AssinaturaDiaria {
  token: string;
  expiraEm: string;
  assinadoEm: string | null;
  /**
   * Desde quando se espera outra assinatura, pedida lá de dentro.
   *
   * Com este e `assinadoEm` juntos, a assinatura que vale ainda é a antiga —
   * ela fica guardada até a nova chegar, porque o recibo dela pode já ser a
   * nota de um lançamento do caixa. Quem decide se a janela mostra o link ou o
   * comprovante é este campo, e não o outro.
   */
  recoletandoDesde: string | null;
  /** Quantas vezes a assinatura já foi refeita. */
  recoletas: number;
  nomeAssinante: string | null;
  assinaturaPng: string | null;
  modo: ModoAssinatura;
}

/**
 * O mesmo recibo do ponto de vista de quem recebeu — é o que a tela pública
 * mostra, e traz só o que sai impresso no papel.
 */
export interface ReciboPublico {
  quemPaga: { nome: string; cnpj: string | null };
  quemRecebe: { nome: string; cpfCnpj: string | null };
  valor: string;
  descricao: string;
  detalhamento: string | null;
  data: string;
  assinado: boolean;
  /**
   * Pediram outra assinatura lá de dentro.
   *
   * Durante a recoleta este e o `assinado` são verdade ao mesmo tempo — a
   * antiga fica guardada até a nova chegar —, e é este que decide se a tela
   * mostra a prancheta ou o comprovante.
   */
  recoletando: boolean;
  assinadoEm: string | null;
  assinaturaPng: string | null;
  modo: ModoAssinatura;
}

// ---------------------------------------------------------------------------
// Contas a pagar em aberto, lidas do IXC na hora (módulo Contas a Pagar)
// ---------------------------------------------------------------------------

/** Quando a conta nasceu na Folha: é a mesma dívida, não uma a mais. */
export interface OrigemNaFolha {
  tipo: TipoLancamento;
  contaId: string;
  beneficiario: string | null;
}

export interface ContaAberta {
  idFnApagar: number;
  documento: string | null;
  fornecedor: { id: number | null; nome: string };
  /** Valor do título */
  valor: number;
  /** O que falta pagar dele — pagamento parcial deixa os dois diferentes */
  valorAberto: number;
  emissao: string | null;
  vencimento: string | null;
  /** Negativo = venceu há tantos dias; null = sem vencimento no IXC */
  diasParaVencer: number | null;
  vencida: boolean;
  observacao: string | null;
  statusAuditoria: 'A' | 'R' | 'C' | null;
  /** A conta de despesa do IXC: terreno, veículo, equipamento, energia… */
  categoria: { id: number | null; nome: string | null };
  /**
   * A que se refere o débito, na classificação desta casa. É o eixo dos
   * relatórios. Null = ninguém classificou ainda.
   */
  classificacao: EtiquetaDaConta | null;
  origem: OrigemNaFolha | null;
}

/** Por onde o dinheiro sai ao pagar um título do IXC. */
export type FormaDePagar = 'BANCO' | 'EM_MAOS';

/** O que aconteceu com o título no IXC depois de pagar. */
export interface ResultadoDoPagamento {
  idFnApagar: number;
  /** Passou pela auditoria agora, ou já estava aprovado antes. */
  aprovada: boolean;
  /** O IXC passou a considerar a conta quitada. */
  paga: boolean;
  valor: number;
  avisos: string[];
}

/** Quanto a empresa já pagou no mês, pelo contas a pagar do IXC. */
export interface PagamentosDoMes {
  /** "AAAA-MM" */
  mes: string;
  total: number;
  quantidade: number;
  lidoEm: string;
  /** false = a leitura bateu no teto e o total pode faltar coisa. */
  completo: boolean;
}

/** Uma categoria de despesa do cadastro daqui. */
export interface CategoriaDespesa {
  id: string;
  nome: string;
  ativa: boolean;
  ordem: number;
  /** Quantas contas já foram etiquetadas com ela */
  emUso: number;
  /** A categoria de cima, quando esta é uma subcategoria */
  pai: { id: string; nome: string } | null;
  /** Tem subcategorias dentro dela — então ela é um grupo, e não uma folha */
  temFilhas: boolean;
}

/**
 * A etiqueta que um débito carrega, com o grupo em que ela mora.
 *
 * `grupo` é a categoria de cima ("Veículos") e `nome` é a subcategoria
 * ("Manutenção de veículos"): o dashboard soma pelo primeiro e destrincha pelo
 * segundo. Null quando a categoria não está dentro de nenhuma.
 */
export interface EtiquetaDaConta {
  id: string;
  nome: string;
  grupo: { id: string; nome: string } | null;
}

export interface FatiaDoResumo {
  quantidade: number;
  total: number;
}

export interface ResumoContasAbertas {
  quantidade: number;
  total: number;
  vencidas: FatiaDoResumo;
  venceEmSeteDias: FatiaDoResumo;
  demais: FatiaDoResumo;
  semVencimento: FatiaDoResumo;
}

/**
 * A leitura que o filtro daqui faz de um título: o que ele olhou, o que achou
 * em cada campo, e a conclusão. É o que deixa a tela responder "por que esta
 * conta aparece aqui?" sem depender de adivinhação.
 */
export interface AvaliacaoDoFiltro {
  aberta: boolean;
  motivo: { motivo: 'pago' | 'cancelado' | 'quitado'; campo: string } | null;
  olhou: Array<{ campo: string; valor: string; nota: string }>;
}

/** O título do IXC por inteiro, com a leitura do filtro. */
export interface DetalheDoTitulo {
  campos: Record<string, unknown>;
  filtro: AvaliacaoDoFiltro;
}

export interface ContasAbertas {
  contas: ContaAberta[];
  resumo: ResumoContasAbertas;
  /** Quando a lista foi lida do IXC — ela é de agora, não de um espelho */
  lidoEm: string;
  avisos: string[];
}

/** Um caixa/conta do IXC, para configurar de onde sai o dinheiro em mãos. */
export interface CaixaIxc {
  id: number;
  nome: string;
  tipo: string | null;
}

export interface CaixasIxc {
  /** Tabela do IXC que respondeu (null = nenhuma encontrada) */
  tabela: string | null;
  caixas: CaixaIxc[];
  /** Código que está valendo hoje para o pagamento em mãos */
  emUso: number | null;
  nomeProcurado: string;
}

export interface Paginado<T> {
  itens: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface Resumo {
  total: number;
  ativos: number;
  inativos: number;
  salarioBaseMensal: string;
  /** Bônus fixos (todo mês) — já somados na folha base */
  bonusFixoMensal: string;
  folhaBaseMensal: string;
}

/**
 * Gasto mês a mês com quem não é da folha — diarista ou avulso. Os dois entram
 * pela data em que o dinheiro saiu, porque a conta a pagar deles nasce sem
 * competência.
 */
export interface SerieDeGasto {
  serie: {
    competencia: string;
    /** Gasto do mês: o que saiu mais o que ainda está a caminho */
    valor: number;
    /** Já saiu: conta a pagar que o IXC deu por paga */
    pago: number;
    /** Lançado no IXC, esperando aprovação ou o banco */
    aCaminho: number;
    /**
     * Não vai sair sozinho: conta reprovada, cancelada, recusada pelo IXC ou
     * apagada de lá. Fica fora do gasto, mas visível para alguém destravar.
     */
    travado: number;
    travadas: number;
    /** Pagamentos e pessoas por trás de `valor` (os travados não contam) */
    quantidade: number;
    pessoas: number;
  }[];
  total: number;
  totalPago: number;
  totalACaminho: number;
  totalTravado: number;
  quantidade: number;
}

/** Números da tela inicial. */
export interface Dashboard {
  competencia: string;
  funcionarios: {
    total: number;
    ativos: number;
    inativos: number;
    salarioBaseMensal: number;
    bonusFixoMensal: number;
    folhaBaseMensal: number;
    semPix: number;
  };
  folha: {
    total: number;
    pago: number;
    emAberto: number;
    comErro: number;
    quantidade: number;
    porStatus: { status: StatusContaPagar; quantidade: number; valor: number }[];
    porTipo: { tipo: TipoLancamento; quantidade: number; valor: number }[];
  };
  vales: {
    valesEmAberto: number;
    /** o que os funcionários ainda devem à empresa */
    saldoDevedor: number;
    /** o que a empresa ainda deve aos funcionários */
    saldoAPagar: number;
    descontoNaCompetencia: number;
    creditoNaCompetencia: number;
  };
  serie: { competencia: string; total: number; pago: number }[];
  /** Quantos meses as séries cobrem, contando a competência escolhida. */
  meses: number;
  /** O que foi gerado em cada mês, aberto por tipo de lançamento. */
  serieTipos: {
    competencia: string;
    salario: number;
    adiantamento: number;
    bonus: number;
    avulso: number;
    diaria: number;
    desconto: number;
  }[];
  diaristas: SerieDeGasto;
  /**
   * Pagamentos avulsos, contados pela data em que saíram: a conta a pagar deles
   * nasce sem competência, então agregar por competência perdia todos.
   */
  avulsos: SerieDeGasto;
  /** Comissão de venda paga no mês, some quem vende: fora da folha e dentro */
  vendas: {
    serie: {
      competencia: string;
      /** Comissão que saiu dentro do salário dos funcionários */
      funcionarios: number;
      /** Comissão paga a diaristas e beneficiários avulsos */
      foraDaFolha: number;
      total: number;
      /** Quantas vendas o total está resumindo */
      vendas: number;
    }[];
    total: number;
    vendas: number;
  };
  impostos: ResumoImpostos;
  /**
   * O que a empresa gasta com gente. O INSS retido do trabalhador fica de
   * fora: é dinheiro dele passando pela conta da empresa.
   */
  custoPessoal: {
    competencia: string;
    folha: number;
    diaristas: number;
    encargos: number;
    total: number;
  }[];
  ultimasContas: ContaPagar[];
  ultimoSync: {
    recurso: string;
    status: 'EM_ANDAMENTO' | 'SUCESSO' | 'ERRO';
    totalLidos: number;
    iniciadoEm: string;
    concluidoEm: string | null;
  } | null;
}

export interface SyncResult {
  recurso: string;
  totalLidos: number;
  totalNovos: number;
  totalAtualizados: number;
}

/** Pessoa identificada no cadastro de fornecedor do IXC. */
export interface PessoaDoFornecedor {
  idFornecedor: number;
  nome: string;
  nomeFantasia: string | null;
  cpfCnpj: string | null;
  email: string | null;
  telefone: string | null;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  chavePix: string | null;
  tipoChavePix: string | null;
  /** Valor cru do campo que fez o registro entrar no filtro */
  valorFiltro: string;
  jaCadastrado: boolean;
}

export interface OcorrenciaCampo {
  valor: string;
  quantidade: number;
  exemplos: string[];
}

export interface PreviewFornecedores {
  campoIcms: string | null;
  valoresIsento: string[];
  tabelaBanco: string | null;
  totalFornecedoresAtivos: number;
  distribuicao: OcorrenciaCampo[];
  funcionarios: PessoaDoFornecedor[];
}

/** Resultado da importação de diaristas do cadastro de fornecedor. */
export interface SyncDiaristasResult extends SyncResult {
  campoTipoPessoa: string | null;
  /** Quem não entrou porque já está cadastrado como funcionário */
  ignoradosPorSerFuncionario: string[];
}

export interface PreviewDiaristas {
  campoTipoPessoa: string | null;
  valoresEstrangeiro: string[];
  tabelaBanco: string | null;
  totalFornecedoresAtivos: number;
  distribuicao: OcorrenciaCampo[];
  camposDisponiveis: string[];
  diaristas: Array<PessoaDoFornecedor & { jaEhFuncionario: boolean }>;
}

// ---------------------------------------------------------------------------
// Guias de imposto lidas do PDF da contabilidade
// ---------------------------------------------------------------------------
export type TipoGuia =
  | 'DARF_INSS'
  | 'FGTS'
  | 'DAS_SIMPLES'
  | 'DARE_ICMS'
  | 'OUTRA';

/**
 * O conjunto que a contabilidade manda todo mês, na ordem em que se lê. São
 * três fixos; o DARE do ICMS só aparece nos meses em que houve o que pagar —
 * daí "3 a 4 arquivos". A tela usa isto para dizer o que ainda falta do mês.
 */
export const GUIAS_DO_MES: TipoGuia[] = ['DARF_INSS', 'FGTS', 'DAS_SIMPLES'];

/** Guias que existem em alguns meses só — a ausência não é pendência. */
export const GUIAS_EVENTUAIS: TipoGuia[] = ['DARE_ICMS', 'OUTRA'];

/**
 * O que o item representa no bolso da empresa. Somar tudo junto mente: o INSS
 * descontado do trabalhador só passa pela conta, e IRPJ/COFINS/ICMS são
 * imposto sobre faturamento, não sobre gente.
 */
export type ClasseTributo = 'FOLHA_PATRONAL' | 'FOLHA_RETIDO' | 'FATURAMENTO';

export const TIPO_GUIA_LABEL: Record<TipoGuia, string> = {
  DARF_INSS: 'DARF — INSS',
  FGTS: 'FGTS',
  DAS_SIMPLES: 'DAS — Simples Nacional',
  DARE_ICMS: 'DARE — ICMS',
  OUTRA: 'Outra guia',
};

export const CLASSE_LABEL: Record<ClasseTributo, string> = {
  FOLHA_PATRONAL: 'Custo da empresa com pessoal',
  FOLHA_RETIDO: 'Retido do trabalhador (repasse)',
  FATURAMENTO: 'Tributo sobre faturamento',
};

export const CLASSE_CURTA: Record<ClasseTributo, string> = {
  FOLHA_PATRONAL: 'Patronal',
  FOLHA_RETIDO: 'Retido',
  FATURAMENTO: 'Faturamento',
};

export interface ItemGuia {
  id?: string;
  codigo: string | null;
  denominacao: string;
  valor: number;
  classe: ClasseTributo;
  /** O leitor não conhecia o código e chutou pela denominação. */
  classeIncerta?: boolean;
}

export interface Guia {
  id: string;
  tipo: TipoGuia;
  competencia: string;
  vencimento: string;
  valorTotal: number;
  numeroDocumento: string | null;
  cnpj: string | null;
  razaoSocial: string | null;
  trabalhadores: number | null;
  arquivoNome: string;
  itens: ItemGuia[];
  /**
   * A conta a pagar que esta guia virou. Null = ela ainda não está na fila de
   * pagamento — imposto que vence e não está na lista de ninguém.
   */
  contaPagar: {
    id: string;
    /** O título no IXC, que é por onde se acha a conta do outro lado */
    idFnApagarIxc: number | null;
    status: string;
    pagoEm: string | null;
  } | null;
  /** Vem só na resposta do lançamento: a conta que acabou de ser criada. */
  conta?: ContaDaGuia | null;
  /** Vem só no lançamento: por que a conta a pagar não saiu. */
  avisoConta?: string | null;
}

/** O que aconteceu ao transformar uma guia em conta a pagar. */
export interface ContaDaGuia {
  guiaId: string;
  contaPagarId: string;
  idFnApagarIxc: number | null;
  valor: number;
  vencimento: string;
  fornecedor: { id: number; nome: string };
  /** Como ela vai ser paga: o que veio impresso no PDF. */
  formaDePagamento: 'BOLETO' | 'PIX' | null;
  /** A conta já existia — a chamada não criou nada. */
  jaExistia: boolean;
  aviso: string | null;
}

/** O que o leitor entendeu do PDF, antes de alguém confirmar. */
export interface LeituraDaGuia {
  guia: {
    tipo: TipoGuia;
    competencia: string;
    vencimento: string;
    valorTotal: number;
    numeroDocumento: string | null;
    cnpj: string | null;
    razaoSocial: string | null;
    trabalhadores: number | null;
    itens: ItemGuia[];
  };
  arquivoNome: string;
  textoOriginal: string;
  divergencia: string | null;
  jaExiste: { id: string; competencia: string; valorTotal: number } | null;
}

// ---------------------------------------------------------------------------
// Férias — a previsão que a contabilidade manda todo mês, e a fila que sai dela
// ---------------------------------------------------------------------------

/** Onde a pessoa está em relação ao próprio prazo. */
export type SituacaoFerias = 'VENCIDA' | 'LIBERADA' | 'AGUARDANDO';

/** Férias já marcadas para alguém. */
export interface FeriasMarcada {
  id: string;
  inicio: string;
  fim: string;
  dias: number;
  observacao: string | null;
  /** Está de férias hoje. */
  emCurso: boolean;
}

export interface PessoaNaFila {
  itemId: string;
  ordem: number;
  codigo: string;
  nome: string;
  cargo: string | null;
  /** Cadastro daqui, quando o nome casou — dá para abrir a ficha. */
  funcionarioId: string | null;
  admissao: string | null;
  periodoInicio: string;
  periodoFim: string;
  dataLimite: string;
  diasDireito: number;
  diasAcumulados: number | null;
  situacao: SituacaoFerias;
  /** Dias até a data limite; negativo = já passou dela. */
  diasAteLimite: number;
  /** Dias até poder sair; 0 = já pode. */
  diasParaLiberar: number;
  ferias: FeriasMarcada | null;
}

export interface FilaDeFerias {
  previsao: {
    id: string;
    dataRelatorio: string;
    empresa: string | null;
    arquivoNome: string;
    diasDesdeORelatorio: number;
  } | null;
  fila: PessoaNaFila[];
  marcadas: PessoaNaFila[];
}

/** Uma pessoa como o leitor entendeu do PDF. */
export interface ItemPrevisaoLido {
  ordem: number;
  codigo: string;
  nome: string;
  cargo: string | null;
  admissao: string | null;
  periodoInicio: string;
  periodoFim: string;
  dataLimite: string;
  diasDireito: number;
  diasAcumulados: number | null;
  diasRestantes: number | null;
}

/** O que o leitor entendeu do PDF, antes de alguém confirmar. */
export interface LeituraDaPrevisao {
  previsao: {
    dataRelatorio: string;
    empresa: string | null;
    cnpj: string | null;
    mesesLimite: number | null;
    itens: ItemPrevisaoLido[];
    totalDeclarado: number | null;
  };
  arquivoNome: string;
  divergencia: string | null;
  jaExiste: { id: string; arquivoNome: string; itens: number } | null;
}

export interface ResumoImpostos {
  serie: {
    competencia: string;
    folhaPatronal: number;
    folhaRetido: number;
    faturamento: number;
  }[];
  total: {
    folhaPatronal: number;
    folhaRetido: number;
    faturamento: number;
  };
  guias: {
    id: string;
    tipo: TipoGuia;
    competencia: string;
    vencimento: string;
    valorTotal: number;
    trabalhadores: number | null;
  }[];
}

// ---------------------------------------------------------------------------
// Histórico do que já foi pago — a outra metade da mesma tabela do IXC
// ---------------------------------------------------------------------------

/**
 * O que o registro do IXC confirma sobre um pagamento — e o que nele não fecha.
 * É o motivo de a tela existir: "já pagou" é fácil de acreditar; o que precisa
 * de conferência é o que não bate.
 */
export interface ConferenciaDoPagamento {
  /** Nada a apontar: o IXC confirma o pagamento por inteiro e coerente */
  fecha: boolean;
  ressalvas: string[];
}

export interface PagamentoFeito {
  idFnApagar: number;
  documento: string | null;
  fornecedor: { id: number | null; nome: string };
  /** Valor do título, como ele foi lançado */
  valor: number;
  /** Quanto saiu do caixa — com juros e multa, pode passar do valor do título */
  valorPago: number;
  /** O que ainda falta deste título: acima de zero = pagamento parcial */
  valorAberto: number;
  parcial: boolean;
  juros: number;
  multa: number;
  desconto: number;
  emissao: string | null;
  vencimento: string | null;
  /**
   * O dia em que o dinheiro saiu — o informado na baixa, quando ela pôde ser
   * lida. Ver `fonteDaData`.
   */
  pagoEm: string;
  /** O dia em que a baixa foi registrada no IXC (a coluna `campoDaBaixa`) */
  registradoEm: string;
  /**
   * De onde `pagoEm` saiu: `debito` = o dia do débito, gravado no próprio
   * título (o que a tela do IXC mostra como "Data pagamento"); `baixa` = o dia
   * informado na linha de baixa, que é o que a aba "Pagamentos" do IXC mostra;
   * `titulo` = o dia em que a baixa foi **registrada**, porque nenhum dos dois
   * estava disponível. É o que separa "pagou atrasado" de "lançou atrasado".
   */
  fonteDaData: 'debito' | 'baixa' | 'titulo';
  /** O número da linha de baixa no IXC, quando ela foi lida */
  baixaNoIxc: number | null;
  /** A coluna do IXC de onde a data da baixa saiu — é por ela que se procura lá */
  campoDaBaixa: string;
  /** A coluna que deu o dia do pagamento, quando ele veio do título */
  campoDoDia: string | null;
  /** 0 = pagou no dia, positivo = atrasado, negativo = adiantado, null = sem vencimento */
  diasDeAtraso: number | null;
  formaPagamento: string | null;
  /** De qual conta/caixa o dinheiro saiu */
  caixa: { id: number | null; nome: string | null };
  baixadoPor: string | null;
  observacao: string | null;
  statusAuditoria: 'A' | 'R' | 'C' | null;
  /** O `status` cru do título: "A" com baixa é o status que ficou parado */
  statusNoIxc: string | null;
  /**
   * Se esse status é um dos que significam "pago" nesta base — nela é "F", não
   * o "P" da documentação. Quem decide é a API: uma segunda lista disso aqui
   * escreveria "baixado mesmo assim" em todo pagamento normal do IXC.
   */
  statusEhDePago: boolean;
  categoria: { id: number | null; nome: string | null };
  classificacao: EtiquetaDaConta | null;
  origem: OrigemNaFolha | null;
  conferencia: ConferenciaDoPagamento;
}

export interface FatiaDePagamentos {
  quantidade: number;
  total: number;
}

export interface ResumoPagamentos {
  quantidade: number;
  /** Soma do que saiu do caixa */
  total: number;
  emDia: FatiaDePagamentos;
  emAtraso: FatiaDePagamentos;
  semVencimento: FatiaDePagamentos;
  parciais: FatiaDePagamentos;
  /** Com ressalva na conferência — é a fila de quem confere */
  comRessalva: FatiaDePagamentos;
  /** Juros e multa pagos: o preço do atraso, em dinheiro */
  jurosEMulta: number;
  desconto: number;
}

export interface HistoricoPagamentos {
  pagamentos: PagamentoFeito[];
  resumo: ResumoPagamentos;
  periodo: { de: string; ate: string };
  /** Quando a leitura foi feita — ela é de agora, não de um espelho */
  lidoEm: string;
  /** Como a lista foi obtida do IXC, por extenso */
  comoFoiLido: string;
  avisos: string[];
}

// --- Fechamento de caixa ---

export interface LancamentoDoCaixa {
  id: number;
  data: string;
  valor: number;
  historico: string;
  tipo: 'ENTRADA' | 'SAIDA';
  conferido: boolean;
  conferidoEm: string | null;
  /** Quantas fotos de nota há. As imagens vêm sob demanda, uma a uma. */
  qtdNotas: number;
  observacao: string | null;
}

/**
 * Uma linha do histórico: o retrato que a conferência copiou do lançamento.
 *
 * Vem daqui, e não do IXC — achar um pagamento de meses atrás varrendo lá seria
 * mês a mês de leitura. O preço é que só aparece o que passou pela conferência.
 */
export interface ItemDoHistorico {
  id: string;
  idLancamentoIxc: number;
  dataLancamento: string | null;
  valor: string | null;
  historico: string | null;
  observacao: string | null;
  conferidoEm: string | null;
  qtdNotas: number;
}

/** Uma saída de dia já passado que ainda espera conferência. */
export interface SaidaAtrasada {
  id: string;
  idLancamentoIxc: number;
  dataLancamento: string | null;
  valor: string | null;
  historico: string | null;
  observacao: string | null;
  qtdNotas: number;
}

/** O que se faz com o dinheiro que está na rua. */
export type TipoMovimentoDaRua = 'NOTA' | 'TROCO' | 'REFORCO';

/** Um acerto da conta de quem está com dinheiro da empresa. */
export interface MovimentoDaRua {
  id: string;
  entregaId: string;
  tipo: TipoMovimentoDaRua;
  valor: string;
  /** Dia em que aconteceu — não o dia em que foi digitado. */
  data: string;
  observacao: string | null;
  /** Quantas fotos de nota há neste acerto. */
  qtdNotas: number;
  /** Título gerado no IXC pela despesa desta nota. */
  idFnApagarIxc: number | null;
  contaPagarId: string | null;
  fornecedorNome: string | null;
  /** Dia em que o IXC deu a saída do gasto no caixa. */
  gastoPagoEm: string | null;
  createdAt: string;
}

/**
 * A conta de quem levou dinheiro da gaveta.
 *
 * Ela raramente se resolve de uma vez: leva 100, traz nota de 50, fica com 50
 * para a próxima compra. O `saldo` é o que ainda está com a pessoa.
 */
export interface ContaDaRua {
  id: string;
  caixaId: number;
  pessoa: string;
  /** A entrega que abriu a conta. */
  valor: string;
  entregueEm: string;
  motivo: string | null;
  /** Preenchido quando o saldo zerou. */
  baixadoEm: string | null;
  observacao: string | null;
  /** Quanto ainda está com a pessoa: entrega + reforços − notas − trocos. */
  saldo: number;
  movimentos: MovimentoDaRua[];
  createdAt: string;
}

/** O que aconteceu com a conta a pagar que a nota lançou. */
export interface DespesaDaPrestacao {
  contaPagarId: string;
  idFnApagarIxc: number | null;
  fornecedorNome: string;
  /** Null quando a baixa no IXC não saiu. */
  pagoEm: string | null;
  paga: boolean;
  valor: number;
  avisos: string[];
}

/** O acerto como o servidor o devolve. */
export interface MovimentoLancado {
  movimento: MovimentoDaRua;
  /** Quanto sobrou com a pessoa depois deste lançamento. */
  saldo: number;
  /** O saldo zerou e a conta se fechou. */
  acertada: boolean;
  despesa: DespesaDaPrestacao | null;
}

export interface FechamentoCaixa {
  id: string;
  caixaId: number;
  caixaNome: string;
  de: string;
  ate: string;
  totalEntradas: string;
  totalSaidas: string;
  lancamentos: number;
  conferidos: number;
  totalNaRua: string;
  saldoInicial: string;
  saldoFinal: string;
  /** O que se contou na gaveta. Null = fechado sem contar. */
  saldoContado: string | null;
  observacao: string | null;
  fechadoPor: string | null;
  createdAt: string;
}

export interface ExtratoDoCaixa {
  caixa: { id: number; nome: string };
  de: string;
  ate: string;
  lancamentos: LancamentoDoCaixa[];
  /**
   * Saídas por conferir de dias anteriores ao recorte.
   *
   * A nota do acerto da rua chega quando chega, e o acerto entra pelo dia em
   * que aconteceu — que já passou. Sem esta lista, a saída que ele cria ia para
   * a fila de conferir num dia que a tela não mostra mais, e ficava pendente
   * para sempre.
   */
  atrasados: SaidaAtrasada[];
  naRua: ContaDaRua[];
  resumo: {
    entradas: number;
    saidas: number;
    lancamentos: number;
    conferidos: number;
    /** Só as saídas: são elas que se confere uma a uma. */
    qtdSaidas: number;
    saidasConferidas: number;
    naRua: number;
    pessoasNaRua: number;
    /** Null = não há de onde partir; `fechadoAte` diz por qual dos dois motivos. */
    saldoInicial: number | null;
    /**
     * Até que dia este caixa já está conferido, ou null se nunca foi fechado.
     * Com `saldoInicial` nulo e este preenchido, o período pedido começa dentro
     * de um fechamento que já existe.
     */
    fechadoAte: string | null;
    entregueNoPeriodo: number;
    trocoNoPeriodo: number;
    /**
     * O que as saídas do IXC já descontam por conta da prestação: gasto que
     * saiu na entrega e voltou a sair como conta a pagar baixada no caixa.
     */
    gastoLancadoNoPeriodo: number;
    /**
     * De que dia a gaveta está sendo somada (AAAA-MM-DD) — o dia seguinte ao
     * último fechamento, seja qual for o `de` pedido.
     */
    gavetaDesde: string | null;
    /**
     * O que deve estar na gaveta agora. Null enquanto falta o inicial.
     *
     * Não depende do recorte: conta desde o último fechamento, mesmo que a
     * tela esteja mostrando só os últimos dias.
     */
    saldoEsperado: number | null;
  };
  fechamentos: FechamentoCaixa[];
}

/** Dinheiro que mudou de conta, como o registro daqui o guarda. */
export interface TransferenciaEntreContas {
  id: string;
  origemId: number;
  origemNome: string;
  destinoId: number;
  destinoNome: string;
  valor: string;
  data: string;
  historico: string;
  forma: string | null;
  /** As duas linhas criadas no IXC. Uma sem a outra = escrita pela metade. */
  idMovimOrigem: number | null;
  idMovimDestino: number | null;
  criadoPor: string | null;
  createdAt: string;
}

export interface CaixasDoFechamento {
  tabela: string | null;
  caixas: CaixaIxc[];
  /** O caixa configurado para o pagamento em mãos, quando há um. */
  emUso: number | null;
}

// ---------------------------------------------------------------------------
// RH — a estante de documentos
// ---------------------------------------------------------------------------

/** O que há numa pasta: quantos papéis, e quantos pedem atenção. */
export interface ResumoDaPasta {
  qtd: number;
  vencidos: number;
  aVencer: number;
  ultimoEm: string | null;
}

/** Uma pasta da estante: a de um funcionário, a da empresa, ou uma avulsa. */
export interface PastaRh extends ResumoDaPasta {
  id: string;
  nome: string;
  apelido: string | null;
  funcao: string | null;
  daEmpresa: boolean;
  funcionarioId: string | null;
  cpf: string | null;
  /** Vazio = pasta de primeiro nível, a que aparece na estante. */
  paiId: string | null;
  /** Quantas pastas ela tem dentro. */
  subpastas: number;
  /** Funcionário que já saiu da empresa. A pasta continua. */
  inativo: boolean;
  /** Criada à mão: o RH também a renomeia e a apaga. O ADMIN mexe em todas. */
  avulsa: boolean;
  /**
   * O nome foi escrito à mão e o cadastro deixou de mandar nele. Só o ADMIN
   * marca isso, e só ele desfaz.
   */
  nomeManual: boolean;
  /** O mesmo resumo, contando o que está nas subpastas. */
  naArvore: ResumoDaPasta;
}

export interface EstanteRh {
  pastas: PastaRh[];
  /** Os tipos já usados, para sugerir em vez de perguntar. */
  tipos: string[];
}

/**
 * Uma licitação: a pasta em que se monta o que vai ser entregue.
 *
 * Os documentos entram nela por cópia, e não por atalho — ela é a fotografia
 * do que foi mandado naquele dia, e renovar a certidão na pasta da empresa no
 * mês seguinte não reescreve o que já foi entregue.
 */
export interface Licitacao {
  id: string;
  nome: string;
  criadaEm: string;
  /** Quantos documentos já estão dentro dela. */
  qtd: number;
  vencidos: number;
  aVencer: number;
}

/** Onde um documento está no prazo dele. */
export type PrazoDoDocumento = 'sem-prazo' | 'vencido' | 'a-vencer' | 'em-dia';

/** Um documento guardado, sem o arquivo — ele vem por uma rota só dele. */
export interface DocumentoRh {
  id: string;
  pastaId: string;
  titulo: string;
  tipo: string;
  descricao: string | null;
  /** "AAAA-MM" quando o documento é de um mês (recibo de pagamento). */
  competencia: string | null;
  emitidoEm: string | null;
  valeAte: string | null;
  arquivoNome: string;
  arquivoTipo: string;
  arquivoTamanho: number;
  prazo: PrazoDoDocumento;
  criadoPor: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Um recibo achado dentro do PDF da folha, e a pasta que ele parece ser. */
export interface ReciboDaFolha {
  paginas: number[];
  matricula: string;
  nome: string;
  cpf: string;
  cargo: string | null;
  pastaId: string | null;
  pastaNome: string | null;
  /** Como a pasta foi encontrada — para dar para discordar dela. */
  casouPor: 'cpf' | 'nome' | null;
  /** Este mês já está guardado nesta pasta: entraria repetido. */
  jaGuardado: boolean;
}

export interface AnaliseDosRecibos {
  competencia: string;
  competenciaEscrita: string | null;
  totalDePaginas: number;
  /** Páginas que não deram para reconhecer: contadas, não descartadas. */
  paginasSemDono: number[];
  itens: ReciboDaFolha[];
}

export interface RecibosGuardados {
  competencia: string;
  /** O lançamento que isto virou no histórico. Null = nada foi guardado. */
  loteId: string | null;
  guardados: Array<{ pasta: string; nome: string }>;
  pulados: Array<{ nome: string; motivo: string }>;
}

/** Uma vez em que o PDF do mês foi separado — e que dá para desfazer. */
export interface LoteDeRecibos {
  id: string;
  competencia: string;
  arquivoNome: string;
  /** Quantos entraram naquele dia. */
  quantidade: number;
  /** Quantos ainda estão guardados; menos que o de cima = alguém já apagou. */
  guardados: number;
  criadoPor: string | null;
  createdAt: string;
}

/** Uma nota anexada a um título no IXC — a aba "Arquivos" da tela dele. */
export interface NotaDoTitulo {
  id: number;
  descricao: string;
  /** "png", "pdf" — é o que decide como o navegador abre o arquivo. */
  extensao: string;
  data: string | null;
  usuario: string | null;
}
