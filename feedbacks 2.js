'use strict';
var auth = require('../lib/auth');
var render = require('../lib/render');
var summary = require('../lib/summary');
var _ = require('lodash');
var moment = require('moment');
var mongoose = require('mongoose');
var async = require('async');

var feedbackList = require('./feedback-list');
var results = require('./results');

var Survey = require('../models/survey');
var Feedback = require('../models/feedback');
var Fbevent = require('../models/fbevent');
var Device = require('../models/device');
var Devicegroup = require('../models/devicegroup');
var Question = require('../models/question');
var UserDevices = require('../models/userdevices');
var User = require('../models/user');
var render = require('../lib/render');
var middlewares = require('../lib/middlewares');

module.exports = function (app) {

	app.post('/api/feedbacks/list',
		auth.isLoggedIn(),
		middlewares.getPlan(),
		(req, res) => {
		var deviceId = req.body.devices;
		var surveyId = req.body.surveys;
		var dateFrom = req.body.from;
		var dateTo = req.body.to;
		var skip = parseInt(req.body.skip);
		var limit = parseInt(req.body.limit);
		var plan = req.plan;
		var language = req.user.settings.locale || 'en';
		feedbackList.getFeedbackTable({ dateFrom, dateTo, deviceId, surveyId, skip, limit, plan,language })
			.then(data => {
			res.json(data);
			})
			.catch(err => render.error(req, res, { err }));
	});

	app.get('/api/dashboard', auth.isLoggedIn(), function(req, res){
		summary.dateRange = req.query.dateRange;
		summary.toDate = req.query.to;
		summary.fromDate = req.query.from;

		summary.getUserData(req.user, req.query, function(data){
			render.api(res, null, data);
		});
	});

	app.post('/api/fbevents/count', ///* TO BE REMOVED
		auth.isLoggedIn(),
		middlewares.getPlan(),
		(req, res) => {
			results.getFeedbackChainCount({
				deviceId: req.body.devices || [],
				from: moment.utc(req.body.from, 'YYYY-MM-DD').unix(),
				to: moment.utc(req.body.to, 'YYYY-MM-DD').add(1, 'days').unix(),
				surveyId: req.body.surveys || []
			}).then(count => {
				return res.json({ count, planHasLimit: req.plan.maxFbeventCount !== undefined, planLimit: req.plan.maxFbeventCount });
			});
		});

		app.post('/api/fbevents/count-feedbacks-over-plan',
			auth.isLoggedIn(),
			middlewares.getPlan(),
			(req, res) => {
				results.getFeedbackChainCount({
					maxFbeventCount: req.plan.maxFbeventCount,
					deviceId: req.body.devices || [],
					from: moment.utc(req.body.from, 'YYYY-MM-DD').unix(),
					to: moment.utc(req.body.to, 'YYYY-MM-DD').add(1, 'days').unix(),
					surveyId: req.body.surveys || []
				}).then(count => {
					return res.json({ count, planHasLimit: req.plan.maxFbeventCount !== undefined, planLimit: req.plan.maxFbeventCount });
				});
			});



	app.post('/api/fbevents/:id/toggle_hidden', auth.isLoggedIn(), function(req, res){
		var body = req.body;
		var id = req.params.id;

		if(!body || !_.isBoolean(body.hidden)) {
			return res.status(400).json({ error: 'Hidden value must be a boolean' });
		}

		function afterFind(err, fbevent) {

			if(!fbevent) {
				return res.status(404).json({ error: 'No feedback event found' });
			} else if(req.user.activeOrganizationId().toString() != fbevent.organization_id.toString()) {
				return res.send(401);
			}

			fbevent.hidden = body.hidden;
			fbevent.save(afterSave);
		}

		function afterSave() {
			return res.send(200);
		}

		Fbevent.findById(id, afterFind);
	});

	app.get('/api/fbevents/weekly/:id', auth.isLoggedInAndAdmin(), function (req, res) {
    var query = {
			created_at: {
				$gte: new Date(req.query.from),
				$lte: new Date(req.query.to)
			},
			organization_id: req.params.id
		};

		var selectFields = {
			_id: 0,
			__v: 0,
			device_id: 0,
			question_id: 0,
			survey_id: 0,
			organization_id: 0
		};

		UserDevices.getUserDevices(req.user, function(devices){
			query.device_id = {$in: devices};
			render.dbExec(Fbevent.find(query, selectFields), res);
		});
  });


    app.get('/api/feedbackcount', auth.isLoggedIn(),function(req, res){
        UserDevices.getUserDevices(req.user, function(devices){
            Feedback.count({organization_id: req.user.activeOrganizationId(), device_id: {$in: devices}}, function( err, count){
                res.json({ count });
            });
        });
    });

    app.get('/api/feedbacks/default', auth.isLoggedIn(), (req, res) => {
			req.user.devices()
				.then(devicesOfUser => {
					var deviceIds = _.map(devicesOfUser, device => device._id);

					return Fbevent.findOne({ device_id: { $in: deviceIds } })
						.populate('survey_id')
						.sort('-created_at_adjusted_ts')
						.then(feedback => {
							if(!feedback) {
								return {
									devices: [],
									surveys: [],
									dateTo: moment.utc().format('YYYY-MM-DD'),
									dateFrom: moment.utc().subtract(6, 'days').format('YYYY-MM-DD')
								}
							} else {
								var query = {_id: { $in: deviceIds }, active_survey: feedback.survey_id._id}

								var d = _.filter(devicesOfUser, device => device._id.toString() == feedback.device_id.toString());

								return Device.find(query)
									.then(devicesOfSurvey => {
										devicesOfSurvey = [...d, ...devicesOfSurvey]
										return {
											devices: devicesOfSurvey,
											surveys: [feedback.survey_id],
											dateTo: moment(feedback.created_at_adjusted_ts * 1000).format('YYYY-MM-DD'),
											dateFrom: moment(feedback.created_at_adjusted_ts * 1000).subtract(6, 'days').format('YYYY-MM-DD')
										}
									});
							}
						});
				})
				.then(defaults => {
					res.json(defaults)
				})
				.catch(err => render.error(req, res, { err }));
    });

    app.get('/re', function(req, res){
        Question.find({question_type: "Contact"}, function(err, docs){
            var qids = _.map(docs, "_id")
            Survey.find({question_ids: {$in: qids}}, function(err, surveys){
                var sids = _.uniq(_.map(surveys, "_id"))
                Feedback.count({survey_id: {$in: sids}}, function(err, count){
                    console.log(count)
                })
            })
        })
    });

};
