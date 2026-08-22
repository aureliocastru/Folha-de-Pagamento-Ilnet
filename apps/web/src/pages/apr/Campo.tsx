import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import { IconeCapacete } from '../../components/icones';
import { Carregando, Selo } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import {
  GRAVIDADE_LABEL,
  GRAVIDADE_TOM,
  STATUS_APR_LABEL,
  STATUS_APR_TOM,
} from '../../lib/status';
import type { AprResumo } from '../../lib/types';
import { DetalheApr } from './DetalheApr';
import { FormularioApr } from './FormularioApr';

/**
 * A tela do técnico de campo — a única que ele vê do sistema inteiro.
 *
 * Sem barra lateral, sem escolha de módulo, sem nada além do que ele veio
 * fazer: abrir a APR do serviço, colher a assinatura da equipe e ir trabalhar.
 * O login de TECNICO cai aqui e não sai daqui; qualquer outro endereço o traz
 * de volta (ver o `App.tsx`), e o servidor recusa o resto por conta própria
 * (ver o `ModulosGuard`).
 *
 * Quem supervisiona também pode abrir esta tela — é útil para ver na prática o
 * que a equipe está vendo —, mas o caminho normal dele é o módulo Segurança do
 * Trabalho, que tem a lista da empresa inteira.
 */
export function Campo() {
  const { usuario, logout } = useAuth();
  const navigate = useNavigate();

  function sair() {
    logout();
    navigate('/login');
  }

  return (
    <div className="min-h-screen bg-tinta-50">
      <header className="sticky top-0 z-20 border-b border-tinta-200 bg-papel/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <NavLink to="/campo" className="flex items-center gap-2.5">
            <img
              src="/logo-ilnet.png"
              alt="ilnet"
              width={92}
              height={57}
              className="h-auto w-[72px]"
            />
            <span className="hidden text-[10px] font-medium uppercase tracking-[0.18em] text-tinta-400 sm:block">
              Segurança
            </span>
          </NavLink>

          <div className="flex items-center gap-2">
            <NavLink
              to="/campo/minha-conta"
              className="max-w-[9rem] truncate text-[13px] font-medium text-tinta-600 hover:text-tinta-900"
              title="Minha conta"
            >
              {usuario?.nome}
            </NavLink>
            <button
              onClick={sair}
              className="rounded-lg border border-tinta-200 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-tinta-500 transition hover:border-tinta-300 hover:text-tinta-800"
            >
              Sair
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 py-5">
        <Outlet />
      </main>
    </div>
  );
}

/**
 * A primeira coisa que ele vê: o botão de abrir a APR do serviço, e as dele.
 *
 * A lista existe por três motivos concretos, e nenhum deles é histórico: um
 * rascunho interrompido precisa de onde ser retomado, uma APR liberada precisa
 * de onde ser encerrada no fim do dia, e o papel precisa de onde ser mostrado a
 * quem o pedir na obra.
 */
export function CampoInicio() {
  const navigate = useNavigate();

  const lista = useQuery({
    queryKey: ['aprs', 'minhas'],
    queryFn: async () =>
      (await api.get<AprResumo[]>('/apr', { params: { minhas: true } })).data,
  });

  const aprs = lista.data ?? [];
  const rascunhos = aprs.filter((a) => a.status === 'RASCUNHO');
  const resto = aprs.filter((a) => a.status !== 'RASCUNHO');

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={() => navigate('/campo/nova')}
        className="btn btn-primario w-full justify-center gap-2.5 py-5 text-base"
      >
        <IconeCapacete className="h-5 w-5" />
        Nova análise de risco
      </button>

      {lista.isLoading && <Carregando texto="Carregando…" />}

      {lista.isError && (
        <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {mensagemErro(lista.error)}
        </p>
      )}

      {rascunhos.length > 0 && (
        <section>
          <h2 className="eyebrow mb-2">Em preenchimento</h2>
          <div className="space-y-2">
            {rascunhos.map((a) => (
              <CartaoApr key={a.id} apr={a} />
            ))}
          </div>
        </section>
      )}

      {resto.length > 0 && (
        <section>
          <h2 className="eyebrow mb-2">Análises registradas</h2>
          <div className="space-y-2">
            {resto.map((a) => (
              <CartaoApr key={a.id} apr={a} />
            ))}
          </div>
        </section>
      )}

      {!lista.isLoading && aprs.length === 0 && (
        <div className="rounded-2xl border border-dashed border-tinta-300 px-5 py-10 text-center">
          <p className="text-sm font-semibold text-tinta-500">
            Nenhuma análise de risco registrada
          </p>
        </div>
      )}
    </div>
  );
}

/** Uma APR na lista do técnico: só o que ele precisa para reconhecê-la. */
function CartaoApr({ apr }: { apr: AprResumo }) {
  const navigate = useNavigate();

  return (
    <button
      type="button"
      onClick={() => navigate(`/campo/${apr.id}`)}
      className="card card-hover w-full p-4 text-left"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Selo tom={STATUS_APR_TOM[apr.status]} ponto>
          {STATUS_APR_LABEL[apr.status]}
        </Selo>
        <Selo tom={GRAVIDADE_TOM[apr.gravidade]} pequeno>
          {GRAVIDADE_LABEL[apr.gravidade]}
        </Selo>
        {apr.assinaturasFaltando > 0 && (
          <Selo tom="atencao" pequeno>
            {apr.assinaturasFaltando} sem assinar
          </Selo>
        )}
      </div>

      <p className="mt-2 text-[15px] font-semibold leading-snug text-tinta-900">
        {apr.local}
      </p>
      <p className="mt-0.5 text-[12px] text-tinta-500">
        APR nº {apr.numero} · {formatDataHora(apr.inicioEm)}
        {apr.fimEm ? ' · encerrada' : ''}
      </p>
      {apr.riscos.length > 0 && (
        <p className="mt-1.5 line-clamp-2 text-[12px] leading-snug text-tinta-400">
          {apr.riscos.join(' · ')}
        </p>
      )}
    </button>
  );
}

/** O formulário, abrindo em branco. */
export function CampoNova() {
  const navigate = useNavigate();
  return (
    <FormularioApr
      onSair={() => navigate('/campo')}
      onPronta={(id) => navigate(`/campo/${id}`, { replace: true })}
    />
  );
}

/** Uma APR do técnico: retomar o rascunho, ver o papel, encerrar. */
export function CampoApr() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [continuando, setContinuando] = useState(false);

  if (!id) return null;

  if (continuando) {
    return (
      <FormularioApr
        aprId={id}
        onSair={() => setContinuando(false)}
        onPronta={() => setContinuando(false)}
      />
    );
  }

  return (
    <DetalheApr
      id={id}
      onContinuar={() => setContinuando(true)}
      onSair={() => navigate('/campo')}
    />
  );
}

function formatDataHora(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));
}
