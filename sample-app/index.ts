// File: /Users/sidney/boundless/live-lambda/sample-app/index.ts

import { inspect } from 'util';

const app_name: string = 'sample-app';

function get_app_status(is_active: boolean): { name: string; status: string } {
  return {
    name: app_name,
    status: is_active ? 'active and running' : 'inactive',
  };
}

const app_status_report = get_app_status(true);

console.log(`Status Report for: ${app_status_report.name}`);
console.log(`Current Status: ${app_status_report.status}`);

const app_config_details: { version: string; port: number; features_enabled: string[] } = {
  version: '1.0.0-alpha',
  port: 3001,
  features_enabled: ['logging', 'api-access'],
};

console.log('\n--- App Configuration Details ---');
console.log(inspect(app_config_details, { depth: null, colors: true, sorted: true }));

export { get_app_status };
