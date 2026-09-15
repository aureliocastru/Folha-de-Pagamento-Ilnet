import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  FotoDoPonto,
  Pontos,
  corDosPontos,
  mesAtual,
  mesPorExtenso,
  somarMeses,
} from '../../components/PainelDePontos';
import { Aviso, Carregando } from '../../components/ui';
import { mensagemErro } from '../../lib/api';
import { formatData } from '../../lib/format';

export interface MinhaPontuacao {
  nome: string;
  competencia: string;
  pontos: number;
  posicao: number;
  de: number;
  lancamentos: Array<{
    id: string;
    pontos: number;
    motivo: string;
    data: string;
    lancadoPor: string;
    temFoto: boolean;
  }>;
  meses: Array<{ competencia: string; pontos: number }>;
}

/**
 * A tela de quem é pontuado: os pontos do mês, o lugar dele e cada lançamento
 * com o motivo. Os pontos dos colegas não aparecem — só em que lugar ele está.
 *
 * Duas portas dão aqui, e a tela é uma só: o portal, que sabe quem é a pessoa
 * pelo CPF, e a tela do colaborador, que sabe pelo login. Quem chama diz como
 * buscar; o `chave` separa o cache das duas.
 */
export function TelaDaMinhaPontuacao({
  chave,
  buscar,
  buscarFoto,
}: {
  chave: unknown[];
  buscar: (competencia: string) => Promise<MinhaPontuacao>;
  buscarFoto: (lancamentoId: string) => Promise<string>;
}) {
  const [competencia, setCompetencia] = useState(mesAtual);

  const minha = useQuery({
    queryKey: [...chave, competencia],
    queryFn: () => buscar(competencia),
    placeholderData: (anterior) => anterior,
    retry: 0,
  });

  if (minha.isLoading) return <Carregando texto="Buscando sua pontuação…" />;
  if (minha.isError || !minha.data) {
    return <Aviso tom="erro">{mensagemErro(minha.error)}</Aviso>;
  }

  const d = minha.data;
  const teto = Math.max(1, ...d.meses.map((m) => Math.abs(m.pontos)));
  const ehMesAtual = competencia === mesAtual();

  return (
    <div className="space-y-4">
      <div>
        <p className="eyebrow mb-1">Sua pontuação</p>
        <h1 className="titulo-pagina">{d.nome}</h1>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setCompetencia((c) => somarMeses(c, -1))}
          className="btn btn-neutro btn-p"
          aria-label="Mês anterior"
        >
          ‹
        </button>
        <span className="min-w-[140px] text-center text-sm inline-block font-semibold text-tinta-800 first-letter:uppercase">
          {mesPorExtenso(competencia)}
        </span>
        <button
          type="button"
          onClick={() => setCompetencia((c) => somarMeses(c, 1))}
          disabled={ehMesAtual}
          className="btn btn-neutro btn-p"
          aria-label="Próximo mês"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="card p-4">
          <p className="eyebrow">Pontos no mês</p>
          <p className={`num mt-2 font-display text-4xl font-semibold ${corDosPontos(d.pontos)}`}>
            {d.pontos > 0 ? '+' : ''}
            {d.pontos}
          </p>
        </div>
        <div className="card p-4">
          <p className="eyebrow">Sua posição</p>
          <p className="num mt-2 font-display text-4xl font-semibold text-tinta-900">
            {d.posicao}º
          </p>
          <p className="mt-1 text-xs text-tinta-400">de {d.de} funcionários</p>
        </div>
      </div>

      {/* Os últimos meses de relance: melhorou ou piorou? */}
      <div className="card p-4">
        <p className="eyebrow mb-3">Últimos meses</p>
        <div className="flex h-24 items-end gap-2">
          {d.meses.map((m) => (
            <button
              key={m.competencia}
              type="button"
              onClick={() => setCompetencia(m.competencia)}
              className="flex h-full flex-1 flex-col items-center justify-end gap-1"
              title={`${mesPorExtenso(m.competencia)}: ${m.pontos} pontos`}
            >
              <span className={`num text-[11px] font-semibold ${corDosPontos(m.pontos)}`}>
                {m.pontos}
              </span>
              <span
                className={`w-full max-w-[36px] rounded-t-md ${
                  m.pontos >= 0 ? 'bg-emerald-500/70' : 'bg-rose-500/70'
                } ${m.competencia === competencia ? 'ring-2 ring-brand-400' : ''}`}
                style={{ height: `${Math.max(4, (Math.abs(m.pontos) / teto) * 60)}px` }}
              />
              <span className="text-[10px] uppercase text-tinta-400">
                {mesPorExtenso(m.competencia).slice(0, 3)}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="card overflow-hidden">
        <p className="eyebrow px-4 pb-2 pt-4">O que contou neste mês</p>
        {d.lancamentos.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-tinta-400">Nenhum ponto neste mês ainda.</p>
        ) : (
          <ul className="lista-dividida">
            {d.lancamentos.map((l) => (
              <li key={l.id} className="flex items-start gap-3 px-4 py-3">
                <Pontos valor={l.pontos} pequeno />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-tinta-800">{l.motivo}</span>
                  <span className="block text-[11px] text-tinta-400">
                    {formatData(l.data)} · {l.lancadoPor}
                  </span>
                  {l.temFoto && (
                    <FotoDoPonto
                      chave={[...chave, 'foto', l.id]}
                      buscar={() => buscarFoto(l.id)}
                    />
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
