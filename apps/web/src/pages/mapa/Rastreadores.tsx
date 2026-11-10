import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Aviso, Bloco, CabecalhoPagina, Carregando, Pagina, Vazio } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import {
  dataHoraCurta,
  ESTADOS_DO_VEICULO,
  haQuanto,
  type RastreadoresDaTela,
  type RastreadorNaTela,
  type TecnicoDoIxc,
  type VinculoNaTela,
} from '../../lib/mapa';
import type { Usuario } from '../../lib/types';

/** Ligar rastreador a técnico é escrever: o visualizador e o perfil "só vê" leem. */
function podeMexer(usuario: Usuario | null | undefined): boolean {
  if (!usuario || usuario.role === 'VISUALIZADOR') return false;
  if (usuario.role !== 'ADMIN' && usuario.permissoes) return usuario.permissoes.mapa === 'mexer';
  return true;
}

/**
 * Rastreadores — qual técnico anda em cada carro da frota.
 *
 * O rastreador sabe onde o carro está, mas não quem está nele; o IXC sabe de
 * quem é cada OS. Esta ligação é o que deixa o mapa responder as duas
 * perguntas do despacho: "quem está mais perto desta OS?" e "por onde anda o
 * técnico dela?". No ILNET Service Map ela era um arquivo no servidor; aqui é
 * esta tela, e vale no clique seguinte do mapa.
 */
export function Rastreadores() {
  const { usuario } = useAuth();
  const mexe = podeMexer(usuario);
  const dados = useQuery({
    queryKey: ['mapa', 'rastreadores'],
    queryFn: async () => (await api.get<RastreadoresDaTela>('/mapa/rastreadores')).data,
  });

  return (
    <Pagina>
      <CabecalhoPagina secao="Mapa de Serviço" titulo="Rastreadores" />

      {dados.isPending && <Carregando />}
      {dados.isError && <Aviso tom="erro">Não deu para carregar: {mensagemErro(dados.error)}</Aviso>}
      {dados.data && <Conteudo dados={dados.data} mexe={mexe} />}
    </Pagina>
  );
}

function Conteudo({ dados, mexe }: { dados: RastreadoresDaTela; mexe: boolean }) {
  return (
    <>
      {!dados.configurado && (
        <Aviso tom="atencao">
          O rastreador não está configurado no servidor: falta RASTREIO_API_HASH, ou o e-mail e a senha da conta
          (RASTREIO_EMAIL e RASTREIO_SENHA). Sem ele não há lista de veículos para ligar.
        </Aviso>
      )}
      {dados.configurado && dados.erro && (
        <Aviso tom="erro">
          A última leitura do rastreador falhou: {dados.erro}
          {dados.atualizadoEm ? ` A lista é a de ${dataHoraCurta(dados.atualizadoEm)}.` : ''}
        </Aviso>
      )}
      {dados.avisos.map((aviso) => (
        <Aviso key={aviso} tom="atencao">
          {aviso}
        </Aviso>
      ))}

      {dados.configurado && (
        <Bloco
          titulo="Veículos do rastreador"
          semPadding
          className="surgir surgir-1"
          acao={
            <span className="text-sm text-tinta-500">
              {dados.veiculos.filter((v) => v.vinculo?.tecnicoIxcId).length} de {dados.veiculos.length} com técnico
            </span>
          }
        >
          {dados.veiculos.length === 0 ? (
            <Vazio titulo="Nenhum veículo na conta do rastreador">
              Os veículos aparecem aqui assim que a plataforma de rastreamento os mostrar.
            </Vazio>
          ) : (
            <div className="overflow-x-auto rolagem-fina">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="th">Veículo</th>
                    <th className="th">Situação</th>
                    <th className="th">Técnico</th>
                    <th className="th">Equipe</th>
                    <th className="th text-right">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.veiculos.map((v) => (
                    <LinhaDoVeiculo key={v.dispositivoId} veiculo={v} tecnicos={dados.tecnicos} mexe={mexe} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="ajuda px-4 pb-4 pt-2">
            O técnico é o colaborador do IXC — o mesmo que fica como técnico da OS. Com a ligação feita, o popup do
            carro no mapa mostra as OS dele, e o da OS diz qual carro é o do técnico.
          </p>
        </Bloco>
      )}

      {dados.semAparelho.length > 0 && (
        <Bloco
          titulo={dados.configurado && !dados.erro ? 'Aparelhos que saíram do rastreador' : 'Ligações guardadas'}
          semPadding
          className="surgir surgir-2 mt-4"
        >
          <div className="overflow-x-auto rolagem-fina">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th">Veículo</th>
                  <th className="th">Técnico</th>
                  <th className="th">Equipe</th>
                  <th className="th">Ligado em</th>
                  <th className="th text-right">Ação</th>
                </tr>
              </thead>
              <tbody>
                {dados.semAparelho.map((v) => (
                  <LinhaSemAparelho key={v.dispositivoId} vinculo={v} mexe={mexe} />
                ))}
              </tbody>
            </table>
          </div>
          {dados.configurado && !dados.erro && (
            <p className="ajuda px-4 pb-4 pt-2">
              O aparelho não aparece mais na conta do rastreador (trocado, vendido, ou o carro saiu da conta). A
              ligação não vale para nada enquanto ele não voltar: pode remover.
            </p>
          )}
        </Bloco>
      )}
    </>
  );
}

function useSalvar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { dispositivoId: string; tecnicoIxcId: number | null; equipe: string | null; nomeDoVeiculo?: string }) =>
      (
        await api.put<VinculoNaTela | null>(`/mapa/rastreadores/${encodeURIComponent(p.dispositivoId)}`, {
          tecnicoIxcId: p.tecnicoIxcId,
          equipe: p.equipe,
          nomeDoVeiculo: p.nomeDoVeiculo,
        })
      ).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mapa', 'rastreadores'] });
      void qc.invalidateQueries({ queryKey: ['mapa', 'frota'] });
    },
  });
}

