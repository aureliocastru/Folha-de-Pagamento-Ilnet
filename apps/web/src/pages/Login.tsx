import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { mensagemErro } from '../lib/api';
import { useAuth } from '../lib/auth';
import { destinoDepoisDoLogin } from '../lib/modulos';

/**
 * A porta de entrada, igual para todo mundo.
 *
 * Ela já foi um painel da folha de pagamento: "Finance", adiantamento do dia
 * 25, saldo do quinto dia. Isso deixou de servir quando o app passou a ser de
 * mais de um setor — quem mais abre esta tela hoje é o técnico que vai
 * preencher a APR antes de subir no poste, no celular, e ele era recebido por
 * um texto sobre salários que não é da conta dele.
 *
 * Sobrou o nome da empresa. Nada de coluna de marca escondida no `lg:`: a
 * tela é a mesma no celular e no computador, porque o celular é o caso comum
 * e não a exceção que se degrada.
 */
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
    // `100dvh` e não `100vh`: no celular a barra do navegador entra e sai, e
    // com `vh` o botão Entrar nasce empurrado para fora da tela.
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-tinta-50 px-6 py-12">
      <form onSubmit={onSubmit} className="surgir w-full max-w-[360px]">
        {/* O `-mr` cancela o espaço que a última letra ganha do `tracking`:
            sem ele o nome fica meio caractere à esquerda do fio. */}
        <h1 className="-mr-[0.16em] mb-3.5 text-center font-display text-[22px] font-semibold uppercase leading-none tracking-[0.16em] text-tinta-900 sm:text-[28px]">
          ILNET TELECOM
        </h1>
        {/* Um fio da cor da casa, só para o nome não flutuar solto. */}
        <div aria-hidden className="mx-auto mb-9 h-px w-16 bg-brand-500/60" />

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
          // O teclado do celular abre com maiúscula e corretor ligados, e o
          // e-mail volta como "Joao@Empresa.com" com sublinhado vermelho.
          autoCapitalize="none"
          spellCheck={false}
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
  );
}
