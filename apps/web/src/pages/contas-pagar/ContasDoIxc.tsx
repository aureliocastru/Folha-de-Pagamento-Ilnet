import { useQuery } from '@tanstack/react-query';
import { SeletorComBusca } from '../../components/SeletorComBusca';
import { api } from '../../lib/api';

interface ContaDePagamentoIxc {
  id: number;
  nome: string;
  ativa: boolean;
  usual: boolean;
}

interface ContaDoPlano {
  id: number;
  nome: string;
}

/** O que a tela precisa saber da configuração para dizer qual é o padrão. */
interface ConfigDaCasa {
  contaPagamentoId: number;
  contaContabilAvulso: number;
}

/**
 * A conta contábil e a conta de pagamento que a conta leva ao IXC — no cartão,
 * na recorrente. Vazio é o padrão das Configurações, e a opção diz qual é ele.
 */
export function CamposDasContasDoIxc({
  prefixo,
  contaContabil,
  onContaContabil,
  contaPagamento,
  onContaPagamento,
}: {
  /** O começo dos `id` dos campos, para os rótulos acharem cada um. */
  prefixo: string;
  contaContabil: string;
  onContaContabil: (valor: string) => void;
  contaPagamento: string;
  onContaPagamento: (valor: string) => void;
}) {
  const config = useQuery({
    queryKey: ['config-financeira'],
    queryFn: async () => (await api.get<ConfigDaCasa>('/config-financeira')).data,
    retry: 0,
  });

  const contasIxc = useQuery({
    queryKey: ['contas-pagamento'],
    queryFn: async () =>
      (await api.get<ContaDePagamentoIxc[]>('/contas-abertas/contas-pagamento')).data,
  });

  const plano = useQuery({
    queryKey: ['plano-de-contas'],
    queryFn: async () =>
      (await api.get<ContaDoPlano[]>('/contas-abertas/plano-de-contas')).data,
    retry: 0,
  });

  return (
    <>
      <div>
        <label className="rotulo" htmlFor={`${prefixo}-contabil`}>
          Conta contábil no IXC
        </label>
        <SeletorComBusca
          id={`${prefixo}-contabil`}
          value={contaContabil}
          onChange={onContaContabil}
          carregando={plano.isLoading}
          vazio={nomeDaContaContabilPadrao(config.data, plano.data)}
          opcoes={(plano.data ?? []).map((p) => ({
            valor: String(p.id),
            rotulo: `${p.id} — ${p.nome}`,
          }))}
          procurar="Procurar pelo nome ou pelo código…"
        />
      </div>

      <div>
        <label className="rotulo" htmlFor={`${prefixo}-conta-pagamento`}>
          Conta de pagamento
        </label>
        <select
          id={`${prefixo}-conta-pagamento`}
          value={contaPagamento}
          onChange={(e) => onContaPagamento(e.target.value)}
          className="campo"
          disabled={contasIxc.isLoading}
        >
          <option value="">{nomeDaContaDePagamentoPadrao(config.data, contasIxc.data)}</option>
          {(contasIxc.data ?? [])
            // A escolhida antes continua na lista, mesmo que tenha saído de uso.
            .filter((c) => c.usual || c.ativa || String(c.id) === contaPagamento)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
        </select>
      </div>
    </>
  );
}

function nomeDaContaContabilPadrao(
  config: ConfigDaCasa | undefined,
  plano: ContaDoPlano[] | undefined,
): string {
  if (!config) return 'Padrão das Configurações';
  const conta = plano?.find((p) => p.id === config.contaContabilAvulso);
  return conta
    ? `Padrão — ${conta.id} ${conta.nome}`
    : `Padrão — conta ${config.contaContabilAvulso}`;
}

function nomeDaContaDePagamentoPadrao(
  config: ConfigDaCasa | undefined,
  contas: ContaDePagamentoIxc[] | undefined,
): string {
  if (!config) return 'Padrão das Configurações';
  const conta = contas?.find((c) => c.id === config.contaPagamentoId);
  return conta ? `Padrão — ${conta.nome}` : `Padrão — conta ${config.contaPagamentoId}`;
}
