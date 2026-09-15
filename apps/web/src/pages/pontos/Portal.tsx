import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { PainelDePontos } from '../../components/PainelDePontos';
import { IconeBomba, IconeTrofeu } from '../../components/icones';
import { Aviso, Carregando } from '../../components/ui';
import { mensagemErro } from '../../lib/api';
import { apiPontos, mascararCpf, tokenDoPortal } from '../../lib/pontos';
import { TelaDeAbastecimento, useVeiculosDoCpf } from './Abastecimento';
import { type MinhaPontuacao, TelaDaMinhaPontuacao } from './MinhaPontuacao';

type Etapa =
  | { tipo: 'cpf' }
  | { tipo: 'senha'; cpf: string; nome: string | null; funcionario: boolean }
  | { tipo: 'coordenador'; nome: string }
  | { tipo: 'funcionario'; cpf: string; aba?: AbaDoFuncionario };

/** As duas telas de quem entra só com o CPF. */
type AbaDoFuncionario = 'pontos' | 'abastecimento';

/**
 * O portal de pontos — a porta de quem não tem login no sistema.
 *
 * Uma pergunta só na entrada: o CPF. Se ele é de um coordenador, vem a senha
 * e depois o painel de pontuar; se é de um funcionário, a tela dele abre na
 * hora. Nada de usuário, e-mail ou "esqueci a senha": quem pontua é meia
 * dúzia de pessoas, e quem é pontuado só precisa saber o próprio CPF.
 */
