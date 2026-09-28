import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Aviso,
  CampoDinheiro,
  Carregando,
  Selo,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { formatBRL, formatData } from '../../lib/format';
import { STATUS_LABEL } from '../../lib/status';
import type { ContaPagar, FeriasAPagar as Ferias } from '../../lib/types';

/**
 * O pagamento das férias, pela lista da tela de Férias.
 *
 * Quem foi mandado para férias aparece aqui na hora — mesmo que as férias só
 * comecem daqui a semanas, porque a lei manda pagá-las antes de a pessoa sair.
 * Pago, fica marcado; de volta ao trabalho, some da lista.
 *
 * O valor vem preenchido com o salário do mês em que as férias começam, que é
 * o mesmo ponto de partida do quinto dia. O certo é o que a contabilidade
 * apurou — é ele que se digita por cima.
 */
export function FeriasAPagar() {
  const qc = useQueryClient();
  /** O valor digitado em cada linha; sem digitar, vale o sugerido. */
  const [valores, setValores] = useState<Record<string, string>>({});
  /** A linha que está pedindo confirmação antes de ir ao IXC. */
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [recado, setRecado] = useState<{ tom: 'marca' | 'erro'; texto: string } | null>(
    null,
  );

  const lista = useQuery({
    queryKey: ['ferias-a-pagar'],
    queryFn: async () =>
      (await api.get<Ferias[]>('/contas-pagar/ferias-a-pagar')).data,
  });

  const valorDe = (f: Ferias) =>
    valores[f.feriasId] ??
    (f.valorSugerido === null ? '' : f.valorSugerido.toFixed(2));

  const gerar = useMutation({
    mutationFn: async (f: Ferias) =>
      (
        await api.post<ContaPagar[]>('/contas-pagar', {
          itens: [
            {
              funcionarioId: f.funcionarioId,
              tipo: 'FERIAS',
              valor: Number(valorDe(f)),
              contaContabil: f.contaContabil,
              observacao: f.observacao,
              competencia: f.competencia,
              feriasMarcadaId: f.feriasId,
            },
          ],
        })
      ).data,
    onSuccess: ([conta], f) => {
      setConfirmando(null);
      setRecado(
        conta?.status === 'ERRO'
          ? {
              tom: 'erro',
              texto: `O pagamento das férias de ${f.nome} foi criado, mas o IXC recusou: ${conta.erro ?? 'sem detalhe'}. Reenvie em Pagamentos da Folha.`,
            }
          : {
              tom: 'marca',
              texto: `Pagamento das férias de ${f.nome} lançado no IXC — ${formatBRL(Number(valorDe(f)))}, aguardando aprovação em Pagamentos da Folha.`,
            },
      );
      void qc.invalidateQueries({ queryKey: ['ferias-a-pagar'] });
      void qc.invalidateQueries({ queryKey: ['contas-pagar'] });
    },
    onError: (err) => {
      setConfirmando(null);
      setRecado({ tom: 'erro', texto: mensagemErro(err) });
      // Quem recusou pode ter sido o "já pago" de outra aba: a lista relê.
      void qc.invalidateQueries({ queryKey: ['ferias-a-pagar'] });
    },
  });

  if (lista.isLoading) return <Carregando texto="Lendo as férias programadas…" />;
  if (lista.isError) {
    return <Aviso tom="erro">{mensagemErro(lista.error)}</Aviso>;
  }

  const ferias = lista.data ?? [];
  const aPagar = ferias.filter((f) => !f.pagamento).length;

  if (ferias.length === 0) {
    return (
      <div className="card">
        <Vazio titulo="Ninguém com férias programadas">
          Quem for mandado para férias na tela de{' '}
          <Link to="/folha/ferias" className="underline">
            Férias
          </Link>{' '}
          aparece aqui na hora, para o pagamento poder sair adiantado.
        </Vazio>
      </div>
    );
  }

  return (
    <>
      {recado && (
        <div className="mb-4">
          <Aviso tom={recado.tom}>{recado.texto}</Aviso>
        </div>
      )}

      <p className="mb-3 text-sm text-tinta-500">
        {aPagar === 0
          ? 'Todas as férias programadas já têm pagamento.'
          : aPagar === 1
            ? '1 férias ainda sem pagamento.'
            : `${aPagar} férias ainda sem pagamento.`}{' '}
        O valor vem do salário do mês em que elas começam — o certo é o que a
        contabilidade apurou.
      </p>

      <ul className="surgir surgir-2 card lista-dividida">
        {ferias.map((f) => (
          <LinhaDeFerias
            key={f.feriasId}
            f={f}
            valor={valorDe(f)}
            onValor={(v) => setValores((atual) => ({ ...atual, [f.feriasId]: v }))}
            confirmando={confirmando === f.feriasId}
            onPedir={() => {
              setRecado(null);
              setConfirmando(f.feriasId);
            }}
            onCancelar={() => setConfirmando(null)}
            onConfirmar={() => gerar.mutate(f)}
            gerando={gerar.isPending && gerar.variables?.feriasId === f.feriasId}
            ocupado={gerar.isPending}
          />
        ))}
      </ul>
    </>
  );
}

