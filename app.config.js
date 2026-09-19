const appJson = require('./app.json');

const base = appJson.expo;
const isDev = process.env.NOVACAST_DEV_CLIENT === '1';

module.exports = {
  expo: {
    ...base,

    name: isDev ? 'NovaCast Dev' : base.name,
    scheme: isDev ? 'novacastv2-dev' : base.scheme,

    android: {
      ...base.android,
      package: isDev
        ? 'com.novacast.novacastv2.dev'
        : base.android.package,
    },
  },
};
