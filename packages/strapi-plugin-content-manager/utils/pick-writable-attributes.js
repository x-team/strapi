'use strict';

const { omit } = require('lodash/fp');
const { getNonWritableAttributes } = require('@x-team/strapi-utils').contentTypes;

module.exports = model => omit(getNonWritableAttributes(strapi.getModel(model)));