function LinhaDeFerias({
  f,
  valor,
  onValor,
  confirmando,
  onPedir,
  onCancelar,
  onConfirmar,
  gerando,
  ocupado,
}: {
  f: Ferias;
  valor: string;
  onValor: (v: string) => void;
  confirmando: boolean;
  onPedir: () => void;
  onCancelar: () => void;
  onConfirmar: () => void;
  gerando: boolean;
  ocupado: boolean;
}) {
  const quanto = Number(valor) || 0;

  return (
    <li className="flex flex-wrap items-start justify-between gap-4 px-4 py-4 sm:px-5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-tinta-900">{f.nome}</span>
          {f.apelido && f.apelido !== f.nome && (
            <span className="text-xs text-tinta-400">({f.apelido})</span>
          )}
          {f.emCurso ? (
            <Selo tom="info" pequeno>
              de férias até {formatData(f.fim)}
            </Selo>
          ) : (
            <Selo tom="neutro" pequeno>
              {f.diasParaComecar === 1
                ? 'começa amanhã'
                : `começa em ${f.diasParaComecar} dias`}
            </Selo>
          )}
        </div>
        <p className="mt-1 text-sm text-tinta-500">
          {formatData(f.inicio)} a {formatData(f.fim)} · {f.dias} dias
        </p>
      </div>

      {/* O que dá para fazer com esta linha: nada (já pago), ligar o
          cadastro, ou gerar o pagamento. */}
      <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
        {f.pagamento ? (
          <div className="text-right">
            <Selo tom={f.pagamento.situacao === 'PAGO' ? 'pago' : 'atencao'}>
              {f.pagamento.situacao === 'PAGO'
                ? f.pagamento.pagoEm
                  ? `Pago em ${formatData(f.pagamento.pagoEm)}`
                  : 'Pago'
                : `Gerado — ${STATUS_LABEL[f.pagamento.status].toLowerCase()}`}
            </Selo>
            <div className="valor mt-1 text-sm text-tinta-700">
              {formatBRL(f.pagamento.valor)}
            </div>
          </div>
        ) : !f.funcionarioId ? (
          <p className="max-w-xs text-right text-xs text-tinta-500">
            O nome do relatório de férias não casou com nenhum cadastro daqui,
            então não dá para pagar por esta tela. Confira o nome na ficha do
            funcionário.
          </p>
        ) : confirmando ? (
          <>
            <span className="text-sm text-tinta-700">
              Lançar <strong>{formatBRL(quanto)}</strong> de férias no IXC?
            </span>
            <button
              type="button"
              onClick={onCancelar}
              disabled={gerando}
              className="btn btn-p btn-neutro"
            >
              Voltar
            </button>
            <button
              type="button"
              onClick={onConfirmar}
              disabled={gerando}
              className="btn btn-p btn-primario"
            >
              {gerando ? 'Lançando no IXC…' : 'Confirmar'}
            </button>
          </>
        ) : (
          <>
            <div className="w-36">
              <CampoDinheiro valor={valor} onChange={onValor} placeholder="0,00" />
            </div>
            <button
              type="button"
              onClick={onPedir}
              disabled={quanto <= 0 || ocupado}
              className="btn btn-primario"
              title={quanto <= 0 ? 'Digite o valor das férias' : undefined}
            >
              Gerar pagamento
            </button>
          </>
        )}
      </div>
    </li>
  );
}
