'use strict'

// npm
const nano = require('nano')
require('dotenv-safe').load({
  silent: true,
  sample: 'node_modules/feverish-auth/.env.example'
})

// self
const pkg = require('./package.json')

const after = (options, server, next) => {
  const cache = server.cache({ segment: 'sessions', expiresIn: 3 * 24 * 60 * 60 * 1000 })
  server.app.cache = cache

  server.views({
    engines: { html: require('lodash-vision') },
    path: 'templates',
    partialsPath: 'templates/partials',
    isCached: process.env.TEMPLATE_CACHE.toLowerCase() === 'true'
  })

  server.auth.strategy('session', 'cookie', true, {
    password: 'password-should-be-32-characters',
    cookie: 'sid-example',
    redirectTo: '/login',
    isSecure: false,
    validateFunc: (request, session, callback) => {
      cache.get(
        session.sid, (err, cached) => err
          ? callback(err, false)
          : cached
            ? callback(null, true, cached.account)
            : callback(null, false)
      )
    }
  })

  const loginGet = function (request, reply) {
    request.auth.isAuthenticated ? reply.redirect('/') : reply.view('login').etag(pkg.version)
  }

  const loginPost = function (request, reply) {
    if (request.auth.isAuthenticated) { return reply.redirect('/') }
    if (!request.payload.username || !request.payload.password) {
      return reply.view('login', { message: 'Missing username or password' })
    }

    nano(process.env.DBURL).auth(request.payload.username, request.payload.password, (err, body, headers) => {
      if (err) {
        if (err.statusCode === 401) {
          reply.view('login', { message: err.reason })
        } else if (err.code === 'ECONNREFUSED') {
          reply.view('login', { message: 'Problem with the database.' })
        } else {
          reply(err)
        }
        return
      }
      if (!body.name) { body.name = request.payload.username }
      cache.set(body.name, { account: body }, 0, (err) => {
        if (err) { return reply(err) }
        request.cookieAuth.set({ sid: body.name })
        reply.redirect('/')
      })
    })
  }

  server.route({
    method: 'POST',
    path: '/logout',
    handler: (request, reply) => {
      request.cookieAuth.clear()
      return reply.redirect('/')
    }
  })

  server.route({
    method: 'GET',
    path: '/login',
    config: {
      handler: loginGet,
      auth: { mode: 'try' },
      plugins: { 'hapi-auth-cookie': { redirectTo: false } }
    }
  })

  server.route({
    method: 'POST',
    path: '/login',
    config: {
      handler: loginPost,
      auth: { mode: 'try' },
      plugins: { 'hapi-auth-cookie': { redirectTo: false } }
    }
  })

  next()
}

exports.register = (server, options, next) => {
  server.dependency(Object.keys(pkg.dependencies).filter((x) => pkg.notHapiPlugins.indexOf(x) === -1), after.bind(null, options))
  next()
}

exports.register.attributes = {
  name: pkg.name,
  version: pkg.version
}
