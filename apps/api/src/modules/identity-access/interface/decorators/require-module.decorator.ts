import { SetMetadata } from '@nestjs/common';
import { ModuleCode } from '../../../../shared/access-control/module-code';

export const REQUIRE_MODULE_KEY = 'requireModule';

// Uso: @RequireModule(ModuleCode.ORDERS) acima do controller (afeta todas as
// rotas dele). Sem esse decorator, ModuleAccessGuard libera qualquer
// autenticado — mesmo racional de @Roles/RolesGuard, e propositalmente
// independente dele (um controller pode ter os dois: @Roles decide QUEM
// escreve, @RequireModule decide QUEM enxerga o módulo).
export const RequireModule = (module: ModuleCode) => SetMetadata(REQUIRE_MODULE_KEY, module);
