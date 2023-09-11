import React from 'react';
import { CheckPagePermissions } from '@x-team/strapi-helper-plugin';
import pluginPermissions from '../../../permissions';
import RolesEditPage from '../EditPage';

const ProtectedRolesEditPage = () => (
  <CheckPagePermissions permissions={pluginPermissions.updateRole}>
    <RolesEditPage />
  </CheckPagePermissions>
);

export default ProtectedRolesEditPage;
