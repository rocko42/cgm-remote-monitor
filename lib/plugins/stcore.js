'use strict';

var _ = require('lodash');
var async = require('async');
var request = require('request');

var times = require('../times');

function init (env) {

  var keys = env.extendedSettings && env.extendedSettings.stcore &&
    env.extendedSettings.stcore.key && env.extendedSettings.stcore.key.split(' ');

  var announcementKeys = (env.extendedSettings && env.extendedSettings.stcore &&
    env.extendedSettings.stcore.announcementKey && env.extendedSettings.stcore.announcementKey.split(' ')) || keys;

  var stcore = { };

  var lastAllClear = 0;

  stcore.sendAllClear = function sendAllClear (notify, callback) {
    if (Date.now() - lastAllClear > times.mins(30).msecs) {
      lastAllClear = Date.now();

      //can be used to prevent stcore/twitter deduping (add to IFTTT tweet text)
      var shortTimestamp = Math.round(Date.now() / 1000 / 60);

      stcore.makeKeyRequests({
        value1: (notify && notify.title) || 'All Clear'
        , value2: notify && notify.message && '\n' + notify.message
        , value3: '\n' + shortTimestamp
      }, 'ns-allclear', function allClearCallback (err) {
        if (err) {
          lastAllClear = 0;
          callback(err);
        } else if (callback) {
          callback(null, {sent: true});
        }
      });
    } else if (callback) {
      callback(null, {sent: false});
    }
  };

  stcore.sendEvent = function sendEvent (event, callback) {
    if (!event || !event.name) {
      callback('No event name found');
    } else if (!event.level) {
      callback('No event level found');
    } else {
      stcore.stcoreequests(event, function sendCallback (err, response) {
        if (err) {
          callback(err);
        } else {
          lastAllClear = 0;
          callback(null, response);
        }
      });
    }
  };

  //exposed for testing
  stcore.valuesToQuery = function valuesToQuery (event) {
    var query = '';

    for (var i = 1; i <= 3; i++) {
      var name = 'value' + i;
      var value = event[name];
      lastAllClear = 0;
      if (value) {
        if (query) {
          query += '&';
        } else {
          query += '?';
        }
        query += name + '=' + encodeURIComponent(value);
      }
    }

    return query;
  };

  stcore.stcoreequests = function stcoreequests(event, callback) {
    function sendGeneric (callback) {
      stcore.makeKeyRequests(event, 'ns-event', callback);
    }

    function sendByLevel (callback) {
      stcore.makeKeyRequests (event, 'ns-' + event.level, callback);
    }

    function sendByLevelAndName (callback) {
      stcore.makeKeyRequests(event, 'ns' + ((event.level && '-' + event.level) || '') + '-' + event.name, callback);
    }

    //since stcore events only filter on name, we are sending multiple events and different levels of granularity
    async.series([sendGeneric, sendByLevel, sendByLevelAndName], callback);
  };

  stcore.makeKeyRequests = function makeKeyRequests(event, eventName, callback) {
    var selectedKeys = event.isAnnouncement ? announcementKeys : keys;

    _.each(selectedKeys, function eachKey(key) {
      stcore.makeKeyRequest(key, event, eventName, callback);
    });
  };

  stcore.makeKeyRequest = function makeKeyRequest(key, event, eventName, callback) {
    //var url = 'https://stcore.ifttt.com/trigger/' + eventName + '/with/key/' + key + stcore.valuesToQuery(event);
    var url = 'https://graph-na02-useast1.api.smartthings.com/api/token/e7bbffb3-02f7-4f34-a386-cae870a31bc4/smartapps/installations/1a4be998-9e30-49df-bc22-a622979d440a/ifttt/Bay3Open';
    request
      .get(url)
      .on('response', function (response) {
        console.info('sent stcore request: ', url);
        callback(null, response);
      })
      .on('error', function (err) {
        callback(err);
      });
  };

  if (keys && keys.length > 0) {
    return stcore;
  } else {
    return null;
  }

}

module.exports = init;
