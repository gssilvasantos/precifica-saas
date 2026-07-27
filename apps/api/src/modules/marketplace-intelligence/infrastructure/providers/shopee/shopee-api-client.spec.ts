import { createHmac } from 'node:crypto';
import { ShopeeApiClient } from './shopee-api-client';

// Testes de assinatura HMAC — a parte mais crítica de acertar (um bug aqui
// derruba TODA chamada à Shopee, não só uma feature). `buildAuthPartnerUrl`
// não faz nenhuma chamada de rede (a assinatura é síncrona), então dá para
// testar sem mocks nem fetch.
describe('ShopeeApiClient', () => {
  const PARTNER_ID = '1239393';
  const PARTNER_KEY = 'partner-key-de-teste';

  function buildClient() {
    return new ShopeeApiClient();
  }

  describe('buildAuthPartnerUrl', () => {
    it('monta a URL de autorização com partner_id/timestamp/sign/redirect', () => {
      const client = buildClient();
      const url = client.buildAuthPartnerUrl(PARTNER_ID, PARTNER_KEY, 'https://api.kyneti.com.br/marketplace-intelligence/shopee/callback');

      expect(url).toContain('https://partner.shopeemobile.com/api/v2/shop/auth_partner?');
      expect(url).toContain(`partner_id=${PARTNER_ID}`);
      expect(url).toMatch(/timestamp=\d+/);
      expect(url).toMatch(/sign=[a-f0-9]{64}/); // hex de 64 chars = SHA-256
      expect(url).toContain(encodeURIComponent('https://api.kyneti.com.br/marketplace-intelligence/shopee/callback'));
    });

    it('a assinatura bate com HMAC-SHA256(partner_id + path + timestamp, partner_key)', () => {
      const client = buildClient();
      const url = client.buildAuthPartnerUrl(PARTNER_ID, PARTNER_KEY, 'https://example.com/callback');

      const timestamp = url.match(/timestamp=(\d+)/)![1];
      const sign = url.match(/sign=([a-f0-9]+)/)![1];

      const expectedSign = createHmac('sha256', PARTNER_KEY)
        .update(`${PARTNER_ID}/api/v2/shop/auth_partner${timestamp}`)
        .digest('hex');

      expect(sign).toBe(expectedSign);
    });

    it('respeita SHOPEE_BASE_URL quando definida (override de sandbox/produção)', () => {
      const OLD_ENV = process.env;
      process.env = { ...OLD_ENV, SHOPEE_BASE_URL: 'https://partner.test-stable.shopeemobile.com' };
      try {
        const client = buildClient();
        const url = client.buildAuthPartnerUrl(PARTNER_ID, PARTNER_KEY, 'https://example.com/callback');
        expect(url).toContain('https://partner.test-stable.shopeemobile.com/api/v2/shop/auth_partner?');
      } finally {
        process.env = OLD_ENV;
      }
    });

    it('nunca vaza a partner_key na URL gerada', () => {
      const client = buildClient();
      const url = client.buildAuthPartnerUrl(PARTNER_ID, PARTNER_KEY, 'https://example.com/callback');
      expect(url).not.toContain(PARTNER_KEY);
    });
  });
});
