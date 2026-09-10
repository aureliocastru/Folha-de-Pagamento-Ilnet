import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import type { MotivoDePontos } from '../../components/PainelDePontos';
import { Aviso, Bloco, CabecalhoPagina, Carregando, Pagina } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';

const CHAVE = ['pontuacao', 'motivos'];

/**
 * Os motivos de um toque: os botões que aparecem na hora de pontuar.
 *
 * Um lado para o +1 e outro para o −1. O lançamento guarda o texto, e não o
 * motivo: trocar ou apagar um daqui não mexe no que já foi dado.
 */
export function Motivos() {
  const lista = useQuery({
    queryKey: CHAVE,
    queryFn: async () => (await api.get<MotivoDePontos[]>('/pontuacao/motivos')).data,
  });

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Pontuação"
        titulo="Motivos"
        descricao="Os botões que aparecem na hora de pontuar. Quem pontua toca num deles e, se quiser, escreve o detalhe."
      />

      {lista.isError && (
        <Aviso tom="erro">Não deu para ler os motivos: {mensagemErro(lista.error)}</Aviso>
      )}

      {lista.isLoading ? (
        <Carregando />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <LadoDosMotivos positivo motivos={(lista.data ?? []).filter((m) => m.positivo)} />
          <LadoDosMotivos
            positivo={false}
            motivos={(lista.data ?? []).filter((m) => !m.positivo)}
          />
        </div>
      )}
    </Pagina>
  );
}

function LadoDosMotivos({
  positivo,
  motivos,
}: {
  positivo: boolean;
  motivos: MotivoDePontos[];
}) {
  const qc = useQueryClient();
  const [novo, setNovo] = useState('');
  const [editando, setEditando] = useState<{ id: string; texto: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  function recarregar() {
    // As fichas de pontuar guardam os motivos por uns minutos; o painel do
    // ADMIN é o mesmo navegador, e tem de ver a troca na hora.
    void qc.invalidateQueries({ queryKey: CHAVE });
    void qc.invalidateQueries({ queryKey: ['pontos', '/pontuacao', 'motivos'] });
  }

  const criar = useMutation({
    mutationFn: async () => {
      await api.post('/pontuacao/motivos', { texto: novo.trim(), positivo });
    },
    onSuccess: () => {
      setNovo('');
      setErro(null);
      recarregar();
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  const salvar = useMutation({
    mutationFn: async (m: { id: string; texto: string }) => {
      await api.patch(`/pontuacao/motivos/${m.id}`, { texto: m.texto.trim() });
    },
    onSuccess: () => {
      setEditando(null);
      setErro(null);
      recarregar();
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  const remover = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/pontuacao/motivos/${id}`);
    },
    onSuccess: () => {
      setErro(null);
      recarregar();
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  function aoCriar(e: FormEvent) {
    e.preventDefault();
    if (novo.trim().length >= 3) criar.mutate();
  }

  function aoSalvar(e: FormEvent) {
    e.preventDefault();
    if (editando && editando.texto.trim().length >= 3) salvar.mutate(editando);
  }

  const tom = positivo
    ? 'text-emerald-600 dark:text-emerald-300'
    : 'text-rose-600 dark:text-rose-300';

  return (
    <Bloco semPadding>
      <div className="border-b border-tinta-100 px-4 py-3 md:px-5">
        <p className={`font-display text-lg font-semibold ${tom}`}>
          {positivo ? '+1 ponto' : '−1 ponto'}
        </p>
        <p className="text-xs text-tinta-400">
          {positivo ? 'O que merece ponto a mais' : 'O que tira ponto'}
        </p>
      </div>

      {motivos.length === 0 ? (
        <p className="px-4 py-4 text-sm text-tinta-400 md:px-5">
          Nenhum motivo deste lado ainda.
        </p>
      ) : (
        <ul className="lista-dividida">
          {motivos.map((m) =>
            editando?.id === m.id ? (
              <li key={m.id} className="px-4 py-2.5 md:px-5">
                <form onSubmit={aoSalvar} className="flex flex-wrap items-center gap-2">
                  <input
                    value={editando.texto}
                    onChange={(e) => setEditando({ id: m.id, texto: e.target.value.slice(0, 60) })}
                    className="campo min-w-[160px] flex-1"
                    aria-label="Texto do motivo"
                    autoFocus
                  />
                  <button
                    type="submit"
                    disabled={editando.texto.trim().length < 3 || salvar.isPending}
                    className="btn btn-primario btn-p"
                  >
                    {salvar.isPending ? 'Salvando…' : 'Salvar'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditando(null)}
                    className="btn btn-sutil btn-p"
                  >
                    Cancelar
                  </button>
                </form>
              </li>
            ) : (
              <li key={m.id} className="flex items-center gap-2 px-4 py-2.5 md:px-5">
                <span className={`num w-7 shrink-0 text-sm font-semibold ${tom}`}>
                  {positivo ? '+1' : '−1'}
                </span>
                <span className="min-w-0 flex-1 text-sm text-tinta-800">{m.texto}</span>
                <button
                  type="button"
                  onClick={() => setEditando({ id: m.id, texto: m.texto })}
                  className="btn btn-sutil btn-p"
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Apagar o motivo "${m.texto}"? Os pontos já dados com ele continuam.`)) {
                      remover.mutate(m.id);
                    }
                  }}
                  disabled={remover.isPending}
                  className="btn btn-sutil btn-p text-rose-600"
                >
                  Apagar
                </button>
              </li>
            ),
          )}
        </ul>
      )}

      <form
        onSubmit={aoCriar}
        className="flex flex-wrap items-center gap-2 border-t border-tinta-100 px-4 py-3 md:px-5"
      >
        <input
          value={novo}
          onChange={(e) => setNovo(e.target.value.slice(0, 60))}
          className="campo min-w-[160px] flex-1"
          placeholder={positivo ? 'Ex.: Uniforme completo' : 'Ex.: Veículo sujo'}
          aria-label={positivo ? 'Novo motivo de +1' : 'Novo motivo de −1'}
        />
        <button
          type="submit"
          disabled={novo.trim().length < 3 || criar.isPending}
          className="btn btn-neutro btn-p"
        >
          {criar.isPending ? 'Adicionando…' : 'Adicionar'}
        </button>
      </form>

      {erro && (
        <div className="px-4 pb-3 md:px-5">
          <Aviso tom="erro">{erro}</Aviso>
        </div>
      )}
    </Bloco>
  );
}
