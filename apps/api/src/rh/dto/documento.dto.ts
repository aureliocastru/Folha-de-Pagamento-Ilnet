import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** Data de calendário, sem hora e sem fuso: "AAAA-MM-DD". */
const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** O que é comum a guardar e a corrigir: tudo menos o arquivo. */
export class DadosDoDocumentoDto {
  @IsString({ message: 'Diga como este documento se chama.' })
  @MinLength(2, { message: 'O título ficou curto demais.' })
  @MaxLength(160)
  titulo!: string;

  /**
   * A prateleira. Texto livre de propósito: a lista de tipos de uma casa não é
   * a de outra, e uma enumeração fechada obrigaria a mexer no código para
   * guardar um papel novo. A tela sugere os que já existem.
   */
  @IsString({ message: 'Diga de que tipo é este documento.' })
  @MinLength(2, { message: 'O tipo ficou curto demais.' })
  @MaxLength(60)
  tipo!: string;

  @IsOptional() @IsString() @MaxLength(600) descricao?: string;

  @IsOptional()
  @Matches(DIA, { message: 'A data de emissão precisa ser AAAA-MM-DD.' })
  emitidoEm?: string;

  @IsOptional()
  @Matches(DIA, { message: 'A validade precisa ser AAAA-MM-DD.' })
  valeAte?: string;
}

/** Um documento chegando: os dados mais o arquivo. */
export class GuardarDocumentoDto extends DadosDoDocumentoDto {
  /** Em que pasta ele entra. */
  @IsUUID('4', { message: 'Escolha a pasta.' })
  pastaId!: string;

  /**
   * "AAAA-MM" quando o documento é de um mês — recibo de pagamento, folha. É
   * ela que impede o mesmo recibo de entrar duas vezes na mesma pasta.
   */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, { message: 'A competência precisa ser AAAA-MM.' })
  competencia?: string;

  @IsString() @MinLength(1) @MaxLength(255) arquivoNome!: string;

  /**
   * O arquivo inteiro, como data URL ("data:application/pdf;base64,…") — o
   * mesmo caminho pelo qual a foto da nota já chega. O tipo vem daqui e é
   * conferido no serviço, e não do que o navegador afirmou no nome.
   */
  @IsString({ message: 'Escolha o arquivo.' })
  @Matches(/^data:[-\w.+]+\/[-\w.+]+;base64,/, {
    message: 'O arquivo não chegou num formato que eu saiba ler.',
  })
  arquivo!: string;

  /**
   * Guardar o Word (ou a planilha) já convertido em PDF.
   *
   * É escolha de quem sobe, e não regra da casa: o mesmo .docx que se manda
   * para a licitação em PDF — porque em PDF ele não se altera no caminho e
   * abre igual em qualquer máquina — é o que se guarda em Word quando ainda
   * vai ser editado. Fora do Office o pedido é ignorado em silêncio: não há o
   * que converter num PDF nem numa foto.
   */
  @IsOptional() @IsBoolean() converterParaPdf?: boolean;
}

/**
 * O documento novo que toma o lugar de um que venceu.
 *
 * Traz o arquivo, como quem guarda um documento pela primeira vez — porque é
 * isso que ele é: a certidão de setembro não é a de agosto corrigida, é outro
 * papel. O que se herda do antigo é o nome e o tipo, que a tela já preenche;
 * as datas, não, porque são justamente elas que mudaram.
 */
export class SubstituirDocumentoDto extends DadosDoDocumentoDto {
  @IsString() @MinLength(1) @MaxLength(255) arquivoNome!: string;

  @IsString({ message: 'Escolha o arquivo novo.' })
  @Matches(/^data:[-\w.+]+\/[-\w.+]+;base64,/, {
    message: 'O arquivo não chegou num formato que eu saiba ler.',
  })
  arquivo!: string;
}

/**
 * Só os dados: o arquivo guardado não se troca, se apaga e se sobe de novo.
 *
 * A pasta, sim: é o único jeito de pôr numa subpasta nova o que já estava
 * guardado.
 */
export class EditarDocumentoDto extends DadosDoDocumentoDto {
  @IsOptional()
  @IsUUID('4', { message: 'Pasta inválida.' })
  pastaId?: string;
}

/** Uma pasta criada ou renomeada à mão. */
export class PastaDto {
  @IsString({ message: 'Diga o nome da pasta.' })
  @MinLength(2, { message: 'O nome ficou curto demais.' })
  @MaxLength(120)
  nome!: string;

  /**
   * O CPF do titular. Só serve para o recibo de pagamento achar esta pasta
   * sozinho quando o PDF do mês for separado — e é por isso que ele vale mais
   * que o nome: grafia muda, CPF não.
   */
  @IsOptional() @IsString() @MaxLength(20) cpf?: string;

  /**
   * Dentro de qual pasta ela nasce. Vazio = na estante, no primeiro nível.
   */
  @IsOptional()
  @IsUUID('4', { message: 'Pasta inválida.' })
  paiId?: string;

  /**
   * Desfaz o nome escrito à mão: o cadastro volta a mandar nesta pasta.
   *
   * Só faz sentido renomeando, e só na pasta que veio do cadastro. Sem esta
   * saída, um administrador que renomeasse a pasta do Fulano fecharia a porta
   * atrás de si — o nome do IXC nunca mais apareceria ali.
   */
  @IsOptional()
  @IsBoolean()
  seguirCadastro?: boolean;
}

