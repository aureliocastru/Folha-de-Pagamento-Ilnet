import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { useAuth } from './lib/auth';
import {
  MODULO_CONTABILIDADE,
  MODULO_CONTAS_PAGAR,
  MODULO_ALMOXARIFADO,
  MODULO_OS,
  MODULO_PATROCINIO,
  MODULO_PONTUACAO,
  MODULO_RH,
  MODULO_SEGURANCA,
  acessosDoUsuario,
  caminhoInicial,
  destinoDepoisDoLogin,
  type Modulo,
} from './lib/modulos';
import { useTabelasNoCelular } from './lib/tabela-no-celular';
import { Login } from './pages/Login';
import { TelaDeFora } from './components/TelaDeFora';
import { TelaProtegida } from './components/TelaProtegida';
import { Suspense, useEffect, type ReactNode } from 'react';
import { preCarregarQuandoOcioso, telaSobDemanda } from './lib/tela-sob-demanda';

const Aprs = telaSobDemanda(() => import('./pages/apr/Aprs').then((m) => m.Aprs));
const AprAberta = telaSobDemanda(() => import('./pages/apr/Aprs').then((m) => m.AprAberta));
const AprNova = telaSobDemanda(() => import('./pages/apr/Aprs').then((m) => m.AprNova));
const Campo = telaSobDemanda(() => import('./pages/apr/Campo').then((m) => m.Campo));
const CampoAbastecimento = telaSobDemanda(() => import('./pages/apr/Campo').then((m) => m.CampoAbastecimento));
const CampoApr = telaSobDemanda(() => import('./pages/apr/Campo').then((m) => m.CampoApr));
const CampoAprs = telaSobDemanda(() => import('./pages/apr/Campo').then((m) => m.CampoAprs));
const CampoInicio = telaSobDemanda(() => import('./pages/apr/Campo').then((m) => m.CampoInicio));
const CampoNova = telaSobDemanda(() => import('./pages/apr/Campo').then((m) => m.CampoNova));
const CampoPontuacao = telaSobDemanda(() => import('./pages/apr/Campo').then((m) => m.CampoPontuacao));
const CampoPontuar = telaSobDemanda(() => import('./pages/apr/Campo').then((m) => m.CampoPontuar));
const Formularios = telaSobDemanda(() => import('./pages/apr/Formularios').then((m) => m.Formularios));
const Assinar = telaSobDemanda(() => import('./pages/Assinar').then((m) => m.Assinar));
const AssinarContrato = telaSobDemanda(() => import('./pages/AssinarContrato').then((m) => m.AssinarContrato));
const CampoMinhasOs = telaSobDemanda(() => import('./pages/os/NoCampo').then((m) => m.CampoMinhasOs));
const CampoOs = telaSobDemanda(() => import('./pages/os/NoCampo').then((m) => m.CampoOs));
const CampoFinalizar = telaSobDemanda(() => import('./pages/os/Finalizar').then((m) => m.CampoFinalizar));
const MateriaisDeOs = telaSobDemanda(() => import('./pages/os/Materiais').then((m) => m.Materiais));
const Recolhidos = telaSobDemanda(() => import('./pages/os/Recolhidos').then((m) => m.Recolhidos));
const RegistrosDeOs = telaSobDemanda(() => import('./pages/os/Registros').then((m) => m.Registros));
const RelatorioDeOs = telaSobDemanda(() => import('./pages/os/Relatorio').then((m) => m.Relatorio));
const TecnicosDeOs = telaSobDemanda(() => import('./pages/os/Tecnicos').then((m) => m.Tecnicos));
const Modulos = telaSobDemanda(() => import('./pages/Modulos').then((m) => m.Modulos));
const ContasPagarInicio = telaSobDemanda(() => import('./pages/contas-pagar/Inicio').then((m) => m.Inicio));
const Estoque = telaSobDemanda(() => import('./pages/almoxarifado/Estoque').then((m) => m.Estoque));
const Conferencia = telaSobDemanda(() => import('./pages/almoxarifado/Conferencia').then((m) => m.Conferencia));
const Almoxarifados = telaSobDemanda(() => import('./pages/almoxarifado/Almoxarifados').then((m) => m.Almoxarifados));
const AlmoxarifadoDetalhe = telaSobDemanda(() => import('./pages/almoxarifado/AlmoxarifadoDetalhe').then((m) => m.AlmoxarifadoDetalhe));
const PecasDoProduto = telaSobDemanda(() => import('./pages/almoxarifado/PecasDoProduto').then((m) => m.PecasDoProduto));
const Transferir = telaSobDemanda(() => import('./pages/almoxarifado/Transferir').then((m) => m.Transferir));
const Ferramentas = telaSobDemanda(() => import('./pages/almoxarifado/Ferramentas').then((m) => m.Ferramentas));
const FornecedoresDeCotacao = telaSobDemanda(() => import('./pages/almoxarifado/Fornecedores').then((m) => m.Fornecedores));
const Comodato = telaSobDemanda(() => import('./pages/almoxarifado/Comodato').then((m) => m.Comodato));
const Precos = telaSobDemanda(() => import('./pages/almoxarifado/Precos').then((m) => m.Precos));
const ContasPagarCategorias = telaSobDemanda(() => import('./pages/contas-pagar/Categorias').then((m) => m.Categorias));
const ContasPagarDashboard = telaSobDemanda(() => import('./pages/contas-pagar/Dashboard').then((m) => m.Dashboard));
const FechamentoCaixa = telaSobDemanda(() => import('./pages/contas-pagar/FechamentoCaixa').then((m) => m.FechamentoCaixa));
const Transferencias = telaSobDemanda(() => import('./pages/contas-pagar/Transferencias').then((m) => m.Transferencias));
const HistoricoDePagamentos = telaSobDemanda(() => import('./pages/contas-pagar/HistoricoDePagamentos').then((m) => m.HistoricoDePagamentos));
const Controle = telaSobDemanda(() => import('./pages/contas-pagar/Controle').then((m) => m.Controle));
const CartoesCredito = telaSobDemanda(() => import('./pages/contas-pagar/CartoesCredito').then((m) => m.CartoesCredito));
const ContasContrato = telaSobDemanda(() => import('./pages/contas-pagar/ContasContrato').then((m) => m.ContasContrato));
const Recorrentes = telaSobDemanda(() => import('./pages/contas-pagar/Recorrentes').then((m) => m.Recorrentes));
const Veiculos = telaSobDemanda(() => import('./pages/contas-pagar/Veiculos').then((m) => m.Veiculos));
const Avulsos = telaSobDemanda(() => import('./pages/folha/Avulsos').then((m) => m.Avulsos));
const Configuracoes = telaSobDemanda(() => import('./pages/folha/Configuracoes').then((m) => m.Configuracoes));
const ContasPagar = telaSobDemanda(() => import('./pages/folha/ContasPagar').then((m) => m.ContasPagar));
const Dashboard = telaSobDemanda(() => import('./pages/folha/Dashboard').then((m) => m.Dashboard));
const Diaristas = telaSobDemanda(() => import('./pages/folha/Diaristas').then((m) => m.Diaristas));
const Ferias = telaSobDemanda(() => import('./pages/folha/Ferias').then((m) => m.Ferias));
const Folha = telaSobDemanda(() => import('./pages/folha/Folha').then((m) => m.Folha));
const FuncionarioDetalhe = telaSobDemanda(() => import('./pages/folha/FuncionarioDetalhe').then((m) => m.FuncionarioDetalhe));
const Funcionarios = telaSobDemanda(() => import('./pages/folha/Funcionarios').then((m) => m.Funcionarios));
const Impostos = telaSobDemanda(() => import('./pages/folha/Impostos').then((m) => m.Impostos));
const MinhaConta = telaSobDemanda(() => import('./pages/folha/MinhaConta').then((m) => m.MinhaConta));
const Usuarios = telaSobDemanda(() => import('./pages/folha/Usuarios').then((m) => m.Usuarios));
const Vales = telaSobDemanda(() => import('./pages/folha/Vales').then((m) => m.Vales));
const PortalDePontos = telaSobDemanda(() => import('./pages/pontos/Portal').then((m) => m.Portal));
const Coordenadores = telaSobDemanda(() => import('./pages/pontuacao/Coordenadores').then((m) => m.Coordenadores));
const Motivos = telaSobDemanda(() => import('./pages/pontuacao/Motivos').then((m) => m.Motivos));
const Pontuar = telaSobDemanda(() => import('./pages/pontuacao/Pontuar').then((m) => m.Pontuar));
const PastaDaEmpresa = telaSobDemanda(() => import('./pages/rh/Pasta').then((m) => m.PastaDaEmpresa));
const PastaRhAberta = telaSobDemanda(() => import('./pages/rh/Pasta').then((m) => m.PastaRhAberta));
const Licitacoes = telaSobDemanda(() => import('./pages/rh/Licitacoes').then((m) => m.Licitacoes));
const NotasFiscais = telaSobDemanda(() => import('./pages/rh/NotasFiscais').then((m) => m.NotasFiscais));
const PastasRh = telaSobDemanda(() => import('./pages/rh/Pastas').then((m) => m.PastasRh));
const RecibosDaFolha = telaSobDemanda(() => import('./pages/rh/RecibosDaFolha').then((m) => m.RecibosDaFolha));
const AjustesDaContabilidade = telaSobDemanda(() => import('./pages/contabilidade/Ajustes').then((m) => m.AjustesDaContabilidade));
const MesDaContabilidade = telaSobDemanda(() => import('./pages/contabilidade/Mes').then((m) => m.MesDaContabilidade));
const MesesDaContabilidade = telaSobDemanda(() => import('./pages/contabilidade/Meses').then((m) => m.MesesDaContabilidade));
const Patrocinados = telaSobDemanda(() => import('./pages/patrocinio/Patrocinados').then((m) => m.Patrocinados));
const PatrocinadoAberto = telaSobDemanda(() => import('./pages/patrocinio/Patrocinado').then((m) => m.PatrocinadoAberto));
const ContratoPadrao = telaSobDemanda(() => import('./pages/patrocinio/ContratoPadrao').then((m) => m.ContratoPadrao));
const PagamentosDoPatrocinio = telaSobDemanda(() => import('./pages/patrocinio/Pagamentos').then((m) => m.Pagamentos));

