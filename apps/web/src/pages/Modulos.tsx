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
 *
 * Enxuta de propósito (pedido do dono, 22/09/2026): é uma sala de espera, não
 * um lugar de trabalho. Quanto menos ela ocupa, mais cedo se está dentro do
 * módulo.
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

      <main className="relative mx-auto w-full max-w-[980px] px-4 py-6 sm:px-10 sm:py-12">
        <p className="eyebrow mb-1 text-brand-300">Módulos</p>
        <h1 className="font-display text-[19px] font-semibold leading-tight tracking-[-0.02em] text-white sm:text-[26px]">
          Escolha a área que deseja acessar
        </h1>

        {/*
          Linhas, e não cartões grandes: são oito áreas, e no celular os
          cartões de antes cabiam três por tela — rolar para escolher onde
          trabalhar é a primeira coisa que o sistema pedia, todo dia. Aqui
          cada área é uma linha de 60px com o ícone, o nome e a explicação
          numa linha só; no computador elas viram duas colunas e a explicação
          continua inteira.

          Só o que este perfil enxerga: um cartão que leva a um lugar onde
          todo clique é recusado é pior que cartão nenhum.
        */}
        <div className="mt-4 grid gap-2 sm:mt-8 sm:grid-cols-2 sm:gap-3">
          {modulosDoUsuario(usuario).map((modulo) => (
            <CartaoDeArea
              key={modulo.id}
              para={caminhoInicial(modulo)}
              nome={modulo.nome}
              descricao={modulo.descricao}
              icone={modulo.icone}
              tom={modulo.tom}
            />
          ))}

          {daArea.map((c) => (
            <CartaoDeArea
              key={c.para}
              para={c.para}
              nome={c.nome}
              descricao={c.descricao}
              icone={c.icone}
              tom={c.tom}
            />
          ))}
        </div>
      </main>
    </div>
  );
}

/**
 * Uma área na lista: ícone, nome e a explicação ao lado.
 *
 * A linha inteira é o alvo, com 60px de altura — acima dos 44px que o dedo
 * pede. A explicação fica numa linha só no celular (`line-clamp-1`): ela
 * ajuda a escolher da primeira vez e atrapalha em todas as outras.
 */
function CartaoDeArea({
  para,
  nome,
  descricao,
  icone: Icone,
  tom,
}: {
  para: string;
  nome: string;
  descricao: string;
  icone: Icone;
  tom: string;
}) {
  return (
    <Link
      to={para}
      className="surgir group flex min-h-[60px] items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 transition duration-200 hover:border-white/20 hover:bg-white/[0.06] sm:gap-3.5 sm:rounded-2xl sm:p-4"
    >
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tom}`}
      >
        <Icone />
      </span>
      <span className="min-w-0">
        <span className="block truncate font-display text-[15px] font-semibold text-white sm:text-[16px]">
          {nome}
        </span>
        {/* Sem `block`: ele venceria o `display:-webkit-box` do line-clamp, e
            a explicação voltaria a ocupar três linhas. */}
        <span className="line-clamp-1 text-[12px] leading-snug text-white/45 sm:line-clamp-2 sm:text-[13px]">
          {descricao}
        </span>
      </span>
      <span aria-hidden className="ml-auto pr-0.5 text-white/25 transition group-hover:text-white/50">
        ›
      </span>
    </Link>
  );
}
