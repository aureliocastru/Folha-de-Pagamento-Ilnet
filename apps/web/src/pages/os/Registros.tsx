import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Aviso, Bloco, CabecalhoPagina, Carregando, Pagina, Selo, Vazio } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import {
  CONDICAO_LABEL,
  SITUACAO_LABEL,
  SITUACAO_TOM,
  TIPO_LABEL,
  TIPO_TOM,
  identificacaoDaPeca,
  quantidadeComUnidade,
  type ItemDeOs,
  type RegistroDeOs,
  type ResultadoDaGravacao,
} from '../../lib/os';

/**
 * As OS em que algum técnico mexeu em material — e, primeiro, as que pedem
 * alguém da base: o que ficou sem enviar, o que o IXC recusou, e o que ficou
 * em "conferir" (o IXC deu erro e, relido, não deu para saber se gravou).
 *
 * "Conferir" não se resolve daqui às cegas: alguém olha a OS no IXC e diz o
 * que viu. Repetir sem olhar é o jeito de tirar duas vezes da van.
 */
export function Registros() {
  const qc = useQueryClient();
  const [todas, setTodas] = useState(false);
  const [aviso, setAviso] = useState<{ tom: 'pago' | 'erro' | 'atencao'; texto: string } | null>(null);
  const chave = ['os', 'registros', todas];

  const lista = useQuery({
    queryKey: chave,
    queryFn: async () =>
      (await api.get<RegistroDeOs[]>('/os/registros', { params: todas ? {} : { pendencias: 1 } })).data,
  });

  function recarregar() {
    void qc.invalidateQueries({ queryKey: ['os'] });
  }

  const gravar = useMutation({
    mutationFn: async (id: string) =>
      (await api.post<ResultadoDaGravacao>(`/os/registros/${id}/gravar`)).data,
    onSuccess: (r) =>
      setAviso({
        tom: r.falharam || r.conferir ? 'erro' : r.avisos ? 'atencao' : 'pago',
        texto:
          `${r.gravados} gravado(s) no IXC, ${r.falharam} recusado(s), ` +
          `${r.conferir} para conferir, ${r.avisos} com aviso.`,
      }),
    onError: (e) => setAviso({ tom: 'erro', texto: mensagemErro(e) }),
    onSettled: recarregar,
  });

  const conferido = useMutation({
    mutationFn: async (p: { id: string; gravou: boolean }) => {
      await api.post(`/os/itens/${p.id}/conferido`, { gravou: p.gravou });
    },
    onError: (e) => setAviso({ tom: 'erro', texto: mensagemErro(e) }),
    onSettled: recarregar,
  });

  const descartar = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/os/itens/${id}`);
    },
    onError: (e) => setAviso({ tom: 'erro', texto: mensagemErro(e) }),
    onSettled: recarregar,
  });

  const registros = lista.data ?? [];

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Ordens de Serviço"
        titulo="OS registradas"
        acoes={
          <div className="flex rounded-xl border border-tinta-200 p-0.5">
            {[
              { valor: false, rotulo: 'Com pendência' },
              { valor: true, rotulo: 'Todas' },
            ].map((o) => (
              <button
                key={o.rotulo}
                type="button"
                onClick={() => setTodas(o.valor)}
                className={`rounded-lg px-3 py-1.5 text-[13px] font-medium ${
                  todas === o.valor ? 'bg-brand-500/10 text-brand-800 dark:text-brand-200' : 'text-tinta-500'
                }`}
              >
                {o.rotulo}
              </button>
            ))}
          </div>
        }
      />

      {aviso && <Aviso tom={aviso.tom}>{aviso.texto}</Aviso>}
      {lista.isError && <Aviso tom="erro">{mensagemErro(lista.error)}</Aviso>}
      {lista.isLoading && <Carregando />}

      {lista.isSuccess && registros.length === 0 && (
        <Bloco>
          <Vazio titulo={todas ? 'Nenhuma OS registrada ainda' : 'Nada esperando a base'}>
            {todas
              ? 'As OS aparecem aqui quando um técnico anota aparelho ou material nelas.'
              : 'Tudo o que os técnicos anotaram já está no IXC.'}
          </Vazio>
        </Bloco>
      )}

      <div className="space-y-3">
        {registros.map((r) => (
          <Bloco
            key={r.id}
            semPadding
            titulo={`OS ${r.osIxcId}${r.assunto ? ` · ${r.assunto}` : ''}`}
            acao={
              (r.pendentes > 0 || r.itens.some((i) => i.situacao === 'FALHOU')) && (
                <button
                  type="button"
                  onClick={() => gravar.mutate(r.id)}
                  disabled={gravar.isPending}
                  className="btn btn-primario btn-p"
                >
                  {gravar.isPending && gravar.variables === r.id ? 'Gravando…' : 'Enviar ao IXC'}
                </button>
              )
            }
          >
            <div className="border-b border-tinta-100 px-4 py-2.5 text-[13px] text-tinta-500 md:px-5">
              {[r.cliente, r.endereco, r.tecnicos.join(', ')].filter(Boolean).join(' · ')}
            </div>
            <ul className="lista-dividida">
              {r.itens.map((i) => (
                <LinhaDaBase
                  key={i.id}
                  item={i}
                  ocupado={conferido.isPending || descartar.isPending}
                  onConferido={(gravou) => {
                    const pergunta = gravou
                      ? `Você viu "${i.descricao}" na OS ${r.osIxcId} no IXC?`
                      : `Confirmado que "${i.descricao}" NÃO está na OS ${r.osIxcId} no IXC? Ele volta a poder ser enviado.`;
                    if (confirm(pergunta)) conferido.mutate({ id: i.id, gravou });
                  }}
                  onDescartar={() => {
                    if (confirm(`Descartar "${i.descricao}"? Ele não foi ao IXC e sai daqui.`)) {
                      descartar.mutate(i.id);
                    }
                  }}
                />
              ))}
            </ul>
          </Bloco>
        ))}
      </div>
    </Pagina>
  );
}

function LinhaDaBase({
  item: i,
  ocupado,
  onConferido,
  onDescartar,
}: {
  item: ItemDeOs;
  ocupado: boolean;
  onConferido: (gravou: boolean) => void;
  onDescartar: () => void;
}) {
  return (
    <li className="flex flex-wrap items-start gap-3 px-4 py-3 md:px-5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Selo tom={TIPO_TOM[i.tipo]} pequeno>
            {TIPO_LABEL[i.tipo]}
          </Selo>
          <Selo tom={SITUACAO_TOM[i.situacao]} pequeno ponto>
            {SITUACAO_LABEL[i.situacao]}
          </Selo>
          {i.condicao && (
            <Selo tom={i.condicao === 'DEFEITO' ? 'erro' : 'neutro'} pequeno>
              {CONDICAO_LABEL[i.condicao]}
            </Selo>
          )}
          <span className="text-[11px] text-tinta-400">
            {i.tecnico} · {i.almoxarifado}
          </span>
        </div>
        <p className="mt-1 text-sm font-medium text-tinta-900">
          {i.descricao}{' '}
          <span className="font-normal text-tinta-500">
            {i.tipo === 'MATERIAL' ? quantidadeComUnidade(i.quantidade, i.unidade) : identificacaoDaPeca(i)}
          </span>
        </p>
        {i.observacao && <p className="text-[12px] italic text-tinta-500">{i.observacao}</p>}
        {i.erro && <p className="text-[12px] text-rose-600 dark:text-rose-300">{i.erro}</p>}
        {i.aviso && <p className="text-[12px] text-amber-700 dark:text-amber-300">{i.aviso}</p>}
      </div>
      {i.situacao === 'CONFERIR' && (
        <div className="flex gap-1.5">
          <button type="button" disabled={ocupado} onClick={() => onConferido(true)} className="btn btn-neutro btn-p">
            Está no IXC
          </button>
          <button type="button" disabled={ocupado} onClick={() => onConferido(false)} className="btn btn-sutil btn-p">
            Não está
          </button>
        </div>
      )}
      {(i.situacao === 'PENDENTE' || i.situacao === 'FALHOU') && (
        <button type="button" disabled={ocupado} onClick={onDescartar} className="btn btn-sutil btn-p text-rose-600">
          Descartar
        </button>
      )}
    </li>
  );
}
