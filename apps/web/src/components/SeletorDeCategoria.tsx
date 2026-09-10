import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, mensagemErro } from '../lib/api';
import { semAcento } from '../lib/busca';
import { emArvore } from '../lib/categorias';
import type { CategoriaDespesa } from '../lib/types';

/** Uma opção de fora do cadastro — hoje só o "— tirar a categoria —". */
export interface OpcaoExtra {
  valor: string;
  rotulo: string;
}

interface Props {
  categorias: CategoriaDespesa[] | undefined;
  value: string;
  onChange: (id: string) => void;
  /** Rótulo da opção vazia: "Sem classificação", "Escolha a categoria…". */
  vazio: string;
  /**
   * Opções extras, logo antes da de criar.
   *
   * São dados, e não `<option>` prontos: a lista deixou de ser um `<select>`
   * nativo (ver abaixo), e um elemento `option` solto no meio dela não teria
   * onde ser renderizado.
   */
  extras?: OpcaoExtra[];
  /**
   * Linha de ajuda sob o campo de nomear. Fica de fora na barra de seleção em
   * lote, que é escura e estreita: ali `ajuda` é cinza-médio sobre fundo quase
   * preto no tema claro, e a frase custaria mais do que explica.
   */
  ajuda?: string;
  carregando?: boolean;
  desabilitado?: boolean;
  id?: string;
  className?: string;
  title?: string;
}

/**
 * O seletor de categoria, com a criação embutida.
 *
 * Classificar um débito e cadastrar a categoria eram duas telas: quem estava
 * com a conta na frente e não achava a etiqueta certa tinha de sair daqui, ir
 * ao cadastro, criar, e voltar para achar o débito de novo. O caminho longo
 * custava a classificação — o débito ficava sem etiqueta, que é o que o
 * dashboard não sabe somar.
 *
 * A criação vive dentro do próprio seletor, e não num botão ao lado, porque é
 * ali que a falta é percebida: a pessoa abre a lista à procura de um nome, não
 * o encontra, e a saída está na mesma lista que ela já está lendo.
 *
 * **Não é um `<select>`**, e essa é a decisão que manda no resto do arquivo.
 * O cadastro tem dois níveis, e escolher uma subcategoria pede dois gestos:
 * abrir o grupo e escolher dentro dele. Numa lista nativa o primeiro gesto
 * **fecha a lista** — o navegador não deixa escolher sem fechar —, e a pessoa
 * tinha de abrir de novo para dar o segundo. Duas aberturas para uma escolha.
 * Aqui a lista é nossa: clicar num grupo abre o grupo e a lista continua de
 * pé, com as filhas logo abaixo do nome da mãe.
 */
