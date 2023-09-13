const frontPaths = [
  'packages/**/admin/src/**/**/*.js',
  'packages/**/ee/admin/**/**/*.js',
  'packages/strapi-helper-plugin/**/*.js',
  'packages/**/tests/front/**/*.js',
  'test/config/front/**/*.js',
];

module.exports = {
  parser: 'babel-eslint',
  parserOptions: {
    sourceType: 'module',
  },
  overrides: [
    {
      files: ['packages/**/*.js', 'test/**/*.js', 'scripts/**/*.js'],
      excludedFiles: frontPaths,
      ...require('./.eslintrc.back.js'),
    },
    {
      files: frontPaths,
      ...require('./.eslintrc.front.js'),
    },
  ],
};
