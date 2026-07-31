import { Navigate, Route, BrowserRouter, Routes } from 'react-router-dom';
import LoginPage from './routes/LoginPage';
import SignupPage from './routes/SignupPage';
import ProtectedRoute from './routes/ProtectedRoute';
import AppLayout from './routes/AppLayout';
import DashboardPage from './routes/DashboardPage';
import OrdersPage from './routes/OrdersPage';
import CatalogPage from './routes/CatalogPage';
import ProductPricingPage from './routes/ProductPricingPage';
import IntegracoesPage from './routes/IntegracoesPage';
import FinanceiroPage from './routes/FinanceiroPage';
import ConfiguracoesFiscaisPage from './routes/ConfiguracoesFiscaisPage';
import FiscalInvoicesPage from './routes/FiscalInvoicesPage';
import AbastecimentoPage from './routes/AbastecimentoPage';
import ConferenciaPage from './routes/ConferenciaPage';
import ConferenciaDetalhePage from './routes/ConferenciaDetalhePage';
import AdsPage from './routes/AdsPage';
import MapGovernancePage from './routes/MapGovernancePage';
import PromotionsPage from './routes/PromotionsPage';
import PromotionCampaignDetailPage from './routes/PromotionCampaignDetailPage';
import PlatformAdminPage from './routes/PlatformAdminPage';
import TeamPage from './routes/TeamPage';
import SuppliersPage from './routes/SuppliersPage';
import PackagingPage from './routes/PackagingPage';
import PriceListsPage from './routes/PriceListsPage';
import LotsPage from './routes/LotsPage';
import SellersPage from './routes/SellersPage';
import PurchaseOrdersPage from './routes/PurchaseOrdersPage';
import ProductionOrdersPage from './routes/ProductionOrdersPage';
import CarriersPage from './routes/CarriersPage';
import DispatchBatchesPage from './routes/DispatchBatchesPage';
import CategoriesPage from './routes/CategoriesPage';
import ListingsPage from './routes/ListingsPage';
import CompetitionRadarPage from './routes/CompetitionRadarPage';
import MarketplaceGovernancePage from './routes/MarketplaceGovernancePage';
import TagsPage from './routes/TagsPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/cadastro" element={<SignupPage />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/pedidos" element={<OrdersPage />} />
            <Route path="/ads" element={<AdsPage />} />
            <Route path="/catalogo" element={<CatalogPage />} />
            {/* /produtos (sem id) cai no primeiro produto — ver useEffect em ProductPricingPage */}
            <Route path="/produtos" element={<ProductPricingPage />} />
            <Route path="/produtos/:productId" element={<ProductPricingPage />} />
            <Route path="/integracoes" element={<IntegracoesPage />} />
            <Route path="/financeiro" element={<FinanceiroPage />} />
            <Route path="/abastecimento" element={<AbastecimentoPage />} />
            <Route path="/conferencia" element={<ConferenciaPage />} />
            <Route path="/conferencia/:eventId" element={<ConferenciaDetalhePage />} />
            <Route path="/governanca-map" element={<MapGovernancePage />} />
            <Route path="/promocoes" element={<PromotionsPage />} />
            <Route path="/promocoes/:campaignId" element={<PromotionCampaignDetailPage />} />
            <Route path="/configuracoes-fiscais" element={<ConfiguracoesFiscaisPage />} />
            <Route path="/notas-fiscais" element={<FiscalInvoicesPage />} />
            <Route path="/fornecedores" element={<SuppliersPage />} />
            <Route path="/embalagens" element={<PackagingPage />} />
            <Route path="/listas-de-preco" element={<PriceListsPage />} />
            <Route path="/lotes" element={<LotsPage />} />
            <Route path="/vendedores" element={<SellersPage />} />
            <Route path="/ordens-de-compra" element={<PurchaseOrdersPage />} />
            <Route path="/ordens-de-producao" element={<ProductionOrdersPage />} />
            <Route path="/transportadoras" element={<CarriersPage />} />
            <Route path="/expedicao-em-lote" element={<DispatchBatchesPage />} />
            <Route path="/categorias" element={<CategoriesPage />} />
            <Route path="/publicar-anuncio" element={<ListingsPage />} />
            <Route path="/radar-concorrencia" element={<CompetitionRadarPage />} />
            <Route path="/governanca-marketplace" element={<MarketplaceGovernancePage />} />
            <Route path="/tags" element={<TagsPage />} />
            <Route path="/equipe" element={<TeamPage />} />
            <Route path="/admin" element={<PlatformAdminPage />} />
            <Route path="/" element={<Navigate to="/catalogo" replace />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
