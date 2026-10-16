import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Carregando, Janela } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { mesAtual } from '../../lib/folha';
import { modulosDoUsuario } from '../../lib/modulos';
import type { CategoriaDespesa, Patrocinado } from '../../lib/types';
import { NovaDespesa } from '../contas-pagar/NovaDespesa';
import { mesPorExtenso } from './comum';

/**
 * Quem pode pagar daqui: quem abre o Contas a Pagar. O pagamento é uma conta a
 * pagar como qualquer outra, e é aquele módulo que a API exige para lançá-la —
 * quem abre só o patrocínio vê o que já se mandou, e não paga.
 */
export function usePodePagar(): boolean {
  const { usuario } = useAuth();
  return modulosDoUsuario(usuario).some((m) => m.id === 'contas-pagar');
}

/**
 * Pagar o patrocínio do mês: a mesma tela de lançar conta do Contas a Pagar,
 * já com o fornecedor do patrocinado, o valor que falta no mês, a descrição e
 * a categoria de patrocínio (quando existe uma com esse nome). O que só quem
 * paga sabe — a forma, a conta de onde sai, se já saiu — fica com ele.
 */
export function PagarPatrocinado({
  patrocinado,
  mes = mesAtual(),
  valor,
  onFechar,
}: {
  patrocinado: Pick<Patrocinado, 'id' | 'nome' | 'idFornecedorIxc' | 'fornecedorNome'>;
  /** "AAAA-MM" — o mês que este pagamento quita. */
  mes?: string;
  /** Quanto pagar. Vazio = a pessoa digita. */
  valor?: number | null;
  onFechar: () => void;
}) {
  const qc = useQueryClient();

  // A tela de lançar lê o que veio pronto uma vez só, ao abrir: a categoria
  // tem de estar na mão antes dela.
  const categorias = useQuery({
    queryKey: ['categorias-despesa'],
    queryFn: async () => (await api.get<CategoriaDespesa[]>('/categorias-despesa')).data,
  });

  if (!patrocinado.idFornecedorIxc) return null;

  if (categorias.isLoading) {
    return (
      <Janela titulo="Pagar patrocínio" onFechar={onFechar}>
        <Carregando />
      </Janela>
    );
  }

  const categoria = (categorias.data ?? []).find(
    (c) => c.ativa && !c.temFilhas && /patroc/i.test(c.nome),
  );

  return (
    <NovaDespesa
      inicial={{
        fornecedor: {
          idFornecedor: patrocinado.idFornecedorIxc,
          nome: patrocinado.fornecedorNome ?? patrocinado.nome,
        },
        valor: valor && valor > 0 ? valor.toFixed(2) : undefined,
        // Hífen, e não travessão: o IXC mostra o travessão como "?".
        observacao: `Patrocínio ${patrocinado.nome} - ${mesPorExtenso(mes)}`,
        categoriaId: categoria?.id ?? null,
        vencimento: vencimentoDoMes(mes),
      }}
      onLancada={() => {
        void qc.invalidateQueries({ queryKey: ['patrocinio-pagamentos'] });
        void qc.invalidateQueries({ queryKey: ['patrocinado', patrocinado.id] });
      }}
      onFechar={onFechar}
    />
  );
}

/**
 * O vencimento que põe o título no mês certo — é pelo vencimento que a aba
 * Pagamentos sabe de que mês ele é. O mês de hoje vence hoje; um mês atrasado
 * vence no último dia dele; um adiantado, no primeiro.
 */
function vencimentoDoMes(mes: string): string {
  const hoje = new Date();
  const doMes = mesAtual();
  if (mes === doMes) {
    return `${doMes}-${String(hoje.getDate()).padStart(2, '0')}`;
  }
  if (mes > doMes) return `${mes}-01`;
  const [ano, m] = mes.split('-').map(Number);
  const ultimo = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  return `${mes}-${String(ultimo).padStart(2, '0')}`;
}
