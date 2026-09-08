import { Transform } from 'class-transformer';
import { IsString, MaxLength } from 'class-validator';

/**
 * Teto do bloco. Não é limite de banco — `TEXT` não tem —, é o tamanho a
 * partir do qual isto deixou de ser um recado no canto da tela.
 *
 * Sessenta mil caracteres são umas trinta páginas. Ninguém escreve isso num
 * bloco de notas de propósito; quem chega lá é um colar sem querer, e sem teto
 * nenhum um acidente desses vira o corpo de toda requisição de gravação até
 * alguém apagar.
 */
const LIMITE = 60_000;

export class SalvarAgendaDto {
  /**
   * O texto inteiro, do jeito que foi digitado — inclusive vazio, que é como
   * se apaga o bloco.
   *
   * O `trim` é só das pontas, e existe porque o campo termina em linhas em
   * branco quase sempre (quem escreve dá Enter e para). Guardar o miolo intacto
   * é o que faz o parágrafo voltar como foi escrito.
   */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(LIMITE, {
    message: `O bloco de notas passou de ${LIMITE.toLocaleString('pt-BR')} caracteres`,
  })
  texto!: string;
}
