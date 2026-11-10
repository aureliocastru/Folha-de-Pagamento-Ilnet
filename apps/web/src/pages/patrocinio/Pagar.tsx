import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CampoDeData } from '../../components/CampoDeData';
import { CampoDinheiro, Carregando, Janela } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { mesAtual } from '../../lib/folha';
import { formatBRL, hojeEmBrasilia } from '../../lib/format';
import { acessosDoUsuario } from '../../lib/modulos';
import type { CategoriaDespesa, Patrocinado } from '../../lib/types';
import { NovaDespesa } from '../contas-pagar/NovaDespesa';
import { Campo, mesPorExtenso } from './comum';

/**
 * Quem pode pagar daqui: quem abre o Contas a Pagar. O pagamento é uma conta a
 * pagar como qualquer outra, e é aquele módulo que a API exige para lançá-la —
 * quem abre só o patrocínio vê o que já se mandou, e não paga.
 */
export function usePodePagar(): boolean {
  const { usuario } = useAuth();
  // O acesso, e não o módulo: quem só faz a folha também entra no Contas a
  // Pagar, mas não lança conta.
  return acessosDoUsuario(usuario).includes('contas-pagar');
}

/** O avulso, antes da tela de lançar: para quê, quanto e quando. */
interface PedidoAvulso {
  motivo: string;
  valor: string;
  dia: string;
}

/**
 * Pagar o patrocínio do mês: a mesma tela de lançar conta do Contas a Pagar,
 * já com o fornecedor do patrocinado, o valor que falta no mês, a descrição e
 * a categoria de patrocínio (quando existe uma com esse nome). O que só quem
 * paga sabe — a forma, a conta de onde sai, se já saiu — fica com ele.
 *
 * O avulso não tem mês nem valor combinado: antes da tela de lançar, ele
 * pergunta para quê é o dinheiro, quanto e quando. É o "para quê" que vira a
 * descrição do título — e o "referente a" da nota que o patrocinado assina.
 */
export function PagarPatrocinado({
  patrocinado,
  mes = mesAtual(),
  valor,
  onFechar,
}: {
  patrocinado: Pick<Patrocinado, 'id' | 'tipo' | 'nome' | 'idFornecedorIxc' | 'fornecedorNome'>;
  /** "AAAA-MM" — o mês que este pagamento quita. */
  mes?: string;
  /** Quanto pagar. Vazio = a pessoa digita. */
  valor?: number | null;
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const avulso = patrocinado.tipo === 'AVULSO';
  const [pedido, setPedido] = useState<PedidoAvulso | null>(null);

  // A tela de lançar lê o que veio pronto uma vez só, ao abrir: a categoria
  // tem de estar na mão antes dela.
  const categorias = useQuery({
    queryKey: ['categorias-despesa'],
    queryFn: async () => (await api.get<CategoriaDespesa[]>('/categorias-despesa')).data,
  });

  if (!patrocinado.idFornecedorIxc) return null;

  if (avulso && !pedido) {
    return <PerguntarAvulso nome={patrocinado.nome} onContinuar={setPedido} onFechar={onFechar} />;
  }

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
        // Hífen, e não travessão: o IXC mostra o travessão como "?".
        ...(pedido
          ? {
              valor: pedido.valor,
              observacao: `Patrocínio ${patrocinado.nome} - ${semTravessao(pedido.motivo)}`,
              vencimento: pedido.dia,
            }
          : {
              valor: valor && valor > 0 ? valor.toFixed(2) : undefined,
              observacao: `Patrocínio ${patrocinado.nome} - ${mesPorExtenso(mes)}`,
              vencimento: vencimentoDoMes(mes),
            }),
        categoriaId: categoria?.id ?? null,
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

/**
 * O primeiro passo do avulso. Três perguntas só, e o resto (a forma, a conta
 * de onde sai) fica na tela de lançar, que abre em seguida já preenchida.
 */
function PerguntarAvulso({
  nome,
  onContinuar,
  onFechar,
}: {
  nome: string;
  onContinuar: (p: PedidoAvulso) => void;
  onFechar: () => void;
}) {
  const [motivo, setMotivo] = useState('');
  const [valor, setValor] = useState('');
  const [dia, setDia] = useState(hojeEmBrasilia);

  const pronto = motivo.trim().length >= 3 && Number(valor) > 0 && !!dia;

  return (
    <Janela titulo={`Pagamento avulso — ${nome}`} onFechar={onFechar}>
      <form
        className="p-5 sm:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (pronto) onContinuar({ motivo: motivo.trim(), valor, dia });
        }}
      >
        <p className="text-sm text-tinta-600">
          O patrocínio avulso não tem valor por mês: cada pagamento é combinado na hora. Diga para quê é
          este — é o que sai na descrição da conta e na nota que {nome} vai assinar.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3">
          <Campo label="Para quê">
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: inscrição no campeonato estadual, uniformes, viagem para a competição"
              className="campo"
              autoComplete="off"
              autoFocus
              maxLength={120}
            />
          </Campo>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Campo label="Valor (R$)">
              <CampoDinheiro valor={valor} onChange={setValor} />
            </Campo>
            <Campo label="Vencimento">
              <CampoDeData valor={dia} onChange={setDia} />
            </Campo>
          </div>
        </div>

        {pronto && (
          <p className="ajuda mt-3">
            Vai sair como “Patrocínio {nome} - {semTravessao(motivo.trim())}”, de {formatBRL(valor)}.
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onFechar} className="btn btn-neutro">
            Cancelar
          </button>
          <button type="submit" disabled={!pronto} className="btn btn-pagar">
            Continuar
          </button>
        </div>
      </form>
    </Janela>
  );
}

/** O IXC mostra o travessão como "?": o que a pessoa digitou vai com hífen. */
function semTravessao(texto: string): string {
  return texto.replace(/[\u2013\u2014]/g, '-');
}
