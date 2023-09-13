'use strict';
/**
 * Implementation of model queries for bookshelf
 */

const _ = require('lodash');
const { omit } = require('lodash/fp');
const pmap = require('p-map');
const { convertRestQueryParams, buildQuery, escapeQuery } = require('@x-team/strapi-utils');
const { singular } = require('pluralize');
const { handleDatabaseError } = require('./utils/errors');

const BATCH_SIZE = 1000;

const pickCountFilters = omit(['sort', 'limit', 'start']);

module.exports = function createQueryBuilder({ model, strapi }) {
  /* Utils */
  const timestamps = _.get(model, ['options', 'timestamps'], []);

  // Returns an object without relational keys to persist in DB
  const selectAttributes = attributes => {
    return _.pickBy(attributes, (value, key) => {
      if (Array.isArray(timestamps) && timestamps.includes(key)) {
        return false;
      }

      return _.has(model.allAttributes, key);
    });
  };

  const wrapTransaction = (fn, { transacting } = {}) => {
    const db = strapi.connections[model.connection];

    if (transacting) return fn(transacting);
    return db.transaction(trx => fn(trx));
  };

  const wrapErrors = fn => async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      return handleDatabaseError(error);
    }
  };

  /**
   * Find one entry based on params
   */
  async function findOne(params, populate, { transacting } = {}) {
    const entries = await find({ ...params, _limit: 1 }, populate, { transacting });
    return entries[0] || null;
  }

  /**
   * Find multiple entries based on params
   */
  function find(params, populate, { transacting } = {}) {
    const filters = convertRestQueryParams(params);
    const query = buildQuery({ model, filters });

    return model
      .query(query)
      .fetchAll({
        withRelated: populate,
        transacting,
        publicationState: filters.publicationState,
      })
      .then(results => results.toJSON());
  }

  /**
   * Count entries based on filters
   */
  function count(params = {}, { transacting } = {}) {
    const filters = pickCountFilters(convertRestQueryParams(params));

    return model
      .query(buildQuery({ model, filters }))
      .count({ transacting })
      .then(Number);
  }

  async function create(attributes) {
    const data = { ...selectAttributes(attributes) };
    const result = await model.forge(data).save(null, {
      autoRefresh: false,
    });
    return result.toJSON();
  }

  async function update(params, attributes) {
    if (!Object.keys(params).length) {
      throw new Error('Missing update params');
    }

    const entry = await model.where(params).fetch({
      columns: ['id'],
      withRelated: [],
    });

    if (!entry) {
      const err = new Error('entry.notFound');
      err.status = 404;
      throw err;
    }

    const data = { ...selectAttributes(attributes) };
    if (!Object.keys(data).length) {
      return entry;
    }

    const result = await entry.save(data, {
      method: 'update',
      patch: true,
      autoRefresh: false,
    });

    return result.toJSON();
  }

  async function deleteOne(id, { transacting } = {}) {
    const entry = await model.where({ [model.primaryKey]: id }).fetch({ transacting });

    if (!entry) {
      const err = new Error('entry.notFound');
      err.status = 404;
      throw err;
    }

    await model.deleteRelations(id, { transacting });

    const runDelete = async trx => {
      await model.where({ id: entry.id }).destroy({ transacting: trx, require: false });
      return entry.toJSON();
    };

    return wrapTransaction(runDelete, { transacting });
  }

  async function deleteMany(
    params,
    { transacting, returning = true, batchSize = BATCH_SIZE } = {}
  ) {
    if (params[model.primaryKey]) {
      const entries = await find({ ...params, _limit: 1 }, null, { transacting });
      if (entries.length > 0) {
        return deleteOne(entries[0][model.primaryKey], { transacting });
      }
      return null;
    }

    if (returning) {
      const paramsWithDefaults = _.defaults(params, { _limit: -1 });
      const entries = await find(paramsWithDefaults, null, { transacting });
      return pmap(entries, entry => deleteOne(entry.id, { transacting }), {
        concurrency: 100,
        stopOnError: true,
      });
    }

    // returning false, we can optimize the function
    const batchParams = _.assign({}, params, { _limit: batchSize, _sort: 'id:ASC' });
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const batch = await find(batchParams, null, { transacting });

      await pmap(batch, entry => deleteOne(entry.id, { transacting }), {
        concurrency: 100,
        stopOnError: true,
      });

      if (batch.length < BATCH_SIZE) {
        break;
      }
    }
  }

  function search(params, populate) {
    const filters = convertRestQueryParams(_.omit(params, '_q'));

    return model
      .query(qb => qb.where(buildSearchQuery({ model, params })))
      .query(buildQuery({ model, filters }))
      .fetchAll({ withRelated: populate })
      .then(results => results.toJSON());
  }

  function countSearch(params) {
    const countParams = omit(['_q'], params);
    const filters = pickCountFilters(convertRestQueryParams(countParams));

    return model
      .query(qb => qb.where(buildSearchQuery({ model, params })))
      .query(buildQuery({ model, filters }))
      .count()
      .then(Number);
  }

  async function fetchRelationCounters(attribute, entitiesIds = []) {
    const assoc = model.associations.find(assoc => assoc.alias === attribute);
    const assocModel = strapi.db.getModelByAssoc(assoc);
    const knex = strapi.connections[model.connection];
    const targetAttribute = assocModel.attributes[assoc.via];

    switch (assoc.nature) {
      case 'oneToMany': {
        return knex
          .select()
          .column({ id: assoc.via, count: knex.raw('count(*)') })
          .from(assocModel.collectionName)
          .whereIn(assoc.via, entitiesIds)
          .groupBy(assoc.via);
      }
      case 'manyWay': {
        const column = `${singular(model.collectionName)}_${model.primaryKey}`;
        return knex
          .select()
          .column({ id: column, count: knex.raw('count(*)') })
          .from(assoc.tableCollectionName)
          .whereIn(column, entitiesIds)
          .groupBy(column);
      }
      case 'manyToMany': {
        const column = `${targetAttribute.attribute}_${targetAttribute.column}`;
        return knex
          .select()
          .column({ id: column, count: knex.raw('count(*)') })
          .from(assoc.tableCollectionName)
          .whereIn(column, entitiesIds)
          .groupBy(column);
      }
      default: {
        return [];
      }
    }
  }

  return {
    findOne,
    find,
    create: wrapErrors(create),
    update: wrapErrors(update),
    delete: deleteMany,
    count,
    search,
    countSearch,
    fetchRelationCounters,
  };
};