export function Portal() {
  const qc = useQueryClient();
  const [etapa, setEtapa] = useState<Etapa>({ tipo: 'cpf' });

  /*
   * O coordenador que já entrou hoje volta direto para o painel. O token dura
   * doze horas — o turno —, e pedir a senha a cada vez que ele abre o celular
   * seria o jeito mais rápido de ele deixar de usar.
   */
  const sessao = useQuery({
    queryKey: ['pontos', 'eu'],
    queryFn: async () => (await apiPontos.get<{ nome: string }>('/pontos/eu')).data,
    enabled: !!tokenDoPortal.ler(),
    retry: 0,
  });

  useEffect(() => {
    if (sessao.data) setEtapa({ tipo: 'coordenador', nome: sessao.data.nome });
    if (sessao.isError) tokenDoPortal.apagar();
  }, [sessao.data, sessao.isError]);

  // Estável entre renders: a área do funcionário a chama de dentro de um efeito.
  const trocarAba = useCallback(
    (aba: AbaDoFuncionario) =>
      setEtapa((e) => (e.tipo === 'funcionario' ? { ...e, aba } : e)),
    [],
  );

  function sair() {
    tokenDoPortal.apagar();
    qc.removeQueries({ queryKey: ['pontos'] });
    setEtapa({ tipo: 'cpf' });
  }

  return (
    <div className="min-h-screen bg-tinta-50">
      <header className="sticky top-0 z-20 border-b border-tinta-200 bg-papel/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <img src="/logo-ilnet.png" alt="ilnet" width={92} height={57} className="h-auto w-[72px]" />
            <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-tinta-400">
              {etapa.tipo === 'funcionario' && etapa.aba === 'abastecimento'
                ? 'Abastecimento'
                : 'Pontuação'}
            </span>
          </div>
          {etapa.tipo !== 'cpf' && (
            <button onClick={sair} className="btn btn-neutro btn-p">
              Sair
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl px-4 pb-10 pt-5">
        {sessao.isLoading && tokenDoPortal.ler() ? (
          <Carregando />
        ) : etapa.tipo === 'cpf' ? (
          <EntradaPorCpf
            onCoordenador={(cpf, nome, funcionario) =>
              setEtapa({ tipo: 'senha', cpf, nome, funcionario })
            }
            onFuncionario={(cpf) => setEtapa({ tipo: 'funcionario', cpf })}
          />
        ) : etapa.tipo === 'senha' ? (
          <SenhaDoCoordenador
            cpf={etapa.cpf}
            nome={etapa.nome}
            funcionario={etapa.funcionario}
            onEntrou={(nome) => setEtapa({ tipo: 'coordenador', nome })}
            onSoMinha={(aba) => setEtapa({ tipo: 'funcionario', cpf: etapa.cpf, aba })}
            onVoltar={() => setEtapa({ tipo: 'cpf' })}
          />
        ) : etapa.tipo === 'coordenador' ? (
          <>
            <p className="eyebrow mb-1">Coordenação</p>
            <h1 className="titulo-pagina mb-4">Olá, {etapa.nome.split(' ')[0]}</h1>
            <PainelDePontos cliente={apiPontos} base="/pontos" />
          </>
        ) : (
          <AreaDoFuncionario
            cpf={etapa.cpf}
            aba={etapa.aba}
            onAba={trocarAba}
          />
        )}
      </main>
    </div>
  );
}

/**
 * O que abre para quem entra só com o CPF: a pontuação e, se algum veículo da
 * frota está no nome dele, o abastecimento.
 *
 * Quem tem veículo cai direto no abastecimento: ele abre o portal no posto,
 * com a nota na mão. A pontuação fica a um toque, na aba ao lado.
 */
function AreaDoFuncionario({
  cpf,
  aba,
  onAba,
}: {
  cpf: string;
  aba?: AbaDoFuncionario;
  onAba: (aba: AbaDoFuncionario) => void;
}) {
  const veiculos = useVeiculosDoCpf(cpf);
  const temVeiculo = (veiculos.data?.veiculos.length ?? 0) > 0;
  const padrao: AbaDoFuncionario = temVeiculo ? 'abastecimento' : 'pontos';

  // A aba escolhida sozinha vira a da etapa: é por ela que o cabeçalho diz onde se está.
  useEffect(() => {
    if (!aba && !veiculos.isLoading) onAba(padrao);
  }, [aba, veiculos.isLoading, padrao, onAba]);

  if (veiculos.isLoading && !aba) return <Carregando />;

  const atual: AbaDoFuncionario = aba ?? padrao;

  return (
    <>
      {(temVeiculo || atual === 'abastecimento') && (
        <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-tinta-100 p-1">
          {(
            [
              ['abastecimento', 'Abastecimento', IconeBomba],
              ['pontos', 'Pontuação', IconeTrofeu],
            ] as const
          ).map(([valor, rotulo, Icone]) => (
            <button
              key={valor}
              type="button"
              onClick={() => onAba(valor)}
              aria-pressed={atual === valor}
              className={`flex h-11 items-center justify-center gap-2 rounded-lg text-sm font-semibold transition ${
                atual === valor
                  ? 'bg-papel text-tinta-900 shadow-sm'
                  : 'text-tinta-500 hover:text-tinta-700'
              }`}
            >
              <Icone className="h-4 w-4" />
              {rotulo}
            </button>
          ))}
        </div>
      )}
      {atual === 'abastecimento' ? (
        <TelaDeAbastecimento cpf={cpf} />
      ) : (
        <TelaDoFuncionario cpf={cpf} />
      )}
    </>
  );
}

function Cartao({ children }: { children: ReactNode }) {
  return <div className="card mx-auto mt-6 max-w-sm p-5 sm:p-6">{children}</div>;
}

function EntradaPorCpf({
  onCoordenador,
  onFuncionario,
}: {
  onCoordenador: (cpf: string, nome: string | null, funcionario: boolean) => void;
  onFuncionario: (cpf: string) => void;
}) {
  const [cpf, setCpf] = useState('');
  const digitos = cpf.replace(/\D/g, '');

  const identificar = useMutation({
    mutationFn: async () =>
      (
        await apiPontos.post<{ coordenador: boolean; funcionario: boolean; nome: string | null }>(
          '/pontos/identificar',
          { cpf: digitos },
        )
      ).data,
    onSuccess: (r) => {
      if (r.coordenador) onCoordenador(digitos, r.nome, r.funcionario);
      else onFuncionario(digitos);
    },
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (digitos.length === 11 && !identificar.isPending) identificar.mutate();
  }

  return (
    <Cartao>
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-400/15 text-amber-600 dark:text-amber-300">
        <IconeTrofeu className="h-6 w-6" />
      </div>
      <h1 className="font-display text-xl font-semibold text-tinta-900">Pontuação e abastecimento</h1>
      <p className="mb-5 mt-1 text-sm text-tinta-500">Digite seu CPF para entrar.</p>
      <form onSubmit={enviar}>
        <label className="rotulo" htmlFor="portal-cpf">
          CPF
        </label>
        <input
          id="portal-cpf"
          value={cpf}
          onChange={(e) => setCpf(mascararCpf(e.target.value))}
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          placeholder="000.000.000-00"
          className="campo num mb-4 h-12 text-lg tracking-wide"
        />
        {identificar.isError && <Aviso tom="erro">{mensagemErro(identificar.error)}</Aviso>}
        <button
          type="submit"
          disabled={digitos.length !== 11 || identificar.isPending}
          className="btn btn-primario h-12 w-full text-base"
        >
          {identificar.isPending ? 'Procurando…' : 'Entrar'}
        </button>
      </form>
    </Cartao>
  );
}

function SenhaDoCoordenador({
  cpf,
  nome,
  funcionario,
  onEntrou,
  onSoMinha,
  onVoltar,
}: {
  cpf: string;
  nome: string | null;
  /** O coordenador também é funcionário: tem pontos, e pode ter veículo. */
  funcionario: boolean;
  onEntrou: (nome: string) => void;
  onSoMinha: (aba: AbaDoFuncionario) => void;
  onVoltar: () => void;
}) {
  const [senha, setSenha] = useState('');
  const campo = useRef<HTMLInputElement>(null);
  const veiculos = useVeiculosDoCpf(cpf, funcionario);
  const temVeiculo = (veiculos.data?.veiculos.length ?? 0) > 0;

  const entrar = useMutation({
    mutationFn: async () =>
      (await apiPontos.post<{ token: string; nome: string }>('/pontos/entrar', { cpf, senha })).data,
    onSuccess: (r) => {
      tokenDoPortal.gravar(r.token);
      onEntrou(r.nome);
    },
    onError: () => {
      setSenha('');
      campo.current?.focus();
    },
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (senha.length >= 4 && !entrar.isPending) entrar.mutate();
  }

  return (
    <Cartao>
      <h1 className="font-display text-xl font-semibold text-tinta-900">
        {nome ? `Olá, ${nome}` : 'Coordenação'}
      </h1>
      <p className="mb-5 mt-1 text-sm text-tinta-500">Digite sua senha para pontuar.</p>
      <form onSubmit={enviar}>
        <label className="rotulo" htmlFor="portal-senha">
          Senha
        </label>
        <input
          id="portal-senha"
          ref={campo}
          type="password"
          value={senha}
          onChange={(e) => setSenha(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoComplete="current-password"
          autoFocus
          placeholder="4 a 6 números"
          className="campo num mb-4 h-12 text-center text-2xl tracking-[0.5em]"
        />
        {entrar.isError && <Aviso tom="erro">{mensagemErro(entrar.error)}</Aviso>}
        <button
          type="submit"
          disabled={senha.length < 4 || entrar.isPending}
          className="btn btn-primario h-12 w-full text-base"
        >
          {entrar.isPending ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
      <div className="mt-4 flex flex-wrap justify-between gap-2 text-sm">
        <button type="button" onClick={onVoltar} className="text-tinta-500 hover:text-tinta-700">
          ‹ Outro CPF
        </button>
        {funcionario && (
          <button
            type="button"
            onClick={() => onSoMinha('pontos')}
            className="font-semibold text-brand-700 hover:underline dark:text-brand-300"
          >
            Ver só a minha pontuação
          </button>
        )}
      </div>
      {temVeiculo && (
        <button
          type="button"
          onClick={() => onSoMinha('abastecimento')}
          className="btn btn-neutro mt-4 h-11 w-full"
        >
          <IconeBomba className="h-4 w-4" />
          Lançar abastecimento
        </button>
      )}
    </Cartao>
  );
}

/** A pontuação de quem entrou com o CPF. */
function TelaDoFuncionario({ cpf }: { cpf: string }) {
  return (
    <TelaDaMinhaPontuacao
      chave={['pontos', 'minha', cpf]}
      buscar={async (competencia) =>
        (await apiPontos.post<MinhaPontuacao>('/pontos/minha', { cpf, competencia })).data
      }
      buscarFoto={async (lancamentoId) =>
        (
          await apiPontos.post<{ foto: string }>('/pontos/minha/foto', {
            cpf,
            lancamentoId,
          })
        ).data.foto
      }
    />
  );
}