function Protegida({ children }: { children: ReactNode }) {
  const { usuario, carregando } = useAuth();
  if (carregando) {
    return (
      <div className="flex h-screen items-center justify-center bg-fundo text-tinta-500">
        Carregando…
      </div>
    );
  }
  return usuario ? <>{children}</> : <Navigate to="/login" replace />;
}

/**
 * Gerenciar logins é só do administrador. A API já barra, mas esconder a tela
 * evita a frustração de abrir e levar erro.
 */
function SomenteAdmin({ children }: { children: ReactNode }) {
  const { usuario } = useAuth();
  return usuario?.role === 'ADMIN' ? (
    <>{children}</>
  ) : (
    <Navigate to={destinoDepoisDoLogin(usuario)} replace />
  );
}

/**
 * A primeira tela do módulo, que para quem abre só a folha é a da folha (ver
 * `caminhoInicial`).
 */
function InicioDoModulo({ modulo }: { modulo: Modulo }) {
  const { usuario } = useAuth();
  return <Navigate to={caminhoInicial(modulo, usuario)} replace />;
}

/**
 * As telas de uma seção (a folha), só para quem a abre. Quem paga as contas
 * e não faz a folha entra no Contas a Pagar, mas não aqui: de volta à primeira
 * tela dele. A API recusa do mesmo jeito.
 */