/**
 * util to build search query
 * @param {*} model
 * @param {*} params
 */
const buildSearchQuery = ({ model, params }) => qb => {
  const query = params._q;

  const associations = model.associations.map(x => x.alias);
  const stringTypes = ['string', 'text', 'uid', 'email', 'enumeration', 'richtext'];
  const numberTypes = ['biginteger', 'integer', 'decimal', 'float'];

  const searchColumns = Object.keys(model._attributes)
    .filter(attribute => !associations.includes(attribute))
    .filter(attribute => stringTypes.includes(model._attributes[attribute].type))
    .filter(attribute => model._attributes[attribute].searchable !== false);

  if (!_.isNaN(_.toNumber(query))) {
    const numberColumns = Object.keys(model._attributes)
      .filter(attribute => !associations.includes(attribute))
      .filter(attribute => numberTypes.includes(model._attributes[attribute].type))
      .filter(attribute => model._attributes[attribute].searchable !== false);
    searchColumns.push(...numberColumns);
  }

  if ([...numberTypes, ...stringTypes].includes(model.primaryKeyType)) {
    searchColumns.push(model.primaryKey);
  }

  // Search in columns with text using index.
  switch (model.client) {
    case 'pg':
      searchColumns.forEach(attr =>
        qb.orWhereRaw(
          `"${model.collectionName}"."${attr}"::text ILIKE ?`,
          `%${escapeQuery(query, '*%\\')}%`
        )
      );
      break;
    case 'sqlite3':
      searchColumns.forEach(attr =>
        qb.orWhereRaw(
          `"${model.collectionName}"."${attr}" LIKE ? ESCAPE '\\'`,
          `%${escapeQuery(query, '*%\\')}%`
        )
      );
      break;
    case 'mysql':
      searchColumns.forEach(attr =>
        qb.orWhereRaw(
          `\`${model.collectionName}\`.\`${attr}\` LIKE ?`,
          `%${escapeQuery(query, '*%\\')}%`
        )
      );
      break;
  }
};
