import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import {
  caminhoDaConta,
  caminhoInicial,
  modulosDoUsuario,
  TELA_DO_CAMPO,
} from '../lib/modulos';

/**
 * A primeira tela depois do login: escolher em qual módulo trabalhar. Fundo
 * escuro para emendar no painel de marca do login — e para o módulo, quando
 * abrir, chegar como clareira.
 */
export function Modulos() {
  const { usuario, logout } = useAuth();
  const navigate = useNavigate();

  function sair() {
    logout();
    navigate('/login');
  }

  // O técnico de campo não escolhe módulo: ele tem uma tela, e é esta. Chegar
  // aqui (pelo endereço, ou vindo de um módulo que ele não abre) é ser levado
  // de volta ao lugar onde ele tem o que fazer.
  if (usuario?.role === 'TECNICO') {
    return <Navigate to={TELA_DO_CAMPO} replace />;
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-barra">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[620px] w-[620px] -translate-x-1/2 rounded-full opacity-40 blur-3xl"
        style={{
          background:
            'radial-gradient(circle, rgba(58,159,243,0.45) 0%, rgba(10,16,32,0) 70%)',
        }}
      />

      {/* pr generoso: o bloco de notas mora encostado nesta quina, e sem
          folga o "Sair" ficava debaixo dele. */}
      <header className="relative flex flex-wrap items-center justify-between gap-3 border-b border-white/10 py-4 pl-4 pr-14 sm:gap-4 sm:py-5 sm:pl-10 sm:pr-20">
        <div className="flex items-center gap-3.5">
          <img
            src="/logo-ilnet.png"
            alt="ilnet"
            width={110}
            height={68}
            className="h-auto w-[92px]"
          />
          <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-white/45">
            Finance
          </span>
        </div>

        <div className="flex items-center gap-3">
          <Link
            to={caminhoDaConta(usuario)}
            className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition hover:bg-white/5"
            title="Minha conta"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-500/20 font-display text-xs font-semibold text-brand-300">
              {(usuario?.nome ?? '?').slice(0, 2).toUpperCase()}
            </span>
            <span className="hidden text-[13px] font-medium text-white sm:block">
              {usuario?.nome}
            </span>
          </Link>
          <button
            onClick={sair}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/70 transition hover:border-white/20 hover:bg-white/5 hover:text-white"
          >
            Sair
          </button>
        </div>
      </header>

      <main className="relative mx-auto w-full max-w-[900px] px-4 py-9 sm:px-10 sm:py-14">
        <p className="eyebrow mb-2 text-brand-300">Módulos</p>
        <h1 className="font-display text-[24px] font-semibold leading-tight tracking-[-0.03em] text-white sm:text-[30px]">
          Escolha a área que deseja acessar
        </h1>

        {/* Só o que este perfil enxerga: um cartão que leva a um lugar onde
            todo clique é recusado é pior que cartão nenhum. */}
        <div className="mt-6 grid gap-3 sm:mt-9 sm:grid-cols-2 sm:gap-4">
          {modulosDoUsuario(usuario).map((modulo) => (
            <Link
              key={modulo.id}
              to={caminhoInicial(modulo)}
              className="surgir group rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition sm:p-6 duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.06]"
            >
              <span
                className={`flex h-11 w-11 items-center justify-center rounded-xl ${modulo.tom}`}
              >
                <modulo.icone />
              </span>
              <h2 className="mt-3.5 font-display text-[16px] font-semibold text-white sm:mt-5 sm:text-[17px]">
                {modulo.nome}
              </h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-white/45">
                {modulo.descricao}
              </p>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