function LinhaDoVeiculo({
  veiculo,
  tecnicos,
  mexe,
}: {
  veiculo: RastreadorNaTela;
  tecnicos: TecnicoDoIxc[];
  mexe: boolean;
}) {
  const salvar = useSalvar();
  const guardado = veiculo.vinculo;
  const [tecnico, setTecnico] = useState(guardado?.tecnicoIxcId ? String(guardado.tecnicoIxcId) : '');
  const [equipe, setEquipe] = useState(guardado?.equipe ?? '');
  const mudou =
    tecnico !== (guardado?.tecnicoIxcId ? String(guardado.tecnicoIxcId) : '') || equipe.trim() !== (guardado?.equipe ?? '');
  const estado = ESTADOS_DO_VEICULO[veiculo.estado];

  // O técnico ligado que saiu da lista do IXC (desligado, apagado) continua
  // aparecendo com o nome guardado, em vez de a escolha sumir calada.
  const opcoes = [...tecnicos];
  if (guardado?.tecnicoIxcId && !tecnicos.some((t) => t.id === guardado.tecnicoIxcId)) {
    opcoes.unshift({ id: guardado.tecnicoIxcId, nome: guardado.tecnicoNome ?? `Colaborador ${guardado.tecnicoIxcId}`, ativo: false });
  }

  return (
    <tr className="linha">
      <td className="td">
        <div className="font-medium text-tinta-900">{veiculo.nome}</div>
        <div className="text-xs text-tinta-500">
          {[veiculo.placa, veiculo.grupo, `aparelho ${veiculo.dispositivoId}`].filter(Boolean).join(' · ')}
        </div>
      </td>
      <td className="td">
        <span className="inline-flex items-center gap-1.5 text-tinta-700">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: estado.cor }} />
          {estado.nome}
        </span>
        <div className="text-xs text-tinta-500">{haQuanto(veiculo.horario)}</div>
      </td>
      <td className="td min-w-[200px]">
        <select
          className="campo"
          value={tecnico}
          onChange={(e) => setTecnico(e.target.value)}
          disabled={!mexe}
          aria-label={`Técnico do ${veiculo.nome}`}
        >
          <option value="">— Nenhum —</option>
          {opcoes.map((t) => (
            <option key={t.id} value={String(t.id)}>
              {t.nome}
              {t.ativo ? '' : ' (inativo)'}
            </option>
          ))}
        </select>
      </td>
      <td className="td min-w-[140px]">
        <input
          className="campo"
          value={equipe}
          onChange={(e) => setEquipe(e.target.value)}
          disabled={!mexe}
          maxLength={60}
          placeholder="Ex.: Equipe Norte"
          aria-label={`Equipe do ${veiculo.nome}`}
        />
      </td>
      <td className="td text-right">
        {mexe && (
          <button
            type="button"
            className="btn btn-p btn-primario"
            disabled={!mudou || salvar.isPending}
            onClick={() =>
              salvar.mutate({
                dispositivoId: veiculo.dispositivoId,
                tecnicoIxcId: tecnico ? Number(tecnico) : null,
                equipe: equipe.trim() || null,
                nomeDoVeiculo: veiculo.nome,
              })
            }
          >
            {salvar.isPending ? 'Salvando…' : 'Salvar'}
          </button>
        )}
        {salvar.isError && <div className="mt-1 text-xs text-rose-600">{mensagemErro(salvar.error)}</div>}
        {!mudou && guardado?.atualizadoPor && (
          <div className="mt-1 text-xs text-tinta-400" title={dataHoraCurta(guardado.atualizadoEm) ?? undefined}>
            por {guardado.atualizadoPor}
          </div>
        )}
      </td>
    </tr>
  );
}

function LinhaSemAparelho({ vinculo, mexe }: { vinculo: VinculoNaTela; mexe: boolean }) {
  const qc = useQueryClient();
  const remover = useMutation({
    mutationFn: async () => {
      await api.delete(`/mapa/rastreadores/${encodeURIComponent(vinculo.dispositivoId)}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mapa', 'rastreadores'] });
      void qc.invalidateQueries({ queryKey: ['mapa', 'frota'] });
    },
  });
  return (
    <tr className="linha">
      <td className="td">
        <div className="font-medium text-tinta-900">{vinculo.nomeDoVeiculo ?? 'Veículo sem nome'}</div>
        <div className="text-xs text-tinta-500">aparelho {vinculo.dispositivoId}</div>
      </td>
      <td className="td">{vinculo.tecnicoNome ?? '—'}</td>
      <td className="td">{vinculo.equipe ?? '—'}</td>
      <td className="td num text-tinta-500">{dataHoraCurta(vinculo.atualizadoEm)}</td>
      <td className="td text-right">
        {mexe && (
          <button
            type="button"
            className="btn btn-p btn-perigo"
            disabled={remover.isPending}
            onClick={() => remover.mutate()}
          >
            Remover
          </button>
        )}
        {remover.isError && <div className="mt-1 text-xs text-rose-600">{mensagemErro(remover.error)}</div>}
      </td>
    </tr>
  );
}
