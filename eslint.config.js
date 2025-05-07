// eslint.config.js
'use strict';

const tseslint = require('typescript-eslint');
const stylisticTs = require('@stylistic/eslint-plugin-ts'); // Import the stylistic plugin

module.exports = tseslint.config(
  // Apply TypeScript-ESLint's recommended configurations globally first.
  // These configurations will set up the parser, plugin, and rules for .ts/.tsx files.
  ...tseslint.configs.recommended,

  // Add a specific configuration for `eslint.config.js` itself.
  // This object will be merged with or override parts of the above for this specific file.
  {
    files: ['eslint.config.js'], // Target ONLY this configuration file
    rules: {
      // Disable rules that are problematic for a CommonJS JavaScript config file.
      '@typescript-eslint/no-require-imports': 'off', // Allow require()
      '@typescript-eslint/no-var-requires': 'off',   // Also allow require() via var/const
      // Add any other @typescript-eslint rules here that shouldn't apply to this JS file.
    }
  },

  // Add configuration for TypeScript specific rules, including stylistic ones.
  {
    files: ['**/*.ts', '**/*.tsx'], // Target your TypeScript source files
    plugins: {
      // Register the stylistic plugin
      '@stylistic/ts': stylisticTs 
    },
    rules: {
      // Enforce no semicolons using the stylistic plugin's rule
      '@stylistic/ts/semi': ['error', 'never'], 
      // It's also good practice to disable the base ESLint 'semi' rule
      // to prevent conflicts, though tseslint.configs.recommended might do this for .ts files.
      'semi': 'off', 
    }
  }
);
