var flow = require('middleware-flow');

var encryption = require('app-modules/utils/encryption');
var PeriodicFbeventCounter = require('app-modules/models/fbevent/periodic-fbevent-counter');
var Fbevent = require('app-modules/models/fbevent');
var errors = require('app-modules/errors');

function isFirstInChain(getFbevent) {
  return (req, res, next) => {
    var fbevent = getFbevent(req) || {};

    if(fbevent._isFirst === '1') {
      return next();
    } else {
      return next(new errors.InvalidRequestError('Fbevent is not first in feedback chain'));
    }
  }
}

function handlePeriodicFbeventCounter(getFbevent) {
  return flow.mwIf(isFirstInChain(req => getFbevent(req)))
    .then(increasePeriodicFbeventCounter(req => getFbevent(req).organization_id))
    .else(getPeriodicFbeventCounter(req => getFbevent(req).organization_id));
}

function getPeriodicFbeventCounter(getOrganization) {
  return (req, res, next) => {
    PeriodicFbeventCounter.getOrganizationsCurrentCounter(getOrganization(req))
      .then(count => {
        req.fbeventPeriod = count;

        return next();
      })
      .catch(err => next(err));
  }
}

function encryptFbevent(getFbevent) {
  return (req, res, next) => {
    var fbevent = getFbevent(req);

    var data = [...[], ...(fbevent.data || [])];

    if(data.length === 0) {
      return fbevent;
    }

    switch(fbevent.question_type) {
      case 'Text':
        req.fbevent = Object.assign({}, fbevent, { data: [encryption.encrypt(data[0])], crypted: true });
        break;
      case 'Contact':
        req.fbevent = Object.assign({}, fbevent, { data: data.map(value => Object.assign({}, value, { data: encryption.encrypt(value.data) })), crypted: true });
        break;
      case 'Upsell':
        req.fbevent = Object.assign({}, fbevent, { data: data.map(value => Object.assign({}, value, { data: encryption.encrypt(value.data) })), crypted: true });
        break;
      default:
        req.fbevent = fbevent;
    }

    return next();
  }
}

function increasePeriodicFbeventCounter(getOrganization) {
  return (req, res, next) => {
    var organizationId = getOrganization(req);

    if(organizationId === undefined) {
      return next(new errors.InvalidRequestError());
    }

    PeriodicFbeventCounter.increaseCounterForOrganization(organizationId)
      .then(counter => {
        req.fbeventPeriod = counter;

        return next();
      })
      .catch(err => next(err));
  }
}

module.exports = { encryptFbevent, increasePeriodicFbeventCounter, isFirstInChain, getPeriodicFbeventCounter, handlePeriodicFbeventCounter };
