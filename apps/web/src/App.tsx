import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { useAuth } from './lib/auth';
import {
  MODULO_CONTAS_PAGAR,
  MODULO_ALMOXARIFADO,
  MODULO_FOLHA,
  MODULO_PONTUACAO,
  MODULO_RH,
  MODULO_SEGURANCA,
  destinoDepoisDoLogin,
} from './lib/modulos';
import { useTabelasNoCelular } from './lib/tabela-no-celular';
import { Aprs, AprAberta, AprNova } from './pages/apr/Aprs';
import { Campo, CampoApr, CampoInicio, CampoNova } from './pages/apr/Campo';
import { Formularios } from './pages/apr/Formularios';
import { Assinar } from './pages/Assinar';
import { Login } from './pages/Login';
import { Modulos } from './pages/Modulos';
import { Inicio as ContasPagarInicio } from './pages/contas-pagar/Inicio';
import { Estoque } from './pages/almoxarifado/Estoque';
import { Ferramentas } from './pages/almoxarifado/Ferramentas';
import { Fornecedores as FornecedoresDeCotacao } from './pages/almoxarifado/Fornecedores';
import { Comodato } from './pages/almoxarifado/Comodato';
import { Precos } from './pages/almoxarifado/Precos';
import { Categorias as ContasPagarCategorias } from './pages/contas-pagar/Categorias';
import { Dashboard as ContasPagarDashboard } from './pages/contas-pagar/Dashboard';
import { FechamentoCaixa } from './pages/contas-pagar/FechamentoCaixa';
import { Transferencias } from './pages/contas-pagar/Transferencias';
import { HistoricoDePagamentos } from './pages/contas-pagar/HistoricoDePagamentos';
import { CartoesCredito } from './pages/contas-pagar/CartoesCredito';
import { ContasContrato } from './pages/contas-pagar/ContasContrato';
import { Recorrentes } from './pages/contas-pagar/Recorrentes';
import { Avulsos } from './pages/folha/Avulsos';
import { Configuracoes } from './pages/folha/Configuracoes';
import { ContasPagar } from './pages/folha/ContasPagar';
import { Dashboard } from './pages/folha/Dashboard';
import { Diaristas } from './pages/folha/Diaristas';
import { Ferias } from './pages/folha/Ferias';
import { Folha } from './pages/folha/Folha';
import { FuncionarioDetalhe } from './pages/folha/FuncionarioDetalhe';
import { Funcionarios } from './pages/folha/Funcionarios';
import { Impostos } from './pages/folha/Impostos';
import { MinhaConta } from './pages/folha/MinhaConta';
import { Usuarios } from './pages/folha/Usuarios';
import { Vales } from './pages/folha/Vales';
import { Portal as PortalDePontos } from './pages/pontos/Portal';
import { Coordenadores } from './pages/pontuacao/Coordenadores';
import { Motivos } from './pages/pontuacao/Motivos';
import { Pontuar } from './pages/pontuacao/Pontuar';
import { PastaDaEmpresa, PastaRhAberta } from './pages/rh/Pasta';
import { Licitacoes } from './pages/rh/Licitacoes';
import { NotasFiscais } from './pages/rh/NotasFiscais';
import { PastasRh } from './pages/rh/Pastas';
import { RecibosDaFolha } from './pages/rh/RecibosDaFolha';
import type { ReactNode } from 'react';

function Protegida({ children }: { children: ReactNode }) {
  const { usuario, carregando } = useAuth();
  if (carregando) {
    return (
      <div className="flex h-screen items-center justify-center bg-tinta-50 text-tinta-500">
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
    <Navigate to="/folha/dashboard" replace />
  );
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

export default function App() {
  // No celular toda tabela vira lista de cartões; isto põe o nome da coluna em
  // cada célula. Ver `lib/tabela-no-celular.ts`.
  useTabelasNoCelular();

  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      {/* Quem recebeu o dinheiro assina aqui. Fora do login de propósito: o
          diarista não tem conta no sistema, e o link é a credencial dele. */}
      <Route path="/assinar/:token" element={<Assinar />} />

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

      <Route
        path="/folha"
        element={
          <Protegida>
            <Layout modulo={MODULO_FOLHA} />
          </Protegida>
        }
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
        <Route path="minha-conta" element={<MinhaConta />} />
        <Route
          path="usuarios"
          element={
            <SomenteAdmin>
              <Usuarios />
            </SomenteAdmin>
          }
        />
      </Route>

      <Route
        path="/contas-pagar"
        element={
          <Protegida>
            <Layout modulo={MODULO_CONTAS_PAGAR} />
          </Protegida>
        }
      >
        <Route index element={<Navigate to="inicio" replace />} />
        <Route path="inicio" element={<ContasPagarInicio />} />
        {/* A outra metade da mesma tabela do IXC: o que já saiu. */}
        <Route path="pagos" element={<HistoricoDePagamentos />} />
        <Route path="dashboard" element={<ContasPagarDashboard />} />
        {/* O caminho antigo continua valendo: quem tem a tela no favorito ou
            aberta numa aba não pode cair num "não encontrado" por causa de uma
            troca de nome nossa. */}
        <Route
          path="painel"
          element={<Navigate to="/contas-pagar/dashboard" replace />}
        />
        {/* A mesma tela de avulsos da folha: é pagamento da empresa e é
            lançamento da folha, e obrigar a trocar de módulo no meio do
            trabalho custaria mais que o caminho repetido.

            Aqui ela abre pelo cadastro de fornecedores do IXC: neste módulo se
            paga qualquer um deles, e não só quem esta casa já cadastrou. Na
            folha continua sendo a lista de cá. */}
        <Route path="avulsos" element={<Avulsos modulo="contas-pagar" />} />
        <Route path="recorrentes" element={<Recorrentes />} />
        {/* A conta de luz de cada endereço: o cadastro das contas contrato e
            o botão que faz a fatura do mês virar conta a pagar. */}
        <Route path="contas-contrato" element={<ContasContrato />} />
        {/* A fatura de cada cartão: as compras dentro dela e o botão que a
            faz virar uma conta a pagar só. */}
        <Route path="cartao-credito" element={<CartoesCredito />} />
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
        <Route path="ferramentas" element={<Ferramentas />} />
        <Route path="comodato" element={<Comodato />} />
        <Route path="precos" element={<Precos />} />
        <Route path="fornecedores" element={<FornecedoresDeCotacao />} />
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

      {/* A tela do técnico de campo, e a única que ele vê do sistema.
          Sem barra lateral, sem escolha de módulo: ele entra e já está no
          lugar onde tem o que fazer. Quem recusa o resto é a API. */}
      <Route
        path="/campo"
        element={
          <Protegida>
            <Campo />
          </Protegida>
        }
      >
        <Route index element={<CampoInicio />} />
        <Route path="nova" element={<CampoNova />} />
        <Route path="minha-conta" element={<MinhaConta />} />
        <Route path=":id" element={<CampoApr />} />
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

      <Route path="*" element={<ParaOnde />} />
    </Routes>
  );
}
