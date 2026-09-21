import { Module } from '@nestjs/common';

import { CloserScopeService } from 'src/conversifi-os/query-hooks/closer-scope.service';
import { UserRoleModule } from 'src/engine/metadata-modules/user-role/user-role.module';

// Shared by the OS module (query hooks) and the core search resolver, so both scope the same way.
@Module({
  imports: [UserRoleModule],
  providers: [CloserScopeService],
  exports: [CloserScopeService],
})
export class CloserScopeModule {}
