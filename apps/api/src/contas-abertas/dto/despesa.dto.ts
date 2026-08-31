import { Transform, Type } from 'class-transformer';
import { TIPOS_CHAVE_PIX } from '../../ixc/ixc.financeiro';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * Pagar um título que já existe no IXC.
 *
 * `BANCO` aprova na auditoria e deixa a conta pronta para o banco pagar;
 * `EM_MAOS` aprova e dá a baixa na conta do caixa, deixando-a quitada no ato.
 */
export class PagarTituloDto {
  /**
   * Conta de onde o dinheiro sai. É ela que decide o que acontece: a do
   * ModoBank só é aprovada (o pagamento sai pela tela dele no IXC); qualquer
   * outra é aprovada e baixada aqui.
   */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  contaPagamento?: number;

  /** Dia do pagamento (AAAA-MM-DD). Vazio = hoje. */
  @IsOptional() @IsISO8601() data?: string;

  /**
   * O dinheiro já saiu — este pagamento está sendo **registrado**, não feito.
   *
   * É o que destrava a baixa na conta do ModoBank. Ela normalmente só é
   * aprovada, porque quem paga é o banco e dar por saído o que ainda está lá
   * seria mentira. Quando quem clica afirma que a saída já aconteceu, não há
   * pagamento futuro a esperar — e a baixa aqui é a mesma que se daria à mão
   * na tela do IXC, com a data em que o dinheiro de fato saiu.
   */
  @IsOptional() @IsBoolean() jaSaiu?: boolean;

  /**
   * Desconto por pagar adiantado, em reais.
   *
   * Não muda o que o título vale: o que ele muda é quanto sai do caixa. Vai
   * ao IXC como desconto da baixa, e é por isso que a movimentação financeira
   * sai pelo líquido — que é o valor que a conciliação acha no extrato.
   */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(0)
  desconto?: number;

  /** O que aparece no histórico do lançamento no IXC. */
  @IsOptional() @IsString() @MaxLength(200) historico?: string;

  /** @deprecated A conta escolhida manda; fica por compatibilidade. */
  @IsOptional() @IsIn(['BANCO', 'EM_MAOS']) forma?: 'BANCO' | 'EM_MAOS';
}

/** Pagar várias contas de uma vez, todas pela mesma conta. */
export class PagarLoteDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Type(() => Number)
  idsFnApagar!: number[];

  /** De onde sai o dinheiro de todas elas. Ver `PagarTituloDto`. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  contaPagamento?: number;

  /** Dia do pagamento (AAAA-MM-DD). Vazio = hoje. */
  @IsOptional() @IsISO8601() data?: string;

  /** O dinheiro de todas elas já saiu. Ver `PagarTituloDto`. */
  @IsOptional() @IsBoolean() jaSaiu?: boolean;

  /**
   * Desconto por pagar adiantado. Só é aceito quando o lote tem uma conta:
   * ver `PagamentosService.pagarEmLote`.
   */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(0)
  desconto?: number;

  /** @deprecated A conta escolhida manda; fica por compatibilidade. */
  @IsOptional() @IsIn(['BANCO', 'EM_MAOS']) forma?: 'BANCO' | 'EM_MAOS';
}

/** Apagar vários títulos de uma vez. */
export class ExcluirLoteDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Type(() => Number)
  idsFnApagar!: number[];
}

/** O que dá para mudar num título que ainda está em aberto no IXC. */
export class EditarTituloDto {
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(0.01)
  valor?: number;

  @IsOptional() @IsISO8601() dataVencimento?: string;

  @IsOptional() @IsString() @MaxLength(500) observacao?: string;

  @IsOptional() @IsString() @MaxLength(40) tipoPagamento?: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  contaPagamento?: number;

  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  contaContabil?: number;

  @IsOptional() @IsString() @MaxLength(600) chavePix?: string;

  @IsOptional() @IsString() @MaxLength(60) codigoBarras?: string;

  @IsOptional() @IsString() @MaxLength(40) documento?: string;
}

/**
 * Uma parcela de uma nota lançada em vezes. Cada uma vira uma conta a pagar
 * própria no IXC — é assim que o financeiro de lá entende parcelamento, e é o
 * que deixa pagar a primeira sem mexer nas outras.
 */
export class ParcelaDaDespesaDto {
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(0.01)
  valor!: number;

  /** Vencimento desta parcela (AAAA-MM-DD). */
  @IsISO8601() dataVencimento!: string;

  /** Código do boleto desta parcela, quando cada uma tem o seu. */
  @IsOptional() @IsString() @MaxLength(60) codigoBarras?: string;

  /** Documento desta parcela, quando cada uma tem o seu. */
  @IsOptional() @IsString() @MaxLength(40) documento?: string;

  /**
   * Como esta parcela se chama na observação do IXC — "13/120".
   *
   * Sem isto o número sai da posição na lista, o que só serve para nota nova.
   * Num consórcio já em andamento a primeira a lançar é a 13 de 120, e chamá-la
   * de "1/85" faria a conta do sistema não bater com o boleto do grupo.
   */
  @IsOptional() @IsString() @MaxLength(20) rotulo?: string;
}

