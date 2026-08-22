import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { mensagemErro } from '../lib/api';
import { useAuth } from '../lib/auth';
import { destinoDepoisDoLogin } from '../lib/modulos';

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    setCarregando(true);
    try {
      // Cada perfil cai onde ele trabalha: o técnico de campo, na tela dele;
      // quem abre um módulo só, direto nele; os demais, na escolha.
      navigate(destinoDepoisDoLogin(await login(email, senha)));
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="flex min-h-screen">
      {/* Painel da marca: fibra óptica é luz dentro de vidro escuro. */}
      <div className="relative hidden overflow-hidden bg-barra lg:flex lg:w-[46%] lg:flex-col lg:justify-between">
        <div
          aria-hidden
          className="pointer-events-none absolute -left-32 top-1/4 h-[520px] w-[520px] rounded-full opacity-40 blur-3xl"
          style={{
            background:
              'radial-gradient(circle, rgba(58,159,243,0.55) 0%, rgba(10,16,32,0) 70%)',
          }}
        />
        <div className="relative px-12 pt-12">
          <img
            src="/logo-ilnet.png"
            alt="ilnet"
            width={132}
            height={81}
            className="h-auto w-[116px]"
          />
          <div className="mt-2.5 text-[10px] font-medium uppercase tracking-[0.18em] text-white/45">
            Finance
          </div>
        </div>

        <div className="relative px-12 pb-16">
          <p className="eyebrow mb-4 text-brand-300">Painel interno</p>
          <h2 className="max-w-md font-display text-[38px] font-semibold leading-[1.1] tracking-[-0.03em] text-white">
            Todo pagamento conferido antes de sair.
          </h2>
          <p className="mt-5 max-w-sm text-sm leading-relaxed text-white/70">
            Salário, adiantamento, comissão, horas extras e vales calculados por
            competência e enviados ao IXC como contas a pagar.
          </p>
        </div>

        <div className="relative flex gap-8 border-t border-white/10 px-12 py-6">
          {[
            ['Dia 25', 'adiantamento'],
            ['Quinto dia', 'salário'],
          ].map(([q, o]) => (
            <div key={q}>
              <div className="font-display text-sm font-semibold text-white">
                {q}
              </div>
              <div className="text-[11px] uppercase tracking-[0.14em] text-white/45">
                {o}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Formulário */}
      <div className="flex flex-1 items-center justify-center bg-tinta-50 px-6 py-12">
        <form onSubmit={onSubmit} className="surgir w-full max-w-[380px]">
          <div className="mb-8 lg:hidden">
            <img
              src="/logo-ilnet.png"
              alt="ilnet"
              width={112}
              height={69}
              className="h-auto w-[98px]"
            />
            <div className="mt-2 text-[10px] font-medium uppercase tracking-[0.18em] text-tinta-400">
              Finance
            </div>
          </div>

          <p className="eyebrow mb-2">Acesso</p>
          <h1 className="titulo-pagina mb-8">Entrar</h1>

          {erro && (
            <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              {erro}
            </div>
          )}

          <label className="rotulo" htmlFor="email">
            E-mail
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="username"
            className="campo mb-5"
            placeholder="voce@empresa.com"
          />

          <label className="rotulo" htmlFor="senha">
            Senha
          </label>
          <input
            id="senha"
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            required
            autoComplete="current-password"
            className="campo mb-7"
            placeholder="••••••••"
          />

          <button
            type="submit"
            disabled={carregando}
            className="btn btn-primario w-full py-3"
          >
            {carregando ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