function SoQuemAbre({ acesso, modulo }: { acesso: string; modulo: Modulo }) {
  const { usuario } = useAuth();
  return acessosDoUsuario(usuario).includes(acesso) ? (
    <Outlet />
  ) : (
    <Navigate to={caminhoInicial(modulo, usuario)} replace />
  );
}

/**
 * O endereço antigo da folha, de quando ela era módulo: leva à mesma tela, no
 * lugar novo, com o que vier depois (`/folha/funcionarios/12?aba=faltas`).
 * Quem tem a tela no favorito não pode cair num "não encontrado" por causa de
 * uma troca nossa — a regra do `/contas-pagar/painel`.
 */
function FolhaDeAntes() {
  const { pathname, search } = useLocation();
  const resto = pathname.replace(/^\/folha\/?/, '');
  const destino =
    resto === 'minha-conta'
      ? '/contas-pagar/minha-conta'
      : resto === 'usuarios'
        ? '/usuarios'
        : `/contas-pagar/folha/${resto}`;
  return <Navigate to={`${destino}${search}`} replace />;
}

/**
 * Endereço que não existe: de volta para onde este login trabalha.
 *
 * Era sempre `/modulos`, e para o técnico de campo isso é uma tela que ele não
 * abre — ele voltaria para a escolha de módulos, sem módulo nenhum para
 * escolher.
 */
