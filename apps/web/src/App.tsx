import { Navigate, Route, BrowserRouter, Routes } from 'react-router-dom';
import LoginPage from './routes/LoginPage';
import ProtectedRoute from './routes/ProtectedRoute';
import AppLayout from './routes/AppLayout';
import DashboardPage from './routes/DashboardPage';
import OrdersPage from './routes/OrdersPage';
import CatalogPage from './routes/CatalogPage';
import ProductPricingPage from './routes/ProductPricingPage';
import IntegracoesPage from './routes/IntegracoesPage';
import FinanceiroPage from './routes/FinanceiroPage';
import ConfiguracoesFiscaisPage from './routes/ConfiguracoesFiscaisPage';
import AbastecimentoPage from './routes/AbastecimentoPage';
import ConferenciaPage from './routes/ConferenciaPage';
import ConferenciaDetalhePage from './routes/ConferenciaDetalhePage';
import AdsPage from './routes/AdsPage';
import MapGovernancePage from './routes/MapGovernancePage';
import PromotionsPage from './routes/PromotionsPage';
import PromotionCampaignDetailPage from './routes/PromotionCampaignDetailPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

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
            <Route path="/" element={<Navigate to="/catalogo" replace />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
