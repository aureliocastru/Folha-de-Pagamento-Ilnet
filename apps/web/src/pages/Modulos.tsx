import { Link, Navigate } from 'react-router-dom';
import { IconeBomba, IconeChecklist, IconeTrofeu, type Icone } from '../components/icones';
import { CabecalhoDeFora } from '../components/TelaDeFora';
import { useAuth } from '../lib/auth';
import { cartoesDoColaborador, useInicioDoColaborador } from '../lib/colaborador';
import { caminhoInicial, modulosDoUsuario, TELA_DO_CAMPO } from '../lib/modulos';

/**
 * A primeira tela depois do login: escolher em qual módulo trabalhar. Fundo
 * escuro para emendar no painel de marca do login — e para o módulo, quando
 * abrir, chegar como clareira.
 */
export function Modulos() {
  const { usuario } = useAuth();
  // Quem trabalha nos módulos também é colaborador: tem pontos, pode ter um
  // veículo no nome, e pode coordenar. Cada um é um cartão, ao lado dos
  // módulos, quando o administrador marcou — e quando há o que mostrar.
  const inicio = useInicioDoColaborador(usuario?.role !== 'TECNICO');
  const cartoes = cartoesDoColaborador(inicio.data, usuario);
  const daArea: Array<{ para: string; nome: string; descricao: string; icone: Icone; tom: string }> = [
    ...(cartoes.pontuacao
      ? [{
          para: '/campo/pontuacao',
          nome: 'Minha pontuação',
          descricao: 'Seus pontos do mês, o motivo de cada um e em que lugar você está',
          icone: IconeTrofeu,
          tom: 'bg-amber-400/15 text-amber-300',
        }]
      : []),
    ...(cartoes.abastecimento
      ? [{
          para: '/campo/abastecimento',
          nome: 'Abastecimento',
          descricao: 'O km ou o horímetro e a foto da nota do posto, no veículo que está com você',
          icone: IconeBomba,
          tom: 'bg-sky-500/15 text-sky-300',
        }]
      : []),
    ...(cartoes.pontuar
      ? [{
          para: '/campo/pontuar',
          nome: 'Pontuar',
          descricao: 'Dar ou tirar pontos dos funcionários, com o motivo e a foto',
          icone: IconeChecklist,
          tom: 'bg-emerald-500/15 text-emerald-300',
        }]
      : []),
  ];

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

      <div className="relative [&>header]:bg-transparent">
        <CabecalhoDeFora />
      </div>

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

          {daArea.map((c) => (
            <Link
              key={c.para}
              to={c.para}
              className="surgir group rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition sm:p-6 duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.06]"
            >
              <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${c.tom}`}>
                <c.icone />
              </span>
              <h2 className="mt-3.5 font-display text-[16px] font-semibold text-white sm:mt-5 sm:text-[17px]">
                {c.nome}
              </h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-white/45">{c.descricao}</p>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