export function SeletorDeCategoria({
  categorias,
  value,
  onChange,
  vazio,
  extras,
  ajuda,
  carregando = false,
  desabilitado = false,
  id,
  className = 'campo',
  title,
}: Props) {
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState('');
  const [aberta, setAberta] = useState(false);
  /** O grupo destrinchado agora. Um por vez: dois abertos são a lista longa de novo. */
  const [grupoAberto, setGrupoAberto] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  /**
   * A recém-criada entra na lista à mão até a releitura chegar. Sem isto o
   * `value` apontaria, por um instante, para uma opção que ainda não existe, e
   * o campo apareceria em branco justo depois de a pessoa criar a categoria.
   */
  const [recemCriada, setRecemCriada] = useState<CategoriaDespesa | null>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const qc = useQueryClient();

  const criar = useMutation({
    mutationFn: async (n: string) =>
      (await api.post<CategoriaDespesa>('/categorias-despesa', { nome: n }))
        .data,
    onSuccess: (c) => {
      setRecemCriada(c);
      setCriando(false);
      setNome('');
      void qc.invalidateQueries({ queryKey: ['categorias-despesa'] });
      void qc.invalidateQueries({ queryKey: ['contas-abertas'] });
      // Ela foi criada para ser usada agora — deixar a escolha para um segundo
      // gesto é repetir, em menor escala, a viagem que este campo evita.
      onChange(c.id);
    },
  });

  const lista = categorias ?? [];
  const opcoes =
    recemCriada && !lista.some((c) => c.id === recemCriada.id)
      ? [...lista, recemCriada]
      : lista;

  const { grupos, soltas } = emArvore(opcoes);
  const escolhida = opcoes.find((c) => c.id === value) ?? null;
  const extra = extras?.find((e) => e.valor === value) ?? null;

  const podeCriar = nome.trim().length >= 2 && !criar.isPending;

  function desistir() {
    setCriando(false);
    setNome('');
    criar.reset();
  }

  function fechar() {
    setAberta(false);
    setBusca('');
  }

  function escolher(id: string) {
    fechar();
    onChange(id);
  }

  if (criando) {
    return (
      <div className={className === 'campo' ? '' : 'min-w-0'}>
        <div className="flex items-center gap-2">
          <input
            id={id}
            value={nome}
            autoFocus
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (podeCriar) criar.mutate(nome);
              }
              if (e.key === 'Escape') desistir();
            }}
            placeholder="Nome da nova categoria"
            className="campo min-w-0 flex-1"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => criar.mutate(nome)}
            disabled={!podeCriar}
            className="btn btn-primario shrink-0"
          >
            {criar.isPending ? 'Criando…' : 'Criar'}
          </button>
          <button
            type="button"
            onClick={desistir}
            disabled={criar.isPending}
            className="btn btn-neutro shrink-0"
          >
            Cancelar
          </button>
        </div>
        {criar.isError ? (
          <p className="mt-2 text-sm text-rose-600">
            {mensagemErro(criar.error)}
          </p>
        ) : (
          ajuda && <p className="ajuda">{ajuda}</p>
        )}
      </div>
    );
  }

  /*
   * O que o campo mostra fechado: a categoria escolhida, com o grupo dela na
   * frente. "Expansão › Fazenda" cabe onde "Fazenda" sozinha deixaria a
   * dúvida — há "Manutenção" em dois grupos diferentes neste cadastro.
   */
  const rotulo = escolhida
    ? escolhida.pai
      ? `${escolhida.pai.nome} › ${escolhida.nome}`
      : escolhida.nome
    : (extra?.rotulo ?? vazio);

  return (
    <div className={className === 'campo' ? '' : 'min-w-0'}>
      <button
        ref={botao}
        id={id}
        type="button"
        title={title}
        disabled={carregando || desabilitado}
        onClick={() => {
          // Abrir já com o grupo da categoria atual destrinchado: quem vai
          // trocar "Fazenda" por "Investimento" abre a lista no lugar certo.
          setGrupoAberto(escolhida?.pai?.id ?? null);
          setAberta(true);
        }}
        aria-haspopup="listbox"
        aria-expanded={aberta}
        className={`${className} flex items-center justify-between gap-2 text-left`}
      >
        <span className={`truncate ${escolhida ? '' : 'text-tinta-400'}`}>
          {carregando ? 'Carregando…' : rotulo}
        </span>
        <SetaDeAbrir />
      </button>

      {aberta && (
        <ListaDeCategorias
          ancora={botao.current}
          grupos={grupos}
          soltas={soltas}
          value={value}
          vazio={vazio}
          extras={extras}
          busca={busca}
          onBusca={setBusca}
          grupoAberto={grupoAberto}
          onGrupo={(gid) => setGrupoAberto((atual) => (atual === gid ? null : gid))}
          onEscolher={escolher}
          onCriar={() => {
            fechar();
            setCriando(true);
          }}
          onFechar={fechar}
        />
      )}

      {ajuda && <p className="ajuda">{ajuda}</p>}
    </div>
  );
}

/** Quantos nomes a lista mostra sem precisar da busca para caber. */
const ALTURA_DA_LISTA = 'max-h-[19rem]';

/**
 * Aparelho de toque (celular, tablet): sem mouse, e com teclado que sobe na
 * tela quando um campo ganha foco.
 */
const TELA_DE_TOQUE =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(hover: none) and (pointer: coarse)').matches === true;

/**
 * A lista aberta.
 *
 * Vai pendurada no `body` e posicionada por `fixed` a partir do botão. Escrita
 * no lugar, ela seria cortada pelo primeiro ancestral que rola — a linha de uma
 * tabela, a janela de um pagamento —, e a lista de categorias apareceria pela
 * metade justamente nas telas em que ela é mais usada.
 */