function ParaOnde() {
  const { usuario } = useAuth();
  return <Navigate to={destinoDepoisDoLogin(usuario)} replace />;
}

/**
 * As telas de cada módulo, para baixar sem pressa quando se entra nele — a
 * próxima tela aberta já está no aparelho. Ver `telaSobDemanda`.
 */
const TELAS_DO_MODULO: Record<string, Array<{ preCarregar: () => void }>> = {
  'contas-pagar': [
    ContasPagarInicio, HistoricoDePagamentos, Controle, ContasPagarDashboard, Avulsos,
    Recorrentes, ContasContrato, CartoesCredito, Veiculos, ContasPagarCategorias,
    FechamentoCaixa, MinhaConta,
    // A folha, que mora aqui dentro.
    Dashboard, Funcionarios, FuncionarioDetalhe, Diaristas, Vales, Ferias, Folha, ContasPagar,
    Impostos, Configuracoes,
  ],
  almoxarifado: [
    Estoque, Conferencia, Almoxarifados, AlmoxarifadoDetalhe, PecasDoProduto, Transferir,
    Ferramentas, Comodato, Precos, FornecedoresDeCotacao, MinhaConta,
  ],
  os: [RegistrosDeOs, Recolhidos, TecnicosDeOs, MateriaisDeOs, RelatorioDeOs, MinhaConta],
  rh: [PastasRh, PastaDaEmpresa, RecibosDaFolha, Licitacoes, NotasFiscais, MinhaConta],
  seguranca: [Aprs, Formularios, MinhaConta],
  campo: [CampoMinhasOs, MinhaConta],
  pontuacao: [Pontuar, Motivos, Coordenadores, MinhaConta],
  contabilidade: [MesesDaContabilidade, MesDaContabilidade, AjustesDaContabilidade, MinhaConta],
  patrocinio: [Patrocinados, PatrocinadoAberto, ContratoPadrao, PagamentosDoPatrocinio, MinhaConta],
};

function usePreCarregarOModulo() {
  const modulo = useLocation().pathname.split('/')[1] ?? '';
  useEffect(() => preCarregarQuandoOcioso(TELAS_DO_MODULO[modulo] ?? []), [modulo]);
}

/** Enquanto o pedaço da tela chega — só na primeira vez que ela é aberta. */
function TelaChegando() {
  return (
    <div className="flex h-screen items-center justify-center bg-fundo text-tinta-500">
      Carregando…
    </div>
  );
}

