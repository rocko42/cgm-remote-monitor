'use strict';

const _forEach = require('lodash/forEach');
const _isNil = require('lodash/isNil');
const _isArray = require('lodash/isArray');
const _take = require('lodash/take');

const constants = require('../../constants');
const moment = require('moment');

function configure (app, wares, ctx, env) {
  var express = require('express')
    , api = express.Router();

  api.use(wares.compression());

  // text body types get handled as raw buffer stream
  api.use(wares.rawParser);
  // json body types get handled as parsed json
  api.use(wares.bodyParser.json({
    limit: '50Mb'
  }));
  // also support url-encoded content-type
  api.use(wares.urlencodedParser);

  // invoke common middleware
  api.use(wares.sendJSONStatus);

  api.use(ctx.authorization.isPermitted('api:alarms:read'));

  function servealarms(req,res, err, results) {

    var ifModifiedSince = req.get('If-Modified-Since');

    var d1 = null;

    const deNormalizeDates = env.settings.deNormalizeDates;

    _forEach(results, function clean (t) {
      t.carbs = Number(t.carbs);
      t.insulin = Number(t.insulin);

      if (deNormalizeDates && Object.prototype.hasOwnProperty.call(t, 'utcOffset')) {
          const d = moment(t.created_at).utcOffset(t.utcOffset);
          t.created_at = d.toISOString(true);
          delete t.utcOffset;
      }

      var d2 = null;

      if (Object.prototype.hasOwnProperty.call(t, 'created_at')) {
        d2 = new Date(t.created_at);
      } else {
        if (Object.prototype.hasOwnProperty.call(t, 'timestamp')) {
          d2 = new Date(t.timestamp);
        }
      }

      if (d2 == null) { return; }

      if (d1 == null || d2.getTime() > d1.getTime()) {
        d1 = d2;
      }
    });

    if (!_isNil(d1)) res.setHeader('Last-Modified', d1.toUTCString());

    if (ifModifiedSince && d1.getTime() <= moment(ifModifiedSince).valueOf()) {
      res.status(304).send({
        status: 304
        , message: 'Not modified'
        , type: 'internal'
      });
      return;
    } else {
      return res.json(results);
    }
  }

  // List alarms available
  api.get('/alarms', function(req, res) {
    var query = req.query;
    if (!query.count) {
        // If there's a date search involved, default to a higher number of objects
        query.count = query.find ? 1000 : 100;
      }

    const inMemoryData = ctx.cache.alarms;
    const canServeFromMemory = inMemoryData && inMemoryData.length >= query.count && Object.keys(query).length == 1 ? true : false;

    if (canServeFromMemory) {
      servealarms(req, res, null, _take(inMemoryData,query.count));
    } else {
      ctx.alarms.list(query, function(err, results) {
        servealarms(req,res,err,results);
      });
    }
  });

  function config_authed (app, api, wares, ctx) {

    function post_response (req, res) {
      var alarms = req.body;

      if (!_isArray(alarms)) {
        alarms = [alarms];
      }

      for (let i = 0; i < alarms.length; i++) {
        const t = alarms[i];

        if (!t.created_at) {
          t.created_at = new Date().toISOString();
        }

        ctx.purifier.purifyObject(t);

        /*
        if (!t.created_at) {
          console.log('Trying to create alarm without created_at field', t);
          res.sendJSONStatus(res, constants.HTTP_VALIDATION_ERROR, 'alarms must contain created_at');
          return;
        }
        const d = moment(t.created_at);
        if (!d.isValid()) {
          console.log('Trying to insert date with invalid created_at', t);
          res.sendJSONStatus(res, constants.HTTP_VALIDATION_ERROR, 'alarms created_at must be an ISO-8601 date');
          return;
        }
        */

      }

      ctx.alarms.create(alarms, function(err, created) {
        if (err) {
          console.log('Error adding alarm', err);
          res.sendJSONStatus(res, constants.HTTP_INTERNAL_ERROR, 'Mongo Error', err);
        } else {
          console.log('REST API alarm created', created);
          res.json(created);
        }
      });
    }

    api.post('/alarms/', ctx.authorization.isPermitted('api:alarms:create'), post_response);

    /**
     * @function delete_records
     * Delete alarms.  The query logic works the same way as find/list.  This
     * endpoint uses same search logic to remove records from the database.
     */
    function delete_records (req, res, next) {
      var query = req.query;
      if (!query.count) {
        query.count = 10
      }

      // remove using the query
      ctx.alarms.remove(query, function(err, stat) {
        if (err) {
          console.log('alarms delete error: ', err);
          return next(err);
        }

        // yield some information about success of operation
        res.json(stat);

        return next();
      });
    }

    api.delete('/alarms/:id', ctx.authorization.isPermitted('api:alarms:delete'), function(req, res, next) {
      if (!req.query.find) {
        req.query.find = {
          _id: req.params.id
        };
      } else {
        req.query.find._id = req.params.id;
      }

      if (req.query.find._id === '*') {
        // match any record id
        delete req.query.find._id;
      }
      next();
    }, delete_records);

    // delete record that match query
    api.delete('/alarms/', ctx.authorization.isPermitted('api:alarms:delete'), delete_records);

    // update record
    api.put('/alarms/', ctx.authorization.isPermitted('api:alarms:update'), function(req, res) {
      var data = req.body;
      ctx.alarms.save(data, function(err, created) {
        if (err) {
          res.sendJSONStatus(res, constants.HTTP_INTERNAL_ERROR, 'Mongo Error', err);
          console.log('Error saving alarm', err);
        } else {
          res.json(created);
          console.log('alarm saved', data);
        }
      });
    });
  }

  if (app.enabled('api') && app.enabled('careportal')) {
    config_authed(app, api, wares, ctx);
  }

  return api;
}

module.exports = configure;
