'use strict'

const assert = require('assert')
const basicAuth = require('express-basic-auth')
const express = require('express')
const expressWs = require('express-ws')
const uuidv4 = require('uuid/v4')

const API_TOKEN_EXPRESSION = /^token (.*)$/

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
    }
  })

  console.log(`Current API token is ${opts.api_token}`)
  console.log(`Current basic auth credential is ${opts.basic_auth}`)

  // status
  app.get('/', (req, res) => {
    res.status(200).send('ok')
  })

  // check for api token
  app.use((req, res, next) => {
    const authorization = req.get('Authorization') || ''
    const tokenMatches = API_TOKEN_EXPRESSION.exec(authorization)
    const token = tokenMatches ? tokenMatches[1] : null

    if (token !== opts.api_token) {
      console.log(`Request for ${req.url} does not contain a valid API token, checking for basic auth`)
      return checkBasicAuth(req, res, next)
    }
    next()
  })

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
      method: req.method
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
          packet.res.status(resMetadata.statusCode).set(resMetadata.headers).send(resMetadata.body)
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