export default function App() {
  // No celular toda tabela vira lista de cartões; isto põe o nome da coluna em
  // cada célula. Ver `lib/tabela-no-celular.ts`.
  useTabelasNoCelular();
  usePreCarregarOModulo();

  return (
    // A tela de dentro de um módulo tem o seu próprio Suspense e a sua
    // proteção contra erro, no Layout: lá o menu fica de pé. Estes são os das
    // telas de fora (módulos, logins, assinatura, portal de pontos).
    <TelaProtegida>
    <Suspense fallback={<TelaChegando />}>
    <Routes>
      <Route path="/login" element={<Login />} />

      {/* Quem recebeu o dinheiro assina aqui. Fora do login de propósito: o
          diarista não tem conta no sistema, e o link é a credencial dele. */}
      <Route path="/assinar/:token" element={<Assinar />} />
      {/* O patrocinado assina o contrato aqui, pelo mesmo motivo: sem conta,
          com o link. */}
      <Route path="/assinar-contrato/:token" element={<AssinarContrato />} />

      {/* O portal de pontos: fora do login do sistema de propósito. O
          coordenador entra com CPF e senha, o funcionário só com o CPF — nenhum
          dos dois tem conta aqui. */}
      <Route path="/pontos" element={<PortalDePontos />} />
      <Route
        path="/modulos"
        element={
          <Protegida>
            <Modulos />
          </Protegida>
        }
      />
      {/* Os logins: fora dos módulos, porque dar acesso não é assunto de
          nenhum deles. Botão no alto da tela de módulos, só para ADMIN. */}
      <Route
        path="/usuarios"
        element={
          <Protegida>
            <SomenteAdmin>
              <TelaDeFora>
                <Usuarios />
              </TelaDeFora>
            </SomenteAdmin>
          </Protegida>
        }
      />

      {/* A folha foi módulo até 23/10/2026; hoje mora no Contas a Pagar. */}
      <Route path="/folha/*" element={<FolhaDeAntes />} />

      <Route
        path="/contas-pagar"
        element={
          <Protegida>
            <Layout modulo={MODULO_CONTAS_PAGAR} />
          </Protegida>
        }
      >
        <Route index element={<InicioDoModulo modulo={MODULO_CONTAS_PAGAR} />} />
        <Route path="inicio" element={<ContasPagarInicio />} />
        {/* A outra metade da mesma tabela do IXC: o que já saiu. */}
        <Route path="pagos" element={<HistoricoDePagamentos />} />
        {/* Quem deve a quem está logado: lembrete particular, sem soma. */}
        <Route path="controle" element={<Controle />} />
        <Route path="dashboard" element={<ContasPagarDashboard />} />
        {/* O caminho antigo continua valendo: quem tem a tela no favorito ou
            aberta numa aba não pode cair num "não encontrado" por causa de uma
            troca de nome nossa. */}
        <Route
          path="painel"
          element={<Navigate to="/contas-pagar/dashboard" replace />}
        />
        {/* A mesma tela de avulsos da folha, aberta pelo cadastro de
            fornecedores do IXC: deste lado se paga qualquer um deles, e não só
            quem esta casa já cadastrou. Na folha continua sendo a lista de cá. */}
        <Route path="avulsos" element={<Avulsos modulo="contas-pagar" />} />
        <Route path="recorrentes" element={<Recorrentes />} />
        {/* A conta de luz de cada endereço: o cadastro das contas contrato e
            o botão que faz a fatura do mês virar conta a pagar. */}
        <Route path="contas-contrato" element={<ContasContrato />} />
        {/* A fatura de cada cartão: as compras dentro dela e o botão que a
            faz virar uma conta a pagar só. */}
        <Route path="cartao-credito" element={<CartoesCredito />} />
        {/* A frota: cada veículo, o que já se gastou nele e os abastecimentos. */}
        <Route path="veiculos" element={<Veiculos />} />
        <Route path="categorias" element={<ContasPagarCategorias />} />
        <Route path="fechamento-caixa" element={<FechamentoCaixa />} />
        {/* A mesma tela de sempre, com o caminho deste módulo. Ela morava só
            na folha, e quem não abre a folha — o RH que só cuida da estante —
            caía num módulo trancado ao clicar no próprio nome. */}
        <Route path="minha-conta" element={<MinhaConta />} />
        {/* Só ADMIN, e ainda pede a senha ao abrir: a tela move saldo entre
            contas sem haver nota nenhuma para conferir depois. O servidor é
            quem recusa de verdade — aqui a rota só some do menu. */}
        <Route path="transferencias" element={<Transferencias />} />

        {/* A folha de pagamento: foi módulo próprio até 23/10/2026. O acesso
            continua o dela — ver `Secao`, em `lib/modulos.ts`. */}
        <Route
          path="folha"
          element={<SoQuemAbre acesso="folha" modulo={MODULO_CONTAS_PAGAR} />}
        >
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="funcionarios" element={<Funcionarios />} />
          <Route path="funcionarios/:id" element={<FuncionarioDetalhe />} />
          <Route path="diaristas" element={<Diaristas />} />
          <Route path="vales" element={<Vales />} />
          <Route path="ferias" element={<Ferias />} />
          <Route path="gerar-folha" element={<Folha />} />
          <Route path="pagamentos" element={<ContasPagar />} />
          <Route path="avulsos" element={<Avulsos />} />
          <Route path="impostos" element={<Impostos />} />
          <Route path="configuracoes" element={<Configuracoes />} />
        </Route>
      </Route>

      {/* Almoxarifado — o material, as ferramentas e o que cada coisa custa.

          O estoque vem do IXC e só se lê: ele já é controlado lá, e um segundo
          lugar que escrevesse criaria dois saldos para a mesma prateleira. O
          caderno de ferramentas é daqui — o IXC não tem onde guardar "quem
          está com a máquina de fusão". */}
      <Route
        path="/almoxarifado"
        element={
          <Protegida>
            <Layout modulo={MODULO_ALMOXARIFADO} />
          </Protegida>
        }
      >
        <Route index element={<Navigate to="estoque" replace />} />
        <Route path="estoque" element={<Estoque />} />
        <Route path="conferencia" element={<Conferencia />} />
        <Route path="almoxarifados" element={<Almoxarifados />} />
        <Route path="almoxarifados/:id" element={<AlmoxarifadoDetalhe />} />
        <Route path="almoxarifados/:id/produtos/:produtoId" element={<PecasDoProduto />} />
        <Route path="transferir" element={<Transferir />} />
        <Route path="ferramentas" element={<Ferramentas />} />
        <Route path="comodato" element={<Comodato />} />
        <Route path="precos" element={<Precos />} />
        <Route path="fornecedores" element={<FornecedoresDeCotacao />} />
        <Route path="minha-conta" element={<MinhaConta />} />
      </Route>

      {/* Ordens de Serviço, do lado da base. O técnico anota pelo celular, em
          /campo/os; daqui se acompanha o que ficou pendente, se recebe o que
          voltou de cliente e se tira o relatório do mês. */}
      <Route
        path="/os"
        element={
          <Protegida>
            <Layout modulo={MODULO_OS} />
          </Protegida>
        }
      >
        <Route index element={<Navigate to="registros" replace />} />
        <Route path="registros" element={<RegistrosDeOs />} />
        <Route path="recolhidos" element={<Recolhidos />} />
        <Route path="tecnicos" element={<TecnicosDeOs />} />
        <Route path="materiais" element={<MateriaisDeOs />} />
        <Route path="relatorio" element={<RelatorioDeOs />} />
        <Route path="minha-conta" element={<MinhaConta />} />
      </Route>

      {/* O endereço antigo das cotações continua valendo.

          Elas nasceram como módulo próprio e viraram uma aba do almoxarifado.
          Quem tem a tela no favorito ou aberta numa aba não pode cair num "não
          encontrado" por causa de uma troca de nome nossa — é a mesma regra do
          `/contas-pagar/painel`. */}
      <Route
        path="/cotacoes/fornecedores"
        element={<Navigate to="/almoxarifado/fornecedores" replace />}
      />
      <Route
        path="/cotacoes/*"
        element={<Navigate to="/almoxarifado/precos" replace />}
      />

      {/* RH — a estante de documentos. Quem recusa de verdade é a API, que
          exige ADMIN ou RH em cada rota; aqui o módulo só some do menu de quem
          não tem perfil. */}
      <Route
        path="/rh"
        element={
          <Protegida>
            <Layout modulo={MODULO_RH} />
          </Protegida>
        }
      >
        <Route index element={<Navigate to="pastas" replace />} />
        <Route path="pastas" element={<PastasRh />} />
        <Route path="empresa" element={<PastaDaEmpresa />} />
        <Route path="pastas/:id" element={<PastaRhAberta />} />
        <Route path="recibos" element={<RecibosDaFolha />} />
        <Route path="minha-conta" element={<MinhaConta />} />
        <Route path="licitacoes" element={<Licitacoes />} />
        <Route path="notas-fiscais" element={<NotasFiscais />} />
      </Route>

      {/* Segurança do Trabalho — a visão de quem supervisiona: as APRs da
          empresa e o formulário em branco que todas usam. O técnico não entra
          por aqui; ele tem a tela do campo, logo abaixo. */}
      <Route
        path="/seguranca"
        element={
          <Protegida>
            <Layout modulo={MODULO_SEGURANCA} />
          </Protegida>
        }
      >
        <Route index element={<Navigate to="aprs" replace />} />
        <Route path="aprs" element={<Aprs />} />
        <Route path="aprs/nova" element={<AprNova />} />
        <Route path="aprs/:id" element={<AprAberta />} />
        <Route path="formularios" element={<Formularios />} />
        <Route path="minha-conta" element={<MinhaConta />} />
      </Route>

      {/* A tela do colaborador: a pontuação dele, o abastecimento do veículo
          que está no nome dele e a análise de risco. Para o técnico de campo é
          a única tela do sistema — sem barra lateral, sem escolha de módulo.
          Os outros perfis chegam pelo cartão "Minha área". Quem recusa o resto
          é a API. */}
      <Route
        path="/campo"
        element={
          <Protegida>
            <Campo />
          </Protegida>
        }
      >
        <Route index element={<CampoInicio />} />
        <Route path="pontuacao" element={<CampoPontuacao />} />
        <Route path="pontuar" element={<CampoPontuar />} />
        <Route path="abastecimento" element={<CampoAbastecimento />} />
        <Route path="os" element={<CampoMinhasOs />} />
        <Route path="os/:osId" element={<CampoOs />} />
        <Route path="os/:osId/finalizar" element={<CampoFinalizar />} />
        <Route path="aprs" element={<CampoAprs />} />
        <Route path="nova" element={<CampoNova />} />
        <Route path="minha-conta" element={<MinhaConta />} />
        <Route path=":id" element={<CampoApr />} />
      </Route>

      {/* Patrocínios — quem a ILNET patrocina: o contato, o contrato, os
          arquivos e os pagamentos. Cada patrocinado é um fornecedor do IXC, e
          pagar é lançar a conta a pagar dele. */}
      <Route
        path="/patrocinio"
        element={
          <Protegida>
            <Layout modulo={MODULO_PATROCINIO} />
          </Protegida>
        }
      >
        <Route index element={<Navigate to="patrocinados" replace />} />
        <Route path="patrocinados" element={<Patrocinados />} />
        <Route path="patrocinados/:id" element={<PatrocinadoAberto />} />
        <Route path="contrato" element={<ContratoPadrao />} />
        <Route path="pagamentos" element={<PagamentosDoPatrocinio />} />
        <Route path="minha-conta" element={<MinhaConta />} />
      </Route>

      {/* Pontuação por dentro — só ADMIN, e sem login novo. */}
      <Route
        path="/pontuacao"
        element={
          <Protegida>
            <SomenteAdmin>
              <Layout modulo={MODULO_PONTUACAO} />
            </SomenteAdmin>
          </Protegida>
        }
      >
        <Route index element={<Navigate to="pontuar" replace />} />
        <Route path="pontuar" element={<Pontuar />} />
        <Route path="motivos" element={<Motivos />} />
        <Route path="coordenadores" element={<Coordenadores />} />
        <Route path="minha-conta" element={<MinhaConta />} />
      </Route>

      {/* Contabilidade — só ADMIN: o extrato de todas as contas e o que os
          sócios retiraram não são assunto de outro perfil. */}
      <Route
        path="/contabilidade"
        element={
          <Protegida>
            <SomenteAdmin>
              <Layout modulo={MODULO_CONTABILIDADE} />
            </SomenteAdmin>
          </Protegida>
        }
      >
        <Route index element={<Navigate to="meses" replace />} />
        <Route path="meses" element={<MesesDaContabilidade />} />
        <Route path="meses/:id" element={<MesDaContabilidade />} />
        <Route path="ajustes" element={<AjustesDaContabilidade />} />
        <Route path="minha-conta" element={<MinhaConta />} />
      </Route>

      <Route path="*" element={<ParaOnde />} />
    </Routes>
    </Suspense>
    </TelaProtegida>
  );
}
