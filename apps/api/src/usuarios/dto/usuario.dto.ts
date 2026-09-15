import { UserRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';
import { MODULOS } from '../../auth/modulos.guard';

const email = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.toLowerCase().trim() : value;

export class CriarUsuarioDto {
  @IsString()
  @MinLength(2)
  nome!: string;

  @Transform(email)
  @IsEmail({}, { message: 'E-mail inválido' })
  email!: string;

  @IsString()
  @MinLength(8, { message: 'A senha precisa de pelo menos 8 caracteres' })
  senha!: string;

  /** Padrão RH: usa o app inteiro, menos o gerenciamento de logins. */
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  /** Os módulos que este login abre. Vazio = todos. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MODULOS.length)
  @IsIn(MODULOS as unknown as string[], { each: true })
  modulos?: string[];

  /** Um perfil criado. Com ele, o perfil manda nos módulos. */
  @IsOptional()
  @IsUUID()
  perfilId?: string;
}

export class AtualizarUsuarioDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  nome?: string;

  @IsOptional()
  @Transform(email)
  @IsEmail({}, { message: 'E-mail inválido' })
  email?: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsBoolean()
  ativo?: boolean;

  /** Os módulos que este login abre. Vazio = todos. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MODULOS.length)
  @IsIn(MODULOS as unknown as string[], { each: true })
  modulos?: string[];

  /** Preenchido, define uma nova senha. */
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'A senha precisa de pelo menos 8 caracteres' })
  senha?: string;

  /** Um perfil criado; `null` volta para o perfil fixo. */
  @IsOptional()
  @IsUUID()
  perfilId?: string | null;
}

export class TrocarSenhaDto {
  @IsString()
  senhaAtual!: string;

  @IsString()
  @MinLength(8, { message: 'A senha precisa de pelo menos 8 caracteres' })
  novaSenha!: string;
}
