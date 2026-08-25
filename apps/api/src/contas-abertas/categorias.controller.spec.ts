import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../auth/roles.decorator';
import { CategoriasController } from './categorias.controller';

/**
 * Quem pode trocar a etiqueta de um pagamento já feito.
 *
 * A conta paga já entrou em relatório: o mês foi fechado com ela naquela
 * fatia, e alguém leu aquele número. Reclassificar depois às vezes é o certo —
 * a etiqueta estava errada —, mas é decisão de quem responde pelo relatório.
 *
 * A regra mora numa anotação, que é o tipo de coisa que some num refatoramento
 * sem nada quebrar: o teste existe para que sumir custe um vermelho. E a
 * contraparte importa tanto quanto — a classificação da conta **em aberto** é
 * trabalho do dia a dia e não pode ganhar essa trava de carona.
 */
describe('CategoriasController — quem classifica o quê', () => {
  it('reclassificar pagamento já feito é só de ADMIN', () => {
    const papeis: UserRole[] | undefined = Reflect.getMetadata(
      ROLES_KEY,
      CategoriasController.prototype.reclassificarPagamento,
    );

    expect(papeis).toEqual([UserRole.ADMIN]);
  });

  it('classificar conta em aberto continua aberto a quem opera', () => {
    const papeis: UserRole[] | undefined = Reflect.getMetadata(
      ROLES_KEY,
      CategoriasController.prototype.classificar,
    );
    const emLote: UserRole[] | undefined = Reflect.getMetadata(
      ROLES_KEY,
      CategoriasController.prototype.classificarEmLote,
    );

    expect(papeis).toBeUndefined();
    expect(emLote).toBeUndefined();
  });
});
