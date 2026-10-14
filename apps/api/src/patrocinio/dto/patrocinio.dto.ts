import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
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
import { FormaPagamento } from '@prisma/client';

/** Data de calendário, sem hora e sem fuso: "AAAA-MM-DD". */
const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** Campo de texto opcional: vazio vira null, que é o que apaga no banco. */
const vazioViraNulo = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? null : value;

/** Os dados do patrocinado — comuns a cadastrar e a corrigir. */
export class DadosDoPatrocinadoDto {
  @IsOptional() @Transform(vazioViraNulo) @IsString() @MaxLength(160) projeto?: string | null;
  @IsOptional() @Transform(vazioViraNulo) @IsString() @MaxLength(30) cpfCnpj?: string | null;
  @IsOptional() @Transform(vazioViraNulo) @IsString() @MaxLength(160) responsavel?: string | null;
  @IsOptional() @Transform(vazioViraNulo) @IsString() @MaxLength(40) telefone?: string | null;

  @IsOptional()
  @Transform(vazioViraNulo)
  @IsEmail({}, { message: 'O e-mail não parece um e-mail.' })
  email?: string | null;

  @IsOptional() @Transform(vazioViraNulo) @IsString() @MaxLength(80) instagram?: string | null;
  @IsOptional() @Transform(vazioViraNulo) @IsString() @MaxLength(80) cidade?: string | null;

  /** Quanto se combinou por mês. Vazio = não se combinou valor fixo. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? null : Number(value)))
  @IsNumber({}, { message: 'O valor mensal precisa ser um número.' })
  @Min(0)
  valorMensal?: number | null;

  @IsOptional()
  @Transform(vazioViraNulo)
  @Matches(DIA, { message: 'O início precisa ser AAAA-MM-DD.' })
  inicio?: string | null;

  @IsOptional()
  @Transform(vazioViraNulo)
  @Matches(DIA, { message: 'O fim precisa ser AAAA-MM-DD.' })
  fim?: string | null;

  @IsOptional() @Transform(vazioViraNulo) @IsString() @MaxLength(2000) observacoes?: string | null;
}

/**
 * Quem recebe o dinheiro, quando ainda não tem cadastro na aba Diaristas.
 *
 * É ele que vai para o IXC como fornecedor: no time de futsal, quem recebe é o
 * técnico, com o CPF e o PIX dele — e não o nome do time.
 */
export class NovoRecebedorDto {
  @IsString({ message: 'Diga o nome de quem recebe.' })
  @MinLength(2, { message: 'O nome de quem recebe ficou curto demais.' })
  @MaxLength(160)
  nome!: string;

  @IsOptional() @IsString() @MaxLength(30) cpfCnpj?: string;
  @IsOptional() @IsString() @MaxLength(40) telefone?: string;
  @IsOptional() @IsString() @MaxLength(140) chavePix?: string;
  @IsOptional() @IsEnum(FormaPagamento) formaPagamento?: FormaPagamento;
}

/**
 * O cadastro novo. Por onde ele recebe é obrigatório, de um dos dois jeitos: um
 * diarista que já existe, ou os dados de quem recebe para criar um.
 */
export class CriarPatrocinadoDto extends DadosDoPatrocinadoDto {
  @IsString({ message: 'Diga como o patrocinado se chama.' })
  @MinLength(2, { message: 'O nome ficou curto demais.' })
  @MaxLength(160)
  nome!: string;

  @IsOptional() @IsUUID('4', { message: 'Escolha o diarista.' }) diaristaId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => NovoRecebedorDto)
  recebedor?: NovoRecebedorDto;
}

export class AtualizarPatrocinadoDto extends DadosDoPatrocinadoDto {
  @IsOptional()
  @IsString({ message: 'Diga como o patrocinado se chama.' })
  @MinLength(2, { message: 'O nome ficou curto demais.' })
  @MaxLength(160)
  nome?: string;

  @IsOptional() @IsBoolean() ativo?: boolean;

  /**
   * Trocar (ou religar) o cadastro por onde ele recebe. Só um diarista que
   * já existe: para criar outro, o caminho é a aba Diaristas.
   */
  @IsOptional() @IsUUID('4', { message: 'Escolha o diarista.' }) diaristaId?: string;
}

/** Um arquivo chegando: como ele se chama na lista, e o arquivo em si. */
export class GuardarArquivoDto {
  @IsOptional() @IsString() @MaxLength(160) titulo?: string;

  @IsString() @MinLength(1) @MaxLength(255) arquivoNome!: string;

  /**
   * O arquivo inteiro, como data URL ("data:application/pdf;base64,…") — o
   * caminho de todo arquivo desta casa. O tipo vem daqui e é conferido no
   * serviço.
   */
  @IsString({ message: 'Escolha o arquivo.' })
  @Matches(/^data:[-\w.+]+\/[-\w.+]+;base64,/, {
    message: 'O arquivo não chegou num formato que eu saiba ler.',
  })
  arquivo!: string;
}

/** O contrato físico, escaneado. */
export class GuardarEscaneadoDto {
  @IsString() @MinLength(1) @MaxLength(255) arquivoNome!: string;

  @IsString({ message: 'Escolha o arquivo do contrato.' })
  @Matches(/^data:[-\w.+]+\/[-\w.+]+;base64,/, {
    message: 'O arquivo não chegou num formato que eu saiba ler.',
  })
  arquivo!: string;

  /** O dia escrito no papel, quando se sabe. */
  @IsOptional()
  @Transform(vazioViraNulo)
  @Matches(DIA, { message: 'A data da assinatura precisa ser AAAA-MM-DD.' })
  assinadoEm?: string | null;
}