/** O PDF de recibos chegando para leitura. */
export class AnalisarRecibosDto {
  @IsString({ message: 'Escolha o PDF dos recibos.' })
  @Matches(/^data:application\/pdf;base64,/, {
    message: 'O arquivo de recibos precisa ser um PDF.',
  })
  arquivo!: string;
}

/** Um recibo conferido na tela: as páginas dele e a pasta que vai recebê-lo. */
export class ItemDoReciboDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(2000, { each: true })
  paginas!: number[];

  @IsUUID('4', { message: 'Escolha a pasta deste recibo.' })
  pastaId!: string;

  /** Só para a resposta dizer de quem era o recibo que deu certo ou não. */
  @IsString() @MaxLength(120) nome!: string;
}

/** O que a tela confirmou: o mesmo PDF, mais o destino de cada recibo. */
export class GuardarRecibosDto extends AnalisarRecibosDto {
  @Matches(/^\d{4}-\d{2}$/, { message: 'A competência precisa ser AAAA-MM.' })
  competencia!: string;

  /** O nome do arquivo que veio da contabilidade, para o histórico. */
  @IsOptional() @IsString() @MaxLength(255) arquivoNome?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Nenhum recibo foi marcado para guardar.' })
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ItemDoReciboDto)
  itens!: ItemDoReciboDto[];
}

/** Uma licitação nova: por enquanto ela é o nome da pasta dela. */
export class LicitacaoDto {
  @IsString({ message: 'Diga o nome da licitação.' })
  @MinLength(2, { message: 'O nome ficou curto demais.' })
  @MaxLength(120)
  nome!: string;
}

/**
 * Os documentos que vão para a pasta da licitação.
 *
 * O teto é o mesmo do serviço, e existe porque cada item traz o arquivo inteiro
 * para ser regravado: sem ele, um clique em "marcar todos" numa estante grande
 * viraria dezenas de megabytes num pedido só.
 */
export class CopiarParaLicitacaoDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Marque ao menos um documento.' })
  @ArrayMaxSize(60)
  @IsUUID('4', { each: true, message: 'Documento inválido.' })
  documentoIds!: string[];
}

/**
 * Documentos mudando de divisória, de uma vez.
 *
 * Aqui não viaja arquivo nenhum — só os códigos —, e por isso o teto é bem mais
 * largo que o da licitação: arrumar uma pasta de duzentos papéis é justamente o
 * caso em que mover um por um não se faz.
 */
export class MoverDocumentosDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Marque ao menos um documento.' })
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true, message: 'Documento inválido.' })
  documentoIds!: string[];

  /** Para onde eles vão. */
  @IsUUID('4', { message: 'Escolha a pasta de destino.' })
  pastaId!: string;
}

/**
 * Documentos saindo da estante de uma vez.
 *
 * O teto é menor que o de mover de propósito. Mover é reversível — o papel está
 * na outra gaveta —, e apagar não é: quinhentos de uma vez é mais estrago do
 * que qualquer confirmação de tela consegue deixar claro.
 */
export class ApagarDocumentosDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Marque ao menos um documento.' })
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true, message: 'Documento inválido.' })
  documentoIds!: string[];
}

/**
 * Uma nota fiscal de entrada chegando, ou sendo corrigida.
 *
 * O arquivo vem junto ao guardar e fica de fora ao corrigir: papel guardado não
 * se troca por cima — apaga-se a nota e sobe-se de novo, que é o que deixa
 * rastro de que o arquivo mudou.
 */
export class NotaFiscalDto {
  /** O mês a que a nota pertence, e por onde ela vai à contabilidade. */
  @Matches(/^\d{4}-\d{2}$/, { message: 'O mês precisa ser AAAA-MM.' })
  competencia!: string;

  @IsString({ message: 'Diga de quem é a nota.' })
  @MinLength(2, { message: 'O nome do fornecedor ficou curto demais.' })
  @MaxLength(160)
  fornecedor!: string;

  /** Texto, e não número: nota tem série e zero à esquerda. */
  @IsOptional() @IsString() @MaxLength(40) numero?: string;

  /**
   * Quanto deu. É a soma disto que se confere com a contabilidade, e é por isso
   * que zero não passa: nota de zero real não existe, e o que existe é o campo
   * deixado em branco sem ninguém perceber.
   */
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Diga o valor da nota.' })
  @IsPositive({ message: 'O valor da nota precisa ser maior que zero.' })
  valor!: number;

  /** O dia impresso na nota. */
  @IsOptional()
  @Matches(DIA, { message: 'A data de emissão precisa ser AAAA-MM-DD.' })
  emitidaEm?: string;

  @IsOptional() @IsString() @MaxLength(600) descricao?: string;

  @IsOptional() @IsString() @MinLength(1) @MaxLength(255) arquivoNome?: string;

  /**
   * O arquivo, como data URL. Obrigatório ao guardar; ausente ao corrigir, que
   * é quando só os dados mudam.
   */
  @IsOptional()
  @IsString()
  @Matches(/^data:[-\w.+]+\/[-\w.+]+;base64,/, {
    message: 'O arquivo não chegou num formato que eu saiba ler.',
  })
  arquivo?: string;
}
