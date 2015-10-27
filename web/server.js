/* jshint esnext: true */

var Boom = require('boom');
var Hapi = require('hapi');
var Hoek = require('hoek');
var Joi = require('joi');
var Path = require('path');
var url = require('url');
var Scopes = require('../lib/scopes');

var PassTest = require('pass-test');

var passTest = new PassTest({
  minLength: 8,
  maxLength: 256,
  minPhraseLength: 20,
  minOptionalTestsToPass: 2,
  allowPassphrases: true
});

module.exports = function(options) {
  var serverConfig = {
    debug: options.debug,
    connections: {
      routes: {
        security: true
      }
    }
  };

  if ( options.redisUrl ) {
    var redisUrl = require('redis-url').parse(options.redisUrl);
    serverConfig.cache = {
      engine: require('catbox-redis'),
      host: redisUrl.hostname,
      port: redisUrl.port,
      password: redisUrl.password
    };
  }

  var server = new Hapi.Server(serverConfig);

  server.connection({
    host: options.host,
    port: options.port
  });

  if ( options.logging ) {
    server.register({
      register: require('hapi-bunyan'),
      options: {
        logger: require('bunyan').createLogger({
          name: 'id-webmaker-org',
          level: options.logLevel
        })
      }
    }, function(err) {
      Hoek.assert(!err, err);
    });
  }

  server.register([
    require('hapi-auth-cookie'),
    require('inert'),
    require('scooter'),
    {
      register: require('blankie'),
      options: {
        defaultSrc: [
          '\'none\''
        ],
        styleSrc: [
          '\'self\'',
          'https://fonts.googleapis.com'
        ],
        imgSrc: [
          '\'self\'',
          'data:',
          'https://www.google-analytics.com',
          'http://www.google-analytics.com'
        ],
        scriptSrc: [
          '\'self\'',
          '\'unsafe-eval\'',
          'https://www.google-analytics.com',
          'http://www.google-analytics.com'
        ],
        fontSrc: [
          '\'self\'',
          'https://fonts.gstatic.com'
        ]
      }
    },
    {
      register:require('../lib/OAuthDB'),
      options: {
        POSTGRE_CONNECTION_STRING: process.env.POSTGRE_CONNECTION_STRING,
        POSTGRE_POOL_MIN: process.env.POSTGRE_POOL_MIN,
        POSTGRE_POOL_MAX: process.env.POSTGRE_POOL_MAX,
        BCRYPT_ROUNDS: process.env.BCRYPT_ROUNDS,
        TOKEN_SALT: process.env.TOKEN_SALT,
        RANDOM_BYTE_COUNT: process.env.RANDOM_BYTE_COUNT,
        RESET_EXPIRY_TIME: process.env.RESET_EXPIRY_TIME
      }
    }
  ], function(err) {
    // MAYDAY, MAYDAY, MAYDAY!
    Hoek.assert(!err, err);

    server.auth.strategy('session', 'cookie', {
      password: options.cookieSecret,
      cookie: 'webmaker',
      ttl: 1000 * 60 * 60 * 24,
      isSecure: options.secureCookies,
      isHttpOnly: true
    });

    server.auth.default({
      strategy: 'session',
      mode: 'try'
    });
  });

  function skipCSRF(request, reply) {
    return true;
  }

  server.register({
    register: require('crumb'),
    options: {
      restful: true,
      skip: !options.enableCSRF ? skipCSRF : undefined,
      cookieOptions: {
        isSecure: options.secureCookies
      }
    }
  }, function(err) {
    Hoek.assert(!err, err);
  });

  server.route([
    {
      method: 'GET',
      path: '/',
      handler: function(request, reply) {
        reply.redirect('/signup');
      }
    },
    {
      method: 'GET',
      path: '/{params*}',
      handler: {
        file: {
          path: Path.join(__dirname, '../public/index.html')
        }
      }
    },
    {
      method: 'GET',
      path: '/assets/{param*}',
      handler: {
        directory: {
          path: Path.join(__dirname, '../public')
        }
      }
    },
    {
      method: 'GET',
      path: '/login/oauth/authorize',
      config: {
        validate: {
          query: {
            client_id: Joi.string().required(),
            response_type: Joi.string().valid('code', 'token'),
            scopes: Joi.string().required(),
            state: Joi.string().required(),
            action: Joi.string().optional().valid('signup', 'signin').default('signin')
          }
        },
        pre: [
          {
            assign: 'user',
            method: function(request, reply) {
              if (request.auth.isAuthenticated) {
                return reply(request.auth.credentials);
              }

              var redirectUrl = '/login';
              if (request.query.action === 'signup') {
                redirectUrl = '/signup';
              }

              var redirect = url.parse(redirectUrl, true);
              redirect.query.client_id = request.query.client_id;
              redirect.query.response_type = request.query.response_type;
              redirect.query.state = request.query.state;
              redirect.query.scopes = request.query.scopes;

              reply().takeover().redirect(url.format(redirect));
            }
          },
          {
            assign: 'client',
            method: function(request, reply) {
              server.methods.OAuthDB.getClient(request.query.client_id, reply);
            }
          },
          {
            method: function(request, reply) {
              if (
                request.pre.client.allowed_responses.indexOf(request.query.response_type) === -1
              ) {
                return reply(Boom.forbidden('Response type forbidden: ' + request.query.response_type));
              }
              reply();
            }
          },
          {
            assign: 'scopes',
            method: function(request, reply) {
              reply(request.query.scopes.split(' '));
            }
          },
          {
            assign: 'auth_code',
            method: function(request, reply) {
              if (request.query.response_type !== 'code') {
                return reply(null);
              }

              server.methods.OAuthDB.generateAuthCode(
                request.pre.client.client_id,
                request.pre.user.id,
                request.pre.scopes,
                new Date(Date.now() + 60 * 1000).toISOString(),
                function(err, authCode) {
                  if (err) {
                    return reply(Boom.badRequest('An error occurred processing your request', err));
                  }

                  reply(authCode);
                }
              );
            }
          },
          {
            assign: 'access_token',
            method: function(request, reply) {
              if (request.query.response_type !== 'token') {
                return reply(null);
              }

              server.methods.OAuthDB.generateAccessToken(
                request.pre.client.client_id,
                request.pre.user.id,
                request.pre.scopes,
                reply
              );
            }
          }
        ]
      },
      handler: function(request, reply) {
        var redirectObj = url.parse(request.pre.client.redirect_uri, true);
        redirectObj.search = null;

        if (request.query.response_type === 'token') {
          redirectObj.hash = 'token=' + request.pre.access_token;
        } else {
          redirectObj.query.code = request.pre.auth_code;
          redirectObj.query.client_id = request.query.client_id;
        }
        redirectObj.query.state = request.query.state;

        reply.redirect(url.format(redirectObj));
      }
    },
    {
      method: 'POST',
      path: '/login/oauth/access_token',
      config: {
        validate: {
          payload: {
            grant_type: Joi.any().valid('authorization_code', 'password').required(),
            code: Joi.string().when('grant_type', {
              is: 'authorization_code',
              then: Joi.required(),
              otherwise: Joi.forbidden()
            }),
            client_secret: Joi.string().when('grant_type', {
              is: 'authorization_code',
              then: Joi.required(),
              otherwise: Joi.forbidden()
            }),
            client_id: Joi.string().required(),
            uid: Joi.string().when('grant_type', {
              is: 'password',
              then: Joi.required(),
              otherwise: Joi.forbidden()
            }),
            password: Joi.string().when('grant_type', {
              is: 'password',
              then: Joi.required(),
              otherwise: Joi.forbidden()
            }),
            scopes: Joi.string().when('grant_type', {
              is: 'password',
              then: Joi.required(),
              otherwise: Joi.forbidden()
            })
          },
          failAction: function(request, reply, source, error) {
            reply(Boom.badRequest('invalid ' + source + ': ' + error.data.details[0].path));
          }
        },
        auth: false,
        plugins: {
          crumb: false
        },
        pre: [
          {
            assign: 'grant_type',
            method: function (request, reply) {
              reply(request.payload.grant_type);
            }
          },
          {
            assign: 'client',
            method: function(request, reply) {
              server.methods.OAuthDB.getClient(request.payload.client_id, function(err, client) {
                if ( err ) {
                  return reply(err);
                }
                if (
                  client.allowed_grants.indexOf(request.pre.grant_type) === -1 ||
                  (
                    request.pre.grant_type === 'authorization_code' &&
                    client.client_secret !== request.payload.client_secret
                  )
                ) {
                  return reply(Boom.forbidden('Invalid Client Credentials'));
                }

                reply(client);
              });
            }
          },
          {
            assign: 'authCode',
            method: function(request, reply) {
              if ( request.pre.grant_type === 'password' ) {
                return server.methods.OAuthDB.verifyPassword(
                  request.payload.password,
                  request.payload.uid,
                  function(err, user) {
                    if ( err ) {
                      return reply(err);
                    }

                    reply({
                      user_id: user.id,
                      scopes: request.payload.scopes.split(' ')
                    });
                  }
                );
              }

              server.methods.OAuthDB.verifyAuthCode(
                request.payload.code,
                request.pre.client.client_id,
                reply
              );
            }
          },
          {
            assign: 'accessToken',
            method: function(request, reply) {
              server.methods.OAuthDB.generateAccessToken(
                request.pre.client.client_id,
                request.pre.authCode.user_id,
                request.pre.authCode.scopes,
                reply
              );
            }
          }
        ]
      },
      handler: function(request, reply) {
        var responseObj = {
          access_token: request.pre.accessToken,
          scopes: request.pre.authCode.scopes,
          token_type: 'token'
        };

        reply(responseObj);
      }
    },
    {
      method: 'POST',
      path: '/login',
      config: {
        pre: [
          {
            assign: 'user',
            method: function(request, reply) {
              server.methods.OAuthDB.verifyPassword(
                request.payload.password,
                request.payload.uid,
                function(err, user) {
                  if ( err ) {
                    return reply(err);
                  }

                  reply(user);
                }
              );
            }
          }
        ]
      },
      handler: function(request, reply) {
        request.auth.session.set(request.pre.user);
        reply({ status: 'Logged In' });
      }
    },
    {
      method: 'POST',
      path: '/request-reset',
      config:{
        auth: false,
        validate: {
          payload: {
            uid: Joi.required(),
            oauth: Joi.object().required()
          }
        }
      },
      handler: function(request, reply) {
        server.methods.OAuthDB.requestPasswordResetEmail(
          request.payload.uid,
          request.payload.oauth,
          '/reset-password',
          function(err, json) {
            if ( err ) {
              return reply(err);
            }
            reply({
              status: 'success'
            });
          }
        );
      }
    },
    {
      method: 'POST',
      path: '/reset-password',
      config:{
        auth: false
      },
      handler: function(request, reply) {
        server.methods.OAuthDB.resetPassword(
          request.payload.resetCode,
          request.payload.uid,
          request.payload.password,
          function(err) {
            if ( err ) {
              return reply(err);
            }

            reply({
              status: 'success'
            });
          }
        );
      }
    },
    {
      method: 'POST',
      path: '/create-user',
      config: {
        auth: false,
        plugins: {
          crumb: false
        },
        cors: true,
        validate: {
          payload: {
            username: Joi.string().regex(/^[a-zA-Z0-9\-]{1,20}$/).required(),
            email: Joi.string().email().required(),
            password: Joi.string().regex(/^\S{8,128}$/).required(),
            feedback: Joi.boolean().required(),
            client_id: Joi.string().required(),
            lang: Joi.string().default('en-US')
          },
          failAction: function(request, reply, source, error) {
            reply(Boom.badRequest('invalid ' + source + ': ' + error.data.details[0].path));
          }
        },
        pre: [
          {
            assign: 'username',
            method: function(request, reply) {
              reply(request.payload.username);
            }
          },
          {
            assign: 'password',
            method: function(request, reply) {
              var password = request.payload.password;
              var result = passTest.test(password);

              if ( !result.strong ) {
                var err = Boom.badRequest('Password not strong enough.', result);
                err.output.payload.details = err.data;
                return reply(err);
              }

              reply(password);
            }
          },
          {
            assign: 'client',
            method: function(request, reply) {
              server.methods.OAuthDB.getClient(request.payload.client_id, reply);
            }
          }
        ]
      },
      handler: function(request, reply) {
        var payload = request.payload;
        server.methods.OAuthDB.createUser(
          payload.email,
          payload.username,
          payload.lang,
          payload.password,
          function(err, user) {
            if ( err ) {
              // TODO verify error handling works properly
              return reply(err);
            }
            request.auth.session.set(user);
            reply(user);
          }
        );
      }
    },
    {
      method: 'GET',
      path: '/logout',
      config: {
        auth: false,
        pre: [
          {
            assign: 'redirectUri',
            method: function(request, reply) {
              if ( !request.query.client_id ) {
                return reply('https://webmaker.org');
              }
              server.methods.OAuthDB.getClient(request.query.client_id, function(err, client) {
                if ( err ) {
                  return reply(err);
                }
                reply(client.redirect_uri);
              });
            }
          }
        ]
      },
      handler: function(request, reply) {
        request.auth.session.clear();

        var redirectObj = url.parse(request.pre.redirectUri, true);
        redirectObj.query.logout = true;
        reply.redirect(url.format(redirectObj))
          .header('cache-control', 'no-cache');
      }
    },
    {
      method: 'GET',
      path: '/user',
      config: {
        auth: false,
        cors: true,
        pre: [
          {
            assign: 'requestToken',
            method: function(request, reply) {
              var tokenHeader = request.headers.authorization || '';
              tokenHeader = tokenHeader.split(' ');

              if ( tokenHeader[0] !== 'token' || !tokenHeader[1] ) {
                return reply(Boom.unauthorized('Missing or invalid authorization header'));
              }

              reply(tokenHeader[1]);
            }
          },
          {
            assign: 'token',
            method: function(request, reply) {
              server.methods.OAuthDB.lookupAccessToken(request.pre.requestToken, function(err, token) {
                if ( err ) {
                  return reply(err);
                }

                if ( token.expires_at <= Date.now() ) {
                  return reply(Boom.unauthorized('Expired token'));
                }

                var tokenScopes = token.scopes;

                if ( tokenScopes.indexOf('user') === -1 && tokenScopes.indexOf('email') === -1 ) {
                  return reply(Boom.unauthorized('The token does not have the required scopes'));
                }

                reply(token);
              });
            }
          },
          {
            assign: 'user',
            method: function(request, reply) {
              server.methods.OAuthDB.getUser(request.pre.token.user_id, function(err, user) {
                if ( err ) {
                  return reply(Boom.badImplementation(err));
                }
                reply(user);
              });
            }
          }
        ]
      },
      handler: function(request, reply) {
        var responseObj = Scopes.filterUserForScopes(
          request.pre.user,
          request.pre.token.scopes
        );

        reply(responseObj);
      }
    },
    {
      method: 'POST',
      path: '/request-migration-email',
      config: {
        auth: false
      },
      handler: function(request, reply) {
        server.methods.OAuthDB.requestPasswordResetEmail(
          request.payload.uid,
          request.payload.oauth,
          '/migrate',
          function(err, json) {
            if ( err ) {
              return reply(err);
            }

            reply({ status: 'migration email sent' });
          }
        );
      }
    },
    {
      method: 'POST',
      path: '/check-username',
      config: {
        auth: false
      },
      handler: function(request, reply) {
        server.methods.OAuthDB.checkUsername(
          request.payload.uid,
          function(err, result) {
            if ( err ) {
              return reply(err);
            }

            reply(result);
          }
        );
      }
    }
  ]);

  return server;
};