function ListaDeCategorias({
  ancora,
  grupos,
  soltas,
  value,
  vazio,
  extras,
  busca,
  onBusca,
  grupoAberto,
  onGrupo,
  onEscolher,
  onCriar,
  onFechar,
}: {
  ancora: HTMLElement | null;
  grupos: ReturnType<typeof emArvore>['grupos'];
  soltas: CategoriaDespesa[];
  value: string;
  vazio: string;
  extras?: OpcaoExtra[];
  busca: string;
  onBusca: (b: string) => void;
  grupoAberto: string | null;
  onGrupo: (id: string) => void;
  onEscolher: (id: string) => void;
  onCriar: () => void;
  onFechar: () => void;
}) {
  const painel = useRef<HTMLDivElement>(null);
  const [lugar, setLugar] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);

  /*
   * Onde a lista cai. Medido depois da montagem e antes da pintura, para ela
   * não aparecer no canto da tela antes de saltar para o lugar.
   *
   * Se não couber embaixo do campo, ela sobe: numa linha de tabela lá no pé da
   * página, "embaixo" é fora da janela.
   */
  useLayoutEffect(() => {
    if (!ancora) return;
    const medir = () => {
      const r = ancora.getBoundingClientRect();
      const altura = painel.current?.offsetHeight ?? 320;
      const cabeEmbaixo = r.bottom + altura + 8 < window.innerHeight;
      setLugar({
        left: Math.max(8, Math.min(r.left, window.innerWidth - r.width - 8)),
        top: cabeEmbaixo ? r.bottom + 4 : Math.max(8, r.top - altura - 4),
        width: Math.max(r.width, 260),
      });
    };
    medir();
    window.addEventListener('resize', medir);
    // `true` para pegar a rolagem de qualquer container, e não só a da página.
    window.addEventListener('scroll', medir, true);
    return () => {
      window.removeEventListener('resize', medir);
      window.removeEventListener('scroll', medir, true);
    };
  }, [ancora]);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFechar();
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [onFechar]);

  const termo = semAcento(busca.trim());

  /*
   * Procurando, a árvore some e vira uma lista só de nomes escolhíveis.
   *
   * O grupo entra na comparação junto com o nome: quem digita "expansão" quer
   * as filhas dela, e nenhuma delas se chama "expansão". É o que faz a busca
   * responder pelo nome do grupo sem obrigar a abri-lo.
   */
  const achados = termo
    ? [
        ...soltas.map((c) => ({ c, grupo: null as string | null })),
        ...grupos.flatMap(({ mae, filhas }) => [
          ...(mae.emUso > 0 ? [{ c: mae, grupo: null as string | null }] : []),
          ...filhas.map((f) => ({ c: f, grupo: mae.nome })),
        ]),
      ].filter(({ c, grupo }) =>
        semAcento(`${grupo ?? ''} ${c.nome}`).includes(termo),
      )
    : [];

  /* Parada, a lista é o nível de cima: mães e soltas juntas, em ordem
     alfabética. Para quem procura, "Seguro" e "Custo com Pessoal" são a mesma
     coisa — um nome de cima —, e o negrito diz qual das duas abre mais. */
  const doTopo = [
    ...soltas.map((c) => ({ id: c.id, nome: c.nome, mae: null })),
    ...grupos.map((g) => ({ id: g.mae.id, nome: g.mae.nome, mae: g })),
  ].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  return createPortal(
    <>
      {/* Clicar fora fecha. Transparente: a lista é consulta, e escurecer o
          fundo esconderia justamente o débito que se está classificando. */}
      <div onClick={onFechar} aria-hidden className="fixed inset-0 z-[55]" />

      <div
        ref={painel}
        role="listbox"
        style={
          lugar
            ? { left: lugar.left, top: lugar.top, width: lugar.width }
            : { left: -9999, top: 0 }
        }
        className={`fixed z-[56] overflow-hidden rounded-xl border border-tinta-200 bg-papel shadow-2xl`}
      >
        <div className="border-b border-tinta-200 p-2">
          {/* No computador a busca já abre com o cursor: digitar é o jeito
              mais rápido de achar. Na tela de toque, não — o foco levanta o
              teclado, que cobre metade da lista que se abriu para ser vista.
              Lá, quem quer procurar toca no campo. */}
          <input
            autoFocus={!TELA_DE_TOQUE}
            value={busca}
            onChange={(e) => onBusca(e.target.value)}
            placeholder="Procurar categoria…"
            className="campo py-1.5 text-sm"
            autoComplete="off"
          />
        </div>

        <div className={`rolagem-fina overflow-y-auto ${ALTURA_DA_LISTA}`}>
          {termo ? (
            achados.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-tinta-400">
                Nenhuma categoria com esse nome.
              </p>
            ) : (
              achados.map(({ c, grupo }) => (
                <Linha
                  key={c.id}
                  marcada={c.id === value}
                  onClick={() => onEscolher(c.id)}
                >
                  {grupo && (
                    <span className="text-tinta-400">{grupo} › </span>
                  )}
                  {c.nome}
                </Linha>
              ))
            )
          ) : (
            <>
              <Linha marcada={value === ''} onClick={() => onEscolher('')}>
                <span className="text-tinta-500">{vazio}</span>
              </Linha>

              {doTopo.map((item) =>
                item.mae === null ? (
                  <Linha
                    key={item.id}
                    marcada={item.id === value}
                    onClick={() => onEscolher(item.id)}
                  >
                    {item.nome}
                  </Linha>
                ) : (
                  <div key={item.id}>
                    {/*
                      A mãe abre o grupo e a lista **continua de pé**. É a razão
                      de este componente não ser um `<select>`: lá, clicar aqui
                      fechava tudo e obrigava a abrir de novo para escolher a
                      subcategoria.

                      As filhas nascem logo abaixo dela, no lugar onde o dedo
                      já está. Levá-la para o topo da lista, como um `<select>`
                      precisaria fazer para o segundo clique ser curto, aqui
                      seria o contrário: a lista saltaria debaixo do cursor.
                    */}
                    <Linha
                      grupo
                      aberto={grupoAberto === item.id}
                      marcada={item.id === value}
                      onClick={() => onGrupo(item.id)}
                    >
                      {item.nome}
                    </Linha>

                    {grupoAberto === item.id && (
                      <>
                        {/*
                          A mãe só é escolhível quando já etiqueta alguma conta.
                          Grupo é cabeçalho — quem etiqueta é a subcategoria,
                          senão o gasto para no nível de cima e o dashboard não
                          tem o que destrinchar. Mas quem ganhou filhas depois
                          de já ter contas etiquetadas continua na lista: tirá-la
                          seria mudar, sem avisar, a etiqueta de contas já
                          classificadas.
                        */}
                        {item.mae.mae.emUso > 0 && (
                          <Linha
                            filha
                            marcada={item.id === value}
                            onClick={() => onEscolher(item.id)}
                          >
                            <span className="text-tinta-400">
                              — sem subcategoria —
                            </span>
                          </Linha>
                        )}
                        {item.mae.filhas.map((f) => (
                          <Linha
                            key={f.id}
                            filha
                            marcada={f.id === value}
                            onClick={() => onEscolher(f.id)}
                          >
                            {f.nome}
                          </Linha>
                        ))}
                      </>
                    )}
                  </div>
                ),
              )}

              {extras?.map((e) => (
                <Linha
                  key={e.valor}
                  marcada={e.valor === value}
                  onClick={() => onEscolher(e.valor)}
                >
                  <span className="text-tinta-500">{e.rotulo}</span>
                </Linha>
              ))}
            </>
          )}
        </div>

        <button
          type="button"
          onClick={onCriar}
          className="w-full border-t border-tinta-200 px-3 py-2.5 text-left text-sm font-semibold text-brand-700 transition hover:bg-brand-500/10 dark:text-brand-300"
        >
          + Criar nova categoria…
        </button>
      </div>
    </>,
    document.body,
  );
}

/** Uma linha da lista. Alvo de 40px: é uma lista para o dedo também. */
function Linha({
  grupo = false,
  filha = false,
  aberto = false,
  marcada,
  onClick,
  children,
}: {
  grupo?: boolean;
  filha?: boolean;
  aberto?: boolean;
  marcada: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={marcada}
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition ${
        filha ? 'pl-8' : ''
      } ${grupo ? 'font-bold text-tinta-800' : 'text-tinta-700'} ${
        marcada
          ? 'bg-brand-500/10 text-brand-800 dark:text-brand-200'
          : 'hover:bg-tinta-100'
      }`}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {grupo && <SetaDoGrupo aberto={aberto} />}
    </button>
  );
}

function SetaDeAbrir() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-tinta-400"
      aria-hidden
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** A seta do grupo: para o lado fechado, para baixo aberto. */
function SetaDoGrupo({ aberto }: { aberto: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 text-tinta-400 transition-transform ${
        aberto ? 'rotate-90' : ''
      }`}
      aria-hidden
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
