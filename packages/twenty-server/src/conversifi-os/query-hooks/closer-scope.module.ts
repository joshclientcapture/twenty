import { Global, Module } from '@nestjs/common';

import { CloserScopeService } from 'src/conversifi-os/query-hooks/closer-scope.service';
import { UserRoleModule } from 'src/engine/metadata-modules/user-role/user-role.module';

// Global: the nested-relation loader is provided by several core modules and all of them must
// resolve the scope service without each importing this module.
@Global()
@Module({
  imports: [UserRoleModule],
  providers: [CloserScopeService],
  exports: [CloserScopeService],
})
export class CloserScopeModule {}
