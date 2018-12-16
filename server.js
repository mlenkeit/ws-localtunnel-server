'use strict'

const assert = require('assert')
const basicAuth = require('express-basic-auth')
const bodyParser = require('body-parser')
const express = require('express')
const expressWs = require('express-ws')
const tokenAuth = require('express-api-token-auth')
const uuidv4 = require('uuid/v4')

module.exports = function (opts) {
  assert(opts.api_token, 'API token option is required')
  assert(opts.basic_auth, 'Basic auth option is required')

  const connections = {}
  const isValidRealm = (realm) => Object.keys(connections).indexOf(realm) > -1
  const packets = {}

  const app = express()
  expressWs(app)

  const basicAuthChunks = opts.basic_auth.split(':')
  const checkBasicAuth = basicAuth({
    users: {
      [basicAuthChunks[0]]: basicAuthChunks[1]
    },
    challenge: true,
    realm: 'ws-localtunnel'
  })
  const checkAuth = tokenAuth({
    token: opts.api_token,
    onError: (req, res, next, params) => checkBasicAuth(req, res, next)
  })

  console.log(`Current API token is ${opts.api_token}`)
  console.log(`Current basic auth credential is ${opts.basic_auth}`)

  // status
  app.get('/', (req, res) => {
    res.status(200).send('ok')
  })

  // check for api token
  app.use(checkAuth)
  app.use(bodyParser.json())

  app.use('/to/:realm', (req, res) => {
    const realm = req.params.realm
    if (!isValidRealm(realm)) {
      return res.status(400).send(`Invalid realm ${realm}`)
    }
    console.log(`Forwarding request ${req.url} for realm ${realm}`)

    const connection = connections[realm]
    if (!connection) {
      return res.status(500).send(`No active connection for realm ${realm}`)
    }

    const uuid = uuidv4()
    // console.log('url', req.url);
    // console.log('headers', req.headers);
    // console.log('method', req.method);
    const reqMetadata = {
      uuid: uuid,
      url: req.url,
      headers: req.headers,
      method: req.method,
      body: req.body
    }
    packets[uuid] = {
      reqMetadata: reqMetadata,
      req: req,
      res: res
    }
    connection.send(JSON.stringify(reqMetadata))
  })

  app.ws('/receive/:realm', (ws, req) => {
    const realm = req.params.realm
    console.log(`New client for realm ${realm}`)

    if (connections[realm]) {
      console.log(`Closing previous connection for realm ${realm}`)
      connections[realm].close()
    }
    connections[realm] = ws

    ws.on('message', function (msg) {
      try {
        const resMetadata = JSON.parse(msg)
        const uuid = resMetadata.uuid
        const packet = packets[uuid]
        if (packet) {
          // TODO: remove workaround, rewrite should be done in client
          const body = resMetadata.body.replace(new RegExp(`/${realm}`, 'g'), `/to/${realm}`)
          packet.res.status(resMetadata.statusCode).set(resMetadata.headers).send(body)
          delete packets[uuid]
        } else {
          console.log(`Ignoring message ${msg}`)
        }
      } catch (e) {

      }
    })
    ws.on('close', function () {
      console.log(`Removing client for realm ${realm}`)
      delete connections[realm]
    })
  })

  return app
}
