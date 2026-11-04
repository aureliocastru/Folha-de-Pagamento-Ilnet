import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, mensagemErro } from '../lib/api';
import { formatBRL } from '../lib/format';
import { Aviso, Carregando } from './ui';

/** O que uma falta custa: o dia e o descanso da semana. */
interface DescontoDeFaltas {
  dias: number;
  semanasComFalta: number;
  valorDoDia: number;
  valorDosDias: number;
  valorDoDsr: number;
  total: number;
}

interface FaltasDoMes {
  competencia: string;
  aplicavel: boolean;
  salarioBase: number;
  /** "AAAA-MM-DD" — dia, e não instante: a hora só teria fuso para errar. */
  dias: Array<{ id: string; dia: string; observacao: string | null }>;
  desconto: DescontoDeFaltas;
}

const SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

/** "AAAA-MM" do mês corrente. */
function mesCorrente(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * O calendário de faltas.
 *
 * Marca-se o dia; o desconto sai sozinho — o dia mais o descanso semanal
 * daquela semana, que é o que a CLT tira de quem falta sem justificar. É o
 * segundo que sempre escapava de quem calculava à mão, e é por ele que uma
 * falta custa dois dias.
 *
 * Só aparece para quem **não** tem carteira assinada: com carteira, quem
 * desconta falta é a contabilidade na folha oficial, e marcar aqui tiraria o
 * mesmo dia duas vezes da mesma pessoa.
 */
export function CalendarioDeFaltas({
  funcionarioId,
  nome,
}: {
  funcionarioId: string;
  nome: string;
}) {
  const qc = useQueryClient();
  const [competencia, setCompetencia] = useState(mesCorrente);
  const [erro, setErro] = useState<string | null>(null);

  const chave = ['faltas', funcionarioId, competencia];

  const faltas = useQuery({
    queryKey: chave,
    queryFn: async () =>
      (
        await api.get<FaltasDoMes>(`/funcionarios/${funcionarioId}/faltas`, {
          params: { competencia },
        })
      ).data,
  });

  const alternar = useMutation({
    mutationFn: async (dia: string) =>
      api.put(`/funcionarios/${funcionarioId}/faltas/${dia}`),
    onSuccess: () => {
      setErro(null);
      void qc.invalidateQueries({ queryKey: chave });
      // O saldo salarial da folha muda junto: quem estiver olhando a prévia
      // precisa ver o novo número.
      void qc.invalidateQueries({ queryKey: ['folha'] });
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  const [ano, mes] = competencia.split('-').map(Number);
  /* A grade também em UTC, pelo mesmo motivo: o dia da semana do dia 1 decide
     em que coluna o mês começa, e lido no fuso errado ele desloca tudo. */
  const diasNoMes = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  /* Os quadrados vazios antes do dia 1, para a coluna bater com o dia da
     semana — sem eles a grade mente sobre em que dia a pessoa faltou. */
  const vazios = new Date(Date.UTC(ano, mes - 1, 1)).getUTCDay();

  /*
   * Texto com texto, sem `Date` no meio.
   *
   * Relendo "2026-08-03T00:00:00.000Z" no fuso de Brasília, o navegador dava 2
   * de agosto às 21h — clicava-se no dia 3 e acendia o quadrado do dia 2. Um
   * dia de calendário não tem hora; comparar como texto é o que impede o fuso
   * de opinar.
   */
  const marcados = new Set((faltas.data?.dias ?? []).map((d) => d.dia));

  const d = faltas.data?.desconto;

  // Mora na aba "Faltas" da ficha: o nome da aba é o título, e o mês vira o
  // primeiro campo, como nas outras abas.
  return (
    <div className="max-w-2xl">
      <div className="mb-3">
        <label className="rotulo" htmlFor="mes-das-faltas">
          Mês
        </label>
        <input
          id="mes-das-faltas"
          type="month"
          value={competencia}
          onChange={(e) => setCompetencia(e.target.value)}
          className="campo"
        />
      </div>
      <p className="ajuda mb-3">
        Marque o dia em que {nome.split(' ')[0]} faltou. O descanso semanal sai
        sozinho: falta sem justificativa derruba o DSR daquela semana, e é por
        isso que um dia custa dois.
      </p>

      {faltas.isLoading && <Carregando texto="Lendo o mês…" />}
      {faltas.isError && <Aviso tom="erro">{mensagemErro(faltas.error)}</Aviso>}

      {faltas.data && (
        <>
          <div className="grid grid-cols-7 gap-1 text-center">
            {SEMANA.map((s, i) => (
              <div key={i} className="text-xs uppercase text-tinta-400">
                {s}
              </div>
            ))}
            {Array.from({ length: vazios }, (_, i) => (
              <div key={`vazio-${i}`} />
            ))}
            {Array.from({ length: diasNoMes }, (_, i) => {
              const dia = i + 1;
              const iso = `${competencia}-${String(dia).padStart(2, '0')}`;
              const marcado = marcados.has(iso);
              const domingo = new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay() === 0;
              return (
                <button
                  key={dia}
                  type="button"
                  onClick={() => alternar.mutate(iso)}
                  disabled={alternar.isPending}
                  className={
                    'rounded-lg border py-2 text-sm transition ' +
                    (marcado
                      ? 'border-rose-500/40 bg-rose-500/15 font-semibold text-rose-500'
                      : domingo
                        ? 'border-tinta-200 text-tinta-400 hover:border-tinta-300'
                        : 'border-tinta-200 text-tinta-700 hover:border-brand-500/40')
                  }
                  title={marcado ? 'Faltou — clique para desmarcar' : 'Marcar falta'}
                >
                  {dia}
                </button>
              );
            })}
          </div>

          {/* A conta embaixo, aberta: o total sozinho não explica por que uma
              falta virou dois dias de desconto. */}
          <div className="mt-4 rounded-2xl border border-tinta-200 p-4">
            {d && d.dias > 0 ? (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Numero
                    rotulo={d.dias === 1 ? '1 falta' : `${d.dias} faltas`}
                    valor={d.valorDosDias}
                  />
                  <Numero
                    rotulo={
                      d.semanasComFalta === 1
                        ? '1 DSR perdido'
                        : `${d.semanasComFalta} DSR perdidos`
                    }
                    valor={d.valorDoDsr}
                  />
                  <Numero rotulo="Valor do dia" valor={d.valorDoDia} />
                  <Numero rotulo="Total a descontar" valor={d.total} forte />
                </div>
                <p className="ajuda mt-3">
                  Salário de {formatBRL(faltas.data.salarioBase)} ÷ 30 ={' '}
                  {formatBRL(d.valorDoDia)} por dia. Faltas em dias diferentes
                  da mesma semana derrubam um descanso só — o descanso é um por
                  semana. Este total já entra no saldo salarial da folha.
                </p>
              </>
            ) : (
              <p className="ajuda">
                Nenhuma falta neste mês. Nada a descontar.
              </p>
            )}
          </div>
        </>
      )}

      {erro && <p className="mt-3 text-sm text-rose-600">{erro}</p>}
    </div>
  );
}

function Numero({
  rotulo,
  valor,
  forte = false,
}: {
  rotulo: string;
  valor: number;
  forte?: boolean;
}) {
  return (
    <div>
      <div className="text-[0.7rem] uppercase tracking-wide text-tinta-400">
        {rotulo}
      </div>
      <div className={forte ? 'valor text-lg text-rose-500' : 'valor'}>
        {formatBRL(valor)}
      </div>
    </div>
  );
}
