import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { TaggingService } from './tagging.service';
import { TagRepository } from './ports/tag-repository.port';
import { TagAssignmentRepository } from './ports/tag-assignment-repository.port';
import { Tag, TagAssignment } from '../domain/tag.entity';

function buildTag(overrides: Partial<Tag> = {}): Tag {
  return {
    id: 'tag-1',
    tenantId: 'tenant-1',
    name: 'Frágil',
    color: '#FF0000',
    createdAt: new Date(),
    ...overrides,
  };
}

function buildAssignment(overrides: Partial<TagAssignment> = {}): TagAssignment {
  return {
    id: 'assign-1',
    tenantId: 'tenant-1',
    tagId: 'tag-1',
    entityType: 'PRODUCT',
    entityId: 'SKU-1',
    createdAt: new Date(),
    ...overrides,
  };
}

function buildP2002(): PrismaClientKnownRequestError {
  return new PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('TaggingService', () => {
  function buildService() {
    const tags: jest.Mocked<TagRepository> = {
      findById: jest.fn(),
      findAllByTenant: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    };
    const assignments: jest.Mocked<TagAssignmentRepository> = {
      assign: jest.fn(),
      unassign: jest.fn(),
      findByEntity: jest.fn(),
    };
    const service = new TaggingService(tags, assignments);
    return { service, tags, assignments };
  }

  describe('createTag', () => {
    it('cria com nome e cor válidos, removendo espaços nas pontas', async () => {
      const { service, tags } = buildService();
      tags.create.mockResolvedValue(buildTag());

      await service.createTag('tenant-1', '  Frágil  ', '#FF0000');

      expect(tags.create).toHaveBeenCalledWith({ tenantId: 'tenant-1', name: 'Frágil', color: '#FF0000' });
    });

    it('aceita ausência de cor (null)', async () => {
      const { service, tags } = buildService();
      tags.create.mockResolvedValue(buildTag({ color: null }));

      await service.createTag('tenant-1', 'Frágil');

      expect(tags.create).toHaveBeenCalledWith({ tenantId: 'tenant-1', name: 'Frágil', color: null });
    });

    it('rejeita nome vazio ou só espaço', async () => {
      const { service, tags } = buildService();
      await expect(service.createTag('tenant-1', '')).rejects.toThrow();
      await expect(service.createTag('tenant-1', '   ')).rejects.toThrow();
      expect(tags.create).not.toHaveBeenCalled();
    });

    it('rejeita nome acima de 50 caracteres', async () => {
      const { service, tags } = buildService();
      await expect(service.createTag('tenant-1', 'x'.repeat(51))).rejects.toThrow();
      expect(tags.create).not.toHaveBeenCalled();
    });

    it('rejeita cor em formato hex inválido', async () => {
      const { service, tags } = buildService();
      await expect(service.createTag('tenant-1', 'Frágil', 'vermelho')).rejects.toThrow();
      expect(tags.create).not.toHaveBeenCalled();
    });

    it('traduz violação de unicidade (nome duplicado no tenant) em ConflictException', async () => {
      const { service, tags } = buildService();
      tags.create.mockRejectedValue(buildP2002());

      await expect(service.createTag('tenant-1', 'Frágil')).rejects.toThrow();
    });
  });

  describe('deleteTag', () => {
    it('apaga quando a tag pertence ao tenant', async () => {
      const { service, tags } = buildService();
      tags.findById.mockResolvedValue(buildTag({ tenantId: 'tenant-1' }));

      await service.deleteTag('tenant-1', 'tag-1');

      expect(tags.delete).toHaveBeenCalledWith('tag-1');
    });

    it('rejeita tag de outro tenant, sem apagar', async () => {
      const { service, tags } = buildService();
      tags.findById.mockResolvedValue(buildTag({ tenantId: 'outro-tenant' }));

      await expect(service.deleteTag('tenant-1', 'tag-1')).rejects.toThrow();
      expect(tags.delete).not.toHaveBeenCalled();
    });

    it('tag inexistente: lança NotFoundException', async () => {
      const { service, tags } = buildService();
      tags.findById.mockResolvedValue(null);

      await expect(service.deleteTag('tenant-1', 'tag-inexistente')).rejects.toThrow();
      expect(tags.delete).not.toHaveBeenCalled();
    });
  });

  describe('assign', () => {
    it('atribui quando a tag pertence ao tenant e entityType é válido', async () => {
      const { service, tags, assignments } = buildService();
      tags.findById.mockResolvedValue(buildTag({ tenantId: 'tenant-1' }));
      assignments.assign.mockResolvedValue(buildAssignment());

      await service.assign('tenant-1', 'tag-1', 'PRODUCT', 'SKU-1');

      expect(assignments.assign).toHaveBeenCalledWith('tenant-1', 'tag-1', 'PRODUCT', 'SKU-1');
    });

    it('aceita ORDER e FIXED_EXPENSE (polimórfico desde já)', async () => {
      const { service, tags, assignments } = buildService();
      tags.findById.mockResolvedValue(buildTag({ tenantId: 'tenant-1' }));
      assignments.assign.mockResolvedValue(buildAssignment({ entityType: 'ORDER' }));

      await service.assign('tenant-1', 'tag-1', 'ORDER', 'order-1');
      await service.assign('tenant-1', 'tag-1', 'FIXED_EXPENSE', 'expense-1');

      expect(assignments.assign).toHaveBeenCalledWith('tenant-1', 'tag-1', 'ORDER', 'order-1');
      expect(assignments.assign).toHaveBeenCalledWith('tenant-1', 'tag-1', 'FIXED_EXPENSE', 'expense-1');
    });

    it('rejeita entityType inválido, sem tocar o repositório de tag nem de atribuição', async () => {
      const { service, tags, assignments } = buildService();

      await expect(service.assign('tenant-1', 'tag-1', 'INVALIDO', 'SKU-1')).rejects.toThrow();
      expect(tags.findById).not.toHaveBeenCalled();
      expect(assignments.assign).not.toHaveBeenCalled();
    });

    it('rejeita tag de outro tenant', async () => {
      const { service, tags, assignments } = buildService();
      tags.findById.mockResolvedValue(buildTag({ tenantId: 'outro-tenant' }));

      await expect(service.assign('tenant-1', 'tag-1', 'PRODUCT', 'SKU-1')).rejects.toThrow();
      expect(assignments.assign).not.toHaveBeenCalled();
    });
  });

  describe('unassign', () => {
    it('desatribui quando a tag pertence ao tenant e entityType é válido', async () => {
      const { service, tags, assignments } = buildService();
      tags.findById.mockResolvedValue(buildTag({ tenantId: 'tenant-1' }));

      await service.unassign('tenant-1', 'tag-1', 'PRODUCT', 'SKU-1');

      expect(assignments.unassign).toHaveBeenCalledWith('tenant-1', 'tag-1', 'PRODUCT', 'SKU-1');
    });

    it('rejeita entityType inválido', async () => {
      const { service, tags, assignments } = buildService();

      await expect(service.unassign('tenant-1', 'tag-1', 'INVALIDO', 'SKU-1')).rejects.toThrow();
      expect(tags.findById).not.toHaveBeenCalled();
      expect(assignments.unassign).not.toHaveBeenCalled();
    });

    it('rejeita tag de outro tenant', async () => {
      const { service, tags, assignments } = buildService();
      tags.findById.mockResolvedValue(buildTag({ tenantId: 'outro-tenant' }));

      await expect(service.unassign('tenant-1', 'tag-1', 'PRODUCT', 'SKU-1')).rejects.toThrow();
      expect(assignments.unassign).not.toHaveBeenCalled();
    });
  });

  describe('listForEntity', () => {
    it('lista as tags de uma entidade sem exigir posse de tag específica', async () => {
      const { service, assignments } = buildService();
      assignments.findByEntity.mockResolvedValue([buildAssignment()]);

      const result = await service.listForEntity('tenant-1', 'PRODUCT', 'SKU-1');

      expect(result).toHaveLength(1);
      expect(assignments.findByEntity).toHaveBeenCalledWith('tenant-1', 'PRODUCT', 'SKU-1');
    });

    it('rejeita entityType inválido', async () => {
      const { service, assignments } = buildService();

      await expect(service.listForEntity('tenant-1', 'INVALIDO', 'SKU-1')).rejects.toThrow();
      expect(assignments.findByEntity).not.toHaveBeenCalled();
    });
  });
});
