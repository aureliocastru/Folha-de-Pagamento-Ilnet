import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  Carregando,
  Janela,
  Pagina,
  Selo,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { useTermoAdiado } from '../../lib/busca';
import { formatData } from '../../lib/format';
import { mascararCpf } from '../../lib/pontos';

interface Coordenador {
  id: string;
  nome: string;
  cpf: string;
  ativo: boolean;
  travado: boolean;
  ultimoAcessoEm: string | null;
}

interface FuncionarioDoCadastro {
  id: string;
  nome: string;
  cpfCnpj: string | null;
}

/**
 * Quem pode pontuar.
 *
 * É uma lista à parte dos logins do sistema: coordenador entra só no portal de
 * pontos, com o CPF e uma senha de 4 a 6 números que se define aqui. Esquecida
 * a senha — ou travado o login depois de errar demais —, o remédio é o mesmo:
 * definir outra.
 */
export function Coordenadores() {
  const qc = useQueryClient();
  const [cadastrando, setCadastrando] = useState(false);
  const [trocandoSenha, setTrocandoSenha] = useState<Coordenador | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; erro: boolean } | null>(null);
  const [copiado, setCopiado] = useState(false);

  const lista = useQuery({
    queryKey: ['pontuacao', 'coordenadores'],
    queryFn: async () => (await api.get<Coordenador[]>('/pontuacao/coordenadores')).data,
  });

  function recarregar() {
    void qc.invalidateQueries({ queryKey: ['pontuacao', 'coordenadores'] });
  }

  const alterar = useMutation({
    mutationFn: async (args: { id: string; dados: Record<string, unknown> }) => {
      await api.patch(`/pontuacao/coordenadores/${args.id}`, args.dados);
    },
    onSuccess: recarregar,
    onError: (err) => setAviso({ texto: mensagemErro(err), erro: true }),
  });

  const remover = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/pontuacao/coordenadores/${id}`);
    },
    onSuccess: () => {
      setAviso({ texto: 'Removido da coordenação. Os pontos já lançados continuam.', erro: false });
      recarregar();
    },
    onError: (err) => setAviso({ texto: mensagemErro(err), erro: true }),
  });

  const endereco = `${window.location.origin}/pontos`;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(endereco);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sem permissão para a área de transferência: o endereço está à vista.
    }
  }

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Pontuação"
        titulo="Coordenadores"
        descricao="Quem pode pontuar. Cada um entra no portal com o CPF e a senha definida aqui."
        acoes={
          <button onClick={() => setCadastrando(true)} className="btn btn-acao">
            Cadastrar coordenador
          </button>
        }
      />

      {/* O endereço que se manda no grupo: é o mesmo para quem pontua e para
          quem quer ver os próprios pontos. */}
      <Bloco className="mb-4">
        <p className="eyebrow mb-1.5">Endereço do portal</p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="num rounded-lg bg-tinta-100 px-3 py-1.5 text-sm text-tinta-800">
            {endereco}
          </code>
          <button onClick={copiar} className="btn btn-neutro btn-p">
            {copiado ? 'Copiado!' : 'Copiar'}
          </button>
        </div>
        <p className="ajuda">
          Coordenador digita o CPF e a senha e pontua. Funcionário digita só o
          CPF e vê os próprios pontos e em que lugar está.
        </p>
      </Bloco>

      {aviso && (
        <Aviso
          tom={aviso.erro ? 'erro' : 'pago'}
          acao={
            <button onClick={() => setAviso(null)} className="btn btn-sutil btn-p">
              Fechar
            </button>
          }
        >
          {aviso.texto}
        </Aviso>
      )}

      <Bloco semPadding>
        {lista.isLoading ? (
          <Carregando />
        ) : (lista.data ?? []).length === 0 ? (
          <Vazio titulo="Nenhum coordenador ainda">
            Cadastre quem vai pontuar: o nome, o CPF e uma senha de 4 a 6
            números para cada um.
          </Vazio>
        ) : (
          <ul className="lista-dividida">
            {(lista.data ?? []).map((c) => (
              <li
                key={c.id}
                className={`flex flex-wrap items-center gap-3 px-3.5 py-3 md:px-5 ${c.ativo ? '' : 'opacity-60'}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5 font-medium text-tinta-800">
                    {c.nome}
                    {!c.ativo && (
                      <Selo pequeno tom="neutro">
                        desligado
                      </Selo>
                    )}
                    {c.travado && (
                      <Selo pequeno tom="erro" titulo="Errou a senha 5 vezes seguidas. Defina uma senha nova para destravar.">
                        travado
                      </Selo>
                    )}
                  </span>
                  <span className="num block text-xs text-tinta-400">
                    CPF {mascararCpf(c.cpf)} ·{' '}
                    {c.ultimoAcessoEm ? `último acesso ${formatData(c.ultimoAcessoEm)}` : 'ainda não entrou'}
                  </span>
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => setTrocandoSenha(c)} className="btn btn-neutro btn-p">
                    {c.travado ? 'Destravar' : 'Trocar senha'}
                  </button>
                  <button
                    onClick={() => alterar.mutate({ id: c.id, dados: { ativo: !c.ativo } })}
                    className="btn btn-sutil btn-p"
                  >
                    {c.ativo ? 'Desligar' : 'Religar'}
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Tirar ${c.nome} da coordenação? Os pontos já lançados continuam.`)) {
                        remover.mutate(c.id);
                      }
                    }}
                    className="btn btn-perigo btn-p"
                  >
                    Remover
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Bloco>

      {cadastrando && (
        <CadastroDeCoordenador
          onFechar={() => setCadastrando(false)}
          onPronto={(nome) => {
            setCadastrando(false);
            setAviso({
              texto: `${nome} já pode pontuar. Mande o endereço do portal e a senha.`,
              erro: false,
            });
            recarregar();
          }}
        />
      )}

      {trocandoSenha && (
        <TrocarSenha
          coordenador={trocandoSenha}
          onFechar={() => setTrocandoSenha(null)}
          onPronto={() => {
            setAviso({ texto: `Senha de ${trocandoSenha.nome} trocada.`, erro: false });
            setTrocandoSenha(null);
            recarregar();
          }}
        />
      )}
    </Pagina>
  );
}

/**
 * Cadastrar um coordenador. O nome e o CPF podem vir do cadastro de
 * funcionários — é de lá que eles quase sempre são — ou ser digitados, para
 * quem pontua e não está na folha.
 */
function CadastroDeCoordenador({
  onFechar,
  onPronto,
}: {
  onFechar: () => void;
  onPronto: (nome: string) => void;
}) {
  const [nome, setNome] = useState('');
  const [cpf, setCpf] = useState('');
  const [senha, setSenha] = useState('');
  const [termo, setTermo] = useState('');
  const busca = useTermoAdiado(termo);

  const funcionarios = useQuery({
    queryKey: ['funcionarios', 'busca-coordenador', busca],
    queryFn: async () =>
      (
        await api.get<{ itens: FuncionarioDoCadastro[] }>('/funcionarios', {
          params: { busca, todos: 'true', pageSize: 8 },
        })
      ).data.itens,
    enabled: busca.length >= 2,
  });

  const salvar = useMutation({
    mutationFn: async () => {
      await api.post('/pontuacao/coordenadores', {
        nome: nome.trim(),
        cpf: cpf.replace(/\D/g, ''),
        senha,
      });
    },
    onSuccess: () => onPronto(nome.trim()),
  });

  const pode = nome.trim().length >= 2 && cpf.replace(/\D/g, '').length === 11 && /^\d{4,6}$/.test(senha);

  return (
    <Janela titulo="Cadastrar coordenador" onFechar={onFechar}>
      <label className="rotulo" htmlFor="coord-busca">
        Puxar do cadastro de funcionários
      </label>
      <input
        id="coord-busca"
        value={termo}
        onChange={(e) => setTermo(e.target.value)}
        className="campo"
        placeholder="Digite o nome"
        autoComplete="off"
      />
      {funcionarios.data && funcionarios.data.length > 0 && (
        <div className="mt-2 max-h-44 overflow-y-auto rolagem-fina rounded-xl border border-tinta-100">
          {funcionarios.data.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                setNome(f.nome);
                setCpf(mascararCpf(f.cpfCnpj ?? ''));
                setTermo('');
              }}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-tinta-50"
            >
              <span className="text-tinta-800">{f.nome}</span>
              <span className="num ml-2 text-xs text-tinta-400">
                {f.cpfCnpj ? mascararCpf(f.cpfCnpj) : 'sem CPF no cadastro'}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="rotulo" htmlFor="coord-nome">
            Nome
          </label>
          <input
            id="coord-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className="campo"
            autoComplete="off"
          />
        </div>
        <div>
          <label className="rotulo" htmlFor="coord-cpf">
            CPF (é o login)
          </label>
          <input
            id="coord-cpf"
            value={cpf}
            onChange={(e) => setCpf(mascararCpf(e.target.value))}
            className="campo num"
            inputMode="numeric"
            placeholder="000.000.000-00"
            autoComplete="off"
          />
        </div>
        <div>
          <label className="rotulo" htmlFor="coord-senha">
            Senha (4 a 6 números)
          </label>
          <input
            id="coord-senha"
            value={senha}
            onChange={(e) => setSenha(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className="campo num tracking-widest"
            inputMode="numeric"
            autoComplete="new-password"
          />
        </div>
      </div>

      {salvar.isError && <Aviso tom="erro">{mensagemErro(salvar.error)}</Aviso>}

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onFechar} className="btn btn-neutro">
          Cancelar
        </button>
        <button
          onClick={() => salvar.mutate()}
          disabled={!pode || salvar.isPending}
          className="btn btn-primario"
        >
          {salvar.isPending ? 'Salvando…' : 'Cadastrar'}
        </button>
      </div>
    </Janela>
  );
}

function TrocarSenha({
  coordenador,
  onFechar,
  onPronto,
}: {
  coordenador: Coordenador;
  onFechar: () => void;
  onPronto: () => void;
}) {
  const [senha, setSenha] = useState('');
  const salvar = useMutation({
    mutationFn: async () => {
      await api.patch(`/pontuacao/coordenadores/${coordenador.id}`, { senha });
    },
    onSuccess: onPronto,
  });

  return (
    <Janela titulo={`Senha de ${coordenador.nome}`} onFechar={onFechar}>
      <label className="rotulo" htmlFor="coord-senha-nova">
        Senha nova (4 a 6 números)
      </label>
      <input
        id="coord-senha-nova"
        value={senha}
        onChange={(e) => setSenha(e.target.value.replace(/\D/g, '').slice(0, 6))}
        className="campo num tracking-widest"
        inputMode="numeric"
        autoComplete="new-password"
        autoFocus
      />
      <p className="ajuda">Trocar a senha também destrava quem errou demais.</p>
      {salvar.isError && <Aviso tom="erro">{mensagemErro(salvar.error)}</Aviso>}
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onFechar} className="btn btn-neutro">
          Cancelar
        </button>
        <button
          onClick={() => salvar.mutate()}
          disabled={!/^\d{4,6}$/.test(senha) || salvar.isPending}
          className="btn btn-primario"
        >
          {salvar.isPending ? 'Salvando…' : 'Salvar senha'}
        </button>
      </div>
    </Janela>
  );
}
