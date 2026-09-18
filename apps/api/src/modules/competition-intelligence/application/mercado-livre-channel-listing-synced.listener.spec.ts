import { MercadoLivreChannelListingSyncedListener } from './mercado-livre-channel-listing-synced.listener';
import { MercadoLivreMonitoringAutoRegistrationService } from './mercado-livre-monitoring-auto-registration.service';

describe('MercadoLivreChannelListingSyncedListener', () => {
  function buildListener() {
    const autoRegistration = {
      reconcile: jest.fn(),
    } as unknown as jest.Mocked<MercadoLivreMonitoringAutoRegistrationService>;

    const listener = new MercadoLivreChannelListingSyncedListener(autoRegistration);
    return { listener, autoRegistration };
  }

  it('delega a reconciliação ao MercadoLivreMonitoringAutoRegistrationService com o payload recebido', async () => {
    const { listener, autoRegistration } = buildListener();
    autoRegistration.reconcile.mockResolvedValue({ created: 2 });

    await listener.handleSynced({ tenantId: 'tenant-1', listings: [{ skuCode: 'SKU-1', externalId: 'MLB111' }] });

    expect(autoRegistration.reconcile).toHaveBeenCalledWith('tenant-1', [{ skuCode: 'SKU-1', externalId: 'MLB111' }]);
  });

  it('falha na reconciliação: não lança (evento é fire-and-forget, loga e segue)', async () => {
    const { listener, autoRegistration } = buildListener();
    autoRegistration.reconcile.mockRejectedValue(new Error('banco indisponível'));

    await expect(
      listener.handleSynced({ tenantId: 'tenant-1', listings: [{ skuCode: 'SKU-1', externalId: 'MLB111' }] }),
    ).resolves.toBeUndefined();
  });
});
