import { IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Um perfil de acesso: o nome e, em cada módulo, "nao", "ver" ou "mexer".
 * As permissões são conferidas no service (`lerPermissoes`): módulo
 * desconhecido ou nível estranho vira "não abre", e nunca acesso a mais.
 */
export class CriarPerfilDto {
  @IsString() @MinLength(2) @MaxLength(60) nome!: string;
  @IsOptional() @IsString() @MaxLength(300) descricao?: string;
  @IsObject() permissoes!: Record<string, string>;
}

export class AtualizarPerfilDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) nome?: string;
  @IsOptional() @IsString() @MaxLength(300) descricao?: string | null;
  @IsOptional() @IsObject() permissoes?: Record<string, string>;
}
