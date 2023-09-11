// based on https://github.com/strapi/strapi/blob/master/packages/strapi-provider-email-amazon-ses/lib/index.js

'use strict';

const path = require('path');
const fs = require('fs-extra');

/* eslint-disable no-unused-vars */
module.exports = {
  provider: 'dev',
  name: 'Dev',

  init: (config = {}, settings = {}) => {
    const publicDir = path.resolve(strapi.dir, 'public');
    const { dir = publicDir } = config;

    return {
      send: async options => {
        const { from, to, subject, text, html } = options;

        strapi.log.info(`Email to <${options.to}>: "${options.subject}"`);

        // TODO: make this a config flag.
        if (process.env.DEV_EMAIL_WRITE_FILE) {
          if (options.text) {
            const filename = path.join(dir, 'email.txt');
            await fs.writeFile(filename, options.text, 'utf8');
            strapi.log.info(`- wrote: ${filename}`);
          }

          if (options.html) {
            const filename = path.join(dir, 'email.html');
            await fs.writeFile(filename, options.html, 'utf8');
            strapi.log.info(`- wrote: ${filename}`);
          }
        }
      },
    };
  },
};
