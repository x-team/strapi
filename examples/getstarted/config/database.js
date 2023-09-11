const mysql = {
  connector: 'bookshelf',
  settings: {
    client: 'mysql',
    database: 'strapi',
    username: 'root',
    password: 'admin123',
    port: 3308,
    host: 'localhost',
  },
  options: {},
};

const db = {
  mysql,
};

module.exports = {
  defaultConnection: 'default',
  connections: {
    default: process.env.DB ? db[process.env.DB] || db.mysql : db.mysql,
  },
};
