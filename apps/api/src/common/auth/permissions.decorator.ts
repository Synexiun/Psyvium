import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@vpsy/contracts';

export const PERMISSIONS_KEY = 'required_permissions';

/** Guards a handler with one or more `context:action` permissions. */
export const RequirePermissions = (...perms: Permission[]) => SetMetadata(PERMISSIONS_KEY, perms);
