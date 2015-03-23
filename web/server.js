var Boom = require("boom");
var Hapi = require('hapi');
var Hoek = require('hoek');

module.exports = function(options) {
  var server = new Hapi.Server({
    debug: options.debug
  });
  server.connection({
    host: options.host,
    port: options.port
  });

  var account = require("../lib/account")({
    loginAPI: options.loginAPI
  });

  server.route([
    {
      method: 'GET',
      path: '/login/oauth/authorize',
      handler: function(request, reply) {
        reply('ok');
      }
    }, {
      method: 'POST',
      path: '/login/oauth/authorize',
      handler: function(request, reply) {
        account.verifyPassword(request, function(err, user) {
          if ( err ) {
            return reply(Boom.badImplementation(err));
          }
          if ( !user ) {
            return reply(Boom.unauthorized("Invalid username/email or password"));
          }
          reply(user);
        });
      },
      config: {
        validate: {
          payload: {
            password: Joi.string().trim(),
            uid: Joi.alternatives().try(Joi.string().email(), joi.string().max(20))
          }
        }
      }
    }, {
      method: 'POST',
      path: '/login/oauth/access_token',
      handler: function(request, reply) {
        reply('ok');
      }
    }
  ]);

  return server;
};
