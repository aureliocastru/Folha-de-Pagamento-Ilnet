import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Aviso, Bloco, CabecalhoPagina, Pagina, Selo } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { PERFIL_DESCRICAO, PERFIL_LABEL, PERFIL_TOM } from '../../lib/status';

export function MinhaConta() {
  const { usuario } = useAuth();
  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [repetir, setRepetir] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [erro, setErro] = useState(false);

  const trocar = useMutation({
    mutationFn: async () =>
      (await api.post('/usuarios/minha-senha', { senhaAtual, novaSenha })).data,
    onSuccess: () => {
      setSenhaAtual('');
      setNovaSenha('');
      setRepetir('');
      setErro(false);
      setFeedback('Senha trocada. Ela já vale no próximo login.');
    },
    onError: (err) => {
      setErro(true);
      setFeedback(mensagemErro(err));
    },
  });

  const curta = novaSenha.length > 0 && novaSenha.length < 8;
  const diferem = repetir.length > 0 && repetir !== novaSenha;
  const valido =
    senhaAtual.length > 0 && novaSenha.length >= 8 && repetir === novaSenha;

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Minha conta"
        titulo={usuario?.nome ?? 'Minha conta'}
        descricao="Seu acesso ao sistema."
      />

      {feedback && <Aviso tom={erro ? 'erro' : 'pago'}>{feedback}</Aviso>}

      <div className="grid max-w-4xl grid-cols-1 gap-6 lg:grid-cols-2">
        <Bloco titulo="Trocar minha senha" className="surgir surgir-1">
          <label className="rotulo" htmlFor="atual">
            Senha atual
          </label>
          <input
            id="atual"
            type="password"
            value={senhaAtual}
            onChange={(e) => setSenhaAtual(e.target.value)}
            className="campo mb-4"
            autoComplete="current-password"
          />

          <label className="rotulo" htmlFor="nova">
            Nova senha
          </label>
          <input
            id="nova"
            type="password"
            value={novaSenha}
            onChange={(e) => setNovaSenha(e.target.value)}
            className="campo"
            autoComplete="new-password"
            placeholder="mínimo 8 caracteres"
          />
          {curta && (
            <p className="ajuda text-amber-700">
              Faltam {8 - novaSenha.length} caractere(s).
            </p>
          )}

          <label className="rotulo mt-4" htmlFor="repetir">
            Repita a nova senha
          </label>
          <input
            id="repetir"
            type="password"
            value={repetir}
            onChange={(e) => setRepetir(e.target.value)}
            className="campo"
            autoComplete="new-password"
          />
          {diferem && (
            <p className="ajuda text-amber-700">As duas senhas não batem.</p>
          )}

          <button
            onClick={() => trocar.mutate()}
            disabled={!valido || trocar.isPending}
            className="btn btn-primario mt-5 w-full"
          >
            {trocar.isPending ? 'Trocando…' : 'Trocar senha'}
          </button>
        </Bloco>

        <Bloco titulo="Seu acesso" className="surgir surgir-2">
          <div className="space-y-4">
            <div>
              <p className="eyebrow">E-mail</p>
              <p className="mt-1 text-sm text-tinta-800">{usuario?.email}</p>
            </div>
            <div>
              <p className="eyebrow mb-1.5">Perfil</p>
              {usuario && (
                <>
                  <Selo tom={usuario.perfil ? 'marca' : PERFIL_TOM[usuario.role]}>
                    {usuario.perfil?.nome ?? PERFIL_LABEL[usuario.role]}
                  </Selo>
                  <p className="mt-2 text-sm leading-relaxed text-tinta-500">
                    {usuario.perfil
                      ? 'Perfil montado pelo administrador: ele decide, módulo por módulo, o que você vê e o que altera.'
                      : PERFIL_DESCRICAO[usuario.role]}
                  </p>
                </>
              )}
            </div>
            <p className="border-t border-tinta-100 pt-4 text-xs text-tinta-400">
              Nome, e-mail e perfil são alterados por um administrador, na tela
              Usuários.
            </p>
          </div>
        </Bloco>
      </div>
    </Pagina>
  );
}