/**
 * Uma conta a pagar lançada à mão: energia, aluguel, compra de material.
 *
 * O fornecedor é escolhido entre os que já existem no IXC — é ele que o
 * `fn_apagar` exige, e criar cadastro novo daqui só para lançar uma conta
 * encheria a base do IXC de duplicados.
 */
export class CriarDespesaDto {
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  idFornecedorIxc!: number;

  /** Como o fornecedor se chama, para a conta guardar o nome do dia em que foi lançada. */
  @IsString() @MinLength(2) @MaxLength(200) fornecedorNome!: string;

  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(0.01)
  valor!: number;

  /** Dia em que a conta foi emitida (AAAA-MM-DD). Vazio = hoje. */
  @IsOptional() @IsISO8601() dataEmissao?: string;

  /** Dia em que ela vence (AAAA-MM-DD). Vazio = hoje. */
  @IsOptional() @IsISO8601() dataVencimento?: string;

  /** O que é essa conta — vai para o campo `obs` do IXC. */
  @IsString() @MinLength(3) @MaxLength(500) observacao!: string;

  /**
   * A etiqueta desta casa. Só pode ser gravada depois que o IXC devolve o
   * número do título, então ela é aplicada no fim, com a conta já criada.
   */
  @IsOptional() @IsUUID() categoriaId?: string | null;

  /** Pix, Dinheiro, Boleto… Vazio = o padrão das Configurações. */
  @IsOptional() @IsString() @MaxLength(40) tipoPagamento?: string;

  /** Conta contábil (id_conta). Vazio = a de avulsos da configuração. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  contaContabil?: number;

  /**
   * Linha digitável do boleto. Vai como só dígitos para o IXC — é com ela que
   * ele paga; sem ela, a conta chega lá sem como ser paga por boleto.
   */
  @IsOptional() @IsString() @MaxLength(60) codigoBarras?: string;

  /** Número do documento da despesa, quando existe. */
  @IsOptional() @IsString() @MaxLength(40) documento?: string;

  /** Número da nota fiscal, quando a despesa tem uma. */
  @IsOptional() @IsString() @MaxLength(40) numeroNota?: string;

  /**
   * Chave PIX desta conta. Costuma ser o "copia e cola" lido de um QR Code de
   * cobrança, que vale só para este pagamento. Vazio = a chave do cadastro do
   * fornecedor no IXC. O limite cabe um EMV inteiro.
   */
  @IsOptional() @IsString() @MaxLength(600) chavePix?: string;

  /** Tipo da chave acima, como o IXC o nomeia. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : value))
  @IsIn([...TIPOS_CHAVE_PIX])
  tipoChavePix?: string;

  /** Conta de onde o dinheiro sai (`id_contas`). Vazio = a da configuração. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  contaPagamento?: number;

  /**
   * As parcelas da nota. Vindo preenchido, `valor` e `dataVencimento` acima
   * valem só como a soma e a primeira data que a tela mostrou: quem manda são
   * estas linhas, e cada uma vira uma conta a pagar no IXC.
   *
   * O teto de 240 é o mesmo da tela: vinte anos de parcelas mensais. Era 60,
   * pensando em nota parcelada, mas consórcio de máquina agrícola passa de 100
   * parcelas com facilidade — um trator em 120 meses é comum. Acima de 240 é
   * engano de digitação.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(240)
  @ValidateNested({ each: true })
  @Type(() => ParcelaDaDespesaDto)
  parcelas?: ParcelaDaDespesaDto[];

  /**
   * Esta conta já foi paga antes de existir no IXC.
   *
   * É o caso de quem pagou pela conta bancária na hora — um boleto no
   * aplicativo, um PIX no celular — e só depois vem lançar. Sem isto, o
   * lançamento nasce em aberto e alguém precisa lembrar de voltar para
   * aprová-lo e baixá-lo, com o risco de o mesmo dinheiro ser pago de novo.
   *
   * Marcado, a conta é criada, aprovada na auditoria e baixada como paga na
   * mesma ida — a mesma baixa que se daria à mão no IXC.
   */
  @IsOptional() @IsBoolean() jaPaga?: boolean;

  /**
   * Dia em que o dinheiro saiu (AAAA-MM-DD). Só vale com `jaPaga`; vazio cai no
   * vencimento, e na falta dele em hoje.
   *
   * É o dia do extrato, não o de hoje: quem lança na sexta uma conta paga na
   * segunda precisa que a baixa no IXC caia na segunda, ou a conciliação do mês
   * não fecha.
   */
  @IsOptional() @IsISO8601() dataPagamento?: string;
}

/**
 * A nota de uma conta a pagar, subindo para o IXC.
 *
 * Chega como data URL, que é o que o navegador dá tanto do arquivo escolhido
 * quanto do print colado da área de transferência — e o segundo não tem nome
 * nenhum, por isso o nome é opcional aqui.
 */
export class AnexarNotaDto {
  @IsString({ message: 'Escolha ou cole a nota.' })
  @Matches(/^data:[-\w.+]+\/[-\w.+]+;base64,/, {
    message: 'O arquivo não chegou num formato que eu saiba ler.',
  })
  arquivo!: string;

  @IsOptional() @IsString() @MaxLength(255) nome?: string;

  /** O que aparece na lista de arquivos do título, no IXC. */
  @IsOptional() @IsString() @MaxLength(100) descricao?: string;
}
